# ADR 0005 — 危险操作规则集

状态：**Accepted**
日期：2026-06-23

## Context

参考项目（claude-code/security-guidance、codex/execpolicy、openclaw/SECURITY）的"危险操作"概念**不适用于 x_harness**。

那些项目的隐含语境是：
> AI 是辅助，**人类才是计算环境的主人**；任何"可能让人类感到不舒服"的动作都要拦一下。

x_harness 的语境恰恰相反：
> **x_harness 是给 AI 使用的操作系统**；AI 是计算环境的常驻主人，人类是协作者/审计者。
> "AI 想干就让它干" 是默认；只有两类例外才需要拦。

所以 x_harness 重新定义"危险"。**不是"看起来吓人"危险，是"会让 x_harness 偏离它该走的轨道"才危险。**

## Decision

x_harness 的 **危险信号（DangerSignal）** 只来自两类：

### Class A — 人类账号 / 资金权益类（HumanAccount）
**触发标准**：动作的副作用作用在**人类的账户、信用、资金、个人声誉**上，且这种副作用**不可由 x_harness 自行回滚**。

例子：
- 提交订单 / 调用付费 API（金额超阈值）
- 以人类身份发邮件 / 发消息 / 发推
- 注销账号 / 改密码 / 改双因素
- 创建或删除外部账户、签订合同
- 把数据上传到外部（涉及隐私越界）
- `git push --force` 到他人/共享分支（影响他人协作）

### Class B — x_harness 自存续类（SelfPreservation）
**触发标准**：动作可能**损坏 x_harness 自身的运行 / 配置 / 数据 / 恢复能力**，导致它无法继续工作或无法回到稳定状态。

例子：
- 写/删 `~/.x_harness/` 下的状态 / 配置 / 记忆 / 审计 log
- 写/删 x_harness 自身二进制 / 进程目录
- 改自身依赖（`pnpm uninstall` x_harness 的 dev deps、`brew uninstall node`）
- 杀掉自己的进程 / 子进程树（`kill -9` 自己的 pid 树）
- 锁死自己的执行权限（`chmod 000` 自己工作目录）
- 把 actor 总线 / audit log 给"清零" / "改写"（无论用什么手段）
- 让自己永久失去网络出口（如改 `/etc/hosts` 屏蔽 model API）
- 让自己永久失去 LLM 凭据（如清空 keyring 中的 x_harness 项）
- 触发系统层面的不可逆变更，**且 x_harness 没有相应恢复 skill**（例：`rm -rf /`、`dd of=/dev/disk0`、`diskutil eraseDisk`）

**Class B 的判定原则**：
> "如果干完这事，x_harness 在 5 分钟内还能不能靠自己回到能给人类干活的状态？"
> 能 → 不是危险；不能 → 是危险。

## 显式 NOT 危险

为对齐预期，明文列出"看起来吓人，但 x_harness 视角下**不是**危险"的动作：

- `rm` / `rm -rf` **非 x_harness 自身目录**：默认放行（删用户某 tmp、某项目 build 目录都不拦）
- `sudo` **任何命令**：默认放行（前提是命中 Class A/B 时另算）
- 改系统设置 / 安装软件 / `brew install` / `apt install`：默认放行
- 改防火墙 / 网络配置（只要不让 x_harness 自己失联）：默认放行
- 杀别人的进程：默认放行
- 调用 model API（即使流量大）：默认放行（但若**有人类账单**则进 Class A 的"金额超阈值"分支）
- 修改 `~/.zshrc` / `~/.bashrc` / shell rc 文件：默认放行
- 改 git history（rebase / amend / 本地 force push）：默认放行
- 浏览器自动化（点页面、填表单）：默认放行（前提是登录态属于 AI 自己；命中 Class A "以人类身份"则另算）

> 这条单子**不是"安全教育"**，是声明立场：x_harness 不替 AI 自我审查。

## Class A 判定细则

```
isClassA(action) =
  (action 写入 / 调用 一个 "human-bound resource") AND
  (副作用 不可由 x_harness 自行 undo)
```

`human-bound resource` 包括：
- 任何标记为"以人类身份登录"的 surface（邮箱、IM、社交、银行、政企门户）
- 任何金钱流（支付 API、外卖、打车、订单、订阅升级、广告投放）
- 任何对外发布渠道（域名转移、DNS 改动、给客户/合作方发的正式消息）
- 任何会出现在"人类信用记录"里的事（合同、协议、签名）

判定时需结合 **actor 总线上下文**：
- 若当前会话中人类已经显式说"用我的 X 账号去办 Y"，则该次动作的 **Class A 触发被人类预授权**（仍记 audit，但不弹确认）
- 预授权的"有效域"必须是**本次会话 + 同一类 action**；不跨会话延续

## Class B 判定细则

```
isClassB(action) =
  影响范围 与 x_harness 自身存续目录/进程/凭据/网络出口 相交 AND
  没有匹配的恢复 skill
```

具体落地：

1. **自身目录清单**（第一螺旋固定）：
   - `~/.x_harness/`（数据、记忆、审计、配置）
   - `<repo>/packages/` / `<repo>/crates/` / `<repo>/refs/`（开发期仓库内容）
   - `<x_harness 二进制>` 自身的安装位置
   - 当前进程的 cwd（限于其下被标记为 actor=system/x_harness 的子目录）

2. **自身凭据清单**：
   - keyring 中以 `com.x_harness.*` 命名的所有项
   - 环境变量名以 `X_HARNESS_*` 开头的所有项
   - `~/.x_harness/secrets/`

3. **自身进程**：
   - 当前 PID 及其后代
   - 任何 `app-server` daemon（未来）

4. **网络出口**：
   - model provider domain（如 `api.deepseek.com`）的 DNS / hosts / proxy

5. **恢复 skill 匹配**：
   - 若 x_harness 有名为 `recover.*` 的 skill 能恢复该副作用 → **不算危险**
   - 例：删 `~/.x_harness/memory` 后有 `recover.memory.rebuild` → 放行
   - 例：删自己进程目录 → 无恢复 → 危险

## 危险被命中后的流程

```
detect(action)
  ├─ class A: 弹确认 → 等待人类批准 → 走 actor 总线"human-approved"
  ├─ class B: 弹确认 → 但 UI 上明确写"为何危险" + 列出可能的恢复路径
  └─ both:    一次确认涵盖两类，audit 双标
```

**Class A 与 Class B 的区别**：

|        | Class A | Class B |
|--------|---------|---------|
| 性质   | 不可 undo 的对外副作用 | 可能让 x_harness 无法自救 |
| 拦的是 | 人类账号 / 资金 | x_harness 自身存续 |
| 谁来批 | 必须人类，不能预授权"永远批准" | 人类，但可以"为该类创建 recover skill"消除拦截 |
| 失败回滚 | 通常不可回滚（已花的钱花了）| 命中说明回滚已不可能；只能避免 |
| 默认动作 | 拦 | 拦 |

## 实现位置

- 规则定义：`crates/x_kernel/src/danger/rules.rs`（数据 + match 引擎）
- 命中拦截：`crates/x_kernel/src/guard.rs`（IPC 通知外壳）
- 外壳侧：`packages/core/src/danger-handler.ts`（弹确认 / actor 升级）
- UI 侧：`packages/ui/src/components/ConfirmDialog.tsx`（"为何危险" + 恢复路径）

## 实施清单（第一螺旋落地）

第一螺旋只实装最小集合：

### Class A 规则集 v0

- `payment.*`：任何 skill 名带 `pay` / `payment` / `checkout` / `purchase` 的调用 → 拦
- `human-identity.send`：以 actor 总线声明为 `human-identity=true` 的 surface 发消息 → 拦
- `git.push.shared`：检测目标 remote 是否有 `team` / `org` / `upstream` 字样且分支不是本人个人分支 → 拦（可配置白名单）

### Class B 规则集 v0

- 写入路径匹配 `~/.x_harness/**`（除 `~/.x_harness/scratch/**`） → 拦
- 写入路径等于 / 包含 当前 x_harness 进程的 `argv[0]` 路径 → 拦
- 命令包含 `kill -9 <pid>`，且 pid 在当前进程树 → 拦
- 命令为 `rm -rf` 且目标包含上述自身目录 → 拦
- 命令修改 `/etc/hosts` 加 `api.deepseek.com` 屏蔽 → 拦
- 命令清空 keyring 中 `com.x_harness.*` → 拦

> 其他**全部默认放行**。规则集是白名单式"拦截"，不是黑名单式"放行"。

## 反目标（明确写下来防止再扩张）

- ❌ 不拦"看起来 risky 的命令"：`sudo` / `chmod` / `rm` 本身不是信号，**目标**才是信号
- ❌ 不做"AI 是否做了符合人类道德/法律的事"的判断：不是 x_harness 的工作（让 model 自己讲伦理；x_harness 不替它道德化）
- ❌ 不和 model provider 的内置 safety 重合：那是 provider 的事
- ❌ 不预防"AI 浪费时间/算力"：浪费不是危险
- ❌ 不给 Class A/B 之外的动作加任何"软提示"（避免 UI 噪音稀释真正的确认）

## 进化路径

危险规则集本身也是 x_harness 自学习进化的素材：

```
人类标注「这次拦得对/错」 → 规则置信度更新 → 触发 ADR-update 草稿
人类标注「这事以后别再问我」 → 生成本会话预授权 / 写入 skill 草稿
```

特别地：
- 若某个 Class B 命中之后人类反复说"放行"——说明该副作用其实有恢复路径，**应该催生一个 `recover.*` skill**，落地后该规则自动失效。
- 若某个 Class A 命中之后人类**总是拒绝**——说明这个能力不应交给 AI，**应该转成 skill 黑名单**。

## Open Questions

- Class A "金额阈值"的初值（建议：100 元，可配置）
- 浏览器登录态如何判定"AI 自己的"还是"人类的"（候选：cookie jar 隔离 + actor 标签写到 cookie metadata）
- 命中 Class B 但人类批准放行后，是否要强制"备份后再执行"（候选：是，作为内置 fallback skill）
- 远程节点（螺旋 3）上的 x_harness 自存续如何判定？跨主机进程树的"自身"边界

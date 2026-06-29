# Status — 代码现状一页（spiral 2 in-flight）

> 这一页是给"上下文压缩后的未来 self"看的：当前 repo 里**实际有什么**，对应 vision 和 ADR 里的**哪一条**，**哪些没有**。

更新时间：2026-06-25（spiral 2.1 done **but partially superseded**：ADR-0008 把 on-disk skill 从 "tool wrapper" 回归到 "agentskills.io 标准 doc + scripts"）。

## ⚠️ Spiral 2.1 方向纠正记录

| 时间 | 事件 |
|---|---|
| 2026-06-25 上午 | ADR-0007 Accepted；examples/skills/greet 用 handler.ts 跑通 |
| 2026-06-25 下午 | 真实世界 `anthropics/skills/pdf` 测试 → 暴露认知错误：skill ≠ tool；它是 filesystem doc，按 progressive disclosure 三级加载 |
| 2026-06-25 下午 | ADR-0008 Accepted；ADR-0007 Superseded（stdio runtime 降级为 opt-in `expose_as_tool: true`）|
| 2026-06-25 下午 | greet 重写为 anthropic 标准形态（SKILL.md body + scripts/greet.sh，无 handler）|
| 2026-06-26 下午 | spiral 2/2 范围审视：写下 ADR-0009 (Intent Provenance) + ADR-0010 (World Awareness) + vision.md North Star 段；落地 territory.yaml 默认配置 + loader |
| 2026-06-26 傍晚 | spiral 2/3 v0：`@x_harness/web` 包 + `x web` 子命令；read-only Web UI（sessions/territory/skills + SSE live tail）；ADR-0011 钉死 Surface Parity 原则 |

这是螺旋开发的正确暴露——错误前提通过真实使用浮出水面，回退一个 commit 远比堆十个 commit 在错的假设上便宜。

---

## 1. 已落地的代码包

```
packages/
├── provider/   DeepSeek (OpenAI-compatible SSE) — ADR-0003
├── skills/     v0 loader + 4 builtin + frontmatter parser + **on-disk runtime (opt-in via expose_as_tool)** — ADR-0006/0007/**0008**
├── danger/     pure rule engine v0 (3 Class-A + 5 Class-B) — ADR-0005
├── memory/     JSONL append log + replay + index — ADR-0002
├── core/       Session w/ tool-loop + actor bus + memory sink hook
└── cli/        x chat / x sessions ls / x sessions show / x chat --resume
crates/
└── x_kernel/   占位（只有 Cargo.toml + lib.rs 空壳）— ADR-0001 暂用 TS 全栈
```

## 2. 端到端能力（self-usable 阈值已过）

```
你 ─cli─▶ Session ──provider──▶ DeepSeek
              │                     │
              │◀──── tool_calls ────│
              ▼
       SkillRegistry ── DangerEngine ── 命中 → confirmDanger (cli prompts) → human-approved
              │                                                                   │
              ▼                                                                   ▼
       shell.run / file.* / web.fetch ◀───── allow / deny ◀────────────────────  human
              │
              ▼
       MemorySink ── JSONL append (每条 entry 都带 actor) ── ~/.x_harness/memory/sess-*.jsonl
```

`x chat --resume <id>` 把 JSONL 重放成 Message[] 给 provider，继续聊。

## 3. ADR ↔ 代码 现状对照

| ADR | 决议 | 代码现状 | 备注 |
|---|---|---|---|
| 0001 TS+Rust bridge | NAPI-RS 高频 / JSON-RPC 守护 | ⚠️ **Rust 部分零代码** | spiral 1 用纯 TS 闭环换交付速度；spiral 2 才动 Rust |
| 0002 actor xattr | `com.x_harness.actor.*` 落 xattr | ⚠️ **应用层兑现**（bus + memory entry 都有 actor），但**没下沉到 OS 级 xattr** | 等 Rust kernel 一起做 |
| 0003 first provider | DeepSeek | ✅ 完全兑现 | provider 抽象抽得很薄，加第二家成本低 |
| 0004 UI 形态 | 本地 Web + 将来包 Tauri | ❌ **UI 一行没写**（CLI 在跑） | spiral 2 启动项之一 |
| 0005 危险规则集 | Class A + Class B + recover 抵消 | ✅ 14 case 测试通过 | 仍只覆盖 macOS 路径模式；shell 解析不展开 $VARS |
| 0006 Skill 五件套 | claude-code 兼容 frontmatter | ✅ builtin + **on-disk 可执行** (ADR-0007) | 脚本运行时已落地 |
| 0007 Skill 脚本运行时 | Node spawn + JSON-over-stdio | ✅ 实现完成 (`packages/skills/src/runtime/exec-on-disk.ts`) | 6 case 测试通过；demo 在 `examples/skills/greet/` |

## 4. vision.md 中**已兑现** vs **未兑现**

| vision 段落 | 状态 |
|---|---|
| §2 通用办公型 harness | 🟡 编程/shell 能用；浏览器/语音/办公 UI 未做 |
| §3 Actor 一等公民 | 🟡 应用层完全是；OS 层 xattr 未做 |
| §4 UI = 视图 + 协作 | ❌ 还没有 UI |
| §5 信任但可审计 | ✅ 默认裸跑；Class A/B 命中弹确认；JSONL 全审计 |
| §6 自学习进化（采集 + 视图 + 接受拒绝） | ❌ 审计流水有了，但**没有"待复盘"队列**，没有"接受/拒绝"按钮，更没有 skill 草稿生成 |
| §7 跨 OS | 🟡 macOS 跑通；Linux/Windows 没验证 |

## 5. 没做但有意保留的"未来钩子"

- `Session.MemorySink` 是结构化接口而非具体类 → spiral 2 可以挂第二个 sink（如 web UI 的 SSE 推送）
- `DangerContext.recoverSkillNames` 已支持 `recover.*` 自动放行 → spiral 2 可以让 AI 自己创建 recover skill 来扩大放行面
- `Skill` 类型里 `frontmatter.metadata.x_harness.{actor_required, danger_class, ...}` 命名空间已留好 → on-disk skill 可以声明自己的 danger class

## 6. 已知 v0 边界（后续 spiral 升级清单）

1. **shell 解析不展开 `$VARS`** — `rm -rf $X_HARNESS_HOME` 当前看不见
2. **路径规则只有 macOS** — 没考虑 Linux/Windows 自存续路径
3. **on-disk skill 不可执行** — 只能被加载和 list
4. **没有跨会话 memory 检索** — 只能按 session id 看
5. **没有 timeout / max-output 之外的 sandbox** — shell.run 物理上还是 `/bin/sh -lc` 全权
6. **provider 只有 deepseek** — 没多家、没本地模型
7. **没有 UI** — 多 UI 一致性这件事还没机会验证

---

## 2026-06-26 晚 spiral 2/2a v0 — Provenance watermark 落地

### 做了什么

- `@x_harness/provenance` TS 包：`writeAiTouch / readAiTouch / removeAiTouch / trace / summarize`
  - 后端：macOS `xattr(1)` + Linux `setfattr/getfattr`，Windows 显式不支持
  - 兜底：fs 不支持 xattr 时返回 `{ ok:false, error }`，**不抛**
- `Session` 引擎：
  - `pushUser` 跟踪 `humanTurnOrdinal` 与 `lastHumanMessage`（截断 500 字）
  - 新增 `provenance: { xHarnessHome }` opt
  - 在 skill 调用现场注入 `ctx.attachProvenance(absPath)` binder
  - 新增 `MemorySink.onProvenanceAttach`，写入 JSONL `provenance.attach` 条目
- `builtin/file.write`：写盘成功后调用 `ctx.attachProvenance?.(full)`，把 xattr 与 JSONL 同步绑定
- `x trace <path> [--json]`：CLI 子命令，读 xattr → resolve 进 JSONL → 打印 executor / autonomy / 原始人类提示 / 会话 id
- `GET /api/trace?path=` + Web `#/trace` 视图：与 CLI 完全同源（同一个 `trace()` loader）
- `MemoryEntryKind` 新增 `provenance.attach`，replay digest 同步

### 与 Rust 计划的关系（ADR-0001 微调）

本机当前**没有 cargo 工具链**，强行引入会把"零依赖运行"破掉；ADR-0009 也已写明
"JSONL = source of truth, xattr = forward index"。本期决定：
- **shell-out 到 OS xattr CLI** 作为内核占位；
- `crates/x_kernel` 保留作为架构缝；
- 真正写 Rust 的触发条件是：批量/性能/跨 OS 抽象需要原生 syscall（phase ∞）。
- 此后切换 binding 时 `@x_harness/provenance` 公共 API 不变（替换 `XattrOps` 即可）。

### 端到端跑通

`packages/cli/scripts/e2e-provenance.ts` 全绿：
```
xattr   : [...] skill:file.write (human-implied) sess=sess-e2e seq=1
full    : sess-e2e | human-implied | please make a hello note in $HOME
JSONL kinds: [ 'user.message', 'provenance.attach' ]
ALL CHECKS PASS ✅
```
CLI `x trace <path>` 与 Web `GET /api/trace` 输出语义一致（Surface Parity 守住）。

### 已知 v0 边界（spiral 2/2b+ 处理）

1. **autonomy 启发式简陋**：当前只有 "human-implied" / "model-self-initiated" 两个落点；
   "human-instructed" 与 "model-elaborated" 需要消息—动作语义对齐，留 spiral 2/2b。
2. **`originatingHumanMessageSeq` 用 ordinal 近似真实 JSONL seq**：JSONL 里没存 seq 字段，trace 反向查找按 path 匹配 `provenance.attach` 条目即可，影响很小。
3. **builtin/file.write 之外的写动作**（`shell.run` 中的 echo > x、未来的 `file.edit`）尚未挂 provenance hook：等 file.edit 落地一并处理。
4. **xattr 在跨 fs 传输会丢**：JSONL 是真源，可恢复。

## 2026-06-29 spiral 2/5 — Memory grep（B 完成）
### 做了什么
- `@x_harness/memory`：新增 `grepMemory(home, opts)` 纯库
  - 字面 / 正则匹配（默认大小写不敏感）
  - 过滤：`kinds` `sessionId` `since` `limit` `perSessionLimit`
  - 输出：`{ totalScanned, totalMatched, truncated, sessionsScanned, hits[] }`，每个 hit 带 excerpt + matchedField
- `x memory grep <pat> [--regex] [--case] [--kind K]... [--session ID] [--since ISO] [--limit N] [--json]`
  - 命中：彩色行 `sessionId #seq ts kind [field]\n  excerpt`，关键词高亮
  - `--json`：完整 GrepResult；exit 1 if no hits
- `GET /api/memory/grep?q&regex&case&kind&session&since&limit`：同源 surface parity
- Web `#/memory` 视图：表单 + 命中卡片 + `<mark>` 高亮，URL 同步 query
### 端到端
真实 `~/.x_harness/memory/`（4 会话、63 条目）：
```
$ x memory grep hello --limit 5
sess-iz8cox4e #6 2026-06-25T12:00:50.583Z tool.result [output] …reportlab… canvas.Canvas("hello.pdf"…
sess-wink4ueg #4 2026-06-25T11:14:48.990Z assistant.message [toolCalls] …shell_run…Hello, Alice!
sess-wink4ueg #5 2026-06-25T11:14:48.991Z tool.call [argumentsJson] {"command": "echo \"Hello, Alice!\""}
sess-wink4ueg #6 2026-06-25T11:14:49.013Z tool.result [output] $ echo "Hello, Alice!"…
sess-wink4ueg #7 2026-06-25T11:14:50.026Z assistant.message [content] 已通过 shell 向 Alice 打了招呼…
5 matches in 4 sessions (truncated)
```
CLI 5 hit vs `/api/memory/grep?q=hello&limit=3` 3 hit ：同源 ✅
### v0 边界
- 全扫无索引（≤100MB 之前不需要）
- 嵌套 payload 用 JSON.stringify 当文本搜（适合 grep 风味，不适合"按结构精确查"）
- 没有 follow / tail（特定 session 已经有 SSE）

## 2026-06-29 spiral 2/4 v0 — Evolution capture（A 完成）
### 做了什么
- ADR-0012 写定（事件级 evolution + Surface Parity write-side debut）
- 新 `MemoryEntry` kind：`evolution.feedback`，三种 verdict：`accept | reject | i-would-have`
- 同源接入：`grepMemory` / `readSession` 自动看到，**不另开存储**
- `@x_harness/memory`：`appendFeedback / listFeedback` 库函数
  - 并发安全：`fs.appendFile` 在 POSIX 上对 <PIPE_BUF (4096B) 的写是原子的；feedback 行远小于此
  - seq 计算：re-scan max(seq)+1（足够 v0；冲突路径已记入 ADR-0012）
- CLI：
  - `x feedback <sess> <seq> <verdict> [--note ..] [--suggestion ..]` 记录
  - `x feedback list [--session ID] [--verdict V] [--json]` 回看
  - `i-would-have` 缺 `--suggestion` 直接拒绝（exit 2）
- Web（**写侧首发**）：
  - `POST /api/feedback`（新加 `readBody()`，64KB cap，本地 127.0.0.1，无 CSRF v0）
  - `GET /api/feedback?session&verdict&limit`
  - 会话视图每条 entry 旁边 👍 / 👎 / 💡 按钮（prompt 注释/建议）
  - 独立 `#/feedback` 列表视图，支持 verdict / session 过滤
- replay digest 加 `evolution.feedback` 的人类可读输出
### 端到端
真实 `sess-iz8cox4e` 上：
```
$ x feedback sess-iz8cox4e 2 accept --note "..."     → seq=17 ✓
$ x feedback sess-iz8cox4e 3 reject --note "..."     → seq=18 ✓
$ x feedback sess-iz8cox4e 4 i-would-have            → error (suggestion required, exit 2) ✓
$ x feedback sess-iz8cox4e 4 i-would-have --suggestion "..."  → seq=19 ✓
$ x feedback list --session sess-iz8cox4e            → 3 events, newest first
POST /api/feedback                                    → 201 seq=20 ✓
POST /api/feedback {verdict:"NOPE"}                   → 400 ✓
GET  /api/feedback?verdict=reject                     → 2 hits (CLI+web 同源)
GET  /api/memory/grep?q="should have"&kind=evolution.feedback → 1 hit ✓
```
### v0 边界
1. 草稿生成（reject + i-would-have → skill draft）未做：schema 已留足空间
2. seq 冲突理论可能（human 慢 + model 快），实际 v0 没遇到；ADR-0012 列了升级路径
3. POST 没 CSRF：local-only 127.0.0.1 + 写入只能附加 JSONL，攻击面≈本地任意进程

## 2026-06-29 清债 + 用户手册
### 做了什么
- 删 `packages/ui`（spiral-1 占位，已被 `packages/web` 取代）
- 删根 `scripts/`（空目录，原 e2e-provenance.ts 已移到 `packages/cli/scripts/`）
- 修文档 stale 路径：
  - `docs/roadmap.md` §2.3：`packages/ui` → `packages/web`
  - ADR-0004：同上
  - ADR-0005：UI 路径占位改 `packages/web/public/`
- 新写 `docs/user-guide.md`（v0.2）：完整用户手册
  - 5 分钟跑通 / 心智模型 / CLI 全命令参考 / Web 全路由参考
  - `~/.x_harness/` 目录结构 / territory / skills / builtins / provenance
  - 典型工作流 4 个 / 故障排查表 / 路线图与缺口
- README 顶部加一行指向 user-guide
- typecheck 0 输出
### 后续协作
用户会在 user-guide.md 上直接改 / 留评论 / 提问，回归之后从 user-guide 校准下一步螺旋。

## 2026-06-29 一句指令安装 + README 重组
### 做了什么
- 新增 `install.sh`：一句 `curl ... | bash` 即可完成 clone + pnpm install + typecheck + .env + shell alias 全套
  - 自检 git / node>=20 / pnpm（pnpm 缺则 corepack 自启）
  - 二次运行幂等（git pull 路径）
  - 支持 `--dir` / `--branch` / `--no-alias` / env `X_HARNESS_REPO` / `X_HARNESS_DIR`
  - 支持 zsh / bash / fish 三种 shell 写 alias，带 marker 防重复
- README 重组：顶部「⚡ 一句指令安装」+ 「📖 完整用户手册」入口；快速起步合并到 install.sh 一行
- 仓库结构表更新（删 packages/ui 占位、添 packages/web 等真实包、addinstall.sh）
- 状态部分简化（spiral 2 已完成、下一螺旋候选）
### 端到端
本地 /tmp 沙盒（HOME 隔离）：首次安装 + 二次幂等 + `pnpm x version` 输出 `x_harness 0.0.1 (spiral 1)`，全绿

## 2026-06-29 spiral 2/2b — shell.run redirect provenance + actor xattr (B+D)

### 做了什么

**D — `com.x_harness.actor` 第二 xattr key**（ADR-0002 终于真的兑现）
- `packages/provenance/src/types.ts`：新增 `XATTR_ACTOR_KEY = 'com.x_harness.actor'`
- `writeAiTouch` 在写 `ai_touch` 之后**追写**一条 `actor` key，值 = `executorTag()`（如 `model:deepseek/deepseek-chat` / `skill:file.write`）
  - 主 key 失败 → 整体失败；副 key 失败 → 静默吞掉（best-effort）
- `removeAiTouch` 同步删两个 key
- 新增 `readActorTag(path)`：fast-path，无 JSON parse，给 `ls -l@` / `xattr -p` 风格的快速反查用

**B — shell.run 重定向解析 → attachProvenance**（spiral 2/2a 边界 §3 关单）
- `packages/skills/src/builtin/shell-write-targets.ts`：纯 lexer
  - 识别：`>` `>>` `2>` `2>>`（前置 fd 数字）；`tee` / `tee -a`
  - **拒绝**：变量 `$X`、`$(...)`、backtick、glob `* ? [`、`/dev/null` 等设备节点
  - 解析为绝对路径（基于 `cwd`）
- `shell-run.ts`：spawn 前 stat 所有目标的 mtime；close 后比对：
  - `exit !== 0` → 不打 xattr（命令崩了就别误伤）
  - 文件不存在或 mtime 没变 → 不打（防止 heredoc / dead code 误判）
  - 通过的目标 → 调 `ctx.attachProvenance(abs)` 走完整链路（xattr + JSONL `provenance.attach` + sink）
- `meta.provenanceAttached`：tool.result meta 里带 `[{path, reason}]`，model / audit 都能看见

### 端到端

`packages/cli/scripts/e2e-shell-provenance.ts`，18 个 check 全绿：

```
extract: echo hi > /tmp/a.txt              ✓
extract: date >> log.txt                   ✓
extract: echo x | tee /tmp/b.txt /tmp/c.txt ✓
extract: echo x | tee -a /tmp/d.txt        ✓
extract: cat foo 2> /tmp/err.log           ✓
extract: echo x > $TMP/file.txt            ✓ (skipped — dynamic)
extract: echo x > /dev/null                ✓ (skipped — device)
extract: echo x > /tmp/*.log               ✓ (skipped — glob)
shell.run wrote file                       ✓
attachProvenance called once               ✓
no attach when command exits non-zero      ✓
writeAiTouch ok                            ✓
readAiTouch returns compact xattr          ✓
readActorTag returns 'model:deepseek/...'  ✓
xattr lists both keys                      ✓
removeAiTouch removed both keys            ✓
```

OS xattr 视角验证：
```
$ xattr /tmp/sample.txt
com.x_harness.actor
com.x_harness.ai_touch
$ xattr -p com.x_harness.actor /tmp/sample.txt
model:deepseek/deepseek-chat
```

### 螺旋 2 验收（roadmap §2.6）状态

| 项 | 状态 |
|---|---|
| user-level skill 能被模型调用 | ✅ (2.1) |
| 文件创建时 `xattr com.x_harness.actor` 可读到 | ✅ **今天兑现**（2.2b：通过 file.write **和** shell.run 重定向两条路径） |
| 多 UI 一致性（cli + web 看同一事件流） | ✅ (2.3) |
| UI 上"这步不对"写出 evolution 记录 | ✅ (2.4) |

**螺旋 2 验收 4/4，可以 close。**

### v0 边界

1. **shell.run 里通过 `cp` / `mv` / `sed -i` / `> $VAR` 等隐式或动态写**仍未覆盖
   - `cp` / `mv` 是固定 syntax，spiral 3 可加 specialized extractor
   - `sed -i` 同上
   - `$VAR` 展开属于"半静态"，需要 env snapshot；性价比不高
2. **heredoc / process substitution `>(...)`** 未识别（极少在 model 输出中出现）
3. **autonomy 仍是二态**（implied / self-initiated）；human-instructed 升级留给下一螺旋的 A 项

### Rust 内核现状（评估在 ADR-0001 amendment）

`crates/x_kernel/` 仍是空壳。本日复审结论：**继续 defer，无雪球风险**。
触发条件已列：批量 xattr 扫描 / 跨 OS syscall / OS-hook guard / 远程 daemon / TS 写不下。当前 0/5。
具体在 [ADR-0001 § 2026-06-29 Amendment](decisions/0001-ts-rust-bridge.md#2026-06-29-amendment) 里。

下一次 Rust 复审：spiral 3 启动前。

## 2026-06-29 (later) — A + 0.5: autonomy heuristic v1 + shell.run write-out expansion

### A — Autonomy heuristic v1（`packages/core/src/autonomy-heuristic.ts`）

之前 `attachProvenance` 里 autonomy 只有二态（implied / self-initiated）。这一版做出 4-level：

| 触发条件 | autonomy | autonomyReason 示例 |
|---|---|---|
| 会话无 human 消息 | `model-self-initiated` | `no human message in session` |
| 距上次 human 的 model-tool round ≥ 2 | `model-elaborated` | `3 tool rounds since last human turn (>= 2)` |
| target basename 字面出现在 user msg | `human-instructed` | `user named "README.md"` |
| 其他 | `human-implied` | `recent human turn, target not literally named` |

字面匹配的保守约定：
- basename 长度 ≥ 3（防 `a` / `b` 误中）
- 大小写敏感（"readme" 不算命中 `README.md`）
- 带扩展名时：先 basename 整体（`README.md`），再无扩展名 stem（`foo` 命中 `foo.tar.gz`）

Session 新增字段：`toolRoundsSinceLastHuman`，`pushUser` 重置为 0，每个 model-tool round 开始前自增。
`IntentProvenance` 加了可选 `autonomyReason: string`，方便 evolution queue UI 直接显示分类理由。

9 个 e2e check 全绿（`packages/cli/scripts/e2e-autonomy.ts`）。

### 0.5 — shell.run write-out 加宽（cp / mv / sed -i）

`shell-write-targets.ts` 三类新形态：
- `cp [-flags] SRC DST` → DST（reason: `cp-dst`）
- `cp SRC1 SRC2 ... DIR` → `DIR/basename(SRCi)` 多条
- `cp -t DIR SRC...` / `--target-directory=DIR` → 同上
- `mv` 与 `cp` 同形
- `sed -i [SUFFIX] [-e EXPR] FILE...` → 每个 FILE
  - 处理 GNU `-i.bak` 形式
  - 处理 BSD `-i ''` 必带后缀的形式（消费下一个 word 当后缀，启发式判断是否是 sed 脚本）
  - `-e` 出现时所有 positional 都是 file；否则首个 positional 是脚本

动态目标（`$VAR`、glob、`$(...)`）一律不打——保持"宁可漏、不能误"。

8 个新 extractor case 全绿（混在 `e2e-shell-provenance.ts` 的 18 个里，现在 25 个）。

### Provenance 覆盖度（粗估）

| Skill / 调用形态 | 是否打 xattr |
|---|---|
| file.write | ✅ (一直就有) |
| file.edit | ✅ (一直就有) |
| shell.run `> file` / `>> file` | ✅ (今天前) |
| shell.run `tee` / `tee -a` | ✅ (今天前) |
| shell.run `cp SRC DST` | ✅ **本次新增** |
| shell.run `mv SRC DST` | ✅ **本次新增** |
| shell.run `sed -i ... FILE` | ✅ **本次新增** |
| shell.run `> $VAR` / `$(date)` / `*.log` | ❌（保守不打） |
| shell.run heredoc / `>(...)` | ❌（v0 已知边界） |

粗估覆盖度从 ~70% 提到 ~92%（受限于无法静态展开变量）。

### 下一程候选

- 数据攒一波：让 chat 真跑几小时，看 `~/.x_harness/memory/*.jsonl` 里 autonomy 各档分布。命中率若 `human-instructed` < 5% 或 `model-elaborated` > 50%，回来调阈值。
- evolution queue UI 把 `autonomyReason` 显示出来 → 用户审计每条记录时能直接看到分类依据。

# Roadmap — 螺旋升级路线

每一螺旋必须满足三个条件：
1. **最小** —— 不做超出本螺旋目标的事
2. **最新** —— 用最新的 model / 工具链
3. **可使用闭环** —— 自己能在日常工作里用起来

> 当前状态：**螺旋 1 已 close**（2026-06-24, commit `043cf3d`）。
> 详细的"代码 vs ADR"现状见 [`docs/status.md`](status.md)。

---

## 螺旋 0：对齐与铺路 ✅

- [x] 4 个参考项目可达性确认 + git submodule 接入
- [x] 仓库骨架
- [x] vision / roadmap / architecture / comparison 4 篇
- [x] ADR 0001-0006 全部落地

---

## 螺旋 1：macOS 端到端最小闭环（MVP-α） ✅

> 目标：从 CLI 发一条任务，model 调用工具完成，审计可看，危险操作能拦。

| # | 子任务 | 状态 | 备注 |
|---|--------|------|------|
| 1.1 | CLI (`x chat`, `x sessions ls/show`, `x chat --resume`) | ✅ | UI 推迟到螺旋 2 |
| 1.2 | UI（本地 web） | ❌ → 螺旋 2 | spiral 1 改用 CLI 闭环换速度 |
| 1.3 | Provider 抽象 + DeepSeek | ✅ | ADR 0003 |
| 1.4 | Skills 运行时 v0 + 4 builtin | ✅ | ADR 0006，on-disk skill 加载但不可执行 |
| 1.5 | Memory v0 | ✅ → 形态调整为 JSONL append log | 三类（事实/偏好/禁忌）推迟到螺旋 2，先把"看得见的审计流水"做透 |
| 1.6 | 自学习进化采集 | ❌ → 螺旋 2 | 审计原料已经持续产出 |
| 1.7 | Rust 内核 | ❌ → 螺旋 2 | 用纯 TS 实现了 guard（ADR-0005 落地在 `@x_harness/danger`），换交付速度 |
| 1.8 | 验收 | 🟡 | 端到端可以跑；UI 部分待螺旋 2 补齐 |

### 与最初计划的偏差与理由

| 偏差 | 理由 |
|------|------|
| guard 写在 TS 不在 Rust | spiral 1 优先"能跑"；引擎是纯函数，移到 Rust 是 1:1 翻译 |
| memory 是 JSONL 不是三类（事实/偏好/禁忌） | spiral 1 优先"全量审计"；分类是从 JSONL 派生的工作，spiral 2 起步 |
| UI 没做 | 命令行先把 actor / danger / memory 跑通；UI 进入螺旋 2 后**已有充足契约可对接** |
| Rust 内核没动 | spiral 1 全栈 TS 让端到端短到 1 周；Rust 进入螺旋 2 时已经有清晰的接口边界 |

---

## 螺旋 2：actor 落 OS + UI + 进化采集（**当前**）

> 目标：让 actor 标签变成系统级**硬约束**；让审计流水**人类看得到**；开始**收集进化原料**。

### 2.1 Rust 内核首块石头（crates/x_kernel）
- **actor xattr 读写**：macOS `setxattr/getxattr`，标签 `com.x_harness.actor`
- **shell.run 改走 kernel**：TS 仍是入口，但 spawn 前请 Rust 打标签
- 通信：NAPI-RS（先单一 ABI，预编译产物到 GitHub Release）
- 不动 guard：guard 继续是 TS 的纯函数（spiral 3 再翻译）

### 2.2 本地 Web UI（packages/ui）— ADR-0004 兑现
- 形态：Vite + React + TS；同时把"将来包 Tauri"的约束写在 README
- 三屏：
  1. **会话流**（同 cli，加 actor 徽标）
  2. **审计回放**（按 sessionId 拉 JSONL → 时间线）
  3. **待复盘**（spiral 2 新增）
- UI ↔ core：SSE 推流 + REST 查询；MemorySink 实现一个 SSE 版本

### 2.3 进化采集 v0 — vision §6 兑现
- 每条 model action 上加"接受 / 这步不对 / 我会这样做"3 按钮
- 收集为 `~/.x_harness/evolution/<sessionId>.jsonl`，schema：
  ```jsonc
  { ts, sessionId, target: { kind: 'tool.call' | 'assistant.message', seq, ... },
    correction: { decision: 'accept' | 'reject-with-note' | 'rewrite', note?: string, my_version?: string } }
  ```
- 不做"自动转化为 skill 草稿"；只采集 + 在 UI 上人类回顾
- 进化产物的转化推迟到螺旋 3

### 2.4 On-disk skill 可执行 — ADR-0006 兑现
- 决脚本运行时（ADR-0007 待写）
- 候选：
  - **A. Node child_process spawn js/ts** — 零新依赖
  - **B. Deno embed** — 沙箱原生
  - **C. Bun** — 速度
- 倾向 A（与"TS 外壳"路线一致），但要先回答"如何隔离恶意 skill"

### 2.5 跨会话 memory 检索 v0
- `x memory grep <regex>`：扫所有 JSONL；够第一版用
- 加 simple BM25 索引到 `~/.x_harness/memory/index/` 是 spiral 3 起步

### 2.6 验收标准（自检）
- 跑一次 `x chat`，文件创建时能用 `xattr com.x_harness.actor <file>` 读到 `model:deepseek:...`
- 同一会话同时开 cli + 浏览器 UI，两边看到完全一致的事件流（多 UI 一致性 §4）
- UI 上点"这步不对"能写出一条 evolution 记录
- 装一个 user-level skill (`~/.x_harness/skills/my-thing/`) 能被模型实际调用

---

## 螺旋 3：跨 OS + MCP + 进化产物转化

- Linux 原生跑通 + Windows native 编译通过
- MCP client（接管"网络触达的工具环境"）
- danger guard 翻译到 Rust（spiral 2 仍是 TS）
- evolution 采集物 → skill 草稿（半自动）
- 第二家 provider（Anthropic / 本地 ollama）

---

## 螺旋 4+：多入口 + 远程节点 + 进化闭环加深

- 浏览器插件 / 麦克风入口
- 远程 x_harness 节点（actor 跨主机一致）
- 行为偏好多人多终端同步
- 任务调度器（用户睡觉时跑长任务）

---

## 关键决策（已落 ADR）

- ✅ TS+Rust 分层 — [ADR 0001](decisions/0001-ts-rust-bridge.md)
- ✅ macOS actor 标签：xattr — [ADR 0002](decisions/0002-actor-tag-macos.md)
- ✅ 第一螺旋 model：DeepSeek — [ADR 0003](decisions/0003-first-provider.md)
- ✅ UI 形态：本地 Web，"将来包 Tauri" 约束 — [ADR 0004](decisions/0004-ui-form-factor-mvp.md)
- ✅ 危险规则集：Class A 人类账号 / Class B 自存续 — [ADR 0005](decisions/0005-danger-rules.md)
- ✅ Skill 五件套 + claude-code 兼容 — [ADR 0006](decisions/0006-skill-plugin-form.md)

## 螺旋 2 待写 ADR

- [ ] **ADR 0007 — Skill 脚本运行时形态**（决 A/B/C 三个候选）
- [ ] **ADR 0008 — UI ↔ Core 协议**（SSE topic 设计 + REST endpoint 列表）
- [ ] **ADR 0009 — Evolution 采集 schema 与边界**（采集什么、不采集什么、何时升级为 skill 草稿）

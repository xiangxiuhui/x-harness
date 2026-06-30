# Comparison — codex (OpenAI)

> 上游：[openai/codex](https://github.com/openai/codex)
> 锁定 commit：`cfead68e5d` (`codex-zsh-v0.1.0-64`)
> 主语言：**Rust（codex-rs，主体）+ TypeScript（codex-cli 旧版 + sdk）**
> 仓库定位：**OpenAI 官方 coding agent CLI**，本地跑、单二进制、Bazel/Cargo 双构建、跨 OS sandbox 一等公民。
> **主战场象限：L2 ctx trajectory（rollout 独立 crate）+ L1 loop（最完整 taxonomy）+ Rust 内核样板**

## TL;DR

codex 是 4 个项目里**最贴近 x_harness "TS 外壳 + Rust 内核"目标形态**的一个：

- 整个 `codex-rs/` 已经是个**巨型 Rust workspace**（80+ crate）
- 系统级能力（sandbox / process-hardening / windows-sandbox-rs / linux-sandbox / seatbelt）有真的 Rust 实现，不是文档
- 有完整的 `agent-identity` crate（呼应我们的"actor 一等公民"）
- 有 `app-server` / `app-server-daemon` / `app-server-protocol`（守护进程化，对应我们 ADR 0001 的 B 方案）
- 有 `hooks` / `skills` / `memories`（已经把 claude-code 那套协议在 Rust 实现了一遍）
- 有 `rollout` / `rollout-trace`（轨迹/回放，对应我们的 audit log）

**这是 x_harness Rust 内核的最大借鉴源。**

## 四象限映射（Harness 框架）

> 框架定义见 [`harness-framework.md`](./harness-framework.md)。

| 象限 | 评级 | 关键文件 / 借鉴点 |
|---|---|---|
| **L1 loop**（compaction） | ★★★ | `codex-rs/core/src/compact.rs`（714 行）+ `compact_token_budget.rs` + `compact_remote.rs` + `state/auto_compact_window.rs`（共 1499 行）；**`codex-rs/analytics/src/facts.rs` 的 4 维 taxonomy**：`CompactionTrigger`（Manual/Auto）× `CompactionReason`（UserRequested/ContextLimit/ModelDownshift/CompHashChanged）× `CompactionPhase`（Standalone/PreTurn/MidTurn）× `CompactionStrategy`（Memento/PrefixCompaction）—— 五个 ref 里**唯一把 compaction 完整分类化**的 |
| **L1 ctx**（small CH 建模） | ★ | `WorldState`（系统瞬时状态快照）+ `TurnContext` + `responses_metadata` 关联 turn；中规中矩 |
| **L2 loop**（RSI） | ✗ | 无反馈环；但 `rollout-trace` 是最好的 RSI 数据底座 |
| **L2 ctx**（trajectory） | ★★★ **最佳样板** | **`codex-rs/rollout/` 是独立 crate**：JSONL append-only + `state_db`（CQRS：事件日志 vs 派生快照）+ `compression.rs`（旧 rollout 可压缩归档）+ `SessionMeta` / `ThreadItem` 标准化—— x_harness LCH `experience/rollouts/` 直接对照 |

**Codex 的主战场是 L2 ctx trajectory + L1 loop taxonomy + Rust 内核能力**——三块都是最佳样板。

## 仓库形态速览

```
codex/
├── codex-rs/        # ★ 巨型 Rust workspace（80+ crate）
├── codex-cli/       # 旧版 TS CLI（已被 Rust 替代为主路径，但仍存在）
├── sdk/             # SDK
├── docs/            # 用户文档
├── tools/           # 各种工具
├── third_party/     # 第三方依赖
├── bazel/  BUILD.bazel  MODULE.bazel  flake.nix  justfile
└── package.json  pnpm-workspace.yaml
```

### codex-rs 关键 crate（按 x_harness 关注度排）

| crate | 与 x_harness 的关系 |
|-------|---------------------|
| `agent-identity` | ★★★ 直接对照"actor 一等公民" |
| `sandboxing/` (含 seatbelt.rs / landlock.rs / windows / bwrap) | ★★★ 跨 OS sandbox 的现成参考 |
| `process-hardening` | ★★★ 危险操作守卫的"再下一层" |
| `linux-sandbox` / `windows-sandbox-rs` / `bwrap` | ★★★ 平台特定 sandbox 实现 |
| `hooks` (含 declarations.rs / engine / events / config_rules.rs) | ★★ 跟 claude-code hook 对齐的 Rust 实现 |
| `skills` | ★★ 跟 claude-code skills 对齐的 Rust 实现 |
| `memories` (read / write / README) | ★★ memory 持久化参考 |
| `app-server*` (server / daemon / protocol / transport / client / test-client) | ★★ 守护进程化 + IPC 协议（ADR 0001 的 B 方案） |
| `model-provider` / `model-provider-info` / `models-manager` | ★★ Provider 抽象的 Rust 实现 |
| `rollout` / `rollout-trace` | ★★ 轨迹/回放（audit log 参考） |
| `mcp-server` / `rmcp-client` | ★ MCP 双角色 |
| `tui` | ★ TUI 实现参考 |
| `protocol` / `core-api` / `core-plugins` | ★ 内核对外协议 |
| `apply-patch` / `file-search` / `file-watcher` / `file-system` / `git-utils` | ★ 文件操作工具 |
| `network-proxy` / `responses-api-proxy` | 进阶网络层 |
| `code-mode` / `code-mode-host` / `code-mode-protocol` | 编码 mode 协议 |
| `keyring-store` / `secrets` / `aws-auth` | secret 管理 |
| `connectors` | 第三方系统连接器 |
| `terminal-detection` / `shell-command` / `shell-escalation` / `execpolicy` | shell 执行链路 |

## ★ 我们要吸收的

| 特性 | 在 codex 的实现 | 在 x_harness 里映射 | 状态 |
|------|------------------|---------------------|------|
| **Rust 巨型 workspace 切分** | 80+ crate，按"能力一类一 crate"拆 | x_harness 第一螺旋只有 `x_kernel` 一个 crate；后期参照 codex 拆成 `actor-tag` / `guard` / `syscall` / `app-server` 等 | TRACK |
| **跨 OS sandbox 三件套** | seatbelt(macOS) + landlock(Linux) + windows-sandbox-rs(Windows) + bwrap | x_harness：第一螺旋只做"危险操作确认"；可选 sandbox 在螺旋 2/3 直接对照 codex 实现思路 | DEFER |
| **`agent-identity` crate** | 把 agent 身份独立成 crate | x_harness：`x_kernel/src/actor.rs` 第一螺旋；第二螺旋拆 crate | ADOPT |
| **`hooks` crate（带 schema/engine/events）** | hooks 是 Rust 内核里的一等公民 | x_harness：当 hooks 进入第二螺旋，直接参照其 schema | TRACK |
| **`app-server*`（守护进程 + JSON-RPC 协议）** | TS 客户端 ↔ Rust daemon | x_harness ADR 0001 的 B 方案就是这个；codex 是现成参考 | TRACK |
| **`rollout` / `rollout-trace`** | 完整会话回放 | x_harness audit log 的"播放器"功能；第二螺旋 | TRACK |
| **`apply-patch` crate** | unified diff 施加器（claude-code/aider 风的工具） | x_harness：内置 file.edit skill 借鉴其格式 | ADOPT |
| **`execpolicy` / `shell-escalation`** | shell 命令的 policy + 提权流程（含 sudo 拦截） | x_harness 危险操作守卫规则集（ADR 0005）的 Rust 起步参考 | ADOPT |
| **`process-hardening`** | 进程级别的强化（macOS/Linux/Win 各自手段） | x_harness 第二螺旋"裸跑 vs sandbox" 切换的关键 | TRACK |
| **`keyring-store` + `secrets` + `aws-auth`** | secret 集中管理 | x_harness：`DEEPSEEK_API_KEY` 起步用 env，第二螺旋接 keyring | ADOPT |
| **TS↔Rust 双语言 monorepo（pnpm + cargo）** | `codex-cli`（TS） + `codex-rs`（Rust）共存 | x_harness 直接抄这个布局 | ADOPT |
| **Bazel + flake.nix + justfile 多构建** | 同时支持多种构建系统 | x_harness：起步只用 cargo + pnpm，不上 Bazel | DEFER |

## 我们明确不要的

- ❌ **80+ crate 一次性拆开**：第一螺旋只 `x_kernel`，"等场景倒逼"。
- ❌ **Bazel**：大型 monorepo 才需要，当前规模用 cargo+pnpm。
- ❌ **绑定 ChatGPT / OpenAI 账号**：x_harness provider-agnostic。
- ❌ **codex-cli 旧版 TS**：不参考它，参考 codex-rs。

## 上游需要持续跟踪的特性

- **每月看一次 `codex-rs/Cargo.toml` workspace.members 的增减**：他们多拆/合并的 crate 反映了"什么应该独立"。
- `sandboxing/` 的演化（特别是 Windows-sandbox-rs 在哪个 Windows 版本上跑）
- `agent-identity` crate 的字段稳定性（直接复制其 enum 是合规的灵感来源）
- `app-server-protocol` 协议字段（B 方案落地时直接参考）
- `rollout` 事件 schema（audit log 的事实标准候选）

## 提取的 ADR 候选

- 待写：**ADR 0014 — Sandbox 三件套（推迟到螺旋 2/3）**
- 待写：**ADR 0015 — App-Server 守护进程协议（ADR 0001 B 方案落地）**
- 待写：**ADR 0016 — Rollout / audit log schema 对齐**

## 一句话定位

> **codex 是 x_harness 的"未来 Rust 内核样板"**：
> 我们抄它的"crate 切分思路"和"系统级能力实现思路"，但节奏放慢；
> 第一螺旋只跑通 actor + guard，把 codex 当工程地图查。

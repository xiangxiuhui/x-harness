# Comparison — openclaw

> 上游：[openclaw/openclaw](https://github.com/openclaw/openclaw)
> 锁定 commit：`3d4b7cade9` (`v2026.4.19-beta.2-30364`)
> 主语言：TypeScript（pnpm workspace + tsdown 构建）
> 仓库定位：**多渠道 personal AI assistant**，对外形象 "OpenClaw is the AI that actually does things"。
> **主战场象限：L1 loop（`tool-call-repair`）+ 工程结构样板**

## TL;DR

OpenClaw 是 4 个项目里**对 x_harness 工程结构最有借鉴价值**的：纯 TS 单体、pnpm 多包、清晰的 `packages/` + `extensions/` 分层、超大量（144+）的 extension 插件清单。它的 Vision 文档讲的"core 窄腰、能力外置、setup 优先、安全是 deliberate tradeoff"和我们的方向高度同构。

它不像 hermes 那样押"自学习"，更像一个**集大成的、规整的 personal assistant 平台**。

## 四象限映射（Harness 框架）

> 框架定义见 [`harness-framework.md`](./harness-framework.md)。

| 象限 | 评级 | 关键文件 / 借鉴点 |
|---|---|---|
| **L1 loop**（compaction + 协议合法性） | ★★ | `packages/agent-core/src/harness/compaction/`（882 行，branch + main 两路总结 + trailing-tool-result 测试）；**`packages/tool-call-repair`** 与我们 max-rounds bug 同位 |
| **L1 ctx**（small CH 建模） | ★ | `packages/agent-core/src/harness/session/session.ts` `buildSessionContext`；中规中矩 |
| **L2 loop**（RSI） | ✗ | 144 extensions 是 plugin curation，不是 RSI |
| **L2 ctx**（数字分身） | ★ | `packages/memory-host-sdk`（QMD 查询 + embeddings 多 engine）；memory 槽位独占；但能力/经验没打包成可移植单元 |

**OpenClaw 的主战场是 L1 loop 实现 + TS 工程结构**（22 packages + 144 extensions 的切包样板）。

## 仓库形态速览

```
openclaw/
├── apps/                   # android / ios / macos / macos-mlx-tts / shared / swabble
├── packages/               # 22 个 core 包（典型工程切分）：
│   ├── acp-core            # ACPX 协议
│   ├── agent-core          # agent 主循环
│   ├── gateway-client / gateway-protocol
│   ├── llm-core / llm-runtime / model-catalog-core
│   ├── memory-host-sdk
│   ├── plugin-package-contract / plugin-sdk / sdk
│   ├── speech-core / media-core / media-generation-core / media-understanding-common
│   ├── markdown-core / web-content-core
│   ├── net-policy / normalization-core / tool-call-repair / terminal-core
├── extensions/             # 144 个插件，包括：
│   ├── 模型 provider:        anthropic / deepseek / openai / cohere / cerebras / fireworks / ...
│   ├── 消息渠道:             discord / feishu / google-meet / googlechat / ...
│   ├── 系统能力:             browser / canvas / file-transfer / device-pair / bonjour / ...
│   ├── 协作工具:             diffs / document-extract / firecrawl / exa / brave / duckduckgo / ...
│   ├── 平台代理:              codex / codex-supervisor / copilot / copilot-proxy / github-copilot / ...
│   ├── 运维监控:              diagnostics-otel / diagnostics-prometheus / admin-http-rpc / ...
│   ├── 内存/记忆:             active-memory
├── skills/                 # 内置 skills（推 ClawHub 外置）
├── ui/                     # 看起来是 web UI
├── src/                    # 主 entry（openclaw.mjs）
├── config/ docs/ docker-compose.yml / Dockerfile / fly.toml / render.yaml
├── taxonomy.yaml           # 分类元数据
└── tsconfig.{core,extensions,plugin-sdk.dts,projects}.json   # 多重 tsconfig 分层
```

## ★ 我们要吸收的

| 特性 | 在 openclaw 的实现 | 在 x_harness 里映射 | 状态 |
|------|--------------------|---------------------|------|
| **packages/ + extensions/ 双层结构** | core 22 包；extensions 144 包 | x_harness：`packages/` 当 core；后续 `extensions/` 当插件外壳（推迟到第二螺旋） | ADOPT |
| **核心包高度细分** | 把 normalization / tool-call-repair / net-policy 等都拆 | 不要一次拆这么细；初期 6 包足够，等场景出现再拆 | DEFER |
| **plugin-sdk + plugin-package-contract** | 插件 SDK + 契约分离 | x_harness：等接 MCP / 第三方扩展时直接借用这模式 | TRACK |
| **多重 tsconfig 分层** | `tsconfig.{core,extensions}.json` 各管一摊 | x_harness：`tsconfig.base.json` + 每包独立（同思路、更轻） | ADOPT |
| **`tsdown` 作为打包器** | 替代 tsup/rollup，零配置快速 | x_harness：第一螺旋可用 `tsdown` 或 `tsup`，二选一 | EVAL |
| **doctor / migrate / onboard 命令** | `openclaw doctor --fix`、`openclaw onboard`、`hermes claw migrate`（hermes 都给它做了迁移命令） | x_harness：CLI 早期就加 `x doctor`、`x onboard`，避免 setup 痛点 | ADOPT |
| **net-policy 包** | 网络访问策略集中管理（白名单/黑名单/速率） | x_harness：actor 总线下游应有 net-policy 节点（推迟） | DEFER |
| **terminal-core 包** | 终端抽象（多 backend） | x_harness：和 hermes 的 backend 对应；推到螺旋 3 | DEFER |
| **VISION.md 安全段："deliberate tradeoff: strong defaults without killing capability"** | 明文写下"安全是取舍而非教条" | x_harness vision 也持此立场；可以抄一句话进 vision | ALIGN |
| **plugin 类型分为 code-plugin / bundle-plugin** | code 插件深度扩展 / bundle 打包稳定外部表面（skill / mcp / config） | x_harness：长期采用相同二分；第一螺旋只做 bundle 形态（skill） | ADOPT |
| **memory 是"特殊插件槽，只能装一个"** | 一次只能有一个 memory 实现 | x_harness：memory 槽位的"独占性"是好设计，避免多套 memory 打架 | ADOPT |
| **`extensions/canvas/`** | 看起来是和 Claude Canvas 类的"实时画布" | x_harness 的 UI 视图层未来可借鉴这个 canvas 协议 | TRACK |
| **`extensions/codex-supervisor/`** | OpenClaw 把 Codex 当作子智能体来"监工" | x_harness 哲学相通：harness 之上可包另一个 agent | TRACK |

## 我们明确不要的

- ❌ **第一天就 144 个 extension**：违反"最小可用闭环"。先有 6 个 core 包 + 1 个 provider extension（deepseek）即可。
- ❌ **22 个 core 包的细分**：拆得太细对小团队是负担；x_harness 先 6 包，等场景倒逼。
- ❌ **多消息平台**：和 hermes 同理，第一/第二螺旋只做 CLI+Web。
- ❌ **媒体能力**（speech / media-generation / mlx-tts）：远期再说。

## 上游需要持续跟踪的特性

- `plugin-sdk` / `plugin-package-contract` 的契约稳定后，对照我们的 skill / extension 形态。
- `taxonomy.yaml`：他们怎么给 144 个 extension 做分类元数据，我们以后也会需要。
- `extensions/active-memory/`：他们的"主动记忆"具体怎么实现。
- `apps/macos*` 的实现：将来 x_harness 上 Tauri 时可参考其 macOS 集成细节。
- `extensions/canvas/`：UI 视图协议。

## 提取的 ADR 候选

- 待写：**ADR 0009 — Extension/Plugin 形态（code vs bundle）**
- 待写：**ADR 0010 — net-policy 抽象**
- 待写：**ADR 0011 — memory 槽位独占性**

## 一句话定位

> **OpenClaw 是 x_harness 工程结构的"未来照片"**：
> 它已经把 22 个 core + 144 个 extension 的 TS 单体跑稳了；
> 我们参考它"怎么切包、怎么命名、怎么 doctor"，但路径上要慢得多、节奏由场景驱动。

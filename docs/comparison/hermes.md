# Comparison — hermes-agent

> 上游：[NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent)
> 锁定 commit：`426f321e8` (`v2026.6.5-1259-g426f321e8`)
> 主语言：Python（Electron / TUI 部分含 TS）
> 仓库定位：**自学习的、跨终端的个人 AI agent**，强调"learning loop"与多消息平台接入。

## TL;DR

Hermes 是 4 个项目里**最贴近 x_harness 终极目标**的一个：

- 自学习闭环（agent-curated memory + skill 自创建/自改进）
- 多入口（CLI / TUI / Electron desktop / Telegram / Discord / Slack / WhatsApp / Signal …）
- 跨终端"runs anywhere not just your laptop"（local / Docker / SSH / Singularity / Modal / Daytona）
- 多 provider（OpenRouter / NovitaAI / NIM / OpenAI / 自部署）
- AGENTS.md 提出"core 是窄腰、能力在边缘"——和 x_harness 的 R1–R6 思想一致

x_harness **不抄它的代码**，但它的"边界划分""学习闭环""平台中立"三件事是直接的方法论参照。

## 仓库形态速览

```
hermes-agent/
├── agent/                  # agent core（巨大，~97 个文件夹）
├── tools/                  # 100+ 个 tool（browser / computer-use / cron / discord / feishu …）
├── skills/                 # 内置 skill 包（按领域分组：apple/devops/email/research/…）
├── providers/              # 通过插件（plugins/model-providers/<name>/）注册 provider
├── plugins/                # 插件总仓
├── hermes_cli/             # CLI 入口
├── tui_gateway/ ui-tui/    # TUI 入口
├── apps/                   # 看起来是 Electron desktop
├── gateway/                # 消息平台网关（多渠道）
├── cron/                   # 定时任务
├── mcp_serve.py            # MCP server 模式
├── batch_runner.py         # 批量轨迹生成（research-ready）
├── trajectory_compressor.py# 轨迹压缩（训练用）
└── docs/ docker/ nix/ apps/website
```

## ★ 我们要吸收的

| 特性 | 在 hermes 的实现 | 在 x_harness 里映射 | 状态 |
|------|------------------|---------------------|------|
| **Skill 自创建/自改进** | "complex task 后自动创建 skill；skill 在使用中 self-improve" | x_harness 自学习进化 v0 → 进化原料 → skill 草稿（roadmap §1.6） | TRACK |
| **Agent-curated memory + 周期性 nudge** | 长会话过程主动提醒"该把 X 持久化" | memory v0 + 自学习进化的"待复盘队列"对应 | TRACK |
| **FTS5 跨会话搜索 + LLM 摘要** | sqlite FTS5 + 摘要做检索 | memory v0 推荐：先 FTS5（轻量），第二螺旋上 embedding | ADOPT |
| **AGENTS.md 哲学：核心窄腰 / 能力外置** | "core 增加每一个 tool 都要支付每次 API 调用的代价" | x_harness：built-in skills 极少，能力进 skills/plugins | ADOPT |
| **prompt cache 神圣不可侵犯** | 长会话不轻易改 system prompt / toolset | 第一螺旋核心约束，写进 architecture.md 后续版本 | TODO |
| **多入口 = 单 agent core** | CLI / TUI / desktop / 消息平台共用 core | 与 ADR 0004 R3 完全契合（"core 是本体"） | ALIGN |
| **跨执行环境**（local/Docker/SSH/Modal/Daytona） | terminal backend 抽象 | 推迟到螺旋 3 "远程触达"；预留接口 | DEFER |
| **Compatible with [agentskills.io](https://agentskills.io) open standard** | 用开放 skill 格式（frontmatter）| x_harness skill 形态：直接对齐 agentskills.io frontmatter 标准 | ADOPT |
| **MCP 双角色**（既做 server 也做 client） | mcp_serve.py | x_harness：暂不接 MCP（用户决定，第二螺旋再说） | DEFER |
| **Cron / 定时任务** | hermes-side scheduler | x_harness：作为 system actor 的子集（"调度器自身也是 actor"） | TODO |
| **Trajectory 数据导出**（用于训练） | batch_runner / trajectory_compressor | x_harness 的 audit log 天生就是 trajectory，留导出接口 | TODO |
| **provider 通过插件注册** | `plugins/model-providers/<name>/` | x_harness `packages/provider/` 走类似插件路径（本期先内置 deepseek） | ALIGN |
| **多语言 README** | en / zh-CN / ur-pk | x_harness：远期但不忘 | DEFER |

## 我们明确不要的

- ❌ **绑定 Python 全栈**：Python 在跨 OS 分发、单二进制、actor 系统级标签上吃亏。
- ❌ **过多预置 tool**（tools/ 里 100+ 个文件）：违反"core 窄腰"的他自己的原则；x_harness 走 skills + plugins 路径。
- ❌ **agentskills.io / honcho / FTS5 等 hard 依赖**：可借鉴形态，但第一螺旋自己实现最小子集。
- ❌ **多消息平台**：第一/第二螺旋只做 CLI + Web UI；消息平台是 UI 的一个延伸，等 actor / UI 抽象稳定后再加。

## 上游需要持续跟踪的特性

- `skills/` 目录的演化（新增哪些类目、frontmatter 字段如何稳定）
- "skill self-improvement" 的具体机制（怎么判断要改、怎么验证）
- `plugins/model-providers/` 插件契约（我们 provider 抽象稳定时对照一次）
- `mcp_serve.py` 在 v2026.x 的 MCP 兼容性
- `trajectory_compressor` 的压缩策略（对我们 audit log → 训练数据有借鉴价值）

## 提取的 ADR 候选

- 待写：**ADR 0006 — Skill frontmatter 与 agentskills.io 对齐**
- 待写：**ADR 0007 — Memory 持久化（sqlite FTS5 起步）**
- 待写：**ADR 0008 — 跨终端执行环境抽象**（螺旋 3）

## 一句话定位

> **Hermes 是 x_harness 在"自学习 + 多入口"维度上最强的对照组**；
> 我们不抄实现，但抄它的取舍哲学。

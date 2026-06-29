# x_harness

> An **AI Operating System** harness for the personal computer.

> 👉 **要用它？** 看 [`docs/user-guide.md`](docs/user-guide.md)（用户手册 v0.2，spiral 2 终结快照）。
>
> Native cross-OS (macOS → Linux → Windows). Trust-but-audit. Multi-modal entry, single source of truth for who-did-what (human vs. model).

x_harness 不是又一个 AI 编程工具，而是一个把 **整台 PC / 服务器以及它能通过网络触达的所有工具环境** 都纳入掌管的、操作系统级的通用办公型 harness。它博采众长，吸收 [hermes-agent](https://github.com/NousResearch/hermes-agent)、[openclaw](https://github.com/openclaw/openclaw)、[claude-code](https://github.com/anthropics/claude-code)、[codex](https://github.com/openai/codex) 的优点，但只做对 x_harness 终极目标有利的取舍。

## 核心理念（一句话）

> **不额外增加约束和框架，给予系统级权限和系统级感知；UI 只承担两件事 —— 展示交付物 / 接收人类协作。**

## 设计原则（先记住，再写代码）

1. **Actor 身份是一等公民**：操作系统级标签，永远可区分动作来自 *human* / *model* / *system*。
2. **UI ≠ 应用，UI = 视窗**：所有入口（CLI / 浏览器插件 / System Super App / 麦克风 / 用户操作）只负责
   - (a) 提供交付物的视图（含中间产物）
   - (b) 接收人类协作（指令 / 纠正 / 标注）
3. **信任但可审计**：默认裸跑，危险操作弹确认；所有动作可回放。
4. **螺旋升级**：每一螺旋必须是"最小可用闭环"。
5. **TS 外壳 + Rust 内核**：开发速度与系统能力兼顾。

## 仓库结构

```
x_harness/
├── docs/                    # 所有设计、决策、对比都在 docs 里讨论
│   ├── vision.md            # 北极星
│   ├── roadmap.md           # 螺旋升级路线
│   ├── architecture.md      # TS+Rust 双层
│   ├── comparison/          # 4 个参考项目的对照笔记
│   └── decisions/           # ADR (Architecture Decision Records)
├── refs/                    # git submodule，参考项目（只读）
│   ├── hermes-agent/
│   ├── openclaw/
│   ├── claude-code/
│   └── codex/
├── packages/                # TS workspace（外壳层）
│   ├── cli/                 # CLI 入口
│   ├── ui/                  # UI 入口（含 actor 标识）
│   ├── core/                # 编排 / 会话 / actor 总线
│   ├── skills/              # Skill 运行时
│   ├── memory/              # 记忆 / 知识 / 自学习进化
│   └── provider/            # LLM provider 抽象
└── crates/                  # Rust workspace（内核层）
    └── x_kernel/            # 系统级 IO、危险操作守卫、actor 标签写入 OS
```

## 第一螺旋（macOS）目标 — ✅ Close (2026-06-24, `043cf3d`)

- [x] CLI 跑通（`x chat` 流式对话）
- [x] 1 个 model API 打通对话回路（DeepSeek, ADR 0003）
- [x] Skills 运行时 v0（ADR 0006；4 个 builtin: shell.run / file.read / file.write / web.fetch）
- [x] 记忆 v0（JSONL append log + `x sessions ls/show` + `x chat --resume`）
- [x] 危险操作拦截（ADR 0005：Class A / Class B，14 case 测试通过）
- [ ] UI 入口、自学习进化采集 → **推迟到螺旋 2**

详细的代码 vs ADR 现状一页：[`docs/status.md`](docs/status.md)
螺旋 2 计划：[`docs/roadmap.md#螺旋-2`](docs/roadmap.md)

## 快速起步

```bash
pnpm install
cp .env.example .env       # 填 DEEPSEEK_API_KEY
pnpm x chat                # 交互式对话
pnpm x sessions ls         # 看历史会话
pnpm x sessions show <id>  # 查某次会话的审计流水
pnpm x chat --resume <id>  # 接着上次聊
```

## 参考项目（git submodule）

见 `docs/comparison/`：4 份详细对照笔记 + 交叉结论。

## 怎么参与

我们目前主要在 `docs/` 里推进对齐。

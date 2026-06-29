# x_harness

> An **AI Operating System** harness for the personal computer.
>
> Native cross-OS (macOS → Linux → Windows)。Trust-but-audit。多入口、单一真相源（who-did-what：human vs. model）。

---

## ⚡ 一句指令安装

```bash
curl -fsSL https://raw.githubusercontent.com/xiangxiuhui/x-harness/main/install.sh | bash
```

脚本会自动：
1. 检查 `git` / `node ≥ 20` / `pnpm`（缺啥提示装啥；pnpm 自动用 corepack 启用）
2. `git clone https://github.com/xiangxiuhui/x-harness` 到 `~/.x_harness-src`
3. `pnpm install` + `pnpm typecheck` 自检
4. 复制 `.env.example` → `.env`
5. 给当前 shell（zsh/bash/fish）写入 `alias x='...'`

完成后：

```bash
# 1. 填 DeepSeek API key（目前唯一支持的 provider）
$EDITOR ~/.x_harness-src/.env             # DEEPSEEK_API_KEY=sk-...

# 2. 重开终端（或 source 你的 rc）让 `x` 生效

# 3. 开始用
x version                                 # 自检
x chat                                    # 交互式对话
x web                                     # 浏览器 UI (127.0.0.1:7777)
```

**可选参数**：
```bash
# 装到指定目录、不写 alias、指定分支
curl -fsSL https://raw.githubusercontent.com/xiangxiuhui/x-harness/main/install.sh \
  | bash -s -- --dir ~/code/x_harness --no-alias --branch main
```

**手动安装**（不想跑脚本）：
```bash
git clone https://github.com/xiangxiuhui/x-harness.git ~/.x_harness-src
cd ~/.x_harness-src
pnpm install
cp .env.example .env && $EDITOR .env
alias x='(cd ~/.x_harness-src && pnpm -s x)'
```

---

## 📖 完整用户手册

> 👉 **怎么用、有哪些命令、磁盘上长什么样、territory / skill / provenance / feedback 都是啥**
> 全都在 [`docs/user-guide.md`](docs/user-guide.md)（v0.2，spiral 2 终结快照）。

5 分钟看完，包含：
- CLI 完整命令参考（`chat` / `sessions` / `web` / `trace` / `memory grep` / `feedback`）
- Web 完整路由 + REST API
- `~/.x_harness/` 目录结构
- Territory / Skills / Builtin Tools / Provenance / Feedback 的工作机制
- 4 个典型工作流（审计、跨会话查错、给模型打分、边聊边看）
- 故障排查表 + 路线图与已知缺口

---

## 这是个什么项目

x_harness 不是又一个 AI 编程工具，而是一个把 **整台 PC / 服务器以及它能通过网络触达的所有工具环境** 都纳入掌管的、操作系统级的通用办公型 harness。它博采众长，吸收 [hermes-agent](https://github.com/NousResearch/hermes-agent)、[openclaw](https://github.com/openclaw/openclaw)、[claude-code](https://github.com/anthropics/claude-code)、[codex](https://github.com/openai/codex) 的优点，但只做对 x_harness 终极目标有利的取舍。

### 核心理念（一句话）

> **不额外增加约束和框架，给予系统级权限和系统级感知；UI 只承担两件事 —— 展示交付物 / 接收人类协作。**

### 设计原则

1. **Actor 身份是一等公民**：操作系统级标签，永远可区分动作来自 *human* / *model* / *system*。
2. **UI ≠ 应用，UI = 视窗**：所有入口（CLI / 浏览器 / 麦克风 / 用户操作）只负责
   - (a) 提供交付物的视图（含中间产物）
   - (b) 接收人类协作（指令 / 纠正 / 标注）
3. **信任但可审计**：默认裸跑，危险操作弹确认；所有动作可回放。
4. **螺旋升级**：每一螺旋必须是"最小可用闭环"。
5. **TS 外壳 + Rust 内核**：开发速度与系统能力兼顾。
6. **Surface Parity**（[ADR-0011](docs/decisions/0011-surface-parity.md)）：任何能力都先在 `packages/<pkg>/` 里写成纯库函数，再并行接到 CLI 和 Web。

---

## 仓库结构

```
x_harness/
├── docs/                       # 设计、决策、对照、用户手册
│   ├── vision.md               # 北极星
│   ├── user-guide.md           # 👉 用户手册
│   ├── roadmap.md              # 螺旋升级路线
│   ├── architecture.md         # TS+Rust 双层
│   ├── status.md               # 代码 vs ADR 现状
│   ├── comparison/             # 4 个参考项目对照笔记
│   └── decisions/              # ADR (0001-0012)
├── refs/                       # git submodule，参考项目（只读）
├── packages/                   # TS workspace
│   ├── cli/                    # CLI 入口（x chat / x web / x trace / ...）
│   ├── web/                    # 本地 Web UI（@x_harness/web）
│   ├── core/                   # 编排 / 会话 / actor 总线 / territory
│   ├── skills/                 # Skill 运行时（doc-form, ADR-0008）
│   ├── memory/                 # JSONL append log + grep + feedback
│   ├── provenance/             # ai_touch xattr + trace 反查
│   ├── danger/                 # 危险命令拦截规则集
│   └── provider/               # LLM provider 抽象（当前：DeepSeek）
├── crates/                     # Rust workspace（占位，长期路线）
└── install.sh                  # 一句指令安装脚本
```

---

## 当前状态（spiral 2 终结）

✅ **已完成**：CLI chat/sessions/web/trace/memory-grep/feedback、Skills doc-form loader、Danger guard v0、Memory JSONL + replay、Territory + system prompt 注入、Provenance xattr + cross-ref、Web UI 读 + 写（feedback POST 是首个 write 侧端点）、Surface Parity 工艺定型（ADR-0011）。

⏳ **下一螺旋候选**：Patrol & snapshot（AI 巡逻领地、发现外部改动）、Skill draft auto-gen（从 `i-would-have` 聚类）、Rust kernel actor、第二个 provider、MCP 兼容、跨 OS。

详细：[`docs/status.md`](docs/status.md)、[`docs/roadmap.md`](docs/roadmap.md)。

---

## 怎么参与

我们目前主要在 `docs/` 里推进对齐。每个改动都先有 [ADR](docs/decisions/) 再写代码。

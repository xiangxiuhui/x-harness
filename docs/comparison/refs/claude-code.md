# Comparison — claude-code

> 上游：[anthropics/claude-code](https://github.com/anthropics/claude-code)
> 锁定 commit：`c80896ca84` (`v2.1.196`)
> 主语言：本仓库**只放官方插件 + 文档**，CLI 本体已不在 npm（installer 安装）；本仓库可见的是 **Plugin 标准 + 官方插件示范**。
> 仓库定位：**agentic coding tool 的官方插件市场 + 插件机制示范**。
> **主战场象限：L2 ctx 能力层（plugin 五件套，最佳样板）**

## TL;DR

claude-code 这个 git 仓库**几乎不是 CLI 源码**——CLI 本体已迁出。我们能从它里面拿走的，是 **Plugin 形态规范** 和 **12 个官方 plugin 的具体写法**。

这套 Plugin 形态（commands / agents / skills / hooks / .mcp.json）是目前业界最干净、最有"标准潜质"的代理扩展协议之一。**x_harness 的 skill 形态会贴它对齐。**

## 四象限映射（Harness 框架）

> 框架定义见 [`harness-framework.md`](./harness-framework.md)。

| 象限 | 评级 | 关键文件 / 借鉴点 |
|---|---|---|
| **L1 loop**（compaction） | ✗ | CLI 闭源；只有 `/compact` 斜杠命令文档（用户手动触发）—— **反例：纯人工不可取** |
| **L1 ctx**（small CH 建模） | ✗ | 不可见 |
| **L2 loop**（RSI） | ★ | skills 是 git-managed markdown 资产，靠人工 curate；hooks 是被动 trigger —— 算"git as RSI substrate" |
| **L2 ctx**（数字分身能力层） | ★★★ **最佳样板** | `plugins/<name>/.claude-plugin/plugin.json` + `commands/agents/skills/hooks/.mcp.json` 五件套目录 = 一个可分发能力包 |

**claude-code 的主战场是 L2 ctx 能力层布局**——五件套是数字分身"皮肤层"的事实标准。
但它**只携带能力，不携带经验**——这就是为什么我们要把 L2 ctx 拆成"能力层 + 经验层"两个独立子层。

## 仓库形态速览

```
claude-code/
├── plugins/                  # 12 个官方 plugin 示范
│   ├── agent-sdk-dev
│   ├── claude-opus-4-5-migration
│   ├── code-review
│   ├── commit-commands
│   ├── explanatory-output-style
│   ├── feature-dev
│   ├── frontend-design
│   ├── hookify
│   ├── learning-output-style
│   ├── plugin-dev
│   ├── pr-review-toolkit
│   ├── ralph-wiggum
│   └── security-guidance
├── examples/                 # 5 个 example
├── .claude/ .claude-plugin/  # 仓库自身的 plugin 元数据
├── README.md                 # 安装方式（curl/brew/winget/npm）
├── CHANGELOG.md
├── feed.xml                  # 插件 feed
└── scripts/ Script/
```

## ★ Plugin 标准结构（重点照抄方向）

```
plugin-name/
├── .claude-plugin/
│   └── plugin.json          # 插件元数据
├── commands/                # 斜杠命令（/foo）
├── agents/                  # 专门 agent（subagent，附带独立 system prompt）
├── skills/                  # Agent Skills（auto-invoked，按 description 触发）
├── hooks/                   # 事件钩子（SessionStart / PreToolUse / Stop / ...）
├── .mcp.json                # MCP server 声明
└── README.md
```

> 这套结构**和 x_harness 的设想完全契合**。

## ★ 我们要吸收的

| 特性 | 在 claude-code 的实现 | 在 x_harness 里映射 | 状态 |
|------|------------------------|---------------------|------|
| **Plugin 五件套结构**（commands/agents/skills/hooks/.mcp.json） | 上面那张图 | x_harness skill/plugin 形态直接对齐 | ADOPT |
| **Skill = frontmatter + body**，由 description 触发 | YAML frontmatter，模型按 description 决定加载 | x_harness：第一螺旋的 skill 走同款 | ADOPT |
| **Subagent 形态**（独立 system prompt） | `agents/` 目录里每个 `.md` 是独立 agent | x_harness：第二螺旋"delegate"机制走同款 | DEFER |
| **Hooks 事件**（SessionStart / PreToolUse / Stop / StopFailure / PostToolUse） | 由 plugin 注入 | x_harness：第二螺旋；与 actor 总线天然契合 | DEFER |
| **`/slash` 命令统一前缀** | `/feature-dev`、`/code-review`、`/commit` … | x_harness CLI/UI：保留 `/` 命令空间作为快捷动作入口 | ADOPT |
| **官方 plugin 自带 SECURITY.md** | `security-guidance` plugin 提示 9 类安全模式 | x_harness：危险操作规则集 ADR 0005 借鉴这 9 类 | ADOPT |
| **`hookify`：让用户自定义 hook 来阻止某些行为** | 把"我不喜欢这种行为"转成 hook 规则 | x_harness：自学习进化 → 用户标注的"禁忌"自动生成 hook | ADOPT |
| **`feature-dev` 7-phase 工作流** | 一个 plugin 定义一种结构化交付流程 | x_harness：长期方向是把"螺旋"也做成可装的 skill | TRACK |
| **`ralph-wiggum`：Stop hook 拦截退出 → 持续迭代** | 自动循环 | x_harness：长期可借鉴这种"长跑"模式 | TRACK |
| **MCP 通过 `.mcp.json` 声明** | 标准化 MCP server 注入 | x_harness：第二螺旋接 MCP 时直接走同款 | TRACK |
| **`feed.xml`** | 用 RSS 风格分发更新 | x_harness：日后做 plugin marketplace 可借鉴 | DEFER |

## 我们明确不要的

- ❌ **CLI 本体不在 npm**（installer-only）：x_harness 第一螺旋走 monorepo + npm/pnpm 即可；可分发但不要绑定 installer。
- ❌ **绑死 Anthropic 模型**：x_harness 是 provider-agnostic（ADR 0003 已定，但抽象从 day 1 在）。
- ❌ **没有公开 core 源码可学**：所以这个对照组的价值仅限于"协议形态"，不是"实现细节"。

## 上游需要持续跟踪的特性

- `plugins/plugin-dev/` 自身（Anthropic 怎么"用插件来开发插件"是元学习的好材料）
- `.claude-plugin/plugin.json` schema 的演化
- `hooks/` 接口稳定后的事件清单
- `frontend-design` skill 的写法（用作 x_harness 自带 frontend-design skill 的样板）

## 提取的 ADR 候选

- 待写：**ADR 0006 — Skill / Plugin 形态对齐 claude-code 标准**
- 待写：**ADR 0012 — Hooks 事件清单**（与 actor 总线整合）
- 待写：**ADR 0013 — Slash command 协议**

## 一句话定位

> **claude-code 这个仓库给我们的礼物是"协议"，不是"代码"**：
> Plugin 五件套（commands/agents/skills/hooks/.mcp.json）是我们 skill 与扩展层的事实标准。

# ADR 0006 — Skill / Plugin 形态对齐 claude-code 五件套

状态：**Accepted**
日期：2026-06-23

## Context

[`docs/comparison/claude-code.md`](../comparison/claude-code.md) 已经确认：claude-code 的 Plugin 五件套（**commands / agents / skills / hooks / .mcp.json**）是当前最干净、最有标准潜质的代理扩展协议。
hermes 的 skill 形态（YAML frontmatter + body，对齐 [agentskills.io](https://agentskills.io)）与之同构。

x_harness 在第一螺旋只需要"skill"，但"skill 长什么样"不能临时拍——日后扩展到 commands/agents/hooks/mcp 时不能改格式。

## Decision

x_harness **完整对齐 claude-code 五件套结构**（只是不一次实装）：

```
<plugin-name>/
├── .x-plugin/                 # 元数据目录（对应 .claude-plugin/）
│   └── plugin.json
├── commands/                  # 斜杠命令（/foo） — 螺旋 2 实装
├── agents/                    # subagent — 螺旋 2 实装
├── skills/                    # ★ 第一螺旋唯一实装项
│   └── <skill-name>/
│       ├── SKILL.md           # frontmatter + body
│       ├── assets/            # 可选静态资源
│       └── scripts/           # 可选执行脚本
├── hooks/                     # 事件钩子 — 螺旋 2 实装
├── .mcp.json                  # MCP server 声明 — 第二螺旋实装（用户决定）
└── README.md
```

**与 claude-code 的差异**：
- 元数据目录改名 `.x-plugin/`（避免品牌耦合）
- 其余字段、文件名、frontmatter 字段 **保持一致**，使社区已有的 claude-code plugin / agentskills.io skill 可以**直接拷贝即用**（顶多改一个目录名）

## Skill 单体形态（第一螺旋唯一）

### 目录结构
```
<skill-name>/
├── SKILL.md           # 必需
├── assets/            # 可选
└── scripts/           # 可选
```

### `SKILL.md` frontmatter

```yaml
---
name: shell-run
description: "Run a shell command. Use when the user wants to execute a system command."
version: 0.1.0
author: x_harness
license: MIT
platforms: [macos, linux, windows]   # 第一螺旋仅 macos
metadata:
  x_harness:
    actor_required: model | human | any   # 谁可以调用
    danger_class: none | A | B | both     # 关联 ADR 0005
    side_effects: [filesystem, network, process, account]
    tags: [shell, system]
    related_skills: [file-edit]
---
```

字段说明：
- `name` / `description` / `version` / `author` / `license` / `platforms`：与 hermes / claude-code 共同子集。
- `metadata.x_harness.*`：x_harness 自有扩展，**所有非通用字段都放这个 namespace**，避免污染对齐域。

### `SKILL.md` body

frontmatter 之后的 markdown body 即为 skill 的"系统提示"，由 core 在判定该 skill 应该被 model 看见时拼入上下文。

body 推荐结构（参考 hermes，但不强制）：
```md
# <Skill 显示名>

## Overview
何时用、不用什么。

## Inputs
该 skill 接受的参数（如有）。

## Behavior
具体怎么做。

## Examples
正反例。
```

## Skill 触发方式

完全对齐 claude-code/hermes：**model 看到 frontmatter 的 `name` + `description` 后自行决定何时调用**。x_harness core 不做"硬路由"。

例外：
- 名字带前缀 `auto.*` 的 skill 总是被注入 system prompt（用于"输出风格"类）
- 名字带前缀 `cmd.*` 的 skill 由用户显式 `/cmd-name` 触发（占位，commands/ 实装前的临时通道）

## Skill 加载来源（第一螺旋）

按以下优先级合并，重名后者覆盖前者：

1. **内置**：`packages/skills/builtin/<skill-name>/`
2. **用户级**：`~/.x_harness/skills/<skill-name>/`
3. **项目级**：`<repo>/.x_harness/skills/<skill-name>/`

第一螺旋的内置 skill：
- `shell.run`（受 ADR 0005 守卫）
- `file.read`
- `file.write`
- `file.edit`
- `web.fetch`

## `.x-plugin/plugin.json`（元数据）

仅在使用"plugin 包"形式分发多个 skill 时需要。单 skill 直接放进 `~/.x_harness/skills/<n>/` 不需要 plugin.json。

```json
{
  "name": "x-harness-core-skills",
  "version": "0.1.0",
  "description": "Built-in skills for x_harness",
  "author": "x_harness",
  "license": "MIT",
  "skills": ["shell-run", "file-read", "file-write", "file-edit", "web-fetch"]
}
```

## 与参考项目的兼容承诺

| 来源 | 是否能直接放进 x_harness 跑 |
|------|----------------------------|
| claude-code skill（plugins/*/skills/*） | ✅ 直接 cp 进 `~/.x_harness/skills/`；frontmatter 兼容；不需要的字段 x_harness 忽略 |
| hermes skill（skills/*/<n>/SKILL.md） | ✅ 同上；`metadata.hermes.*` 字段 x_harness 忽略 |
| agentskills.io 标准 skill | ✅ frontmatter 即标准本身 |
| openclaw skill / extension | 部分兼容；extension（深 runtime 扩展）需要等 plugin SDK（螺旋 2+） |

## 螺旋分布

| 部件 | 螺旋 1 | 螺旋 2 | 螺旋 3+ |
|------|--------|--------|---------|
| `skills/` | ✅ 实装 | 提升加载/合并/进化 | 远程 skill 仓 |
| `commands/` | 占位（`cmd.*` skill 临时） | ✅ 实装 | — |
| `agents/` | 占位 | ✅ 实装（subagent delegate） | — |
| `hooks/` | 占位 | ✅ 实装（与 actor 总线整合） | — |
| `.mcp.json` | 占位 | ✅ 实装 | — |
| `.x-plugin/` 包形式 | 仅内置 | 用户/社区包 | marketplace |

## 反目标

- ❌ 不发明新的 skill 字段：能复用 hermes/claude-code 的就复用
- ❌ 不引入"x_harness only"的语法：对齐域的字段保持中立
- ❌ 不在第一螺旋实装 commands/agents/hooks/mcp，但目录骨架预留

## Open Questions

- skill 的 `inputs` 是否要 JSON Schema（claude-code 用自然语言；hermes 也是）→ 第一螺旋跟随，**不做 schema**
- skill 是否可以声明依赖其它 skill（`related_skills` 是否要变 `requires`）→ 等场景出现再说
- skill body 的最大长度限制（影响 prompt cache）→ 沿用 hermes 的 prompt cache 神圣原则，长 skill 必须独立加载

## 实施位置

- 加载器：`packages/skills/src/loader.ts`
- 注入：`packages/core/src/session.ts`（基于 description 给 model）
- 内置目录：`packages/skills/builtin/`

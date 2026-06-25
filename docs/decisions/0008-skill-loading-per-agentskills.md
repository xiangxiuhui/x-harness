# ADR 0008 — Skill Loading per agentskills.io

- **Status**: Accepted
- **Date**: 2026-06-25
- **Supersedes**: [ADR 0007](0007-skill-runtime-form.md) (whose stdio-runtime mechanism is demoted to opt-in)
- **Aligns**: [ADR 0006](0006-skill-plugin-form.md) §"Skill 触发方式"
- **Triggered by**: 真实世界用 `anthropics/skills/pdf` 测试时发现 ADR-0007 的"handler 注入"模型与 Anthropic 公开标准（agentskills.io）不兼容

## 背景

ADR-0006 决定了 skill 的目录形态。ADR-0006 §"Skill 触发方式"明确说：

> 完全对齐 claude-code/hermes：**model 看到 frontmatter 的 `name` + `description` 后自行决定何时调用**。x_harness core 不做"硬路由"。

但 ADR-0007 在"让 on-disk skill 可执行"这个动作里，**偷换了"调用"的含义**：

| 概念 | ADR-0006 想说的 | ADR-0007 实际做的 |
|---|---|---|
| "model 决定何时调用" | 模型在自由对话/工具调用中**自然引用** skill 文档的指南 | 模型在 OpenAI `tool_calls` 协议下发出 `pdf(...)` 调用 |
| "skill 是什么" | 一个目录：SKILL.md + 可选 scripts/资源 | 一个工具入口：必须有 handler.{ts,sh,py} |
| "scripts 怎么跑" | （ADR-0006 没明说，但开放标准里是 model 用 bash 自跑） | 包一层 stdio JSON 协议，spawn 子进程，args→stdin，result→stdout 末行 |

ADR-0007 的认知错误根源在 spiral 1 D 步骤：当时我把 4 个 builtin 工具（shell.run / file.read / file.write / web.fetch）用 `Skill` 类型包了一层（"unified registry"），让它们和 on-disk skill 共用同一份 `frontmatter + body + handler` 结构。当 spiral 2 要"让 on-disk skill 也跑起来"时，潜意识把"builtin 工具用 Skill 包了一层" **反向推导**成 "所有 skill 都需要 handler"——并为此发明了 stdio JSON 协议这层胶水。

**真相**（来自 [Anthropic 文档](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview) + [agentskills.io 标准](https://agentskills.io)）：

- **Skill = filesystem directory**，按 **progressive disclosure** 三级加载：
  - **L1 metadata**（~100 tokens/skill）：`name + description` 注入 system prompt 常驻
  - **L2 instructions**（~5k tokens）：模型用 bash/file 工具**自己** `cat SKILL.md`，按需读入上下文
  - **L3 scripts + resources**（无上限）：模型用 bash **自己**跑 `python3 .../scripts/x.py`，**只有 stdout 进上下文**，代码本身不进
- **没有 "skill tool call"**。skill 不是 tool。tool 是 bash / file 这种通用执行器；skill 是 tool 调用的**指南**。

## 决策

**x_harness 完全对齐 agentskills.io 开放标准**：

1. **Tool vs Skill 严格分层**：
   - **Tool**（OpenAI tool_calls 暴露给模型的入口）只有 builtin 4 个：`shell.run` / `file.read` / `file.write` / `web.fetch`。这才是 handler 机制最初的合理用途。
   - **Skill** 是文件系统目录；**不**注册为 tool。

2. **加载策略**：
   - `~/.x_harness/skills/<name>/` 和 `<repo>/.x_harness/skills/<name>/` 下的所有 skill：
     - 启动时读 SKILL.md frontmatter
     - 把 `name + description + absolute_path` 拼成一段 system prompt addendum（**L1**）
   - SKILL.md body / FORMS.md / scripts/* 等：**不预加载**。模型按需调 `file.read` / `shell.run` 拿（**L2 / L3**）。

3. **handler 字段语义收紧**：
   - **默认**：on-disk skill 即使有 `handler.ts`，也**不**自动包装成 tool。
   - **opt-in**：仅当 frontmatter 显式声明 `metadata.x_harness.expose_as_tool: true` 时，才把 ADR-0007 的 stdio runtime 启用，注入 handler，并注册为 tool。
   - 这给"我有一个签名清晰的纯函数，想严格暴露给模型"留了一扇门——但不再是默认形态。

4. **System prompt 注入格式**（实现细节，写在 chat.ts）：

   ```
   ## Available skills (filesystem-based, anthropics/skills compatible)

   These are knowledge packs you can self-load when relevant:

   - **pdf** — Use this skill whenever the user wants to do anything with PDF files...
     path: /Users/xxh/.x_harness/skills/pdf/SKILL.md
   - **greet** — Greet someone by name. Demo of an agentskills.io-style skill.
     path: /Users/xxh/.x_harness/skills/greet/SKILL.md

   To use a skill:
   1. Call `file.read` on the SKILL.md path above to load its instructions.
   2. Follow the instructions. They typically tell you to run scripts via `shell.run`.
   3. Scripts produce stdout; that's all you (the model) see — the script source never enters your context unless you read it.
   ```

## actor 归因

ADR-0007 之前给 spawn 出去的 handler 子进程注入 `X_HARNESS_ACTOR=skill:<name>` env，期望 Rust kernel (spiral 2/2) 据此打 xattr。**这个动机现在站不住脚**：

- 真实执行者是 `model:deepseek`，model 决定"按 pdf skill 的指南办事"
- 实际跑 python 的是 shell.run 提供的子进程，由 model 直接发起
- 把 actor 改成 `skill:pdf` 是**篡改归因**

新模型：

- 事件 actor 永远是真实执行者（`model:deepseek` 或 `human:xxh`）。
- 模型可选地用一个**轻量标签流**声明 "我现在按 pdf skill 的指南办事"——通过调一个未来的 builtin `skill.enter(name)` / `skill.exit()` 工具（spiral 3 实装）。
- Rust kernel（spiral 2/2）xattr 只写 actor，不写 skill guidance 标签。

## 反目标

- ❌ 不再把 skill 当作 tool 暴露给模型（除非 opt-in）
- ❌ 不发明 anthropic 标准之外的"skill 调用协议"
- ❌ 不预加载 SKILL.md body / scripts —— 让 progressive disclosure 真的发生

## 验收

执行下列流程后应能跑通：

```bash
cp -R /path/to/anthropics/skills/skills/pdf ~/.x_harness/skills/pdf
pnpm x chat
> 用 pdf skill 提取这份 PDF 的文字：/tmp/foo.pdf
# 期望模型自动：
#   1. tool_call: file.read(~/.x_harness/skills/pdf/SKILL.md)
#   2. (模型读完 SKILL.md，决定调用合适的 scripts)
#   3. tool_call: shell.run("python3 ~/.x_harness/skills/pdf/scripts/extract_text.py /tmp/foo.pdf")
#   4. 把结果摘要返回给人
```

## 影响面

| 模块 | 改动 |
|---|---|
| `packages/skills/src/registry.ts` | 默认不调 `withOnDiskHandler`；仅 `expose_as_tool: true` 时调 |
| `packages/cli/src/chat.ts` | 启动时收集 doc-only skill 描述拼成 system addendum |
| `packages/skills/src/runtime/exec-on-disk.ts` | 不删，保留 6 case 测试；语义变成"opt-in tool wrapper" |
| `examples/skills/greet/` | 重写为 anthropic 标准形态：scripts/greet.py + SKILL.md body 写"运行 ..." |
| `docs/decisions/0007-*.md` | 标 **Superseded by 0008**，补复盘段 |

## 与 vision/ADR-0005 的一致性

- vision §5 "AI 是常驻主人，我们不替 AI 自我审查"：ADR-0008 比 ADR-0007 更尊重这点——**不替模型决定"它应该怎么使用一个 skill"**，把这个决策权还给模型。
- ADR-0005 危险规则集：skill 内的副作用必然走 shell.run / file.write，B1/B2/B3 自动覆盖；ADR-0007 之前担心的"skill 子进程绕过 guard"问题反而消失了。

## Open Questions（spiral 3 再回答）

- 多个 skill 同时与请求相关时，要不要给模型一个 hint（"看起来 pdf 和 forms 都可能用得上"）？目前完全交给模型自选。
- skill marketplace / signing / 可信度等级——超出本 ADR 范围。
- progressive disclosure 的下一步：当模型已经多次 `file.read` 同一个 SKILL.md，是否值得在 cache 层 hint？等数据出现再说。

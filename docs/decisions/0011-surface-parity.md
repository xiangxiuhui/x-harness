# ADR 0011 — Surface Parity（CLI ↔ Web ↔ 未来表面）

- **Status**: Accepted
- **Date**: 2026-06-26
- **Spirals**: 2/3（Web UI v0）
- **Relates to**: [ADR-0002](0002-actor-tag-macos.md)（Actor）、[ADR-0006](0006-skill-plugin-form.md) / Memory JSONL、[ADR-0009](0009-intent-provenance.md)（Provenance）、[ADR-0010](0010-world-awareness.md)（World Awareness）

## Context

螺旋 2/3 在 CLI 之外加了一个 Web UI。**最常见的失败模式**是：GUI 很快长出自己的
state model、自己的 session 仓库、自己的怪癖，CLI 开始烂掉，两个表面对"系统里
发生了什么"渐行渐远。

我们没有这个余地——x_harness 是一台 PC 的 AI OS，不是 SaaS dashboard。

phase ∞ 的视图（[vision.md §0](../vision.md)）：当 x_harness 拿到内核之后，会冒
出**很多很多**表面：语音、ambient、AR、传感器、第三方进程通过本地 socket 跟
harness 对话。**所有表面必须收敛到同一份"系统发生了什么"的视图**。一个会说谎、
或者私有引入"自己的 session 概念"的表面，比没有这个表面更糟。

## Decision：Surface Parity 七条铁律

任何表面（CLI、Web、未来 GUI / 语音 / 等）都要受这七条约束：

1. **磁盘是唯一真相源（Single source of truth on disk）。**
   canonical state 落在 `~/.x_harness/`：
   - `memory/<sessionId>.jsonl` — append-only 事件流（ADR-0006）
   - `memory/index.jsonl` — session header 索引
   - `territory.yaml` — 授权领地（ADR-0010）
   - `skills/` — 装好的 skills（ADR-0008）
   - （未来）`evolution/`、`provenance/` 等
   **不允许**任何表面有私有数据库、会漂移的 cache、或者跟磁盘对不上的内存影子。

2. **表面只渲染，不发明概念。**
   表面可以**渲染并组合**；可以加 UX 糖（live tail、语法高亮、搜索）。它
   **不能**引入磁盘 / 共享 package 里没有的新概念。如果 Web 想要一个新概念，
   这个概念**先**落到 `@x_harness/{core,memory,...}` 和 CLI，**之后**才能在
   Web UI 上出现。

3. **CLI 是 canonical implementation。**
   当出现行为级歧义（"什么算 session 结束？"、"doc-skill 怎么检出？"），
   **CLI 的回答即真理**。Web 和其他表面必须复用同一个 loader：
   `buildSkillRegistry` / `loadTerritory` / `listSessions` / `readSession` …
   **禁止重新实现这些**。

4. **每个 Web 视图都有对应的 CLI 命令（反之亦然，对读视图而言）。**

   | Web                                     | CLI 对应                                            |
   |-----------------------------------------|----------------------------------------------------|
   | `#/sessions`                            | `x sessions ls`                                    |
   | `#/sessions/:id`                        | `x sessions show <id>`                             |
   | `#/sessions/:id/live`                   | `tail -f ~/.x_harness/memory/<id>.jsonl`（无损）   |
   | `#/territory`                           | `cat ~/.x_harness/territory.yaml` + 解析后的 zones  |
   | `#/skills`                              | `/skills` 斜杠命令 / 未来的 `x skills ls`           |
   | `#/memory`                              | `x memory grep`                                    |
   | `#/feedback`                            | `x feedback list`                                  |
   | `#/sessions/:id` 上的 👍/👎/💡 按钮     | `x feedback <sess> <seq> <verdict>`                |
   | `#/trace?path=...`                      | `x trace <path>`                                   |

   写侧（chat、approval、feedback）一律 CLI 先有，Web 在 v1 跟上。

5. **默认 local-only。**
   web server 只 bind `127.0.0.1`。v0 没有 auth——OS 通过 `$USER` 权限把这个
   socket 授予你。**任何要远程暴露的表面都需要一份新 ADR**，正面回答身份、
   加密、scope 三件事。

6. **传输层零外部 runtime 依赖。**
   只用 `node:http`、SSE、原生 fetch、vanilla DOM。OS 项目自己管自己的管道。
   **不能让一堆 npm 包决定我们长什么样**。

7. **不搞私有 IPC。**
   表面跟 harness 对话只有两条路：(a) JSONL 文件、(b) 镜像共享 package 的、
   有文档的 HTTP API。**任何表面私有的 RPC 都不允许**。

## Consequences

- **Pro**：表面便宜，行为不会暗中分叉；JSONL 仍然是"在任何表面重放任何对话"
  唯一需要的产物。
- **Pro**：phase ∞ 迁移变简单——当 harness 拿到内核，这些
  `loadTerritory` / `listSessions` / 等函数会变成内核 API 之上的薄壳，
  表面无感知。
- **Con**：不能上线"浏览器里手感很爽"的 Web 功能而不先在 package 和 CLI
  里给出存在性证明。**我们接受这份摩擦**。
- **Con**：live tail 走 SSE 是 read-after-write 的——CLI 没 flush 的 JSONL
  行，Web 看不见。**我们接受这一点**：它强制诚实（磁盘即真理）。

## Implementation note（v0，当前 commit）

- `@x_harness/web` — 基于 `node:http` 的 server（`src/server.ts`），静态 SPA
  在 `public/`。端点：`/api/health`、`/api/sessions`、`/api/sessions/:id`、
  `/api/sessions/:id/tail`（SSE）、`/api/territory`、`/api/skills`。
  spiral 2 后续追加：`/api/memory/grep`、`/api/trace`、`/api/feedback`（GET+POST）。
- `x web [--port N] [--host H]` — CLI 子命令，复用 `x chat` 同一套
  `buildSkillRegistry` / `loadTerritory` / `listSessions`。
- 起步只读。聊天 / approval over web 推迟到 v1（spiral 2/2 之后）。

## Open questions

- **OQ1**：终端 A 跑 `x chat`、终端 B 跑 `x web`，Web 能通过 SSE 看到 A 的
  session live。但用户**同时**开两个 `x chat`，Web 应该能切。v0 已经可以
  （每个 session 一个 JSONL），但"哪个是当下 live"的 UX 还要打磨；v1 加
  per-session "active" 角标，由 mtime + index.jsonl 的 `op:start` 无对应
  `op:end` 推出。
- **OQ2**：live SSE 流要不要也覆盖 skill / territory 文件变更（用户编了
  territory.yaml，banner 自动刷新）？大概要，走一条独立的 `/api/events`。
  Defer。
- **OQ3**：Web v1（写侧）—— `POST /api/chat`，provenance 带
  `executor=human`、`surface=web`。Approval 弹窗需要一条小的双向通道；
  SSE + POST 足够，**不需要 WebSocket**。

# ADR-0012 — 进化采集 v0（Feedback Events）

- **Status**: Accepted
- **Date**: 2026-06-29
- **Spirals**: 2/4
- **Depends on**: [ADR-0009](0009-intent-provenance.md)、[ADR-0011](0011-surface-parity.md)

## Decision

进化（evolution）从**事件级**起步。在搞"自动从模式里析出 skill"这种 magic 之前，
我们先做一个**几乎零成本采集、长期会自然增值**的原语：

一个 **feedback event** 是 `MemoryEntry { kind: 'evolution.feedback' }`，它通过
`targetSeq` 反指同一个 JSONL 里的另一条 entry，记录人类对那条事件的判决。
v0 只有三种 verdict：

| verdict          | 含义                                       | 必填字段        |
|------------------|--------------------------------------------|-----------------|
| `accept`         | 这件事干得对                               | （`note` 可选） |
| `reject`         | 这件事错了 / 不该发生                      | （`note` 可选） |
| `i-would-have`   | 我会这样做（替代方案）                      | `suggestion`    |

Feedback 事件**写到同一个 JSONL** 里：
- `grepMemory()` 自动看到（一个真相源）
- `readSession()` 在 replay 里包含它（审计视图直接可见）
- **不开新存储层、不建新索引、不做跨文件 join**

**存储位置即是**：`~/.x_harness/memory/<sessionId>.jsonl` —— 跟其他 session
事件混在一起按时间顺序 append，每行一个 JSON object，永不改写。

## Surfaces（遵循 Surface Parity，[ADR-0011](0011-surface-parity.md)）

| 表面 | 能力 |
|---|---|
| `x feedback <sess> <seq> <verdict> [--note ..] [--suggestion ..]` | 记录 |
| `x feedback list [--session ID] [--verdict V]`                    | 回看 |
| `POST /api/feedback`                                              | 记录（**Web 写侧首发**） |
| `GET  /api/feedback?session&verdict&limit`                        | 回看 |
| Web `#/feedback` 视图                                             | 带过滤的回看 |
| Web `#/sessions/<id>` 每条 entry 旁的 👍/👎/💡 按钮              | 内联记录 |

CLI 是 canonical，web 是便利。两者都调同一个 `appendFeedback()` 库函数，
产出**逐字节相同的 JSONL**。

## Concurrency safety

`appendFeedback()` 用 `fs.appendFile()`。在 POSIX 上，**对小于 PIPE_BUF
（macOS / Linux 都是 4096B）的写是原子的**。一条 feedback 行远小于此，
所以即便 live session 的 `WriteStream` 在并发 append，也不会撕裂。

`seq` 通过 re-scan `max(seq) + 1` 分配。如果 live session 在我们 scan 与
append 之间也写了一条，**seq 可能撞**。v0 接受这一点，因为：
- 代码库里没有任何地方需要 seq 唯一（**只需要 ordering**）
- feedback 是人类节奏（罕见），live 写是模型节奏
- 真撞了再升级到 OS 级 advisory lock，或者通过小 IPC 通道把 append
  交给 session 的 MemoryStore 来做

## Out of scope（v0）

- **Skill 草稿生成** —— 从积累的 reject / `i-would-have` 自动产 skill 草稿。
  schema 已经故意留够空间，将来加这一步**不需要 schema 迁移**。
- **Embedding / clustering** —— 同上理由。
- **Quorum / 多用户判决** —— 现阶段一台机器一个人。
- **回复 / 嵌套讨论** —— 如果需要，再发一条 feedback 指向前一条 feedback 的
  `seq` 即可，不需要专门 schema。

## Phase-∞ 兼容性（vision §0）

当 x_harness IS the OS，"用户点了 👎 按钮"是一个 syscall 级信号，跟其他任何
内核事件没有区别。当前 `evolution.feedback` 的 shape 是那个未来事件的**严格子集**：
`(actor=human, target=event-id, verdict, freeform)`。**不需要 schema lift**。

## Consequences

- **写侧之门第一次打开。** 直到今天，所有 web 端点都是 GET。从这条 ADR 开始
  有了**唯一一个** POST 表面（`/api/feedback`）。我们只加了最小的 `readBody()`
  + JSON 解析；**没框架、body 上限 64KB、没 CSRF token**（local-only，绑
  127.0.0.1）。
- **vision §0 的"1 → 100 → ∞"模式有了第一个数据底座。** 模型未来可以通过
  现有的 `x memory grep`（也作为 tool 暴露出去）回头读自己的 JSONL，看人类
  接受了什么、拒绝了什么。
- **Autonomy ladder（[ADR-0009](0009-intent-provenance.md)）拿到训练数据。**
  当 spiral 2/2b 落地后，对 `model-self-initiated` 动作的 reject 事件
  天然就是收紧自治启发式的负样本。

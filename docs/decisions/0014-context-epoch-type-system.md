# ADR 0014 — Context Epoch 类型系统（small CH 形式化建模）

状态：Proposed
日期：2026-06-30
象限：L1 ctx（small context harness）

## Context

x_harness 当前的"上下文渲染"是**隐式**的：`session.ts` 里直接对 `messages: Message[]` push、splice、append，没有任何中间类型来表达"这一刻的上下文长什么样"。

横评后（详见 [`comparison/cross-analysis-context-management.md`](../comparison/cross-analysis-context-management.md) §3）：

| ref | 拼装单元 | 缓存约定 | 版本化 |
|---|---|---|---|
| **opencode** ★ | `ContextSource` × `ContextEpoch` × `BaselineSystemContext` × `MidConversationSystemMessage` × `ContextSnapshot` | Baseline = provider cache anchor | Epoch 是版本，Snapshot 是该 Epoch 内取值 |
| hermes | `prompt_builder.py` 拼装 + sticky context | "prompt cache 神圣不可侵犯" | 隐性 |
| codex | `WorldState` + `TurnContext` | `responses_metadata` 关联 turn | rollout 可 replay |
| claude-code | plugin 五件套进 system 区 | 不可见 | git 版本化 |
| openclaw | `buildSessionContext` | 弱 | 弱 |

> **opencode 是五个 ref 里唯一把 context-management 显式建模成可推理对象的**。
> 这正是 spiral-3 要落地的层级——把"压缩"从"丢弃"升级为"状态转移"。

ADR-0013（Compaction Strategy）只解决"何时压、用什么算法压"；本 ADR 解决"压缩前后的状态用什么类型表达"。**0013 是动词，0014 是名词**，二者必须配套。

## Options

### 概念引入范围

| 选项 | 描述 | 评估 |
|---|---|---|
| **O1. 全套引入 5 概念**（opencode 同款） | Source / Epoch / Baseline / Snapshot / SafeBoundary | ✓ 完整，可推理 |
| O2. 只引 Epoch 一个 | 最小可用 | 不够支撑压缩状态转移 |
| O3. 完全自创 | 重新发明轮子 | ✗ |

### 类型实现

| 选项 | 描述 | 评估 |
|---|---|---|
| **T1. discriminated unions + interfaces**（纯 TS） | 沿用 x_harness 现有风格 | ✓ |
| T2. branded types | 强类型；但学习成本高 | 推迟到 spiral-4 评估 |
| T3. Effect-TS Schema | opencode 同款；学习曲线陡 | ✗（cross-analysis §7 明确不抄 Effect 全栈） |

### Cache anchor 不变量怎么编码

opencode 的 `BaselineSystemContext` 同时承担两个角色：
- system prompt 的稳定起点
- provider cache 的 anchor（不动它才能命中 prompt cache）

| 选项 | 描述 | 评估 |
|---|---|---|
| **C1. Baseline 是不可变字符串 + hash** | 任何修改 = new Epoch | ✓ hermes 同款"prompt cache 神圣不可侵犯" |
| C2. Baseline 可变，只是 by-convention | 容易被打破 | ✗ |

### Epoch 边界何时切换

| 触发 | 切换 Epoch？ |
|---|---|
| **压缩发生** | ✓（核心场景） |
| **system prompt 变了**（用户切换 model / skill 装卸） | ✓ |
| 用户发新消息 | ✗（在同一 Epoch 内 append） |
| tool result 返回 | ✗ |
| max-rounds bail | ✓（视为非常规状态切换） |

## Decision

引入 **5 个核心概念**，对应 `packages/core/src/context/` 新模块：

```typescript
// packages/core/src/context/types.ts

/** 一个 system / tool / memory 的输入来源。Sources 集合决定 Baseline。 */
export interface ContextSource {
  id: string;                  // 稳定 id，跨 Epoch 可追溯
  kind: 'system-prompt' | 'skill' | 'memory' | 'tool-def' | 'world-state';
  origin: string;              // 文件路径 / actor id / 配置 key
  contentHash: string;         // sha256(content)，用于 cache invalidation 检测
}

/** Provider cache 的 anchor。Baseline 不变 = cache 命中。 */
export interface BaselineSystemContext {
  epochId: string;             // 所属 Epoch
  sources: ContextSource[];    // 决定 baseline 的输入集合
  rendered: string;            // 实际拼装出来的 system prompt 文本
  hash: string;                // sha256(rendered)，用于 invariant 校验
}

/** 一个 Epoch = 一段"baseline 稳定"的时间窗。压缩、skill 装卸、model 切换都会切 Epoch。 */
export interface ContextEpoch {
  id: string;                  // ULID
  startedAt: number;
  baseline: BaselineSystemContext;
  parentEpochId?: string;      // 上一个 Epoch（如果是压缩切出来的）
  reason: 'session-start' | 'compaction' | 'sources-changed' | 'manual-reset';
}

/** Epoch 内某一时刻的实际 messages 取值。可序列化、可比较、可作为 trajectory 元素。 */
export interface ContextSnapshot {
  epochId: string;
  takenAt: number;
  messages: Message[];         // 含 system（= baseline.rendered）/ user / assistant / tool
  // 不变量：messages[0] 必为 system 且 content === baseline.rendered
}

/**
 * 一个"安全的边界点"——所有 tool_call 都已收到对应 tool_result，
 * assistant 完成一轮 message 输出，state 干净。压缩、Epoch 切换、状态扰动只能在此发生。
 */
export interface SafeProviderTurnBoundary {
  epochId: string;
  snapshotAt: ContextSnapshot;
  pendingToolCalls: 0;         // 不变量
}
```

### 不变量（必须由代码强制）

1. **`Snapshot.messages[0].content === Epoch.baseline.rendered`** —— 每次渲染从 baseline 出发。
2. **Epoch 内 baseline 不可变** —— 任何 baseline 变更 → 新 Epoch。
3. **压缩只发生在 `SafeProviderTurnBoundary`** —— 由 ADR-0013 step 2（turn-start hook）保证；同时这也复用了 0004 `4c69d98` 修复里 try/finally 收尾的"协议合法性"成果——boundary 等价于"所有 pending tool_call 已 replied"。
4. **Snapshot 可重放出当前 messages 数组** —— rollout JSONL（ADR-0018 候选）replay 时直接喂 Snapshot 即可恢复。

### 与 ADR-0013（Compaction）的对接

压缩流程升级为：

```
turn-start
  └─ compactIfNeeded(currentSnapshot)
       ├─ 估算 token
       ├─ 若超阈值：
       │    1. assertSafeBoundary(currentSnapshot)  // 不变量校验
       │    2. compactedMessages = compact(currentSnapshot, strategy)  // ADR-0013 D1
       │    3. newBaseline = mkBaseline(epoch.baseline.sources)        // sources 不变
       │    4. newEpoch    = { parentEpochId: epoch.id, baseline: newBaseline, reason: 'compaction' }
       │    5. newSnapshot = { epochId: newEpoch.id, messages: [systemFromBaseline, ...compactedMessages] }
       │    6. emit CompactionEvent (ADR-0015 候选 schema)
       └─ 返回 newSnapshot
```

→ **压缩从此变成"epoch 切换"，不是"messages 改写"**。可审计、可回放、可 diff。

### 与 ADR-0017（actor 目录 / L2 ctx）的对接

每个 Epoch 切换都 emit 一条事件到 rollout JSONL：

```jsonc
{ "kind": "epoch.switched", "epochId": "...", "parent": "...", "reason": "compaction", "baseline.hash": "...", "ts": ... }
```

L2 ctx hydrate 时可以回到任意 epoch 边界恢复——这是 RSI 数据底座的最小颗粒度。

## Consequences

**正面**：
- 把"压缩状态转移"从隐式变显式；trajectory 数据可结构化。
- Provider cache anchor 由类型不变量保护（Baseline 不可变），告别"摸不准为什么 cache miss"。
- 为 ADR-0015 / 0017 / 0018 准备好接口面（Epoch / Snapshot 是事件流的基本单位）。
- 与 ADR-0009 Intent Provenance 天然兼容：每条 Snapshot.message 已经带 provenance，跨 Epoch 不丢失。

**负面**：
- 引入 5 个新类型，session.ts 的 `messages: Message[]` 访问点全部要包一层 Snapshot。一次性改动量中等（spiral-3 P1 一周内可完成）。
- BaselineSystemContext.rendered 的字符串复制成本（每个 Epoch 一份完整 system prompt）——可接受（量级 KB，不是 MB）。

## Open Questions

1. `ContextSource.contentHash` 是否要走 ADR-0009 的 SHA-256 watermark 表？——倾向**共用**：减少 hash 实现。落地时确认。
2. Epoch 是否需要 GC？长 session 下 Epoch 链可能很长——本 ADR 保留全部，由 L2 ctx 层（ADR-0017）的 rollout 压缩归档机制处理。
3. `world-state` source kind 与 ADR-0010 World Awareness 的接口要确认对齐——预计在 0010 落地时统一。
4. tool-def 集合变化（skill 热装卸）是否一定切 Epoch？——是。理由：tool-def 在 system 区，cache anchor 受影响。

## 实施计划（spiral-3 P1，紧跟 0013 P0）

| Step | 内容 | 涉及文件 |
|---|---|---|
| 1 | 落 `packages/core/src/context/types.ts` 5 个类型 + 不变量 assertion helpers | new |
| 2 | `session.ts`：把 `messages: Message[]` 替换为 `snapshot: ContextSnapshot`，访问点全部走 helper（保持 API 兼容）| mod |
| 3 | 接入 ADR-0013 的 `compactIfNeeded()`：返回新 Snapshot 而不是修改旧 messages | mod |
| 4 | 测试：`context/epoch.test.ts` 覆盖 baseline 不变性、压缩→新 Epoch、snapshot replay | new |
| 5 | 给 status.md + architecture.md §1.5 加 cross-link | mod |

> 与 0013 联合落地：0013 在 P0 先用 in-memory messages 跑通算法，P1 把内部表示替换为 Epoch/Snapshot。

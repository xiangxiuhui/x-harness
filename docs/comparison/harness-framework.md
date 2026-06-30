# Harness Framework — 双层 × 双轴

> **本文件是 x_harness 全部架构/对照文档共享的术语基准**。
> 顶层 `architecture.md` / `vision.md`、`comparison/` 下所有 ref 文档都引用本文件。
> 修改前请先查所有引用点。

## 0. 一句话

一个 agent harness = **两个独立子系统**（loop / context）× **每个 2 层**（inner/outer ≈ L1/L2）+ **一个可替换的 model**。

```
                                    ┌────────────────────────┐
            inner / L1 ─────────────┤ small context harness   │
loop-harness            消费/写入   │ 单次推理上下文工程       │  ← 压缩策略住在这层
            outer / L2 ─────────────┤ LARGE context harness   │
                        消费/写入   │ 数字分身（历史+技能+记忆+知识+偏好）│
                                    └────────────────────────┘
                                           │
                                    model（可替换黑箱）
```

## 1. 四个象限的定义

| 象限 | 名字 | 内容 | 时间尺度 | 状态 |
|---|---|---|---|---|
| **L1 loop** | inner loop | 单次/几次任务执行；决定何时调工具、何时停 | 秒~分钟 | 无状态（每次都重新启动） |
| **L1 ctx** | small context harness | 单次推理时如何组合 system/sources/history/tools；cache 不变量；tool 协议合法性 | 单次 prompt | 有状态（turn-内） |
| **L2 loop** | outer / RSI loop | 自改进闭环；把 trajectory 喂回去优化技能/规则/模型 | 天~周 | 无状态（每次都重新启动） |
| **L2 ctx** | LARGE context harness | 完整会话历史 + 技能套装 + 记忆 + 知识 + 偏好；**可导出 = 一个可复制的数字分身** | 永久 | 有状态（持久化） |

**关键观察**：
- **Loop 是 function，context 是 data**。Loop 永远不持有状态；状态在 context 里。
- **L2 ctx 与所有 loop 解耦**：同一个数字分身可以挂到 inner loop 跑任务、挂到 outer RSI loop 自改进、甚至挂到外部 harness 实现回放。
- **实验控制变量集 = `L1 loop × L1 ctx × L2 loop × L2 ctx × model`**。

## 2. 接口面

每一层暴露给上层的接口必须极小。具体到 x_harness：

```typescript
// L1 ctx 暴露给 L1 loop
interface SmallContextHarness {
  render(): { system: string; messages: Msg[]; tools: ToolDef[] }
  appendUserMessage(text: string): void
  appendAssistantTurn(turn: AssistantTurn): void
  appendToolResult(result: ToolResult): void
  // 压缩在 render() 内部按需触发；外层 loop 不感知
}

// L2 ctx 暴露给所有 loop（L1 + L2）
interface LargeContextHarness {
  hydrate(opts: { workspaceId?: string; sessionId?: string }): SmallContextSeed
  append(event: RolloutEvent): Promise<void>          // turn-末事件流
  writeMemory(note: MemoryEntry): Promise<void>       // agent 显式 memory 写入
}
```

L2 loop 与 L1 loop **共享** L2 ctx 接口；这是 RSI 闭环成立的物质基础。

## 3. 五个 ref 在四象限的位置

| ref | L1 loop（compaction 实现） | L1 ctx（概念建模） | L2 loop（RSI） | L2 ctx（数字分身） |
|---|---|---|---|---|
| **claude-code** | 不可见（CLI 闭源） | 不可见 | 弱（skills git 管理，人工 curate） | **能力层最佳样板**（plugin 五件套） |
| **codex** | 极强（`compact.rs` 714 行，4 维 taxonomy） | 中（`WorldState`） | 弱（有 `rollout-trace` 数据底座，无反馈环） | **trajectory 最佳样板**（独立 crate + JSONL + CQRS） |
| **hermes-agent** | 极强（`context_compressor.py` 2788 行） | 弱（散在 prompt 里） | **RSI 最佳样板**（`background_review` + `curator` + `skill_bundles` 闭环） | 中（`HERMES_HOME` profile = 整目录分身） |
| **opencode** | 中（246 行，最干净） | **概念建模最佳样板**（`CONTEXT.md`，`ContextEpoch` 一等公民） | ✗ | 中（workspace 一等公民 + SQLite + drizzle migration） |
| **openclaw** | 中（`harness/compaction/` 882 行） | 中（`buildSessionContext`） | 弱（144 extensions 是 plugin curation，非 RSI） | 弱（memory 是黑盒 plugin） |

> **关键发现**：没有任何一家把 L2 ctx 的"能力+经验"打包成一个可移植单元。
> 这是 x_harness 的差异化定位 —— **数字分身 = 单一可 export/fork/diff 的 artifact**。

## 4. x_harness 的当前实现位置（截至 spiral-2 close）

| 象限 | 当前实现 | 缺口 |
|---|---|---|
| L1 loop | `packages/core/src/session.ts` 的 tool-calling loop；**只有 max-rounds bail 兜底**（commit `4c69d98` 协议合法性已补齐） | 无 token 预估、无主动压缩 |
| L1 ctx | 隐式拼装 system + messages + tools；**无 Epoch / Boundary 概念** | 全部缺失 |
| L2 loop | spiral-2 落地了 evolution 采集（"待复盘"按钮） | 反馈环未闭合（采集→未自动化转化） |
| L2 ctx | `~/.x_harness/memory/*.jsonl` + `~/.x_harness/evolution/*.jsonl`；**未抽象为 actor 目录** | 无导出/fork/diff |

详见各 ADR 候选清单（参考 `comparison/large-context-harness.md` §4）。

## 5. 文档引用规则

- **本文件是术语权威**。所有 markdown 谈到 "small CH / large CH / L1 loop / L2 loop / 数字分身" 的，统一引用本文件。
- 修改框架本身需要走 ADR（候选 ADR-00xx "Harness 框架"）。
- 修改某象限内部细节（比如 L1 ctx 的具体 schema）不需要改本文件。

---

*spiral-2 close 后立项；本文件随 `large-context-harness.md` 和 `cross-analysis-context-management.md` 一起作为 spiral-3 起步的概念基线。*

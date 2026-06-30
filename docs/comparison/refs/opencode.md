# opencode (anomalyco/opencode) — comparison notes

> upstream: <https://github.com/anomalyco/opencode>
> pinned branch: `dev` · current SHA: `90f05762`
> entry doc: `refs/opencode/CONTEXT.md` (one of the densest "what is an agent runtime" specs in the whole refs/ library — read it before touching this code)
> **主战场象限：L1 ctx 概念建模（最佳样板）+ L1 loop compaction（最干净）**

## 一句话定位

**典型 context-harness：把 session/context 当成一个有形式语义的类型系统来设计**，
并据此提供完整的自动 compaction、provider-cache-aware 的 baseline 重建、以及把"模型"当作可热切换变量的能力。
是我们五个 ref 里 *唯一* 把 context-management 显式建模成可推理对象的项目。

## 四象限映射（Harness 框架）

> 框架定义见 [`harness-framework.md`](./harness-framework.md)。

| 象限 | 评级 | 关键文件 / 借鉴点 |
|---|---|---|
| **L1 loop**（compaction） | ★★ | `packages/core/src/session/compaction.ts`（246 行，**最干净 + <300 LOC 量级唯一概念完整**）；`compactIfNeeded` 25 行预防式触发 |
| **L1 ctx**（small CH 建模） | ★★★ **最佳样板** | **`refs/opencode/CONTEXT.md`** 一篇 = 完整类型化术语：`ContextEpoch` / `BaselineSystemContext` / `ContextSnapshot` / `SafeProviderTurnBoundary` / `AdmittedPrompt` / `PromptPromotion` / `MidConversationSystemMessage` / `ManagedToolOutputFile` / `NativeContinuationMetadata` —— 五个 ref 里**唯一把 context-management 显式建模成可推理对象**的 |
| **L2 loop**（RSI） | ✗ | 无反馈环 |
| **L2 ctx**（数字分身） | ★★ | `packages/core/src/database/`：SQLite + drizzle migration timeline（22+ migration）+ **workspace 一等公民** + `ManagedToolOutputFile` 大输出物化为可寻址文件 |

**opencode 的主战场是 L1 ctx 概念建模**——它把整个上下文管理从"经验主义"提升到"形式化协议"。
这正是 x_harness spiral-3 P1 要落地的层级。

## 仓库形态

- 单仓 30 packages（bun + Effect-TS），核心是 `packages/core/src/session/`：
  - `context-epoch.ts` — Context Epoch 类型与状态
  - `compaction.ts` — 自动/手动 compaction 主体（246 行，含 prompt 模板）
  - `prompt.ts` / `history.ts` / `projector.ts` — 渲染管线
  - `run-coordinator.ts` / `runner/` — turn 调度
- `packages/llm`、`packages/protocol`、`packages/sdk-next` 把模型/SDK/IR 抽象彻底分层
- `CONTEXT.md` 是同行评议级别的"协议文档"，里面所有大写术语都是代码里实际存在的类型/常量

## ★ 我们要吸收的（按重要性排序）

### 1. **Context Epoch** 作为压缩的一等概念 — **ADOPT**

每次 compaction 不是"原地改 messages"，而是**开启新 Epoch**：
- 一个 Epoch 拥有不可变的 `Baseline System Context`（这是 provider-cache 的锚点）
- 旧 Epoch 的 `Mid-Conversation System Messages` 保留在 durable 历史中作为 audit trail，但**不再投影进活跃 model history**
- model/provider 切换 *保留* 当前 Epoch；只有 compaction 才换 Epoch

> 引用 CONTEXT.md：*"Completed compaction starts a new Context Epoch with a freshly rendered Baseline System Context, folding the current complete System Context into a fresh baseline and removing earlier Mid-Conversation System Messages from active model history."*

**意义**：这是把"压缩 = 信息丢失"重塑成"压缩 = 受控的状态转移"。
我们现在的 max-rounds-bail 是"信息丢失"的版本，没有任何状态记录。下一步直接吸收 Epoch。

### 2. **Safe Provider-Turn Boundary** — **ADOPT**

> Compaction/prompt promotion 等所有"扰动 provider cache"的操作只能在 Safe Provider-Turn Boundary 触发。
> 这个边界就是 "上一次 assistant 完整应答之后、下一次 user/tool 进入之前"。

我们之前那个 max-rounds bug 的根因就是**在不安全的边界中断了 turn**（assistant 发了 tool_calls 但没有对应 tool replies）。
显式建模这个边界，可以把 "tool 协议合法性" 从 try/finally 兜底升格为类型不变量。

### 3. **`compactIfNeeded` 触发模型 — TRACK**

`packages/core/src/session/compaction.ts:230`：
```ts
// 每次发请求前：估算 system+messages+tools 的 token，超过 context - max(output, buffer) 才触发
if (estimate(request) <= context - max(output, buffer)) return false
return compactAfterOverflow(input)
```
- 默认 `buffer = 20_000`、`keep tokens = 8_000`、`TOOL_OUTPUT_MAX_CHARS = 2_000`
- summary prompt 是固定模板（Goal / Constraints / Progress / Decisions / Next Steps / Critical Context / Relevant Files）—— 模板本身值得抄

### 4. **Managed Tool Output File** — **ADOPT**

> 如果一次 tool 输出超过 session history 承受的体量，opencode 把整个 output 物化到磁盘文件，
> 在 session 中只保留一个引用 + 截断摘要，但模型本轮看到的是完整内容。

我们 P0 里的"per-tool byte cap"只是"截断丢弃"，opencode 的做法是"截断 + 保留可寻址原文"，
完全可以直接接入我们 `appendToolResult` 的位置。

### 5. **Native Continuation Metadata 的小心翼翼处理** — **DEFER**（先记，不学）

provider-specific 的 continuation token 只在 *精确同 provider+model* 时投影回 history；
model 切换后视作不存在。我们目前不做多 provider，先记下来。

## 我们明确*不要*的

- **Effect-TS 编程模型**：opencode 全栈 Effect 化（`Effect.fn`、`Stream`、`Schema.Class`）。
  这是一个非常重的范式选择，对我们 spiral-3 的"先把压缩做对"目标没有杠杆。
  *但是*：Effect-TS 提供的 "Scope-bounded Embedded server" 模式（关闭 Scope 自动释放 in-process server 资源、DB、fibers）值得我们将来做 RSI loop 沙箱时回头看。
- **SDK Contract IR / 双 emitter（Promise + Effect）**：完全是给"对外暴露 SDK 的产品"准备的。我们目前是 CLI/SDK 自用。
- **30 packages 的拆分粒度**：好的 reference，糟糕的 starting structure。

## 上游需要持续跟踪

- `compaction.ts` 的 `SUMMARY_TEMPLATE` —— 上游一改我们就同步评估
- `context-epoch.ts` 的状态机演化
- `Managed Tool Output File` 的存储格式（目前是文件，可能会演化成 CAS）

## ADR 候选

- **ADR-00xx Context-Epoch model** —— 直接把 opencode 的 Epoch 概念落到 `packages/core/src/session.ts`，
  并把现有的 max-rounds-bail 改造为 "Epoch 边界 + Baseline 重建"
- **ADR-00xx Managed Tool Output** —— `appendToolResult` 大输出落盘策略

## 与其他 ref 的差异坐标

| 维度 | opencode | 其他 4 个 ref |
|---|---|---|
| 是否有 compaction 实现 | ✓（246 行，生产代码） | codex ✓ / hermes ✓ / openclaw ✓ / claude-code ✗ |
| 是否把 "Context" 建模成类型 | ✓（CONTEXT.md 定义 20+ 类型） | 都没有 |
| 是否区分 Epoch | ✓（一等概念） | codex 有 "PrefixCompaction" 接近但更隐性 |
| Provider-cache 不变性 | 显式约定为 Baseline 锚点 | hermes 文档说"prompt cache 不可侵犯"但没建模 |

详见 `cross-analysis-context-management.md`。

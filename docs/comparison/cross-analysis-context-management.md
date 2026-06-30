# Cross-analysis: 5 reference agents 的 context management 与 compression 策略

> 出发点（用户提出的概念框架）：
>
> 这些参考都是某种 **harness**。**loop harness 和 context harness 都是双层的**：
>
> - **loop harness**
>   - *L1 inner loop*：一次或几次任务执行，主要管"上下文的进进出出"——这就是**压缩策略要解决的层**
>   - *L2 outer / RSI loop*：自改进 loop，把每一次任务的轨迹喂回去优化技能/规则/模型
> - **context harness**
>   - *L1 small CH*：单次推理时"system / sources / history / tools" 是如何组合、缓存、版本化的（**本文档主要对照的就是这一层**）
>   - *L2 large CH*：RSI loop 的输入——完整会话历史 + 技能套装 + 记忆 + 知识 + 偏好；可导出 = 一个**可复制的数字分身**，且与任意 loop 解耦
> - **model**：可替换的黑箱
>
> 实验的控制变量 = **L1 loop × L1 ctx × L2 loop × L2 ctx × model**。
>
> 本文档对照 **L1 loop + L1 ctx**（小 CH 上的压缩策略）。
> **L2 large CH** 是 x_harness RSI 螺旋的核心交付物，单独有一份设计：
> → **[`large-context-harness.md`](./large-context-harness.md)**

---

## 0. TL;DR — 五个项目的画像

| ref | 类型 | inner-loop compaction | outer RSI loop | context-harness 形式化 | 我们怎么用 |
|---|---|---|---|---|---|
| **claude-code** | 5-piece plugin（commands / agents / skills / hooks / .mcp.json） | ✗（只有 `/compact` 斜杠命令文档，无源码） | 弱（skills 作为人工 curated 资产） | ✗ | **plugin manifest 形态借用** |
| **codex** | Rust + TS 双栈，工业级 | ✓ 极强——`compact.rs` 714 行，多策略多触发器 | ✗ | 中（`WorldState` + `rollout` 记录） | **抄 taxonomy（Trigger/Reason/Phase/Strategy）** |
| **hermes-agent** | Python 单体，最大 RSI 野心 | ✓ 强——`context_compressor.py` 2788 行 | ✓ 强——`background_review` + `curator` + skill bundle 闭环 | 弱（散在 prompt 里） | **抄 self-improvement loop 的解剖结构** |
| **opencode** | TS + Effect，30 packages | ✓ 中（246 行核心） + **Context Epoch 模型** | ✗ | ✓ **极强——`CONTEXT.md` 把每个概念都形式化** | **抄 Context Epoch & Safe Boundary** |
| **openclaw** | TS，22 core + 144 extensions | ✓ 中（882 行 `compaction/`） | 弱（extension 体系是 plugin-curation 而非 RSI） | 中 | **抄 `tool-call-repair` package（与我们刚修的 bug 对位）** |

> ✗ = 没有 / 弱 / 仅文档；✓ = 有可观的代码实现。

---

## 1. 轴一：inner-loop / context management — 压缩策略横评

这是用户问"max rounds 触发后当前的会话压缩策略是什么"的直接对应轴。

### 1.1 触发器（**when** to compact）

| ref | 触发器 | 评价 |
|---|---|---|
| x_harness (今) | **只有 max-rounds bail**——超过 `maxToolRounds` 时直接断 turn（4c69d98 之后补了协议兜底） | 极简，没有 token 估算 |
| opencode | `compactIfNeeded`：`estimate(req) > context - max(output, buffer)` 时触发，buffer 默认 20k | **预防式**，干净 |
| codex | 四种 Reason：`UserRequested` / `ContextLimit` / `ModelDownshift` / `CompHashChanged`；两种 Trigger：`Manual` / `Auto` | **品类最完整**，包含 model 切换驱动 |
| hermes | `should_compress(prompt_tokens)`：阈值由 model 上限动态算，含 "preflight token 估算 vs 真实 usage" 校准 | **最精细**，含失败冷却（cooldown） |
| openclaw | 分支总结（branch summarization）+ 主线 compaction | 中规中矩 |
| claude-code | 用户键入 `/compact` 才触发 | 完全手动 |

> **结论**：x_harness 目前只在最差档位。即便不做高级压缩，**先加入"预估 token + 超阈值触发"这一步（参考 opencode 25 行实现）就能跳两个档位**。

### 1.2 策略（**how** to compact）

| ref | 策略 | 关键创新 |
|---|---|---|
| opencode | 单一：**head→summary + recent→keep**，模板固定（Goal/Progress/Decisions/Next Steps/Critical Context/Relevant Files） | 模板里把"已完成 / 进行中 / 阻塞"分开，避免 LLM 把历史当作 active instructions |
| codex | 两种 Strategy：`Memento` / `PrefixCompaction`；三种 Phase：`StandaloneTurn` / `PreTurn` / `MidTurn`（mid-turn 时必须把 initial context 注入到 last user msg 之上） | **Phase 概念**：承认压缩可能发生在 turn 中段，需要不同的"初始上下文重注入"策略 |
| hermes | 三段式：head 保护 + 中段总结 + tail 按 token-budget 保护；并且**先做 tool-output pruning 预处理**再喂给 summarizer | "filter-safe summarizer preamble"——把历史明确标记为 *source material* 而不是 *instructions*，避免 LLM 误执行历史指令 |
| openclaw | branch + main 两路总结，含 trailing-tool-result 处理（专门有 test） | branch summarization 是 sub-agent 思路的延伸 |
| claude-code | 不可见（CLI 闭源） | — |

> **结论**：
> - 模板抄 opencode（最干净）；
> - tool-result 预处理抄 hermes（最便宜的优化）；
> - phase 概念抄 codex（决定 mid-turn 触发时如何保留 last user message）；
> - trailing-tool-result 边界条件抄 openclaw 的测试。

### 1.3 不变量（**what must survive**）

| ref | 关键不变量 | 我们的对照 |
|---|---|---|
| opencode | **Provider cache anchor**：Baseline System Context 一旦渲染完就 durable；compaction 是"允许打破 cache 的"显式动作 | 我们没有 cache 概念，因此这条直接降级为 "compaction 前后 system prompt 要可重建" |
| hermes | **"prompt cache 神圣不可侵犯"**（README）—— 任何修改都先看是否会让上游 prompt cache 失效 | 同上 |
| codex | **`compaction_initial_context` 的注入位置**：mid-turn 时必须放在 last user message 上面（注释里有 6 行解释为什么） | 我们没遇到，但 spiral-3 加入这条很值得 |
| opencode | **Safe Provider-Turn Boundary**：所有扰动 provider 状态的动作只能在 turn-边界发生 | **正是我们 max-rounds bug 的根因——已经修了，下一步应该形式化** |
| openclaw | **trailing tool result** 必须有对应 assistant tool_call | 我们最近修的就是这条 |

### 1.4 实现重量对比

| ref | LOC（压缩相关） | 占核心代码比 |
|---|---|---|
| x_harness (今) | ~30（max-rounds bail + repliedIds） | 极小 |
| opencode | 246（`session/compaction.ts`） | 中 |
| openclaw | 882（`harness/compaction/*.ts`） | 中 |
| codex | 714 + 90 + 468 + 227 = **1499** | 大 |
| hermes | **2788**（单文件） | 极大 |

> 重量本身不是优点。但 **<300 LOC 是 spiral-3 的目标上限**，opencode 是唯一在这个量级里"概念完整"的，所以参考价值最高。

---

## 2. 轴二：outer RSI loop — 自改进 loop 横评

| ref | RSI 机制 | 形态 |
|---|---|---|
| **hermes-agent** | 最强：`background_review.py` 在 turn 结束后异步分析整段 trajectory；`curator.py` 维护人工/agent 共同 curate 的技能库；`skill_bundles.py` 把"会用什么技能"绑定到 session | 真闭环：trajectory → review → skill update → 下次 session 自动加载 |
| **claude-code** | 弱：skills 是 git-managed markdown 资产，靠人工 curate；hooks 是被动 trigger | 人工 RSI |
| **codex** | 无显式 RSI；但有 `rollout-trace`（详细 trajectory 记录）作为基础设施 | 只有"轨迹"，没有"反馈"——但 trace schema 是最好的 RSI 数据底座 |
| **opencode** | 无 | — |
| **openclaw** | 144 extensions 体系是 plugin curation，不是 RSI | 算 plugin marketplace |

### x_harness 自身位置

- 我们已经在 spiral-2 加了 `e2e-*.ts` 回归测试和 ADR 决策记录；
- `mem-bank/` 已经是事实上的 trajectory 仓库（虽然是用来给 agent 拉 context 的）；
- **下一步 RSI 候选**：
  - 借 codex 的 `rollout-trace` schema 来标准化我们的 turn 轨迹（不抄 Rust 代码，只抄 schema）；
  - 借 hermes 的 `background_review` 思路：每个 session 结束时跑一个轻量 review job 把 "本次发生的 max-rounds 触发 / 工具失败 / 协议违规" 沉淀到 ADR 候选；
  - 不做 hermes 的 `skill_bundles` —— skill curation 已经走 plugin manifest 路（参考 claude-code），不要双轨。

---

## 3. 轴三：context harness — 上下文渲染管线横评

"context harness" = 给一次推理拼装 `system / context-sources / history / tools` 的那套机器。

| ref | 拼装单元 | 缓存约定 | 版本化 |
|---|---|---|---|
| **opencode** | `Context Source` × `Context Epoch` × `Baseline System Context` × `Mid-Conversation System Message` × `Context Snapshot` | Baseline = provider cache anchor，显式约定 | Epoch 是版本，Snapshot 是该 Epoch 内的具体取值 |
| **hermes** | `prompt_builder.py` 拼装；含"sticky context"概念 | "prompt cache 神圣不可侵犯" | 隐性 |
| **codex** | `WorldState`（系统状态快照）+ `TurnContext` | 通过 `responses_metadata` 关联 turn | rollout 提供 replay |
| **claude-code** | plugin 五件套：`commands/skills/agents/hooks/.mcp.json` 进 system 区 | 不可见 | 靠 git 版本化 |
| **openclaw** | `harness/session/session.ts` 的 `buildSessionContext` | 中规中矩 | 弱 |

### 给 x_harness 的具体借鉴清单

1. **从 opencode 抄 5 个核心概念到我们的类型系统**（不抄实现，只抄类型 + 注释）：
   - `ContextSource` — 一个 source 是什么（不只是 "system prompt"）
   - `ContextEpoch` — 压缩在哪个版本边界发生
   - `BaselineSystemContext` — 此 Epoch 的不可变锚点
   - `ContextSnapshot` — 此 Epoch 内的具体取值
   - `SafeProviderTurnBoundary` — 何时可以扰动状态
   ➜ 落到 `packages/core/src/context/types.ts`（新文件）
2. **从 codex 抄 `WorldState`** 的"系统瞬时状态快照"思路 —— 作为 trajectory 元数据
3. **claude-code 五件套** 维持现状（已经吸收过）

---

## 4. 轴四：model 抽象 —（最不重要，简单过一下）

| ref | model 抽象 | provider 中立 |
|---|---|---|
| opencode | `@opencode-ai/llm` package；`Model` / `LLMRequest` / `LLMEvent` / `Generation Controls` 分层 | ✓ 多 provider |
| codex | `ModelProviderInfo` + `responses_metadata` 抽象 | ✓ |
| hermes | `auxiliary_client.py` 把"压缩用的便宜模型"独立出来 | ✓（有一个非常值得抄的 idea：**用 cheap aux model 做 compaction**） |
| openclaw | `llm-core` package | ✓ |
| claude-code | Anthropic 专用 | ✗ |

> **抄 hermes 的 auxiliary model 概念**：compaction 不需要主模型，配置上区分 "main / aux" 后压缩成本掉一个数量级。

---

## 5. 给 spiral-3 的具体执行清单（按收益/成本比排序）

| 行动 | 收益 | 成本 | 何时做 |
|---|---|---|---|
| **A. token 预估 + 超阈值触发**（抄 opencode 25 行） | 直接消灭"max-rounds 才反应"的延迟问题 | XS | spiral-3 P0 |
| **B. tool-output 截断 + 落盘可寻址**（opencode `Managed Tool Output File` + 现有 P0） | 大输出不再炸 history | S | spiral-3 P0 |
| **C. 引入 `ContextEpoch` 类型**（5 个概念到 `context/types.ts`，opencode 抄过来） | 让压缩从"丢弃" 变成 "状态转移"，可审计、可回放 | M | spiral-3 P1 |
| **D. head/recent 模板化 summarize**（opencode 模板 + hermes filter-safe preamble） | 给 C 提供具体的 compaction 算法 | M | spiral-3 P1 |
| **E. CompactionEvent taxonomy**（抄 codex `Trigger`/`Reason`/`Phase`/`Strategy` 枚举） | trajectory 数据有结构，喂得动后续 RSI | S | spiral-3 P1 |
| **F. auxiliary model 配置位**（抄 hermes） | 压缩成本 ×10 ↓ | XS | spiral-3 P2 |
| **G. background review job**（抄 hermes 思路，不抄代码） | RSI 起步 | L | spiral-4 候选 |
| **H. rollout-trace schema 标准化**（抄 codex schema） | RSI 数据底座 | M | spiral-4 候选 |

P0 / P1 = spiral-3 内做；P2 = spiral-3 末尾；spiral-4 = 之后。

---

## 6. 共同观察到的设计哲学（去重后）

1. **压缩不是 emergency response，是常态调度**。五个 ref 里只有我们今天的实现把它当 emergency。
2. **历史在 audit log 里永远是完整的，活跃 context 是它的一个 projection**——opencode 最显式，hermes/codex 实质上也是这么做的。
3. **summarizer preamble 必须让模型知道历史是 source material，不是 instructions**（hermes 文档明写，opencode 模板里"Historical (reference-only)"措辞实现同一目的）。
4. **provider cache 是一等公民**——hermes README 第一条就是"prompt cache 神圣不可侵犯"；opencode 把 Baseline 显式建模为 cache anchor。
5. **用便宜模型做压缩**——hermes 明确，其他 ref 隐含。
6. **tool-call/tool-result 协议合法性是不变量，不是 try/catch**——openclaw 单独有 `tool-call-repair` package；opencode 用 Safe Boundary；我们最近的 fix 是用 try/finally + repliedIds。下一步应升级到类型不变量。

---

## 7. 我们明确*不*要的（避免被参考项目带偏）

- ❌ 不学 hermes 的 2788 行单文件 compressor（可读性灾难）
- ❌ 不学 opencode 的 Effect-TS 全栈范式（学习曲线 ROI 太低）
- ❌ 不学 codex 的 1500 行 compaction（工业级体量，spiral-3 抗不住）
- ❌ 不学 openclaw 的 144 extensions（plugin 体系我们已经选了 claude-code 风格的 5 件套）
- ❌ 不学 claude-code 的"压缩只能用户手动 `/compact`"（spiral-3 的核心就是干掉这件事）

---

## 附：术语对照表

| x_harness 当前 | opencode 术语 | codex 术语 | hermes 术语 |
|---|---|---|---|
| (无) | Context Epoch | (隐性，PrefixCompaction 边界) | (无) |
| (无) | Baseline System Context | initial context | system_prompt（拼装产物） |
| (无) | Safe Provider-Turn Boundary | turn boundary | turn 边界（隐性） |
| `appendToolResult` 现场 | Managed Tool Output File | (无) | tool-output pruning |
| max-rounds bail | `compactIfNeeded` | `compact` (Auto, ContextLimit) | `should_compress` |
| (无，try/finally 兜底) | tool-call/result 配对（Safe Boundary 副产品） | (无) | (无) |
| (我们的 ADR / mem-bank) | — | rollout-trace | background_review trajectory |

---

*最后维护：与 commit `6be0d9e` 同步（5 个 ref 都已 fetch 到 upstream HEAD）*

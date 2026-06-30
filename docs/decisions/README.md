# Architecture Decision Records

> 每个重大决策都落 ADR；无 ADR 不决策。
>
> **本 README 按 [Harness 框架](../comparison/harness-framework.md)（双层 × 双轴）组织 ADR**，让"这个决策落在哪一格"一目了然。

## 索引（按 Harness 象限）

### Cross-cutting · 基础设施 / 边界

| # | 标题 | 状态 |
|---|------|------|
| [0001](0001-ts-rust-bridge.md) | TS↔Rust 桥 | Accepted |
| [0002](0002-actor-tag-macos.md) | macOS Actor 标签落地方案 | Accepted (MVP) / Upgrade Path Reserved |
| [0004](0004-ui-form-factor-mvp.md) | UI 第一形态：本地 Web，预留 Tauri 升级 | Accepted |
| [0011](0011-surface-parity.md) | Surface Parity (CLI ↔ Web ↔ future) | Accepted |

### Model · 可替换黑箱

| # | 标题 | 状态 |
|---|------|------|
| [0003](0003-first-provider.md) | 第一螺旋 Model Provider：DeepSeek | Accepted |

### L1 loop · inner tool-calling loop

| # | 标题 | 状态 |
|---|------|------|
| [0005](0005-danger-rules.md) | 危险操作规则集（Class A 人类账号 / Class B 自存续） | Accepted |
| [0009](0009-intent-provenance.md) | Intent Provenance & AI-touch watermark | Accepted |
| **[0013](0013-compaction-strategy.md)** | **Compaction Strategy（预防式压缩 + taxonomy + auxiliary model）** | **Proposed** |

### L1 ctx · small context harness（单次推理上下文工程）

| # | 标题 | 状态 |
|---|------|------|
| **[0014](0014-context-epoch-type-system.md)** | **Context Epoch / Baseline / Snapshot / Safe Boundary 类型系统**（抄 opencode 5 概念） | **Proposed** |

### L2 loop · outer RSI loop

| # | 标题 | 状态 |
|---|------|------|
| [0012](0012-evolution-capture.md) | Evolution capture schema（"待复盘"按钮采集） | Accepted |

### L2 ctx · LARGE context harness（数字分身）

| # | 标题 | 状态 |
|---|------|------|
| [0006](0006-skill-plugin-form.md) | Skill / Plugin 形态对齐 claude-code 五件套（能力层） | Accepted |
| [0007](0007-skill-runtime-form.md) | Skill 脚本运行时形态（Node spawn，按扩展名分发） | **Superseded by 0008** (mechanism retained as opt-in) |
| [0008](0008-skill-loading-per-agentskills.md) | Skill loading per agentskills.io（skill = doc, not tool） | Accepted |
| [0010](0010-world-awareness.md) | World Awareness Strategy (Patrol + Territory) | Accepted (schema); impl = spiral 2/2b |

### 候选 ADR（spiral-3 起待写）

> 来源：[`comparison/cross-analysis-context-management.md`](../comparison/cross-analysis-context-management.md) §5 + [`comparison/large-context-harness.md`](../comparison/large-context-harness.md) §4

| 候选 # | 标题 | 象限 | 触发 spiral |
|---|---|---|---|
| 0015 | CompactionEvent taxonomy（codex 4 维：Trigger × Reason × Phase × Strategy） | L1 loop | spiral-3 P1 |
| 0016 | Auxiliary model 配置位（cheap aux model for compaction） | Model | spiral-3 P2 |
| 0017 | Actor 目录布局（`~/.x_harness/actors/<id>/`，三动词接口 hydrate/append/writeMemory） | L2 ctx | spiral-3 |
| 0018 | Rollout JSONL schema 标准化（抄 codex `rollout-trace`） | L2 ctx | spiral-3 |
| 0019 | Background review job（RSI 第一步，trajectory → ADR 候选） | L2 loop | spiral-4 |

## ADR 模板

```md
# ADR NNNN — <title>

状态：Proposed | Accepted | Superseded by NNNN | Deprecated
日期：YYYY-MM-DD
象限：Cross-cutting | Model | L1 loop | L1 ctx | L2 loop | L2 ctx

## Context
为什么需要这个决策？（必要时引用 comparison 横评和 harness-framework）

## Options
列出所有候选，给出对比。

## Decision
明确的取舍。

## Consequences
做了这个决定之后会发生什么？

## Open Questions
留给未来或落地时再答的问题。
```

## 何时该写 ADR

- 涉及多个 package / crate 的边界
- 选择第三方依赖（语言 / 框架 / 协议 / 模型）
- 对外 API 形状
- 安全 / 权限 / 审计
- 数据格式（持久化、IPC）
- **Harness 框架四象限内的任何"结构性"改动**（接口面、不变量、协议）

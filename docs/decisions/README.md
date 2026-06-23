# Architecture Decision Records

> 每个重大决策都落 ADR；无 ADR 不决策。

## 索引

| # | 标题 | 状态 |
|---|------|------|
| [0001](0001-ts-rust-bridge.md) | TS↔Rust 桥 | Accepted |
| [0002](0002-actor-tag-macos.md) | macOS Actor 标签落地方案 | Accepted (MVP) / Upgrade Path Reserved |
| [0003](0003-first-provider.md) | 第一螺旋 Model Provider：DeepSeek | Accepted |
| [0004](0004-ui-form-factor-mvp.md) | UI 第一形态：本地 Web，预留 Tauri 升级 | Accepted |
| [0005](0005-danger-rules.md) | 危险操作规则集（Class A 人类账号 / Class B 自存续） | Accepted |
| [0006](0006-skill-plugin-form.md) | Skill / Plugin 形态对齐 claude-code 五件套 | Accepted |

## ADR 模板

```md
# ADR NNNN — <title>

状态：Proposed | Accepted | Superseded by NNNN | Deprecated
日期：YYYY-MM-DD

## Context
为什么需要这个决策？

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

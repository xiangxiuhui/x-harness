# 参考项目笔记

> 本目录是 5 个参考项目的独立笔记，每份按统一结构组织。
> **核心交付文档**（框架、L1 横评、L2 ctx 设计）在父目录 [`../`](../) 下。

## 阅读入口

| ref | 主战场象限 | 一句话 |
|---|---|---|
| [hermes.md](./hermes.md) | L2 loop ★★★ + L1 loop ★★★ | 五个 ref 里唯一把 RSI 闭环跑通的 |
| [openclaw.md](./openclaw.md) | 工程结构样板 + L1 loop ★★ | 22 packages + 144 extensions 的 TS 单体范式 |
| [claude-code.md](./claude-code.md) | L2 ctx 能力层 ★★★ | plugin 五件套（commands/agents/skills/hooks/.mcp.json） |
| [codex.md](./codex.md) | L2 ctx trajectory ★★★ + L1 loop ★★★ | 独立 `rollout` crate + 4 维 compaction taxonomy + Rust 内核样板 |
| [opencode.md](./opencode.md) | L1 ctx 建模 ★★★ + L1 loop ★★ | 唯一把 context-management 显式建模成可推理对象 |

## 统一结构

每份文档按以下顺序组织：

1. **一句话定位** + 主战场象限
2. **仓库形态速览**（目录树）
3. **四象限映射**（Harness 框架）
4. **★ 我们要吸收的**（带 ADOPT / TRACK / DEFER / EVAL 状态）
5. **我们明确不要的**
6. **上游需要持续跟踪的特性**
7. **提取的 ADR 候选**

## 维护节奏

- 每个螺旋开始前 → `./scripts/refs.sh pull`
- 扫上游 release notes → 把值得吸收的进展按四象限模板增量写入对应文档
- 不直接把上游代码 copy 进 `packages/`，所有借鉴都要重写

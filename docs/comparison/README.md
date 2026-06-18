# 参考项目对照框架

> 我们不抄任何一家的整体设计，但每一家都有值得吸收的局部。
> 本目录用于把"借鉴点"显式记录下来，方便后续追踪上游更新。

## 4 个参考项目

| Repo | 主语言 | 当前借鉴重点（待详写） |
|------|--------|-----------------------|
| [hermes-agent](https://github.com/NousResearch/hermes-agent) | Python | reasoning trace、多步推理调度 |
| [openclaw](https://github.com/openclaw/openclaw) | 待核实 | 待 clone 后核实 |
| [claude-code](https://github.com/anthropics/claude-code) | TypeScript | tool 协议、permission 模型、skill frontmatter、TS 外壳工程化 |
| [codex](https://github.com/openai/codex) | Rust + TS | Rust 内核、sandbox（seatbelt/landlock/AppContainer）、多 provider |

## 借鉴维度（每个参考项目都填这张表）

每个参考项目在本目录下建一个文件：`hermes.md` / `openclaw.md` / `claude-code.md` / `codex.md`。

模板：

```md
# <Project>

- 上游版本（commit）：<sha> @ <date>
- 仓库定位：
- 与 x_harness 的关系：

## 我们要吸收的

| 特性 | 在它那里的实现 | 在 x_harness 里映射到哪 | 状态 |
|------|----------------|------------------------|------|
| ...  | ...            | ...                    | TODO/DONE |

## 我们不要的（明确反目标）

- ...

## 上游需要持续跟踪的特性

- ...

## 提取的 ADR

- ...
```

## 维护节奏

- 每个螺旋开始前，跑一次 `git submodule update --remote`，扫一眼上游 release notes。
- 把值得吸收的进展按上面模板增量写入对应文件。
- 不直接把上游代码 copy 进 packages/，所有借鉴都要重写或重新设计。

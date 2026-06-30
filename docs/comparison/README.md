# 参考项目对照 — 按 Harness 框架（双层 × 双轴）组织

> **概念基线**：[`harness-framework.md`](./harness-framework.md) — 修改框架须走 ADR。
>
> 我们不抄任何一家的整体设计，但每一家在某些象限里都有最佳样板。本目录的组织方式：
> **先按 4 个象限分桶**（L1 loop / L1 ctx / L2 loop / L2 ctx），**再回到具体 ref 文档查细节**。

---

## 1. 五个参考项目（锁定版本）

> 锁定版本与 `refs/` 子模块同步。日常用 `./scripts/refs.sh list` / `./scripts/refs.sh pull` 维护。

| Repo | 主语言 | 锁定版本 | 主战场象限 |
|------|--------|----------|------------|
| [hermes-agent](https://github.com/NousResearch/hermes-agent) | Python | `fa3ab2ffd0` (v2026.6.19-1441) | L2 loop（最强 RSI）+ L1 loop（最重 compaction） |
| [openclaw](https://github.com/openclaw/openclaw) | TypeScript | `3d4b7cade9` (v2026.4.19-beta.2-30364) | L1 loop（`tool-call-repair`）+ 工程结构样板 |
| [claude-code](https://github.com/anthropics/claude-code) | TypeScript（仅插件） | `c80896ca84` (v2.1.196) | **L2 ctx 能力层**（plugin 五件套） |
| [codex](https://github.com/openai/codex) | Rust + TS | `cfead68e5d` (codex-zsh-v0.1.0-64) | **L2 ctx trajectory**（rollout 独立 crate）+ L1 loop（最完整 taxonomy） |
| [opencode](https://github.com/anomalyco/opencode) | TS + Effect | `90f0576222` (dev) | **L1 ctx 概念建模**（`ContextEpoch` / `SafeProviderTurnBoundary`） |

---

## 2. Harness 框架（双层 × 双轴）—— 本目录组织主轴

```
                            inner / L1                      outer / L2
                            ─────────────                   ─────────────
                            单/几次任务                       自改进闭环
                            ↕                               ↕
loop-harness                L1 loop                          L2 loop
                            （tool-calling 循环）              （RSI loop）
                            ─────────────                   ─────────────
context-harness             L1 ctx                           L2 ctx
                            small CH                         LARGE CH = 数字分身
                            （单次推理上下文工程）              （历史+技能+记忆+知识+偏好）

                            model（可替换黑箱）
```

**实验控制变量集 = `L1 loop × L1 ctx × L2 loop × L2 ctx × model`**。

详细定义、接口面、五个 ref 在四象限的位置：→ [`harness-framework.md`](./harness-framework.md)。

---

## 3. 四象限速查 — 每个象限的最佳样板和 x_harness 的吸收策略

### 3.1 L1 loop · inner loop（tool-calling 循环）

> **核心问题**：何时停？何时压？工具协议合法性？

| ref | 关键贡献 | LOC | 状态 |
|---|---|---|---|
| **codex** | **CompactionEvent taxonomy**（Trigger / Reason / Phase / Strategy 四维枚举） | 1499 | ★ 抄 taxonomy 不抄实现 |
| **hermes-agent** | **`context_compressor.py`**：head/tail 保护 + 中段总结 + tool-output 预处理 + 失败冷却 | 2788 | ★ 抄 filter-safe preamble 模板 |
| **opencode** | **`compactIfNeeded` 25 行预防式触发**；最干净的实现 | 246 | ★★ 直接抄 |
| **openclaw** | **`tool-call-repair` package**：与我们 max-rounds bug 同位 | 882 | ★ 抄边界条件测试 |
| **claude-code** | `/compact` 斜杠命令（用户手动）| 不可见 | ✗ 反例：纯人工不可取 |

→ 详细分析：[`cross-analysis-context-management.md`](./cross-analysis-context-management.md) §1

### 3.2 L1 ctx · small context harness（单次推理上下文工程）

> **核心问题**：system / sources / history / tools 怎么组合？cache 不变量怎么守？turn 边界在哪？

| ref | 关键贡献 | 状态 |
|---|---|---|
| **opencode** | **`CONTEXT.md`**：完整类型化术语（`ContextEpoch` / `BaselineSystemContext` / `SafeProviderTurnBoundary` / `ContextSnapshot` / `ManagedToolOutputFile` / `MidConversationSystemMessage`） | ★★★ 全套搬过来 |
| **codex** | `WorldState` + `responses_metadata` | ★ 借"瞬时状态快照"思路 |
| **hermes-agent** | "**prompt cache 神圣不可侵犯**"（README 第一条） | ★ 抄不变量原则 |
| **openclaw** | `buildSessionContext` | 中 |
| **claude-code** | plugin 五件套进入 system 区 | ★（与 L2 ctx 联动） |

→ 详细分析：[`cross-analysis-context-management.md`](./cross-analysis-context-management.md) §1.3, §3

### 3.3 L2 loop · outer / RSI loop（自改进闭环）

> **核心问题**：trajectory 怎么消化？技能/规则/记忆/模型怎么自动更新？

| ref | 关键贡献 | 状态 |
|---|---|---|
| **hermes-agent** | **`background_review.py` + `curator.py` + `skill_bundles.py`**：真闭环（trajectory → review → skill 更新 → 下次自动加载） | ★★★ 抄方法论（不抄代码） |
| **codex** | `rollout-trace` 独立 crate：trajectory 是一等公民，可压缩归档（无反馈环） | ★★ 抄数据底座 |
| **openclaw** | 144 extensions 是 plugin curation，不是 RSI | ✗ |
| **opencode** | 无 | ✗ |
| **claude-code** | skills 是 git-managed markdown（人工 RSI） | ★ 抄"git as RSI substrate" |

→ 详细分析：[`cross-analysis-context-management.md`](./cross-analysis-context-management.md) §2

### 3.4 L2 ctx · LARGE context harness（数字分身）

> **核心问题**：完整 agent 身份（历史+技能+记忆+知识+偏好）怎么存储？怎么 export / fork / diff？

| ref | 关键贡献 | 状态 |
|---|---|---|
| **claude-code** | **plugin 五件套目录 + plugin.json** = 能力层最佳样板（`commands/agents/skills/hooks/.mcp.json`） | ★★★ 抄"能力层"布局 |
| **codex** | **rollout JSONL + state_db CQRS + 独立 crate**：经验层最佳样板 | ★★★ 抄"经验层"格式 |
| **opencode** | **workspace 一等公民** + SQLite + drizzle migration timeline | ★★ 抄"workspace 子容器" |
| **hermes-agent** | **`HERMES_HOME` profile = 整目录分身** + memory 单插槽 + skill bundle | ★★ 抄"profile = 整目录"思路 |
| **openclaw** | `memory-host-sdk` + embeddings + QMD 查询 | ★（embedding 索引接口预留） |

→ **核心交付**：[`large-context-harness.md`](./large-context-harness.md) —— x_harness RSI 螺旋的物质基础

---

## 4. 跨象限共同观察到的设计哲学

把 5 份 comparison 横向汇总后的结论。下次 `vision/architecture` 修订会把这些吸进去。

| # | 哲学 | 多家同声 | x_harness 立场 |
|---|---|---|---|
| 1 | **核心窄腰，能力外置** | hermes + openclaw | vision §2 已写 |
| 2 | **memory 是独占槽** | hermes + openclaw | ADR 候选 |
| 3 | **Skill = frontmatter + body** | claude-code + hermes | ADR 0006 |
| 4 | **跨 OS sandbox 必须 Rust 写** | codex（唯一现成） | spiral 2/3 ADR |
| 5 | **守护进程化是迟早的事** | codex (`app-server*`) | ADR 0001 B 方案 |
| 6 | **agent-identity 应是独立组件** | codex（单独成 crate） | actor 一等公民 |
| 7 | **压缩不是 emergency response，是常态调度** | opencode + hermes + codex 同声 | **直接推翻我们目前的 max-rounds-bail** |
| 8 | **provider cache 是一等不变量** | hermes (README 第一条) + opencode (Baseline anchor) | spiral-3 P0 |
| 9 | **历史在 audit log 里永远完整，活跃 context 是 projection** | opencode 显式，hermes/codex 实质 | L2 ctx 设计原则 |
| 10 | **能力层 ≠ 经验层**（plugin/skill 是能力；rollout/memory 是经验，可独立移植） | **没有一家完全做到——这是 x_harness 的差异化点** | L2 ctx 核心设计 |

## 5. 谁负责"什么"的最佳样板（一图覆盖）

| 维度 | 最佳样板 | 我们用在哪 |
|------|----------|------------|
| L1 loop / compaction 实现 | opencode（最干净）/ codex（最完整） | spiral-3 P0 |
| L1 loop / tool-call 协议合法性 | openclaw `tool-call-repair` | spiral-3 P0 |
| L1 ctx / 概念建模 | **opencode `CONTEXT.md`** | spiral-3 P1 |
| L2 loop / RSI 方法论 | hermes `background_review` + `curator` | spiral-4+ |
| L2 ctx / 能力层布局 | claude-code 五件套 | LCH `capabilities/` |
| L2 ctx / 经验层 trajectory | codex rollout JSONL + CQRS | LCH `experience/rollouts/` |
| L2 ctx / workspace 子容器 | opencode workspace | LCH `experience/workspaces/` |
| L2 ctx / profile = 整目录分身 | hermes `HERMES_HOME` | LCH actor 目录 |
| model 抽象（cheap aux model） | hermes `auxiliary_client` | spiral-3 P2 |
| Skill / Plugin 协议 | claude-code 五件套 | ADR 0006 |
| 工程结构 / 包切分 | openclaw（中规模）/ codex（大规模） | 节奏由场景驱动 |
| Rust 内核能力 | codex（sandbox / agent-identity / hooks） | spiral 2/3 |
| TS↔Rust monorepo 布局 | codex | 直接照搬 |
| memory 槽位独占 | openclaw + hermes | LCH 设计 |
| 危险操作规则集 | claude-code `security-guidance` + codex `execpolicy` | ADR 0005 |

---

## 6. 文档导航

本目录分为 **顶层（核心交付）** 与 **`refs/` 子目录（参考项目笔记）** 两层：

### 6.1 顶层 — 核心交付文档（spiral-3 概念基线）

| 文档 | 角色 | 何时读 |
|---|---|---|
| [**`harness-framework.md`**](./harness-framework.md) | **术语权威**：框架定义、4 象限接口面、5 ref 在四象限的位置 | 入门必读、改框架须 ADR |
| [**`cross-analysis-context-management.md`**](./cross-analysis-context-management.md) | **L1 横评**：5 个 ref 在 L1 loop（compaction）+ L1 ctx（small CH 建模）的对照与 x_harness 5 级修复清单 | 做 spiral-3 P0/P1 时 |
| [**`large-context-harness.md`**](./large-context-harness.md) | **L2 ctx 设计**：5 个 ref 的存储结构横评 + `~/.x_harness/actors/<id>/` 数字分身布局 + 三动词接口 | 做 spiral-3 数字分身整合时 |

### 6.2 `refs/` — 参考项目笔记（每个 ref 一份）

每份按统一结构组织：
1. 一句话定位 + 主战场象限
2. 仓库形态速览
3. **四象限映射**（在哪一象限是 ★★★ / ★★ / ★ / ✗，关键文件 + 借鉴点）
4. ★ 我们要吸收的（带 ADOPT / TRACK / DEFER / EVAL 状态）
5. 我们明确不要的
6. 上游需要持续跟踪的特性
7. 提取的 ADR 候选

- [`refs/hermes.md`](./refs/hermes.md) — L2 loop 最佳样板（RSI）
- [`refs/openclaw.md`](./refs/openclaw.md) — TS 工程结构样板
- [`refs/claude-code.md`](./refs/claude-code.md) — L2 ctx 能力层最佳样板（plugin 五件套）
- [`refs/codex.md`](./refs/codex.md) — L2 ctx trajectory + L1 loop taxonomy 最佳样板
- [`refs/opencode.md`](./refs/opencode.md) — L1 ctx 概念建模最佳样板

> **阅读顺序建议**：先读 `harness-framework.md` 拿到框架坐标，再视任务挑核心交付文档（L1/L2 哪一格），最后回到 `refs/` 查具体 ref 细节。

---

## 7. 维护节奏 & 子模块工具

- 每个螺旋开始前，跑 `./scripts/refs.sh pull`，扫一眼上游 release notes。
- 把值得吸收的进展按四象限模板增量写入对应 ref 文档。
- 不直接把上游代码 copy 进 packages/，所有借鉴都要重写或重新设计。

弱网环境用 `scripts/refs.sh`：

```bash
./scripts/refs.sh list                    # 当前 SHA vs upstream HEAD
./scripts/refs.sh pull [<name>]           # 拉所有 / 单个
./scripts/refs.sh pin  [<name>]           # 把更新的 SHA stage 进父仓
./scripts/refs.sh add  <name> <url> [br]  # 新加 ref
./scripts/refs.sh rm   <name>             # 干净移除
./scripts/refs.sh doctor                  # 排查残留 .git/modules 等问题
```

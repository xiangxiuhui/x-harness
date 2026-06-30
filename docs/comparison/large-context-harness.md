# Large Context Harness — 存储结构选型与"数字分身"设计

> **本文是 x_harness RSI 螺旋的核心设计前置**：
> 决定"大 context"（完整会话历史 + 技能套装 + 记忆 + 知识）的物理存储结构、
> 让它**可以独立导出成一个可复制的"数字分身"**，
> 并且**与任意 loop harness 完全解耦**——同一个分身可以挂到 inner loop 上执行任务、
> 也可以挂到 outer RSI loop 上自改进、还可以挂到完全不同的 harness 实现上回放。

---

## 0. 概念定位

补全后的 harness 四象限：

```
                          inner loop                      outer / RSI loop
                          ─────────────                   ─────────────────
                          一次/几次任务执行                  自改进闭环
                          ↕                               ↕
                          small context harness            LARGE context harness
                          ─────────────────────            ─────────────────────
context-harness 内容       system / sources / history       完整会话历史 + 技能套装
                          / tools 的拼装                     + 记忆 + 知识 + 偏好
约束                       cache 不变量、token 预算            可导出、可复制、
                          tool 协议合法性                    与 loop 解耦
```

- **Small CH**（上一份 `cross-analysis-context-management.md` 详细对照）= 一次推理调用前后的状态机
- **Large CH**（本文）= 一个"agent 身份"的全部沉淀

**关键洞察**：Large CH 不属于任何 loop。Loop 是消耗它/生产它的执行器，但本身是无状态的。
这等价于把 *agent 本体 = data*，*loop = function*。

---

## 1. 五个 ref 的"大 context"存储结构对照

> 重点关心：（A）存什么 实体 (entities)、（B）存在哪、（C）schema、（D）有无导出/复制接口。

### 1.1 hermes-agent — Python，最像"数字分身"的设计

| 实体 | 存储位置 | 形态 |
|---|---|---|
| 会话历史 | `~/.hermes/sessions/*.jsonl` + SQLite | 每个 session 一个文件 |
| 技能（user-curated） | `~/.hermes/skills/*.md`（YAML frontmatter + body） | 文件系统 |
| **技能套装 / bundle** | `~/.hermes/skill-bundles/*.yaml` | 显式聚合多个 skill 成一个 slash command |
| 记忆（agent-curated） | `MemoryProvider` 接口 + plugin（**整个 repo 只允许一个**） | 抽象，外置 |
| 偏好/凭据 | `~/.hermes/credentials.json` | 文件 |
| Profile（多人格） | `HERMES_HOME` 环境变量切换整目录 | **整目录即分身** |

**导出 / 复制能力**：✓ 强。`HERMES_HOME` 一变就是另一个分身。`skill-bundles` 是显式可移植资产。

**取舍亮点**：
- 「同时只能注册一个外置 memory plugin」—— 避免 tool schema 膨胀和冲突。**值得吸收**。
- 「skill bundle 是别名」—— bundle 和 skill 用同一个 namespace，bundle 优先。Slash command 是统一入口。

### 1.2 opencode — TS+Effect+SQLite，**最严谨的 schema**

| 实体 | 存储位置 | 形态 |
|---|---|---|
| Session / Messages / Events | SQLite（`drizzle-orm`），带 22+ migration 历史 | 强 schema，可演化 |
| `ContextEpoch` / `BaselineSystemContext` / `ContextSnapshot` | SQLite 表 | **一等公民** |
| Workspace（一个项目=一个 workspace） | SQLite 表（migration `add_session_workspace_id`） | session 属于 workspace |
| Skills / Plugins | `packages/plugin` 静态 + 外置 | code 形态 |
| `ManagedToolOutputFile` | 文件系统 + DB 引用 | 大输出物化 |

**导出 / 复制**：中。SQLite 文件可以整体拷贝，但 schema 复杂、迁移版本敏感，跨实例移植要走代码路径。

**取舍亮点**：
- **Workspace 概念**：把"工作场景"作为容器，session 挂在 workspace 下。我们 spiral-3 应该立刻吸收：x_harness 的 "actor" + "workspace" 是天然的两级容器。
- Drizzle migration timeline 是非常好的"schema 进化范例"——每个 migration 都是文件名带时间戳的 TS 模块。

### 1.3 codex — Rust，**最工业级的 trajectory 存储**

| 实体 | 存储位置 | 形态 |
|---|---|---|
| Rollout（完整 turn-level audit trail） | JSONL 文件 per thread + SQLite index | **append-only，可压缩、可分页** |
| Thread / Session | `SessionMeta` + `ThreadItem`，独立 crate `codex-rollout` | 独立 crate |
| `state_db` | SQLite（与 rollout JSONL 解耦的"派生状态"） | 读优化 |
| Compression of rollout | `codex-rs/rollout/src/compression.rs` | 旧 rollout 可压缩存档 |
| Memories | `config.memories.generate_memories` 开关 + 独立子系统 | 与 rollout 分离 |

**导出 / 复制**：✓ 强。`codex-rollout` 是独立 crate，**JSONL 格式自带可移植性**。codex 把 trajectory 当一等公民、独立 crate 化，这是其他 4 个 ref 都没做的。

**取舍亮点**：
- **rollout 是"事件日志"，state_db 是"派生快照"**——CQRS 风格。事件日志可移植/可压缩，快照可重建。这正是 x_harness RSI loop 需要的：每次进化只需要事件日志，不需要快照。
- **`codex-rollout` 是独立 crate**——明确把"agent 历史"当 reusable artifact。

### 1.4 openclaw — TS，**embedding-based memory**

| 实体 | 存储位置 | 形态 |
|---|---|---|
| Session messages | 散在 `agent-core/src/harness/` | 弱结构化 |
| **Memory** | `memory-host-sdk` 独立 package，含 QMD 查询语言 + embeddings | **向量化 memory** |
| Extensions | 144 个，每个独立目录 + `package.json` | plugin 形态 |
| Memory engines | `engine-embeddings` / `engine-foundation` / `engine-qmd` / `engine-storage` | 多 engine 后端 |

**导出 / 复制**：弱~中。memory 是黑盒插件，导出依赖具体 engine。

**取舍亮点**：
- 「memory 槽位独占」（我们在 ADR 候选里已经记过）—— 与 hermes 同口径。
- **embeddings + QMD 查询**是 RAG 路线的代表。我们短期不一定要走这条路，但 large CH 的 schema 需要预留"可索引字段"的余地。

### 1.5 claude-code — 纯 plugin manifest，**最便携**

| 实体 | 存储位置 | 形态 |
|---|---|---|
| 会话历史 | 不可见（CLI 闭源） | — |
| 技能 / 命令 / 子代理 / hooks | `plugins/<name>/{commands,agents,skills,hooks,.mcp.json}` | **纯文件系统** + git |
| Plugin manifest | `.claude-plugin/plugin.json` | name/version/author |

**导出 / 复制**：✓✓ 极强。**整个 plugin 目录 = 一个可分发单元**，可以 git clone / npm install / 复制粘贴。

**取舍亮点**：
- 「**plugin = 五件套目录 + 一个 plugin.json**」—— 数字分身的"皮肤层"最佳样板。
- 但 claude-code 的 plugin 不携带 session/memory，只携带"能力"。
- 我们的 large CH 设计应该包含**两个独立层**：
  - **能力层**（≈ claude-code plugin）：技能/命令/hooks/MCP
  - **经验层**（≈ codex rollout + hermes memory）：历史/记忆/偏好

---

## 2. 五项目对照汇总

| 维度 | hermes | opencode | codex | openclaw | claude-code |
|---|---|---|---|---|---|
| 历史存储 | JSONL + SQLite | SQLite (drizzle) | **JSONL + state_db (CQRS)** | 弱 | 不可见 |
| 历史可压缩归档 | ✗ | ✗ | **✓ `rollout/compression.rs`** | ✗ | ✗ |
| Skill = file + frontmatter | ✓ | code | code | code | **✓** |
| Skill bundle / 套装 | **✓ YAML 显式** | ✗ | ✗ | extensions | ✗ |
| Memory 抽象 | **MemoryProvider 接口** | ✗ | `memories` 子系统 | **memory-host-sdk + embeddings** | ✗ |
| Memory 槽位独占 | **✓** | n/a | ✓（隐性） | ✓ | n/a |
| Workspace / Profile 概念 | `HERMES_HOME` profile | **workspace 一等公民** | thread per cwd | ✗ | ✗ |
| 独立可移植 artifact | profile 整目录 | SQLite 文件 | **`codex-rollout` crate + JSONL** | ✗ | **plugin 整目录** |
| "数字分身"完整度 | 中（profile） | 中（workspace） | 中（rollout 是数据，不是能力） | 弱 | 弱（plugin 是能力，不是经验） |

> **没有任何一家把"能力+经验"都打包成一个可移植单元**。这是 x_harness 可以做出差异化的地方。

---

## 3. x_harness 的 Large Context Harness 设计

### 3.1 目标

1. **可导出**：`x_harness export <actor> > actor.tar.zst`，对面 `x_harness import` 就有一份完整身份。
2. **与 loop 解耦**：导出物里**不含任何 loop 实现代码**，只有声明 + 数据。
3. **能力 + 经验 双层**：能力是声明（plugin 形态），经验是事件日志（rollout 形态）。
4. **schema 演化可控**：每层都有版本号 + migration 路径。
5. **支持差分**：两个数字分身可以做 diff / merge（spiral-4 RSI 的基础）。

### 3.2 提议结构（吸收五家精华）

```
~/.x_harness/actors/<actor-id>/         ←  Large Context Harness 的物理形态
├── actor.json                          ←  manifest（名称、版本、parent actor、能力清单引用）
│
├── capabilities/                       ←  能力层（≈ claude-code plugin × N）
│   ├── skills/<skill-name>/            ←  YAML frontmatter + body
│   ├── commands/<cmd-name>.md
│   ├── subagents/<sa-name>.md
│   ├── hooks/<hook-name>.toml
│   └── mcp.json
│
├── experience/                         ←  经验层（≈ codex rollout + hermes memory）
│   ├── rollouts/                       ←  JSONL，每个 session 一个文件
│   │   ├── 2026-06-30T17-44_session-abc.jsonl       ←  完整事件日志
│   │   └── archive/2026-06.zst                       ←  ≥30d 自动压缩归档
│   ├── memory/
│   │   ├── notes.jsonl                 ←  agent-curated 长期记忆（写入是显式 turn 事件）
│   │   ├── facts.kv                    ←  键值偏好（user name, timezone, …）
│   │   └── index/                      ←  可选：embedding 索引（预留）
│   └── workspaces/<workspace-id>/      ←  workspace 级状态（吸收 opencode）
│       └── state.json
│
├── knowledge/                          ←  知识层（区别于 memory：外部输入，非 turn 产物）
│   ├── docs/                           ←  本地文档库
│   └── refs.json                       ←  外部链接清单
│
└── preferences/                        ←  user 偏好（model, theme, ...）
    └── config.toml
```

### 3.3 各层的 schema 取舍

#### capabilities/ — 吸收 claude-code

- 整体形态借 claude-code plugin。**单个 skill 必须能直接 cp 到另一个 actor 仍可用**。
- 不引入 `.x-plugin/plugin.json`——`actor.json` 里的 capabilities 清单就是 manifest。
- Skill = `frontmatter (yaml) + body (markdown)`，与 claude-code/hermes 同口径。

#### experience/rollouts/ — 吸收 codex

- **JSONL append-only**，每个 session 一个文件。原因：
  - 写时不需要锁全局数据库
  - 可流式读取做 RSI 训练数据
  - 可独立压缩归档（codex 的 `compression.rs` 做法）
  - 可被任何 loop 实现回放（解耦）
- 行格式（参考 codex `RawTraceEvent` + opencode event）：
  ```json
  {"v":1,"t":"<iso>","kind":"user_msg|tool_call|tool_result|assistant|system|compaction","payload":{...}}
  ```
- **不存 small CH 的 cache 状态**（那是 loop 的事，跨 loop 不可移植）。

#### experience/memory/ — 吸收 hermes + openclaw

- 短期：只做 hermes 风格的 `notes.jsonl`（agent 显式 `write_memory` tool 产生的条目）+ `facts.kv`
- 长期：可选 embedding 索引留好接口，但**不强依赖**（openclaw 的 QMD 路线对应 RAG，spiral-3 之后再说）
- **采纳"memory 槽位独占"**：同时只能挂一个 `MemoryProvider`。

#### experience/workspaces/ — 吸收 opencode

- workspace = "当前工作场景"（一个仓库、一个项目、一组关联文件）。
- session 属于 workspace，rollout 在 session 维度。
- workspace state 是派生的（≈ codex `state_db`）——丢失可从 rollouts 重建。

#### knowledge/ — **新增层，五家都没显式分**

- 关键区分：**memory 是 agent 产生的，knowledge 是 user/world 输入的**。
- 这一层避免 hermes 把"用户给的资料"和"agent 自己悟到的"混在 memory 里造成的混乱。

#### actor.json — 顶层 manifest

```json
{
  "v": 1,
  "id": "<uuid>",
  "name": "string",
  "created_at": "iso",
  "parent": "<actor-id>",        // fork 来源，可空
  "capabilities": ["skills/*", "commands/*", ...],   // 引用而非内嵌
  "schema_versions": { "rollout": 1, "memory": 1, "capabilities": 1 }
}
```

`parent` 字段支撑**数字分身的 fork**：spiral-4 RSI 时，每次进化是基于 parent 的差分。

### 3.4 与 loop 的接口

Large CH 暴露给 loop 的接口只有 **3 个动词**（保持与 loop 解耦）：

```typescript
interface LargeContextHarness {
  // 给小 CH 喂初始状态（system context sources, 可用 skills, 可用 tools）
  hydrate(opts: { workspaceId?: string; sessionId?: string }): SmallContextSeed

  // 每个 turn 结束后写一行 rollout
  append(event: RolloutEvent): Promise<void>

  // agent 显式触发的 memory 写入
  writeMemory(note: MemoryEntry): Promise<void>
}
```

任何 loop 实现都只依赖这 3 个动词，**不直接读写文件系统**。这样：
- inner loop 用同一份接口
- outer RSI loop 用同一份接口（只是会读 N 个 actors 的 rollout 做训练数据）
- 第三方 harness 实现可以替代我们的 loop（如把 opencode runtime 接进来跑同一个 actor）

### 3.5 导出 / 导入 / 复制

```bash
# 整体导出（含全部经验和能力）
x_harness actor export <id>                                # -> actor.tar.zst

# 只导能力层（"皮肤" / 配置分发）
x_harness actor export <id> --only=capabilities            # -> capabilities.tar

# 只导经验层（"灵魂" / RSI 训练数据）
x_harness actor export <id> --only=experience              # -> experience.tar.zst

# fork（基于现有 actor 创建副本，parent 自动指向源）
x_harness actor fork <id> --name=<new-name>

# 差分（spiral-4 RSI 需要）
x_harness actor diff <a> <b>                               # 差异化能力 + 差异化经验摘要
```

---

## 4. ADR 候选清单

| ADR | 标题 | 决定的事 | 依赖 |
|---|---|---|---|
| ADR-00xx | Actor as Large Context Harness | 把 large CH 物化为 `~/.x_harness/actors/<id>/`，与 loop 解耦 | 本文 |
| ADR-00xx | Rollout JSONL schema v1 | 行格式 + 字段集 + 压缩归档策略（吸收 codex） | 本文 |
| ADR-00xx | Capabilities = file-tree + actor.json | 不引入额外 plugin.json，能力层与 claude-code 兼容 | 本文 |
| ADR-00xx | Memory single-provider invariant | 同时只能挂一个 MemoryProvider（吸收 hermes/openclaw） | 本文 |
| ADR-00xx | Knowledge ≠ Memory | 显式分层，避免 hermes 的混淆 | 本文 |
| ADR-00xx | Workspace 作为 actor 内子容器 | 吸收 opencode | 本文 |
| ADR-00xx | LCH ↔ loop 三动词接口 | `hydrate` / `append` / `writeMemory` 三件套 | 本文 |

---

## 5. spiral 路线图建议

| Spiral | 该做的 LCH 部分 |
|---|---|
| **spiral-3**（当前螺旋） | 仅落地 `actor.json` + `experience/rollouts/*.jsonl`，三动词接口最小版。**不做 memory/knowledge/workspace/export**。 |
| spiral-4 | 加 `capabilities/` 目录扫描、`workspaces/`、`memory/notes.jsonl`。export/import 命令。 |
| spiral-5 | RSI loop：读多 actor 的 rollouts 训出新 skill 候选，diff/fork/merge actor。 |
| spiral-6 | embedding 索引（可选，按需）。 |

**关键约束**：spiral-3 必须把 actor 目录的"形状"落下来，即使每个子目录都是空的。这样后续 spiral 只是在已有目录里填东西，不会推翻顶层布局。

---

## 6. 五家精华吸收速查表

| 借鉴自 | 我们怎么用 |
|---|---|
| **claude-code** 的 plugin 五件套 | `capabilities/` 目录布局（去掉 plugin.json，让 actor.json 统管） |
| **codex** rollout JSONL + 独立 crate + 压缩归档 + CQRS（log/snapshot 分离） | `experience/rollouts/` + spiral-3 起就实现归档接口 |
| **opencode** workspace 一等公民 + drizzle migration | `experience/workspaces/` + migration 文件命名规范 |
| **hermes** profile = 整目录 + memory 单插槽 + skill bundle | actor = 整目录 = profile；memory 单插槽；skill bundle 作为 capabilities 子能力 |
| **openclaw** embedding-based memory + memory engine 抽象 | memory `index/` 子目录预留接口，不强依赖 |

---

*最后维护：与 commit 同步 `6be0d9e`+ 本次修改*

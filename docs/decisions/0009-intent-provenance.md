# ADR 0009 — Intent Provenance & AI-touch Watermark

- **Status**: Accepted
- **Date**: 2026-06-26
- **Relates to**: [ADR 0002](0002-actor-tag-macos.md) (extends), [ADR 0005](0005-danger-rules.md), [ADR 0010](0010-world-awareness.md) (companion)
- **Implements (slice of)**: spiral 2/2a

## Context

[ADR-0002](0002-actor-tag-macos.md) 定义了 actor 标签（谁干的）。但当我们要走向 spiral 2/2 把 actor 信息写到 macOS xattr 时，发现 actor 只回答"**谁说的话**"，不回答"**这个动作的 originator chain 是什么**"。

具体地，一次"AI 改了 `/Users/xxh/foo.txt`"背后至少 6 层：

```
[1] 人类原始意图     "把 foo.txt 里 hello 改成 hi"
[2] 人类输入         cli 里那句话（user.message JSONL entry）
[3] 模型决策         model 看上下文决定调 file.write
[4] 危险评估         danger guard 命中/未命中规则
[5] 人类确认?       命中 Class A/B → 人类按 y/n
[6] 实际 syscall    posix_spawn → write(2) → 文件落盘
```

未来在 Finder / Web UI / `x trace <file>` 里看到一个文件，需要回答：
- 这是 AI 改的吗？
- 是人类明确授权的，还是模型自主延伸的？
- 对应哪个 session、哪一句人类原话？
- 这条 xattr 是真的，还是被伪造/篡改的？

只靠 `actor=model:deepseek` 一条标签远远不够。

## Decision

引入 **Intent Provenance** —— actor 之上的一层归属字段，**写进 JSONL 事件**，并在 spiral 2/2a 中**镜像到目标文件的 xattr**。

### 1. JSONL 事件 schema 扩展

对每个**有副作用的动作**（`shell.run` / `file.write` / `file.edit` / `web.fetch` 写方法），`tool.call` / `tool.result` 事件 payload 加一个 `provenance` 字段：

```typescript
interface IntentProvenance {
  // 谁实际执行了 syscall —— 等同 actor，但 enum 化
  executor:
    | { kind: 'model'; provider: string; model: string }
    | { kind: 'human'; userId: string; surface: 'cli' | 'web' };

  // 原始人类意图：往上追溯到本 turn 的 user.message
  originatingHumanMessage: {
    entryId: string;   // 目标 JSONL entry 的 id
    textHead: string;  // 前 80 字符截断
    distance: number;  // 当前动作距离它多少个 tool_call (1-based)
  } | null;            // null = idle/scheduled 自主触发（spiral 3+）

  // 自主程度 4 级谱系
  autonomy:
    | 'human-instructed'      // 人类原话明确提到这个操作（"删 foo.txt"）
    | 'human-implied'         // 人类指令隐含此步（"清理一下"→ rm 哪些由模型挑）
    | 'model-elaborated'      // 模型在执行更大任务时延伸的子步骤
    | 'model-self-initiated'; // 没有近期人类输入（idle 自主，spiral 4+）

  // 人类显式审批
  humanApproval: {
    required: boolean;     // danger guard 是否要求
    granted: boolean;
    grantedBy: string;     // userId
    promptHead: string;    // 给人类看的提示词前 120 字符
    durationMs: number;    // 人类犹豫了多久（信号丰富）
  } | null;                // null = guard 没要求

  // session 怎么开始的
  sessionTrigger:
    | 'human-cli-start'    // 人类敲 `pnpm x chat`
    | 'human-resume'       // `x chat --resume`
    | 'patrol'             // 巡逻触发的子 session（ADR-0010, spiral 3+）
    | 'scheduled'          // launchd timer（spiral 3+）
    | 'agent-spawned';     // 另一 agent 启动（spiral 3+）
}
```

### 2. autonomy 分级在 spiral 间的演进

| Spiral | 怎么算 |
|---|---|
| **2 (当前)** | 简单序号法：当前 tool_call 在 user turn 中的序号 = 1 → `human-instructed`；序号 ≥ 2 → `model-elaborated`。零成本，用现有数据。 |
| **3** | model 在 tool args meta 里自报 `autonomy_hint`；core 比对粗推断，分歧记下来。进化系统消费这些分歧。 |
| **4+** | 加 `human-implied`（基于人类原话动词强度 + LLM 评分）；加 `model-self-initiated`（session idle/scheduled 路径触发的）。 |

### 3. xattr 镜像（spiral 2/2a 实施）

成功执行 `file.write` / `file.edit` 后，给目标文件写一条扁平 JSON：

- macOS / Linux：`xattr -w com.x_harness.ai_touch '<json>' <path>` (实际通过 `setxattr(2)`)
- Windows：写到 `<path>:ZoneIdentifier:AiTouch` ADS（备用方案，spiral 3+ 实装）

JSON 字段（紧凑版，不放整个 provenance）：

```json
{
  "v": 1,
  "ts": "2026-06-26T15:00:00Z",
  "session": "sess-xyz123",
  "entry": "<jsonl-entry-uuid>",
  "executor": "model:deepseek:v3",
  "autonomy": "human-instructed",
  "approved_by": "human:xxh",
  "harness_home": "/Users/xxh/.x_harness"
}
```

xattr 体积上限 macOS 单 attr 是 128KB / 文件 256KB，我们这条 json 永远 < 1KB，安全。

字段说明：

- `v=1`：schema 版本。任何不识别版本的 reader 必须保留原值不动。
- `entry`：反指 JSONL 完整上下文。`x trace <path>` 用它跳到对应 session 文件。
- `session`：方便不打开 JSONL 也能定位。
- `executor`：紧凑 string；与 JSONL provenance 字段对齐。
- `approved_by`：null 时是 `null`，不删字段——便于 grep。
- `harness_home`：标识 xattr 出自哪个 x_harness 实例（多设备协作场景）。

### 4. CLI 反查接口

```
x trace <path>
  → 读 xattr
  → 打印 provenance
  → 打开对应 session JSONL 的 entry 上下文（前后 5 条）

x untouch <path>
  → 删除 ai_touch xattr（用于"我已经审查并接管了这个文件"语义）
  → 自动留一条 audit 记录到 ~/.x_harness/memory
```

### 5. 完整 vs 紧凑：JSONL 是 source of truth，xattr 是 forward index

**关键原则**：xattr 是**指针**，不是**事实**。事实在 JSONL 里。

- xattr 可被任何工具（`cp -X`, `tar` without `--xattrs`, iCloud 同步）丢掉——视为正常损耗
- xattr 损耗后归属 = "unknown"，由 [ADR-0010 patrol](0010-world-awareness.md) 的 snapshot 提供 fallback 归属
- xattr 不可信（攻击者可写）→ 任何 attribution 都要 cross-check JSONL
- 没有 xattr 的文件 ≠ 不是 AI 改的（可能 attr 丢了）

## 4 级 autonomy 的可视语义（给未来 UI 设计参考）

| autonomy | 颜色暗示 | 含义 |
|---|---|---|
| `human-instructed` | 🟢 绿 | "你让我做的我做了" |
| `human-implied` | 🟡 黄 | "你大致让我做，细节我挑的" |
| `model-elaborated` | 🟠 橙 | "完成你的任务时我自己延伸的" |
| `model-self-initiated` | 🔴 红 | "你不在的时候我自己想做的"（高警觉） |

`approved_by != null` 在每一级上都是额外正向信号。`model-self-initiated && approved_by == null` 是**最需要事后人类审查**的案例。

## Consequences

- **xattr schema 钉死**：未来 Web UI / Finder integration / `x trace` 都基于这个 schema
- **进化系统的金矿**（spiral 2/4）：`autonomy=model-elaborated && approved=false && user-later-reverts` 三元组 = 模型解读偏差样本，自动喂回训练 / few-shot
- **不做的事**：
  - ❌ 不做全局 ES 监控（spiral ∞ 才有）
  - ❌ xattr 不写敏感原文，只写指针
  - ❌ 不在 spiral 2 实装 `human-implied` / `model-self-initiated`（schema 预留但 emitter 不产出）

## Open Questions

- **GET 请求的 `web.fetch`** 算副作用吗？倾向：**不算**，不写 provenance；POST/PUT/DELETE 算。
- **`file.read` 痕迹**？默认**不写 xattr**（量大 + 隐私）；可在 territory.yaml 显式开 `track_reads: true`。
- **跨设备 iCloud sync 丢 xattr** 的应对？依赖 ADR-0010 patrol 的 snapshot 反查。
- **修改时间快于 1 秒的连续 write**：xattr 用最后一次覆盖；JSONL 全部保留。

## 实施位置

- 类型定义：`packages/memory/src/provenance.ts` (新建)
- emitter：`packages/core/src/session.ts` 在调 builtin tool 前后填字段
- xattr writer：`crates/x_kernel/src/ai_touch.rs` (spiral 2/2a 新建) + Node binding
- CLI：`packages/cli/src/trace.ts` (新建 `x trace` 子命令)
- 测试：`packages/memory/test/provenance.test.ts` + `crates/x_kernel/tests/ai_touch.rs`

## Implementation update (2026-06-26, spiral 2/2a)

实装位置与原计划略有出入（**仍符合本 ADR**），记录如下：

| 计划 | 实装 |
|---|---|
| `packages/memory/src/provenance.ts` 类型 | **`@x_harness/provenance`** 独立包 — 隔离 OS 调用 |
| `crates/x_kernel/src/ai_touch.rs` Rust binding | **shell-out 到 `xattr(1)` / `setfattr`** — 见下方"Rust 暂缓"段 |
| Node binding | 同上：`spawnSync` + 文本 IO，无原生扩展 |
| `Session` 在 builtin tool 前后填字段 | ✅ 通过 `ctx.attachProvenance(path)` binder，每个 tool 调用一次 |
| `x trace` 子命令 | ✅ + 同一份 loader 暴露给 Web `/api/trace` |

### 关于"为何先不写 Rust"

- 本 ADR 早就声明 **JSONL 是 source of truth, xattr 是 forward index**。索引是不是 Rust 实现，与正确性无关。
- 本机暂无 cargo；强引入会破坏"零运行依赖"的 spiral-2 原则。
- `XattrOps` 接口已经画好（`packages/provenance/src/xattr.ts`），将来要塞 Rust binding 不影响调用方。
- 真正"必须 Rust"的触发条件：
  1. 批量打 watermark（万级文件）shell-out 太慢；
  2. 想监听 fs 事件并自动恢复缺失 watermark（`fanotify`/`FSEvents`）；
  3. 跨 OS 时 shell 工具差异治理成本超过自己写一份的成本。

### v0 自治判定的简化（待 spiral 2/2b 完善）

当前 `autonomy` 只产生 `human-implied`（有过 user 消息）或 `model-self-initiated`（idle）两值。
真正的 4 级谱（instructed / implied / elaborated / self-initiated）需要：
- 提示文本 vs 动作的语义比对（"是不是用户原话点了名"）
- 多步规划检测（"是不是被一个上层目标分解出来"）

这两件事 spiral 2/4（进化采集）顺便做：因为接受/拒绝按钮要展示"AI 是自作主张还是按你说的做"，
正好需要这个数据。

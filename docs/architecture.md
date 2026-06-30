# Architecture — TS 外壳 + Rust 内核

## 1. 分层

```
┌────────────────────────────────────────────────────┐
│ Entry Layer  (CLI / UI / 浏览器插件 / 麦克风 / ...) │   ← 都是"视图+协作"
├────────────────────────────────────────────────────┤
│ Core (TS)   会话 / 编排 / actor 总线 / 审计写入   │
├────────────────────────────────────────────────────┤
│ Capabilities (TS)                                  │
│   ├─ provider/   LLM 抽象                          │
│   ├─ skills/     Skill 运行时 + 内置工具           │
│   └─ memory/     记忆 / 知识 / 进化原料            │
├────────────────────────────────────────────────────┤
│ Kernel (Rust, crates/x_kernel)                     │
│   ├─ actor tag  系统级 actor 标签读写              │
│   ├─ guard      危险操作拦截 + 确认 IPC            │
│   └─ syscall    高频 IO（FS、process、net）        │
├────────────────────────────────────────────────────┤
│ OS (macOS / Linux / Windows)                       │
└────────────────────────────────────────────────────┘
```

## 1.1. 概念维度 — Harness 框架（双层 × 双轴）

> 术语权威：[`comparison/harness-framework.md`](comparison/harness-framework.md)。
>
> §1 的分层是**实现侧切片**（"代码住在哪一层"）；本节是**概念侧切片**（"运行时有几个独立子系统"）。
> 两个切片正交，每个 Capabilities/Core/Kernel 模块都同时落在两个切片上。

```
                            inner / L1                      outer / L2
                            ─────────────                   ─────────────
loop-harness                L1 loop                          L2 loop
                            tool-calling 循环                 RSI loop（自改进）
                            ─────────────                   ─────────────
context-harness             L1 ctx (small CH)                L2 ctx (LARGE CH)
                            单次推理上下文工程                 数字分身
                            cache 不变量、tool 协议合法性      历史+技能+记忆+知识+偏好
                                                            可 export / fork / diff

                            model（可替换黑箱）
```

**4 象限到本架构层的映射**：

| 象限 | 当前实现位置 | 备注 |
|---|---|---|
| L1 loop | `packages/core/src/session.ts` tool-calling loop | 当前只有 max-rounds bail，spiral-3 加 token 预估 |
| L1 ctx | `packages/core/src/session.ts` prompt 拼装 + `appendToolResult` | spiral-3 抽出独立模块；引入 `ContextEpoch` 类型 |
| L2 loop | spiral-2 "待复盘" UI 采集为起点；spiral-4+ 闭环 | 目前是采集，尚未自动转化 |
| L2 ctx | `~/.x_harness/{memory,evolution,skills}/*` 散落 | spiral-3 起整合为 `actors/<id>/` 目录，详见 [`comparison/large-context-harness.md`](comparison/large-context-harness.md) |

**关键设计不变量（由 Harness 框架推出）**：

- **Loop 是 function，context 是 data**：任何 loop 都不能持有跨 turn 状态；所有持久化只能写入 L2 ctx。
- **L2 ctx 与 loop 解耦**：数字分身可以被任意 loop 实现消费——这是 RSI 闭环成立的物质基础。
- **能力层 ≠ 经验层**（L2 ctx 内部再分两层）：claude-code 风格的 plugin 五件套是能力层；codex 风格的 rollout JSONL 是经验层；两者独立可移植。
- **实验控制变量集 = `L1 loop × L1 ctx × L2 loop × L2 ctx × model`**——任何一项可独立替换而不破坏其他。

## 2. 为什么 TS + Rust 双层

| 维度 | TS 外壳 | Rust 内核 |
|------|---------|-----------|
| 开发速度 | ✅ 极快 | ⚠️ 中等 |
| Provider 生态 | ✅ 官方 SDK 齐全 | ⚠️ 不齐 |
| 系统级 IO | ⚠️ 间接 | ✅ 直接 |
| 单二进制分发 | ⚠️ Node 依赖 | ✅ 静态编译 |
| 跨 OS 一致性（actor / guard） | ⚠️ 难做硬支持 | ✅ 必须 Rust |

结论：**业务编排放 TS，跨 OS 系统能力放 Rust。**

## 3. TS↔Rust 通信

候选：
- **A. NAPI-RS**（Rust crate 直接被 Node 加载为 native module）
  - 优点：调用零开销，类型友好
  - 缺点：必须打到当前 Node ABI；多平台预编译产物多
- **B. JSON-RPC over stdin/stdout**（Rust 作为子进程）
  - 优点：解耦干净，Rust 可独立运行（也方便守护进程化）
  - 缺点：调用有序列化成本

**初步决定：A 用于高频调用（actor tag、syscall 包装），B 用于守护进程式能力（guard daemon、远程节点）。**
（详见 `docs/decisions/0001-ts-rust-bridge.md`，待写）

## 4. Actor 总线（核心抽象）

```ts
type Actor =
  | { kind: 'human'; userId: string; surface: 'cli' | 'ui' | 'voice' | ... }
  | { kind: 'model'; provider: string; model: string; sessionId: string }
  | { kind: 'system'; subsystem: string };

interface ActorEvent {
  id: string;
  ts: number;
  actor: Actor;
  action: ToolCall | Message | FsWrite | NetReq | ...;
  parentId?: string;        // 因果链
  artifacts?: Artifact[];   // 产物
}
```

要点：
- **每一次能力调用都必走 actor 总线**，没有"裸调用"。
- Rust 内核在执行 syscall 之前，从 actor 总线读出当前 actor 标签，落到 OS 层（macOS xattr `com.x_harness.actor` / Linux audit / Windows ETW）。
- audit log = actor 总线的持久化。

## 5. 危险操作守卫流程

```
TS 调用 shell.run("rm -rf X")
  └─> kernel.guard.check(cmd)
        ├─ 命中规则 → kernel 暂停 → IPC 通知 UI
        │              ├─ 人类确认 → kernel 放行（actor 升级为 human-approved）
        │              └─ 人类拒绝 → 拒绝并写 audit
        └─ 未命中 → 直接放行
```

确认动作本身也是一个 actor 事件：`actor=human, action=approve, target=<那个 model 动作>`。
这条记录就是**进化原料**。

## 6. 记忆 / 进化数据流

```
Actor 总线 → audit log → memory 索引器 →
  ├─ 事实 / 偏好 / 禁忌（结构化）
  └─ 进化原料 (model_action, human_correction, context) →
        UI 上"待复盘"队列 →
          人类确认 → 转化为 skill 草稿 / prompt 片段 / memory 条目
```

## 7. 第一螺旋时只实现的最小子集

- TS：core / cli / ui（最小 web）/ provider（1 家）/ skills（4 个内置）/ memory（3 类）
- Rust：actor tag 写入 + 危险操作 guard
- 通信：先全用 NAPI-RS，guard daemon 推迟到螺旋 2

> **实际螺旋 1 落地差异**（2026-06-24）：UI 推迟到螺旋 2，先以 CLI 闭环；
> Rust kernel 推迟到螺旋 2，guard 用纯 TS（`@x_harness/danger`）实现；
> memory 用单一 JSONL append log 形态，三类分组（事实/偏好/禁忌）从 JSONL 派生，
> 本身推迟到螺旋 2。详见 `docs/status.md`。

## 8. 后续 ADR 索引

- `docs/decisions/0001-ts-rust-bridge.md` ✅
- `docs/decisions/0002-actor-tag-macos.md` ✅
- `docs/decisions/0003-first-provider.md` ✅
- `docs/decisions/0004-ui-form-factor-mvp.md` ✅
- `docs/decisions/0005-danger-rules.md` ✅
- `docs/decisions/0006-skill-plugin-form.md` ✅
- `docs/decisions/0007-skill-runtime-form.md`（Accepted, spiral 2.1 已实现）
- `docs/decisions/0008-ui-core-protocol.md`（spiral 2 待写）
- `docs/decisions/0009-evolution-schema.md`（spiral 2 待写）

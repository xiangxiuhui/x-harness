# Status — 代码现状一页（spiral 2 in-flight）

> 这一页是给"上下文压缩后的未来 self"看的：当前 repo 里**实际有什么**，对应 vision 和 ADR 里的**哪一条**，**哪些没有**。

更新时间：2026-06-25（spiral 2.1 done **but partially superseded**：ADR-0008 把 on-disk skill 从 "tool wrapper" 回归到 "agentskills.io 标准 doc + scripts"）。

## ⚠️ Spiral 2.1 方向纠正记录

| 时间 | 事件 |
|---|---|
| 2026-06-25 上午 | ADR-0007 Accepted；examples/skills/greet 用 handler.ts 跑通 |
| 2026-06-25 下午 | 真实世界 `anthropics/skills/pdf` 测试 → 暴露认知错误：skill ≠ tool；它是 filesystem doc，按 progressive disclosure 三级加载 |
| 2026-06-25 下午 | ADR-0008 Accepted；ADR-0007 Superseded（stdio runtime 降级为 opt-in `expose_as_tool: true`）|
| 2026-06-25 下午 | greet 重写为 anthropic 标准形态（SKILL.md body + scripts/greet.sh，无 handler）|
| 2026-06-26 下午 | spiral 2/2 范围审视：写下 ADR-0009 (Intent Provenance) + ADR-0010 (World Awareness) + vision.md North Star 段；落地 territory.yaml 默认配置 + loader |
| 2026-06-26 傍晚 | spiral 2/3 v0：`@x_harness/web` 包 + `x web` 子命令；read-only Web UI（sessions/territory/skills + SSE live tail）；ADR-0011 钉死 Surface Parity 原则 |

这是螺旋开发的正确暴露——错误前提通过真实使用浮出水面，回退一个 commit 远比堆十个 commit 在错的假设上便宜。

---

## 1. 已落地的代码包

```
packages/
├── provider/   DeepSeek (OpenAI-compatible SSE) — ADR-0003
├── skills/     v0 loader + 4 builtin + frontmatter parser + **on-disk runtime (opt-in via expose_as_tool)** — ADR-0006/0007/**0008**
├── danger/     pure rule engine v0 (3 Class-A + 5 Class-B) — ADR-0005
├── memory/     JSONL append log + replay + index — ADR-0002
├── core/       Session w/ tool-loop + actor bus + memory sink hook
└── cli/        x chat / x sessions ls / x sessions show / x chat --resume
crates/
└── x_kernel/   占位（只有 Cargo.toml + lib.rs 空壳）— ADR-0001 暂用 TS 全栈
```

## 2. 端到端能力（self-usable 阈值已过）

```
你 ─cli─▶ Session ──provider──▶ DeepSeek
              │                     │
              │◀──── tool_calls ────│
              ▼
       SkillRegistry ── DangerEngine ── 命中 → confirmDanger (cli prompts) → human-approved
              │                                                                   │
              ▼                                                                   ▼
       shell.run / file.* / web.fetch ◀───── allow / deny ◀────────────────────  human
              │
              ▼
       MemorySink ── JSONL append (每条 entry 都带 actor) ── ~/.x_harness/memory/sess-*.jsonl
```

`x chat --resume <id>` 把 JSONL 重放成 Message[] 给 provider，继续聊。

## 3. ADR ↔ 代码 现状对照

| ADR | 决议 | 代码现状 | 备注 |
|---|---|---|---|
| 0001 TS+Rust bridge | NAPI-RS 高频 / JSON-RPC 守护 | ⚠️ **Rust 部分零代码** | spiral 1 用纯 TS 闭环换交付速度；spiral 2 才动 Rust |
| 0002 actor xattr | `com.x_harness.actor.*` 落 xattr | ⚠️ **应用层兑现**（bus + memory entry 都有 actor），但**没下沉到 OS 级 xattr** | 等 Rust kernel 一起做 |
| 0003 first provider | DeepSeek | ✅ 完全兑现 | provider 抽象抽得很薄，加第二家成本低 |
| 0004 UI 形态 | 本地 Web + 将来包 Tauri | ❌ **UI 一行没写**（CLI 在跑） | spiral 2 启动项之一 |
| 0005 危险规则集 | Class A + Class B + recover 抵消 | ✅ 14 case 测试通过 | 仍只覆盖 macOS 路径模式；shell 解析不展开 $VARS |
| 0006 Skill 五件套 | claude-code 兼容 frontmatter | ✅ builtin + **on-disk 可执行** (ADR-0007) | 脚本运行时已落地 |
| 0007 Skill 脚本运行时 | Node spawn + JSON-over-stdio | ✅ 实现完成 (`packages/skills/src/runtime/exec-on-disk.ts`) | 6 case 测试通过；demo 在 `examples/skills/greet/` |

## 4. vision.md 中**已兑现** vs **未兑现**

| vision 段落 | 状态 |
|---|---|
| §2 通用办公型 harness | 🟡 编程/shell 能用；浏览器/语音/办公 UI 未做 |
| §3 Actor 一等公民 | 🟡 应用层完全是；OS 层 xattr 未做 |
| §4 UI = 视图 + 协作 | ❌ 还没有 UI |
| §5 信任但可审计 | ✅ 默认裸跑；Class A/B 命中弹确认；JSONL 全审计 |
| §6 自学习进化（采集 + 视图 + 接受拒绝） | ❌ 审计流水有了，但**没有"待复盘"队列**，没有"接受/拒绝"按钮，更没有 skill 草稿生成 |
| §7 跨 OS | 🟡 macOS 跑通；Linux/Windows 没验证 |

## 5. 没做但有意保留的"未来钩子"

- `Session.MemorySink` 是结构化接口而非具体类 → spiral 2 可以挂第二个 sink（如 web UI 的 SSE 推送）
- `DangerContext.recoverSkillNames` 已支持 `recover.*` 自动放行 → spiral 2 可以让 AI 自己创建 recover skill 来扩大放行面
- `Skill` 类型里 `frontmatter.metadata.x_harness.{actor_required, danger_class, ...}` 命名空间已留好 → on-disk skill 可以声明自己的 danger class

## 6. 已知 v0 边界（后续 spiral 升级清单）

1. **shell 解析不展开 `$VARS`** — `rm -rf $X_HARNESS_HOME` 当前看不见
2. **路径规则只有 macOS** — 没考虑 Linux/Windows 自存续路径
3. **on-disk skill 不可执行** — 只能被加载和 list
4. **没有跨会话 memory 检索** — 只能按 session id 看
5. **没有 timeout / max-output 之外的 sandbox** — shell.run 物理上还是 `/bin/sh -lc` 全权
6. **provider 只有 deepseek** — 没多家、没本地模型
7. **没有 UI** — 多 UI 一致性这件事还没机会验证

---

## 2026-06-26 晚 spiral 2/2a v0 — Provenance watermark 落地

### 做了什么

- `@x_harness/provenance` TS 包：`writeAiTouch / readAiTouch / removeAiTouch / trace / summarize`
  - 后端：macOS `xattr(1)` + Linux `setfattr/getfattr`，Windows 显式不支持
  - 兜底：fs 不支持 xattr 时返回 `{ ok:false, error }`，**不抛**
- `Session` 引擎：
  - `pushUser` 跟踪 `humanTurnOrdinal` 与 `lastHumanMessage`（截断 500 字）
  - 新增 `provenance: { xHarnessHome }` opt
  - 在 skill 调用现场注入 `ctx.attachProvenance(absPath)` binder
  - 新增 `MemorySink.onProvenanceAttach`，写入 JSONL `provenance.attach` 条目
- `builtin/file.write`：写盘成功后调用 `ctx.attachProvenance?.(full)`，把 xattr 与 JSONL 同步绑定
- `x trace <path> [--json]`：CLI 子命令，读 xattr → resolve 进 JSONL → 打印 executor / autonomy / 原始人类提示 / 会话 id
- `GET /api/trace?path=` + Web `#/trace` 视图：与 CLI 完全同源（同一个 `trace()` loader）
- `MemoryEntryKind` 新增 `provenance.attach`，replay digest 同步

### 与 Rust 计划的关系（ADR-0001 微调）

本机当前**没有 cargo 工具链**，强行引入会把"零依赖运行"破掉；ADR-0009 也已写明
"JSONL = source of truth, xattr = forward index"。本期决定：
- **shell-out 到 OS xattr CLI** 作为内核占位；
- `crates/x_kernel` 保留作为架构缝；
- 真正写 Rust 的触发条件是：批量/性能/跨 OS 抽象需要原生 syscall（phase ∞）。
- 此后切换 binding 时 `@x_harness/provenance` 公共 API 不变（替换 `XattrOps` 即可）。

### 端到端跑通

`packages/cli/scripts/e2e-provenance.ts` 全绿：
```
xattr   : [...] skill:file.write (human-implied) sess=sess-e2e seq=1
full    : sess-e2e | human-implied | please make a hello note in $HOME
JSONL kinds: [ 'user.message', 'provenance.attach' ]
ALL CHECKS PASS ✅
```
CLI `x trace <path>` 与 Web `GET /api/trace` 输出语义一致（Surface Parity 守住）。

### 已知 v0 边界（spiral 2/2b+ 处理）

1. **autonomy 启发式简陋**：当前只有 "human-implied" / "model-self-initiated" 两个落点；
   "human-instructed" 与 "model-elaborated" 需要消息—动作语义对齐，留 spiral 2/2b。
2. **`originatingHumanMessageSeq` 用 ordinal 近似真实 JSONL seq**：JSONL 里没存 seq 字段，trace 反向查找按 path 匹配 `provenance.attach` 条目即可，影响很小。
3. **builtin/file.write 之外的写动作**（`shell.run` 中的 echo > x、未来的 `file.edit`）尚未挂 provenance hook：等 file.edit 落地一并处理。
4. **xattr 在跨 fs 传输会丢**：JSONL 是真源，可恢复。

# Status — 代码现状一页（spiral 1 close）

> 这一页是给"上下文压缩后的未来 self"看的：当前 repo 里**实际有什么**，对应 vision 和 ADR 里的**哪一条**，**哪些没有**。

更新时间：2026-06-24（spiral 1 close, commit `043cf3d`）。

---

## 1. 已落地的代码包

```
packages/
├── provider/   DeepSeek (OpenAI-compatible SSE) — ADR-0003
├── skills/     v0 loader + 4 builtin + frontmatter parser — ADR-0006
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
| 0006 Skill 五件套 | claude-code 兼容 frontmatter | ✅ builtin 完全 / on-disk skill 加载不可执行 | spiral 2 决脚本运行时（deno？bun？node-vm？） |

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

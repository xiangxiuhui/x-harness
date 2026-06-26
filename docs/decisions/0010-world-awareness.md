# ADR 0010 — World Awareness Strategy (Patrol, Snapshot, Territory)

- **Status**: Accepted (schema & territory config); patrol implementation = spiral 2/2b
- **Date**: 2026-06-26
- **Relates to**: [ADR 0002](0002-actor-tag-macos.md), [ADR 0009](0009-intent-provenance.md) (companion)
- **Implements (slice of)**: spiral 2/2b
- **Future-superseded-by**: ADR-00NN (Phase ∞ Kernel-native witness)

## North Star (Phase ∞)

> **x_harness 的终局不是寄居在 macOS / Linux / Windows 上的 AI 工具，是取代它们的 AI OS。**
>
> 当那天到来：
> - 整个内核都在 AI 手里
> - 所有 syscall / inode / process / packet 都是 AI 的事件流
> - 没有"AI 看不到的角落"
> - 人类的所有 macOS 操作（点 Finder、开浏览器、改配置）都直接进入 AI 的感知

今天**寄居在宿主 OS** 是因为 entitlement / ecosystem / hardware lock-in，**不是终态**。所有过渡期设计都必须满足：**phase ∞ 到来时，这段代码不能成为反向兼容包袱**。

## Context

ADR-0002 + ADR-0009 把 **AI 自己做的事**(witness-by-action) 钉死了——通过 harness 触达的世界被实时打 xattr / JSONL。

但还有**人类直接绕过 harness 修改文件**的情况（用别的编辑器、Finder 拖拽、其它 IDE 改了配置）。在寄居态我们**拿不到全局 syscall 流**，但**不能装作什么都没发生**。

折衷方案：**巡逻 + 快照对比**。AI 不定时环顾自己的领地，对比快照，发现 delta，推断归属。

## Decision

### 1. 三层"知道"语义

```
┌────────────────────────────────────────────────────────────┐
│  L1. Witness-by-action     (ADR-0009)                       │
│      AI 自己做的事，实时打 xattr + JSONL                     │
│      ✅ spiral 1 已落地 (JSONL); spiral 2/2a 加 xattr        │
│                                                            │
│  L2. Witness-by-patrol     (本 ADR)                          │
│      AI 巡逻领地 → 快照对比 → 发现 external delta            │
│      🟡 spiral 2/2b 落地                                     │
│                                                            │
│  L3. Witness-by-kernel     (phase ∞)                         │
│      x_harness IS the OS，所有 syscall 都经过它               │
│      ⏳ 长期目标                                              │
└────────────────────────────────────────────────────────────┘
```

### 2. Territory —— 人类授权的"领地"

> **领地不是 AI 自己定义的，是人类授权的**。AI 无法扩展领地；扩张只能通过人类编辑配置文件。

**配置文件**：`~/.x_harness/territory.yaml`

首次运行时（territory.yaml 不存在），x_harness **自动生成保守默认配置**——只包含 `~/.x_harness` 自家目录。其它一切 → 人类显式 opt-in 添加。

#### Schema (version 1)

```yaml
version: 1

# ─── 巡逻领地 ───────────────────────────────────────────
zones:
  # 每个 zone 一个对象
  - path: <绝对路径或 ~ 开头>      # 必填
    depth: <number | "infinite">  # 必填；扫描深度
    hash: sha256 | blake3 | mtime+size  # 必填；指纹算法
    interval: <duration>          # 必填；e.g. "1h", "6h", "24h"
    notify: silent | on_resume | inline | alert
    track_reads: false            # 可选；ADR-0009 file.read 是否也打 xattr

# ─── 黑名单 ────────────────────────────────────────────
# zone 内符合这些 glob 的路径不入快照
ignore:
  - "<glob>"

# ─── 通知机制 ──────────────────────────────────────────
notify_policy:
  default: on_resume              # 全局默认
  per_zone_override:              # 覆盖（路径 → 策略）
    "<path>": <policy>

# ─── 巡逻调度 ──────────────────────────────────────────
schedule:
  idle_trigger: true              # spiral 3 才生效
  idle_threshold: 5m
  on_resume: true                 # x chat --resume 时先巡一次
  on_session_start: false         # 新 session 启动不强制
  scheduled_via_launchd: false    # spiral 3+

# ─── 隐私与脱敏 ────────────────────────────────────────
privacy:
  hash_only: false
  per_zone_hash_only: {}
  redact_paths_in_jsonl: false

# ─── 自我保护 ──────────────────────────────────────────
self_integrity:
  on_self_modified: observe | warn | require_explain
  protected_paths:
    - <path>
```

#### 通知策略含义

| 值 | 行为 |
|---|---|
| `silent` | 只写 patrol.jsonl 日志，不打扰人 |
| `on_resume` | 下次 `x chat` 启动时摘要汇报（默认） |
| `inline` | 当前 session 在线时立即推送，作为 system message 插入对话 |
| `alert` | `on_resume` + macOS osascript 通知中心弹窗 |

#### 自我保护 (`self_integrity`)

| 值 | 行为 |
|---|---|
| `observe` | 只记录 |
| `warn` | 控制台红字 + 通知中心 |
| `require_explain` | 下次 session 启动前**必须人类回答**"这是你改的吗？"才进 chat —— **最严**，给关键路径用 |

### 3. 默认 territory.yaml（首次启动生成）

```yaml
# ~/.x_harness/territory.yaml
# AI 的授权领地配置。领地由你（人类）授予；AI 无法自行扩张。
# 文件版本：1
# 生成时间：<填入实际时间>
#
# 默认是最保守的："只巡 AI 自家"。想让 AI 感知更广的世界，
# 显式添加 zone（如 ~/Documents, 项目目录等）。

version: 1

zones:
  - path: ~/.x_harness
    depth: infinite
    hash: sha256
    interval: 1h
    notify: alert

ignore:
  - "**/node_modules/**"
  - "**/.git/objects/**"
  - "**/.DS_Store"
  - "**/*.swp"
  - "**/.venv/**"
  - "**/__pycache__/**"
  - "**/dist/**"
  - "**/build/**"
  - "**/target/**"
  - "**/.next/**"

notify_policy:
  default: on_resume
  per_zone_override:
    "~/.x_harness": alert

schedule:
  idle_trigger: true
  idle_threshold: 5m
  on_resume: true
  on_session_start: false
  scheduled_via_launchd: false

privacy:
  hash_only: false
  per_zone_hash_only: {}
  redact_paths_in_jsonl: false

self_integrity:
  on_self_modified: warn
  protected_paths:
    - ~/.x_harness/danger
    - ~/.x_harness/memory
    - ~/.x_harness/territory.yaml
```

**为什么默认这么保守**：
- `~/Documents` 几 GB，首次冷启动全 hash 会让 `x chat` 卡几秒到几分钟
- 领地扩张 = 显式信任授权动作，应该是有意识的，不是隐式默认
- 自家 (`~/.x_harness`) 被外部改是最该警觉的——所以默认 alert
- 用户每加一个 zone 都明白"我同意 AI 巡逻这里"

### 4. 巡逻产物

```
~/.x_harness/patrol/
├── snapshots/
│   ├── <zone-hash>-2026-06-26T15-00.json
│   │   # { version, zone_path, scanned_at, entries: { path: {hash, mtime, size, has_ai_touch} } }
│   └── ...
├── diffs/
│   └── 2026-06-26T21-00.diff.jsonl
│       # 每行一条 diff entry
└── patrol.jsonl
    # 元事件：每次巡逻何时启动 / 持续多久 / 覆盖多少文件
```

**Diff entry schema**：

```json
{
  "ts": "2026-06-26T21:00:00Z",
  "zone": "~/Documents",
  "path": "/Users/xxh/Documents/foo.txt",
  "kind": "modified" | "created" | "deleted",
  "prev_hash": "abc...",
  "curr_hash": "def...",
  "prev_mtime": "...",
  "curr_mtime": "...",
  "size_delta": 42,
  "has_ai_touch_now": false,
  "attribution": "ai" | "external" | "ai-but-untracked" | "unknown"
}
```

### 5. 归属推断算法

```
def attribute(diff):
    if file 现在有 ai_touch xattr 且 xattr.ts > prev_snapshot.ts:
        cross_check_jsonl()
        if JSONL 找到对应 entry:
            return "ai"
        else:
            🚨 ALERT: xattr 伪造
            return "ai-but-untracked"

    if 文件没有 ai_touch xattr:
        # 可能：人类改了 / cp -X 丢失 / tar 解压
        if 路径属于 ~/.x_harness/memory:
            # memory 永远是 AI 自己写的
            return "unknown"  # → 触发 self_integrity 检查
        return "external"

    return "unknown"
```

### 6. 与 ADR-0009 的协同

- ADR-0009 是 L1（实时打标）
- 本 ADR 是 L2（事后对比）
- L1 缺失（xattr 丢）时，L2 提供 fallback 归属
- L2 alert 时，引用对应 L1 JSONL entry 让人类回溯

## Consequences

- 人类的领地授权动作是**显式且可审计**的——territory.yaml 本身在 git 友好的 zone 里
- AI 不能自行扩张领地（safety）；但**可以建议**用户加 zone（通过 chat）
- 巡逻产物本地存储，不出网
- snapshot/diff 文件随时间增长 → 加 retention 策略（保留 N 天，超时归档；spiral 3 实装）

## Open Questions

- **首次启动 cold-scan 仍然慢吗**？只巡 `~/.x_harness` 应该很快，但要测；如果慢需要后台异步
- **`schedule.scheduled_via_launchd`** 在 spiral 3 怎么生成 launchd plist？这块对 macOS Apple notarization 友好吗？
- **跨设备同步**：如果用户同时在两台 mac 上跑 x_harness 都指向同一个 iCloud Drive 区域，谁的 territory 说了算？倾向：每个 host 独立 territory，patrol 产物按 hostname 分桶
- **territory.yaml hot-reload**：编辑后是 session 重启生效，还是热加载？倾向 spiral 2 重启生效；spiral 3 加 fs watch

## 实施位置

- 配置 schema + loader: `packages/core/src/territory.ts` (spiral 2/2b)
- 默认配置生成: 在 `packages/cli/src/chat.ts` 首次启动钩子 (spiral 2/2a 提前埋)
- patrol 实现: `packages/core/src/patrol/` (spiral 2/2b)
- CLI: `x patrol now` / `x patrol diff <since>` / `x patrol zones` (spiral 2/2b)
- 测试: `packages/core/test/territory.test.ts` + `packages/core/test/patrol.test.ts`

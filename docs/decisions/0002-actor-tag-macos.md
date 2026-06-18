# ADR 0002 — macOS Actor 标签落地方案

状态：**Accepted (MVP)** / **Upgrade Path Reserved**
日期：2026-06-18

## Context

x_harness 的核心抽象之一是 **actor 一等公民**（见 `docs/vision.md` §3 / `docs/architecture.md` §4）。
任何外部观察者必须能当场判定一个文件 / 一条命令 / 一次网络请求来自 `human` / `model` / `system`。

第一螺旋仅需要落地"文件"这一资源类型的 actor 标签。

## Options

| 方案 | 描述 | 优点 | 缺点 |
|------|------|------|------|
| A. 文件 xattr `com.x_harness.actor` | 写文件时附带扩展属性 | macOS 原生支持、无签名要求、`xattr` CLI 可见 | 跨文件系统时可能丢失（FAT、部分网络盘）；不能拦截非 x_harness 的写入 |
| B. Endpoint Security framework | 系统级 ES 客户端，监听 mac OS audit | 全局拦截、跨进程可见 | 需要苹果开发者签名 + entitlement；增加分发成本 |
| C. 自建 audit daemon（FSEvents + 写日志） | 用户态 daemon 监听文件系统事件 | 不需签名，跨进程可见 | 不能"打标签"，只能"事后追因"；竞态多 |
| D. 单独的"actor 数据库" | 文件路径 + actor 双向映射存到 sqlite | 不污染文件本身 | 路径变化（mv/rename）就丢失关联 |

## Decision

**MVP 采用 A（xattr `com.x_harness.actor`）**，并为升级到 B 预留接口。

具体落地：

### A.1 xattr key 规范

| key | 值 | 说明 |
|-----|----|------|
| `com.x_harness.actor.kind` | `human` / `model` / `system` | 一等分类 |
| `com.x_harness.actor.id` | string | 例：`user:xxh` / `model:deepseek/deepseek-chat:sess-abc` / `system:scheduler` |
| `com.x_harness.actor.session` | string | 关联 actor 总线事件 |
| `com.x_harness.actor.ts` | RFC3339 | 写入时间 |
| `com.x_harness.actor.parent` | string | 因果链上一跳的 event id（可选） |

### A.2 写入策略

- 由 Rust 内核 `x_kernel::actor::tag_file(path, actor)` 统一负责。
- TS 外壳的 `file.write` / `file.edit` skill 在写入完成后**立刻**调用 kernel 打标签。
- shell 命令产生的副作用文件（如 `>` 重定向）在第一螺旋**不打标签**，但 audit log 会记 actor。

### A.3 读取策略

- UI 渲染文件 / artifact 时，先读 xattr，命中则展示 actor 徽标。
- 找不到 xattr 的文件 → 渲染 "unknown actor"，不臆测。

### A.4 不可靠场景的明示

文档中（README + UI 提示）明确告知用户：
- xattr 在拷贝到 FAT/exFAT/部分 SMB/NFS 时会丢失。
- `cp -p` 或 `cp -X` 才能保留 xattr；普通 `cp` 在 macOS 默认保留，但 Linux 不保留。
- **xattr 不是安全边界，是审计辅助。**

## Upgrade Path（向 B 升级的兼容设计）

为避免日后从 A 升级到 B 时大改外部 API，本期就抽象出统一接口：

```rust
// crates/x_kernel/src/actor.rs (spiral 1)
pub trait ActorTagBackend {
    fn tag_file(&self, path: &Path, actor: &Actor, ctx: &TagContext) -> Result<()>;
    fn read_file_actor(&self, path: &Path) -> Result<Option<TaggedActor>>;
}

pub struct XattrBackend;          // 第一螺旋实现
// pub struct EndpointSecurityBackend;  // 螺旋 2/3 实现
```

- TS 外壳通过 NAPI 调用 `kernel.actor.tagFile(path, actor)`，**不直接接触 xattr**。
- 切换 backend 时只改 kernel 内部 + 重新打包，外部 API 不变。
- 同时升级到 B 时，xattr backend 可作为 **fallback**（B 拦截不到的场景，A 仍能补一刀）。

## 兼容性 / 数据迁移

- 升级到 B 后，老文件上的 xattr **不重写**：B backend 读取时优先读 ES 索引，未命中再回落读 xattr。
- 设计 `read_file_actor` 返回的 `TaggedActor` 携带 `source: "xattr" | "es" | "audit-log"`，UI 上区分置信度。

## Consequences

- 第一螺旋不需要任何苹果签名 / entitlement，可零摩擦本地开发。
- 升级到 ES 时只动 kernel，不动 TS 外壳。
- 多 actor 标签的"打标人"自身也是 actor，一律为 `system:kernel`，避免循环依赖。

## Open Questions（推迟到落地时再敲）

- xattr 如果被人手动篡改，UI 要不要提示？（候选：在 actor 总线 audit log 里做一致性校验）
- 网络资源（HTTP 请求、socket）的 actor 标签，目前仅在 audit log 持久化，不试图打到内核流量层（推迟到螺旋 3）。
- Linux 落地：`user.x_harness.actor.*` 命名空间 xattr，机制等价；细节在做 Linux 螺旋时再写一份 ADR。
- Windows 落地：NTFS Alternate Data Streams 或外部数据库二选一，待 ADR。

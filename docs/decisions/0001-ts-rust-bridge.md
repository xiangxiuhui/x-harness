# ADR 0001 — TS↔Rust 桥

状态：**Accepted**
日期：2026-06-18

## Context

x_harness 使用 TS 外壳 + Rust 内核双层架构（见 `docs/architecture.md`）。
TS 代码需要调用 Rust 内核能力：actor 标签读写、危险操作守卫、高频系统 IO。

## Options

| 方案 | 描述 | 优点 | 缺点 |
|------|------|------|------|
| A. NAPI-RS | Rust crate 编译为 Node native module | 调用接近零开销；类型友好；生态成熟 | 多平台预编译产物多；ABI 绑死 Node 版本 |
| B. JSON-RPC over stdin/stdout | Rust 作为子进程，TS 通过管道 RPC | 解耦干净；Rust 可独立守护进程化；语言中立 | 调用有序列化成本；进程生命周期管理复杂 |
| C. 共享内存 / mmap | Rust 写共享内存，TS 用 N-API 读 | 大数据传输极快 | 复杂、跨 OS 行为差异大 |

## Decision

**第一螺旋使用 A（NAPI-RS）作为唯一桥**。

第二螺旋当 guard 守护进程化、远程节点出现时，**新增** B 作为补充（不替换 A）：
- A：高频、同进程能力（actor tag 读写、syscall 包装）
- B：守护进程式、跨进程能力（guard daemon、远程 x_harness 节点）

## Why not B from day 1

- 第一螺旋只有同进程调用需求，B 的解耦优势用不上。
- 守护进程模型在 mac/linux/win 上的细节差异大，第一螺旋不想吃这成本。
- A→B 共存的代码改动极小（封装在 `packages/core/src/kernel-bridge.ts` 一处）。

## 实施约定

```
crates/x_kernel/                # Rust 库
  ├─ src/lib.rs                 # 普通 Rust API
  └─ napi/                      # NAPI-RS 绑定层（独立 crate / 独立 Cargo.toml）
packages/core/src/kernel-bridge.ts
                                # 唯一接触 native 模块的地方；
                                # 业务代码只调它的 high-level 函数
```

预编译产物目标（第一螺旋）：
- `darwin-arm64`
- `darwin-x64`
- 其他平台（linux/win）推迟到对应螺旋。

## Open Questions

- NAPI-RS 在 Node 22+ 的兼容性需要验证（应该没问题，但先跑一下）
- 是否走 `@napi-rs/cli` 的 monorepo 集成？（建议是）

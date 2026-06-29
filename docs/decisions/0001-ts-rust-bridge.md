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

---

## 2026-06-29 Amendment — Pulse Check：什么时候 Rust 不再能继续推迟？

> 截至此日：`crates/x_kernel/` 仍只有占位 `lib.rs`。决议：**继续推迟**，但**显式列出触发条件**，避免无意识漂移。

### 现状回顾（spiral 1+2 全程靠 TS shell-out）

| 能力 | 原本 ADR 假设 | 实际形态 |
|---|---|---|
| actor xattr 读写 | NAPI-RS 调 syscall | TS `spawnSync('xattr')` / `setfattr` |
| 危险规则集 | Rust 内核拦截 | TS 纯函数 `@x_harness/danger`，14 测试通过 |
| Provenance watermark | (未规划) | TS `@x_harness/provenance`，shell-out 到 xattr CLI |
| Shell.run redirect → provenance | (未规划) | TS 静态 lexer + stat mtime diff，无 syscall |

**结果**：spiral 1 + spiral 2 (1/2/3/4/5/2a/2b) 全套已落地，**零 Rust 代码**，端到端跑通，用户可装可跑。

### 这套打法的成本

`spawnSync('xattr')` 一次大约 5–10ms。当前所有调用路径都是**每会话一次或每文件一次**，不是热路径。
体感无延迟（实测在 `e2e-shell-provenance.ts` 中跑完 18 个 check < 300ms）。

### 触发 Rust 的硬条件（任一即启动）

1. **批量 xattr 扫描** — `x trace --recursive <dir>` 之类需要扫数千文件 → `spawn` 100 次 = 1 秒级，体感明显。NAPI-RS 直调 syscall ~0.01ms/次。
2. **跨 OS 抽象需要原生 syscall** — Windows 没有 `xattr` 等价品；要做 ADS (Alternate Data Stream) 或 sidecar `.x_harness.meta.json`。这种**抽象层**用 Rust 写更省心。
3. **danger guard 落到 OS hook** — 当 guard 从"AI 自己 spawn 前检查"升级到"任何子进程 syscall 拦截"（LD_PRELOAD / DYLD_INSERT_LIBRARIES / eBPF），就**只能** Rust。
4. **远程 x_harness 节点** — Rust daemon + JSON-RPC over TCP/Unix socket，actor 跨主机一致。
5. **TS 已经实在写不下** — 单包 > 5k 行、调用图> 3 层 native 间接，或同一逻辑因 OS 差异 fork 出 N 份实现。

### 截止 spiral 2 close 前的雪球检查

| 风险信号 | 当前 | 阈值 | 状态 |
|---|---|---|---|
| TS 包数 | 9 | 12 | 🟢 |
| TS 总行数 | ~6k | 15k | 🟢 |
| shell-out 调用密度 | per-file | per-line / per-syscall | 🟢 |
| OS 差异分支数 | macOS / Linux 二分（xattr.ts 内） | 三 OS × 多能力交叉 | 🟢 |
| 跨进程通信需求 | 0 | 任一 | 🟢 |

**结论**：当前没有任何信号说明 Rust 不动会"越来越搞不动"。**反过来**：在 spiral 2 全套已 ship 之后才动 Rust，**接口稳定度反而最高**——所有调用方都已经定型为 `@x_harness/provenance.writeAiTouch()` 这种纯 TS 函数签名，将来把实现替换为 NAPI 时，**外部一行都不用改**。

### 何时复审本 amendment

- spiral 3 启动前（跨 OS 落地、MCP client、第二 provider）
- 或上面 5 个触发条件中**任一**点亮

如复审仍判 "continue defer"，再次在本文件末尾盖戳。

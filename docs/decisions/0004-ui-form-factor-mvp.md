# ADR 0004 — UI 第一形态：本地 Web，预留 Tauri 升级

状态：**Accepted**
日期：2026-06-18

## Decision

- 第一螺旋：CLI（packages/cli） + **本地 Web UI**（packages/web，原计划名 packages/ui，实际落在 spiral 2/3）。
- 第二螺旋及以后：Tauri 包壳 → System Super App（带托盘 / 全局快捷键 / 麦克风 / 浏览器插件协同）。
- **第一螺旋的 Web 必须按"将来要被 Tauri 包"的方式来设计**，不能临时性。

## 为什么第一版不直接上 Tauri

- 螺旋 1 的目标是"端到端跑通"，Tauri 自身的打包、签名、IPC 学习成本会拖慢。
- 纯 Web 有最快的 inner-loop（hot reload、调试方便）。
- Tauri 后期可以**直接复用** Web 资源 + 把今天对 core 的 HTTP/WS 调用替换成 Tauri 命令。

## Web ↔ Tauri 的兼容设计（关键）

为避免"今天写的 Web 明天 Tauri 化要重写"，从一开始就遵守以下约束：

### R1. 前端不直接访问 OS / 文件系统

前端代码**永远只调 `core` 暴露的 API**，**不**用 `window.fs`、`navigator.usb` 这类直连能力。
今天 `core` 通过 HTTP/WS 暴露，Tauri 化后改成 `invoke()`，前端只换 transport。

### R2. 抽象统一的 RPC 客户端

```
packages/web/src/transport/
  ├─ rpc.ts          # 统一的 client interface
  ├─ http.ts         # 第一螺旋实现：fetch + SSE/WebSocket
  └─ tauri.ts        # 第二螺旋实现：@tauri-apps/api invoke
```

构建时根据环境变量 `X_HARNESS_TRANSPORT=web|tauri` 选择实现。
前端业务代码**不感知 transport**。

### R3. Core 既能跑独立 HTTP 服务，也能被 Tauri 嵌入

`packages/core` 提供两种启动入口：
- `core.startHttpServer({ port })`：第一螺旋
- `core.handle(req): Promise<resp>`：纯函数式入口，Tauri 命令直接调

第二种入口才是"本体"；HTTP server 只是它的薄壳。

### R4. 状态权威在 core，不在前端

- 会话、actor、artifact、memory 都由 core 管。
- 前端只存"为了渲染好看"的临时状态（滚动位置、折叠等）。
- 这条保证了"多 UI 同时存在时视图一致"（vision §4）。

### R5. UI 不用浏览器专属能力做核心功能

- 通知用 core 抽象 → 浏览器走 Notification API、Tauri 走系统通知。
- 文件拖拽进来 → 上传给 core，由 kernel 处理；前端不直接读文件。
- 全局快捷键 → 第一螺旋不做（浏览器做不了），等 Tauri。

### R6. Actor 徽标渲染从 day 1 开始

每个消息 / artifact 的渲染必须显示 actor 徽标（来自 `core` 返回的 actor 字段，见 ADR 0002）。
Tauri 化时这套渲染零修改。

## 第一螺旋 UI 技术栈

- 框架：**Vite + React + TypeScript**（最简）
- 状态：**zustand**（轻量，不引入 Redux 体系）
- 样式：**Tailwind CSS v4**
- 通信：**fetch + EventSource (SSE)**（流式 chat）
- 目录：

```
packages/web/
  ├─ index.html
  ├─ vite.config.ts
  ├─ src/
  │   ├─ main.tsx
  │   ├─ app.tsx
  │   ├─ transport/      # R2
  │   ├─ components/
  │   │   ├─ ActorBadge.tsx     # R6
  │   │   ├─ MessageList.tsx
  │   │   ├─ ArtifactView.tsx
  │   │   └─ ConfirmDialog.tsx  # 危险操作确认
  │   └─ stores/
```

## CLI（packages/cli）

- 命令：`x chat`、`x run <task>`、`x ui`（启动本地 web）、`x ls-actor <path>`（读 xattr）
- 与 core 通过同一份 RPC 客户端通信（CLI 内嵌 transport/http.ts）
- 任何 stdin/stdout 来自人类的 → actor=human, surface=cli

## Tauri 升级时要做的事（提前评估）

| 项 | 工作量 | 风险 |
|---|--------|------|
| 把 core 包成 Tauri sidecar 或 in-process | 中 | low |
| 实现 `transport/tauri.ts` | 小 | low |
| 全局快捷键 / 托盘 | 小 | low |
| 系统通知 / 文件协议 | 小 | low |
| 麦克风采集 | 中 | medium（权限弹窗） |
| 浏览器插件桥接（与 Tauri app 共享 session） | 大 | high（推迟到螺旋 3） |
| 代码签名 / 公证 | 中 | medium（macOS 必做） |

→ 总体可控，前提是 R1–R6 在第一螺旋严格执行。

## Consequences

- 第一螺旋必须容忍"Web 启动慢一点的麻烦"（先开 core 再开 ui）。
- `x ui` 命令同时启动 core HTTP server + 浏览器打开页面，给单命令体验。
- 升级 Tauri 时主要工作是**打包**而不是**重写**。

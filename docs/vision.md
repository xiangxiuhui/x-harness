# Vision — x_harness

> 北极星目标：让 x_harness 成为一台 PC（以及它能通过网络触达的一切）的 **AI 操作系统**。

## 0. North Star — x_harness IS the OS

x_harness 的**终局不是寄居在 macOS / Linux / Windows 上的 AI 工具，是取代它们的 AI 操作系统**。

当那天到来：

- 整个内核都在 AI 手里
- 所有 syscall / inode / process / network packet 都是 AI 的事件流
- 人类的所有操作（点 Finder、开浏览器、改配置、外设输入）直接进入 AI 的感知
- **没有 "AI 看不到的角落"**

今天我们寄居在宿主 OS 是因为 entitlement / ecosystem / hardware lock-in，**不是终态**。

**所有过渡期设计都必须满足**：phase ∞ 到来时，这段代码不能成为反向兼容包袱。具体地：
- xattr / JSONL audit / territory zones 这些 schema → phase ∞ 的内核事件流是它们的超集
- 不为短期方便采用"只有寄居态有意义"的抽象
- 任何寄居态的折衷（巡逻 vs 实时审计，xattr vs 全息事件流）都标注 phase ∞ 替代物

## 1. 我们要做的不是什么

- ❌ 不是 IDE 插件
- ❌ 不是 chat-only 助手
- ❌ 不是另一个 "code agent"
- ❌ 不额外发明 DSL / 框架 / 约束

## 2. 我们要做的是什么

x_harness 把以下三层视为**同一件东西**的不同切面：

| 层 | 角色 |
|----|------|
| 计算机硬件 | 物理环境 |
| 操作系统（macOS / Linux / Windows） | 虚拟环境 |
| x_harness | 把人类一切信息工具体系暴露给 AI 与人类共同使用的 harness |

它是一个 **通用办公型 harness**：编程只是一种 office work，写文档、查邮件、跑数据、运维服务器、控制浏览器、操作内部系统都同等公民。

## 3. 一等公民：Actor 身份

x_harness 的 OS 视角下，每一个动作必须能被回答：

> **"这是谁干的？"**

可能的答案只有 3 类：
- `human` — 人类直接发起
- `model` — 由 LLM/agent 决策发起
- `system` — x_harness 自身（调度器、定时任务、健康检查等）

设计要点：
- Actor 标签下沉到 **系统级**（macOS 的进程标签 / 文件 xattr / audit log；Linux 的 audit subsystem；Windows 的 ETW），不是上层 metadata。
- 任何外部观察者（包括 x_harness 的 UI、其他 agent、人类 review）都能**当场判定**一个文件、一条命令、一次网络请求来自谁。
- 这是后续"自学习进化"的基础数据：进化数据 = 人类对 model 行为的纠正记录。

## 4. UI 的唯一两个用途

x_harness 的 UI 形态会非常多元（CLI / 浏览器插件 / System Super App / 麦克风 / 用户操作），但**用途只有两个**：

1. **视图（View）**：呈现交付物 + 中间产物。
2. **协作（Collaboration）**：接收人类的指令、纠正、标注。

引申原则：
- 任何 UI 不应自己藏状态；状态归属于 core。
- UI 不创造能力；能力来自 skills / kernel。
- 多 UI 同时存在时，对同一会话看到的视图应一致。

## 5. 权限策略：信任但可审计

**前提立场**：x_harness 是给 AI 使用的操作系统；AI 是常驻主人，人类是协作者/审计者。我们**不替 AI 自我审查**。

- 默认 **裸跑**：模型可以执行系统命令、读写文件、访问网络、装软件、`sudo` 任意命令。
- **危险信号**只来自两类（详见 [ADR 0005](decisions/0005-danger-rules.md)）：
  - **Class A — 人类账号 / 资金权益类**：动作副作用作用在人类账户/信用/资金，且不可由 x_harness 自行回滚。
  - **Class B — x_harness 自存续类**：动作可能让 x_harness 无法继续工作或回到稳定状态。
- 命中 → 弹确认 → 走 actor 总线"human-approved"。
- **全量审计**：每一次 tool 调用、每一次 IO 按 actor 标签持久化，可回放。
- 后期可选 sandbox（macOS seatbelt / Linux landlock / Windows AppContainer），但 sandbox **不是必须项**——它是 Class B 的"再下一层防御"，不是普适约束。

## 6. 自学习进化

进化的"原料"不是 reward model，而是：

```
(model action, human correction, context) 三元组
```

来源：
- UI 上人类的纠正/标注
- 危险操作确认时的批准/拒绝
- 后台任务的事后审阅

进化的"产物"：
- 个性化的 skill（项目级 / 用户级）
- 个性化的 memory（事实 / 偏好 / 禁忌）
- 个性化的 prompt 片段

进化的"边界"：
- 进化产物本身也是 artifact，受 actor 标签管理；人类可看、可改、可回滚。

## 7. 跨 OS 路线

- **第一螺旋**：macOS 跑通；Linux 通过镜像验证可运行。
- **第二螺旋**：Linux 原生 + Windows native 编译通过。
- **第三螺旋**：跨 OS 一致的 actor / 审计 / 危险操作守卫。

> **当前状态**（2026-06-24, spiral 1 close）：
> macOS 端到端可用（CLI 形态）；actor 在应用层已经是一等公民（事件总线 + memory entry 都带 actor），
> 但**还没下沉到 OS 级 xattr**（spiral 2 起步项）。Linux/Windows 没验证。
> 实际进度详见 `docs/status.md`。

## 8. 反目标 / 红线

- 不为讨好某家模型而牺牲架构清晰度。
- 不让 UI 成为状态主宰。
- 不让 actor 区分变成一个"软"约定（必须系统级硬支持）。
- 不在第一螺旋追求多 provider，先把一条端到端跑透。

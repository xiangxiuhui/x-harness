# Roadmap — 螺旋升级路线

每一螺旋必须满足三个条件：
1. **最小** —— 不做超出本螺旋目标的事
2. **最新** —— 用最新的 model / 工具链
3. **可使用闭环** —— 自己能在日常工作里用起来

---

## 螺旋 0：对齐与铺路（当前）

- [x] 4 个参考项目可达性确认
- [x] 仓库骨架
- [x] vision / roadmap / architecture 文档
- [ ] git submodule 接入参考项目
- [ ] 决定第一螺旋使用的 model provider（**待定**）
- [ ] 决定 actor 标签的 macOS 落地方案（xattr `com.x_harness.actor` 是当前候选）

**交付物**：能在 `docs/` 里展开后续讨论的一份对齐文档集。

---

## 螺旋 1：macOS 端到端最小闭环（MVP-α）

> 目标：从 CLI 或 UI 发一条任务，model 调用 1-2 个工具完成，UI 上看到中间产物，人类能改，改完进入"进化原料"。

### 1.1 CLI（packages/cli）
- `x` 命令：`x chat`、`x run <task>`、`x ui`
- 标准输入/输出绑定 `actor=human`
- 每条命令落 audit log

### 1.2 UI（packages/ui）
- 形态：本地 web（Vite + React + TS），**按"将来包 Tauri"的约束设计**，详见 [ADR 0004](decisions/0004-ui-form-factor-mvp.md)
- 视图：会话流 + 当前交付物 + 中间产物
- 协作：消息输入 + 行级标注 + "确认/拒绝危险操作"
- **每条消息/动作必带 actor 徽标**（系统级标签的可视化，详见 [ADR 0002](decisions/0002-actor-tag-macos.md)）

### 1.3 Provider（packages/provider）
- 抽象 `Provider` interface（不过度设计，够用即可）
- 第一个实现：**DeepSeek**（OpenAI-compatible，详见 [ADR 0003](decisions/0003-first-provider.md)）

### 1.4 Skills 运行时 v0（packages/skills）
- Skill 形态参考 claude-code（前置 frontmatter + body）
- 第一螺旋 built-in skills：
  - `shell.run`（受 kernel 危险守卫保护）
  - `file.read` / `file.write` / `file.edit`
  - `web.fetch`
- 用户/项目级 skill 目录扫描

### 1.5 记忆 / 知识 v0（packages/memory）
- 三层存储：
  - **事实**（key-value）
  - **偏好**（带 actor 来源、置信度）
  - **禁忌**（人类显式说"别这么做"）
- 检索：先纯关键词 + 简单 embedding（够 MVP）
- 所有 memory 项必须带 actor 来源

### 1.6 自学习进化 v0（在 memory 里实装）
- 仅做"采集 + 视图 + 接受/拒绝按钮"
- 不做自动训练；进化产物是结构化提示片段 / skill 草稿

### 1.7 Rust 内核（crates/x_kernel）
- v0 只做两件事：
  1. **Actor 标签写入**：进程启动时打 actor 标签；写文件时设置 xattr
  2. **危险操作守卫**：rm -rf / sudo / 写系统目录 / 网络写 → 弹确认（通过 IPC 通知 TS 外壳）
- TS↔Rust 通过 NAPI-RS 或 stdin/stdout JSON-RPC（架构文档里定）

### 1.8 验收
- 自己用 x_harness 完成一次"读取本地某项目 README → 总结 → 写到 ~/Desktop/summary.md"任务
- audit log 完整、actor 区分正确
- 一次危险操作（如 `rm` 测试目录）触发确认

---

## 螺旋 2：跨 OS + 多入口 + MCP

- Linux 原生跑通
- 浏览器插件入口（看作另一个 UI，仍只做"视图+协作"）
- 麦克风入口（语音 → 文本 → core）
- 引入 MCP client（接管"网络触达的工具环境"）
- 多 provider

## 螺旋 3：Windows + 远程触达

- Windows native
- 远程 x_harness 节点（同一 actor 体系跨主机一致）
- 任务可在远端执行、本地视图

## 螺旋 N：进化闭环加深

- 半自动 skill 生成
- 个性化 prompt 自动注入
- 行为偏好的多人多终端同步（家庭/团队场景）

---

## 关键决策（已落 ADR）

- ✅ 第一螺旋 model：**DeepSeek**（[ADR 0003](decisions/0003-first-provider.md)）
- ✅ UI 形态：**本地 Web（Vite+React），按"将来包 Tauri"约束设计**（[ADR 0004](decisions/0004-ui-form-factor-mvp.md)）
- ✅ macOS Actor 标签：**xattr `com.x_harness.actor.*`，预留 ES 升级路径**（[ADR 0002](decisions/0002-actor-tag-macos.md)）

## 仍待对齐（不阻塞螺旋 1 启动）

- [ ] DeepSeek 流式协议在弱网下的重试参数（边跑边调）
- [ ] 危险操作命中规则的初始版规则集（先列在 docs/decisions/0005-danger-rules.md，待写）
- [ ] memory 的 embedding 是否第一螺旋就接（候选：先纯关键词，第二螺旋上 embedding）

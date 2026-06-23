# 参考项目对照框架

> 我们不抄任何一家的整体设计，但每一家都有值得吸收的局部。
> 本目录用于把"借鉴点"显式记录下来，方便后续追踪上游更新。

## 4 个参考项目

| Repo | 主语言 | 锁定版本 | 核心借鉴重点 |
|------|--------|----------|--------------|
| [hermes-agent](https://github.com/NousResearch/hermes-agent) | Python | `426f321e8` (v2026.6.5-1259) | 自学习闭环 / agent-curated memory / "core 窄腰、能力外置" 哲学 / 多入口同 core / agentskills.io 标准 |
| [openclaw](https://github.com/openclaw/openclaw) | TypeScript | `95c256fa98` (v2026.4.19-beta.2-27635) | TS 工程结构（packages+extensions 双层）/ 144 个 extension 切分思路 / doctor/onboard 体验 / memory 槽位独占 / plugin code-vs-bundle 二分 |
| [claude-code](https://github.com/anthropics/claude-code) | TypeScript（仓库主要是插件） | `423563cfe` (v2.1.181-1) | **Plugin 五件套协议**（commands/agents/skills/hooks/.mcp.json）/ Skill = frontmatter + body / hookify "把人类纠偏沉淀为规则" |
| [codex](https://github.com/openai/codex) | Rust + TS | `c73296a0f` (python-v0.1.0b3-482) | **Rust 巨型 workspace 切分**（80+ crate）/ agent-identity crate / 跨 OS sandbox 三件套 / app-server 守护进程协议 / rollout audit / TS↔Rust 双语 monorepo 布局 |

## 借鉴维度（每个参考项目都填这张表）

每个参考项目在本目录下建一个文件：`hermes.md` / `openclaw.md` / `claude-code.md` / `codex.md`。

详见各文件，每份都已落地以下 4 大块：
- 仓库形态速览
- ★ 我们要吸收的（带"状态"列：ADOPT / TRACK / DEFER / TODO / ALIGN / EVAL）
- 我们明确不要的
- 上游需要持续跟踪的特性
- 提取的 ADR 候选
- 一句话定位

## 跨项目交叉结论（4 份对照后）

下面是把 4 份 comparison 横向汇总后得出的结论，会进入 vision/architecture 的下一次修订：

### 共同观察到的设计哲学

1. **核心窄腰，能力外置**（hermes、openclaw 同口径）—— 我们已写进 vision §2，现在有了双重外部佐证。
2. **memory 是独占槽**（openclaw 明确）—— 第一螺旋的 memory v0 不要给"多 backend 并存"留口子。
3. **Skill = frontmatter + body**（claude-code、hermes 都这样）—— ADR 0006 立刻能定。
4. **跨 OS sandbox 必须 Rust 写**（codex 已有现成实现）—— 螺旋 2/3 的 ADR 直接对照。
5. **守护进程化是迟早的事**（codex `app-server*` 已经做了）—— ADR 0001 B 方案的存在被验证。
6. **agent-identity 应是独立组件**（codex 把它单独成 crate）—— 给我们 actor 一等公民再添一票。

### 谁负责"什么"的最佳样板

| 维度 | 最佳样板 | 备注 |
|------|----------|------|
| Skill / Plugin 协议 | claude-code | 五件套结构最清晰 |
| 工程结构 / 包切分 | openclaw（中规模）/ codex（大规模） | 节奏由场景驱动 |
| 自学习闭环方法论 | hermes | 不抄实现，抄取舍 |
| Rust 内核能力 | codex | 跨 OS sandbox / agent-identity / hooks |
| TS↔Rust monorepo 布局 | codex | 直接照搬 |
| 多入口共用 core | hermes、openclaw 都对 | 与 ADR 0004 R3 同向 |
| memory 槽位独占 | openclaw | 第一螺旋就要遵守 |
| 危险操作规则集 | claude-code/security-guidance + codex/execpolicy | ADR 0005 同时取材 |

## 维护节奏

- 每个螺旋开始前，跑一次 `git submodule update --remote`，扫一眼上游 release notes。
- 把值得吸收的进展按上面模板增量写入对应文件。
- 不直接把上游代码 copy 进 packages/，所有借鉴都要重写或重新设计。

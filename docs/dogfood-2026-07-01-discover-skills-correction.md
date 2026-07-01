# Correction Report — discover-skills 会话问题根因纠偏（2026-07-01）

**Session:** `/Users/xxh/.x_harness/memory/sess-tkf3srzi.jsonl`
**用户反馈:** Claude Opus 4.7 认为 `~/.x_harness/config.json` 不存在 / compaction 未启用，但用户实际已创建并修改。

## 结论

Claude 的判断是错的：

1. `~/.x_harness/config.json` 确实存在，mtime 是 `2026-07-01T06:14:51Z`。
2. 目标 session 第一条记录是 `2026-07-01T06:17:17Z`，即 config **早于 session 启动约 2 分钟**。
3. installer 运行目录 `/Users/xxh/.x_harness/src` 已经是 `9b32e99 spiral-3 P0`，包含 ADR-0013 config 接线。
4. `sess-tkf3srzi` 产生了 sidecar：
   `/Users/xxh/.x_harness/sessions/sess-tkf3srzi/tool-outputs/call_00_wAYQJMX9X5Bjr39ek4yh6863.txt`
   大小约 65KB，mtime `2026-07-01 14:27`。

这说明：**compaction/tool-output-prune 至少部分生效过**。

## 直接原因：为什么 Claude 会误判

### 1. 它把“JSONL 里没有 `context.compacted`”误当成“compaction 没启用”

实际代码里 `context.compacted` 是 `ActorBus` 事件，当前 CLI 没有订阅并持久化这个 bus 事件到 memory JSONL。`chat.ts` 的 memory sink 只持久化：

- system prompt
- user message
- assistant message
- tool call
- tool danger / approval
- tool result
- provenance attach

但没有 `context.compacted` / `error` bus event sink。

所以：

> `grep context.compacted ~/.x_harness/memory/sess-*.jsonl` 没结果，只能说明“没被持久化”，不能说明“没发生”。

sidecar 文件才是本会话里更强的证据。

### 2. 它看了 memory JSONL 的原始 append log，而不是 live message buffer

ADR-0013 compaction 改的是 `Session.messages` 的**内存态 live context**，不会回写历史 JSONL。JSONL 是审计流水：已经 append 的 65KB `tool.result` 不会被改写。

因此从 JSONL 粗算 token 会高估“模型实际下一轮看到的上下文”。本次 65KB 工具输出在下一轮 provider request 前已经被 `tool-output-prune` 侧路落盘了。

### 3. 它没有检查真正的 runtime source

项目有两个位置：

- 开发仓：`/Users/xxh/xxh/x_harness`
- installer 运行仓：`/Users/xxh/.x_harness/src`

判断用户实际 `x chat` 行为必须看 `/Users/xxh/.x_harness/src`。该目录已是 `9b32e99`，且 `chat.ts` 已经接入：

- `loadConfig(xHarnessHome)`
- `compactionFromConfig(xhConfig)`
- `makeTiktokenTokenizer(provider.defaultModel)`
- `new Session({ compaction: ... })`

## 当前会话真实不流畅的直接原因

### A. max-rounds cap 是最主要的交互中断点

创建 skill 的过程消耗多轮工具调用：

1. 探索 skill 目录
2. 读 greet/pdf SKILL.md
3. ls research-skill
4. cat territory.yaml
5. mkdir discover-skills
6. write SKILL.md
7. write discover.sh
8. chmod

Session 默认 `maxToolRounds = 8`。命中后会向 messages 追加一条：

`[x_harness] tool-call loop hit the max-rounds safety cap; please respond to the user without calling more tools.`

下一次用户问“帮我看看当前有什么不错的视频剪辑的技能”时，模型被这条残留上下文影响，直接说“我刚才回合数达到上限”。

### B. `~/.x_harness/skills/` 写入触发 Class B danger guard 多次确认

写 `SKILL.md`、写 `discover.sh` 都触发：

`B1.write-x_harness-home`

规则里写了 `recoverableBy: ['recover.x_harness_home']`，但 recover-skill 实际没落地，所以每次都要用户 y。

### C. 创建 skill 缺 scaffold，模型靠逆向工程现有 skill

模型读了 `greet/SKILL.md` 是合理的，但读 `pdf/SKILL.md` 和 `territory.yaml` 对创建 meta-skill 帮助不大。根因是系统没有提供一等的 `skill authoring guide` 或 `skill.scaffold`。

### D. discover.sh 生成策略脆弱

Shell + Python heredoc 混写，第二次修复时引入：

`SyntaxError: invalid syntax` around `PYEOF "$TOPIC" 2>&1`

这是脚本生成方法问题，不是 compaction 问题。

### E. 大工具输出造成视觉和审计噪音

GitHub 搜索输出包含 65KB 级内容。ADR-0013 已把它侧路落盘，但 CLI 展示与 JSONL 审计仍容易让人误以为上下文没被裁剪。

## 历史根本原因

### 1. ActorBus 与 MemoryStore 分裂

系统有两条事件链：

- `ActorBus`：运行时事件流，包含 `context.compacted` / `error`
- `MemoryStore`：JSONL 审计，当前只记录部分事件

ADR-0013 把 compaction event 发到了 bus，但没有同步补齐 CLI 对 bus 的持久化订阅。这造成了“实际发生但审计不可见”的观测盲区。

### 2. JSONL 被当成 source of truth，但它其实只是 append-only audit log

compaction 修改的是 live context，不改历史审计。后续分析如果只看 JSONL，会得出错误结论：

- JSONL 仍有原始 65KB tool result
- live messages 已经被 prune/compact

需要明确区分：

- audit truth：发生过什么
- runtime truth：下一次 provider request 实际看到什么

### 3. 自我修改路径没有产品化

创建 skill 是 x_harness 的高频自扩展路径，但现在走的是普通 file.write + shell.run：

- 多次 danger confirm
- 多次 tool round
- max-rounds 容易打断
- 没有自动 lint/test scaffold

这应该是一等能力：`skill.scaffold` / `skill.install` / `skill.update`。

### 4. safety cap 的状态边界不清晰

max-rounds 原本是保护协议和成本的 safety cap，但提示以普通 user message 形式进入上下文，可能跨 turn 影响模型行为。它应该是 transient runtime control，不应该长期污染对话语义。

## 建议修复顺序

### P0 — 观测纠偏

1. CLI 订阅 `session.bus`，把 `context.compacted` 和 compaction `error` 持久化到 JSONL。
2. CLI 对 `context.compacted` 输出一行轻量提示，例如：
   `🗜 context compacted: tool-output-prune 35283→18200, sidecars=1`
3. 在 `x memory` / docs 里说明 JSONL 是 audit log，不代表 live context。

### P1 — 当前会话摩擦

4. max-rounds control message 标记 transient，下一 human turn 前清理或不写入 provider-visible messages。
5. 实现 `recover.new-skill` 或 path-prefix session consent，减少 `~/.x_harness/skills/<new>/` 创建过程确认次数。
6. 增加 `docs/skills/authoring.md` 或 `skill.scaffold`。

### P2 — 长期根因

7. 引入 runtime snapshot / context debug command，用于查看“下一轮 provider 实际看到什么”。
8. 将 self-extension（创建/安装/更新 skill）升级为一等 API，而不是裸 file_write。

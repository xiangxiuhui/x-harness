# Dogfood Report — Session `sess-tkf3srzi` (2026-07-01)

**Task:** 用户希望创建一个"从互联网搜索热门发现相关 skill 的元 skill"。
**Model:** `deepseek/deepseek-chat`（主对话；aux 未开）
**Session log:** `~/.x_harness/memory/sess-tkf3srzi.jsonl`
**Outcome:** 元 skill 骨架 + 第一版脚本落地并跑通，但第二次修复引入 heredoc 语法错误后**被 max-rounds cap 中断**，最终以 `bye` 结束。

---

## 观测到的不流畅（按现象排序）

### 现象 1 — 首轮"上限了"就中断，但用户没做任何异常事
```
[human] > 帮我看看当前有什么不错的视频剪辑的技能
[model] 抱歉，我刚才的回合数达到上限了。不过让我先检查一下...
```

**根因**：Session 的 `maxToolRounds` 是"**每个 human turn 允许的连续 tool-round 数**"（见 `session.ts:544` 的 `if (rounds >= this.maxToolRounds)`），命中后向消息数组追加：

> "[x_harness] tool-call loop hit the max-rounds safety cap; please respond to the user without calling more tools."

上一轮（创建 SKILL.md + 脚本 + chmod + …）已经把 rounds 打满。**当前 turn 的第一个 tool call 就被 skip 掉了**，模型看到的是"你的第一次工具调用被拒了，请直接回复"。所以模型的开场白直接变成"我达到上限了"——这个消息**并不是本 turn 的问题**，是上一 turn 的残余状态。

**优化**：
- **A**（快）：`maxToolRounds` 计数应在**每个 human turn 开始时重置**。如果已经这样了，则问题在残留的 "please respond without calling tools" 系统提示留在了 messages 里，让新 turn 也吃到限制。要么用一个 `Message.meta = { transient: true }` 标记，turn.start 时清理；要么改成"注入一次，用完就 pop"。
- **B**（好）：命中 cap 时给模型的提示区分"本轮已达上限，请总结"（本 turn scope）vs"下一 turn 才能继续"（cross-turn scope）。当前提示措辞让模型把"回合数"当成 session-wide 上限。
- **C**（更好）：把 max-rounds 提升成 event（`kind: 'safety.max-rounds-hit'`），且在下一个 human turn 开始时 emit 一个 `safety.max-rounds-reset` 让模型明确知道预算恢复了。

### 现象 2 — Class B danger guard 每次写 `~/.x_harness/skills/` 都弹确认

```
⚠  Danger guard Action hits Class B (x_harness self-preservation).
    tool: file.write
    args: {"path":".../discover-skills/SKILL.md",...}
    • [B/B1.write-x_harness-home] Writing into /Users/xxh/.x_harness/skills/...
```

**根因**：`packages/danger/src/rules.ts:161-164` 定义了 `B1.write-x_harness-home` 规则，标记所有写入 `~/.x_harness` 的动作。它有 `recoverableBy: ['recover.x_harness_home']`，但那个 recover-skill **还没实现**（grep 不到定义，只有引用）。所以每次写都 fallback 到人类确认。

**优化**：
- **A**（快）：为常见的 "在 `~/.x_harness/skills/<name>/` 下创建新 skill" 场景实现 `recover.x_harness_home` 或专门的 `recover.new-skill`。规则：写入路径匹配 `~/.x_harness/skills/<未存在的目录>/**`（第一次创建）**自动放行**；覆盖已有 skill 才要人类确认。
- **B**（更好）：把 "创建 skill" 提升为一个**一等操作**（`skill.create`），走独立的确认策略——因为这是**模型自我扩展能力**的高频路径，不该跟"改 territory.yaml"等系统级 mutation 混在同一个 Class B。
- **C**（最好）：确认弹窗支持"本 session 内对同一 rule + 同一 path prefix 记住我的决定"（batch consent），避免同一个 skill 创建过程弹 4 次。

### 现象 3 — Preflight 摸底 4 次 tool call（`ls`、`file.read` × 2、`ls`、`cat territory.yaml`、`ls`）

模型开始工作前，读了：
1. `ls skills/`
2. `cat greet/SKILL.md`（1682 bytes）
3. `cat pdf/SKILL.md`（8072 bytes，纯粹的 pdf 使用指南，跟"创建元 skill"零关系）
4. `ls research-skill/`
5. `cat territory.yaml`（跟建 skill 无关）
6. `ls research-skill/scripts/`

**根因**：`greet` 有 SKILL.md 参考价值，但 `pdf` 和 `territory.yaml` 对"如何创建一个新 skill"没帮助。这是 **exploration inefficiency**，本质上模型缺一个**"如何创建 skill"的官方参考文档**。

**优化**：
- **A**（快）：在 `docs/user-guide.md` 或 `docs/skills/authoring.md` 加一份"How to Author a Skill"简明模板（对应 ADR-0008），system prompt 里直接指向它。模型看到 "user wants to create a skill" → 先读那份文档，不需要在现有 skills 里逆向工程。
- **B**（更好）：`x_harness` 在 startup 时把 skill authoring guidelines 拼接进 system prompt 的一个 "self-knowledge" section（就像 territory 拼进 prompt 一样）。
- **C**（最好）：提供一个 `x skill new <name>` 或内建 `skill.scaffold` 工具，一次调用生成 `SKILL.md` 骨架 + `scripts/` 目录 + `chmod +x`，把"创建 skill"这一 O(N) tool-call 序列压成 O(1)。

### 现象 4 — 首次脚本没测就写完了，第二次修复引入语法错误

```
[model] 验证一下脚本是否有语法问题：
[human] >             ← 用户主动打断
```

模型说要验证但**没有验证**，直接进入下一轮（也可能是 max-rounds 打断的）。后来重跑发现 GitHub 结果空，改脚本，第二次改的 heredoc 又坏了（`PYEOF "$TOPIC" 2>&1` 语法错误）。

**根因**：
- **模型自律不足**：说了要测试，被 max-rounds 打断后没恢复。
- **shell + python heredoc 混写脆弱**：`bash -c 'python3 -c "..."'` 里嵌 `$TOPIC` 变量，第二次用了 `python3 -c <<PYEOF ... PYEOF "$TOPIC"` 想传参，但 heredoc 结束标记后不能直接接位置参数。

**优化**：
- **A**：如果模型说了"我要验证"，session 应该记住这个 pending action，下一轮 turn.start 时把它 replay 给模型看（"你上轮承诺要 verify script，还没做"）。这是 **commitment tracking**——一个通用能力。
- **B**：给 skills 提供一个**标准化的执行模式**：写完 script 就自动 `bash -n script.sh` 语法检查、再用 dry-run 参数跑一次。可以做进 `skill.scaffold` 工具的后处理。
- **C**：教模型用 python 独立文件而不是 heredoc（`echo "$PYTHON_CODE" > /tmp/x.py && python3 /tmp/x.py "$TOPIC"`）。这是 **prompt-level guidance**，也能写进 skill authoring guide。

### 现象 5 — 结果被截断（`+64586 chars`）

```
"description": "[★3029] FireRed-OpenStoryline is ... I… (+64586 chars)
```

单个 tool result 里塞了大量数据（一个 repo 的 description 被投影为整段 README 或 commit log 6 万字符）。虽然是脚本的锅（description 字段没截断），但也是 **x_harness 的 tool-output truncation 是否触发过侧路落盘**的问题——从日志看，"(+64586 chars)" 只是**显示层**截断了，实际全量进了 messages 数组，会让下一轮 tokens 爆炸。

**优化**：
- **A**：本 session **没启用 compaction**（`~/.x_harness/config.json` 不存在）。ADR-0013 已经上，用户只需要 `cp ~/.x_harness/config.example.json ~/.x_harness/config.json`——**这次实测正好证明为什么需要它**。可以在 dogfood 报告里明确写"如果开了 compaction，`toolOutputMaxTokens` 会自动把这条 result 落到 sidecar"。
- **B**：即使没开 compaction，也应该有一个**保底的 tool-output display truncation**（比如 8KB）+ **保底的 messages 数组内 truncation**（比如 32KB），避免单条 result 撑破一切。当前显示层截断了但 messages 里是全的，属于"看着安全实际不安全"的陷阱。

### 现象 6 — 中断行为不友好（`[human] > (空回车)`）

```
[human:xxh@cli] >               ← 空回车
[human:xxh@cli] > 帮我看看...
```

用户敲了 Enter 想中断模型（模型在打字或在跑 tool），但输入了空 prompt。x_harness 好像接受了空 turn。

**优化**：
- **A**：CLI 层面把空 prompt 当成"中断当前操作但不发起新 turn"。
- **B**：如果模型在 streaming，回车 → Ctrl-C 语义（中断本轮），不启动新 turn。
- **C**：更明确的 UI 提示：`[Enter] interrupt · [Ctrl-C] force-cancel · <text><Enter> new turn`。

### 现象 7 — 模型输出被截断（`(+3 chars)`）

```
"timeout_ms": 450… (+3 chars)
```

这是 x_harness 显示 tool call args 时的截断——显示 "450" 后省略了三个字符，那是 `000`（45000ms）。**只影响显示，不影响执行**，但对调试很不友好。

**优化**：把常见字段（`timeout_ms`、`max_bytes`）从截断中豁免出去，或者用**结构化摘要**（"timeout=45s, cwd=..., command=..."）代替 raw JSON 截断。

---

## 汇总：优先级 & 归因

| # | 现象 | 严重度 | 类别 | 修复位置 |
|---|---|---|---|---|
| 1 | max-rounds 消息跨 turn 残留 | 🔴 高 | 交互 | `Session.streamReply`（residual system message） |
| 2 | Class B 每次写 skills 都弹确认 | 🟠 中 | 摩擦 | `packages/danger/src/rules.ts` + 引入 `recover.new-skill` |
| 3 | 建 skill 前 6 次探索 tool call | 🟠 中 | prompt 质量 | 新增 `docs/skills/authoring.md` + `skill.scaffold` 工具 |
| 4 | 模型说要验证但没验证 | 🟡 低 | 模型自律 | commitment tracking（长期）；skill.scaffold 内建 syntax check |
| 5 | 单条 tool result 6 万字符炸消息 | 🟠 中 | 上下文管理 | 保底 truncation + 推广 config.json 启用 compaction |
| 6 | 空回车中断行为不清晰 | 🟡 低 | CLI UX | `packages/cli/src/chat.ts` 输入 loop |
| 7 | 显示层截断吃掉了关键参数 | 🟢 极低 | 显示 | tool-call 显示格式化 |

---

## 建议的最小可执行行动

**今天（P0，30 分钟内可做）：**
- 修 max-rounds 的 residual 消息：turn.start 检测并 pop 上一 turn 的 "hit the max-rounds safety cap" 提示。
- 新增 `docs/skills/authoring.md`，把"创建 skill"的标准骨架文档化。

**明天（P1，2 小时内）：**
- 实现 `recover.new-skill` recover-skill（首次创建 skills/<new-name>/ 自动放行）。
- 建议用户 `cp ~/.x_harness/config.example.json ~/.x_harness/config.json` 启用 ADR-0013 compaction（**这次会话正好是它的完美 use case**）。

**下 spiral（P2）：**
- `skill.scaffold` 内建工具：一次调用生成 SKILL.md + scripts/ + chmod。
- Commitment tracking 通用机制。
- CLI 空回车 = 中断当前操作，不新起 turn。

---

## 用户实际的价值

用户已经**拿到了一个能用的 `discover-skills`**（第一次运行成功产生了 10 条 GitHub 结果）。中断只是发生在"锦上添花"阶段。所以从**任务完成度**看，这是一次**成功但摩擦大**的会话——刚好把我们上一版 ADR-0013 补的补丁能不能减少下一次同样场景的摩擦，转化成了明天要做的具体列表。

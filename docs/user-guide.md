# x_harness 用户手册（v0.2，spiral 2 终结快照）

> **状态**：alpha — 单用户、单机、macOS 优先。命令、文件路径、JSON schema 都可能在
> 下一个螺旋有不兼容改动；改动会写进 [docs/status.md](status.md) 顶部。
>
> **设计前提**（[docs/vision.md](vision.md)）：x_harness 不是 IDE 插件、不是 Agent
> 框架库——它是一台 PC 的 AI 操作系统的最早期形态。本手册描述的所有概念
> （territory、provenance、feedback、JSONL audit）在 phase ∞（AI 自己做 OS）时
> 都是其内核事件流的子集。今天你看到的 CLI / Web 形态都是寄居态的折衷。

---

## 0. 五分钟跑通

```bash
# 0.1 依赖
pnpm install                                   # 装依赖（pnpm 必备）
pnpm typecheck                                 # 应当 0 输出

# 0.2 配置 DeepSeek key（目前唯一支持的 provider）
cp .env.example .env
$EDITOR .env                                   # 填 DEEPSEEK_API_KEY=sk-...

# 0.3 别名（推荐）
alias x='pnpm -s --filter @x_harness/cli exec tsx src/index.ts'
# 或者每次都手写: pnpm exec tsx packages/cli/src/index.ts ...

# 0.4 跑起来
x version                                      # 自检
x chat                                         # 进入对话
```

第一次启动 `x chat` 时：
- 自动创建 `~/.x_harness/`（**XHARNESS_HOME**，一切持久状态在这里）
- 自动生成默认 `~/.x_harness/territory.yaml`（你的"领地"，详见 §3）
- 每次对话写一个 `~/.x_harness/memory/<sessionId>.jsonl`
- 进 REPL：`你: ` 提示符。输入 `/exit` 或 Ctrl+D 退出。

---

## 1. 心智模型（看懂 3 个词才会用）

### 1.1 Session = 一段对话 = 一个 JSONL
一次 `x chat` 启动到退出是一个 session，所有事件（你的话、模型的话、模型调用工具、
工具返回、provenance、feedback…）按发生顺序 append 到
`~/.x_harness/memory/<sessionId>.jsonl`，每行一个 JSON object，**不会被改写**。

这是**唯一的真相源**：UI、grep、trace、replay 都读这一个文件。

### 1.2 Surface Parity — CLI 和 Web 是同一张脸的两个表情
**任何能力都先在 `packages/<pkg>/` 里写成纯库函数，然后并行接到 CLI 和 Web 两个表面。**
你在 CLI 用 `x feedback` 提交的反馈，刷新 Web `#/feedback` 就能看到，反之亦然。
背后是同一个 `.jsonl` 文件（[ADR-0011](decisions/0011-surface-parity.md)）。

### 1.3 三种"自治度" — autonomy ladder（[ADR-0009](decisions/0009-intent-provenance.md)）
模型动你的硬盘时，每一次写都会在 xattr 和 JSONL 里打上**自治标签**：

| 标签 | 含义 | 当下识别规则（v0） |
|---|---|---|
| `human-directed` | 你明确让我做的 | 当前 human turn 内的写 |
| `model-initiated-within-task` | 我在你给的任务里自己决定的 | 离 human turn 较远 |
| `model-self-initiated` | 我自发想做的（unsolicited） | spiral 2/2b 收尾后启用 |

这影响"撤销"和"复盘"。你之后用 `x trace <path>` 时会看到这个标签。

---

## 2. 命令参考（CLI）

> 全局：`X_HARNESS_HOME` 环境变量可改家目录；默认 `~/.x_harness`。

### `x chat [--resume <sessionId>]`
启动交互式对话。
- 自动加载 territory + skills + 三个 builtin tool（`file.read` / `file.write` / `shell.run`）
- `--resume`：把上个 session 的历史重放给模型，继续聊
- 退出：`/exit`、`/quit` 或 Ctrl+D

启动时屏幕上方会打印：
- 当前 session id（拷下来给 `x trace` / `x feedback` 用）
- 加载的 territory zones
- 加载的 skills 数量

### `x sessions ls`
列出所有 session（按时间倒序）。字段：id、起止时间、user turn 数。

### `x sessions show <sessionId>`
打印一个 session 的人类可读 transcript（`replay.ts` 渲染）。审计 / 复盘用。

### `x web [--port <N>]`
在 127.0.0.1 起本地 web UI（默认 7777）。可以浏览 sessions、看实时流（SSE）、
看 territory、查 trace、grep memory、记 feedback。**只对本机开放**。

### `x trace <path> [--json]`
读一个文件的 AI-touch 痕迹：
- xattr `user.x_harness.ai_touch.v1`（如果该文件被本 harness 写过）
- 通过 `provenance.path` 在 JSONL 里反查出**原始触发的人类指令**

```bash
x trace ./README.md                            # pretty
x trace ./README.md --json                     # machine-readable
```

退出码 0 = 有 provenance，1 = 没有/不是 AI 写的。

### `x memory grep <pattern> [...]`
跨 session 全文搜 JSONL。
```bash
x memory grep "DEEPSEEK_API_KEY"               # 字面量
x memory grep "sk-[a-z0-9]+" --regex            # 正则
x memory grep error --kind tool.result          # 仅工具失败结果
x memory grep restart --session sess-abc        # 仅指定 session
x memory grep '^panic' --regex --case --limit 50 --json
```
flag 速查：
- `--regex` / `--case` — 模式控制
- `--kind <K>`（可重复）— 过滤事件 kind
- `--session <ID>` / `--since <ISO>` — 范围过滤
- `--limit N`（默认 200）/ `--json`

> 命中会高亮（TTY），有 ±80 字符上下文片段。Exit 1 = 0 命中。

### `x feedback <sessionId> <seq> <verdict> [...]`
给某个 session 的某条 entry 留 evolution feedback（[ADR-0012](decisions/0012-evolution-capture.md)）。

> **存在哪里？** —— **就在被评论那条 entry 所在的同一个 JSONL 里**，
> `~/.x_harness/memory/<sessionId>.jsonl`，作为新的一行 append，
> `kind = "evolution.feedback"`。没有独立的 feedback 数据库、没有 sqlite、
> 没有别的目录。这是 ADR-0012 的关键设计：**同源 JSONL，`x memory grep` 和
> `x sessions show` 立刻都能看到**。

```bash
x feedback sess-abc 42 accept --note "干得漂亮"
x feedback sess-abc 47 reject --note "不该自己去 rm"
x feedback sess-abc 51 i-would-have --suggestion "先 git stash 再切分支"
```
- `accept` / `reject` / `i-would-have` 三种
- `i-would-have` **必须**带 `--suggestion`，否则 exit 2
- seq 从 `x sessions show` 或 Web 会话视图里查

### `x feedback list [--session ID] [--verdict V] [--json]`
按时间倒序列出所有反馈。

### `x version`
版本号。

---

## 3. 命令参考（Web — `x web`）

Web 是一个零依赖的纯 HTTP server + 单页 hash-route 前端。**只 listen 127.0.0.1**，
没有 auth，因为预期只有你自己用。

| 路由 | 说明 |
|---|---|
| `#/sessions` | 所有 session 列表 |
| `#/sessions/<id>` | 静态 transcript，每条 entry 旁有 👍/👎/💡 |
| `#/sessions/<id>/live` | SSE 实时流，跟着 `x chat` 滚 |
| `#/territory` | 领地配置展示 |
| `#/skills` | 加载到的 skills（doc + 路径） |
| `#/memory` | 跨 session JSONL grep（同 `x memory grep`） |
| `#/feedback` | 所有 feedback 事件，可过滤 |
| `#/trace?path=...` | 文件 provenance（同 `x trace`） |

REST（同源）：
- `GET  /api/sessions`、`/api/sessions/:id`、`/api/sessions/:id/tail`（SSE）
- `GET  /api/territory`、`/api/skills`
- `GET  /api/trace?path=...`
- `GET  /api/memory/grep?q=...&kind=...&session=...&since=...&limit=N&regex=1&case=1`
- `GET  /api/feedback?session=...&verdict=...&limit=N`
- `POST /api/feedback` — body `{ sessionId, targetSeq, targetKind, verdict, note?, suggestion? }`

> POST 是目前**唯一**的写侧端点。body cap 64KB。

---

## 4. ~/.x_harness/ 目录结构

> **一个目录管所有**：`~/.x_harness/` 是 x_harness 的总目录。
> - `~/.x_harness/src/` 是**源码**（installer 全权管理，重装会被重写）
> - `~/.x_harness/{memory,territory.yaml,skills,...}` 是**运行时数据**（你的劳动成果，installer 绝不动）
> - `~/.x_harness/VERSION` 是当前装的 commit + 安装时间
>
> 彻底卸载：`rm -rf ~/.x_harness`。

```
~/.x_harness/
├── territory.yaml              # 你的领地配置（§5）
└── memory/
    ├── index.jsonl             # 每个 session 一行：{sessionId, startedAt, endedAt, userTurns}
    ├── sess-<id1>.jsonl        # session 1 的所有事件
    ├── sess-<id2>.jsonl        # session 2 ...
    └── ...
```

**没有独立的 feedback 文件 / 数据库**：feedback 事件作为 `kind: "evolution.feedback"`
直接 append 到对应 session 的 `.jsonl`。一个真实的 feedback 行长这样：

```json
{"ts":"2026-06-29T03:21:07.091Z","seq":17,
 "actor":{"kind":"human","userId":"xxh","surface":"feedback"},
 "kind":"evolution.feedback",
 "payload":{"targetSeq":2,"targetKind":"system.message",
            "verdict":"accept","note":"looks ok in test"}}
```

**删一个 `sess-*.jsonl` = 永久遗忘那次对话**（含 feedback、provenance 记录）。
**删 `territory.yaml`** → 下次 `x chat` 自动重生默认。

---

## 5. Territory — 让 AI 知道哪些地方是它的领地

`~/.x_harness/territory.yaml`（[ADR-0010](decisions/0010-world-awareness.md)）：

```yaml
version: 1
zones:
  - name: home
    path: ~                    # 支持 ~
    autonomy: ask              # ask | observe | act
    notes: "我的 mac 主目录"

  - name: x_harness-repo
    path: /Users/me/x_harness
    autonomy: act              # 可以直接动
    excluded:
      - node_modules
      - .git

  - name: secrets
    path: ~/secrets
    autonomy: observe          # 只读，绝不动
```

- `act`：模型可以直接写
- `ask`：模型动之前**必须**先在 chat 里问你
- `observe`：模型只能读，**永远不写**
- `excluded`：相对该 zone 的子路径黑名单

启动时 `~/.x_harness/memory/<sess>.jsonl` 会写一条 `territory.loaded` 事件
（zones、是否生成了默认）。

> v0：territory 只通过 system prompt 段告知模型，**软约束**。Danger guard 还是
> 沿用 ADR-0005 的 Class A/B 规则集硬拦。Phase ∞：转 syscall 级 capability。

---

## 6. Skills — 文档型，不是 plugin

x_harness 走 **agentskills.io / [ADR-0008](decisions/0008-skill-loading-per-agentskills.md)** 路线：
**skill = 一份 SKILL.md + 可选的 bundled scripts**，**不是 JS handler**。

启动时扫描这两个目录（递归一层）：
- `examples/skills/` (项目自带)
- `~/.x_harness/skills/` (用户自己的)

每个 skill 一个目录，里面必须有 `SKILL.md`（带 YAML frontmatter `name` / `description`）。
启动时 chat 的 system prompt 里会注入：
- 所有 skill 的名字 + description
- 每个 skill 的 `SKILL.md` 绝对路径

模型要用某个 skill 时：
1. `file.read` 读那个 SKILL.md
2. 按 SKILL.md 的指引动作（通常是 `shell.run` 跑 `scripts/xxx.sh`）

参考：`examples/skills/greet/`。

---

## 7. Builtin Tools

只有三个，刻意保持最小：

| 名字 | 干什么 | 危险等级 |
|---|---|---|
| `file.read` | 读文件 | 无 |
| `file.write` | 写文件（写完打 ai_touch xattr） | 中（territory 控制） |
| `shell.run` | 跑命令（过 danger guard 规则集） | 高（class A/B 拦截） |

Danger guard（[ADR-0005](decisions/0005-danger-rules.md)）会在 `shell.run` 跑前
匹配规则集：
- **Class A**（硬拦截）：`rm -rf /`、`mkfs`、`dd of=/dev/...` 等
- **Class B**（提示确认）：`git push --force`、`rm -rf <非空目录>` 等

被拦的命令会在 JSONL 留 `tool.approval` 事件。

---

## 8. Provenance — AI 改过的每个文件都带"签名"

每次 `file.write` 成功，harness 在该文件的 `user.x_harness.ai_touch.v1` xattr 写：

```json
{ "v": 1, "ts": "...", "sessionId": "...", "originatingHumanMessageSeq": 42,
  "originatingHumanMessage": "你最初让我做的那句话",
  "autonomy": "human-directed", "executor": {...}, "xHarnessHome": "..." }
```

同时 JSONL 里 append 一条 `provenance.attach` 事件。`x trace` / `/api/trace`
就是把两者交叉查出来。

- macOS 上靠 `xattr` shell 命令实现（[ADR-0009 addendum]），未来由 Rust kernel 接管
- 删文件不删 xattr，但文件被覆写后我们会更新（保留最新一次的人类意图）

---

## 9. 典型工作流

### 9.1 让模型改一个文件，然后审计
```
x chat
你: 把 README.md 第一行改成 "Hello"
（模型用 file.write，xattr + JSONL 自动记录）
你: /exit

x trace ./README.md
# → autonomy=human-directed, originating="把 README.md 第一行改成 Hello"
```

### 9.2 跨 session 找一个错误
```
x memory grep "ENOENT" --kind tool.result --limit 20
```

### 9.3 给模型一次评分，留作以后训练素材
```
x sessions ls                          # 找最近 session
x sessions show sess-xxx               # 找到那条蠢回答的 seq
x feedback sess-xxx 33 reject --note "幻觉了一个不存在的 API"
x feedback sess-xxx 35 i-would-have --suggestion "应该先 grep 看看有没有这个 symbol"
# 之后：
x feedback list --verdict i-would-have --json > my-mistakes.json
```
（spiral 2/4 v1 会基于这些 `i-would-have` 自动生成 skill draft；v0 还要人工。）

### 9.4 边看实时流边操作
开两个终端：
- 终端 A：`x chat`
- 终端 B：`x web` → 浏览器打开 `http://127.0.0.1:7777/#/sessions/<id>/live`
- 在 Web 里直接对每条 entry 点 👍/👎/💡

---

## 10. 故障排查

| 现象 | 大概是 |
|---|---|
| `DEEPSEEK_API_KEY required` | `.env` 没配 / 当前 shell 没 source `.env` / `dotenv.ts` 没找到 |
| `x trace ... → no provenance` | 文件不是被 harness 写过的；或者所在文件系统不支持 xattr |
| Web 没数据 | `X_HARNESS_HOME` 跟你跑 `x chat` 时不同 |
| `tool.approval blocked` | 命中了 [ADR-0005](decisions/0005-danger-rules.md) class A，**这是设计** |
| memory grep 慢 | 没建索引（spiral 2/5 v0 是 O(n) 全扫），>10k 会话再说 |
| typecheck 失败 | 先 `pnpm install`，再 `pnpm -r run build` |

---

## 11. 路线图与已知缺口（v0.2 时刻）

已完成（spiral 1 + 2）：
- ✅ CLI chat / sessions / web / trace / memory grep / feedback
- ✅ Skills doc-form loader（ADR-0008）
- ✅ Danger guard v0（ADR-0005 Class A/B）
- ✅ Memory JSONL + replay digest
- ✅ Territory loader + system prompt 注入
- ✅ Provenance xattr + cross-ref
- ✅ Web UI 读 + 写（feedback POST 是首个 write 侧端点）
- ✅ ADR-0011 Surface Parity 工艺定型

尚未做：
- ⏳ **2/2b** Patrol & snapshot — AI 巡逻领地，发现人类外部改动
- ⏳ **2/4 v1** Skill draft auto-gen — 从 `i-would-have` 聚类产出 skill 草稿
- ⏳ **2/?** 端到端 e2e test 脚本（曾在 `scripts/e2e-provenance.ts`，被移除待重写）
- ⏳ Rust kernel actor（被 spiral 2/2a 的 shell-out 临时绕开，长期目标）
- ⏳ 第二个 provider（Claude / 自托管）
- ⏳ MCP 兼容
- ⏳ 跨 OS（Linux 的 xattr 已经 ok，Windows 待研究 ADS）

非目标（除非升级 ADR 否则不会做）：
- ❌ IDE 插件 / VSCode extension
- ❌ Web 公网暴露 / 多租户 / 多用户 auth
- ❌ 不在 territory 里也能动文件（必须先扩 territory）

---

## 12. 一句话给协作者

> **这个项目所有事情都先在 ADR 里写定。代码改了之前先看
> [docs/decisions/](decisions/)。不存在"小改动"——每个改动都是 phase ∞ AI OS 的脚手架。**

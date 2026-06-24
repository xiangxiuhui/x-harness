# ADR 0007 — Skill 脚本运行时形态

- **Status**: Proposed (spiral 2 启动决策)
- **Date**: 2026-06-24
- **Supersedes / Relates to**: [ADR 0006](0006-skill-plugin-form.md)

## 背景

[ADR 0006](0006-skill-plugin-form.md) 决定了 skill 的目录形态（`commands/agents/skills/hooks/.mcp.json` + `.x-plugin/`），但**故意没决**"on-disk skill 怎么真正运行"——spiral 1 只让 builtin skill 可执行，on-disk skill 加载但跳过 handler。

现在 spiral 2 要让"装一个 user-level skill (`~/.x_harness/skills/my-thing/`) 能被模型实际调用"，必须回答这个问题。

## 决策空间

skill 的 handler 大体有三类来源：

1. **内置（compiled in）** — 已经是 `@x_harness/skills/src/builtin/*.ts`
2. **本机脚本** — `SKILL.md` 旁边带 `handler.ts` / `handler.py` / `handler.sh`
3. **远程 MCP / API skill** — 通过协议代理（spiral 3 起步，本 ADR 不覆盖）

本 ADR 只决（2）的运行时形态。

### 候选

| ID | 方案 | 优 | 劣 |
|----|------|----|----|
| A | **Node child_process spawn `handler.{js,ts,sh,py}`**（按扩展名分发） | 零新依赖；与 TS 外壳一致；最快验证 | 没沙箱，恶意 skill 可裸跑 |
| B | **Deno embed**（@deno/loader 加载 .ts） | 沙箱原生（`--allow-*` 细颗粒度）；TS 原生 | 引入新 runtime；启动开销；Node ↔ Deno 互通成本 |
| C | **Bun spawn / embed** | 启动极快 | 同样新 runtime；macOS arm64 兼容性需要测；不解决沙箱问题 |
| D | **Node + vm/vm2 in-process** | 无 spawn 开销 | vm2 已弃维；vm 模块不是真沙箱（只是命名空间隔离） |

## 决定

**采用 A**：Node child_process spawn，按扩展名分发，**不内置沙箱**。

**理由**：
1. 本项目的核心立场（vision §5 / ADR-0005）就是"AI 是常驻主人，**不替 AI 自我审查**"。skill 是 AI 的延伸；强迫 skill 走沙箱是把 ADR-0005 推翻。
2. **危险拦截这件事已经由 DangerEngine 在调用层做了**。skill 内的 `rm -rf` 也会通过 shell.run 路径触发同样的规则，或者直接 IO 时未来由 Rust kernel 在系统层拦——**不在 runtime 层做第二道**。
3. spiral 1 已经验证"信任但可审计"工作得很好；spiral 2 继续这个方向。
4. 把"恶意 skill"的边界从"sandbox 强约束"升级为"actor=skill:<name> 全程审计 + 危险操作弹确认 + 出问题可回溯"。
5. Deno/Bun 的引入成本会让 spiral 2 拖一周以上；先用 A 拿到 on-disk skill 闭环；如果未来有"装的 skill 多到 1000 个、来自陌生源"再上 B。

## 细节

### Skill 目录

```
~/.x_harness/skills/my-thing/
  SKILL.md            # frontmatter + 说明文档
  handler.ts          # 或 handler.js / .sh / .py
  README.md           # 可选
```

frontmatter 新增字段（在 ADR-0006 留好的 `metadata.x_harness` 命名空间下）：

```yaml
metadata:
  x_harness:
    runtime: node-ts            # node-ts | node-js | sh | python
    entrypoint: ./handler.ts    # 可选；默认 handler.<ext>
    timeout_ms: 60000           # 可选；默认 60s
    actor_required: ["model"]   # 可选；spiral 3 起会被读
    danger_class: null          # 可选；声明自己是 Class A / B / null
```

未指定时按以下顺序探测：`handler.ts` → `handler.js` → `handler.sh` → `handler.py`。

### Handler 协议

stdin 接收 JSON：

```jsonc
{
  "args": { /* model 调用时给的参数 */ },
  "context": { "sessionId": "...", "cwd": "...", "env": { /* sanitized */ } }
}
```

stdout 必须输出**一行 JSON**作为结果：

```jsonc
{ "output": "...", "error": false }
```

`output` 直接喂回 model 作为 tool result。任何 stdout 上的额外内容（非最后一行 JSON）作为 `stderr` 日志被写到 audit log，**不**进 model context。

### 执行流（在 `@x_harness/skills/runtime/exec-on-disk.ts`）

1. SkillRegistry 发现 `handler` 字段缺失但 frontmatter 指定了 runtime → 注入一个 wrapper handler
2. wrapper 接到调用 → spawn child（`node --import tsx handler.ts` / `/bin/sh handler.sh` / 等）
3. 写 stdin → 读 stdout/stderr → 超时 kill → 解析最后一行 JSON
4. 异常情况（child crash / 无最后一行 JSON / 超时）返回 `{ output: 'error: ...', error: true }`

### 与 Danger Engine 的协作

- skill 通过 shell.run 触发的命令 → 还是走 DangerEngine（因为是 builtin shell.run 在执行）
- skill 自己 spawn 子进程 → **不走 DangerEngine**，但所有副作用经过 Rust kernel（spiral 2.1）的 actor xattr / 未来 FS guard 时仍能被发现
- spiral 3 起，frontmatter 里 `danger_class: B` 的 skill 在每次被调用时**整体**走一次 Class B confirm（无论内部具体做什么）

### actor

handler 调用期间，actor bus 的 actor 是 `{ kind: 'skill', name, source }`（spiral 1 就已经在 tool.result 时这样写了）。spiral 2 加 Rust kernel 后，handler 进程的环境变量带 `X_HARNESS_ACTOR=skill:<name>`，由 kernel 拼回 xattr。

### 不做的事

- 不内置 npm 包依赖管理；handler 要自己处理（默认能 import workspace 之外的东西是用户自负其责）
- 不内置 deno/bun 兼容层
- 不在 skill 间共享状态（每个 handler 进程都是独立的）

## 迁移与风险

- **风险 1**：恶意 skill。Mitigation：actor 标签全程贴牢 + 危险操作弹确认 + JSONL 审计；同时 skill 安装本身是人类动作（spiral 2 UI 上会有"装了哪些 skill"的列表）。
- **风险 2**：handler.ts 启动慢（tsx 冷启 ~200ms）。Mitigation：频繁调用的 skill 应该用 handler.js（已编译）或 handler.sh；下次再考虑长驻进程。
- **风险 3**：未来切到 B（Deno）时 handler 协议要兼容。Mitigation：协议本身用 JSON over stdio，与运行时无关；切运行时时 wrapper 内部换 spawn 命令即可。

## 验收

spiral 2 close 前要能演示：

```
~/.x_harness/skills/greet/
  SKILL.md       (frontmatter: name=greet, description=..., runtime=node-ts)
  handler.ts
```

```bash
pnpm x chat
# > 跟我打个招呼，用 greet skill
# (模型调用 greet → spawn → stdout JSON → output 回 model)
# (audit log 显示 actor=skill:greet)
```

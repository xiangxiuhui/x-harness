# Skill Authoring Guide

> This guide explains how to create, test, and install skills for x_harness, following the agentskills.io standard (ADR-0008).

## What is a Skill?

A skill is a **filesystem directory** containing a `SKILL.md` and optional scripts/resources. It is NOT a tool — tools are builtin execution primitives (`shell.run`, `file.read`, `file.write`, `web.fetch`). Skills are **knowledge packs** that guide the model on how to use tools for a specific purpose.

The model loads skills via **progressive disclosure**:

| Level | What | Tokens | When |
|---|---|---|---|
| L1 | `name` + `description` from frontmatter | ~100 | Always (in system prompt) |
| L2 | SKILL.md body (instructions) | ~5K | On demand (`file.read` by model) |
| L3 | Scripts + resources | Unlimited | On demand (`shell.run` by model) |

## Directory Structure

```
~/.x_harness/skills/<skill-name>/
├── SKILL.md          # Required: frontmatter + body
├── scripts/          # Optional: executable scripts
│   ├── main.sh       #   Shell script
│   ├── main.py       #   Python script
│   └── main.js       #   Node.js script
└── resources/        # Optional: static files, templates, etc.
    └── template.md
```

## SKILL.md Format

```markdown
---
name: my-skill
description: One-line description of what this skill does and when to use it. The model sees this in its system prompt and decides when to self-load.
version: 0.1.0
author: your-name
license: MIT
---

# my-skill

Detailed instructions for the model. This section is loaded only when the model
decides this skill is relevant to the current task.

## When to use

Describe the trigger conditions. Be specific — the model uses this to decide
whether to `file.read` this SKILL.md.

## How to use

Step-by-step instructions. The model will follow these literally.

1. Call `shell.run` with: `sh <SKILL_DIR>/scripts/main.sh <args>`
2. Take the stdout as the result
3. Format and present to the user

## Example

Show a concrete example of the expected tool-call sequence:

User: "do X with Y"
Expected:
- `file.read` on this SKILL.md
- `shell.run` on `sh /path/to/skills/my-skill/scripts/main.sh Y`
- Reply with the script's stdout
```

### Frontmatter Fields

| Field | Required | Description |
|---|---|---|
| `name` | ✅ | Unique skill identifier (kebab-case) |
| `description` | ✅ | One-line summary — shown in system prompt L1 |
| `version` | Recommended | Semantic version |
| `author` | Optional | Author name |
| `license` | Optional | License identifier |
| `metadata.x_harness.expose_as_tool` | Optional | Set `true` to register as a tool (ADR-0007 opt-in) |

## Creating a Skill

### Step 1: Create the directory

```bash
mkdir -p ~/.x_harness/skills/my-skill/scripts
```

> **Note**: Writes to `~/.x_harness/skills/` are excluded from the Class B danger guard (ADR-0005). Skill creation is trivially reversible (`rm -rf` the directory) and is a first-class capability per ADR-0008. No confirmation prompts will interrupt you.

### Step 2: Write SKILL.md

Follow the template above. Key rules:

1. **Description must be self-contained** — the model decides whether to load based on this alone
2. **Body should be action-oriented** — give the model specific `shell.run` / `file.read` commands to execute
3. **Scripts must produce stdout** — only stdout enters the model's context; source code does not
4. **Use absolute paths** — the model resolves `<SKILL_DIR>` from the `path:` shown in system prompt

### Step 3: Write scripts

Scripts should:

- Accept arguments via command-line (not stdin)
- Print results to stdout
- Exit 0 on success, non-zero on failure
- Be self-contained (no interactive prompts)
- Use `set -euo pipefail` in shell scripts

Example `scripts/main.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

# my-skill main script
# Usage: main.sh <input>

input="${1:?Usage: main.sh <input>}"

# Do the work
result="Processed: ${input}"
echo "${result}"
```

### Step 4: Make scripts executable

```bash
chmod +x ~/.x_harness/skills/my-skill/scripts/*.sh
```

### Step 5: Test

Start a chat session and ask the model to use your skill:

```bash
x chat
> Use the my-skill to process "hello world"
```

The model should:
1. `file.read` the SKILL.md (L2)
2. Follow the instructions
3. `shell.run` the script with appropriate args
4. Return the result

## Danger Guard Interaction

Skill scripts execute via `shell.run`, which goes through the Class A/B danger guard (ADR-0005). This is by design — skills don't bypass safety checks.

However, skill **creation** is exempt:
- `file.write` to `~/.x_harness/skills/<name>/` does NOT trigger the Class B confirm
- `shell.run mkdir` / `cat >` targeting `~/.x_harness/skills/` also passes through

If your skill needs to write to other `~/.x_harness/` paths (e.g., config, memory), those writes WILL trigger Class B confirmation. The user can pre-approve the target directory by selecting `[p]re-approve path` when prompted.

## Opt-in: Expose as Tool

By default, skills are doc-only (progressive disclosure). If your skill has a clean function signature and you want it registered as an OpenAI tool_calls entry, add to frontmatter:

```yaml
metadata:
  x_harness:
    expose_as_tool: true
```

This enables the ADR-0007 stdio runtime: the skill's `handler.{ts,sh,py}` is spawned as a subprocess, receives JSON args on stdin, and returns JSON on stdout's last line.

> Use this sparingly — most skills should be doc-only. The model is smart enough to follow SKILL.md instructions using builtin tools.

## Checklist

Before publishing a skill:

- [ ] SKILL.md has `name` and `description` in frontmatter
- [ ] Description is ≤ 200 chars and specific enough for L1 matching
- [ ] Body includes "When to use", "How to use", and an example
- [ ] Scripts are executable and produce stdout
- [ ] Scripts exit non-zero on error
- [ ] No hardcoded paths (use `<SKILL_DIR>` or relative paths)
- [ ] Tested with `x chat` — model correctly loads and follows instructions
- [ ] No secrets or API keys in the skill directory

## Future: skill.scaffold

A future builtin `skill.scaffold` tool will automate directory creation and SKILL.md template generation. Until then, follow the manual steps above.

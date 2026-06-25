---
name: greet
description: Greet someone by name. Demonstrates an agentskills.io-style skill (doc + bundled script, no handler). When the user asks to greet someone, follow the instructions below.
version: 0.2.0
license: MIT
author: x_harness
---

# greet

A minimal demonstration of the **agentskills.io / ADR-0008** skill form.
This skill has no `handler.{ts,sh,py}` and is NOT exposed as a tool.
Instead, you (the model) read this file, then invoke the bundled script
via the builtin `shell.run` tool.

## When to use

When the user asks you to greet, say hi to, or welcome a specific named
person — and especially when they reference "the greet skill".

## How to use

1. Resolve the absolute path of this skill's `scripts/greet.sh` (you read
   this SKILL.md via `file.read`, so its directory is the parent of the
   path you read).
2. Call:

   ```
   shell.run command="sh <SKILL_DIR>/scripts/greet.sh <name>"
   ```

   Where `<name>` is the person to greet. If they include spaces, quote
   them.
3. Take the stdout returned by `shell.run` as your final greeting and
   pass it back to the user.

## Example

User: "用 greet skill 跟 Alice 打招呼"

Expected sequence:
- `file.read` on this SKILL.md
- `shell.run` on `sh /Users/.../greet/scripts/greet.sh Alice`
- Reply with the script's stdout (e.g. `Hello, Alice! Welcome to x_harness.`)

## Why doc-only

ADR-0008 says: a skill is a filesystem doc, not a tool. The script's
stdout is what enters your context; the script source does not. This
keeps progressive disclosure working — 100 skills cost ~100 tokens each
at the system-prompt level, and only the ones you actually use pay for
their body and scripts.

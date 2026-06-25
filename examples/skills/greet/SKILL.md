---
name: greet
description: Greet someone by name. Demonstrates ADR-0007 on-disk skill runtime.
version: 0.1.0
parameters:
  type: object
  properties:
    name:
      type: string
      description: who to greet
  required: [name]
metadata:
  x_harness:
    runtime: node-ts
    actor_required: model
    danger_class: none
    tags: [demo, hello-world]
    timeout_ms: 5000
---

# greet

A minimal example of an on-disk skill (ADR-0007).

## Protocol

This skill receives `{args, context}` on stdin as a single JSON object,
and must emit one final line on stdout: `{"output": "...", "error"?: bool, "meta"?: {...}}`.

Anything else printed to stdout/stderr is captured for audit but
NOT shown to the model.

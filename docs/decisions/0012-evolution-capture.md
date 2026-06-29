# ADR-0012 — Evolution Capture v0 (Feedback Events)

- Status: Accepted (2026-06-29)
- Context spiral: 2/4
- Depends on: [ADR-0009](0009-intent-provenance.md), [ADR-0011](0011-surface-parity.md)

## Decision

Evolution starts at the *event* level. Before any "auto-derive a skill from
patterns" magic, we need a primitive that costs almost nothing to capture
and accumulates value over time:

A **feedback event** is a `MemoryEntry { kind: 'evolution.feedback' }` that
points back at another entry in the same JSONL by `targetSeq` and records
the human's verdict. v0 has exactly three verdicts:

| verdict          | meaning                                           | required extras |
|------------------|---------------------------------------------------|-----------------|
| `accept`         | this was the right thing to do                    | (optional note) |
| `reject`         | this was wrong / should not have happened         | (optional note) |
| `i-would-have`   | here is what should have happened instead         | `suggestion`    |

Feedback events go into the **same JSONL** as the original session events:
- `grepMemory()` sees them automatically (one source of truth)
- `readSession()` includes them in replay (visible in the audit view)
- No new storage layer, no new index, no cross-file joins

## Surfaces (Surface Parity, ADR-0011)

| Surface | Capability |
|---|---|
| `x feedback <sess> <seq> <verdict> [--note ..] [--suggestion ..]` | record |
| `x feedback list [--session ID] [--verdict V]` | review |
| `POST /api/feedback` | record (web write-side debut) |
| `GET  /api/feedback?session&verdict&limit` | review |
| Web `#/feedback` view | review with filters |
| Web `#/sessions/<id>` per-entry 👍/👎/💡 buttons | record inline |

The CLI is canonical; web is convenience. Both call the same
`appendFeedback()` library function and produce identical JSONL bytes.

## Concurrency safety

`appendFeedback()` uses `fs.appendFile()`, which is atomic on POSIX for
writes under PIPE_BUF (4096B). A feedback event line is well under that,
so concurrent appends with a live session's `WriteStream` don't tear.

The `seq` is assigned by re-scanning the file (`max(seq) + 1`). If a live
session writes between our scan and our append, the seqs may collide. This
is acceptable for v0 because:
- nothing in the codebase requires seq uniqueness (only ordering)
- feedback is human-paced (rare), live writes are model-paced
- if it becomes a real issue we'll introduce an OS-level advisory lock or
  hand off to the session's MemoryStore via a small IPC channel

## Out of scope (v0)

- **Skill draft generation** from accumulated rejects/`i-would-have`s. The
  schema is intentionally simple so that this is doable later without
  schema migration.
- **Embedding / clustering** of feedback. Same reasoning.
- **Quorum / multi-user verdicts**. There's one human per machine for now.
- **Threading replies on feedback**. Use a new feedback event pointing at
  the previous feedback's seq if needed.

## Phase-∞ compatibility (vision §0)

When x_harness IS the OS, "user clicked the 👎 button" is a syscall-level
signal indistinguishable from any other kernel event. The current
`evolution.feedback` shape is a strict subset of that future event:
`(actor=human, target=event-id, verdict, freeform)`. No schema lift
required.

## Consequences

- **Write side opens up.** Until today, every web endpoint was GET. Now
  there is a single POST surface (`/api/feedback`). We add minimal
  `readBody()` + JSON parse only; no framework, no body-size > 64KB, no
  CSRF token (local-only server bound to 127.0.0.1).
- **The "1 to 100 to ∞" pattern of vision §0 has its first data substrate.**
  The model can later read its own JSONL via tools (existing
  `x memory grep` doubles as that surface) and inspect what humans
  accepted vs rejected.
- **Autonomy ladder (ADR-0009) gets training data.** When 2/2b lands,
  reject events on `model-self-initiated` actions become the negative
  examples for tightening the autonomy heuristic.

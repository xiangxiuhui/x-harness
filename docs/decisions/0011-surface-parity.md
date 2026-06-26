# 0011 — Surface Parity (CLI ↔ Web ↔ future surfaces)

- **Status**: Accepted
- **Date**: 2026-06-26
- **Spirals**: 2/3 (Web UI v0)
- **Relates to**: ADR-0002 (Actor), ADR-0006 (Memory JSONL), ADR-0009 (Provenance), ADR-0010 (World Awareness)

## Context

Spiral 2/3 introduces a Web UI alongside the existing CLI. The danger: in
most agent projects the GUI quickly grows its own state model, its own
session store, its own quirks — and the CLI rots. We do not have the
luxury of two divergent surfaces; this is an OS, not a SaaS dashboard.

Phase ∞ vision (vision.md §0): when x_harness owns the kernel, there will
be many more surfaces — voice, ambient, AR, sensors, third-party clients
talking to the harness over a local socket. All of them MUST converge on
the same view of "what happened in the system". A surface that lies, or
that introduces a private notion of "session", is worse than no surface.

## Decision: Surface Parity Rules

Every surface (CLI, Web, future GUI/voice/etc.) is bound by these rules:

1. **Single source of truth on disk.**
   The canonical state lives at `~/.x_harness/`:
   - `memory/<sessionId>.jsonl` — append-only event log (ADR-0006)
   - `memory/index.jsonl` — session header index
   - `territory.yaml` — authorized perimeter (ADR-0010)
   - `skills/` — installed skills (ADR-0008)
   - (future) `evolution/`, `provenance/`, etc.
   No surface owns a private database, cache that drifts, or in-memory
   shadow that diverges from disk.

2. **Surfaces are renderers, not authors of new concepts.**
   A surface MAY render and combine; it MAY add UX affordances (live tail,
   syntax highlight, search). It MAY NOT introduce concepts that don't
   exist on disk or in shared packages. If a Web feature requires a new
   concept, that concept lands first in `@x_harness/{core,memory,...}` and
   in the CLI; only then in the Web UI.

3. **CLI is the canonical implementation.**
   When a behavioural question arises ("what counts as a session end?",
   "how is a doc-skill detected?"), the CLI's answer is the truth. Web and
   other surfaces re-use the same loaders (`buildSkillRegistry`,
   `loadTerritory`, `listSessions`, `readSession`, …). They MUST NOT
   reimplement these.

4. **Every Web view has a CLI equivalent (and vice-versa for read views).**
   | Web                                     | CLI equivalent                                     |
   |-----------------------------------------|----------------------------------------------------|
   | `#/sessions`                            | `x sessions ls`                                    |
   | `#/sessions/:id`                        | `x sessions show <id>`                             |
   | `#/sessions/:id/live`                   | `tail -f ~/.x_harness/memory/<id>.jsonl` (lossless)|
   | `#/territory`                           | `cat ~/.x_harness/territory.yaml` + parsed zones   |
   | `#/skills`                              | `/skills` (chat slash) / future `x skills ls`      |

   Write paths (chat, approvals) live in the CLI first, Web in v1.

5. **Local-only by default.**
   The web server binds `127.0.0.1` only. There is no auth in v0; the OS
   grants this socket to your `$USER`. Any future remote surface needs a
   separate ADR that addresses identity, encryption, and scope.

6. **Zero external runtime deps for transport.**
   Use `node:http`, SSE, plain fetch, vanilla DOM. The OS project owns its
   own plumbing. We will not let a pile of npm packages decide our shape.

7. **No proprietary IPC.**
   Surfaces talk to the harness over (a) the JSONL files, (b) a documented
   HTTP API mirroring shared packages. No surface-private RPC.

## Consequences

- **Pro**: surfaces stay cheap to add; behaviour cannot silently fork; the
  audit trail (JSONL) remains the single artifact you need to reproduce
  any conversation in any surface.
- **Pro**: phase ∞ migration is easier — when the harness owns the kernel,
  these same `loadTerritory`/`listSessions`/etc. functions become thin
  wrappers over kernel APIs, and surfaces don't notice.
- **Con**: cannot ship a Web feature that "feels nice in browser" without
  first justifying it in the package and CLI. We accept the friction.
- **Con**: live tail via SSE means the Web is read-after-write — if the
  CLI hasn't flushed a JSONL line, the Web won't show it. We accept this;
  it forces honesty (the disk is the truth).

## Implementation note (v0, this commit)

- `@x_harness/web` — `node:http`-based server in `src/server.ts`,
  static SPA in `public/`. Endpoints: `/api/health`, `/api/sessions`,
  `/api/sessions/:id`, `/api/sessions/:id/tail` (SSE),
  `/api/territory`, `/api/skills`.
- `x web [--port N] [--host H]` — CLI subcommand; reuses the same
  `buildSkillRegistry`/`loadTerritory`/`listSessions` as `x chat`.
- Read-only. Chat/approval over web is deferred to v1 (post 2/2 Rust work).

## Open questions

- **OQ1**: When `x chat` runs in terminal A and `x web` in terminal B, the
  Web sees `chat`'s session live via SSE. But if the user opens **two**
  `x chat` sessions simultaneously, the Web should let them switch. v0
  works (each session is a separate JSONL) but the UX of "which is live
  right now" needs polish; v1 to add a per-session "active" badge driven
  by file mtime + index.jsonl `op:start` without `op:end`.
- **OQ2**: Should the live SSE stream also include skill/territory file
  changes (e.g. user edits territory.yaml, banner updates)? Probably yes,
  via a separate `/api/events` channel. Defer.
- **OQ3**: Web v1 (write side) — POST /api/chat with provenance carrying
  `executor=human` `surface=web`. Approval prompts will need a small
  bidirectional channel; SSE + POST is sufficient (no WS needed).

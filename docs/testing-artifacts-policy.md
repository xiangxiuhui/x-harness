# Test and Dogfood Artifacts Policy

This note records code/docs added primarily for validation and dogfood, and whether they should be exposed to end users.

## Principle

Validation hooks must not automatically become product UX.

A debug entry point can change:

- user experience (extra commands, confusing banners, accidental state changes)
- security posture (new ways to dump context, create durable artifacts, or bypass normal flows)
- support burden (users rely on unstable internal behavior)

Therefore dogfood and smoke-test functionality should live in tests or `tools/` unless deliberately promoted through an ADR/product review.

## Recent artifacts

| Artifact | Purpose | User-facing? | Decision |
|---|---|---:|---|
| `docs/dogfood-2026-06-30-compaction.md` | Real-network compaction dogfood report | No | Keep as engineering evidence |
| `docs/dogfood-2026-07-01-discover-skills-session.md` | UX/friction dogfood report | No | Keep as engineering evidence |
| `docs/dogfood-2026-07-01-discover-skills-correction.md` | Correction report for audit/runtime truth gap | No | Keep as engineering evidence |
| `tools/dogfood-compaction.ts` | Real-network compaction dogfood driver | No | Keep internal; not install-time path |
| `tools/dogfood-inspect-summary.ts` | Summary quality dogfood helper | No | Keep internal |
| `tools/smoke-snapshot-audit.ts` | Offline runtime snapshot → bus → JSONL → digest smoke | No | Keep internal semi-integration test |
| `packages/core/test/bus.test.ts` | Unit coverage for event id/durability | No | Keep as normal unit test |
| `Session.takeSnapshot()` | Runtime-truth inspection API | Not directly | Keep as internal API / future debug foundation |
| `Session.persistSnapshot()` | Snapshot sidecar + audit event | Not directly | Keep internal; no chat command |
| `context.snapshot.persisted` MemoryEntry | Audit index for snapshot artifacts | Indirectly via `x sessions show` if produced internally | Keep |
| `x chat /snapshot` | Manual smoke validation command | Yes | Removed; do not expose by default |
| `x chat --snapshot-and-exit` | Non-interactive smoke validation command | Yes | Removed; replaced by `tools/smoke-snapshot-audit.ts` |

## Why `/snapshot` was removed

The command was useful for proving the observability loop, but it is not yet a user feature:

1. It exposes a context-dump sidecar operation inside the main chat UX.
2. It can confuse users because snapshot files are diagnostic artifacts, not conversation content.
3. It changes the visible command surface before the security and retention semantics are designed.
4. It encourages manual context management, which conflicts with ADR-0013's autonomy-first principle.

If promoted later, it should be a deliberate debug/admin command with:

- clear name (`x debug snapshot`, not chat slash command)
- retention policy
- redaction rules
- explicit docs that it captures runtime context metadata (and whether full messages are included)
- parity plan for Web/API surfaces if required by ADR-0011

## Install / release validation policy

Before asking a user to install-test a version, the local branch should pass:

```bash
npm run typecheck
for f in packages/core/test/*.test.ts; do pnpm tsx "$f"; done
pnpm tsx tools/smoke-snapshot-audit.ts
```

Then, for actual installer validation:

1. commit all changes locally
2. push a branch or tag
3. install/upgrade into a disposable `X_HARNESS_HOME`
4. run `x chat` in interactive mode for a small real task
5. inspect `x sessions show <sid>` and sidecars

Do not rely solely on slash-command test hooks inside production chat.

## Current gap

The project has good unit coverage around core pieces, but lacks a first-class semi-integration test harness for CLI flows. The ad hoc `script`/pipe attempt showed why: readline/TTY behavior differs from non-TTY pipes. Internal smoke scripts should construct the core objects directly unless the goal is specifically to test terminal behavior.

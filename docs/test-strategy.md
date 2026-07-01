# Test Strategy and Closed-Loop Dogfood

This document defines the required validation loop for x_harness features and the layered test case system that turns architecture decisions into executable checks.

## 0. Core rule: closed-loop validation is required

For any feature that changes runtime behavior, install behavior, CLI behavior, memory/audit semantics, or model/tool loop invariants, local tests are not enough.

The required closure is:

```text
local implementation
  → local typecheck / unit / smoke
  → commit
  → push origin main
  → real install/update from origin/main
  → installed CLI dogfood
  → record result / add regression case
```

The reason is simple: x_harness is itself the operating harness. A feature is not really done until the pushed version can update the installed harness and the installed CLI can verify itself.

## 1. Validation gates

### Gate A — local source validation

Run before commit for all non-trivial changes:

```bash
npm run test:closed-loop:local
```

This expands to:

```bash
npm run typecheck
npm run test:core
npm run test:smoke
```

### Gate B — push + install/update validation

Run after a change is committed and intended for real use:

```bash
git push origin main
bash .codeflicker/skills/x-harness-install-update/scripts/update-install.sh --home "$HOME/.x_harness" --branch main
```

This must verify that `install.sh` can pull the pushed commit into `~/.x_harness/src`, preserve runtime state, refresh dependencies, and write `~/.x_harness/VERSION`.

### Gate C — installed CLI dogfood

Run after Gate B:

```bash
bash .codeflicker/skills/x-harness-real-dogfood/scripts/real-cli-dogfood.sh --home "$HOME/.x_harness"
```

This checks the installed source and CLI, not the development checkout.

### Gate D — real provider dogfood, opt-in

Use only for model-loop behavior that cannot be validated offline:

```bash
bash .codeflicker/skills/x-harness-real-dogfood/scripts/real-cli-dogfood.sh --home "$HOME/.x_harness" --with-provider
```

Provider tests require API keys and can cost money, so they are never part of the default gate.

## 2. Test case hierarchy

The test suite follows the harness architecture: decisions create invariants, invariants become tests, dogfood failures become regressions.

| Layer | Purpose | Location | Examples | Required for |
|---|---|---|---|---|
| L0 static | Build/type/API coherence | `npm run typecheck` | TS project references, package exports | every change |
| L1 unit | Pure deterministic invariants | `packages/*/test/*.test.ts` | token estimation, config parsing, danger rules, event durability | library logic |
| L2 component/integration | Multiple modules with fake provider / fake home | `packages/core/test`, `packages/cli/scripts/e2e-*.ts` | Session compaction, max-rounds protocol, shell provenance | runtime loop changes |
| L3 smoke | Offline end-to-end slice with real storage | `tests/smoke/*.ts` | snapshot → bus → JSONL → digest | observability/audit/storage changes |
| L4 installed CLI | Pushed main installed into `~/.x_harness` | `.codeflicker/skills/x-harness-real-dogfood` | `x version`, installed typecheck, core tests, smoke, sessions ls | release-ready changes |
| L5 real provider | Real model + API keys + real long task | dogfood skill opt-in + reports | compaction quality, skill-loading UX, summary quality | model behavior / prompt quality |

## 3. Architecture-to-test map

| Area / ADR | Key invariant | Current tests | Missing / next cases |
|---|---|---|---|
| ADR-0003 Provider | SSE chunks map to stable `ChatChunk`; aux model available when configured | `aux-model.test.ts` | provider error taxonomy, retry/backoff, multi-provider conformance |
| ADR-0005 Danger | Class A/B detection is conservative; confirmations do not silently deny typos | danger package tests; chat prompt regression via dogfood | shell command static-analysis expansion tests for new write forms |
| ADR-0008 Skills | Skill = doc + scripts; progressive disclosure; on-disk runtime opt-in only | skill runtime tests, `examples/skills/greet` | installed CLI skill discovery regression, malformed skill quarantine |
| ADR-0009 Provenance | File writes attach actor + intent; JSONL remains source of truth | `packages/cli/scripts/e2e-provenance.ts`, `e2e-shell-provenance.ts`, `e2e-autonomy.ts` | installed CLI provenance smoke; cross-filesystem xattr loss recovery |
| ADR-0011 Surface Parity | CLI/Web/API share lib entry points; behavior is not duplicated | memory grep / feedback parity docs and manual checks | formal route-vs-CLI parity smoke |
| ADR-0012 Evolution | Feedback appends to same memory stream and is queryable | manual e2e in status docs | automated feedback append/list/grep smoke |
| ADR-0013 Compaction | Pre-turn compaction preserves tool-call pair invariant, uses aux model, stores sidecars | `compaction.test.ts`, `session-compaction.test.ts`, `aux-model.test.ts`, `tiktoken-adapter.test.ts` | installed long-run provider dogfood case behind `--with-provider` |
| ADR-0014 Context Snapshot | Runtime snapshot sidecar has audit index and does not become user UX | `tests/smoke/snapshot-audit.ts`, `bus.test.ts` | retention/redaction policy before any debug command promotion |
| Event Observability | Audit-worthy bus events enter JSONL; ephemeral events do not double-write | `bus.test.ts`, `tests/smoke/snapshot-audit.ts` | event schema compatibility tests |
| Installer | Upgrade preserves runtime data and refreshes installer-managed source | install-update skill real run | disposable-home install smoke in CI-like local script |

## 4. Test case lifecycle

When a bug is found:

1. Record the user-visible symptom.
2. Identify the architectural invariant that failed.
3. Add the smallest deterministic L1/L2 regression if possible.
4. If the bug spans storage/CLI/install, add or extend an L3/L4 smoke case.
5. If the bug requires real model behavior, add an L5 opt-in dogfood case and a report under `docs/dogfood-*.md`.
6. Remove any temporary user-facing debug command unless it is intentionally promoted through ADR/product review.

## 5. What should not happen again

Do not add validation-only features directly to product UX, such as:

- chat slash commands that dump internal runtime state
- public CLI flags whose only purpose is test setup
- ad hoc scripts under `tools/` that become permanent without ownership

Instead:

- pure/library invariant → package test
- offline cross-module behavior → `tests/smoke/`
- installed behavior → `.codeflicker/skills/x-harness-real-dogfood`
- real model behavior → opt-in dogfood case + report

## 6. Current baseline command set

```bash
npm run test:closed-loop:local

git push origin main
bash .codeflicker/skills/x-harness-install-update/scripts/update-install.sh --home "$HOME/.x_harness" --branch main
bash .codeflicker/skills/x-harness-real-dogfood/scripts/real-cli-dogfood.sh --home "$HOME/.x_harness"
```

A feature that affects runtime/install/CLI behavior is not considered closed until this sequence passes or a documented exception explains why it was not run.

# Event Observability Cross-Analysis — opencode / openclaw → x_harness

Date: 2026-07-01

This note follows the dogfood correction where x_harness had a runtime-observable but audit-invisible `context.compacted` event. The goal is to extract event design lessons before adding more observability surface.

## Current x_harness baseline

After the P0-P2 fixes:

- Runtime event channel: `ActorBus`
- Audit channel: Memory JSONL
- Bus→JSONL bridge exists for structural runtime mutations:
  - `context.compacted`
  - `error`
- Runtime truth debug surface exists minimally:
  - `Session.takeSnapshot()`
  - `Session.persistSnapshot()`
- Open issue: event taxonomy and lifecycle are still ad hoc. Adding a new event must come with persistence/display/replay decisions.

## opencode lessons

### 1. Events have stable ids at the bus boundary

`refs/opencode/packages/opencode/src/bus/global.ts` assigns ascending `evt*` ids if a payload lacks one. This makes streamed events deduplicable and replay-friendly.

**x_harness implication:** `ActorEvent` currently has `ts` but no id. Add `id` before introducing more event kinds.

### 2. Separate live stream from durable sync stream

`refs/opencode/packages/opencode/src/event-v2-bridge.ts` emits:

- a normal global bus event for live consumers
- a second `sync` event only when the underlying event is durable

This is a clear version of our "bus-only vs bus→JSONL" distinction.

**x_harness implication:** Add an explicit durability classification to event definitions instead of relying on each CLI subscriber remembering what to persist.

### 3. Event streams carry routing/location metadata

opencode attaches directory/workspace/project location at publish time so subscribers can filter without understanding producer internals.

**x_harness implication:** Include `sessionId` and maybe `cwd`/`xHarnessHome` in structural events that may appear in global diagnostics.

### 4. Compaction is represented as a domain event, not just logs

opencode has a dedicated `SessionCompactionEvent` and also marks pruned tool parts with a `compacted` timestamp.

**x_harness implication:** keep `context.compacted`, but ensure it includes enough fields to link to sidecars and snapshots. Avoid relying on generic `error`/log lines for successful structural changes.

## openclaw lessons

### 1. Bounded ring buffers for high-volume diagnostic events

`refs/openclaw/src/talk/session-log-runtime.ts` records voice bridge events but drops raw audio append events and caps the buffer at 40 entries.

**x_harness implication:** for high-volume events (stream deltas, token estimates, heartbeats), prefer ring-buffer health snapshots over durable JSONL rows.

### 2. Health snapshots expose recent state, not full history

openclaw exposes compact health objects:

- last event timestamp/type/detail
- recent N events
- counts

**x_harness implication:** `Session.takeSnapshot()` should evolve into a diagnostic health envelope, not a full log clone. Persist full messages only when explicitly requested.

### 3. Explicit filtering at record time

openclaw filters noisy `input_audio_buffer.append` events before they enter diagnostics.

**x_harness implication:** do not make JSONL the default sink for all bus events. Classify before recording.

## Proposed x_harness event policy

### Event channels

| Channel | Purpose | Examples | Persistence |
|---|---|---|---|
| Runtime bus | Immediate internal coordination / CLI hints | all events | in-memory |
| Audit JSONL | Proof of semantic/structural state changes | messages, tool calls, approvals, `context.compacted`, `error`, future `context.snapshot.persisted` | durable |
| Health ring buffer | Recent noisy diagnostics | stream deltas, token-estimate samples, heartbeat, tool-round resets | bounded memory / optional snapshot |
| Sidecars | Large payloads | tool output bodies, optional full context snapshots | durable file |

### Durability rule

Persist an event to JSONL if it changes either:

1. what the next provider request sees; or
2. what a human/auditor needs to explain a later state.

Otherwise keep it bus-only or health-ring-only.

### Event shape direction

Future `ActorEvent` should become:

```ts
interface ActorEvent<K extends string = string, P = unknown> {
  id: string;              // evt_* ascending id
  ts: number;              // epoch ms
  actor: Actor;
  kind: K;
  payload: P;
  durability?: 'ephemeral' | 'audit' | 'sidecar';
  scope?: {
    sessionId?: string;
    cwd?: string;
    xHarnessHome?: string;
  };
}
```

### Candidate next events

| Kind | Durability | Why |
|---|---|---|
| `context.compacted` | audit | runtime truth changed |
| `context.snapshot.persisted` | audit | debug artifact created |
| `safety.max-rounds.hit` | audit | explains skipped tool calls / model behavior |
| `safety.max-rounds.reset` | ephemeral | bookkeeping unless surfaced to provider |
| `tool.output.sidecar.created` | audit or folded into `context.compacted` | proves large payload moved |
| `config.loaded` | ephemeral by default | useful but noisy; include in snapshot instead |
| `stream.delta` | health only | too high-volume for JSONL |

## Near-term recommendation

Do not redesign the whole event system immediately. The next safe step is:

1. Add event ids to `ActorBus` emitted events. ✅ already present
2. Add a small event registry/classifier (`actorEventDurability(kind)`). ✅ landed
3. Move CLI bus→JSONL persistence from ad hoc `if` checks to classifier-based routing. ✅ landed
4. Emit `context.snapshot.persisted` when `persistSnapshot()` writes a file. ✅ landed
5. Keep high-volume diagnostics as bounded health buffers, not JSONL. ⏭️ next

## Manual validation loop

To verify the full runtime→bus→JSONL→digest loop:

```bash
# Non-interactive smoke test (does not call provider)
x chat --snapshot-and-exit
x sessions show <printed-session-id> | grep 'snapshot persisted'

# Or inside a real interactive chat:
x chat
# note the printed session id, e.g. sess-abc123
> /snapshot
> /exit
x sessions show sess-abc123 | grep 'snapshot persisted'
ls ~/.x_harness/sessions/sess-abc123/snapshots/
```

Expected:

- CLI prints `context snapshot persisted: ...` from the bus subscriber
- CLI prints `snapshot persisted: <file>` from the command handler
- `x sessions show` includes a `📸 snapshot persisted ...` line
- the snapshot JSON file exists under `sessions/<sid>/snapshots/`


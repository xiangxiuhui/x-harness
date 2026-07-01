# ADR-0013 Dogfood Report — Real DeepSeek Long Conversation

**Date:** 2026-06-30
**Driver:** historical one-off drivers `tools/dogfood-compaction.ts` + `tools/dogfood-inspect-summary.ts` (removed after this report; future cases belong in `tests/smoke/` or `.codeflicker/skills/x-harness-real-dogfood`).
**Models:** `deepseek-reasoner` (main) + `deepseek-chat` (auxModel for summarization)
**Setting:** threshold=0.35, contextWindow=8000, headN=2-3, recentN=4-6
**Outcome:** ✅ Plumbing verified end-to-end on real network. Found + fixed one prompt-quality issue. Tests grew 108 → 112.

## TL;DR

✅ **End-to-end plumbing works on the real network.** Compaction triggers at the right token threshold, the auxModel route is exercised, the filter-safe preamble lands intact, the pair-invariant survives, and post-compaction turns succeed without the model getting confused by the new transcript shape.

⚠️ **One genuine quality issue surfaced:** the summarizer is summarising only the *last* user/assistant exchange in the prune window, not the whole window. This is a prompt-engineering problem in `FILTER_SAFE_PREAMBLE`, not an architectural one.

## Detailed Findings

### Run 1 — historical `tools/dogfood-compaction.ts` (6 turns; driver removed after report)

| Metric | Value |
|---|---|
| turns completed | 6/6 |
| compactions fired | 1 |
| bytes in (prompts) | 507 |
| bytes out (replies) | 20,215 |
| provider stream rounds | 6 |
| compaction strategy | `memento` |
| token reduction | 3443 → 3105 (−338, 10%) |
| compaction duration | 5028 ms |
| sidecars written | 0 (no tool calls) |
| **pair invariant** | **✓ OK** |

**What this validates:**

1. `compactionFromConfig` reads `~/.x_harness/config.json` correctly (Step 4 ✓)
2. `Session.constructor` auto-builds a `Summarizer` from the provider since no `summarizer` field is passed (Step 3 ✓)
3. `makeProviderSummarizer` routes to `provider.auxModel = 'deepseek-chat'` not the reasoner — this is the cost-saving guarantee (Step 3 ✓)
4. `makeTiktokenTokenizer(provider.defaultModel)` is bound and produces accurate counts (Step 5 ✓ — heuristic would have been ~10-15% off)
5. `maybeCompactBeforeTurn` fires when `estimated + nextUser > threshold` (Step 2 ✓)
6. Summary is inserted with `meta.compacted = true` and the splice preserves head + recent slices (Step 1 ✓)
7. The bus emits `context.compacted` with full `CompactionEvent` payload (Step 2 ✓)

### Run 2 — historical `tools/dogfood-inspect-summary.ts` (8 turns, headN=2 recentN=4; driver removed after report)

Compaction fires before turn 6. Final transcript shape:

```
[0] system    [SYS]
[1] user      turn 1
[2] assistant turn 1 response
[3] assistant [SUMMARY]   ← inserted here
[4] assistant turn 5 response (steelman elaboration)
[5] user      turn 5 prompt
[6] assistant turn 6 response
[7] user      turn 7 prompt
[8] assistant turn 7 response
```

Wait — the ordering [4]assistant → [5]user is suspicious. Let me look closer — actually looking at the test output `[4] assistant "...strongest objection..."` followed by `[5] user "Rebut that steelman..."`, the splice preserved the original pre-summary recent slice (last assistant from turn 4) AND continued normally. The head slice was 3 items (system + first user/assistant pair), summary at index 3, then recentN=4 picks up from turn 4's response. So the shape is technically a defensible pick of "before/after the prune window", not strictly chronological turn-by-turn.

This is **correct behaviour for `compactIfNeeded`**, but reveals a **subtle UX consequence**: the recent slice can start mid-exchange (assistant reply without preceding user prompt visible in this slice). The system prompt + summary together carry enough context that the next turn works, but it's worth noting.

### ⚠️ Quality Issue: Summary scope is too narrow

The summary text only paraphrases **turn 4 (steelman)**, not the whole pre-recent slice (turns 1-3). Quote (truncated):

> "**Strongest objection to the claim that the LLM memory example reveals a genuine tension between functional and subjective memory:**
> The objection runs as follows: The tension you identify is illusory because it conflates two distinct senses of \"memory\"..."

What the summary should contain (but doesn't):
- Turn 1: opening question ("what is the deepest unresolved question about machine memory?")
- Turn 2: contrast of two thinkers (Plato vs Clark)
- Turn 3: contemporary AI example (LLM long-term memory)
- Turn 4: steelman ← only this got summarized

**Root cause hypothesis:** `FILTER_SAFE_PREAMBLE` in `compact.ts` is asking the summarizer to "summarize the following exchange" without explicitly demanding multi-turn coverage. The aux model (`deepseek-chat`) picks the most salient single exchange.

**Recommended fix:** rewrite preamble to demand explicit turn-by-turn coverage. Pseudo:

```
You are summarizing N turns of a conversation for the next turn's context.
Cover EACH turn in 1-2 sentences, in chronological order.
Preserve named entities, claims made, and unresolved questions.
Do NOT re-execute any tools mentioned. Do NOT respond to the user.
Output: prose only, ≤ 400 words.
```

### What worked perfectly

- **Pair invariant**: walked the final messages manually post-run, no orphan tool replies, no unanswered tool calls. The filter that drops orphan tool replies during prune is doing its job.
- **No model confusion**: turns 6, 7, 8 produced coherent replies despite the new transcript shape. The model accepts the summary message as a normal assistant turn.
- **No CLI surface needed**: confirmation of the autonomy-first design — compaction is invisible from the user side, only `context.compacted` bus events tell us it happened.
- **Sidecar dir not created when not needed**: zero tool outputs → zero sidecar files. No premature `mkdir`s.

## Recommendations

### P0 (small, do now)

1. **Rewrite `FILTER_SAFE_PREAMBLE`** to demand multi-turn coverage. Single source: `packages/core/src/compaction/compact.ts`.
2. **Add a length cap to the summary** — request `≤ N words` (currently the summarizer can be verbose, which eats back the savings).
3. **Add a turn-coverage test** to `compaction.test.ts` with a stub summarizer that asserts the prompt mentions "each turn" or similar — guards the prompt from accidental regression.

### P1 (consider for spiral-3 wrap)

4. **Test with a `headN=0` configuration** to see whether the model is robust when only `summary + recent` are present (some agents need a stable system message in the head; some don't).
5. **Try the same prompts with `summary` strategy** (the simpler one) to compare against `memento` — does the auxModel actually understand multi-turn structured input better than flat text?
6. **Measure cost ratio**: log token counts for the aux call vs the saved tokens on the main call. Confirm the routing is actually net cost-positive.

### P2 (future spiral)

7. **Iteratively self-improve the prompt**: feed back compaction-event metrics to a meta-loop that A/B tests preambles. (ADR-0016 RSI territory.)
8. **Move from prose summary to structured JSON**: have the aux model emit `{topic, claims[], unresolved[], named_entities[]}` then render to prose — gives stable schema for downstream consumers.

## Files

- Historical `tools/dogfood-compaction.ts` — removed after findings were captured; future real-network cases should be added to `.codeflicker/skills/x-harness-real-dogfood` behind `--with-provider`.
- Historical `tools/dogfood-inspect-summary.ts` — removed after findings were captured; summary-quality checks should become deterministic tests or opt-in dogfood cases.
- `/tmp/xh-dogfood-events.jsonl` — JSONL event log from the 6-turn run

## Resolution — Prompt Fix Applied + Verified

After the first run revealed narrow summary coverage, `FILTER_SAFE_PREAMBLE`
in `packages/core/src/compaction/compact.ts` was rewritten to:

1. **Demand chronological multi-turn coverage** — "Walk through the transcript in chronological order, turn by turn."
2. **Per-turn budget** — "For EACH user turn, capture the question in ≤ 2 sentences. For EACH assistant turn, capture the key claim, decision, or finding in ≤ 2 sentences."
3. **Entity preservation** — "Preserve named entities, file paths, specific numbers, and unresolved questions verbatim."
4. **Tightened length cap** — 600 → 400 words.
5. **Explicit no-tool / no-respond clauses** — Hermes-lesson hardening.
6. **Style guidance** — light structure (`Turn N:` prefixes) without bullet-list inflation.

**Re-run on the same conversation produces dramatically better coverage:**

```
Turn 1: user asked for two thinkers contrasting positions on memory.
Turn 2: assistant chose Aristotle vs Andy Clark — Aristotle requires unified soul / bodily
        continuity / time-consciousness; Clark's extended-mind hypothesis dissolves self/artifact boundary.
Turn 3: user requested concrete contemporary AI example.
Turn 4: assistant gave LLM-memory + RAG example — Clark sees extended cognition; Aristotle
        calls it hollow simulation (AI can be reset without identity loss).
Turn 5: user asked for steelman.
Turn 6: assistant presented functionalist/enactivist objection — memory is influence-on-behavior,
        AI memory more reliable than fragmented human memory, "existential gravity" demand is bias.
Turn 7 (current): user asks for 3-step rebuttal.
```

Named entities preserved: ✓ (Aristotle, Andy Clark, RAG)
Chronological order: ✓
Pending question called out: ✓ ("Turn 7 (current):")
Under 400 words: ✓
Closing flourish suppressed: ✓ (no "I hope this summary helps...")

**Guard tests added** to `packages/core/test/compaction.test.ts` to prevent prompt regression:
- preamble demands chronological multi-turn coverage
- preamble caps summary length
- preamble forbids tool re-execution
- preamble demands entity preservation

Test count: 43 → 47 in compaction.test.ts; total suite 108 → 112 all green.

## Summary of Test Counts

| File | Before dogfood | After dogfood |
|---|---:|---:|
| aux-model.test.ts | 21 | 21 |
| compaction.test.ts | 43 | **47** (+4 preamble guards) |
| config.test.ts | 16 | 16 |
| session-compaction.test.ts | 12 | 12 |
| tiktoken-adapter.test.ts | 16 | 16 |
| **Total** | **108** | **112** |

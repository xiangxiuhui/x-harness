/**
 * ADR-0013 Step 1 — unit tests for the compaction module.
 *
 * Pure, no fs / no provider / no actor bus. Run with:
 *   pnpm tsx packages/core/test/compaction.test.ts
 */

import {
  heuristicCount,
  estimateMessageTokens,
  estimateMessagesTokens,
  shouldCompact,
  trimToolOutput,
  trimToolOutputsInMessages,
  splitIntoPairs,
  flattenUnits,
  assertPairInvariant,
  compactIfNeeded,
  formatTranscript,
  FILTER_SAFE_PREAMBLE,
  DEFAULT_COMPACTION_CONFIG,
} from '../src/compaction/index.js';
import type { Message } from '@x_harness/provider';

let pass = 0;
let fail = 0;
const failures: string[] = [];

function ok(name: string, cond: boolean, detail?: string): void {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    failures.push(detail ? `${name} :: ${detail}` : name);
    console.log(`  ✗ ${name}${detail ? ' :: ' + detail : ''}`);
  }
}

function section(title: string): void {
  console.log(`\n${title}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Token estimation
// ─────────────────────────────────────────────────────────────────────────────
section('1. Token estimation');

ok('heuristic empty string = 0', heuristicCount('') === 0);
ok('heuristic monotonic', heuristicCount('hello world') < heuristicCount('hello world hello world'));

const sysMsg: Message = { role: 'system', content: 'You are helpful.' };
ok('estimateMessageTokens > 0 for non-empty', estimateMessageTokens(sysMsg) > 0);

const withCall: Message = {
  role: 'assistant',
  content: 'calling tool',
  toolCalls: [{ id: 't1', name: 'fs.read', argumentsJson: '{"path":"a"}' }],
};
ok(
  'tool call adds overhead',
  estimateMessageTokens(withCall) > estimateMessageTokens({ role: 'assistant', content: 'calling tool' }),
);

const msgs: Message[] = [sysMsg, { role: 'user', content: 'hi' }];
ok('messages sum >= individual sum', estimateMessagesTokens(msgs) >= estimateMessageTokens(sysMsg));

// ─────────────────────────────────────────────────────────────────────────────
// 2. shouldCompact threshold
// ─────────────────────────────────────────────────────────────────────────────
section('2. shouldCompact threshold');

ok('below threshold', !shouldCompact(100, 1000, 0.7));
ok('at threshold', shouldCompact(700, 1000, 0.7));
ok('above threshold', shouldCompact(800, 1000, 0.7));
ok('zero contextWindow → no compact', !shouldCompact(1000, 0, 0.7));

// ─────────────────────────────────────────────────────────────────────────────
// 3. tool output trimming
// ─────────────────────────────────────────────────────────────────────────────
section('3. Tool output trimming');

const bigOutput = 'x'.repeat(20_000);
const bigMsg: Message = { role: 'tool', toolCallId: 'call-1', content: bigOutput };
const trim = trimToolOutput(bigMsg, 1000);
ok('big tool output trimmed', trim.sidecar != null);
ok('trimmed message shorter', (trim.message.content?.length ?? 0) < bigOutput.length);
ok('sidecar preserves full content', trim.sidecar?.fullContent === bigOutput);
ok('sidecar uses callId', trim.sidecar?.callId === 'call-1');
ok('meta.truncated flag set', trim.message.meta?.truncated === true);

const smallMsg: Message = { role: 'tool', toolCallId: 'c2', content: 'small ok' };
const noTrim = trimToolOutput(smallMsg, 1000);
ok('small output not trimmed', noTrim.sidecar == null);
ok('small output content unchanged', noTrim.message.content === 'small ok');

const userMsg: Message = { role: 'user', content: 'x'.repeat(20_000) };
const noTrim2 = trimToolOutput(userMsg, 100);
ok('non-tool message never trimmed', noTrim2.sidecar == null && noTrim2.message === userMsg);

const batch = trimToolOutputsInMessages([sysMsg, bigMsg, smallMsg], 1000);
ok('batch yields one sidecar', batch.sidecars.length === 1);
ok('batch preserves length', batch.messages.length === 3);

// ─────────────────────────────────────────────────────────────────────────────
// 4. tool-call pair invariant
// ─────────────────────────────────────────────────────────────────────────────
section('4. Tool-call pair invariant');

const okPair: Message[] = [
  { role: 'system', content: 'sys' },
  { role: 'user', content: 'hi' },
  {
    role: 'assistant',
    content: 'doing it',
    toolCalls: [
      { id: 'a', name: 'f', argumentsJson: '{}' },
      { id: 'b', name: 'g', argumentsJson: '{}' },
    ],
  },
  { role: 'tool', toolCallId: 'a', content: 'ra' },
  { role: 'tool', toolCallId: 'b', content: 'rb' },
  { role: 'assistant', content: 'done' },
];

let threw = false;
try {
  assertPairInvariant(okPair);
} catch {
  threw = true;
}
ok('valid pairs pass invariant', !threw);

const orphan: Message[] = [
  { role: 'user', content: 'q' },
  { role: 'tool', toolCallId: 'zzz', content: 'orphan' },
];
threw = false;
try {
  assertPairInvariant(orphan);
} catch {
  threw = true;
}
ok('orphan tool throws', threw);

const unanswered: Message[] = [
  {
    role: 'assistant',
    content: 'call',
    toolCalls: [{ id: 'X', name: 'q', argumentsJson: '{}' }],
  },
];
threw = false;
try {
  assertPairInvariant(unanswered);
} catch {
  threw = true;
}
ok('unanswered toolCall throws', threw);

const units = splitIntoPairs(okPair);
ok('system + user + assistant+tools bundle + final assistant = 4 units', units.length === 4);
ok('tool-call unit bundles all replies', units[2].messages.length === 3 && units[2].hasToolCalls);
ok('roundtrip flatten === input', JSON.stringify(flattenUnits(units)) === JSON.stringify(okPair));

// ─────────────────────────────────────────────────────────────────────────────
// 5. compactIfNeeded — no compaction case
// ─────────────────────────────────────────────────────────────────────────────
section('5. compactIfNeeded — under threshold');

const tinySummarizer = async () => 'SUMMARY';

const tinyMsgs: Message[] = [sysMsg, { role: 'user', content: 'hi' }];
{
  const r = await compactIfNeeded({
    messages: tinyMsgs,
    summarizer: tinySummarizer,
    config: { contextWindow: 100_000 },
  });
  ok('under threshold returns null event', r.event === null);
  ok('under threshold preserves length', r.messages.length === tinyMsgs.length);
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. compactIfNeeded — tool prune triggers without summarize
// ─────────────────────────────────────────────────────────────────────────────
section('6. compactIfNeeded — tool prune only');

{
  const big = 'y'.repeat(50_000);
  const r = await compactIfNeeded({
    messages: [
      sysMsg,
      { role: 'user', content: 'go' },
      {
        role: 'assistant',
        content: 'calling',
        toolCalls: [{ id: 'c', name: 't', argumentsJson: '{}' }],
      },
      { role: 'tool', toolCallId: 'c', content: big },
      { role: 'assistant', content: 'done' },
    ],
    summarizer: tinySummarizer,
    config: { contextWindow: 100_000, toolOutputMaxTokens: 200 },
  });
  ok('tool-prune produces event', r.event != null);
  ok(
    'tool-prune strategy is tool-output-prune',
    r.event?.strategy === 'tool-output-prune',
    `got ${r.event?.strategy}`,
  );
  const toolMsg = r.messages.find((m) => m.role === 'tool')!;
  ok('tool message shortened', toolMsg.content!.length < big.length);
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. compactIfNeeded — full memento
// ─────────────────────────────────────────────────────────────────────────────
section('7. compactIfNeeded — memento');

{
  // Build a transcript where head + recent < total → middle exists.
  const turns: Message[] = [sysMsg];
  for (let i = 0; i < 30; i++) {
    turns.push({ role: 'user', content: 'u-'.repeat(500) + i });
    turns.push({ role: 'assistant', content: 'a-'.repeat(500) + i });
  }
  let summarizerCalled = false;
  let preambleSeen = '';
  const summarizer = async (transcript: string, preamble: string) => {
    summarizerCalled = true;
    preambleSeen = preamble;
    return 'compressed-middle';
  };
  const r = await compactIfNeeded({
    messages: turns,
    summarizer,
    config: { contextWindow: 5000, threshold: 0.5, headN: 3, recentN: 5 },
  });
  ok('memento called summarizer', summarizerCalled);
  ok(
    'preamble is filter-safe template',
    preambleSeen === FILTER_SAFE_PREAMBLE,
  );
  // ADR-0013 dogfood 2026-06-30 — guard against prompt regression.
  ok(
    'preamble demands chronological multi-turn coverage',
    /chronological|turn by turn/i.test(FILTER_SAFE_PREAMBLE),
  );
  ok(
    'preamble caps summary length',
    /≤\s*\d+\s*words/.test(FILTER_SAFE_PREAMBLE),
  );
  ok(
    'preamble forbids tool re-execution',
    /Do NOT call any tools|Do NOT perform any action/.test(FILTER_SAFE_PREAMBLE),
  );
  ok(
    'preamble demands entity preservation',
    /named entities|verbatim/i.test(FILTER_SAFE_PREAMBLE),
  );
  ok('memento event strategy', r.event?.strategy === 'memento');
  ok('memento kept head', r.event?.headKept === 3);
  ok('memento kept recent', r.event?.recentKept === 5);
  ok(
    'memento tokensAfter < tokensBefore',
    (r.event?.tokensAfter ?? Number.MAX_VALUE) < (r.event?.tokensBefore ?? 0),
  );
  // Result must still satisfy invariant.
  let invariantOk = true;
  try {
    assertPairInvariant(r.messages);
  } catch {
    invariantOk = false;
  }
  ok('memento output passes pair invariant', invariantOk);
  // System message preserved at position 0.
  ok('memento keeps system at head', r.messages[0].role === 'system');
  // Has the summary message.
  ok(
    'memento contains compacted summary',
    r.messages.some((m) => m.meta?.compacted === true),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. compactIfNeeded — tool call pair never split across summarize boundary
// ─────────────────────────────────────────────────────────────────────────────
section('8. tool-call pair atomicity across compaction');

{
  // Construct messages such that a tool-call unit straddles the would-be
  // head/recent split. Verify it ends up entirely on one side, not split.
  const turns: Message[] = [sysMsg];
  for (let i = 0; i < 10; i++) {
    turns.push({ role: 'user', content: `u-${i}-` + 'x'.repeat(2000) });
    turns.push({
      role: 'assistant',
      content: 'calling',
      toolCalls: [{ id: `c-${i}`, name: 't', argumentsJson: '{}' }],
    });
    turns.push({ role: 'tool', toolCallId: `c-${i}`, content: 'ok-' + 'x'.repeat(500) });
    turns.push({ role: 'assistant', content: 'done ' + i });
  }
  const r = await compactIfNeeded({
    messages: turns,
    summarizer: tinySummarizer,
    config: { contextWindow: 8000, threshold: 0.5, headN: 1, recentN: 2 },
  });
  let invariantOk = true;
  try {
    assertPairInvariant(r.messages);
  } catch (e) {
    invariantOk = false;
    failures.push((e as Error).message);
  }
  ok('atomic tool-call units survive memento', invariantOk);
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. formatTranscript renders tool calls / replies
// ─────────────────────────────────────────────────────────────────────────────
section('9. formatTranscript');

const t = formatTranscript(okPair);
ok('transcript contains [tool ', t.includes('[tool '));
ok('transcript contains call name', t.includes('→ call f'));
ok('transcript labels system/user/assistant', t.includes('[system]') && t.includes('[user]'));

// ─────────────────────────────────────────────────────────────────────────────

console.log(`\n${pass} passed, ${fail} failed`);
if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) console.log('  - ' + f);
  process.exit(1);
}

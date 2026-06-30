/**
 * ADR-0013 Step 2 — Session compaction integration test.
 *
 * Uses a fake Provider so we don't need network or skills.
 *
 * Run with: pnpm tsx packages/core/test/session-compaction.test.ts
 */

import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type {
  ChatChunk,
  ChatRequest,
  Message,
  Provider,
} from '@x_harness/provider';
import { Session, type Summarizer } from '../src/index.js';

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

/** Fake provider that just emits a single assistant.done with no tool calls. */
class FakeProvider implements Provider {
  readonly name = 'fake';
  readonly defaultModel = 'fake-1';
  public requests: ChatRequest[] = [];
  constructor(private readonly reply: string = 'ok') {}
  async *chat(req: ChatRequest, _signal?: AbortSignal): AsyncIterable<ChatChunk> {
    // Capture the messages the provider was actually called with — these are
    // what the test asserts on for "did compaction strip the middle?".
    this.requests.push({
      ...req,
      messages: req.messages.map((m) => ({ ...m })),
    });
    yield { deltaContent: this.reply };
    yield { finishReason: 'stop' };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 1: under-threshold session does NOT compact
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n1. Under threshold: no compaction event emitted');
{
  const provider = new FakeProvider('hi back');
  let summarizerCalls = 0;
  const summarizer: Summarizer = async () => {
    summarizerCalls++;
    return 'never';
  };
  const events: string[] = [];
  const sess = new Session({
    provider,
    humanUserId: 'tester',
    humanSurface: 'cli',
    systemPrompt: 'You are helpful.',
    compaction: {
      config: { contextWindow: 100_000, threshold: 0.9 },
      summarizer,
    },
  });
  sess.bus.subscribe((e) => events.push(e.kind));
  sess.pushUser('hi');
  for await (const _ev of sess.streamReply()) { /* drain */ }
  ok('summarizer never invoked', summarizerCalls === 0);
  ok(
    'no context.compacted event',
    !events.includes('context.compacted'),
    `got events: ${events.join(',')}`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 2: oversized history triggers compaction → provider sees fewer tokens
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n2. Over threshold: compaction triggers and shrinks messages');
{
  const provider = new FakeProvider('continued');
  let summarizerCalled = false;
  const summarizer: Summarizer = async () => {
    summarizerCalled = true;
    return 'SUMMARY of earlier conversation';
  };
  const events: { kind: string; payload?: unknown }[] = [];
  const sess = new Session({
    provider,
    humanUserId: 'tester',
    humanSurface: 'cli',
    systemPrompt: 'You are helpful.',
    compaction: {
      config: { contextWindow: 5000, threshold: 0.5, headN: 1, recentN: 2 },
      summarizer,
    },
  });
  sess.bus.subscribe((e) => events.push({ kind: e.kind, payload: e.payload }));
  // Build a fake long history by directly invoking pushUser repeatedly with
  // big strings. We need an actual provider call (streamReply) for the
  // compaction hook to fire — we'll send one final pushUser, then run.
  for (let i = 0; i < 25; i++) {
    sess.pushUser('long-user-message-' + 'x'.repeat(800) + i);
    // Drain a no-op reply so messages array grows alternating user/assistant.
    for await (const _ev of sess.streamReply()) { /* drain */ }
  }
  // Final turn AFTER history is big — compaction should fire here.
  const sizeBefore = provider.requests[provider.requests.length - 1]!.messages.length;
  sess.pushUser('what was the first thing I said?');
  for await (const _ev of sess.streamReply()) { /* drain */ }
  const lastReq = provider.requests[provider.requests.length - 1]!;
  const compactedEvents = events.filter((e) => e.kind === 'context.compacted');

  ok('summarizer was invoked at least once', summarizerCalled);
  ok('at least one context.compacted event emitted', compactedEvents.length >= 1);
  ok(
    'final request bounded vs. uncompacted size (50+ msgs)',
    lastReq.messages.length < 40,
    `lastReq.messages=${lastReq.messages.length} (uncompacted would be 50+)`,
  );
  // The injected summary message should be present.
  ok(
    'final request contains compacted summary marker',
    lastReq.messages.some(
      (m: Message) =>
        m.role === 'assistant' &&
        typeof m.content === 'string' &&
        m.content.includes('compacted summary'),
    ),
  );
  // System message preserved at position 0.
  ok(
    'system message preserved at head',
    lastReq.messages[0]?.role === 'system',
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 3: no compactionOpts → no compaction ever
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n3. Without compactionOpts: feature fully disabled');
{
  const provider = new FakeProvider('hi');
  const events: string[] = [];
  const sess = new Session({
    provider,
    humanUserId: 'tester',
    humanSurface: 'cli',
    systemPrompt: 'sys',
  });
  sess.bus.subscribe((e) => events.push(e.kind));
  sess.pushUser('big' + 'x'.repeat(20_000));
  for await (const _ev of sess.streamReply()) { /* drain */ }
  ok('no compaction event when feature off', !events.includes('context.compacted'));
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 4: large tool output triggers sidecar persistence
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n4. Sidecar files persisted for big tool outputs');
{
  const home = mkdtempSync(join(tmpdir(), 'x_harness-sidecar-'));
  try {
    // Provider that emits one big assistant.toolCalls then a stop; we then
    // manually inject the matching tool reply with huge content. Actually
    // simpler: bypass the loop by NOT having skills, and just stuff messages
    // directly via resume.
    const huge = 'y'.repeat(40_000);
    const resumeMessages: Message[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'go' },
      {
        role: 'assistant',
        content: 'calling',
        toolCalls: [{ id: 'call-xyz', name: 'fake.read', argumentsJson: '{}' }],
      },
      { role: 'tool', toolCallId: 'call-xyz', content: huge },
      { role: 'assistant', content: 'I read it.' },
    ];
    let summarizerCalls = 0;
    const summarizer: Summarizer = async () => {
      summarizerCalls++;
      return 'middle summary';
    };
    const provider = new FakeProvider('ack');
    const sess = new Session({
      provider,
      humanUserId: 'tester',
      humanSurface: 'cli',
      systemPrompt: 'sys',
      resumeMessages,
      sessionId: 'sid-sidecar',
      provenance: { xHarnessHome: home },
      compaction: {
        // Set threshold high so memento doesn't run, but toolOutputMaxTokens
        // small so the prune step fires.
        config: { contextWindow: 1_000_000, threshold: 0.95, toolOutputMaxTokens: 200 },
        summarizer,
      },
    });
    sess.pushUser('continue');
    for await (const _ev of sess.streamReply()) { /* drain */ }
    const sidecarDir = join(home, 'sessions', 'sid-sidecar', 'tool-outputs');
    ok('sidecar dir created', existsSync(sidecarDir));
    const files = existsSync(sidecarDir) ? readdirSync(sidecarDir) : [];
    ok('sidecar file written for call-xyz', files.includes('call-xyz.txt'));
    if (files.includes('call-xyz.txt')) {
      const content = readFileSync(join(sidecarDir, 'call-xyz.txt'), 'utf8');
      ok('sidecar content matches original tool output', content === huge);
    }
    ok('summarizer not invoked (threshold high)', summarizerCalls === 0);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

// ─────────────────────────────────────────────────────────────────────────────

console.log(`\n${pass} passed, ${fail} failed`);
if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) console.log('  - ' + f);
  process.exit(1);
}

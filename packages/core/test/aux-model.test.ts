/**
 * ADR-0013 Step 3 — auxModel routing + meta-interface tests.
 *
 * Run with: pnpm tsx packages/core/test/aux-model.test.ts
 */

import type {
  ChatChunk,
  ChatRequest,
  Provider,
} from '@x_harness/provider';
import {
  Session,
  makeProviderSummarizer,
  resolveSummarizerModel,
  FILTER_SAFE_PREAMBLE,
} from '../src/index.js';

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

/** Provider that records every chat request it receives. */
class RecordingProvider implements Provider {
  readonly name = 'recording';
  readonly defaultModel: string;
  readonly auxModel?: string;
  public requests: ChatRequest[] = [];
  constructor(opts: { defaultModel: string; auxModel?: string; reply?: string }) {
    this.defaultModel = opts.defaultModel;
    if (opts.auxModel) this.auxModel = opts.auxModel;
    this._reply = opts.reply ?? 'ok';
  }
  private readonly _reply: string;
  async *chat(req: ChatRequest, _signal?: AbortSignal): AsyncIterable<ChatChunk> {
    this.requests.push({ ...req, messages: req.messages.map((m) => ({ ...m })) });
    yield { deltaContent: this._reply };
    yield { finishReason: 'stop' };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. resolveSummarizerModel picks auxModel when set
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n1. resolveSummarizerModel');
{
  const a = new RecordingProvider({ defaultModel: 'main-1', auxModel: 'cheap-1' });
  ok('auxModel chosen when present', resolveSummarizerModel(a) === 'cheap-1');

  const b = new RecordingProvider({ defaultModel: 'main-1' });
  ok('falls back to defaultModel', resolveSummarizerModel(b) === 'main-1');

  ok(
    'explicit opts.model wins',
    resolveSummarizerModel(a, { model: 'override-x' }) === 'override-x',
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. makeProviderSummarizer routes the chat call to auxModel
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n2. makeProviderSummarizer routes to auxModel');
{
  const provider = new RecordingProvider({
    defaultModel: 'main-1',
    auxModel: 'cheap-1',
    reply: 'SUMMARY-OUTPUT',
  });
  const summarize = makeProviderSummarizer(provider);
  const result = await summarize('transcript here', FILTER_SAFE_PREAMBLE);
  ok('returns trimmed output', result === 'SUMMARY-OUTPUT');
  ok('one chat call made', provider.requests.length === 1);
  ok(
    'routed to auxModel',
    provider.requests[0]?.model === 'cheap-1',
    `got model=${provider.requests[0]?.model}`,
  );
  const msgs = provider.requests[0]!.messages;
  ok('two messages sent', msgs.length === 2);
  ok('system message is preamble', msgs[0]?.role === 'system' && msgs[0]?.content === FILTER_SAFE_PREAMBLE);
  ok('user message is transcript', msgs[1]?.role === 'user' && msgs[1]?.content === 'transcript here');
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Without auxModel falls back to defaultModel
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n3. No auxModel → defaultModel');
{
  const provider = new RecordingProvider({ defaultModel: 'main-1', reply: 'S' });
  const summarize = makeProviderSummarizer(provider);
  await summarize('t', 'p');
  ok('routed to defaultModel', provider.requests[0]?.model === 'main-1');
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Session auto-builds provider-backed summarizer
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n4. Session auto-builds summarizer when none supplied');
{
  const provider = new RecordingProvider({
    defaultModel: 'main-1',
    auxModel: 'cheap-1',
    reply: 'summary-stub',
  });
  // Force compaction by setting very low threshold and seeding a long history.
  const long: string[] = [];
  for (let i = 0; i < 30; i++) long.push('x'.repeat(800));
  const sess = new Session({
    provider,
    humanUserId: 't',
    humanSurface: 'cli',
    systemPrompt: 'sys',
    resumeMessages: long.map((c, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: c,
    })) as any,
    compaction: {
      config: { contextWindow: 4000, threshold: 0.4, headN: 1, recentN: 2 },
      // no summarizer → auto build expected
    },
  });
  const events: string[] = [];
  sess.bus.subscribe((e) => events.push(e.kind));
  sess.pushUser('go');
  for await (const _ev of sess.streamReply()) { /* drain */ }
  ok(
    'context.compacted event emitted (proves auto-built summarizer ran)',
    events.includes('context.compacted'),
  );
  // The summarizer should have called provider with auxModel.
  const cheapCalls = provider.requests.filter((r) => r.model === 'cheap-1');
  ok(
    'summarizer used auxModel (cheap-1)',
    cheapCalls.length >= 1,
    `cheap calls=${cheapCalls.length}, all models=${provider.requests.map((r) => r.model).join(',')}`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Explicit `summarizer: null` disables compaction even with config present
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n5. summarizer:null disables compaction');
{
  const provider = new RecordingProvider({ defaultModel: 'main-1', auxModel: 'cheap-1' });
  const sess = new Session({
    provider,
    humanUserId: 't',
    humanSurface: 'cli',
    systemPrompt: 'sys',
    compaction: {
      config: { contextWindow: 100, threshold: 0.01 },
      summarizer: null,
    },
  });
  const events: string[] = [];
  sess.bus.subscribe((e) => events.push(e.kind));
  sess.pushUser('hello');
  for await (const _ev of sess.streamReply()) { /* drain */ }
  ok('no context.compacted event when summarizer:null', !events.includes('context.compacted'));
  ok('compactNow returns null when disabled', (await sess.compactNow('user-requested')) === null);
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. enabled:false disables compaction
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n6. enabled:false disables compaction');
{
  const provider = new RecordingProvider({ defaultModel: 'main-1', auxModel: 'cheap-1' });
  const sess = new Session({
    provider,
    humanUserId: 't',
    humanSurface: 'cli',
    systemPrompt: 'sys',
    compaction: {
      config: { contextWindow: 100, threshold: 0.01 },
      enabled: false,
    },
  });
  ok('compactNow returns null when enabled:false', (await sess.compactNow('user-requested')) === null);
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. compactNow meta-interface emits event with manual trigger
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n7. compactNow() meta-interface');
{
  const provider = new RecordingProvider({
    defaultModel: 'main-1',
    auxModel: 'cheap-1',
    reply: 'manual-summary',
  });
  const sess = new Session({
    provider,
    humanUserId: 't',
    humanSurface: 'cli',
    systemPrompt: 'sys',
    resumeMessages: Array.from({ length: 40 }, (_v, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: 'y'.repeat(600) + i,
    })),
    compaction: {
      config: { contextWindow: 4000, threshold: 0.4, headN: 1, recentN: 2 },
    },
  });
  const events: any[] = [];
  sess.bus.subscribe((e) => events.push({ kind: e.kind, payload: e.payload }));
  const event = await sess.compactNow('sources-changed');
  ok('compactNow returns event', event !== null);
  ok('trigger is manual', event?.trigger === 'manual');
  ok('reason propagated through', event?.reason === 'sources-changed');
  ok('phase is standalone', event?.phase === 'standalone');
  const ce = events.find((e) => e.kind === 'context.compacted');
  ok('bus event emitted', ce != null);
  ok('bus payload matches return value', ce?.payload?.trigger === 'manual');
}

// ─────────────────────────────────────────────────────────────────────────────

console.log(`\n${pass} passed, ${fail} failed`);
if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) console.log('  - ' + f);
  process.exit(1);
}

/**
 * x_harness — ADR-0013 dogfood harness.
 *
 * Drives a real long DeepSeek conversation to verify:
 *   - compaction triggers at the right threshold
 *   - the summarizer routes to provider.auxModel (cheap)
 *   - filter-safe preamble prevents summary→re-execute
 *   - tool-output sidecars get persisted
 *   - the pair invariant survives many compaction rounds
 *
 * Run:
 *   X_HARNESS_HOME=/tmp/xh-dogfood pnpm tsx tools/dogfood-compaction.ts
 *
 * Env:
 *   DEEPSEEK_API_KEY      (required)
 *   DEEPSEEK_MODEL        (default: deepseek-reasoner — the main model)
 *   DEEPSEEK_AUX_MODEL    (default: deepseek-chat — the summarizer model)
 *   DOGFOOD_TURNS         (default: 10)
 *   DOGFOOD_TOPIC         (default: "the philosophy of memory in AI agents")
 *
 * Output:
 *   - human-readable progress log on stdout
 *   - per-compaction-event JSON line on stderr (for `| jq` filtering)
 *   - final report on stdout
 */

import { mkdirSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { createDeepSeekProviderFromEnv } from '../packages/provider/src/index.ts';
import {
  Session,
  loadConfig,
  compactionFromConfig,
  makeTiktokenTokenizer,
  estimateMessagesTokens,
  type CompactionEvent,
} from '../packages/core/src/index.ts';

// ─── env loading (minimal, inline) ───────────────────────────────────────────
import { readFileSync } from 'node:fs';
(function loadDotenv(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(process.cwd(), '.env'),
    resolve(here, '..', '.env'),
  ];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    try {
      const text = readFileSync(p, 'utf8');
      for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        const eq = line.indexOf('=');
        if (eq <= 0) continue;
        const k = line.slice(0, eq).trim();
        let v = line.slice(eq + 1).trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
          v = v.slice(1, -1);
        }
        if (process.env[k] === undefined) process.env[k] = v;
      }
      break;
    } catch { /* ignore */ }
  }
})();

// ─── config ──────────────────────────────────────────────────────────────────
const xHarnessHome = process.env.X_HARNESS_HOME ?? join(homedir(), '.x_harness-dogfood');
const sessionId = `dogfood-${Date.now()}`;
const turns = Number(process.env.DOGFOOD_TURNS ?? 10);
const topic = process.env.DOGFOOD_TOPIC ?? 'the philosophy of memory in AI agents';

// We pin DEEPSEEK_MODEL = deepseek-reasoner and DEEPSEEK_AUX_MODEL = deepseek-chat
// for the duration of this run if the caller hasn't set them. This is the
// recommended dogfood pairing: expensive reasoner main + cheap chat aux.
if (!process.env.DEEPSEEK_MODEL) process.env.DEEPSEEK_MODEL = 'deepseek-reasoner';
if (!process.env.DEEPSEEK_AUX_MODEL) process.env.DEEPSEEK_AUX_MODEL = 'deepseek-chat';

mkdirSync(xHarnessHome, { recursive: true });

// Write a low-threshold config so compaction fires within a few turns.
writeFileSync(
  join(xHarnessHome, 'config.json'),
  JSON.stringify(
    {
      compaction: {
        enabled: true,
        threshold: 0.35,             // fire early
        contextWindow: 8000,         // pretend we have a small window
        headN: 3,
        recentN: 6,
        toolOutputMaxTokens: 4096,
      },
    },
    null,
    2,
  ),
);

console.log('╭─ x_harness dogfood — ADR-0013 long-conversation drive');
console.log('│');
console.log(`│  home          : ${xHarnessHome}`);
console.log(`│  sessionId     : ${sessionId}`);
console.log(`│  main model    : ${process.env.DEEPSEEK_MODEL}`);
console.log(`│  aux model     : ${process.env.DEEPSEEK_AUX_MODEL}`);
console.log(`│  turns         : ${turns}`);
console.log(`│  topic         : "${topic}"`);
console.log(`│  threshold     : 0.35 × 8000 = ${Math.floor(0.35 * 8000)} tokens`);
console.log('╰─');
console.log('');

const provider = createDeepSeekProviderFromEnv();
const cfg = loadConfig(xHarnessHome);
const block = compactionFromConfig(cfg);
if (!block) {
  console.error('config.json was rejected; aborting');
  process.exit(2);
}

const tokenize = makeTiktokenTokenizer(provider.defaultModel);

const session = new Session({
  provider,
  humanUserId: 'dogfood',
  humanSurface: 'cli',
  systemPrompt:
    'You are a thoughtful interlocutor. Respond with 2-3 paragraphs of substantive prose. ' +
    'Do not produce bullet lists unless explicitly asked.',
  cwd: process.cwd(),
  sessionId,
  provenance: { xHarnessHome },
  compaction: {
    config: block.config,
    tokenize,
  },
});

// ─── bus listeners ───────────────────────────────────────────────────────────
const compactionEvents: CompactionEvent[] = [];
let bytesIn = 0;
let bytesOut = 0;
let providerCalls = 0;

session.bus.subscribe((ev) => {
  if (ev.kind === 'context.compacted') {
    const e = ev.payload as CompactionEvent;
    compactionEvents.push(e);
    process.stderr.write(JSON.stringify({ t: Date.now(), kind: 'context.compacted', ...e }) + '\n');
  } else if (ev.kind === 'error') {
    process.stderr.write(
      JSON.stringify({ t: Date.now(), kind: 'error', payload: ev.payload }) + '\n',
    );
  }
});

// ─── drive turns ─────────────────────────────────────────────────────────────
const prompts = makePrompts(topic, turns);

const perTurnStats: Array<{
  turn: number;
  prompt: string;
  tokensBefore: number;
  tokensAfter: number;
  replyChars: number;
  compactedAtTurn: boolean;
  durationMs: number;
}> = [];

for (let i = 0; i < turns; i++) {
  const prompt = prompts[i]!;
  process.stdout.write(`\n[turn ${i + 1}/${turns}] » ${prompt.slice(0, 100)}${prompt.length > 100 ? '...' : ''}\n`);
  const compactionCountBefore = compactionEvents.length;
  session.pushUser(prompt);
  // Cheap pre-turn token estimate (after pushUser).
  const tokensBefore = estimateMessagesTokens(session.snapshot(), tokenize);
  bytesIn += prompt.length;

  const t0 = Date.now();
  let replyChars = 0;
  let replyHead = '';
  try {
    for await (const ev of session.streamReply()) {
      if (ev.kind === 'assistant.delta') {
        replyChars += ev.text.length;
        if (replyHead.length < 120) replyHead += ev.text;
        bytesOut += ev.text.length;
      } else if (ev.kind === 'assistant.done') {
        providerCalls += 1;
      }
    }
  } catch (err) {
    console.error(`  !! provider error: ${err instanceof Error ? err.message : err}`);
    break;
  }
  const durationMs = Date.now() - t0;
  const tokensAfter = estimateMessagesTokens(session.snapshot(), tokenize);
  const compactedAtTurn = compactionEvents.length > compactionCountBefore;

  perTurnStats.push({
    turn: i + 1,
    prompt: prompt.slice(0, 80),
    tokensBefore,
    tokensAfter,
    replyChars,
    compactedAtTurn,
    durationMs,
  });

  console.log(
    `  ← ${replyChars} chars in ${(durationMs / 1000).toFixed(1)}s | ` +
      `tokens ${tokensBefore}→${tokensAfter}` +
      (compactedAtTurn ? ` | 🗜  compacted` : ''),
  );
  console.log(`    head: "${replyHead.replace(/\s+/g, ' ').slice(0, 100)}..."`);
}

// ─── final report ────────────────────────────────────────────────────────────
console.log('\n');
console.log('╭─ Dogfood Report');
console.log('│');
console.log(`│  turns completed         : ${perTurnStats.length} / ${turns}`);
console.log(`│  total compactions       : ${compactionEvents.length}`);
console.log(`│  bytes in (prompts)      : ${bytesIn}`);
console.log(`│  bytes out (replies)     : ${bytesOut}`);
console.log(`│  provider stream rounds  : ${providerCalls}`);
console.log('│');

if (compactionEvents.length > 0) {
  console.log('│  Compaction breakdown:');
  for (const [i, e] of compactionEvents.entries()) {
    const reduction = e.tokensBefore - e.tokensAfter;
    const pct = e.tokensBefore > 0 ? ((reduction / e.tokensBefore) * 100).toFixed(0) : '?';
    console.log(
      `│    #${i + 1} strategy=${e.strategy.padEnd(20)} ${e.tokensBefore}→${e.tokensAfter} ` +
        `(−${reduction}, ${pct}%)  headKept=${e.headKept} recentKept=${e.recentKept}  ` +
        `${e.durationMs}ms`,
    );
  }
  console.log('│');
  const memento = compactionEvents.filter((e) => e.strategy === 'memento');
  if (memento.length > 0) {
    const avgReduction =
      memento.reduce((s, e) => s + (e.tokensBefore - e.tokensAfter), 0) / memento.length;
    const avgPct =
      (memento.reduce((s, e) => s + (e.tokensBefore - e.tokensAfter) / Math.max(e.tokensBefore, 1), 0) /
        memento.length) *
      100;
    console.log(`│  Memento avg reduction   : ${avgReduction.toFixed(0)} tokens (${avgPct.toFixed(0)}%)`);
    const avgDur = memento.reduce((s, e) => s + e.durationMs, 0) / memento.length;
    console.log(`│  Memento avg duration    : ${avgDur.toFixed(0)} ms`);
  }
}

// Sidecar dir check.
const sidecarDir = join(xHarnessHome, 'sessions', sessionId, 'tool-outputs');
if (existsSync(sidecarDir)) {
  const files = readdirSync(sidecarDir);
  console.log(`│  sidecar files           : ${files.length}`);
  for (const f of files) {
    const s = statSync(join(sidecarDir, f));
    console.log(`│    ${f}  ${s.size} bytes`);
  }
} else {
  console.log(`│  sidecar files           : 0 (no oversized tool outputs)`);
}

// Final messages array health.
console.log('│');
console.log(`│  final messages count    : ${session.snapshot().length}`);
console.log(`│  final tokens (estimate) : ${estimateMessagesTokens(session.snapshot(), tokenize)}`);
const compactedMarkers = session.snapshot().filter((m) => m.meta?.compacted === true).length;
console.log(`│  summary messages kept   : ${compactedMarkers}`);
console.log('│');

// Verify pair-invariant post-hoc.
let pairOk = true;
let pairErr = '';
try {
  // re-walk to validate the invariant ourselves (don't depend on Session re-check).
  const open = new Set<string>();
  for (const m of session.snapshot()) {
    if (m.role === 'assistant' && m.toolCalls) {
      for (const c of m.toolCalls) open.add(c.id);
    } else if (m.role === 'tool' && m.toolCallId) {
      if (!open.has(m.toolCallId)) {
        pairOk = false;
        pairErr = `orphan tool reply id=${m.toolCallId}`;
        break;
      }
      open.delete(m.toolCallId);
    }
  }
  if (pairOk && open.size > 0) {
    pairOk = false;
    pairErr = `unanswered toolCall ids: ${[...open].join(',')}`;
  }
} catch (e) {
  pairOk = false;
  pairErr = e instanceof Error ? e.message : String(e);
}
console.log(`│  pair invariant          : ${pairOk ? '✓ OK' : '✗ ' + pairErr}`);
console.log('╰─');

console.log('');
console.log(`Full session transcript at: ${xHarnessHome}/sessions/${sessionId}.jsonl (if memory sink wired)`);
console.log(`Per-event JSONL: was streamed to stderr — pipe to a file via 2> if you want to keep it.`);

if (!pairOk) process.exit(1);
process.exit(0);

// ─────────────────────────────────────────────────────────────────────────────
function makePrompts(topic: string, n: number): string[] {
  const angles = [
    `Give me a substantive opening on ${topic}: what is the core question?`,
    `Now elaborate on the historical lineage of this idea — pick two key thinkers and contrast them.`,
    `Bring in a concrete technical example from contemporary AI systems and analyse what it reveals.`,
    `Take the strongest objection to your position so far and steelman it.`,
    `Now rebut that steelman with a careful, multi-step argument.`,
    `Connect this back to a practical engineering decision a builder of AI systems faces today.`,
    `What's the cheapest experiment that could falsify your current view? Describe it concretely.`,
    `Suppose the experiment falsifies you. What's the next-best theory and why?`,
    `Step back: what shifted in your thinking across this conversation? Be specific.`,
    `Final synthesis in 3 short paragraphs — what should a builder remember?`,
    `Now zoom in: pick the single most important sentence you've said and defend it for one paragraph.`,
    `Compare your final synthesis with a hypothetical pessimist's view.`,
    `Give one prediction for the next 18 months and the observable that would confirm or refute it.`,
  ];
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(angles[i % angles.length]!);
  return out;
}

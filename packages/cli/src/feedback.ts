/**
 * x feedback — evolution capture v0 (spiral 2/4).
 *
 * Usage:
 *   x feedback <sessionId> <seq> <verdict> [--note "..."] [--suggestion "..."]
 *   x feedback list [--session ID] [--verdict V] [--limit N] [--json]
 *
 * verdict ∈ accept | reject | i-would-have
 *
 * Writes a `evolution.feedback` event to the session's JSONL.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readSession, appendFeedback, listFeedback } from '@x_harness/memory';
import type { FeedbackVerdict } from '@x_harness/memory';

const C = {
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  reset: '\x1b[0m',
};
const isTTY = process.stdout.isTTY;
const c = (k: keyof typeof C, s: string) => (isTTY ? C[k] + s + C.reset : s);

export async function runFeedback(argv: string[]): Promise<number> {
  const home = process.env.X_HARNESS_HOME ?? join(homedir(), '.x_harness');
  if (argv[0] === 'list') return runList(home, argv.slice(1));
  if (argv.length < 3) return usage(2);
  const [sessionId, seqStr, verdictRaw, ...rest] = argv as [string, string, string, ...string[]];
  const seq = parseInt(seqStr, 10);
  if (!Number.isFinite(seq) || seq < 1) {
    process.stderr.write(`bad seq: ${seqStr}\n`);
    return 2;
  }
  const verdict = verdictRaw as FeedbackVerdict;
  if (!['accept', 'reject', 'i-would-have'].includes(verdict)) {
    process.stderr.write(`bad verdict: ${verdictRaw} (use accept | reject | i-would-have)\n`);
    return 2;
  }
  let note: string | undefined;
  let suggestion: string | undefined;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (a === '--note') note = rest[++i];
    else if (a === '--suggestion') suggestion = rest[++i];
    else {
      process.stderr.write(`unknown flag: ${a}\n`);
      return 2;
    }
  }
  // Look up the target entry to confirm + capture its kind for the payload.
  const entries = await readSession(home, sessionId);
  if (!entries.length) {
    process.stderr.write(`session not found: ${sessionId}\n`);
    return 1;
  }
  const target = entries.find((e) => e.seq === seq);
  if (!target) {
    process.stderr.write(`seq ${seq} not found in session ${sessionId}\n`);
    return 1;
  }
  try {
    const written = await appendFeedback({
      home,
      sessionId,
      targetSeq: seq,
      targetKind: target.kind,
      verdict,
      note,
      suggestion,
    });
    const tag = verdict === 'accept' ? c('green', '👍') : verdict === 'reject' ? c('red', '👎') : c('yellow', '💡');
    process.stdout.write(
      `${tag} ${c('dim', 'feedback recorded:')} ${c('cyan', sessionId)} #${seq} ${c('magenta', target.kind)} → ${verdict} ${c('dim', '(seq=' + written.seq + ')')}\n`,
    );
    return 0;
  } catch (e) {
    process.stderr.write(`error: ${(e as Error).message}\n`);
    return 1;
  }
}

async function runList(home: string, argv: string[]): Promise<number> {
  let sessionId: string | undefined;
  let verdict: FeedbackVerdict | undefined;
  let limit: number | undefined;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    switch (a) {
      case '--session': sessionId = argv[++i]; break;
      case '--verdict': verdict = argv[++i] as FeedbackVerdict; break;
      case '--limit': limit = parseInt(argv[++i] ?? '', 10); break;
      case '--json': json = true; break;
      default: process.stderr.write(`unknown flag: ${a}\n`); return 2;
    }
  }
  const rows = await listFeedback({ home, sessionId, verdict, limit });
  if (json) {
    process.stdout.write(JSON.stringify(rows, null, 2) + '\n');
    return 0;
  }
  if (!rows.length) {
    process.stdout.write(c('dim', 'no feedback recorded yet\n'));
    return 1;
  }
  for (const r of rows) {
    const tag = r.payload.verdict === 'accept' ? c('green', '👍 accept')
      : r.payload.verdict === 'reject' ? c('red', '👎 reject')
      : c('yellow', '💡 i-would-have');
    process.stdout.write(
      `${tag}  ${c('cyan', r.sessionId)} #${r.payload.targetSeq} ${c('magenta', r.payload.targetKind)}  ${c('dim', r.ts)}\n`,
    );
    if (r.payload.suggestion) process.stdout.write(`    ${c('yellow', '→')} ${r.payload.suggestion}\n`);
    else if (r.payload.note) process.stdout.write(`    ${c('dim', '·')} ${r.payload.note}\n`);
  }
  process.stdout.write(`\n${c('dim', `${rows.length} feedback event${rows.length === 1 ? '' : 's'}`)}\n`);
  return 0;
}

function usage(code: number): number {
  process.stderr.write(
    `Usage:\n  x feedback <sessionId> <seq> <accept|reject|i-would-have> [--note "..."] [--suggestion "..."]\n  x feedback list [--session ID] [--verdict V] [--limit N] [--json]\n`,
  );
  return code;
}

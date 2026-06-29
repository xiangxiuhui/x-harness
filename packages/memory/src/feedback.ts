/**
 * Feedback events — out-of-band evolution capture.
 *
 * Unlike MemoryStore (which holds an open WriteStream per live session),
 * this is a one-shot helper used by `x feedback`, web `/api/feedback`, or
 * any other surface that wants to annotate a past entry without re-opening
 * the full session.
 *
 * Writes go to the SAME `<home>/memory/<sessionId>.jsonl` so that:
 *   - `grepMemory` sees them automatically
 *   - `readSession` replays them inline at the end of history
 *   - the session timeline is one append-only truth
 *
 * Concurrency: we use `fs.appendFile` which on POSIX is atomic for writes
 * smaller than PIPE_BUF (4096 on macOS/Linux). One entry per line << 4KB
 * in practice, so this is safe even if the live session is appending in
 * parallel.
 */
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { MemoryEntry, MemoryActor } from './types.js';

export type FeedbackVerdict = 'accept' | 'reject' | 'i-would-have';

export interface FeedbackInput {
  home: string;
  sessionId: string;
  /** seq of the entry being commented on. */
  targetSeq: number;
  /** kind of the target entry (for fast filtering w/o re-reading). */
  targetKind: string;
  verdict: FeedbackVerdict;
  note?: string;
  /** Required if verdict === 'i-would-have'. */
  suggestion?: string;
  actor?: MemoryActor;
}

export interface FeedbackEntry {
  ts: string;
  seq: number;
  actor: MemoryActor;
  kind: 'evolution.feedback';
  payload: {
    targetSeq: number;
    targetKind: string;
    verdict: FeedbackVerdict;
    note?: string;
    suggestion?: string;
  };
}

/**
 * Append a feedback event. Returns the resulting entry (with assigned seq).
 * Throws if the session file does not exist.
 */
export async function appendFeedback(input: FeedbackInput): Promise<FeedbackEntry> {
  if (input.verdict === 'i-would-have' && !input.suggestion) {
    throw new Error("verdict='i-would-have' requires a suggestion");
  }
  const file = join(input.home, 'memory', `${input.sessionId}.jsonl`);
  // Need to know the max seq to assign next one. Cheap re-scan (only seq field).
  let maxSeq = 0;
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch {
    throw new Error(`session not found: ${input.sessionId}`);
  }
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    const i = line.indexOf('"seq":');
    if (i < 0) continue;
    const m = /"seq":\s*(\d+)/.exec(line.slice(i));
    if (m) {
      const s = parseInt(m[1]!, 10);
      if (s > maxSeq) maxSeq = s;
    }
  }
  const entry: FeedbackEntry = {
    ts: new Date().toISOString(),
    seq: maxSeq + 1,
    actor: input.actor ?? { kind: 'human', userId: process.env.USER ?? 'unknown', surface: 'feedback' },
    kind: 'evolution.feedback',
    payload: {
      targetSeq: input.targetSeq,
      targetKind: input.targetKind,
      verdict: input.verdict,
      note: input.note,
      suggestion: input.suggestion,
    },
  };
  await fs.appendFile(file, JSON.stringify(entry) + '\n');
  return entry;
}

/**
 * List all feedback entries across sessions, optionally filtered.
 * Newest first.
 */
export async function listFeedback(opts: {
  home: string;
  sessionId?: string;
  verdict?: FeedbackVerdict;
  limit?: number;
}): Promise<Array<FeedbackEntry & { sessionId: string }>> {
  const memDir = join(opts.home, 'memory');
  const limit = opts.limit ?? 200;
  let names: string[];
  try {
    names = (await fs.readdir(memDir)).filter((n) => n.endsWith('.jsonl') && n !== 'index.jsonl');
  } catch {
    return [];
  }
  if (opts.sessionId) names = names.filter((n) => n === `${opts.sessionId}.jsonl`);
  const out: Array<FeedbackEntry & { sessionId: string }> = [];
  for (const n of names) {
    const sessionId = n.replace(/\.jsonl$/, '');
    let raw: string;
    try {
      raw = await fs.readFile(join(memDir, n), 'utf8');
    } catch {
      continue;
    }
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      if (!line.includes('"evolution.feedback"')) continue;
      try {
        const e = JSON.parse(line) as MemoryEntry;
        if (e.kind !== 'evolution.feedback') continue;
        const fe = e as unknown as FeedbackEntry;
        if (opts.verdict && fe.payload.verdict !== opts.verdict) continue;
        out.push({ ...fe, sessionId });
      } catch {
        /* skip */
      }
    }
  }
  out.sort((a, b) => (a.ts < b.ts ? 1 : -1));
  return out.slice(0, limit);
}

/**
 * Cross-session memory grep — pure library (no I/O API surface beyond fs).
 *
 * Scans `<home>/memory/*.jsonl`, matches each entry, and returns hits with
 * minimal projection. Designed for both `x memory grep` CLI and `/api/memory/grep`
 * (ADR-0011 Surface Parity).
 *
 * v0 scope:
 *   - regex OR literal substring match, case-insensitive by default
 *   - filter by kind, sessionId (glob unsupported, exact match)
 *   - filter by `since` (ISO timestamp lower bound)
 *   - limit + per-session-cap to keep response bounded
 *
 * Out of scope (later):
 *   - embedding/semantic search
 *   - full-text index (we re-scan on every query; fine for <100MB of logs)
 *   - tail-follow (use SSE on a specific session for that)
 */
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { MemoryEntry } from './types.js';

export interface GrepOptions {
  /** Pattern to match. If `regex` is false (default), treated as literal. */
  pattern: string;
  /** Treat `pattern` as a JS regex (without the surrounding /…/). */
  regex?: boolean;
  /** Case-sensitive match. Default false. */
  caseSensitive?: boolean;
  /** Restrict to these kinds (e.g. ['user.message', 'tool.call']). */
  kinds?: string[];
  /** Exact sessionId filter. */
  sessionId?: string;
  /** ISO timestamp; only entries with ts >= since match. */
  since?: string;
  /** Cap total hits. Default 200. */
  limit?: number;
  /** Cap hits per session. Default 50. */
  perSessionLimit?: number;
}

export interface GrepHit {
  sessionId: string;
  ts: string;
  seq: number;
  kind: string;
  actor: MemoryEntry['actor'];
  /** First matching text excerpt (with surrounding context). */
  excerpt: string;
  /** Which payload field matched (for UI). */
  matchedField: string;
  /** The full entry, in case caller wants more. */
  entry: MemoryEntry;
}

export interface GrepResult {
  totalScanned: number;
  totalMatched: number;
  truncated: boolean;
  hits: GrepHit[];
  /** Sessions scanned (for diagnostics). */
  sessionsScanned: number;
}

/** Flatten payload to text candidates to search. */
function payloadStrings(entry: MemoryEntry): Array<{ field: string; text: string }> {
  const out: Array<{ field: string; text: string }> = [];
  const p = entry.payload as Record<string, unknown>;
  for (const [k, v] of Object.entries(p ?? {})) {
    if (typeof v === 'string') out.push({ field: k, text: v });
    else if (v != null && typeof v === 'object') {
      // Stringify nested for now — keeps things simple and grep-y.
      try {
        out.push({ field: k, text: JSON.stringify(v) });
      } catch {
        /* ignore */
      }
    }
  }
  return out;
}

function excerpt(text: string, idx: number, len: number, span = 80): string {
  const start = Math.max(0, idx - span);
  const end = Math.min(text.length, idx + len + span);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  return prefix + text.slice(start, end).replace(/\s+/g, ' ') + suffix;
}

export async function grepMemory(home: string, opts: GrepOptions): Promise<GrepResult> {
  const memDir = join(home, 'memory');
  const limit = opts.limit ?? 200;
  const perSessionLimit = opts.perSessionLimit ?? 50;

  let names: string[];
  try {
    names = (await fs.readdir(memDir)).filter((n) => n.endsWith('.jsonl') && n !== 'index.jsonl');
  } catch {
    return { totalScanned: 0, totalMatched: 0, truncated: false, hits: [], sessionsScanned: 0 };
  }

  // If a sessionId was given, restrict early.
  if (opts.sessionId) names = names.filter((n) => n === `${opts.sessionId}.jsonl`);

  // Newest first (filename includes timestamp prefix in our convention; fallback to mtime).
  const stats = await Promise.all(
    names.map(async (n) => {
      try {
        return { n, mtime: (await fs.stat(join(memDir, n))).mtimeMs };
      } catch {
        return { n, mtime: 0 };
      }
    }),
  );
  stats.sort((a, b) => b.mtime - a.mtime);

  const matcher = buildMatcher(opts);
  const sinceMs = opts.since ? Date.parse(opts.since) : 0;
  const kinds = opts.kinds && opts.kinds.length > 0 ? new Set(opts.kinds) : null;

  const hits: GrepHit[] = [];
  let totalScanned = 0;
  let totalMatched = 0;
  let truncated = false;

  for (const { n } of stats) {
    if (hits.length >= limit) {
      truncated = true;
      break;
    }
    const sessionId = n.replace(/\.jsonl$/, '');
    let raw: string;
    try {
      raw = await fs.readFile(join(memDir, n), 'utf8');
    } catch {
      continue;
    }
    let perSession = 0;
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      totalScanned++;
      let entry: MemoryEntry;
      try {
        entry = JSON.parse(line) as MemoryEntry;
      } catch {
        continue;
      }
      if (kinds && !kinds.has(entry.kind)) continue;
      if (sinceMs && Date.parse(entry.ts) < sinceMs) continue;

      // First-match wins per entry.
      let matched: GrepHit | null = null;
      for (const { field, text } of payloadStrings(entry)) {
        const m = matcher(text);
        if (m) {
          matched = {
            sessionId,
            ts: entry.ts,
            seq: entry.seq,
            kind: entry.kind,
            actor: entry.actor,
            excerpt: excerpt(text, m.index, m.length),
            matchedField: field,
            entry,
          };
          break;
        }
      }
      if (matched) {
        totalMatched++;
        perSession++;
        if (perSession <= perSessionLimit) {
          hits.push(matched);
          if (hits.length >= limit) {
            truncated = true;
            break;
          }
        } else {
          truncated = true;
        }
      }
    }
  }

  return { totalScanned, totalMatched, truncated, hits, sessionsScanned: stats.length };
}

function buildMatcher(opts: GrepOptions): (text: string) => { index: number; length: number } | null {
  if (opts.regex) {
    const flags = opts.caseSensitive ? '' : 'i';
    const re = new RegExp(opts.pattern, flags);
    return (t) => {
      const m = re.exec(t);
      return m ? { index: m.index, length: m[0].length } : null;
    };
  }
  const needle = opts.caseSensitive ? opts.pattern : opts.pattern.toLowerCase();
  return (t) => {
    const hay = opts.caseSensitive ? t : t.toLowerCase();
    const i = hay.indexOf(needle);
    return i < 0 ? null : { index: i, length: needle.length };
  };
}

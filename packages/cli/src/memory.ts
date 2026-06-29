/**
 * x memory grep — cross-session JSONL search.
 *
 * Usage:
 *   x memory grep <pattern>  [--regex] [--case]
 *                            [--kind <k>]... [--session <id>]
 *                            [--since <iso>] [--limit N]
 *                            [--json]
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { grepMemory } from '@x_harness/memory';
import type { GrepHit, GrepOptions } from '@x_harness/memory';

const C = {
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  reset: '\x1b[0m',
};
const isTTY = process.stdout.isTTY;
const c = (color: keyof typeof C, s: string) => (isTTY ? C[color] + s + C.reset : s);

export async function runMemory(argv: string[]): Promise<number> {
  const [sub, ...rest] = argv;
  if (sub === 'grep') return runGrep(rest);
  process.stderr.write(`unknown memory subcommand: ${sub ?? '(none)'}\nUsage: x memory grep <pat> ...\n`);
  return 2;
}

function parseArgs(argv: string[]): { opts: GrepOptions; json: boolean; err?: string } {
  let pattern: string | null = null;
  let regex = false;
  let caseSensitive = false;
  const kinds: string[] = [];
  let sessionId: string | undefined;
  let since: string | undefined;
  let limit: number | undefined;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    switch (a) {
      case '--regex':
        regex = true;
        break;
      case '--case':
        caseSensitive = true;
        break;
      case '--kind':
        kinds.push(argv[++i] ?? '');
        break;
      case '--session':
        sessionId = argv[++i];
        break;
      case '--since':
        since = argv[++i];
        break;
      case '--limit':
        limit = parseInt(argv[++i] ?? '', 10);
        break;
      case '--json':
        json = true;
        break;
      default:
        if (a.startsWith('--')) return { opts: {} as GrepOptions, json, err: `unknown flag: ${a}` };
        if (pattern === null) pattern = a;
        else return { opts: {} as GrepOptions, json, err: `unexpected positional: ${a}` };
    }
  }
  if (pattern === null) return { opts: {} as GrepOptions, json, err: 'pattern required' };
  return {
    json,
    opts: {
      pattern,
      regex,
      caseSensitive,
      kinds: kinds.length ? kinds : undefined,
      sessionId,
      since,
      limit,
    },
  };
}

async function runGrep(argv: string[]): Promise<number> {
  const { opts, json, err } = parseArgs(argv);
  if (err) {
    process.stderr.write(
      `${err}\nUsage: x memory grep <pat> [--regex] [--case] [--kind K]... [--session ID] [--since ISO] [--limit N] [--json]\n`,
    );
    return 2;
  }
  const home = process.env.X_HARNESS_HOME ?? join(homedir(), '.x_harness');
  const r = await grepMemory(home, opts);

  if (json) {
    process.stdout.write(JSON.stringify(r, null, 2) + '\n');
    return r.hits.length > 0 ? 0 : 1;
  }

  if (r.hits.length === 0) {
    process.stdout.write(
      `${c('dim', `no matches (scanned ${r.totalScanned} entries across ${r.sessionsScanned} sessions)`)}\n`,
    );
    return 1;
  }
  for (const h of r.hits) printHit(h, opts);
  process.stdout.write(
    `\n${c('dim', `${r.totalMatched} match${r.totalMatched === 1 ? '' : 'es'} in ${r.sessionsScanned} sessions${r.truncated ? ' (truncated)' : ''}`)}\n`,
  );
  return 0;
}

function printHit(h: GrepHit, opts: GrepOptions): void {
  const head = `${c('cyan', h.sessionId)} ${c('dim', '#' + h.seq)} ${c('yellow', h.ts)} ${c('magenta', h.kind)} ${c('dim', '['+h.matchedField+']')}`;
  const ex = highlight(h.excerpt, opts);
  process.stdout.write(`${head}\n  ${ex}\n`);
}

function highlight(s: string, opts: GrepOptions): string {
  if (!isTTY) return s;
  try {
    const re = opts.regex
      ? new RegExp(opts.pattern, opts.caseSensitive ? 'g' : 'gi')
      : new RegExp(escapeRe(opts.pattern), opts.caseSensitive ? 'g' : 'gi');
    return s.replace(re, (m) => c('bold', c('red', m)));
  } catch {
    return s;
  }
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

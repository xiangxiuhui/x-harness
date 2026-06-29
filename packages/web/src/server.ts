/**
 * Local web server. See ../index.ts for design rules.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, readFileSync, statSync, watch } from 'node:fs';
import { stat as fsStat, open as fsOpen } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, resolve } from 'node:path';
import { homedir } from 'node:os';

import { listSessions, readSession, grepMemory } from '@x_harness/memory';
import { loadTerritory } from '@x_harness/core';
import type { SkillRegistry } from '@x_harness/skills';
import { trace as traceProvenance } from '@x_harness/provenance';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * `public/` lives next to compiled output. We resolve from this file:
 *   - dev (tsx): src/server.ts → ../public
 *   - built (tsc): dist/server.js → ../public
 * Both layouts agree because we keep `public` as a sibling of `src` AND `dist`.
 */
const PUBLIC_DIR = resolve(__dirname, '..', 'public');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
};

export interface WebServerOptions {
  /** Default: ~/.x_harness */
  home?: string;
  /** Default: 7878 */
  port?: number;
  /** Default: 127.0.0.1 (do NOT change without a real reason) */
  host?: string;
  /** Required for /api/skills. Caller passes the same registry the CLI uses. */
  skills?: SkillRegistry;
  /** Override package version banner. */
  version?: string;
}

export interface WebServerHandle {
  url: string;
  close: () => Promise<void>;
}

/** Start the web server. Returns when listening. */
export async function startWebServer(opts: WebServerOptions = {}): Promise<WebServerHandle> {
  const home = opts.home ?? join(homedir(), '.x_harness');
  const port = opts.port ?? 7878;
  const host = opts.host ?? '127.0.0.1';
  const version = opts.version ?? '0.0.1';
  const skills = opts.skills;

  const server = createServer((req, res) => {
    handle(req, res, { home, version, skills }).catch((err) => {
      sendJson(res, 500, { error: (err as Error).message });
    });
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(port, host, () => {
      server.off('error', rejectListen);
      resolveListen();
    });
  });

  return {
    url: `http://${host}:${port}`,
    close: () =>
      new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r()))),
  };
}

interface Ctx {
  home: string;
  version: string;
  skills?: SkillRegistry;
}

async function handle(req: IncomingMessage, res: ServerResponse, ctx: Ctx): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://x');
  const p = url.pathname;

  // ── API ─────────────────────────────────────────────────────────────────
  if (p === '/api/health') {
    return sendJson(res, 200, { ok: true, home: ctx.home, version: ctx.version });
  }

  if (p === '/api/sessions' && req.method === 'GET') {
    const sessions = await listSessions(ctx.home);
    // Newest first. listSessions doesn't promise order; sort by startedAt desc.
    sessions.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
    return sendJson(res, 200, { sessions });
  }

  const mSession = /^\/api\/sessions\/([A-Za-z0-9_.-]+)$/.exec(p);
  if (mSession && req.method === 'GET') {
    const id = mSession[1]!;
    try {
      const entries = await readSession(ctx.home, id);
      return sendJson(res, 200, { sessionId: id, entries });
    } catch (e) {
      return sendJson(res, 404, { error: `session not found: ${id}` });
    }
  }

  const mTail = /^\/api\/sessions\/([A-Za-z0-9_.-]+)\/tail$/.exec(p);
  if (mTail && req.method === 'GET') {
    return streamTail(req, res, ctx.home, mTail[1]!);
  }

  if (p === '/api/territory' && req.method === 'GET') {
    const t = loadTerritory({ xHarnessHome: ctx.home });
    return sendJson(res, 200, t);
  }

  if (p === '/api/skills' && req.method === 'GET') {
    const skills = ctx.skills?.list() ?? [];
    const rows = skills.map((s) => ({
      name: s.frontmatter.name,
      description: s.frontmatter.description,
      source: s.source,
      kind: typeof s.handler === 'function' ? 'tool' : 'doc',
      path: s.dir,
    }));
    return sendJson(res, 200, { skills: rows });
  }
  if (p === '/api/trace' && req.method === 'GET') {
    const qpath = url.searchParams.get('path') ?? '';
    if (!qpath) return sendJson(res, 400, { error: 'path query param required' });
    const abs = qpath.startsWith('/') ? qpath : resolve(process.cwd(), qpath);
    try {
      const r = traceProvenance(abs);
      return sendJson(res, 200, { path: abs, ...r });
    } catch (e) {
      return sendJson(res, 500, { error: (e as Error).message });
    }
  }

  if (p === '/api/memory/grep' && req.method === 'GET') {
    const pattern = url.searchParams.get('q') ?? '';
    if (!pattern) return sendJson(res, 400, { error: 'q query param required' });
    const kinds = url.searchParams.getAll('kind').filter(Boolean);
    const sessionId = url.searchParams.get('session') || undefined;
    const since = url.searchParams.get('since') || undefined;
    const limit = parseInt(url.searchParams.get('limit') ?? '', 10);
    const regex = url.searchParams.get('regex') === '1';
    const caseSensitive = url.searchParams.get('case') === '1';
    try {
      const r = await grepMemory(ctx.home, {
        pattern,
        regex,
        caseSensitive,
        kinds: kinds.length ? kinds : undefined,
        sessionId,
        since,
        limit: Number.isFinite(limit) && limit > 0 ? limit : undefined,
      });
      return sendJson(res, 200, r);
    } catch (e) {
      return sendJson(res, 500, { error: (e as Error).message });
    }
  }

  // ── Static ──────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    if (p === '/' || p === '/index.html') {
      return serveFile(res, join(PUBLIC_DIR, 'index.html'));
    }
    if (p.startsWith('/static/')) {
      const rel = p.slice('/static/'.length);
      const safe = normalize(rel).replace(/^[/\\]+/, '');
      const abs = join(PUBLIC_DIR, safe);
      if (!abs.startsWith(PUBLIC_DIR)) {
        return sendJson(res, 400, { error: 'bad path' });
      }
      return serveFile(res, abs);
    }
  }

  sendJson(res, 404, { error: 'not found', path: p });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(data),
    'cache-control': 'no-store',
  });
  res.end(data);
}

function serveFile(res: ServerResponse, abs: string): void {
  if (!existsSync(abs)) {
    return sendJson(res, 404, { error: 'not found' });
  }
  const ext = abs.slice(abs.lastIndexOf('.')).toLowerCase();
  const mime = MIME[ext] ?? 'application/octet-stream';
  const data = readFileSync(abs);
  res.writeHead(200, {
    'content-type': mime,
    'content-length': data.length,
    'cache-control': 'no-store',
  });
  res.end(data);
}

/**
 * SSE live-tail. We open the JSONL file, send everything we have, then watch
 * for size growth and stream new lines as `event: entry`.
 *
 * Implementation:
 *   - sendInitial: read full file, stream existing entries (so client gets
 *     full state without a separate /detail call).
 *   - then: fs.watch on the file; on 'change' read from last byte offset.
 *   - heartbeat every 15s as `event: ping`.
 *   - close on client disconnect.
 *
 * Why SSE over WebSocket: zero-dep, unidirectional fits server→client log
 * stream; CLI-equivalent is `tail -f` so semantic is honest.
 */
async function streamTail(
  req: IncomingMessage,
  res: ServerResponse,
  home: string,
  sessionId: string,
): Promise<void> {
  const file = join(home, 'memory', `${sessionId}.jsonl`);
  if (!existsSync(file)) {
    return sendJson(res, 404, { error: `session not found: ${sessionId}` });
  }

  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  // Initial comment so proxies flush.
  res.write(': hello\n\n');

  let offset = 0;
  let pendingTail = ''; // buffer for partial last line

  const flushNew = async (): Promise<void> => {
    let st;
    try {
      st = await fsStat(file);
    } catch {
      return;
    }
    if (st.size <= offset) {
      // truncation: re-stream from 0 (rare, but be honest)
      if (st.size < offset) {
        offset = 0;
        pendingTail = '';
        res.write(`event: truncated\ndata: {}\n\n`);
      } else {
        return;
      }
    }
    const fh = await fsOpen(file, 'r');
    try {
      const len = st.size - offset;
      const buf = Buffer.alloc(len);
      await fh.read(buf, 0, len, offset);
      offset = st.size;
      const text = pendingTail + buf.toString('utf8');
      const lines = text.split('\n');
      pendingTail = lines.pop() ?? '';
      for (const line of lines) {
        if (!line) continue;
        // Pass JSONL line through as data; client parses.
        res.write(`event: entry\ndata: ${line}\n\n`);
      }
    } finally {
      await fh.close();
    }
  };

  // Initial dump.
  await flushNew();
  res.write(`event: caughtup\ndata: {}\n\n`);

  // Watch for changes. On macOS fs.watch fires 'change' on append.
  let watcher;
  try {
    watcher = watch(file, { persistent: false }, () => {
      void flushNew();
    });
  } catch {
    res.write(`event: error\ndata: ${JSON.stringify({ error: 'watch failed' })}\n\n`);
    res.end();
    return;
  }

  // Heartbeat.
  const beat = setInterval(() => {
    res.write(`event: ping\ndata: ${Date.now()}\n\n`);
  }, 15000);

  // Cleanup.
  const close = (): void => {
    clearInterval(beat);
    try {
      watcher.close();
    } catch {
      /* noop */
    }
    if (!res.writableEnded) res.end();
  };
  req.on('close', close);
  req.on('error', close);
}

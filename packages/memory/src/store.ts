import { promises as fs, createWriteStream, WriteStream } from 'node:fs';
import { join } from 'node:path';
import type { MemoryEntry, SessionIndexEntry } from './types.js';

/**
 * MemoryStore — append-only JSONL writer for a single session.
 *
 * Thread-model: only one writer per session. Each `append()` is a single
 * synchronous-ish line write; we don't fsync per entry (would dominate cost),
 * but we use the OS write buffer which survives normal exits. On crash we may
 * lose the last few entries — acceptable for v0 (audit log, not bank ledger).
 */
export class MemoryStore {
  private readonly file: string;
  private readonly home: string;
  private readonly indexFile: string;
  private stream: WriteStream | null = null;
  private seq = 0;
  private userTurns = 0;
  private indexEntry: SessionIndexEntry;
  private closed = false;

  private constructor(
    home: string,
    sessionId: string,
    file: string,
    indexFile: string,
    indexEntry: SessionIndexEntry,
  ) {
    this.home = home;
    this.file = file;
    this.indexFile = indexFile;
    this.indexEntry = indexEntry;
    void sessionId;
  }

  static async open(opts: {
    home: string;
    sessionId: string;
    cwd: string;
    userId: string;
    model: { provider: string; model: string };
  }): Promise<MemoryStore> {
    const memDir = join(opts.home, 'memory');
    await fs.mkdir(memDir, { recursive: true });
    const file = join(memDir, `${opts.sessionId}.jsonl`);
    const indexFile = join(memDir, 'index.jsonl');
    const indexEntry: SessionIndexEntry = {
      sessionId: opts.sessionId,
      startedAt: new Date().toISOString(),
      cwd: opts.cwd,
      model: opts.model,
      userId: opts.userId,
      userTurns: 0,
      file: `${opts.sessionId}.jsonl`,
    };
    const store = new MemoryStore(opts.home, opts.sessionId, file, indexFile, indexEntry);
    store.stream = createWriteStream(file, { flags: 'a' });
    await fs.appendFile(indexFile, JSON.stringify({ ...indexEntry, op: 'start' }) + '\n');
    return store;
  }

  get filePath(): string {
    return this.file;
  }

  async append(entry: Omit<MemoryEntry, 'seq' | 'ts'> & Partial<Pick<MemoryEntry, 'ts'>>): Promise<void> {
    if (this.closed || !this.stream) return;
    const full = {
      ts: entry.ts ?? new Date().toISOString(),
      seq: ++this.seq,
      ...entry,
    } as MemoryEntry;
    if (full.kind === 'user.message') this.userTurns++;
    await new Promise<void>((resolve, reject) => {
      this.stream!.write(JSON.stringify(full) + '\n', (err) => (err ? reject(err) : resolve()));
    });
  }

  async close(reason: 'bye' | 'eof' | 'error', turns: number): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      await this.append({
        actor: { kind: 'system', subsystem: 'session' },
        kind: 'session.end',
        payload: { reason, turns },
      });
    } catch {
      /* ignore */
    }
    await new Promise<void>((resolve) => this.stream!.end(resolve));
    this.stream = null;
    this.indexEntry = {
      ...this.indexEntry,
      endedAt: new Date().toISOString(),
      userTurns: this.userTurns,
    };
    try {
      await fs.appendFile(
        this.indexFile,
        JSON.stringify({ ...this.indexEntry, op: 'end' }) + '\n',
      );
    } catch {
      /* ignore */
    }
  }
}

/** Aggregate the index file into a single-row-per-session table. */
export async function listSessions(home: string): Promise<SessionIndexEntry[]> {
  const indexFile = join(home, 'memory', 'index.jsonl');
  let raw: string;
  try {
    raw = await fs.readFile(indexFile, 'utf8');
  } catch {
    return [];
  }
  const acc = new Map<string, SessionIndexEntry>();
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let row: any;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    const id = row.sessionId;
    if (!id) continue;
    const prev = acc.get(id);
    const merged: SessionIndexEntry = {
      sessionId: id,
      startedAt: row.startedAt ?? prev?.startedAt ?? '',
      endedAt: row.endedAt ?? prev?.endedAt,
      cwd: row.cwd ?? prev?.cwd ?? '',
      model: row.model ?? prev?.model ?? { provider: '?', model: '?' },
      userId: row.userId ?? prev?.userId ?? '?',
      userTurns: row.userTurns ?? prev?.userTurns ?? 0,
      file: row.file ?? prev?.file ?? `${id}.jsonl`,
    };
    acc.set(id, merged);
  }
  return [...acc.values()].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

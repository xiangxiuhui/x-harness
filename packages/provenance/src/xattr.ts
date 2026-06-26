/**
 * Cross-platform xattr roundtrip via OS CLIs. No native deps.
 *
 * macOS: `xattr` (BSD-ish flags).
 * Linux: `setfattr`/`getfattr`/`attr` (user.* namespace required).
 *
 * Errors:
 *   - readXattr returns undefined if attribute is missing (not an error).
 *   - setXattr / removeXattr throw on real failures (target missing, no
 *     permission, fs doesn't support xattr).
 *
 * We use spawnSync (sync semantics) because:
 *   - These calls are infrequent (per-write, not per-line).
 *   - Caller writes JSONL right after; sync simplifies ordering.
 *   - Latency is microseconds for a forked /usr/bin/xattr.
 */

import { spawnSync, type SpawnSyncOptions } from 'node:child_process';
import { platform } from 'node:os';

export interface XattrOps {
  set: (path: string, key: string, value: string) => void;
  read: (path: string, key: string) => string | undefined;
  remove: (path: string, key: string) => void;
  list: (path: string) => string[];
}

function run(cmd: string, args: string[], opts: SpawnSyncOptions = {}): { code: number; stdout: string; stderr: string } {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
  if (r.error) throw new Error(`spawn ${cmd}: ${r.error.message}`);
  return {
    code: r.status ?? -1,
    stdout: typeof r.stdout === 'string' ? r.stdout : (r.stdout?.toString('utf8') ?? ''),
    stderr: typeof r.stderr === 'string' ? r.stderr : (r.stderr?.toString('utf8') ?? ''),
  };
}

// ─── macOS (xattr) ──────────────────────────────────────────────────────
const macXattr: XattrOps = {
  set(path, key, value) {
    const r = run('xattr', ['-w', key, value, path]);
    if (r.code !== 0) throw new Error(`xattr -w failed: ${r.stderr.trim()}`);
  },
  read(path, key) {
    const r = run('xattr', ['-p', key, path]);
    if (r.code !== 0) {
      // missing attribute -> exit 1 with "No such xattr" stderr
      if (/No such xattr|: \[Errno 93\]/i.test(r.stderr)) return undefined;
      // missing file
      if (/No such file/i.test(r.stderr)) throw new Error(`file not found: ${path}`);
      return undefined;
    }
    // xattr -p prints the raw value; for printable text this is the JSON.
    // It MAY add a trailing newline; trim.
    return r.stdout.replace(/\n$/, '');
  },
  remove(path, key) {
    const r = run('xattr', ['-d', key, path]);
    if (r.code !== 0 && !/No such xattr/i.test(r.stderr)) {
      throw new Error(`xattr -d failed: ${r.stderr.trim()}`);
    }
  },
  list(path) {
    const r = run('xattr', [path]);
    if (r.code !== 0) return [];
    return r.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
  },
};

// ─── Linux (setfattr/getfattr) ──────────────────────────────────────────
// Note: kernel requires `user.` namespace for non-root, so we transparently
// remap `com.x_harness.X` → `user.com_x_harness.X` on Linux. The mapping is
// reversible and contained in this file.
function linuxKey(k: string): string {
  if (k.startsWith('user.')) return k;
  return `user.${k.replace(/\./g, '_')}`;
}
const linuxXattr: XattrOps = {
  set(path, key, value) {
    const r = run('setfattr', ['-n', linuxKey(key), '-v', value, path]);
    if (r.code !== 0) throw new Error(`setfattr failed: ${r.stderr.trim()}`);
  },
  read(path, key) {
    const r = run('getfattr', ['--only-values', '-n', linuxKey(key), path]);
    if (r.code !== 0) {
      if (/No such attribute|ENOATTR/i.test(r.stderr)) return undefined;
      if (/No such file/i.test(r.stderr)) throw new Error(`file not found: ${path}`);
      return undefined;
    }
    return r.stdout;
  },
  remove(path, key) {
    const r = run('setfattr', ['-x', linuxKey(key), path]);
    if (r.code !== 0 && !/No such attribute/i.test(r.stderr)) {
      throw new Error(`setfattr -x failed: ${r.stderr.trim()}`);
    }
  },
  list(path) {
    const r = run('getfattr', ['-d', '--match=.*', path]);
    if (r.code !== 0) return [];
    const out: string[] = [];
    for (const line of r.stdout.split('\n')) {
      const m = /^([^=]+)=/.exec(line);
      if (m) out.push(m[1]!);
    }
    return out;
  },
};

/** Select xattr backend for current OS. */
export function getXattrOps(): XattrOps {
  switch (platform()) {
    case 'darwin':
      return macXattr;
    case 'linux':
      return linuxXattr;
    default:
      // Windows / others: no xattr support yet. Return a no-op-with-error
      // backend so failures are explicit at write time.
      return {
        set() {
          throw new Error(`xattr not supported on ${platform()}`);
        },
        read() {
          return undefined;
        },
        remove() {
          /* noop */
        },
        list() {
          return [];
        },
      };
  }
}

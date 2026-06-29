/**
 * shell-write-targets — best-effort static extraction of files that a
 * `/bin/sh -lc <cmd>` invocation will create or modify.
 *
 * Scope (v0): cover the two patterns the model actually uses 95% of the time:
 *   1. Redirection:  `cmd > file`, `cmd >> file`, `cmd 2> file`, `cmd 2>> file`
 *      (and any single-digit fd before `>`)
 *   2. `tee` / `tee -a`: tokens after `tee` (skipping option flags) are targets.
 *
 * NOT covered (deliberately; documented in ADR-0009 §v0 boundaries):
 *   - Process substitution `>(...)` / `<(...)`
 *   - Heredocs writing via redirect targets that come BEFORE the command
 *   - Variable expansion in target names ($X.txt) — we leave the raw token
 *     and let the caller decide whether to resolve via `cwd` + existsSync
 *   - Backtick/`$(...)` command substitution that produces filenames
 *
 * The strategy is "false negatives are OK, false positives must be rare":
 * better to miss a redirect than to slap an AI-touch xattr on an unrelated
 * path that happens to look like a filename.
 *
 * Implementation: we reuse the same lexer ideas as
 * `@x_harness/danger/shell-parse` but inline a smaller variant here — we
 * only need to identify operator tokens vs word tokens (no statement
 * splitting beyond `;`, `&&`, `||`, `|`, `&`, `\n`).
 */

import { isAbsolute, resolve as resolvePath } from 'node:path';

export interface ExtractOptions {
  /** Working directory for resolving relative target paths. Required. */
  cwd: string;
}

export interface WriteTarget {
  /** Absolute, normalised path. */
  path: string;
  /** Why we think this is a write target. */
  reason: 'redirect-truncate' | 'redirect-append' | 'tee' | 'tee-append';
  /** Position in original command (debug / diagnostics). */
  index: number;
}

type Token =
  | { kind: 'word'; value: string; index: number }
  | { kind: 'op'; value: string; index: number };

/** Tokeniser tailored to this module — recognises operator clusters
 *  `>`, `>>`, `2>`, `2>>`, `&>`, `|`, `||`, `&&`, `;`, `&`, newline, and
 *  paren groupings. Quotes are preserved as a single word. */
function tokenise(input: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  const n = input.length;
  let buf = '';
  let bufStart = -1;

  const flush = () => {
    if (buf) {
      out.push({ kind: 'word', value: buf, index: bufStart });
      buf = '';
      bufStart = -1;
    }
  };
  const isDigit = (c: string) => c >= '0' && c <= '9';

  while (i < n) {
    const c = input[i]!;
    if (c === ' ' || c === '\t') {
      flush();
      i++;
      continue;
    }
    if (c === '\n' || c === ';') {
      flush();
      out.push({ kind: 'op', value: c === '\n' ? ';' : c, index: i });
      i++;
      continue;
    }
    if (c === '&' && input[i + 1] === '&') {
      flush();
      out.push({ kind: 'op', value: '&&', index: i });
      i += 2;
      continue;
    }
    if (c === '|' && input[i + 1] === '|') {
      flush();
      out.push({ kind: 'op', value: '||', index: i });
      i += 2;
      continue;
    }
    if (c === '|' || c === '&') {
      flush();
      out.push({ kind: 'op', value: c, index: i });
      i++;
      continue;
    }
    if (c === '(' || c === ')') {
      flush();
      out.push({ kind: 'op', value: c, index: i });
      i++;
      continue;
    }
    // `>` / `>>`, optionally preceded by a digit (fd). Detect by lookback.
    // We do that AT the `>` char.
    if (c === '>') {
      // Re-attach a trailing digit from buf as an fd marker, so `2>file`
      // and `2 > file` both parse the same way.
      if (buf.length > 0 && /^[0-9]$/.test(buf)) {
        // Treat the digit as fd; drop it from word buf.
        buf = '';
        bufStart = -1;
      } else {
        flush();
      }
      // `>` or `>>`?
      if (input[i + 1] === '>') {
        out.push({ kind: 'op', value: '>>', index: i });
        i += 2;
      } else {
        out.push({ kind: 'op', value: '>', index: i });
        i++;
      }
      continue;
    }
    // `&>` (bash: stdout+stderr) — treat as redirect truncate.
    // Handled implicitly: we matched `&` above as its own op token; if we
    // see `>` next, the redirect logic still fires. Skip dedicated handling.

    // backslash escape
    if (c === '\\' && i + 1 < n) {
      if (bufStart < 0) bufStart = i;
      buf += input[i + 1];
      i += 2;
      continue;
    }
    // single quotes — literal
    if (c === "'") {
      if (bufStart < 0) bufStart = i;
      i++;
      while (i < n && input[i] !== "'") {
        buf += input[i];
        i++;
      }
      i++; // closing
      continue;
    }
    // double quotes — preserve content; do NOT expand $vars
    if (c === '"') {
      if (bufStart < 0) bufStart = i;
      i++;
      while (i < n && input[i] !== '"') {
        if (input[i] === '\\' && i + 1 < n) {
          const nxt = input[i + 1]!;
          if (nxt === '"' || nxt === '\\' || nxt === '$' || nxt === '`') {
            buf += nxt;
            i += 2;
            continue;
          }
        }
        buf += input[i];
        i++;
      }
      i++; // closing
      continue;
    }
    // command substitution `$(...)` — collapse to one opaque token so a
    // `> $(date).log` doesn't confuse us
    if (c === '$' && input[i + 1] === '(') {
      if (bufStart < 0) bufStart = i;
      let depth = 1;
      let j = i + 2;
      buf += '$(';
      while (j < n && depth > 0) {
        const cc = input[j]!;
        if (cc === '(') depth++;
        else if (cc === ')') depth--;
        if (depth > 0) buf += cc;
        j++;
      }
      buf += ')';
      i = j;
      continue;
    }
    // backtick command substitution
    if (c === '`') {
      if (bufStart < 0) bufStart = i;
      buf += '`';
      i++;
      while (i < n && input[i] !== '`') {
        buf += input[i];
        i++;
      }
      buf += '`';
      i++;
      continue;
    }
    if (bufStart < 0) bufStart = i;
    buf += c;
    i++;
    // sanity: detect a trailing fd-digit attached to `>` if a digit appears
    // before `>` with no whitespace.
    void isDigit;
  }
  flush();
  return out;
}

/** Resolve a target token to an absolute path (or undefined if it looks
 *  too dynamic to trust — variables, command substitution, glob). */
function resolveTarget(token: string, cwd: string): string | undefined {
  if (!token) return undefined;
  // Bail on dynamic constructs we explicitly don't expand.
  if (/\$\(/.test(token)) return undefined;
  if (/`/.test(token)) return undefined;
  if (/\$\{/.test(token)) return undefined;
  // bare $VAR: we COULD resolve from process.env but that's risky in v0
  // (the model could have changed env via `export`); skip.
  if (/(^|[^\\])\$[A-Za-z_]/.test(token)) return undefined;
  // glob? if it has wildcards, don't tag — we'd need actual expansion.
  if (/[*?\[]/.test(token)) return undefined;
  // pipe / device redirects
  if (token === '/dev/null' || token === '/dev/stdout' || token === '/dev/stderr') return undefined;
  if (token.startsWith('/dev/fd/')) return undefined;
  return isAbsolute(token) ? token : resolvePath(cwd, token);
}

/**
 * Static scan for write targets. Returns absolute paths the command
 * appears to create or modify, with no duplicates and stable order.
 */
export function extractWriteTargets(cmd: string, opts: ExtractOptions): WriteTarget[] {
  const toks = tokenise(cmd);
  const seen = new Set<string>();
  const out: WriteTarget[] = [];

  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]!;

    // ── Redirection: `>` or `>>` followed by a word ──────────────────
    if (t.kind === 'op' && (t.value === '>' || t.value === '>>')) {
      const next = toks[i + 1];
      if (next && next.kind === 'word') {
        const abs = resolveTarget(next.value, opts.cwd);
        if (abs && !seen.has(abs)) {
          seen.add(abs);
          out.push({
            path: abs,
            reason: t.value === '>>' ? 'redirect-append' : 'redirect-truncate',
            index: t.index,
          });
        }
      }
      continue;
    }

    // ── `tee` / `tee -a` ────────────────────────────────────────────
    if (t.kind === 'word' && t.value === 'tee') {
      let appending = false;
      let j = i + 1;
      while (j < toks.length) {
        const u = toks[j]!;
        if (u.kind !== 'word') break; // stop at op (|, ;, &&, ...)
        if (u.value === '-a' || u.value === '--append') {
          appending = true;
          j++;
          continue;
        }
        if (u.value.startsWith('-')) {
          // unknown flag — keep skipping
          j++;
          continue;
        }
        const abs = resolveTarget(u.value, opts.cwd);
        if (abs && !seen.has(abs)) {
          seen.add(abs);
          out.push({
            path: abs,
            reason: appending ? 'tee-append' : 'tee',
            index: u.index,
          });
        }
        j++;
      }
      i = j - 1;
      continue;
    }
  }
  return out;
}

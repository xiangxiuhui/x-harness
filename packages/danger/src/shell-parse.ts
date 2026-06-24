/**
 * shell-parse — tokenize a shell command into argv-like atoms.
 *
 * We do NOT want to spawn /bin/sh just to read intent (that's the whole point
 * of the guard). This parser handles enough of POSIX to recognize:
 *   - command names (first token)
 *   - quoted strings (single + double, with backslash escapes inside double)
 *   - operators: ; & && || | ( )
 *   - redirections (we just emit them as tokens; rule code mostly ignores)
 *
 * It does NOT handle:
 *   - variable expansion ($FOO, ${BAR}) — left as-is in tokens
 *   - command substitution ($(...))  — body kept as a single token starting with `$(`
 *   - heredocs (treated as end-of-line)
 *
 * Output: array of "statements" each being an argv array.
 */

export interface ShellStatement {
  argv: string[];
  /** Index in original string at which this statement starts. */
  startIndex: number;
}

const SEP_OPS = new Set([';', '&', '&&', '|', '||', '(', ')', '\n']);

export function parseShellCommand(input: string): ShellStatement[] {
  const out: ShellStatement[] = [];
  let cur: string[] = [];
  let curStart = 0;
  let i = 0;
  const n = input.length;
  let buf = '';
  let bufStarted = -1;

  const flushToken = () => {
    if (buf.length > 0) {
      cur.push(buf);
      buf = '';
      bufStarted = -1;
    }
  };
  const flushStmt = () => {
    flushToken();
    if (cur.length > 0) {
      out.push({ argv: cur, startIndex: curStart });
      cur = [];
    }
  };

  while (i < n) {
    const c = input[i]!;

    // whitespace
    if (c === ' ' || c === '\t') {
      flushToken();
      i++;
      continue;
    }

    // newline / semicolon / pipes
    if (c === '\n' || c === ';') {
      flushStmt();
      curStart = i + 1;
      i++;
      continue;
    }
    if (c === '&' && input[i + 1] === '&') {
      flushStmt();
      curStart = i + 2;
      i += 2;
      continue;
    }
    if (c === '|' && input[i + 1] === '|') {
      flushStmt();
      curStart = i + 2;
      i += 2;
      continue;
    }
    if (c === '|' || c === '&') {
      flushStmt();
      curStart = i + 1;
      i++;
      continue;
    }
    if (c === '(' || c === ')') {
      flushToken();
      i++;
      continue;
    }

    // backslash escape (outside quotes): include next char literally
    if (c === '\\' && i + 1 < n) {
      if (bufStarted < 0) bufStarted = i;
      buf += input[i + 1];
      i += 2;
      continue;
    }

    // single quotes: literal
    if (c === "'") {
      if (bufStarted < 0) bufStarted = i;
      i++;
      while (i < n && input[i] !== "'") {
        buf += input[i];
        i++;
      }
      i++; // closing '
      continue;
    }

    // double quotes: escape \" \\ \$ \` \n; otherwise literal
    if (c === '"') {
      if (bufStarted < 0) bufStarted = i;
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
      i++; // closing "
      continue;
    }

    // command substitution $(...)
    if (c === '$' && input[i + 1] === '(') {
      if (bufStarted < 0) bufStarted = i;
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

    if (bufStarted < 0) bufStarted = i;
    buf += c;
    i++;
  }

  flushStmt();
  return out.filter((s) => s.argv.length > 0);
}

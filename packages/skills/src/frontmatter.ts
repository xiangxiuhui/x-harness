/**
 * Tiny YAML-ish frontmatter parser. We deliberately avoid pulling in a real
 * YAML lib for spiral 1; the subset we need:
 *
 *   - top-level scalars: foo: bar
 *   - quoted strings:    foo: "bar baz"
 *   - inline arrays:     platforms: [macos, linux]
 *   - nested maps (one level):
 *       metadata:
 *         x_harness:
 *           danger_class: B
 *           tags: [shell, system]
 *
 * For anything richer, a SKILL.md author should switch to JSON-encoded
 * `parameters:` (single line) — which we accept verbatim.
 *
 * Frontmatter delimiter: a `---` line at the very start, and another `---`
 * line afterwards. The body is everything after the second delimiter.
 */

import type { SkillFrontmatter } from './types.js';

export interface FrontmatterParseResult {
  frontmatter: SkillFrontmatter;
  body: string;
}

export function parseFrontmatter(text: string): FrontmatterParseResult {
  const trimmed = text.replace(/^\uFEFF/, '');
  if (!trimmed.startsWith('---')) {
    return { frontmatter: { name: '', description: '' }, body: trimmed };
  }
  const lines = trimmed.split(/\r?\n/);
  // first line is `---`; find the next standalone `---`
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === '---') {
      end = i;
      break;
    }
  }
  if (end < 0) {
    // unterminated frontmatter: treat whole file as body
    return { frontmatter: { name: '', description: '' }, body: trimmed };
  }
  const yaml = lines.slice(1, end).join('\n');
  const body = lines
    .slice(end + 1)
    .join('\n')
    .replace(/^\n+/, '');

  const fm = parseSimpleYaml(yaml) as Record<string, unknown>;
  return {
    frontmatter: normalizeFrontmatter(fm),
    body,
  };
}

function normalizeFrontmatter(raw: Record<string, unknown>): SkillFrontmatter {
  const name = typeof raw.name === 'string' ? raw.name : '';
  const description =
    typeof raw.description === 'string' ? raw.description : '';
  return { ...raw, name, description } as SkillFrontmatter;
}

interface YamlLine {
  indent: number;
  text: string;
  raw: string;
}

function parseSimpleYaml(text: string): unknown {
  const lines: YamlLine[] = text
    .split(/\r?\n/)
    .map((raw) => {
      const noComment = stripComment(raw);
      const match = noComment.match(/^(\s*)(.*)$/);
      const indent = match?.[1]?.length ?? 0;
      const t = (match?.[2] ?? '').trimEnd();
      return { indent, text: t, raw };
    })
    .filter((l) => l.text.length > 0);
  const [obj] = parseObjectBlock(lines, 0, -1);
  return obj;
}

function stripComment(line: string): string {
  // a very rough comment stripper: # not inside quotes
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === '#' && !inSingle && !inDouble) return line.slice(0, i);
  }
  return line;
}

function parseObjectBlock(
  lines: YamlLine[],
  start: number,
  parentIndent: number,
): [Record<string, unknown>, number] {
  const obj: Record<string, unknown> = {};
  let i = start;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.indent <= parentIndent) break;
    const colon = findUnquotedColon(line.text);
    if (colon < 0) {
      i++;
      continue;
    }
    const key = line.text.slice(0, colon).trim();
    const after = line.text.slice(colon + 1).trim();
    const myIndent = line.indent;

    if (after === '') {
      // nested map (or empty)
      const next = lines[i + 1];
      if (next && next.indent > myIndent) {
        const [child, ni] = parseObjectBlock(lines, i + 1, myIndent);
        obj[key] = child;
        i = ni;
      } else {
        obj[key] = null;
        i++;
      }
    } else {
      obj[key] = parseScalar(after);
      i++;
    }
  }
  return [obj, i];
}

function findUnquotedColon(s: string): number {
  let inSingle = false;
  let inDouble = false;
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (!inSingle && !inDouble) {
      if (c === '[' || c === '{') depth++;
      else if (c === ']' || c === '}') depth--;
      else if (c === ':' && depth === 0) return i;
    }
  }
  return -1;
}

function parseScalar(raw: string): unknown {
  const s = raw.trim();
  if (s === '') return '';
  if (s === 'null' || s === '~') return null;
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^-?\d+$/.test(s)) return Number(s);
  if (/^-?\d+\.\d+$/.test(s)) return Number(s);
  if (s.startsWith('"') && s.endsWith('"')) return unescapeDoubleQuoted(s.slice(1, -1));
  if (s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1);
  if (s.startsWith('[') && s.endsWith(']')) return parseInlineArray(s.slice(1, -1));
  if (s.startsWith('{') && s.endsWith('}')) return parseInlineObject(s.slice(1, -1));
  return s;
}

function unescapeDoubleQuoted(s: string): string {
  return s.replace(/\\(["\\nrt])/g, (_m, c) => {
    if (c === 'n') return '\n';
    if (c === 'r') return '\r';
    if (c === 't') return '\t';
    return c;
  });
}

function parseInlineArray(inner: string): unknown[] {
  const parts = splitTopLevel(inner, ',');
  return parts.filter((p) => p.length > 0).map((p) => parseScalar(p));
}

function parseInlineObject(inner: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const part of splitTopLevel(inner, ',')) {
    const c = findUnquotedColon(part);
    if (c < 0) continue;
    const k = part.slice(0, c).trim();
    out[k] = parseScalar(part.slice(c + 1).trim());
  }
  return out;
}

function splitTopLevel(s: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  for (const c of s) {
    if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (!inSingle && !inDouble) {
      if (c === '[' || c === '{') depth++;
      else if (c === ']' || c === '}') depth--;
      else if (c === sep && depth === 0) {
        out.push(cur.trim());
        cur = '';
        continue;
      }
    }
    cur += c;
  }
  if (cur.trim().length > 0) out.push(cur.trim());
  return out;
}

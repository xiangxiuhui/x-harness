/**
 * Provenance writer/reader — combines the schema (./types) with the OS
 * xattr backend (./xattr) into the public API consumed by skills, CLI,
 * and web.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  XATTR_KEY,
  compactAutonomy,
  executorTag,
  expandAutonomy,
  type AiTouchXattr,
  type IntentProvenance,
  type Autonomy,
} from './types.js';
import { getXattrOps, type XattrOps } from './xattr.js';

/**
 * Write the AI-touch watermark to a freshly-modified file.
 *
 * The caller (skill / file.write) must call this AFTER the file has been
 * persisted to disk, and BEFORE returning to the LLM. Failure to set the
 * xattr is logged but is NOT fatal — JSONL is the source of truth, and
 * many filesystems (FAT, network shares) simply don't support xattrs.
 */
export function writeAiTouch(prov: IntentProvenance, ops: XattrOps = getXattrOps()): {
  ok: boolean;
  error?: string;
  xattr: AiTouchXattr;
} {
  const compact: AiTouchXattr = {
    v: 1,
    ts: prov.ts,
    s: prov.sessionId,
    e: prov.originatingHumanMessageSeq,
    x: executorTag(prov.executor),
    a: compactAutonomy(prov.autonomy),
    h: prov.xHarnessHome,
  };
  if (prov.humanApproval && prov.humanApproval.ruleIds.length > 0) {
    compact.ap = prov.humanApproval.ruleIds.join('+');
  }
  const value = JSON.stringify(compact);
  try {
    ops.set(prov.path, XATTR_KEY, value);
    return { ok: true, xattr: compact };
  } catch (e) {
    return { ok: false, error: (e as Error).message, xattr: compact };
  }
}

/** Read the AI-touch watermark, if present. */
export function readAiTouch(path: string, ops: XattrOps = getXattrOps()): AiTouchXattr | undefined {
  const raw = ops.read(path, XATTR_KEY);
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as AiTouchXattr;
    if (parsed && typeof parsed === 'object' && parsed.v === 1) return parsed;
    return undefined;
  } catch {
    return undefined;
  }
}

/** Remove the watermark (for `x untouch <path>`). */
export function removeAiTouch(path: string, ops: XattrOps = getXattrOps()): void {
  ops.remove(path, XATTR_KEY);
}

// ─── JSONL cross-reference ──────────────────────────────────────────────

/**
 * Given an AiTouchXattr, attempt to load the full IntentProvenance from the
 * referenced session's JSONL. Returns undefined if:
 *   - sessionId points to a JSONL we can't find
 *   - the JSONL doesn't contain a provenance.attach entry for `path`
 *
 * This is the "JSONL-is-truth" half of ADR-0009.
 */
export interface TraceResult {
  /** Compact xattr that was on the file. May be undefined if xattr missing. */
  xattr?: AiTouchXattr;
  /** Full provenance record from JSONL, if we could resolve it. */
  full?: IntentProvenance;
  /** Diagnostics for the user. */
  notes: string[];
}

export function trace(targetPath: string, ops: XattrOps = getXattrOps()): TraceResult {
  const notes: string[] = [];
  const xattr = readAiTouch(targetPath, ops);
  if (!xattr) {
    notes.push(`no ${XATTR_KEY} xattr on ${targetPath}`);
    return { notes };
  }
  const jsonlPath = join(xattr.h, 'memory', `${xattr.s}.jsonl`);
  if (!existsSync(jsonlPath)) {
    notes.push(`xattr references session ${xattr.s} but JSONL not found at ${jsonlPath}`);
    return { xattr, notes };
  }
  let raw: string;
  try {
    raw = readFileSync(jsonlPath, 'utf8');
  } catch (e) {
    notes.push(`cannot read JSONL: ${(e as Error).message}`);
    return { xattr, notes };
  }
  for (const line of raw.split('\n')) {
    if (!line) continue;
    let entry: { kind?: string; payload?: { provenance?: IntentProvenance } };
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.kind === 'provenance.attach' && entry.payload?.provenance?.path === targetPath) {
      return { xattr, full: entry.payload.provenance, notes };
    }
  }
  notes.push(`JSONL found but no provenance.attach entry matches ${targetPath}`);
  return { xattr, notes };
}

/** Human-readable one-line summary. */
export function summarize(x: AiTouchXattr): string {
  return `[${x.ts}] ${x.x} (${expandAutonomy(x.a)}) sess=${x.s}${x.e !== undefined ? ` seq=${x.e}` : ''}${x.ap ? ` approved=${x.ap}` : ''}`;
}

export { type Autonomy };

/**
 * Provenance schema per ADR-0009.
 *
 * Two representations:
 *
 *   - FULL (`IntentProvenance`): rich record persisted ONLY in the JSONL log
 *     (`memory/<sessionId>.jsonl`). Includes originating human message, full
 *     session id, full xHarnessHome, schema version, etc.
 *
 *   - COMPACT (`AiTouchXattr`): <1KB JSON written into the filesystem
 *     extended attribute `com.x_harness.ai_touch`. Just enough to (a)
 *     identify that x_harness touched the file, (b) link back to the
 *     authoritative JSONL entry.
 *
 * NEVER assume the xattr is present. Many transports strip xattrs (tar,
 * rsync without -X, cp without -p, iCloud sync, network shares). The JSONL
 * is the truth; xattr is a hint.
 */

/** Who actually performed the write. */
export type Executor =
  | { kind: 'human'; userId: string; surface: 'cli' | 'web' | 'voice' | 'other' }
  | { kind: 'model'; provider: string; model: string }
  | { kind: 'skill'; name: string; runtime?: string }
  | { kind: 'system'; subsystem: string };

/**
 * Autonomy ladder (ADR-0009 §"4-level autonomy spectrum").
 *
 *   - human-instructed:     user explicitly named the action ("write file X")
 *   - human-implied:        user said the goal; model picked the action
 *                           ("clean up the project" → model decides files)
 *   - model-elaborated:     sub-step inside a model-decomposed plan
 *   - model-self-initiated: no recent human input (idle / scheduled / patrol)
 */
export type Autonomy =
  | 'human-instructed'
  | 'human-implied'
  | 'model-elaborated'
  | 'model-self-initiated';

/** Human-approval record, when guard demanded one. */
export interface HumanApproval {
  /** ruleIds matched (ADR-0005). */
  ruleIds: string[];
  /** human's decision string from the prompt. */
  decision: 'allow' | 'allow-and-preapprove' | 'deny';
  /** ISO timestamp when the human answered. */
  ts: string;
}

/** Full record — goes into JSONL, NOT xattr. */
export interface IntentProvenance {
  /** Schema version. Currently 1. */
  v: 1;
  /** ISO timestamp of the action. */
  ts: string;
  /** Session id that produced the action. */
  sessionId: string;
  /** seq# of the originating user message in that session's JSONL. May be
   * undefined for model-self-initiated actions. */
  originatingHumanMessageSeq?: number;
  /** Verbatim originating human message text (short copy for ergonomics;
   * truncated to 500 chars). May be undefined if model-self-initiated. */
  originatingHumanMessage?: string;
  /** Who did it. */
  executor: Executor;
  /** Autonomy level — see Autonomy type. */
  autonomy: Autonomy;
  /** Approval record, if a danger rule required one. */
  humanApproval?: HumanApproval;
  /** Trigger that started this session (resume / fresh / scheduled / patrol). */
  sessionTrigger?: 'fresh' | 'resume' | 'scheduled' | 'patrol' | 'web' | 'voice';
  /** xHarnessHome at the time of the action. */
  xHarnessHome: string;
  /** Path that was written. Absolute. */
  path: string;
}

/**
 * Compact form for the xattr. Field names intentionally short — the xattr
 * payload limit on APFS is 64KB but most fs/syncing tools choke beyond 1KB
 * so we stay well under.
 */
export interface AiTouchXattr {
  /** Schema version. */
  v: 1;
  /** ISO timestamp (seconds precision OK). */
  ts: string;
  /** Session id. */
  s: string;
  /** seq# of the JSONL entry that is the source of truth for this touch.
   * Lookup: `memory/<s>.jsonl` line where `seq === e`. */
  e?: number;
  /** Executor: 'human:<surface>' / 'model:<provider>/<model>' / 'skill:<name>' / 'system:<sub>' */
  x: string;
  /** Autonomy single-letter: i=instructed, p=implied, l=elaborated, s=self-initiated. */
  a: 'i' | 'p' | 'l' | 's';
  /** approved-by ruleIds (joined with `+`); absent if no approval was needed. */
  ap?: string;
  /** xHarnessHome (helps locate the JSONL even if the path is moved). */
  h: string;
}

export const XATTR_KEY = 'com.x_harness.ai_touch';
/** Second xattr key (ADR-0002): plain executor tag for quick `xattr -p` reads
 *  without parsing JSON. Always written alongside ai_touch. Value = executorTag(). */
export const XATTR_ACTOR_KEY = 'com.x_harness.actor';

export function compactAutonomy(a: Autonomy): AiTouchXattr['a'] {
  switch (a) {
    case 'human-instructed':
      return 'i';
    case 'human-implied':
      return 'p';
    case 'model-elaborated':
      return 'l';
    case 'model-self-initiated':
      return 's';
  }
}

export function expandAutonomy(c: AiTouchXattr['a']): Autonomy {
  switch (c) {
    case 'i':
      return 'human-instructed';
    case 'p':
      return 'human-implied';
    case 'l':
      return 'model-elaborated';
    case 's':
      return 'model-self-initiated';
  }
}

export function executorTag(e: Executor): string {
  switch (e.kind) {
    case 'human':
      return `human:${e.surface}`;
    case 'model':
      return `model:${e.provider}/${e.model}`;
    case 'skill':
      return `skill:${e.name}`;
    case 'system':
      return `system:${e.subsystem}`;
  }
}

/**
 * ADR-0013 — Compaction types.
 *
 * Schema-aligned with ADR-0015 (CompactionEvent taxonomy) so the same shape
 * can be persisted to rollout JSONL later without a migration.
 */

/** Reason this compaction round was triggered. */
export type CompactionTrigger = 'auto' | 'manual';

export type CompactionReason =
  | 'user-requested'      // CLI `/compact`
  | 'context-limit'       // estimated tokens > threshold
  | 'model-downshift'     // active model changed, smaller window
  | 'sources-changed';    // baseline sources changed (skill load/unload)

export type CompactionPhase =
  | 'standalone'  // run between turns, no in-flight tool calls
  | 'pre-turn'    // run at start of a new user turn
  | 'mid-turn';   // run inside a tool-calling loop (rare, future)

export type CompactionStrategy =
  | 'memento'           // head + recent + middle-summary (ADR-0013 D1)
  | 'tool-output-prune' // only trim tool outputs (ADR-0013 D3)
  | 'prefix-compaction'; // codex-style prefix-only summary (future)

export interface CompactionEvent {
  trigger: CompactionTrigger;
  reason: CompactionReason;
  phase: CompactionPhase;
  strategy: CompactionStrategy;
  /** tokens estimated BEFORE this compaction. */
  tokensBefore: number;
  /** tokens estimated AFTER this compaction. */
  tokensAfter: number;
  /** how many messages remained from the live tail after compaction. */
  recentKept: number;
  /** how many head messages were preserved verbatim. */
  headKept: number;
  /** wall-clock ms spent (incl. summarizer call). */
  durationMs: number;
}

/** Tunables for the memento strategy. */
export interface CompactionConfig {
  /** Trigger threshold as a fraction of contextWindow. Default 0.7 (hermes). */
  threshold: number;
  /** Maximum context window (tokens) for the active model. */
  contextWindow: number;
  /** How many head messages (after system) to preserve verbatim. */
  headN: number;
  /** How many recent messages to preserve verbatim (the tail). */
  recentN: number;
  /** Tool outputs > this many tokens get truncated + offloaded. */
  toolOutputMaxTokens: number;
}

export const DEFAULT_COMPACTION_CONFIG: CompactionConfig = {
  threshold: 0.7,
  contextWindow: 64_000,
  headN: 5,
  recentN: 10,
  toolOutputMaxTokens: 4096,
};

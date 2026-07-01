/**
 * Memory entry types. One line of JSONL = one entry.
 *
 * Every entry carries:
 *   - ts:       wall-clock ISO timestamp
 *   - seq:      monotonic per-session sequence number
 *   - actor:    who did this (ADR-0002): human / model / system / skill
 *   - kind:     event kind
 *   - payload:  kind-specific
 */
export type MemoryActor =
  | { kind: 'human'; userId: string; surface: string }
  | { kind: 'model'; provider: string; model: string }
  | { kind: 'system'; subsystem: string }
  | { kind: 'skill'; name: string; source: string };

export interface MemoryEntryBase<K extends string, P> {
  ts: string;
  seq: number;
  actor: MemoryActor;
  kind: K;
  payload: P;
}

export type MemoryEntry =
  | MemoryEntryBase<'session.start', { sessionId: string; model: { provider: string; model: string }; cwd: string; xHarnessHome: string }>
  | MemoryEntryBase<'system.message', { content: string }>
  | MemoryEntryBase<'user.message', { content: string }>
  | MemoryEntryBase<'assistant.message', { content: string; finishReason?: string; toolCalls?: Array<{ id: string; name: string; argumentsJson: string }> }>
  | MemoryEntryBase<'tool.call', { id: string; name: string; argumentsJson: string }>
  | MemoryEntryBase<'tool.danger', { id: string; name: string; decision: 'confirm' | 'block'; headline: string; ruleIds: string[] }>
  | MemoryEntryBase<'tool.approval', { id: string; name: string; decision: 'allow' | 'allow-and-preapprove' | 'allow-and-path-preapprove' | 'deny'; preapprovedRuleIds?: string[]; preapprovedPathPrefix?: string }>
  | MemoryEntryBase<'tool.result', { id: string; name: string; output: string; error?: boolean; blocked?: boolean }>
  | MemoryEntryBase<'session.end', { reason: 'bye' | 'eof' | 'error'; turns: number }>
  | MemoryEntryBase<'territory.loaded', { path: string; version: number | null; zones: string[]; generatedDefault: boolean }>
  | MemoryEntryBase<'context.compacted', {
      trigger: 'auto' | 'manual';
      reason: 'user-requested' | 'context-limit' | 'model-downshift' | 'sources-changed';
      phase: 'standalone' | 'pre-turn' | 'mid-turn';
      strategy: 'memento' | 'tool-output-prune' | 'prefix-compaction';
      tokensBefore: number;
      tokensAfter: number;
      recentKept: number;
      headKept: number;
      durationMs: number;
    }>
  | MemoryEntryBase<'context.snapshot.persisted', {
      sessionId: string;
      path: string;
      messageCount: number;
      estimatedTokens: number;
      pendingToolCalls: number;
      compactionCount: number;
    }>
  | MemoryEntryBase<'error', { where: string; message: string; subsystem?: string }>
  | MemoryEntryBase<'provenance.attach', { provenance: { v: 1; ts: string; sessionId: string; originatingHumanMessageSeq?: number; originatingHumanMessage?: string; executor: unknown; autonomy: string; humanApproval?: unknown; sessionTrigger?: string; xHarnessHome: string; path: string }; xattrOk: boolean; xattrError?: string }>
  | MemoryEntryBase<'evolution.feedback', { targetSeq: number; targetKind: string; verdict: 'accept' | 'reject' | 'i-would-have'; note?: string; suggestion?: string }>;

export interface SessionIndexEntry {
  sessionId: string;
  startedAt: string;
  endedAt?: string;
  cwd: string;
  model: { provider: string; model: string };
  userId: string;
  /** Approximate count of user turns, useful for `x sessions ls`. */
  userTurns: number;
  /** Path to the JSONL relative to <home>/memory/. */
  file: string;
}

export interface MemoryWriteOptions {
  /** Default: ~/.x_harness */
  home: string;
}

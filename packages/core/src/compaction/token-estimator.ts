/**
 * ADR-0013 — Token estimator.
 *
 * Two-tier:
 *   1. If a tokenizer is provided (caller wires tiktoken/o200k later), use it.
 *   2. Otherwise, fallback to a heuristic (`chars / 3.6` ≈ english+code mix).
 *
 * Precision target: ±10% on real messages — enough for threshold decisions.
 * We intentionally bias slightly HIGH so we trigger compaction a bit early
 * rather than late (better UX than HTTP 400 from the provider).
 *
 * No deps on provider package internals; takes a minimal Message-like shape.
 */

import type { Message } from '@x_harness/provider';

/** Caller can inject a real BPE tokenizer; the heuristic is the fallback. */
export type Tokenizer = (text: string) => number;

/** Default heuristic: chars / 3.6, slightly conservative on the high side. */
export function heuristicCount(text: string): number {
  if (!text) return 0;
  // Whitespace-heavy text (JSON, code) tends to be ~3.5 chars/token; prose ~4.
  // 3.6 averages those two regimes.
  return Math.ceil(text.length / 3.6);
}

/** Count tokens for a single message. Includes role/tool-call overhead. */
export function estimateMessageTokens(msg: Message, tokenize: Tokenizer = heuristicCount): number {
  // OpenAI's per-message overhead is ~4 tokens (role + separators).
  const ROLE_OVERHEAD = 4;
  let n = ROLE_OVERHEAD + tokenize(msg.content ?? '');
  if (msg.toolCalls?.length) {
    for (const tc of msg.toolCalls) {
      // name + json overhead
      n += 2 + tokenize(tc.name) + tokenize(tc.argumentsJson ?? '');
    }
  }
  if (msg.toolCallId) {
    n += 2 + tokenize(msg.toolCallId);
  }
  return n;
}

/** Sum tokens across an array of messages. */
export function estimateMessagesTokens(
  messages: ReadonlyArray<Message>,
  tokenize: Tokenizer = heuristicCount,
): number {
  let total = 2; // priming overhead
  for (const m of messages) total += estimateMessageTokens(m, tokenize);
  return total;
}

/** Should we trigger compaction? */
export function shouldCompact(
  tokens: number,
  contextWindow: number,
  threshold: number,
): boolean {
  if (contextWindow <= 0) return false;
  return tokens >= contextWindow * threshold;
}

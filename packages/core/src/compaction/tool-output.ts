/**
 * ADR-0013 D3 — tool-output truncation & offloading.
 *
 * When a tool returns a huge output, the conversation history is forced to
 * carry that mass forever. opencode's `ManagedToolOutputFile` is the cleanest
 * existing solution: truncate inline + offload full to a managed file.
 *
 * Pure-function form here; the actual filesystem write is performed by the
 * caller (Session) so this module remains test-friendly without temp dirs.
 *
 * Contract:
 *   - input: a 'tool' role message, with `content` possibly very large
 *   - output: { trimmedMessage, sidecar? } where sidecar is the bytes to
 *             write to a managed file (if truncation happened)
 */

import type { Message } from '@x_harness/provider';
import { heuristicCount, type Tokenizer } from './token-estimator.js';

export interface ManagedToolOutput {
  /** Stable id (tool call id) used to name the sidecar file. */
  callId: string;
  /** Original size in tokens (approx). */
  originalTokens: number;
  /** Full output content; caller writes to disk. */
  fullContent: string;
}

export interface TrimResult {
  message: Message;
  sidecar?: ManagedToolOutput;
}

/**
 * Trim a tool-role message if its content exceeds `maxTokens`.
 *
 * Keeps the first `keepHead` tokens-worth of characters as a summary in-place,
 * and returns the full content as a sidecar so the caller can offload it.
 */
export function trimToolOutput(
  msg: Message,
  maxTokens: number,
  tokenize: Tokenizer = heuristicCount,
  keepHeadTokens = 1024,
): TrimResult {
  if (msg.role !== 'tool') return { message: msg };
  const content = msg.content ?? '';
  const tokens = tokenize(content);
  if (tokens <= maxTokens) return { message: msg };

  // Estimate how many characters correspond to `keepHeadTokens`.
  // Use the empirical ratio derived from the tokenizer in use.
  const ratio = content.length / Math.max(tokens, 1);
  const headChars = Math.max(256, Math.floor(keepHeadTokens * ratio));
  const head = content.slice(0, headChars);

  const callId = msg.toolCallId ?? 'unknown';
  const trimmedContent =
    head +
    `\n\n[x_harness] tool output truncated: ${tokens} tokens → kept first ~${keepHeadTokens}; ` +
    `full output offloaded to managed file (call ${callId}).`;

  return {
    message: {
      ...msg,
      content: trimmedContent,
      meta: { ...(msg.meta ?? {}), truncated: true, originalTokens: tokens },
    },
    sidecar: {
      callId,
      originalTokens: tokens,
      fullContent: content,
    },
  };
}

/**
 * Walk a messages array and trim every oversized tool output.
 *
 * Returns the new messages array (always a new ref) plus the list of sidecars
 * the caller is responsible for persisting.
 */
export function trimToolOutputsInMessages(
  messages: ReadonlyArray<Message>,
  maxTokens: number,
  tokenize: Tokenizer = heuristicCount,
  keepHeadTokens = 1024,
): { messages: Message[]; sidecars: ManagedToolOutput[] } {
  const out: Message[] = [];
  const sidecars: ManagedToolOutput[] = [];
  for (const m of messages) {
    const r = trimToolOutput(m, maxTokens, tokenize, keepHeadTokens);
    out.push(r.message);
    if (r.sidecar) sidecars.push(r.sidecar);
  }
  return { messages: out, sidecars };
}

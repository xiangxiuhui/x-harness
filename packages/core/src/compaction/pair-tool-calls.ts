/**
 * ADR-0013 — tool_call ↔ tool_result pair invariant.
 *
 * Lesson from openclaw's dedicated `tool-call-repair` package + our own
 * 4c69d98 HTTP-400 fix: every `assistant.toolCalls[i]` MUST have a matching
 * `tool` role message with `toolCallId === toolCalls[i].id`, otherwise the
 * next provider request fails.
 *
 * Compaction must therefore treat each (assistant-with-toolcalls, ...replies)
 * tuple as ONE atomic unit. We expose two helpers:
 *
 *   1. `splitIntoPairs(messages)` — partition messages into logical "units".
 *   2. `dropOrKeepUnits(units, n, mode)` — keep N units from head / tail.
 *
 * Definitions:
 *   - A "unit" is a slice [start, end) of messages where:
 *       * unit[0] is either: a user message, OR an assistant message, OR
 *         a system message
 *       * any assistant.toolCalls have their tool replies bundled in the
 *         same unit
 *
 * Edge cases:
 *   - An assistant message with toolCalls that has NO matching tool replies
 *     is INVALID input here (caller should sync first via the same protocol
 *     fix as 4c69d98).
 */

import type { Message } from '@x_harness/provider';

export interface MessageUnit {
  /** Messages composing this unit, in order. */
  messages: Message[];
  /** True if this unit contains tool calls (cannot be split). */
  hasToolCalls: boolean;
}

/** Partition messages into atomic units (system stays as its own unit). */
export function splitIntoPairs(messages: ReadonlyArray<Message>): MessageUnit[] {
  const units: MessageUnit[] = [];
  let i = 0;
  while (i < messages.length) {
    const m = messages[i]!;
    if (m.role === 'system') {
      units.push({ messages: [m], hasToolCalls: false });
      i++;
      continue;
    }
    if (m.role === 'assistant' && m.toolCalls?.length) {
      // Bundle the assistant message with all following tool replies that
      // match its toolCalls ids, in order.
      const ids = new Set(m.toolCalls.map((c) => c.id));
      const bundle: Message[] = [m];
      let j = i + 1;
      while (j < messages.length) {
        const next = messages[j]!;
        if (next.role === 'tool' && next.toolCallId && ids.has(next.toolCallId)) {
          bundle.push(next);
          ids.delete(next.toolCallId);
          j++;
          if (ids.size === 0) break;
        } else {
          // Stop bundling at any non-matching message; an unmatched id will
          // be reported by the caller's invariant check.
          break;
        }
      }
      units.push({ messages: bundle, hasToolCalls: true });
      i = j;
      continue;
    }
    // user / assistant-no-tool / orphan tool → single-message unit
    units.push({ messages: [m], hasToolCalls: m.toolCalls != null });
    i++;
  }
  return units;
}

/** Flatten units back to a flat messages array. */
export function flattenUnits(units: ReadonlyArray<MessageUnit>): Message[] {
  const out: Message[] = [];
  for (const u of units) out.push(...u.messages);
  return out;
}

/**
 * Validate that every assistant.toolCall has a matching tool reply, and that
 * no orphan tool messages exist. Throws on violation so the caller knows
 * compaction was fed dirty input.
 */
export function assertPairInvariant(messages: ReadonlyArray<Message>): void {
  const pending = new Map<string, string>(); // id -> tool name
  for (const m of messages) {
    if (m.role === 'assistant' && m.toolCalls) {
      for (const c of m.toolCalls) pending.set(c.id, c.name);
    } else if (m.role === 'tool') {
      if (!m.toolCallId) {
        throw new Error(`[compaction] tool message without toolCallId`);
      }
      if (!pending.has(m.toolCallId)) {
        throw new Error(
          `[compaction] orphan tool reply for id=${m.toolCallId} (no matching assistant.toolCall)`,
        );
      }
      pending.delete(m.toolCallId);
    }
  }
  if (pending.size > 0) {
    const stillOpen = [...pending.entries()].map(([id, name]) => `${name}(${id})`).join(', ');
    throw new Error(`[compaction] unanswered tool_calls: ${stillOpen}`);
  }
}

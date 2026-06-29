import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { Message, ToolCall } from '@x_harness/provider';
import type { MemoryEntry } from './types.js';

/** Read all entries of a session. */
export async function readSession(home: string, sessionId: string): Promise<MemoryEntry[]> {
  const file = join(home, 'memory', `${sessionId}.jsonl`);
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch {
    return [];
  }
  const out: MemoryEntry[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      /* ignore corrupt line */
    }
  }
  return out;
}

/**
 * Replay a session's entries into a Message[] suitable for handing back to a
 * Provider. We reconstruct the exact role:'user'/'assistant'/'tool'/'system'
 * sequence the model originally saw, so the new turn continues naturally.
 *
 * Tool results are kept verbatim — same content the model saw last time. We do
 * NOT re-execute any tools.
 */
export function replayToMessages(entries: ReadonlyArray<MemoryEntry>): Message[] {
  const msgs: Message[] = [];
  for (const e of entries) {
    switch (e.kind) {
      case 'system.message':
        msgs.push({ role: 'system', content: e.payload.content });
        break;
      case 'user.message':
        msgs.push({ role: 'user', content: e.payload.content });
        break;
      case 'assistant.message': {
        const calls: ToolCall[] | undefined = e.payload.toolCalls?.map((c) => ({
          id: c.id,
          name: c.name,
          argumentsJson: c.argumentsJson,
        }));
        const m: Message = {
          role: 'assistant',
          content: e.payload.content,
          ...(calls && calls.length > 0 ? { toolCalls: calls } : {}),
        };
        msgs.push(m);
        break;
      }
      case 'tool.result':
        msgs.push({ role: 'tool', toolCallId: e.payload.id, content: e.payload.output });
        break;
      default:
        // session.start / tool.call / tool.danger / tool.approval / session.end
        // are audit-only and do not show up as Provider messages.
        break;
    }
  }
  return msgs;
}

/** Human-friendly one-line digest of a memory entry (for `x sessions show`). */
export function digestEntry(e: MemoryEntry): string {
  const t = e.ts.slice(11, 19);
  const actorBadge =
    e.actor.kind === 'human'
      ? `you`
      : e.actor.kind === 'model'
        ? `${e.actor.model}`
        : e.actor.kind === 'skill'
          ? `skill:${e.actor.name}`
          : `sys:${e.actor.subsystem}`;
  switch (e.kind) {
    case 'session.start':
      return `[${t}] ── session start (${e.payload.model.model}) cwd=${e.payload.cwd}`;
    case 'system.message':
      return `[${t}] ${actorBadge} (system prompt, ${e.payload.content.length} chars)`;
    case 'user.message':
      return `[${t}] ${actorBadge} > ${oneLine(e.payload.content, 100)}`;
    case 'assistant.message':
      return `[${t}] ${actorBadge}: ${oneLine(e.payload.content, 100)}${
        e.payload.toolCalls?.length ? ` (+${e.payload.toolCalls.length} tool calls)` : ''
      }`;
    case 'tool.call':
      return `[${t}] ${actorBadge} → ${e.payload.name} ${oneLine(e.payload.argumentsJson, 80)}`;
    case 'tool.danger':
      return `[${t}] ⚠  danger ${e.payload.decision} on ${e.payload.name} (${e.payload.ruleIds.join(',')})`;
    case 'tool.approval':
      return `[${t}] human ${e.payload.decision} → ${e.payload.name}`;
    case 'tool.result':
      return `[${t}] ${actorBadge} ← ${e.payload.name}${e.payload.error ? ' ERR' : ''}${e.payload.blocked ? ' BLOCKED' : ''}  ${oneLine(e.payload.output, 80)}`;
    case 'session.end':
      return `[${t}] ── session end (${e.payload.reason}, ${e.payload.turns} turns)`;
    case 'territory.loaded':
      return `[${t}] sys:territory loaded ${e.payload.zones.length} zone(s)${e.payload.generatedDefault ? ' (default created)' : ''}`;
    case 'provenance.attach':
      return `[${t}] sys:provenance ${e.payload.xattrOk ? '✓' : '✗'} ${e.payload.provenance.path} (${e.payload.provenance.autonomy})`;
    case 'evolution.feedback': {
      const p = e.payload;
      const tag = p.verdict === 'accept' ? '👍' : p.verdict === 'reject' ? '👎' : '💡';
      const tail = p.suggestion ? ` — "${oneLine(p.suggestion, 60)}"` : p.note ? ` — "${oneLine(p.note, 60)}"` : '';
      return `[${t}] human:${tag} on #${p.targetSeq} ${p.targetKind} (${p.verdict})${tail}`;
    }
  }
}

function oneLine(s: string, max: number): string {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : flat.slice(0, max) + '…';
}

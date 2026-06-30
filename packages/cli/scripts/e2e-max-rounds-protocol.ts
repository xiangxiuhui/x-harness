/**
 * Regression: when the model keeps emitting tool_calls past maxToolRounds,
 * Session used to push the LAST assistant message (with toolCalls) and bail
 * without writing matching tool replies. The very next user turn then died
 * with DeepSeek 400 "insufficient tool messages following tool_calls".
 *
 * This test stands up a fake provider that ALWAYS emits a tool_call, runs
 * Session with maxToolRounds=2, and asserts that after streamReply exits,
 * EVERY assistant message with toolCalls has a matching tool reply in the
 * message buffer.
 */
import {
  Session,
  type Provider,
  type ChatRequest,
  type ChatChunk,
  type SkillRegistry,
} from '../../core/src/index.js';

const fakeProvider: Provider = {
  name: 'fake',
  defaultModel: 'fake-1',
  async *chat(_req: ChatRequest): AsyncIterable<ChatChunk> {
    // Always emit a tool call to file_read (a no-op-from-perspective skill)
    yield {
      deltaToolCalls: [
        {
          index: 0,
          id: `call_${Math.random().toString(36).slice(2, 8)}`,
          name: 'echo_skill',
          argumentsJson: '{}',
        },
      ],
    };
    yield { finishReason: 'tool_calls' };
  },
};

const skills: SkillRegistry = {
  get(name: string) {
    if (name !== 'echo_skill') return undefined;
    return {
      frontmatter: { name: 'echo_skill', description: 'echo' },
      handler: async () => ({ output: 'ok' }),
      directory: '/tmp',
    } as any;
  },
  toolSpecs() {
    return [{ name: 'echo_skill', description: 'echo', parameters: { type: 'object', properties: {} } }];
  },
  list() {
    return [];
  },
} as any;

let failures = 0;
function check(name: string, cond: boolean, detail?: string): void {
  console.log(`${cond ? '✓' : '✗'} ${name}${detail ? `\n    ${detail}` : ''}`);
  if (!cond) failures++;
}

const session = new Session({
  provider: fakeProvider,
  skills,
  maxToolRounds: 2,
});

session.pushUser('hello');
for await (const _ev of session.streamReply()) {
  // drain
}

// Inspect message buffer: for every assistant message that has toolCalls,
// each toolCall.id must have exactly one matching tool message.
const msgs = session.snapshot();
const assistantToolIds: string[] = [];
const toolReplyIds: string[] = [];
for (const m of msgs) {
  if (m.role === 'assistant' && (m as any).toolCalls) {
    for (const tc of (m as any).toolCalls) assistantToolIds.push(tc.id);
  }
  if (m.role === 'tool' && (m as any).toolCallId) {
    toolReplyIds.push((m as any).toolCallId);
  }
}

check(
  `every tool_call has a tool reply (calls=${assistantToolIds.length}, replies=${toolReplyIds.length})`,
  assistantToolIds.every((id) => toolReplyIds.includes(id)),
  `unanswered: ${assistantToolIds.filter((id) => !toolReplyIds.includes(id)).join(', ') || 'none'}`,
);

check(
  'cap was actually hit (>= 2 assistant turns with toolCalls)',
  assistantToolIds.length >= 2,
);

console.log(failures === 0 ? '\nALL CHECKS PASS ✅' : `\n${failures} CHECK(S) FAILED ❌`);
process.exit(failures === 0 ? 0 : 1);

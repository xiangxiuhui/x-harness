import type {
  ChatChunk,
  ChatRequest,
  Message,
  Provider,
  ToolCall,
} from '@x_harness/provider';
import type { SkillRegistry } from '@x_harness/skills';
import { ActorBus } from './bus.js';
import type { Actor, HumanSurface } from './actor.js';

export interface SessionOptions {
  provider: Provider;
  humanUserId: string;
  humanSurface: HumanSurface;
  systemPrompt?: string;
  bus?: ActorBus;
  skills?: SkillRegistry;
  /** Working directory for skills (default: process.cwd()). */
  cwd?: string;
  /** Safety cap on assistant↔tool ping-pong per user turn. */
  maxToolRounds?: number;
}

/** Events surfaced by Session.streamReply() (the "outer turn" stream). */
export type TurnEvent =
  | { kind: 'assistant.delta'; text: string }
  | { kind: 'assistant.done'; text: string }
  | { kind: 'tool.call'; id: string; name: string; argumentsJson: string }
  | { kind: 'tool.result'; id: string; name: string; output: string; error?: boolean }
  | { kind: 'turn.done' };

interface ToolCallAccum {
  id?: string;
  name?: string;
  args: string;
}

/**
 * A single conversational session.
 *
 * On streamReply():
 *   - call provider with messages (and tool specs if registry has executables)
 *   - stream assistant deltas
 *   - when finish_reason === 'tool_calls', dispatch each call to the registry,
 *     append tool results, and loop until the model stops calling tools (or
 *     maxToolRounds is hit).
 *
 * Danger guard / actor-tag-writing will hook into the same place in the next
 * step (between detecting a tool call and actually invoking the handler).
 */
export class Session {
  readonly id: string;
  readonly bus: ActorBus;
  readonly humanActor: Actor;
  readonly modelActor: Actor;
  private readonly provider: Provider;
  private readonly messages: Message[] = [];
  private readonly skills?: SkillRegistry;
  private readonly cwd: string;
  private readonly maxToolRounds: number;

  constructor(opts: SessionOptions) {
    this.id = `sess-${Math.random().toString(36).slice(2, 10)}`;
    this.bus = opts.bus ?? new ActorBus();
    this.provider = opts.provider;
    this.skills = opts.skills;
    this.cwd = opts.cwd ?? process.cwd();
    this.maxToolRounds = opts.maxToolRounds ?? 8;
    this.humanActor = {
      kind: 'human',
      userId: opts.humanUserId,
      surface: opts.humanSurface,
    };
    this.modelActor = {
      kind: 'model',
      provider: opts.provider.name,
      model: opts.provider.defaultModel,
      sessionId: this.id,
    };
    if (opts.systemPrompt) {
      this.messages.push({ role: 'system', content: opts.systemPrompt });
    }
    this.bus.publish({
      actor: { kind: 'system', subsystem: 'session' },
      kind: 'session.start',
      payload: { sessionId: this.id, model: this.modelActor },
    });
  }

  pushUser(content: string): void {
    this.messages.push({ role: 'user', content });
    this.bus.publish({
      actor: this.humanActor,
      kind: 'message.user',
      payload: { content },
    });
  }

  /**
   * Drive one user turn end-to-end. Yields TurnEvents until the model has
   * produced a final assistant message with no further tool calls.
   */
  async *streamReply(signal?: AbortSignal): AsyncIterable<TurnEvent> {
    const tools = this.skills?.toolSpecs() ?? [];
    const useTools = tools.length > 0;
    let rounds = 0;

    while (true) {
      rounds++;
      const req: ChatRequest = {
        messages: this.messages,
        ...(useTools ? { tools } : {}),
      };

      let accumulatedText = '';
      const callAccums = new Map<number, ToolCallAccum>();
      let finishReason: ChatChunk['finishReason'];

      for await (const chunk of this.provider.chat(req, signal)) {
        if (chunk.deltaContent) {
          accumulatedText += chunk.deltaContent;
          this.bus.publish({
            actor: this.modelActor,
            kind: 'message.assistant.delta',
            payload: { delta: chunk.deltaContent },
          });
          yield { kind: 'assistant.delta', text: chunk.deltaContent };
        }
        if (chunk.deltaToolCalls) {
          for (const d of chunk.deltaToolCalls) {
            const slot = callAccums.get(d.index) ?? { args: '' };
            if (d.id) slot.id = d.id;
            if (d.name) slot.name = d.name;
            if (d.argumentsJson) slot.args += d.argumentsJson;
            callAccums.set(d.index, slot);
          }
        }
        if (chunk.finishReason) finishReason = chunk.finishReason;
      }

      const toolCalls: ToolCall[] = [];
      for (const [, a] of [...callAccums.entries()].sort(
        ([x], [y]) => x - y,
      )) {
        if (!a.id || !a.name) continue;
        toolCalls.push({ id: a.id, name: a.name, argumentsJson: a.args || '{}' });
      }

      // Persist the assistant message exactly as provider expects it back.
      const assistantMsg: Message = {
        role: 'assistant',
        content: accumulatedText,
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
      };
      this.messages.push(assistantMsg);

      this.bus.publish({
        actor: this.modelActor,
        kind: 'message.assistant.done',
        payload: { content: accumulatedText, finishReason, toolCalls },
      });
      yield { kind: 'assistant.done', text: accumulatedText };

      if (toolCalls.length === 0 || !this.skills) {
        yield { kind: 'turn.done' };
        return;
      }
      if (rounds >= this.maxToolRounds) {
        this.messages.push({
          role: 'user',
          content:
            '[x_harness] tool-call loop hit the max-rounds safety cap; ' +
            'please respond to the user without calling more tools.',
        });
        yield { kind: 'turn.done' };
        return;
      }

      // Dispatch each tool call (sequentially, deterministic for spiral 1).
      for (const call of toolCalls) {
        const skill = this.skills.get(call.name);
        this.bus.publish({
          actor: this.modelActor,
          kind: 'tool.call',
          payload: { id: call.id, name: call.name, argumentsJson: call.argumentsJson },
        });
        yield {
          kind: 'tool.call',
          id: call.id,
          name: call.name,
          argumentsJson: call.argumentsJson,
        };

        let output: string;
        let error: boolean | undefined;
        if (!skill || !skill.handler) {
          output = `error: skill \`${call.name}\` is not executable in this runtime.`;
          error = true;
        } else {
          let parsedArgs: Record<string, unknown> = {};
          try {
            parsedArgs = call.argumentsJson ? JSON.parse(call.argumentsJson) : {};
          } catch (e) {
            output = `error: could not parse tool arguments: ${(e as Error).message}`;
            error = true;
            this.appendToolResult(call.id, output);
            this.bus.publish({
              actor: { kind: 'system', subsystem: 'skill-runtime' },
              kind: 'tool.result',
              payload: { id: call.id, name: call.name, output, error },
            });
            yield { kind: 'tool.result', id: call.id, name: call.name, output, error };
            continue;
          }
          try {
            const result = await skill.handler(parsedArgs, {
              sessionId: this.id,
              cwd: this.cwd,
              signal,
            });
            output = result.output;
            error = result.error;
          } catch (e) {
            output = `skill threw: ${(e as Error).message}`;
            error = true;
          }
        }
        this.appendToolResult(call.id, output);
        this.bus.publish({
          actor: { kind: 'system', subsystem: 'skill-runtime' },
          kind: 'tool.result',
          payload: { id: call.id, name: call.name, output, error },
        });
        yield { kind: 'tool.result', id: call.id, name: call.name, output, error };
      }
      // loop: ask the model again with tool results appended.
    }
  }

  private appendToolResult(id: string, output: string): void {
    this.messages.push({ role: 'tool', toolCallId: id, content: output });
  }

  snapshot(): readonly Message[] {
    return this.messages.slice();
  }
}

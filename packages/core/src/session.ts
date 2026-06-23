import type {
  ChatChunk,
  Message,
  Provider,
} from '@x_harness/provider';
import { ActorBus } from './bus.js';
import type { Actor, HumanSurface } from './actor.js';

export interface SessionOptions {
  provider: Provider;
  /** Identity of the human owner of this session (for actor=human events). */
  humanUserId: string;
  humanSurface: HumanSurface;
  /** Optional system prompt for the model. */
  systemPrompt?: string;
  /** Custom bus; one will be created if omitted. */
  bus?: ActorBus;
}

/**
 * A single conversational session.
 *
 * Owns:
 *   - message history
 *   - the human/model actor pair for this session
 *   - a (shared or fresh) ActorBus
 *
 * Does NOT own:
 *   - tool dispatch (next sub-step)
 *   - persistence (Spiral 1.5)
 */
export class Session {
  readonly id: string;
  readonly bus: ActorBus;
  readonly humanActor: Actor;
  readonly modelActor: Actor;
  private readonly provider: Provider;
  private readonly messages: Message[] = [];

  constructor(opts: SessionOptions) {
    this.id = `sess-${Math.random().toString(36).slice(2, 10)}`;
    this.bus = opts.bus ?? new ActorBus();
    this.provider = opts.provider;
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

  /** Append a user message; returns the bus event. */
  pushUser(content: string): void {
    this.messages.push({ role: 'user', content });
    this.bus.publish({
      actor: this.humanActor,
      kind: 'message.user',
      payload: { content },
    });
  }

  /**
   * Ask the model and stream back chunks. The assistant reply is appended to
   * history automatically when the stream ends.
   */
  async *streamReply(signal?: AbortSignal): AsyncIterable<ChatChunk> {
    let accumulated = '';
    let finishReason: ChatChunk['finishReason'];
    for await (const chunk of this.provider.chat(
      { messages: this.messages },
      signal,
    )) {
      if (chunk.deltaContent) {
        accumulated += chunk.deltaContent;
        this.bus.publish({
          actor: this.modelActor,
          kind: 'message.assistant.delta',
          payload: { delta: chunk.deltaContent },
        });
      }
      if (chunk.finishReason) {
        finishReason = chunk.finishReason;
      }
      yield chunk;
    }
    this.messages.push({ role: 'assistant', content: accumulated });
    this.bus.publish({
      actor: this.modelActor,
      kind: 'message.assistant.done',
      payload: { content: accumulated, finishReason },
    });
  }

  snapshot(): readonly Message[] {
    return this.messages.slice();
  }
}

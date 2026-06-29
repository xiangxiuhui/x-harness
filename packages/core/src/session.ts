import type {
  ChatChunk,
  ChatRequest,
  Message,
  Provider,
  ToolCall,
} from '@x_harness/provider';
import type { SkillRegistry } from '@x_harness/skills';
import type {
  DangerContext,
  DangerEngine,
  DangerVerdict,
} from '@x_harness/danger';
import type {
  Executor,
  IntentProvenance,
} from '@x_harness/provenance';
import { writeAiTouch } from '@x_harness/provenance';
import type { ProvenanceAttachResult } from '@x_harness/skills';
import { ActorBus } from './bus.js';
import type { Actor, HumanSurface } from './actor.js';
import { classifyAutonomy } from './autonomy-heuristic.js';

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
  /** Optional danger guard. */
  dangerEngine?: DangerEngine;
  dangerContext?: DangerContext;
  /**
   * Called when a confirm verdict is reached. Must resolve to `true` to allow,
   * `false` to block. If absent, all confirms become blocks (fail-closed).
   */
  confirmDanger?: ConfirmDangerHandler;
  /** Optional audit/memory sink — called as events happen. */
  memory?: MemorySink;
  /** If provided, Session replays these as its initial message buffer
   * (after the systemPrompt if any). Used by `x chat --resume`. */
  resumeMessages?: ReadonlyArray<Message>;
  /** When resuming, override the auto-generated id. */
  sessionId?: string;
  /**
   * Provenance config (ADR-0009). When set, mutating skills can call
   * `ctx.attachProvenance(absPath)` to mark files with an AI-touch xattr
   * AND emit a `provenance.attach` event into the memory sink.
   */
  provenance?: {
    /** Absolute path of ~/.x_harness; required so xattr & JSONL agree. */
    xHarnessHome: string;
    /** What kind of executor we're operating as (model, skill resolved per-call). */
    defaultExecutor?: Executor;
  };
}

/**
 * Minimal, dep-free contract for whatever wants to persist Session events.
 * Implemented by `@x_harness/memory`'s MemoryStore.
 */
export interface MemorySink {
  onSystemPrompt?(content: string): void | Promise<void>;
  onUserMessage?(content: string): void | Promise<void>;
  onAssistantMessage?(payload: {
    content: string;
    finishReason?: string;
    toolCalls?: ToolCall[];
  }): void | Promise<void>;
  onToolCall?(payload: { id: string; name: string; argumentsJson: string }): void | Promise<void>;
  onToolDanger?(payload: {
    id: string;
    name: string;
    decision: 'confirm' | 'block';
    headline: string;
    ruleIds: string[];
  }): void | Promise<void>;
  onToolApproval?(payload: {
    id: string;
    name: string;
    decision: 'allow' | 'allow-and-preapprove' | 'deny';
    preapprovedRuleIds?: string[];
  }): void | Promise<void>;
  onToolResult?(payload: {
    id: string;
    name: string;
    output: string;
    error?: boolean;
    blocked?: boolean;
  }): void | Promise<void>;
  /** ADR-0009 — emitted right after a skill attached AI-touch provenance to a file. */
  onProvenanceAttach?(payload: {
    provenance: IntentProvenance;
    xattrOk: boolean;
    xattrError?: string;
  }): void | Promise<void>;
}

export type ConfirmDangerHandler = (req: {
  verdict: Extract<DangerVerdict, { decision: 'confirm' }>;
  toolName: string;
  args: Record<string, unknown>;
}) => Promise<DangerConfirmation>;

export type DangerConfirmation =
  | { decision: 'allow' }
  | { decision: 'allow-and-preapprove'; ruleIds: string[] }
  | { decision: 'deny' };

/** Events surfaced by Session.streamReply() (the "outer turn" stream). */
export type TurnEvent =
  | { kind: 'assistant.delta'; text: string }
  | { kind: 'assistant.done'; text: string }
  | { kind: 'tool.call'; id: string; name: string; argumentsJson: string }
  | {
      kind: 'tool.danger';
      id: string;
      name: string;
      verdict: Extract<DangerVerdict, { decision: 'confirm' }> | Extract<DangerVerdict, { decision: 'block' }>;
    }
  | {
      kind: 'tool.result';
      id: string;
      name: string;
      output: string;
      error?: boolean;
      blocked?: boolean;
    }
  | { kind: 'turn.done' };

interface ToolCallAccum {
  id?: string;
  name?: string;
  args: string;
}

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
  private readonly dangerEngine?: DangerEngine;
  private readonly dangerContext?: DangerContext;
  private readonly confirmDanger?: ConfirmDangerHandler;
  /** Mutable per-session pre-approvals (rule id -> true). */
  private classAPreapprovals: Record<string, boolean>;
  private readonly memory?: MemorySink;
  private readonly provenanceConfig?: SessionOptions['provenance'];
  /** Last human turn text (truncated). Used as IntentProvenance.originatingHumanMessage. */
  private lastHumanMessage?: string;
  /** Ordinal of human turns within this session, 1-based. */
  private humanTurnOrdinal = 0;
  /** How many tool-call rounds the model has issued since the last human
   *  message. Used by the autonomy heuristic to detect model-elaborated steps. */
  private toolRoundsSinceLastHuman = 0;

  constructor(opts: SessionOptions) {
    this.id = opts.sessionId ?? `sess-${Math.random().toString(36).slice(2, 10)}`;
    this.memory = opts.memory;
    this.bus = opts.bus ?? new ActorBus();
    this.provider = opts.provider;
    this.skills = opts.skills;
    this.cwd = opts.cwd ?? process.cwd();
    this.maxToolRounds = opts.maxToolRounds ?? 8;
    this.dangerEngine = opts.dangerEngine;
    this.dangerContext = opts.dangerContext;
    this.confirmDanger = opts.confirmDanger;
    this.classAPreapprovals = { ...(opts.dangerContext?.classAPreapprovals ?? {}) };
    this.provenanceConfig = opts.provenance;
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
      void this.memory?.onSystemPrompt?.(opts.systemPrompt);
    }
    if (opts.resumeMessages && opts.resumeMessages.length > 0) {
      // Skip leading system message if it duplicates the new systemPrompt.
      let start = 0;
      if (
        opts.systemPrompt &&
        opts.resumeMessages[0]?.role === 'system' &&
        opts.resumeMessages[0]?.content === opts.systemPrompt
      ) {
        start = 1;
      }
      for (let i = start; i < opts.resumeMessages.length; i++) {
        this.messages.push(opts.resumeMessages[i]!);
      }
    }
    this.bus.publish({
      actor: { kind: 'system', subsystem: 'session' },
      kind: 'session.start',
      payload: { sessionId: this.id, model: this.modelActor },
    });
  }

  pushUser(content: string): void {
    this.messages.push({ role: 'user', content });
    this.humanTurnOrdinal += 1;
    this.toolRoundsSinceLastHuman = 0;
    // Truncate to keep xattr small AND avoid storing huge user messages in
    // every provenance record (full text already lives in JSONL).
    this.lastHumanMessage = content.length > 500 ? content.slice(0, 500) + '…' : content;
    this.bus.publish({
      actor: this.humanActor,
      kind: 'message.user',
      payload: { content },
    });
    void this.memory?.onUserMessage?.(content);
  }

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
      await this.memory?.onAssistantMessage?.({
        content: accumulatedText,
        finishReason,
        toolCalls,
      });

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

      // Bump per-round counter BEFORE handling tool calls so attachProvenance,
      // invoked inside skill handlers, sees the round index of the call it's in.
      // (round 1 = direct response to a human turn; round >= 2 = elaborated)
      this.toolRoundsSinceLastHuman += 1;

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
        await this.memory?.onToolCall?.({
          id: call.id,
          name: call.name,
          argumentsJson: call.argumentsJson,
        });

        let output: string;
        let error: boolean | undefined;
        let blocked: boolean | undefined;

        // Parse args once (needed for both danger check and handler)
        let parsedArgs: Record<string, unknown> = {};
        let parseError: string | null = null;
        try {
          parsedArgs = call.argumentsJson ? JSON.parse(call.argumentsJson) : {};
        } catch (e) {
          parseError = (e as Error).message;
        }

        if (!skill || !skill.handler) {
          output = `error: skill \`${call.name}\` is not executable in this runtime.`;
          error = true;
        } else if (parseError) {
          output = `error: could not parse tool arguments: ${parseError}`;
          error = true;
        } else {
          // Danger guard
          let allowed = true;
          if (this.dangerEngine && this.dangerContext) {
            const ctx: DangerContext = {
              ...this.dangerContext,
              classAPreapprovals: this.classAPreapprovals,
            };
            const verdict = this.dangerEngine.evaluate(
              {
                kind: 'tool-call',
                toolName: skill.frontmatter.name,
                args: parsedArgs,
                cwd: this.cwd,
              },
              ctx,
            );
            if (verdict.decision === 'block') {
              allowed = false;
              output = `[blocked by danger guard] ${verdict.reason}`;
              error = true;
              blocked = true;
              this.bus.publish({
                actor: { kind: 'system', subsystem: 'danger-guard' },
                kind: 'tool.result',
                payload: { id: call.id, name: call.name, blocked: true, reason: verdict.reason },
              });
              yield { kind: 'tool.danger', id: call.id, name: call.name, verdict };
              await this.memory?.onToolDanger?.({
                id: call.id,
                name: call.name,
                decision: 'block',
                headline: verdict.reason,
                ruleIds: [],
              });
            } else if (verdict.decision === 'confirm') {
              yield { kind: 'tool.danger', id: call.id, name: call.name, verdict };
              await this.memory?.onToolDanger?.({
                id: call.id,
                name: call.name,
                decision: 'confirm',
                headline: verdict.headline,
                ruleIds: verdict.hits.map((h) => h.ruleId),
              });
              const decision = this.confirmDanger
                ? await this.confirmDanger({
                    verdict,
                    toolName: skill.frontmatter.name,
                    args: parsedArgs,
                  })
                : { decision: 'deny' as const };
              await this.memory?.onToolApproval?.({
                id: call.id,
                name: call.name,
                decision: decision.decision,
                preapprovedRuleIds:
                  decision.decision === 'allow-and-preapprove' ? decision.ruleIds : undefined,
              });
              if (decision.decision === 'deny') {
                allowed = false;
                output = `[denied by user] ${verdict.headline}`;
                error = true;
                blocked = true;
              } else {
                if (decision.decision === 'allow-and-preapprove') {
                  for (const id of decision.ruleIds) {
                    this.classAPreapprovals[id] = true;
                  }
                }
                this.bus.publish({
                  actor: this.humanActor,
                  kind: 'tool.call',
                  payload: {
                    id: call.id,
                    name: call.name,
                    approval: 'human-approved',
                    preapproved: decision.decision === 'allow-and-preapprove' ? decision.ruleIds : undefined,
                  },
                });
              }
            }
          }

          if (allowed) {
            try {
              const result = await skill.handler(parsedArgs, {
                sessionId: this.id,
                cwd: this.cwd,
                signal,
                attachProvenance: this.buildAttachProvenance(skill.frontmatter.name),
              });
              output = result.output;
              error = result.error;
            } catch (e) {
              output = `skill threw: ${(e as Error).message}`;
              error = true;
            }
          } else {
            output ??= '[blocked]';
          }
        }

        this.appendToolResult(call.id, output!);
        this.bus.publish({
          actor: { kind: 'system', subsystem: 'skill-runtime' },
          kind: 'tool.result',
          payload: { id: call.id, name: call.name, output: output!, error, blocked },
        });
        yield {
          kind: 'tool.result',
          id: call.id,
          name: call.name,
          output: output!,
          error,
          blocked,
        };
        await this.memory?.onToolResult?.({
          id: call.id,
          name: call.name,
          output: output!,
          error,
          blocked,
        });
      }
    }
  }

  private appendToolResult(id: string, output: string): void {
    this.messages.push({ role: 'tool', toolCallId: id, content: output });
  }

  /**
   * Build a per-invocation `attachProvenance` binder bound to the current
   * session state and the calling skill. Returns undefined if provenance
   * config wasn't set (caller skill ctx will see attachProvenance as undef).
   *
   * Autonomy heuristic (v1, see autonomy-heuristic.ts):
   *   - no human message yet                  → model-self-initiated
   *   - >= 2 tool rounds since last human     → model-elaborated
   *   - target basename literally in user msg → human-instructed
   *   - otherwise                             → human-implied
   */
  private buildAttachProvenance(
    skillName: string,
  ): ((absPath: string) => Promise<ProvenanceAttachResult | undefined>) | undefined {
    const cfg = this.provenanceConfig;
    if (!cfg) return undefined;
    const xHarnessHome = cfg.xHarnessHome;
    const ordinal = this.humanTurnOrdinal;
    const lastMsg = this.lastHumanMessage;
    const sessionId = this.id;
    const memory = this.memory;
    const toolRoundsSinceLastHuman = this.toolRoundsSinceLastHuman;
    const hasHumanMessage = ordinal > 0;
    return async (absPath: string): Promise<ProvenanceAttachResult | undefined> => {
      const cls = classifyAutonomy({
        targetPath: absPath,
        lastHumanMessage: lastMsg,
        toolRoundsSinceLastHuman,
        hasHumanMessage,
      });
      const provenance: IntentProvenance = {
        v: 1,
        ts: new Date().toISOString(),
        sessionId,
        originatingHumanMessageSeq: ordinal > 0 ? ordinal : undefined,
        originatingHumanMessage: lastMsg,
        executor: { kind: 'skill', name: skillName },
        autonomy: cls.level,
        autonomyReason: cls.reason,
        sessionTrigger: 'fresh',
        xHarnessHome,
        path: absPath,
      };
      const r = writeAiTouch(provenance);
      await memory?.onProvenanceAttach?.({
        provenance,
        xattrOk: r.ok,
        xattrError: r.error,
      });
      return { ok: r.ok, error: r.error, xattr: r.xattr as unknown as Record<string, unknown> };
    };
  }

  snapshot(): readonly Message[] {
    return this.messages.slice();
  }
}

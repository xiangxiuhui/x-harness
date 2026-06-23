import type { Actor } from './actor.js';

/**
 * Actor bus — every meaningful action is published here.
 *
 * Spiral 1: in-memory only. Spiral 1.5: persist to ~/.x_harness/audit/.
 */

export type ActorEventKind =
  | 'message.user'
  | 'message.assistant.delta'
  | 'message.assistant.done'
  | 'tool.call'
  | 'tool.result'
  | 'session.start'
  | 'session.end'
  | 'error';

export interface ActorEvent {
  id: string;
  ts: number;
  actor: Actor;
  kind: ActorEventKind;
  payload?: unknown;
  parentId?: string;
}

export type ActorEventListener = (e: ActorEvent) => void;

export class ActorBus {
  private listeners: ActorEventListener[] = [];
  private seq = 0;

  publish(ev: Omit<ActorEvent, 'id' | 'ts'>): ActorEvent {
    const full: ActorEvent = {
      id: `${Date.now().toString(36)}-${(this.seq++).toString(36)}`,
      ts: Date.now(),
      ...ev,
    };
    for (const l of this.listeners) {
      try {
        l(full);
      } catch {
        // listener errors must never break the bus
      }
    }
    return full;
  }

  subscribe(l: ActorEventListener): () => void {
    this.listeners.push(l);
    return () => {
      this.listeners = this.listeners.filter((x) => x !== l);
    };
  }
}

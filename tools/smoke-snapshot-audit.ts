/**
 * Internal smoke test: runtime snapshot → ActorBus → JSONL → digest.
 *
 * This is intentionally NOT a user-facing CLI command. It verifies the
 * observability loop without exposing debug snapshot controls in normal chat UX.
 *
 * Run:
 *   pnpm tsx tools/smoke-snapshot-audit.ts
 */

import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChatChunk, ChatRequest, Provider } from '../packages/provider/src/index.js';
import { Session, actorEventDurability, type ActorEvent } from '../packages/core/src/index.js';
import { MemoryStore, readSession, digestEntry } from '../packages/memory/src/index.js';

class FakeProvider implements Provider {
  readonly name = 'fake';
  readonly defaultModel = 'fake-1';
  async *chat(_req: ChatRequest, _signal?: AbortSignal): AsyncIterable<ChatChunk> {
    throw new Error('smoke-snapshot-audit should not call provider.chat');
  }
}

function assert(cond: boolean, message: string): void {
  if (!cond) throw new Error(message);
}

async function main(): Promise<void> {
  const home = mkdtempSync(join(tmpdir(), 'xh-snapshot-audit-'));
  try {
    const sessionId = 'sess-smoke-snapshot';
    const store = await MemoryStore.open({
      home,
      sessionId,
      cwd: process.cwd(),
      userId: 'smoke',
      model: { provider: 'fake', model: 'fake-1' },
    });

    await store.append({
      actor: { kind: 'system', subsystem: 'session' },
      kind: 'session.start',
      payload: {
        sessionId,
        model: { provider: 'fake', model: 'fake-1' },
        cwd: process.cwd(),
        xHarnessHome: home,
      },
    });

    const session = new Session({
      provider: new FakeProvider(),
      humanUserId: 'smoke',
      humanSurface: 'test',
      systemPrompt: 'You are a snapshot smoke test.',
      sessionId,
      provenance: { xHarnessHome: home },
      memory: {
        onSystemPrompt: (content) =>
          store.append({
            actor: { kind: 'system', subsystem: 'session' },
            kind: 'system.message',
            payload: { content },
          }),
      },
    });

    session.bus.subscribe((ev: ActorEvent) => {
      if (actorEventDurability(ev.kind) !== 'audit') return;
      if (ev.kind === 'context.snapshot.persisted') {
        const payload = ev.payload as {
          sessionId: string;
          path: string;
          messageCount: number;
          estimatedTokens: number;
          pendingToolCalls: number;
          compactionCount: number;
        };
        void store.append({
          actor: { kind: 'system', subsystem: 'snapshot' },
          kind: 'context.snapshot.persisted',
          ts: new Date(ev.ts).toISOString(),
          payload,
        });
      }
    });

    const path = await session.persistSnapshot();
    assert(path !== null, 'snapshot path should be returned');
    assert(existsSync(path), `snapshot file should exist: ${path}`);

    // Give fire-and-forget MemoryStore append from bus subscriber a microtask turn.
    await new Promise((resolve) => setTimeout(resolve, 20));
    await store.close('bye', 0);

    const entries = await readSession(home, sessionId);
    const snapshotEntry = entries.find((e) => e.kind === 'context.snapshot.persisted');
    assert(snapshotEntry !== undefined, 'JSONL should contain context.snapshot.persisted');

    const digest = snapshotEntry ? digestEntry(snapshotEntry) : '';
    assert(digest.includes('snapshot persisted'), `digest should mention snapshot persisted: ${digest}`);

    const fileContent = readFileSync(path, 'utf8');
    assert(fileContent.includes('"messageCount"'), 'snapshot JSON should contain metadata envelope');

    console.log('snapshot audit smoke passed');
    console.log(`  home=${home}`);
    console.log(`  session=${sessionId}`);
    console.log(`  snapshot=${path}`);
    console.log(`  digest=${digest}`);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : String(err));
  process.exit(1);
});

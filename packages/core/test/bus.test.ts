/**
 * Event observability routing tests.
 *
 * Run with: pnpm tsx packages/core/test/bus.test.ts
 */

import { ActorBus, actorEventDurability } from '../src/bus.js';

let pass = 0;
let fail = 0;
const failures: string[] = [];
function ok(name: string, cond: boolean, detail?: string): void {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    failures.push(detail ? `${name} :: ${detail}` : name);
    console.log(`  ✗ ${name}${detail ? ' :: ' + detail : ''}`);
  }
}

console.log('\n1. ActorBus assigns stable event ids');
{
  const bus = new ActorBus();
  const events: string[] = [];
  bus.subscribe((ev) => events.push(ev.id));
  const first = bus.publish({
    actor: { kind: 'system', subsystem: 'test' },
    kind: 'error',
    payload: { where: 'test', message: 'first' },
  });
  const second = bus.publish({
    actor: { kind: 'system', subsystem: 'test' },
    kind: 'error',
    payload: { where: 'test', message: 'second' },
  });
  ok('returned id is non-empty', first.id.length > 0 && second.id.length > 0);
  ok('ids are distinct', first.id !== second.id, `${first.id} vs ${second.id}`);
  ok('listeners see assigned ids', events.length === 2 && events[0] === first.id && events[1] === second.id);
}

console.log('\n2. Event durability classifier');
{
  ok('context.compacted is audit', actorEventDurability('context.compacted') === 'audit');
  ok('context.snapshot.persisted is audit', actorEventDurability('context.snapshot.persisted') === 'audit');
  ok('error is audit', actorEventDurability('error') === 'audit');
  ok('assistant delta is ephemeral', actorEventDurability('message.assistant.delta') === 'ephemeral');
  ok('tool.result avoids generic bridge double-write', actorEventDurability('tool.result') === 'ephemeral');
}

if (fail > 0) {
  console.error(`\n${fail} failed`);
  for (const f of failures) console.error(` - ${f}`);
  process.exit(1);
}
console.log(`\n${pass} passed, 0 failed`);

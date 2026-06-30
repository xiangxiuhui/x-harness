/**
 * @x_harness/core — orchestration, actor bus, sessions.
 *
 * Spiral 1 scope:
 *   - Actor types + actor bus (in-memory)
 *   - Session with streaming chat (single-turn for now; multi-turn already works
 *     because Session keeps messages[]).
 *   - No tool dispatching yet (next sub-step).
 */

export * from './actor.js';
export * from './session.js';
export * from './bus.js';
export * from './territory.js';
export * from './compaction/index.js';
export * from './config.js';

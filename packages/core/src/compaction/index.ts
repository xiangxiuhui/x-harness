/**
 * @x_harness/core — compaction
 *
 * ADR-0013 Step 1: pure-function building blocks.
 *
 * These functions are intentionally:
 *   - dep-free (no provider, no fs, no actor bus)
 *   - synchronous when possible
 *   - testable via tsx without any harness
 *
 * `compactIfNeeded()` (the entry point that calls a summarizer LLM) lives in
 * `compact.ts` and is the only async piece. Everything else here is a building
 * block.
 *
 * See:
 *   - docs/decisions/0013-compaction-strategy.md  (decisions encoded below)
 *   - docs/decisions/0014-context-epoch-type-system.md  (next-step migration)
 */

export * from './types.js';
export * from './token-estimator.js';
export * from './tool-output.js';
export * from './pair-tool-calls.js';
export * from './compact.js';
export * from './provider-summarizer.js';
export * from './tiktoken-adapter.js';

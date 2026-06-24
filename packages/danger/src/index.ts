/**
 * @x_harness/danger — Danger guard (ADR 0005).
 *
 * Pure rule engine. Decides whether a proposed action is dangerous and
 * (if so) why. Does NOT do UI / blocking by itself — that's the harness'
 * job; this package only classifies.
 */

export * from './types.js';
export * from './rules.js';
export * from './engine.js';
export * from './shell-parse.js';

/**
 * @x_harness/memory — append-only event log per session.
 *
 * Spiral 1 scope:
 *   - JSONL files at <home>/memory/<sessionId>.jsonl
 *   - One entry per event; actor-tagged (ADR-0002 §"actor 一等公民")
 *   - Index file <home>/memory/index.jsonl with one line per session header
 *   - Load: read back into Message[] for `--resume`
 *
 * Out of scope (spiral 2+):
 *   - summarization, embedding, retrieval, vacuum, encrypted-at-rest
 */
export * from './types.js';
export * from './store.js';
export * from './replay.js';
export * from './grep.js';
export * from './feedback.js';

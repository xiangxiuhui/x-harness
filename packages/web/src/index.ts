/**
 * @x_harness/web — local-only HTTP read-side projection of harness state.
 *
 * Design rules (Surface Parity, ADR-0011):
 *   - SINGLE SOURCE OF TRUTH = JSONL on disk + territory.yaml + skill files.
 *   - Web is purely a renderer of those. It does NOT introduce concepts the
 *     CLI does not have. Anything visible here must have a CLI equivalent.
 *   - Zero external runtime deps (Node stdlib only). The OS project owns its
 *     own HTTP / SSE plumbing.
 *   - Bind 127.0.0.1 only — never expose to LAN by default.
 *
 * V0 (this commit): READ-ONLY.
 *   GET /api/health                 → { ok, home, version }
 *   GET /api/sessions               → SessionIndexEntry[]
 *   GET /api/sessions/:id           → { entries: MemoryEntry[] }
 *   GET /api/sessions/:id/tail      → SSE stream of new entries (live tail)
 *   GET /api/territory              → { path, raw, version, zonePaths, generatedDefault }
 *   GET /api/skills                 → SkillSummary[]
 *   GET /                           → SPA shell (public/index.html)
 *   GET /static/*                   → static asset
 *
 * Out of scope here, deliberately:
 *   - POST /api/chat (sending messages from web). v1.
 *   - tool-approval over web. v1.
 *   - auth. v0 binds 127.0.0.1; auth is "your $USER owns this socket".
 */
export * from './server.js';

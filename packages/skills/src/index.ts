/**
 * @x_harness/skills — Skill / Plugin runtime (ADR-0006).
 *
 * Spiral 1 scope:
 *   - parse SKILL.md (frontmatter + body)
 *   - load from three sources (builtin, user, project)
 *   - expose builtin skills as executable handlers
 *   - convert to provider ToolSpec for tool-calling
 *
 * Out of scope (later spirals):
 *   - executable user/project skills (need script runtime decision)
 *   - commands/ agents/ hooks/ .mcp.json
 */

export * from './types.js';
export * from './frontmatter.js';
export * from './loader.js';
export * from './builtin/index.js';
export * from './registry.js';

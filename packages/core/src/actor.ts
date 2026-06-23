/**
 * Actor model — see docs/vision.md §3 and docs/architecture.md §4.
 *
 * Every action in x_harness must be attributable to one of:
 *   - `human`  — the user, via some surface
 *   - `model`  — an LLM-driven decision
 *   - `system` — x_harness itself (scheduler, bookkeeping, ...)
 */

export type HumanSurface =
  | 'cli'
  | 'ui'
  | 'voice'
  | 'browser-ext'
  | 'system-app'
  | 'other';

export type Actor =
  | { kind: 'human'; userId: string; surface: HumanSurface }
  | { kind: 'model'; provider: string; model: string; sessionId: string }
  | { kind: 'system'; subsystem: string };

export function fmtActor(a: Actor): string {
  switch (a.kind) {
    case 'human':
      return `human:${a.userId}@${a.surface}`;
    case 'model':
      return `model:${a.provider}/${a.model}`;
    case 'system':
      return `system:${a.subsystem}`;
  }
}

/** Short colored badge for terminals; UI layer can render its own. */
export function actorBadge(a: Actor): string {
  // ANSI: 36=cyan (human), 35=magenta (model), 90=grey (system)
  const c =
    a.kind === 'human' ? '\x1b[36m' : a.kind === 'model' ? '\x1b[35m' : '\x1b[90m';
  const reset = '\x1b[0m';
  return `${c}[${fmtActor(a)}]${reset}`;
}

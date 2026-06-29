/**
 * autonomy-heuristic — classify an action's autonomy level given session
 * context, without semantic NLU.
 *
 * Ladder (ADR-0009):
 *   - human-instructed:    user literally named the action/target
 *   - human-implied:       user named the goal; model picked the action
 *   - model-elaborated:    deep inside a model-decomposed plan
 *   - model-self-initiated: idle / scheduled / no recent human input
 *
 * v1 heuristic (safe defaults — bias toward the lower autonomy level,
 *               because over-claiming "human-instructed" is worse than
 *               under-claiming it for evolution-queue ranking):
 *
 *   1. No recent human message               → model-self-initiated
 *   2. Many model tool-rounds since human    → model-elaborated
 *   3. Target basename literally in user msg → human-instructed
 *   4. otherwise                             → human-implied
 *
 * Tunables live as named constants for v2 tuning without changing call sites.
 */

import { basename } from 'node:path';
import type { Autonomy } from '@x_harness/provenance';

/** When the model has issued >= this many tool rounds since the last human
 *  message, treat new actions as model-elaborated, not human-implied. */
export const MODEL_ELABORATED_ROUND_THRESHOLD = 2;

/** Minimum length for a basename to qualify as "literally named" — single
 *  chars like 'a' would false-match. */
export const MIN_BASENAME_LITERAL_LENGTH = 3;

export interface AutonomyInput {
  /** The action target. Pass undefined if action has no path (e.g. shell-only). */
  targetPath?: string;
  /** Last human message in this session, if any. */
  lastHumanMessage?: string;
  /** How many tool rounds the model has issued since the last human turn. */
  toolRoundsSinceLastHuman: number;
  /** True if there is at least one human message in the session. */
  hasHumanMessage: boolean;
}

export interface AutonomyResult {
  level: Autonomy;
  /** Why we picked this level (short, audit-grade). */
  reason: string;
}

export function classifyAutonomy(input: AutonomyInput): AutonomyResult {
  if (!input.hasHumanMessage) {
    return { level: 'model-self-initiated', reason: 'no human message in session' };
  }

  // Deep into a model plan — even if a human message exists, this action is
  // many steps removed from it.
  if (input.toolRoundsSinceLastHuman >= MODEL_ELABORATED_ROUND_THRESHOLD) {
    return {
      level: 'model-elaborated',
      reason: `${input.toolRoundsSinceLastHuman} tool rounds since last human turn (>= ${MODEL_ELABORATED_ROUND_THRESHOLD})`,
    };
  }

  // Try human-instructed: did the user literally name the target?
  if (input.targetPath && input.lastHumanMessage) {
    const lit = literalTargetMatch(input.targetPath, input.lastHumanMessage);
    if (lit) {
      return { level: 'human-instructed', reason: `user named "${lit}"` };
    }
  }

  return { level: 'human-implied', reason: 'recent human turn, target not literally named' };
}

/**
 * Returns the substring from `humanMsg` that literally names the action's
 * target, or undefined. We're deliberately conservative:
 *
 *   - basename(target) must appear verbatim (case-sensitive — paths usually
 *     are case-sensitive on the user's filesystem and we don't want
 *     'README.md' to match a casual "readme" mention)
 *   - basename must be >= MIN_BASENAME_LITERAL_LENGTH chars
 *
 * For path-with-extension (foo.txt), the bare-name (foo) is also tried as
 * a fallback: "create a foo file" → human named "foo".
 */
function literalTargetMatch(targetPath: string, humanMsg: string): string | undefined {
  const bn = basename(targetPath);
  if (bn.length >= MIN_BASENAME_LITERAL_LENGTH && humanMsg.includes(bn)) {
    return bn;
  }
  // Try basename without trailing extension(s): "foo.tar.gz" → "foo"
  const dotIdx = bn.indexOf('.');
  if (dotIdx > 0) {
    const stem = bn.slice(0, dotIdx);
    if (stem.length >= MIN_BASENAME_LITERAL_LENGTH && humanMsg.includes(stem)) {
      return stem;
    }
  }
  return undefined;
}

import type {
  DangerContext,
  DangerRule,
  DangerVerdict,
  ProposedAction,
  RuleHit,
} from './types.js';
import { DEFAULT_RULES } from './rules.js';

export interface DangerEngineOptions {
  rules?: ReadonlyArray<DangerRule>;
  /**
   * Class-A category pre-approvals from this session (e.g. user said
   * "yes, you may use my deepseek balance"). These do NOT cross sessions.
   */
  classAPreapprovals?: Record<string, boolean>;
}

export class DangerEngine {
  private readonly rules: ReadonlyArray<DangerRule>;

  constructor(opts: DangerEngineOptions = {}) {
    this.rules = opts.rules ?? DEFAULT_RULES;
  }

  /**
   * Evaluate an action. Pure function modulo ctx. No I/O.
   */
  evaluate(action: ProposedAction, ctx: DangerContext): DangerVerdict {
    const hits: RuleHit[] = [];
    for (const r of this.rules) {
      const got = r.check(action, ctx);
      if (!got) continue;
      const arr = Array.isArray(got) ? got : [got];
      for (const h of arr) {
        // attach recoverable flag for Class B if any matching recovery skill registered
        if (h.class === 'B' && r.recoverableBy && r.recoverableBy.length > 0) {
          const matched = r.recoverableBy.some((n) => ctx.recoverSkillNames.includes(n));
          if (matched) h.recoverable = true;
        }
        hits.push(h);
      }
    }

    // Class B hits are suppressed if every one of them is `recoverable`.
    const effective = hits.filter((h) => !(h.class === 'B' && h.recoverable));
    if (effective.length === 0) {
      return { decision: 'allow' };
    }

    // Pre-approval for Class A categories. Currently coarse-grained: a single
    // boolean per rule id. Rules can be extended to emit `category` later.
    const remaining = effective.filter((h) => {
      if (h.class !== 'A') return true;
      const preApproved = ctx.classAPreapprovals[h.ruleId];
      return !preApproved;
    });
    if (remaining.length === 0) return { decision: 'allow' };

    // Pre-approval for Class B path prefixes. If every Class B hit's target
    // path (in evidence.path) falls under a pre-approved prefix, those hits
    // are suppressed. This is the mechanism for session-level "I trust writes
    // to this directory" consent (e.g. skill authoring sessions).
    const remaining2 = remaining.filter((h) => {
      if (h.class !== 'B') return true;
      const targetPath = String(h.evidence?.path ?? '');
      if (!targetPath) return true; // can't check without a path
      return !ctx.classBPathPreapprovals.some((prefix) => targetPath.startsWith(prefix));
    });
    if (remaining2.length === 0) return { decision: 'allow' };

    const classes = new Set(remaining2.map((h) => h.class));
    const headline =
      classes.has('A') && classes.has('B')
        ? 'Action hits Class A (human account/financial) AND Class B (x_harness self-preservation).'
        : classes.has('A')
          ? 'Action hits Class A (human account / financial).'
          : 'Action hits Class B (x_harness self-preservation).';

    const explanation = remaining2.map((h) => `[${h.class}/${h.ruleId}] ${h.reason}`);
    const recoveryHints: string[] = [];
    for (const h of remaining2) {
      if (h.class !== 'B') continue;
      // Find matching rule
      const r = this.rules.find((rr) => rr.id === h.ruleId);
      if (r?.recoverableBy && r.recoverableBy.length > 0) {
        recoveryHints.push(
          `${h.ruleId}: would be auto-allowed if any of these recover-skills were installed: ${r.recoverableBy.join(', ')}`,
        );
      }
    }

    return {
      decision: 'confirm',
      hits: remaining2,
      headline,
      explanation,
      recoveryHints: recoveryHints.length > 0 ? recoveryHints : undefined,
    };
  }

  /** Append/replace rules without mutating an existing engine. */
  withExtraRules(extra: ReadonlyArray<DangerRule>): DangerEngine {
    return new DangerEngine({ rules: [...this.rules, ...extra] });
  }
}

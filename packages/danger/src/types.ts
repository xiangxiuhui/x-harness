/** Danger classes from ADR 0005. */
export type DangerClass = 'A' | 'B';

/**
 * The proposed action handed to the danger engine.
 *
 * Spiral 1 fills `kind: 'tool-call'`. Future: `kind: 'raw-fs'`, `kind: 'raw-net'`,
 * etc. when we ever bypass tools.
 */
export type ProposedAction =
  | {
      kind: 'tool-call';
      /** Skill name as registered (e.g. 'shell.run'). */
      toolName: string;
      /** Parsed arguments object. */
      args: Record<string, unknown>;
      /** Optional sticky context: the human's stated cwd (so rules can normalize paths). */
      cwd?: string;
    }
  | {
      kind: 'raw-fs';
      op: 'write' | 'delete';
      paths: string[];
    };

export type DangerVerdict =
  | { decision: 'allow' }
  | { decision: 'block'; reason: string; hits: RuleHit[] }
  | {
      decision: 'confirm';
      hits: RuleHit[];
      /** Concise headline shown to the human first. */
      headline: string;
      /** Longer explanation, one line per concern. */
      explanation: string[];
      /** Recovery hints when class B — what would be needed to undo. */
      recoveryHints?: string[];
    };

export interface RuleHit {
  ruleId: string;
  class: DangerClass;
  /** Short reason ("self preservation: writing under ~/.x_harness") */
  reason: string;
  /** Optional extra info (e.g. matched path, matched account scope). */
  evidence?: Record<string, unknown>;
  /** True if a registered recover.* skill could undo this; suppresses Class B. */
  recoverable?: boolean;
}

/**
 * Context the engine needs to evaluate rules. Filled by the harness at session
 * boot — NOT by skill code.
 */
export interface DangerContext {
  /** Absolute path of x_harness home (default ~/.x_harness). */
  xHarnessHome: string;
  /** Repo root (workspace), for rules that need to know "where am I running from". */
  repoRoot?: string;
  /** PIDs of the current x_harness process tree (for self-kill detection). */
  selfPids: ReadonlyArray<number>;
  /** Provider host names whose hosts-file shadowing would kill us. */
  providerHosts: ReadonlyArray<string>;
  /** Keychain entry prefixes we own (e.g. ['com.x_harness']). */
  keychainPrefixes: ReadonlyArray<string>;
  /** Env-var prefixes we own. */
  envPrefixes: ReadonlyArray<string>;
  /** Pre-approved Class-A categories for this session ({ payment: true, ... }). */
  classAPreapprovals: Readonly<Record<string, boolean>>;
  /** Names of skills available that could recover specific side-effects. */
  recoverSkillNames: ReadonlyArray<string>;
}

export function defaultDangerContext(over: Partial<DangerContext> = {}): DangerContext {
  return {
    xHarnessHome: over.xHarnessHome ?? '',
    repoRoot: over.repoRoot,
    selfPids: over.selfPids ?? [],
    providerHosts: over.providerHosts ?? ['api.deepseek.com'],
    keychainPrefixes: over.keychainPrefixes ?? ['com.x_harness.'],
    envPrefixes: over.envPrefixes ?? ['X_HARNESS_'],
    classAPreapprovals: over.classAPreapprovals ?? {},
    recoverSkillNames: over.recoverSkillNames ?? [],
  };
}

/** A rule sees (action, ctx) and returns 0+ hits. */
export interface DangerRule {
  id: string;
  class: DangerClass;
  describe: string;
  /** Recovery skills that, if present in ctx.recoverSkillNames, mark this hit recoverable. */
  recoverableBy?: ReadonlyArray<string>;
  check(action: ProposedAction, ctx: DangerContext): RuleHit[] | RuleHit | null;
}

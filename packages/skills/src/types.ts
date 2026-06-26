import type { ToolSpec } from '@x_harness/provider';

/** ADR 0005 — danger classes attached to a skill. */
export type DangerClass = 'none' | 'A' | 'B' | 'both';

/** ADR 0006 — actor that can invoke a skill. */
export type SkillActorRequirement = 'model' | 'human' | 'any';

/** ADR 0007 — script runtime for on-disk skills. */
export type SkillRuntime = 'node-ts' | 'node-js' | 'sh' | 'python' | 'auto';

/** Frontmatter of SKILL.md (typed view; loose fields are passed through). */
export interface SkillFrontmatter {
  name: string;
  description: string;
  version?: string;
  author?: string;
  license?: string;
  platforms?: string[];
  /** JSON schema for inputs. Optional in ADR-0006 spiral 1. */
  parameters?: Record<string, unknown>;
  /** x_harness-specific extensions. */
  metadata?: {
    x_harness?: {
      actor_required?: SkillActorRequirement;
      danger_class?: DangerClass;
      side_effects?: string[];
      tags?: string[];
      related_skills?: string[];
      /** ADR-0008 — opt-in: expose this skill as a tool wrapper using the
       *  ADR-0007 stdio runtime. Default false (skill = doc-only, model
       *  uses bash/file tools to read/run it). */
      expose_as_tool?: boolean;
      /** ADR-0007 — on-disk skill runtime. */
      runtime?: SkillRuntime;
      /** Relative path to the handler script. Default: handler.<ext> auto-detect. */
      entrypoint?: string;
      /** Max wall-clock for one call (ms). Default: 60000. Hard cap: 5min. */
      timeout_ms?: number;
    };
    /** other namespaces (claude-code, hermes, ...) pass through. */
    [ns: string]: unknown;
  };
  /** Pass-through for unknown top-level fields. */
  [extra: string]: unknown;
}

export type SkillSource = 'builtin' | 'user' | 'project';

export interface ParsedSkill {
  frontmatter: SkillFrontmatter;
  body: string;
  source: SkillSource;
  /** Directory path of the skill (where SKILL.md lives). May be virtual for builtins. */
  dir: string;
}

/** Runtime handler — only builtin skills have one in spiral 1. */
export type SkillHandler = (
  args: Record<string, unknown>,
  ctx: SkillContext,
) => Promise<SkillResult>;

export interface SkillContext {
  sessionId: string;
  /** Absolute path of the user's cwd. */
  cwd: string;
  /** Abort signal — for shell.run-like long ops. */
  signal?: AbortSignal;
  /**
   * Attach AI-touch provenance (ADR-0009) to a path the skill just wrote.
   *
   * Skills that mutate the filesystem (file.write, file.edit, future
   * file.move, etc.) MUST call this after a successful write and BEFORE
   * returning to the model. It writes the xattr AND emits the
   * `provenance.attach` JSONL entry. Failure to attach (e.g. fs without
   * xattr support) is logged but non-fatal.
   *
   * Skills that only read should NOT call this.
   *
   * Returns the structured provenance record (or undefined if the runtime
   * has no provenance binder wired — e.g. unit tests).
   */
  attachProvenance?: (absPath: string) => Promise<ProvenanceAttachResult | undefined>;
}

/** Mirror of what `attachProvenance` returns so callers can include in meta. */
export interface ProvenanceAttachResult {
  ok: boolean;
  error?: string;
  /** The compact form actually written to xattr. */
  xattr: Record<string, unknown>;
}

export interface SkillResult {
  /** Plain text the model will see as tool result content. */
  output: string;
  /** True when the skill considered itself failed (still returned, but flagged). */
  error?: boolean;
  /** Optional structured metadata for the actor bus / audit log. */
  meta?: Record<string, unknown>;
}

/** Full skill descriptor combining parsed metadata + (optional) executable handler. */
export interface Skill extends ParsedSkill {
  /** When present, this skill can be executed; absent for non-builtin in spiral 1. */
  handler?: SkillHandler;
}

/** Convert a Skill to the provider's tool spec. */
export function skillToToolSpec(s: Skill): ToolSpec {
  return {
    name: normalizeToolName(s.frontmatter.name),
    description: s.frontmatter.description,
    parameters:
      (s.frontmatter.parameters as Record<string, unknown>) ?? {
        type: 'object',
        properties: {},
        additionalProperties: true,
      },
  };
}

/**
 * Provider tool names usually disallow `.` / `/` — collapse to `_`.
 * We preserve the original name on the Skill for human display.
 */
export function normalizeToolName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]+/g, '_');
}

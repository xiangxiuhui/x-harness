import type { ToolSpec } from '@x_harness/provider';
import { BUILTIN_SKILLS } from './builtin/index.js';
import { loadAllSkillFiles, defaultSkillSources, type SkillSources } from './loader.js';
import { normalizeToolName, skillToToolSpec, type Skill } from './types.js';
import { withOnDiskHandler } from './runtime/exec-on-disk.js';

/**
 * SkillRegistry — the runtime collection of skills for a session.
 *
 * Layering (later sources override earlier ones):
 *   1. builtin (in-code)
 *   2. user      ~/.x_harness/skills/
 *   3. project   <repo>/.x_harness/skills/
 */
export class SkillRegistry {
  private byName = new Map<string, Skill>();
  /** name as seen by provider (sanitized) -> original name */
  private byToolName = new Map<string, string>();

  constructor(skills: readonly Skill[] = []) {
    for (const s of skills) this.add(s);
  }

  add(s: Skill): void {
    this.byName.set(s.frontmatter.name, s);
    this.byToolName.set(normalizeToolName(s.frontmatter.name), s.frontmatter.name);
  }

  has(name: string): boolean {
    return this.byName.has(name) || this.byToolName.has(name);
  }

  get(name: string): Skill | undefined {
    const direct = this.byName.get(name);
    if (direct) return direct;
    const original = this.byToolName.get(name);
    return original ? this.byName.get(original) : undefined;
  }

  list(): Skill[] {
    return Array.from(this.byName.values());
  }

  /** Only skills that have an executable handler (spiral 1: only builtins). */
  executable(): Skill[] {
    return this.list().filter((s) => typeof s.handler === 'function');
  }

  toolSpecs(): ToolSpec[] {
    return this.executable().map(skillToToolSpec);
  }
}

export interface BuildRegistryOptions extends SkillSources {
  /** Set to false to skip builtins (mostly for testing). */
  includeBuiltin?: boolean;
  /** Repo root for project-scoped skills. */
  repoRoot?: string;
}

/** Build a registry from builtins + on-disk sources. */
export function buildSkillRegistry(opts: BuildRegistryOptions = {}): SkillRegistry {
  const reg = new SkillRegistry();
  if (opts.includeBuiltin !== false) {
    for (const s of BUILTIN_SKILLS) reg.add(s);
  }
  const sources: SkillSources = {
    builtinDir: opts.builtinDir,
    userDir: opts.userDir ?? defaultSkillSources(opts.repoRoot).userDir,
    projectDir: opts.projectDir ?? defaultSkillSources(opts.repoRoot).projectDir,
  };
  for (const parsed of loadAllSkillFiles(sources)) {
    // On-disk skills can declare a runtime (ADR-0007) and get an executable
    // handler via the wrapper. If no script is present, the skill stays
    // displayed-only.
    reg.add(withOnDiskHandler(parsed));
  }
  return reg;
}

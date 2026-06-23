import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { parseFrontmatter } from './frontmatter.js';
import type { ParsedSkill, SkillSource } from './types.js';

/**
 * Load skills from one directory. Returns one ParsedSkill per immediate
 * subdirectory that contains a `SKILL.md`.
 */
export function loadSkillsFromDir(
  dir: string,
  source: SkillSource,
): ParsedSkill[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const out: ParsedSkill[] = [];
  for (const name of entries) {
    const sub = join(dir, name);
    let isDir = false;
    try {
      isDir = statSync(sub).isDirectory();
    } catch {
      continue;
    }
    if (!isDir) continue;
    const skillFile = join(sub, 'SKILL.md');
    let text: string;
    try {
      text = readFileSync(skillFile, 'utf8');
    } catch {
      continue;
    }
    const { frontmatter, body } = parseFrontmatter(text);
    if (!frontmatter.name) frontmatter.name = name; // fall back to directory
    if (!frontmatter.description) frontmatter.description = '(no description)';
    out.push({ frontmatter, body, source, dir: sub });
  }
  return out;
}

/**
 * Standard locations for spiral 1. Override with $X_HARNESS_SKILLS_DIR for tests.
 */
export interface SkillSources {
  builtinDir?: string;
  userDir?: string;
  projectDir?: string;
}

export function defaultSkillSources(repoRoot?: string): Required<SkillSources> {
  return {
    builtinDir: process.env.X_HARNESS_BUILTIN_SKILLS_DIR ?? '',
    userDir: join(homedir(), '.x_harness', 'skills'),
    projectDir: repoRoot ? join(repoRoot, '.x_harness', 'skills') : '',
  };
}

/** Merge by name; later sources override earlier ones (per ADR-0006). */
export function loadAllSkillFiles(srcs: SkillSources): ParsedSkill[] {
  const ordered: Array<[string | undefined, SkillSource]> = [
    [srcs.builtinDir, 'builtin'],
    [srcs.userDir, 'user'],
    [srcs.projectDir, 'project'],
  ];
  const map = new Map<string, ParsedSkill>();
  for (const [dir, source] of ordered) {
    if (!dir) continue;
    for (const s of loadSkillsFromDir(dir, source)) {
      map.set(s.frontmatter.name, s);
    }
  }
  return Array.from(map.values());
}

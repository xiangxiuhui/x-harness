/**
 * Builtin skills — defined in code (not on disk) for spiral 1.
 *
 * Each builtin contributes:
 *   - a Skill object with frontmatter (for ToolSpec generation) + body (system
 *     prompt fragment shown to the model)
 *   - a SkillHandler
 *
 * They are registered into the SkillRegistry alongside loaded user/project skills.
 */

import type { Skill } from '../types.js';
import { shellRun } from './shell-run.js';
import { fileRead } from './file-read.js';
import { fileWrite } from './file-write.js';
import { webFetch } from './web-fetch.js';

export const BUILTIN_SKILLS: readonly Skill[] = [
  shellRun,
  fileRead,
  fileWrite,
  webFetch,
];

export { shellRun, fileRead, fileWrite, webFetch };

import { promises as fs } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import type { Skill, SkillHandler } from '../types.js';

const handler: SkillHandler = async (args, ctx) => {
  const path = typeof args.path === 'string' ? args.path : '';
  const content = typeof args.content === 'string' ? args.content : '';
  const mode = args.mode === 'append' ? 'append' : 'overwrite';
  if (!path) return { output: 'error: `path` is required.', error: true };
  const full = isAbsolute(path) ? path : resolve(ctx.cwd, path);
  try {
    await fs.mkdir(dirname(full), { recursive: true });
    if (mode === 'append') {
      await fs.appendFile(full, content, 'utf8');
    } else {
      await fs.writeFile(full, content, 'utf8');
    }
    const stat = await fs.stat(full);
    // ADR-0009 — mark the file with AI-touch provenance (xattr + JSONL).
    const prov = await ctx.attachProvenance?.(full);
    return {
      output: `wrote ${stat.size} bytes to ${full} (mode=${mode})`,
      meta: { full, size: stat.size, mode, provenance: prov },
    };
  } catch (e) {
    return { output: `error writing ${full}: ${(e as Error).message}`, error: true };
  }
};

export const fileWrite: Skill = {
  source: 'builtin',
  dir: '<builtin:file.write>',
  body:
    '# file.write\n\nWrite a text file. Creates parent directories. ' +
    'Default mode overwrites; pass `mode: "append"` to append.',
  frontmatter: {
    name: 'file.write',
    description:
      'Write a text file to disk (creates parent dirs). Modes: overwrite (default), append.',
    version: '0.1.0',
    author: 'x_harness',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute or session-cwd-relative path.' },
        content: { type: 'string', description: 'Text content to write.' },
        mode: {
          type: 'string',
          enum: ['overwrite', 'append'],
          description: 'Write mode (default overwrite).',
        },
      },
      required: ['path', 'content'],
      additionalProperties: false,
    },
    metadata: {
      x_harness: {
        actor_required: 'model',
        danger_class: 'B',
        side_effects: ['filesystem'],
        tags: ['file', 'write'],
      },
    },
  },
  handler,
};

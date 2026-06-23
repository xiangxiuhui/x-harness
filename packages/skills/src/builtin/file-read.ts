import { promises as fs } from 'node:fs';
import { resolve, isAbsolute } from 'node:path';
import type { Skill, SkillHandler } from '../types.js';

const handler: SkillHandler = async (args, ctx) => {
  const path = typeof args.path === 'string' ? args.path : '';
  if (!path) return { output: 'error: `path` is required.', error: true };
  const full = isAbsolute(path) ? path : resolve(ctx.cwd, path);
  const maxBytes =
    typeof args.max_bytes === 'number' && args.max_bytes > 0
      ? Math.min(args.max_bytes, 256 * 1024)
      : 64 * 1024;
  try {
    const stat = await fs.stat(full);
    if (!stat.isFile()) {
      return { output: `error: not a regular file: ${full}`, error: true };
    }
    const fh = await fs.open(full, 'r');
    try {
      const size = stat.size;
      const toRead = Math.min(size, maxBytes);
      const buf = Buffer.alloc(toRead);
      await fh.read(buf, 0, toRead, 0);
      const truncated = size > toRead;
      const header = `path: ${full}\nsize: ${size} bytes${truncated ? ` (truncated to ${toRead})` : ''}\n--- content ---\n`;
      return { output: header + buf.toString('utf8'), meta: { full, size } };
    } finally {
      await fh.close();
    }
  } catch (e) {
    return { output: `error reading ${full}: ${(e as Error).message}`, error: true };
  }
};

export const fileRead: Skill = {
  source: 'builtin',
  dir: '<builtin:file.read>',
  body: '# file.read\n\nRead a text file from disk. Default cap 64KB; max 256KB.',
  frontmatter: {
    name: 'file.read',
    description: 'Read a text file from disk. Returns up to 64KB by default.',
    version: '0.1.0',
    author: 'x_harness',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute or session-cwd-relative path.' },
        max_bytes: {
          type: 'integer',
          description: 'Optional byte cap (default 65536, max 262144).',
        },
      },
      required: ['path'],
      additionalProperties: false,
    },
    metadata: {
      x_harness: {
        actor_required: 'model',
        danger_class: 'none',
        side_effects: ['filesystem'],
        tags: ['file', 'read'],
      },
    },
  },
  handler,
};

import { spawn } from 'node:child_process';
import type { Skill, SkillHandler } from '../types.js';

const handler: SkillHandler = async (args, ctx) => {
  const cmd = typeof args.command === 'string' ? args.command : '';
  const cwd = typeof args.cwd === 'string' ? args.cwd : ctx.cwd;
  const timeoutMs =
    typeof args.timeout_ms === 'number' && args.timeout_ms > 0
      ? Math.min(args.timeout_ms, 5 * 60 * 1000)
      : 60_000;

  if (!cmd) {
    return { output: 'error: `command` is required.', error: true };
  }

  return new Promise((resolve) => {
    const proc = spawn('/bin/sh', ['-lc', cmd], {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let out = '';
    let err = '';
    let truncated = false;
    const cap = 64 * 1024;

    const append = (buf: string, chunk: Buffer): string => {
      if (buf.length >= cap) {
        truncated = true;
        return buf;
      }
      const s = chunk.toString('utf8');
      const room = cap - buf.length;
      if (s.length > room) {
        truncated = true;
        return buf + s.slice(0, room);
      }
      return buf + s;
    };

    proc.stdout.on('data', (c) => {
      out = append(out, c);
    });
    proc.stderr.on('data', (c) => {
      err = append(err, c);
    });

    const onAbort = () => {
      proc.kill('SIGTERM');
      setTimeout(() => proc.kill('SIGKILL'), 1500).unref();
    };
    ctx.signal?.addEventListener('abort', onAbort, { once: true });

    const to = setTimeout(() => {
      proc.kill('SIGTERM');
      setTimeout(() => proc.kill('SIGKILL'), 1500).unref();
    }, timeoutMs).unref();

    proc.on('error', (e) => {
      clearTimeout(to);
      resolve({
        output: `spawn failed: ${e.message}`,
        error: true,
        meta: { command: cmd, cwd },
      });
    });

    proc.on('close', (code, signal) => {
      clearTimeout(to);
      ctx.signal?.removeEventListener('abort', onAbort);
      const parts: string[] = [];
      parts.push(`$ ${cmd}`);
      parts.push(`(cwd: ${cwd})`);
      parts.push(`exit: ${code ?? `signal:${signal ?? 'unknown'}`}`);
      if (out) parts.push(`--- stdout ---\n${out.trimEnd()}`);
      if (err) parts.push(`--- stderr ---\n${err.trimEnd()}`);
      if (truncated) parts.push('(output truncated at 64KB)');
      resolve({
        output: parts.join('\n'),
        error: code !== 0,
        meta: { command: cmd, cwd, exit: code, signal },
      });
    });
  });
};

export const shellRun: Skill = {
  source: 'builtin',
  dir: '<builtin:shell.run>',
  body:
    '# shell.run\n\nRun a single shell command via `/bin/sh -lc`. ' +
    'Use for any system action (ls, git, grep, find, sed, ...). ' +
    'Output is captured up to 64KB and returned with exit code. ' +
    'Default timeout is 60s; pass `timeout_ms` to extend (max 5min).',
  frontmatter: {
    name: 'shell.run',
    description:
      'Run a shell command on the user system. Use this for ANY system action (listing files, git, grep, sed, curl, etc.). Returns stdout, stderr, exit code.',
    version: '0.1.0',
    author: 'x_harness',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The shell command to execute (interpreted by /bin/sh -lc).',
        },
        cwd: {
          type: 'string',
          description: 'Working directory. Defaults to the session cwd.',
        },
        timeout_ms: {
          type: 'integer',
          description: 'Optional timeout in milliseconds (default 60000, max 300000).',
        },
      },
      required: ['command'],
      additionalProperties: false,
    },
    metadata: {
      x_harness: {
        actor_required: 'model',
        danger_class: 'B',
        side_effects: ['filesystem', 'process', 'network'],
        tags: ['shell', 'system'],
      },
    },
  },
  handler,
};

/**
 * ADR-0007 — On-disk skill runtime.
 *
 * Given a ParsedSkill that lives on disk and declares (or auto-detects) a
 * handler script, produce a SkillHandler that:
 *   1. spawns the right interpreter for the script
 *   2. writes a JSON request on stdin
 *   3. reads stdout/stderr (combined, with the LAST line of stdout as the
 *      structured JSON result)
 *   4. honors timeout and AbortSignal
 *
 * The protocol is intentionally narrow so we can swap node↔deno↔bun later
 * without touching skills.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type {
  ParsedSkill,
  Skill,
  SkillContext,
  SkillHandler,
  SkillResult,
  SkillRuntime,
} from '../types.js';

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_OUTPUT_BYTES = 256 * 1024; // 256KB cap on the entire stdout+stderr

/** Probe order when `entrypoint` is unspecified. */
const PROBE_ORDER: ReadonlyArray<{ ext: string; runtime: Exclude<SkillRuntime, 'auto'> }> = [
  { ext: 'handler.ts', runtime: 'node-ts' },
  { ext: 'handler.mts', runtime: 'node-ts' },
  { ext: 'handler.js', runtime: 'node-js' },
  { ext: 'handler.mjs', runtime: 'node-js' },
  { ext: 'handler.sh', runtime: 'sh' },
  { ext: 'handler.py', runtime: 'python' },
];

export interface ResolvedEntrypoint {
  /** Absolute path to the handler script. */
  scriptPath: string;
  runtime: Exclude<SkillRuntime, 'auto'>;
}

export function resolveEntrypoint(skill: ParsedSkill): ResolvedEntrypoint | null {
  const xh = skill.frontmatter.metadata?.x_harness ?? {};
  const declaredRuntime = xh.runtime;
  const declaredEntry = xh.entrypoint;

  if (declaredEntry) {
    const abs = join(skill.dir, declaredEntry);
    if (!existsSync(abs)) return null;
    const inferred = declaredRuntime && declaredRuntime !== 'auto'
      ? declaredRuntime
      : inferRuntimeFromPath(declaredEntry);
    if (!inferred) return null;
    return { scriptPath: abs, runtime: inferred };
  }

  // No declared entrypoint → probe.
  for (const probe of PROBE_ORDER) {
    const abs = join(skill.dir, probe.ext);
    if (existsSync(abs)) {
      const rt: Exclude<SkillRuntime, 'auto'> =
        declaredRuntime && declaredRuntime !== 'auto'
          ? declaredRuntime
          : probe.runtime;
      return { scriptPath: abs, runtime: rt };
    }
  }
  return null;
}

function inferRuntimeFromPath(p: string): Exclude<SkillRuntime, 'auto'> | null {
  if (p.endsWith('.ts') || p.endsWith('.mts') || p.endsWith('.cts')) return 'node-ts';
  if (p.endsWith('.js') || p.endsWith('.mjs') || p.endsWith('.cjs')) return 'node-js';
  if (p.endsWith('.sh')) return 'sh';
  if (p.endsWith('.py')) return 'python';
  return null;
}

interface SpawnPlan {
  command: string;
  argv: string[];
}

function planSpawn(runtime: Exclude<SkillRuntime, 'auto'>, scriptPath: string): SpawnPlan {
  switch (runtime) {
    case 'node-ts':
      // tsx is a workspace dev-dep; we let node load it via --import tsx
      return { command: process.execPath, argv: ['--import', 'tsx', scriptPath] };
    case 'node-js':
      return { command: process.execPath, argv: [scriptPath] };
    case 'sh':
      return { command: '/bin/sh', argv: [scriptPath] };
    case 'python':
      return { command: process.env.X_HARNESS_PYTHON ?? 'python3', argv: [scriptPath] };
    default: {
      const _never: never = runtime;
      throw new Error(`unsupported runtime: ${String(_never)}`);
    }
  }
}

/** Build a wrapper SkillHandler for an on-disk skill, or null if no script. */
export function makeOnDiskHandler(skill: ParsedSkill): SkillHandler | null {
  const resolved = resolveEntrypoint(skill);
  if (!resolved) return null;
  const xh = skill.frontmatter.metadata?.x_harness ?? {};
  const declaredTimeout = typeof xh.timeout_ms === 'number' ? xh.timeout_ms : undefined;
  const timeoutMs = Math.min(
    declaredTimeout && declaredTimeout > 0 ? declaredTimeout : DEFAULT_TIMEOUT_MS,
    MAX_TIMEOUT_MS,
  );

  return async (args: Record<string, unknown>, ctx: SkillContext): Promise<SkillResult> =>
    execOnDisk(skill, resolved, args, ctx, timeoutMs);
}

interface RunResult {
  output: string;
  error?: boolean;
}

async function execOnDisk(
  skill: ParsedSkill,
  resolved: ResolvedEntrypoint,
  args: Record<string, unknown>,
  ctx: SkillContext,
  timeoutMs: number,
): Promise<SkillResult> {
  const plan = planSpawn(resolved.runtime, resolved.scriptPath);

  const reqJson = JSON.stringify({
    args,
    context: {
      sessionId: ctx.sessionId,
      cwd: ctx.cwd,
      skillDir: skill.dir,
      skillName: skill.frontmatter.name,
    },
  });

  return new Promise<SkillResult>((resolve) => {
    const child = spawn(plan.command, plan.argv, {
      cwd: ctx.cwd,
      env: {
        ...process.env,
        X_HARNESS_ACTOR: `skill:${skill.frontmatter.name}`,
        X_HARNESS_SKILL_DIR: skill.dir,
        X_HARNESS_SESSION_ID: ctx.sessionId,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      // Put child in its own process group so we can kill grandchildren too.
      detached: true,
    });

    let stdoutBuf = '';
    let stderrBuf = '';
    let total = 0;
    let killedBy: 'timeout' | 'abort' | null = null;

    const killTree = (sig: NodeJS.Signals) => {
      try {
        // negative pid = whole process group
        if (typeof child.pid === 'number') process.kill(-child.pid, sig);
      } catch {
        try { child.kill(sig); } catch { /* noop */ }
      }
    };

    const onAbort = () => {
      killedBy = 'abort';
      killTree('SIGTERM');
      setTimeout(() => killTree('SIGKILL'), 1000).unref();
    };
    ctx.signal?.addEventListener('abort', onAbort, { once: true });

    const timer = setTimeout(() => {
      killedBy = 'timeout';
      killTree('SIGTERM');
      setTimeout(() => killTree('SIGKILL'), 1000).unref();
    }, timeoutMs);
    timer.unref();

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (s: string) => {
      total += s.length;
      if (total > MAX_OUTPUT_BYTES) {
        if (!stdoutBuf.endsWith('…[truncated]')) stdoutBuf += '…[truncated]';
        return;
      }
      stdoutBuf += s;
    });
    child.stderr.on('data', (s: string) => {
      total += s.length;
      if (total > MAX_OUTPUT_BYTES) return;
      stderrBuf += s;
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      ctx.signal?.removeEventListener('abort', onAbort);
      resolve({
        output: `error: failed to spawn skill handler: ${(err as Error).message}`,
        error: true,
      });
    });

    child.on('close', (code, signal) => {
      clearTimeout(timer);
      ctx.signal?.removeEventListener('abort', onAbort);

      if (killedBy === 'abort') {
        return resolve({ output: '[aborted]', error: true });
      }
      if (killedBy === 'timeout') {
        return resolve({
          output: `error: skill timed out after ${timeoutMs}ms\n--- partial stdout ---\n${stdoutBuf}\n--- partial stderr ---\n${stderrBuf}`,
          error: true,
        });
      }

      const parsed = parseLastJsonLine(stdoutBuf);
      if (parsed) {
        const out: SkillResult = {
          output: typeof parsed.output === 'string' ? parsed.output : JSON.stringify(parsed),
          error: parsed.error === true ? true : undefined,
        };
        if (parsed.meta && typeof parsed.meta === 'object') {
          out.meta = parsed.meta as Record<string, unknown>;
        }
        // Surface non-JSON stdout chatter + stderr as a diagnostic suffix when present,
        // but only if the skill returned without error (audit-friendly).
        const chatter = stdoutChatter(stdoutBuf);
        if (chatter && !out.error) {
          // Don't append to output (model context) — just attach via meta.
          out.meta = { ...(out.meta ?? {}), chatter };
        }
        if (stderrBuf && !out.error) {
          out.meta = { ...(out.meta ?? {}), stderr: stderrBuf };
        }
        return resolve(out);
      }

      // No structured result. Report the failure.
      const exitWord = signal ? `signal ${signal}` : `exit ${code}`;
      const body = [
        `error: skill did not emit a JSON-line result (${exitWord})`,
        stdoutBuf ? `--- stdout ---\n${stdoutBuf.trim()}` : '',
        stderrBuf ? `--- stderr ---\n${stderrBuf.trim()}` : '',
      ]
        .filter(Boolean)
        .join('\n');
      resolve({ output: body, error: true });
    });

    try {
      child.stdin.end(reqJson + '\n');
    } catch {
      /* spawn-error path will handle it */
    }
  });
}

interface ParsedReply {
  output?: unknown;
  error?: unknown;
  meta?: unknown;
}

function parseLastJsonLine(s: string): ParsedReply | null {
  const lines = s.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i]!.trim();
    if (!l) continue;
    if (!(l.startsWith('{') && l.endsWith('}'))) continue;
    try {
      return JSON.parse(l) as ParsedReply;
    } catch {
      /* keep scanning */
    }
  }
  return null;
}

/** Everything except the last JSON line (for audit / debug). */
function stdoutChatter(s: string): string {
  const lines = s.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i]!.trim();
    if (!l) continue;
    if (l.startsWith('{') && l.endsWith('}')) {
      try {
        JSON.parse(l);
        return lines.slice(0, i).join('\n').trim();
      } catch { /* keep going */ }
    }
  }
  return s.trim();
}

/** Decorate a ParsedSkill with an on-disk handler if it has a script. */
export function withOnDiskHandler(skill: ParsedSkill): Skill {
  const handler = makeOnDiskHandler(skill);
  return handler ? { ...skill, handler } : { ...skill };
}

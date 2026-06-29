/**
 * e2e: shell.run redirect → provenance (+ secondary actor xattr)
 *
 * What we verify:
 *   1. `extractWriteTargets` finds `>`, `>>`, `tee`, `tee -a` targets.
 *   2. `shell.run` skill, when given an `attachProvenance` binder, only
 *      tags files that ACTUALLY got created/modified.
 *   3. `writeAiTouch` writes BOTH `com.x_harness.ai_touch` AND
 *      `com.x_harness.actor` (ADR-0002 fast-path index).
 *   4. `removeAiTouch` removes both keys.
 *
 * Run:  pnpm tsx packages/cli/scripts/e2e-shell-provenance.ts
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { extractWriteTargets } from '../../skills/src/builtin/shell-write-targets.js';
import { shellRun } from '../../skills/src/builtin/shell-run.js';
import {
  writeAiTouch,
  readAiTouch,
  readActorTag,
  removeAiTouch,
  XATTR_KEY,
  XATTR_ACTOR_KEY,
} from '../../provenance/src/index.js';

let failures = 0;
function check(name: string, cond: boolean, detail?: string): void {
  console.log(`${cond ? '✓' : '✗'} ${name}${detail ? `\n    ${detail}` : ''}`);
  if (!cond) failures++;
}

// ── 1. extractor ─────────────────────────────────────────────────────────
{
  const cwd = '/tmp';
  const cases: Array<{ cmd: string; expect: Array<{ path: string; reason: string }> }> = [
    {
      cmd: 'echo hi > /tmp/a.txt',
      expect: [{ path: '/tmp/a.txt', reason: 'redirect-truncate' }],
    },
    {
      cmd: 'date >> log.txt',
      expect: [{ path: '/tmp/log.txt', reason: 'redirect-append' }],
    },
    {
      cmd: 'echo x | tee /tmp/b.txt /tmp/c.txt',
      expect: [
        { path: '/tmp/b.txt', reason: 'tee' },
        { path: '/tmp/c.txt', reason: 'tee' },
      ],
    },
    {
      cmd: 'echo x | tee -a /tmp/d.txt',
      expect: [{ path: '/tmp/d.txt', reason: 'tee-append' }],
    },
    {
      cmd: 'cat foo 2> /tmp/err.log',
      expect: [{ path: '/tmp/err.log', reason: 'redirect-truncate' }],
    },
    // dynamic targets must NOT be tagged
    {
      cmd: 'echo x > $TMP/file.txt',
      expect: [],
    },
    {
      cmd: 'echo x > /dev/null',
      expect: [],
    },
    {
      cmd: 'echo x > /tmp/*.log',
      expect: [],
    },
  ];
  for (const c of cases) {
    const r = extractWriteTargets(c.cmd, { cwd });
    const got = r.map((x) => ({ path: x.path, reason: x.reason }));
    const ok = JSON.stringify(got) === JSON.stringify(c.expect);
    check(`extract: ${c.cmd}`, ok, ok ? undefined : `expected ${JSON.stringify(c.expect)} got ${JSON.stringify(got)}`);
  }
}

// ── 2. shell.run e2e: redirect actually creates file + attach called ────
{
  const dir = mkdtempSync(join(tmpdir(), 'xh-shell-e2e-'));
  try {
    const target = join(dir, 'hello.txt');
    const attachCalls: string[] = [];
    const result = await shellRun.handler!(
      { command: `echo "hi" > ${target}`, cwd: dir },
      {
        sessionId: 'e2e',
        cwd: dir,
        attachProvenance: async (p) => {
          attachCalls.push(p);
          return { ok: true, xattr: {} };
        },
      },
    );
    check('shell.run wrote file', existsSync(target));
    check('shell.run reported exit 0', result.error !== true);
    check('attachProvenance called once with absolute target', attachCalls.length === 1 && attachCalls[0] === target,
      `calls=${JSON.stringify(attachCalls)}`);
    check('meta.provenanceAttached present', Array.isArray((result.meta as any)?.provenanceAttached));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 2b. shell.run: command fails → no attach ──────────────────────────────
{
  const dir = mkdtempSync(join(tmpdir(), 'xh-shell-fail-'));
  try {
    const target = join(dir, 'never.txt');
    const calls: string[] = [];
    await shellRun.handler!(
      { command: `false > ${target}; rm -f ${target}; exit 7`, cwd: dir },
      {
        sessionId: 'e2e',
        cwd: dir,
        attachProvenance: async (p) => {
          calls.push(p);
          return { ok: true, xattr: {} };
        },
      },
    );
    check('no attach when command exits non-zero', calls.length === 0,
      `unexpected calls=${JSON.stringify(calls)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 3. writeAiTouch writes BOTH xattr keys ──────────────────────────────
{
  const dir = mkdtempSync(join(tmpdir(), 'xh-xattr-'));
  try {
    const f = join(dir, 'sample.txt');
    writeFileSync(f, 'hello\n');
    const r = writeAiTouch({
      v: 1,
      ts: '2026-06-29T20:00:00Z',
      sessionId: 'sess-test',
      executor: { kind: 'model', provider: 'deepseek', model: 'deepseek-chat' },
      autonomy: 'human-implied',
      xHarnessHome: '/tmp/.x_harness',
      path: f,
    });
    check('writeAiTouch ok', r.ok, r.error);
    const ai = readAiTouch(f);
    check('readAiTouch returns compact xattr', !!ai && ai.v === 1);
    const actor = readActorTag(f);
    check('readActorTag returns executor tag',
      actor === 'model:deepseek/deepseek-chat',
      `actor xattr = ${actor ?? '<missing>'}`);

    // verify via OS xattr tool both keys exist
    const list = spawnSync('xattr', [f], { encoding: 'utf8' });
    const keys = (list.stdout ?? '').split('\n').map((s) => s.trim()).filter(Boolean);
    check(`xattr lists both keys (got: ${keys.join(', ')})`,
      keys.includes(XATTR_KEY) && keys.includes(XATTR_ACTOR_KEY));

    removeAiTouch(f);
    const list2 = spawnSync('xattr', [f], { encoding: 'utf8' });
    const keys2 = (list2.stdout ?? '').split('\n').map((s) => s.trim()).filter(Boolean);
    check(`removeAiTouch removed both keys (remaining: ${keys2.join(', ') || '<none>'})`,
      !keys2.includes(XATTR_KEY) && !keys2.includes(XATTR_ACTOR_KEY));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log(failures === 0 ? '\nALL CHECKS PASS ✅' : `\n${failures} CHECK(S) FAILED ❌`);
process.exit(failures === 0 ? 0 : 1);

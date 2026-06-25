/**
 * Integration test for ADR-0007 on-disk skill runtime.
 *
 * Creates a temp $X_HARNESS_HOME with three skills: one ts, one sh, one
 * deliberately broken; then loads them via buildSkillRegistry and invokes
 * their handlers, asserting the stdio protocol works end-to-end.
 *
 * Run with: pnpm tsx packages/skills/test/exec-on-disk.test.ts
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSkillRegistry } from '../src/index.js';

const home = mkdtempSync(join(tmpdir(), 'x_harness-exec-on-disk-'));
const skillsDir = join(home, 'skills');
mkdirSync(skillsDir, { recursive: true });

interface Case {
  name: string;
  dir: string;
  files: Record<string, string>;
  invoke: { args: Record<string, unknown> };
  expectOutputIncludes?: string;
  expectError?: boolean;
  /** if true, this skill should NOT be executable (no handler attached). */
  expectNoHandler?: boolean;
}

const cases: Case[] = [
  {
    name: 'greet-ts',
    dir: join(skillsDir, 'greet-ts'),
    files: {
      'SKILL.md': `---
name: greet-ts
description: greet by name (ts)
metadata:
  x_harness:
    runtime: node-ts
---
hi
`,
      'handler.ts': `import { stdin } from 'node:process';
let buf = '';
stdin.setEncoding('utf8');
stdin.on('data', (c: string) => { buf += c; });
stdin.on('end', () => {
  const req = JSON.parse(buf);
  const name: string = req.args?.name ?? 'world';
  // chatter on stdout BEFORE the JSON reply (must be ignored by parser)
  console.log('[debug] received name=' + name);
  console.log(JSON.stringify({ output: 'hello ' + name + '!' }));
});
`,
    },
    invoke: { args: { name: 'Alice' } },
    expectOutputIncludes: 'hello Alice!',
  },
  {
    name: 'noisy-sh',
    dir: join(skillsDir, 'noisy-sh'),
    files: {
      'SKILL.md': `---
name: noisy-sh
description: shell script that emits multi-line stdout
metadata:
  x_harness:
    runtime: sh
---
`,
      'handler.sh': `#!/bin/sh
cat > /dev/null
echo "noise on stderr" 1>&2
echo "line one"
echo "line two"
printf '%s\\n' '{"output":"done","meta":{"lines":2}}'
`,
    },
    invoke: { args: {} },
    expectOutputIncludes: 'done',
  },
  {
    name: 'broken-no-json',
    dir: join(skillsDir, 'broken-no-json'),
    files: {
      'SKILL.md': `---
name: broken-no-json
description: prints garbage, no JSON reply
metadata:
  x_harness:
    runtime: sh
---
`,
      'handler.sh': `#!/bin/sh
cat > /dev/null
echo "i forgot to emit json"
exit 0
`,
    },
    invoke: { args: {} },
    expectError: true,
    expectOutputIncludes: 'did not emit a JSON-line result',
  },
  {
    name: 'no-handler-script',
    dir: join(skillsDir, 'no-handler-script'),
    files: {
      'SKILL.md': `---
name: no-handler-script
description: doc-only skill, no script
---
nothing here.
`,
    },
    invoke: { args: {} },
    expectNoHandler: true,
  },
];

for (const c of cases) {
  mkdirSync(c.dir, { recursive: true });
  for (const [fname, content] of Object.entries(c.files)) {
    writeFileSync(join(c.dir, fname), content);
  }
}

const reg = buildSkillRegistry({
  includeBuiltin: false,
  userDir: skillsDir,
  projectDir: '',
});

let failed = 0;
let passed = 0;

for (const c of cases) {
  const skill = reg.get(c.name);
  if (!skill) {
    console.log(`✗ ${c.name}: not loaded into registry`);
    failed++;
    continue;
  }
  const hasHandler = typeof skill.handler === 'function';
  if (c.expectNoHandler) {
    if (!hasHandler) {
      console.log(`✓ ${c.name}: no handler attached (as expected)`);
      passed++;
    } else {
      console.log(`✗ ${c.name}: expected NO handler but got one`);
      failed++;
    }
    continue;
  }
  if (!hasHandler) {
    console.log(`✗ ${c.name}: handler missing`);
    failed++;
    continue;
  }
  const result = await skill.handler!(c.invoke.args, {
    sessionId: 'test-session',
    cwd: process.cwd(),
  });
  const okOutput =
    !c.expectOutputIncludes || result.output.includes(c.expectOutputIncludes);
  const okError = c.expectError ? result.error === true : !result.error;
  if (okOutput && okError) {
    console.log(`✓ ${c.name}: output=${JSON.stringify(result.output.slice(0, 80))} error=${result.error ?? false}`);
    passed++;
  } else {
    console.log(`✗ ${c.name}:`);
    console.log(`   want includes: ${c.expectOutputIncludes}`);
    console.log(`   want error:    ${c.expectError}`);
    console.log(`   got:           ${JSON.stringify(result)}`);
    failed++;
  }
}

// timeout case
{
  const dir = join(skillsDir, 'sleepy');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'SKILL.md'),
    `---
name: sleepy
description: never returns in time
metadata:
  x_harness:
    runtime: sh
    timeout_ms: 200
---
`,
  );
  writeFileSync(
    join(dir, 'handler.sh'),
    `#!/bin/sh
cat > /dev/null
sleep 5
echo '{"output":"never"}'
`,
  );
  const reg2 = buildSkillRegistry({
    includeBuiltin: false,
    userDir: skillsDir,
    projectDir: '',
  });
  const s = reg2.get('sleepy')!;
  const t0 = Date.now();
  const r = await s.handler!({}, { sessionId: 't', cwd: process.cwd() });
  const dt = Date.now() - t0;
  if (r.error && r.output.includes('timed out') && dt < 3000) {
    console.log(`✓ sleepy: timed out in ${dt}ms`);
    passed++;
  } else {
    console.log(`✗ sleepy: dt=${dt}ms result=${JSON.stringify(r)}`);
    failed++;
  }
}

// X_HARNESS_ACTOR env propagation
{
  const dir = join(skillsDir, 'whoami');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'SKILL.md'),
    `---
name: whoami
description: echoes its actor env
metadata:
  x_harness:
    runtime: sh
---
`,
  );
  writeFileSync(
    join(dir, 'handler.sh'),
    `#!/bin/sh
cat > /dev/null
printf '{"output":"%s"}\\n' "$X_HARNESS_ACTOR"
`,
  );
  const reg2 = buildSkillRegistry({
    includeBuiltin: false,
    userDir: skillsDir,
    projectDir: '',
  });
  const s = reg2.get('whoami')!;
  const r = await s.handler!({}, { sessionId: 't', cwd: process.cwd() });
  if (r.output === 'skill:whoami') {
    console.log(`✓ whoami: X_HARNESS_ACTOR=${r.output}`);
    passed++;
  } else {
    console.log(`✗ whoami: got ${JSON.stringify(r)}`);
    failed++;
  }
}

console.log(`\n${passed} passed, ${failed} failed`);

rmSync(home, { recursive: true, force: true });

if (failed > 0) process.exit(1);

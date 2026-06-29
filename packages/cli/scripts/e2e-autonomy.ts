/**
 * e2e: autonomy heuristic — verify the classifier reacts to:
 *   - no human message
 *   - tool rounds since human
 *   - target basename appearing in user message
 *
 * Run:  pnpm tsx packages/cli/scripts/e2e-autonomy.ts
 */
import { classifyAutonomy } from '../../core/src/autonomy-heuristic.js';

let failures = 0;
function check(name: string, cond: boolean, detail?: string): void {
  console.log(`${cond ? '✓' : '✗'} ${name}${detail ? `\n    ${detail}` : ''}`);
  if (!cond) failures++;
}

const cases: Array<{
  name: string;
  input: Parameters<typeof classifyAutonomy>[0];
  level: string;
}> = [
  {
    name: 'no human message → model-self-initiated',
    input: { hasHumanMessage: false, toolRoundsSinceLastHuman: 0 },
    level: 'model-self-initiated',
  },
  {
    name: 'human msg, round 1, target not named → human-implied',
    input: {
      hasHumanMessage: true,
      toolRoundsSinceLastHuman: 1,
      lastHumanMessage: 'please refactor the auth module',
      targetPath: '/tmp/foo.ts',
    },
    level: 'human-implied',
  },
  {
    name: 'human msg, round 1, basename literally named → human-instructed',
    input: {
      hasHumanMessage: true,
      toolRoundsSinceLastHuman: 1,
      lastHumanMessage: 'edit README.md to add the changelog',
      targetPath: '/Users/x/project/README.md',
    },
    level: 'human-instructed',
  },
  {
    name: 'human msg, round 1, stem named ("foo" matches foo.tar.gz) → human-instructed',
    input: {
      hasHumanMessage: true,
      toolRoundsSinceLastHuman: 1,
      lastHumanMessage: 'create a foo archive',
      targetPath: '/tmp/foo.tar.gz',
    },
    level: 'human-instructed',
  },
  {
    name: 'round 2 → model-elaborated',
    input: {
      hasHumanMessage: true,
      toolRoundsSinceLastHuman: 2,
      lastHumanMessage: 'edit README.md',
      targetPath: '/path/to/README.md',
    },
    level: 'model-elaborated',
  },
  {
    name: 'round 5 → model-elaborated (still)',
    input: {
      hasHumanMessage: true,
      toolRoundsSinceLastHuman: 5,
      lastHumanMessage: 'go',
      targetPath: '/tmp/whatever.txt',
    },
    level: 'model-elaborated',
  },
  {
    name: 'short basename ("a") does NOT count as literal',
    input: {
      hasHumanMessage: true,
      toolRoundsSinceLastHuman: 1,
      lastHumanMessage: 'do the thing for a',
      targetPath: '/tmp/a',
    },
    level: 'human-implied',
  },
  {
    name: 'case-sensitive: lower-case mention ≠ upper-case target',
    input: {
      hasHumanMessage: true,
      toolRoundsSinceLastHuman: 1,
      lastHumanMessage: 'check the readme',
      targetPath: '/tmp/README.md',
    },
    level: 'human-implied',
  },
  {
    name: 'no targetPath → can never be human-instructed (still implied)',
    input: {
      hasHumanMessage: true,
      toolRoundsSinceLastHuman: 1,
      lastHumanMessage: 'do something',
    },
    level: 'human-implied',
  },
];

for (const c of cases) {
  const r = classifyAutonomy(c.input);
  const ok = r.level === c.level;
  check(c.name, ok, ok ? `(${r.reason})` : `expected ${c.level} got ${r.level} — ${r.reason}`);
}

console.log(failures === 0 ? '\nALL CHECKS PASS ✅' : `\n${failures} CHECK(S) FAILED ❌`);
process.exit(failures === 0 ? 0 : 1);

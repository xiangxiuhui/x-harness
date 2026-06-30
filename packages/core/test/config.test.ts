/**
 * ADR-0013 Step 4 — config loading tests.
 *
 * Run with: pnpm tsx packages/core/test/config.test.ts
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadConfig,
  compactionFromConfig,
  configPathOf,
} from '../src/config.js';

let pass = 0;
let fail = 0;
const failures: string[] = [];
function ok(name: string, cond: boolean, detail?: string): void {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    failures.push(detail ? `${name} :: ${detail}` : name);
    console.log(`  ✗ ${name}${detail ? ' :: ' + detail : ''}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Missing config → empty object, never throws
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n1. Missing config file');
{
  const home = mkdtempSync(join(tmpdir(), 'xh-cfg-'));
  try {
    const cfg = loadConfig(home);
    ok('returns empty object', Object.keys(cfg).length === 0);
    ok('compactionFromConfig → undefined', compactionFromConfig(cfg) === undefined);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Malformed JSON → empty object, never throws
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n2. Malformed JSON');
{
  const home = mkdtempSync(join(tmpdir(), 'xh-cfg-'));
  try {
    writeFileSync(configPathOf(home), '{this is not json');
    const cfg = loadConfig(home);
    ok('falls back to empty', Object.keys(cfg).length === 0);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Array JSON → empty object (defensive)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n3. Array top-level → ignored');
{
  const home = mkdtempSync(join(tmpdir(), 'xh-cfg-'));
  try {
    writeFileSync(configPathOf(home), '[1,2,3]');
    const cfg = loadConfig(home);
    ok('ignores array', Object.keys(cfg).length === 0);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Valid config with compaction block
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n4. Compaction block populated');
{
  const home = mkdtempSync(join(tmpdir(), 'xh-cfg-'));
  try {
    writeFileSync(
      configPathOf(home),
      JSON.stringify({
        compaction: {
          enabled: true,
          threshold: 0.5,
          headN: 3,
          recentN: 8,
        },
      }),
    );
    const cfg = loadConfig(home);
    ok('compaction key present', cfg.compaction != null);
    const block = compactionFromConfig(cfg);
    ok('compactionFromConfig returns block', block != null);
    ok('enabled flag true', block?.enabled === true);
    ok('threshold passed through', block?.config.threshold === 0.5);
    ok('headN passed through', block?.config.headN === 3);
    ok('recentN passed through', block?.config.recentN === 8);
    // enabled field stripped from config payload
    ok(
      'enabled field stripped from .config',
      !('enabled' in (block?.config ?? {})),
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. enabled:false → compactionFromConfig returns undefined
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n5. enabled:false disables');
{
  const home = mkdtempSync(join(tmpdir(), 'xh-cfg-'));
  try {
    writeFileSync(
      configPathOf(home),
      JSON.stringify({ compaction: { enabled: false, threshold: 0.5 } }),
    );
    const cfg = loadConfig(home);
    ok('compaction key still readable', cfg.compaction != null);
    ok(
      'compactionFromConfig returns undefined',
      compactionFromConfig(cfg) === undefined,
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Unknown top-level keys preserved
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n6. Unknown top-level keys');
{
  const home = mkdtempSync(join(tmpdir(), 'xh-cfg-'));
  try {
    writeFileSync(
      configPathOf(home),
      JSON.stringify({
        compaction: { threshold: 0.6 },
        futureFeature: { foo: 'bar' },
      }),
    );
    const cfg = loadConfig(home);
    ok('unknown top-level key preserved', (cfg.futureFeature as any)?.foo === 'bar');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. Empty compaction block (no fields) → enabled with defaults
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n7. Empty compaction block');
{
  const home = mkdtempSync(join(tmpdir(), 'xh-cfg-'));
  try {
    writeFileSync(configPathOf(home), JSON.stringify({ compaction: {} }));
    const cfg = loadConfig(home);
    const block = compactionFromConfig(cfg);
    ok('empty block still enables', block != null);
    ok(
      'config object is empty (Session will use defaults)',
      block != null && Object.keys(block.config).length === 0,
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

// ─────────────────────────────────────────────────────────────────────────────

console.log(`\n${pass} passed, ${fail} failed`);
if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) console.log('  - ' + f);
  process.exit(1);
}

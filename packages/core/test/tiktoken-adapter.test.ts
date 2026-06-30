/**
 * ADR-0013 Step 5 — tiktoken adapter tests.
 *
 * Run with: pnpm tsx packages/core/test/tiktoken-adapter.test.ts
 */

import {
  makeTiktokenTokenizer,
  makeTiktokenTokenizerByEncoding,
  heuristicCount,
  estimateMessagesTokens,
} from '../src/compaction/index.js';
import type { Message } from '@x_harness/provider';

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
// 1. Basic encoding works
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n1. Default tokenizer (o200k_base via no-model path)');
{
  const tok = makeTiktokenTokenizer();
  ok('empty string → 0', tok('') === 0);
  const n = tok('Hello, world!');
  ok('non-empty produces positive int', n > 0 && Number.isInteger(n));
  // 'Hello, world!' is 4 tokens in cl100k/o200k.
  ok('Hello, world! is 3-5 tokens', n >= 3 && n <= 5, `got ${n}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Real tokenizer should be more accurate than heuristic on English prose
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n2. Tiktoken vs heuristic accuracy');
{
  const tok = makeTiktokenTokenizer('gpt-4o');
  // Known ground truth for "The quick brown fox jumps over the lazy dog" ≈ 9 tokens in o200k.
  const text = 'The quick brown fox jumps over the lazy dog.';
  const real = tok(text);
  const heur = heuristicCount(text);
  ok('real tokenizer ≤ 12 tokens for fox sentence', real <= 12, `got ${real}`);
  ok('real tokenizer ≥ 8 tokens for fox sentence', real >= 8, `got ${real}`);
  // Heuristic (chars/3.6 ≈ 13) is biased high — that's the design.
  ok('heuristic biases high', heur >= real, `heur=${heur} real=${real}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Unknown model falls back to o200k without throwing
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n3. Unknown model fallback');
{
  const tok = makeTiktokenTokenizer('some-future-unknown-model');
  const n = tok('hello world');
  ok('fallback produces a count', n > 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Explicit encoding name
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n4. By-encoding factory');
{
  const cl100k = makeTiktokenTokenizerByEncoding('cl100k_base');
  const o200k = makeTiktokenTokenizerByEncoding('o200k_base');
  const text = 'function compactIfNeeded(input) { return null; }';
  const a = cl100k(text);
  const b = o200k(text);
  ok('cl100k produces positive count', a > 0);
  ok('o200k produces positive count', b > 0);
  // Both should be in same ballpark (±50%) for code.
  ok(
    'cl100k and o200k agree within 2x',
    a > 0 && b > 0 && Math.max(a, b) / Math.min(a, b) < 2,
    `cl100k=${a} o200k=${b}`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Integrates with estimateMessagesTokens
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n5. Integrates with estimateMessagesTokens');
{
  const tok = makeTiktokenTokenizer('gpt-4o');
  const msgs: Message[] = [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'What is the capital of France?' },
    { role: 'assistant', content: 'Paris.' },
  ];
  const real = estimateMessagesTokens(msgs, tok);
  const heur = estimateMessagesTokens(msgs);
  ok('real estimate > 0', real > 0);
  ok('heuristic estimate > 0', heur > 0);
  ok('they are within 2x of each other', Math.max(real, heur) / Math.min(real, heur) < 2,
    `real=${real} heur=${heur}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Tokenizer is deterministic (encoder is cached)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n6. Encoder caching / determinism');
{
  const t0 = Date.now();
  const tok1 = makeTiktokenTokenizer('gpt-4o');
  const firstCallMs = Date.now() - t0;
  const t1 = Date.now();
  const tok2 = makeTiktokenTokenizer('gpt-4o');
  const secondCallMs = Date.now() - t1;
  ok('determinism: same input → same output', tok1('hello world') === tok2('hello world'));
  // Second creation should be < 50ms (cached encoder).
  ok(
    'second tokenizer creation is fast (cached)',
    secondCallMs < 100,
    `first=${firstCallMs}ms second=${secondCallMs}ms`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. Large input doesn't crash and gives plausible count
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n7. Large input');
{
  const tok = makeTiktokenTokenizer('gpt-4o');
  const big = 'lorem ipsum dolor sit amet '.repeat(2000);
  const n = tok(big);
  // ~5 words → ~6 tokens per repeat; 2000 repeats → ≈ 12000 tokens.
  ok('count in expected ballpark for 2000 repeats', n > 8000 && n < 16000, `got ${n}`);
}

// ─────────────────────────────────────────────────────────────────────────────

console.log(`\n${pass} passed, ${fail} failed`);
if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) console.log('  - ' + f);
  process.exit(1);
}

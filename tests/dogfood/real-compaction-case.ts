#!/usr/bin/env tsx
/**
 * Real provider dogfood: human-like long task that should trigger compaction.
 *
 * This is an opt-in L5 dogfood case, not part of default tests.
 * It simulates a human asking the agent to plan, install, create, refine, and
 * use skills over several turns, then inspects the compaction summary quality.
 *
 * Run:
 *   pnpm tsx tests/dogfood/real-compaction-case.ts
 *
 * Env:
 *   DEEPSEEK_API_KEY                 required
 *   REAL_COMPACTION_TURNS            default: 7
 *   REAL_COMPACTION_CONTEXT_WINDOW   default: 4200
 *   REAL_COMPACTION_THRESHOLD        default: 0.35
 *   REAL_COMPACTION_HOME             optional; default: temporary dir
 */

import { existsSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDeepSeekProviderFromEnv } from '../../packages/provider/src/index.js';
import {
  Session,
  estimateMessagesTokens,
  makeTiktokenTokenizer,
  type CompactionEvent,
} from '../../packages/core/src/index.js';

function loadDotenv(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(process.cwd(), '.env'),
    resolve(process.cwd(), '../../.env'),
    resolve(here, '../../.env'),
  ];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    const text = readFileSync(p, 'utf8');
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq <= 0) continue;
      const k = line.slice(0, eq).trim();
      let v = line.slice(eq + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (process.env[k] === undefined) process.env[k] = v;
    }
    return;
  }
}

function assert(cond: boolean, message: string): void {
  if (!cond) throw new Error(message);
}

function asNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function oneLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function scoreSummary(summary: string, prompts: string[]): Array<{ name: string; ok: boolean; detail: string }> {
  const checks = [
    {
      name: 'mentions skill/install theme',
      ok: /skill|install|安装|更新|dogfood|测试/i.test(summary),
      detail: 'summary should retain the task domain',
    },
    {
      name: 'mentions at least one concrete artifact/path',
      ok: /\.codeflicker|SKILL\.md|real-cli-dogfood|install\.sh|docs\/test-strategy|\.x_harness/i.test(summary),
      detail: 'summary should preserve concrete paths/artifacts',
    },
    {
      name: 'mentions testing or validation',
      ok: /test|验证|测试|dogfood|smoke|closed-loop|闭环/i.test(summary),
      detail: 'summary should preserve validation intent',
    },
    {
      name: 'does not look like an instruction to execute tools',
      ok: !/run\s+rm|execute\s+rm|delete\s+all|立即执行/i.test(summary),
      detail: 'summary should be reference-only, not new action text',
    },
    {
      name: 'does not factualize unmentioned concrete artifacts',
      ok: !/(test_skill_v2\.md|x_harness\s+validate|wget|GO_VERSION|Go\s+1\.22|events\.jsonl|successful_steps|failed_steps)/i.test(summary),
      detail: 'summary should not present invented example artifacts as completed facts',
    },
    {
      name: 'not empty and not bloated',
      ok: summary.length >= 120 && summary.length <= 2600,
      detail: `summary length=${summary.length}`,
    },
  ];

  const earlySignal = prompts.slice(0, 2).some((p) => {
    const words = p.match(/[A-Za-z][A-Za-z0-9_-]{4,}|[\u4e00-\u9fff]{2,}/g) ?? [];
    return words.slice(0, 8).some((w) => summary.includes(w));
  });
  checks.push({
    name: 'retains some early-turn signal',
    ok: earlySignal,
    detail: 'summary should not only cover the final exchange',
  });

  return checks;
}

loadDotenv();

if (!process.env.DEEPSEEK_API_KEY) {
  throw new Error('DEEPSEEK_API_KEY is required for real-compaction dogfood');
}

process.env.DEEPSEEK_MODEL ??= 'deepseek-chat';
process.env.DEEPSEEK_AUX_MODEL ??= 'deepseek-chat';

const keepHome = process.env.REAL_COMPACTION_KEEP_HOME === '1';
const generatedHome = process.env.REAL_COMPACTION_HOME ? null : mkdtempSync(join(tmpdir(), 'xh-real-compaction-'));
const xHarnessHome = process.env.REAL_COMPACTION_HOME ?? generatedHome!;
const turns = asNumber('REAL_COMPACTION_TURNS', 7);
const contextWindow = asNumber('REAL_COMPACTION_CONTEXT_WINDOW', 4200);
const threshold = asNumber('REAL_COMPACTION_THRESHOLD', 0.35);
const sessionId = `real-compaction-${Date.now().toString(36)}`;

const provider = createDeepSeekProviderFromEnv();
const tokenize = makeTiktokenTokenizer(provider.defaultModel);
const compactionEvents: CompactionEvent[] = [];
const prompts = makeHumanSkillTaskPrompts(turns);

const session = new Session({
  provider,
  humanUserId: 'real-compaction-dogfood',
  humanSurface: 'cli',
  cwd: process.cwd(),
  sessionId,
  provenance: { xHarnessHome },
  systemPrompt: [
    'You are helping a developer improve x_harness dogfood quality.',
    'Reply in Chinese, with concise but substantive analysis.',
    'For each turn, include concrete paths, test cases, and trade-offs where useful.',
    'Do not call tools; this dogfood case evaluates long-context conversation quality only.',
  ].join('\n'),
  compaction: {
    config: {
      threshold,
      contextWindow,
      headN: 2,
      recentN: 4,
      toolOutputMaxTokens: 2048,
    },
    tokenize,
  },
});

session.bus.subscribe((ev) => {
  if (ev.kind === 'context.compacted') {
    compactionEvents.push(ev.payload as CompactionEvent);
  }
});

const turnStats: Array<{
  turn: number;
  prompt: string;
  tokensBefore: number;
  tokensAfter: number;
  replyChars: number;
  compacted: boolean;
  ms: number;
}> = [];

console.log('# real-compaction-case-dogfood');
console.log('');
console.log(`home=${xHarnessHome}`);
console.log(`session=${sessionId}`);
console.log(`model=${provider.defaultModel}`);
console.log(`auxModel=${provider.auxModel ?? provider.defaultModel}`);
console.log(`turns=${turns}`);
console.log(`threshold=${threshold} contextWindow=${contextWindow} triggerAt≈${Math.floor(threshold * contextWindow)} tokens`);
console.log('');

for (let i = 0; i < prompts.length; i++) {
  const prompt = prompts[i]!;
  const beforeEvents = compactionEvents.length;
  session.pushUser(prompt);
  const tokensBefore = estimateMessagesTokens(session.snapshot(), tokenize);
  const start = Date.now();
  let replyChars = 0;
  let head = '';
  for await (const ev of session.streamReply()) {
    if (ev.kind === 'assistant.delta') {
      replyChars += ev.text.length;
      if (head.length < 180) head += ev.text;
    }
  }
  const ms = Date.now() - start;
  const tokensAfter = estimateMessagesTokens(session.snapshot(), tokenize);
  const compacted = compactionEvents.length > beforeEvents;
  turnStats.push({
    turn: i + 1,
    prompt: oneLine(prompt).slice(0, 120),
    tokensBefore,
    tokensAfter,
    replyChars,
    compacted,
    ms,
  });
  console.log(`turn ${i + 1}/${prompts.length}: tokens ${tokensBefore}→${tokensAfter}, replyChars=${replyChars}, ${(ms / 1000).toFixed(1)}s${compacted ? ' COMPACTED' : ''}`);
  console.log(`  reply head: ${oneLine(head).slice(0, 160)}`);
}

const messages = session.snapshot();
const summaryMessages = messages.filter((m) => m.meta?.compacted === true);
const latestSummary = summaryMessages.at(-1);
const summaryText = latestSummary
  ? typeof latestSummary.content === 'string'
    ? latestSummary.content
    : JSON.stringify(latestSummary.content)
  : '';
const checks = scoreSummary(summaryText, prompts);
const failed = checks.filter((c) => !c.ok);

console.log('');
console.log('## Compaction events');
if (compactionEvents.length === 0) {
  console.log('none');
} else {
  for (const [i, e] of compactionEvents.entries()) {
    console.log(
      `#${i + 1}: strategy=${e.strategy} trigger=${e.trigger} reason=${e.reason} phase=${e.phase} tokens=${e.tokensBefore}→${e.tokensAfter} durationMs=${e.durationMs} headKept=${e.headKept} recentKept=${e.recentKept}`,
    );
  }
}

console.log('');
console.log('## Turn stats');
for (const s of turnStats) {
  console.log(`- T${s.turn}: ${s.tokensBefore}→${s.tokensAfter} tokens, reply=${s.replyChars} chars, compacted=${s.compacted}; prompt="${s.prompt}"`);
}

console.log('');
console.log('## Latest compacted summary');
console.log(summaryText || '(no summary message found)');

console.log('');
console.log('## Summary quality checks');
for (const c of checks) {
  console.log(`${c.ok ? 'PASS' : 'FAIL'} - ${c.name}: ${c.detail}`);
}

console.log('');
console.log('## Experience analysis');
console.log(makeExperienceAnalysis(compactionEvents, turnStats, summaryText, failed));

try {
  assert(compactionEvents.length > 0, 'expected at least one context.compacted event');
  assert(summaryMessages.length > 0, 'expected at least one compacted summary message');
  assert(failed.length === 0, `summary quality checks failed: ${failed.map((c) => c.name).join(', ')}`);
  console.log('');
  console.log('RESULT: PASS real-compaction-case-dogfood');
} finally {
  if (generatedHome && !keepHome) {
    rmSync(generatedHome, { recursive: true, force: true });
  } else {
    console.log(`home kept: ${xHarnessHome}`);
  }
}

function makeHumanSkillTaskPrompts(n: number): string[] {
  const base = [
    `我想把 x_harness 的真实 dogfood 做成长期 SOP。请先帮我设计一个从 push main、更新 install、再用 installed CLI 测试的闭环，重点说明为什么不能只跑本地单测。请保留这些关键词：.codeflicker/skills、install.sh、real-cli-dogfood、docs/test-strategy.md。`,
    `现在进一步设计一个“安装或使用 Skill”的长任务测试：一个人类会先要求安装更新，再创建/修改 skill，然后让另一个模型复用这个 skill 自动测试。请列出应该捕获哪些体验信号，包括命令输出、JSONL、session summary、compaction event。`,
    `假设这个任务已经跑了 3 轮，对话开始变长。请你从架构角度解释 compaction 应该保留哪些早期信息：用户为什么要这个 SOP、哪些路径不能丢、哪些测试结果必须留、哪些临时调试入口应该被清理。`,
    `我现在要求你模拟一次 review：如果 summary 只记住最后一轮而忘了最初的 push→install→test 目标，会造成什么实际伤害？请给出至少 4 个具体失败场景，并说明如何通过测试 case 检测。`,
    `继续推进到实现层：请建议 real-compaction-case-dogfood 这个 case 应该放在哪里，为什么不要一个 case 一个 skill，以及它如何接入 x-harness-real-dogfood 这个有限 SOP skill。`,
    `最后，请像真实交付前一样，给我一份 compact 后继续工作的“恢复提示”：后续模型从 summary 接手时，应该知道当前任务、关键文件、已验证链路、还没做的改进建议。`,
    `补充一个边界情况：如果 auxModel 省略了 .codeflicker/skills 或 install.sh 这样的路径，但保留了泛泛的“做测试”，你会如何改 FILTER_SAFE_PREAMBLE 或 summary quality check？请给出可落地的规则。`,
    `请把上面的讨论压成一份最终建议，按 P0/P1/P2 分级，直接告诉我下一步应该改哪些产品能力和哪些测试能力。`,
  ];
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(base[i % base.length]!);
  return out;
}

function makeExperienceAnalysis(
  events: CompactionEvent[],
  stats: Array<{ turn: number; tokensBefore: number; tokensAfter: number; compacted: boolean; replyChars: number; ms: number }>,
  summary: string,
  failed: Array<{ name: string; detail: string }>,
): string {
  const first = events[0];
  const compactTurns = stats.filter((s) => s.compacted).map((s) => `T${s.turn}`).join(', ') || 'none';
  const avgMs = stats.length ? Math.round(stats.reduce((s, x) => s + x.ms, 0) / stats.length) : 0;
  const avgReply = stats.length ? Math.round(stats.reduce((s, x) => s + x.replyChars, 0) / stats.length) : 0;
  const lines = [
    `- Trigger experience: compaction fired on ${compactTurns}; first event ${first ? `${first.tokensBefore}→${first.tokensAfter} tokens via ${first.strategy}` : 'did not fire'}.`,
    `- Latency experience: average provider turn took ~${avgMs}ms; average reply size ~${avgReply} chars. Compaction duration is recorded separately in the event and should stay small relative to provider latency.`,
    `- Continuity experience: latest summary length=${summary.length}. It should preserve the original push→install→test goal, concrete paths, and validation evidence so a later model can continue without asking the user to restate context.`,
  ];
  if (failed.length > 0) {
    lines.push(`- Weakness observed: ${failed.map((f) => f.name).join(', ')}. Treat this as a prompt/test gap, not just a one-off model issue.`);
    lines.push('- Specific UX risk: a compacted summary may preserve the right high-level goal while factualizing illustrative examples as completed artifacts. That can mislead the next model into chasing files or commands that never existed.');
  } else {
    lines.push('- Summary quality checks passed: the compacted summary retained domain, artifacts, validation intent, early-turn signal, avoided invented concrete artifacts, and did not become an action instruction.');
  }
  lines.push('- Recommended improvement P0: keep this case behind `--with-provider`, but make its quality checks part of the recurring real dogfood SOP before major compaction changes.');
  lines.push('- Recommended improvement P1: persist a small machine-readable dogfood report JSON next to stdout so future sessions can compare summary coverage and factualization regressions over time.');
  lines.push('- Recommended improvement P2: add configurable golden keywords and forbidden hallucination terms per long-task case, so each scenario can assert its own must-keep and must-not-invent artifacts.');
  return lines.join('\n');
}

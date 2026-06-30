/**
 * Mini extension to dogfood: re-run and print the actual summary message text
 * after compaction, plus the head/recent split, so we can eyeball quality.
 *
 * Run: pnpm tsx tools/dogfood-inspect-summary.ts
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { createDeepSeekProviderFromEnv } from '../packages/provider/src/index.ts';
import {
  Session,
  loadConfig,
  compactionFromConfig,
  makeTiktokenTokenizer,
  estimateMessagesTokens,
  type CompactionEvent,
} from '../packages/core/src/index.ts';

(function loadDotenv() {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const p of [resolve(process.cwd(), '.env'), resolve(here, '..', '.env')]) {
    if (!existsSync(p)) continue;
    for (const raw of readFileSync(p, 'utf8').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq <= 0) continue;
      const k = line.slice(0, eq).trim();
      let v = line.slice(eq + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (process.env[k] === undefined) process.env[k] = v;
    }
    break;
  }
})();

const home = process.env.X_HARNESS_HOME ?? join(homedir(), '.x_harness-dogfood-2');
mkdirSync(home, { recursive: true });
process.env.DEEPSEEK_MODEL ??= 'deepseek-reasoner';
process.env.DEEPSEEK_AUX_MODEL ??= 'deepseek-chat';

writeFileSync(
  join(home, 'config.json'),
  JSON.stringify({
    compaction: {
      enabled: true,
      threshold: 0.35,
      contextWindow: 8000,
      headN: 2,
      recentN: 4,
    },
  }),
);

const provider = createDeepSeekProviderFromEnv();
const cfg = loadConfig(home);
const block = compactionFromConfig(cfg)!;
const tok = makeTiktokenTokenizer(provider.defaultModel);

const session = new Session({
  provider,
  humanUserId: 'inspect',
  humanSurface: 'cli',
  systemPrompt: 'You are a thoughtful interlocutor. Reply in 2-3 paragraphs of prose.',
  cwd: process.cwd(),
  sessionId: `inspect-${Date.now()}`,
  provenance: { xHarnessHome: home },
  compaction: { config: block.config, tokenize: tok },
});

let compactions: CompactionEvent[] = [];
session.bus.subscribe((ev) => {
  if (ev.kind === 'context.compacted') compactions.push(ev.payload as CompactionEvent);
});

const prompts = [
  'Open: what is the deepest unresolved question about machine memory?',
  'Pick two thinkers (one classical, one modern) and contrast their positions.',
  'Give a concrete contemporary AI example that crystallises the tension.',
  'Steelman the strongest objection to your view.',
  'Rebut that steelman with a 3-step argument.',
  'Connect to a practical engineering decision and recommend an action.',
  'What is the cheapest falsifying experiment? Be specific.',
  'Synthesize: what should a builder remember? 2 short paragraphs.',
];

for (const [i, p] of prompts.entries()) {
  console.log(`\n[turn ${i + 1}] → ${p}`);
  session.pushUser(p);
  let chars = 0;
  for await (const ev of session.streamReply()) {
    if (ev.kind === 'assistant.delta') chars += ev.text.length;
  }
  console.log(`         ← ${chars} chars  tokens=${estimateMessagesTokens(session.snapshot(), tok)}  msgs=${session.snapshot().length}`);
  if (compactions.length > 0) {
    console.log(`\n         🗜  Compaction fired (#${compactions.length}). Inspecting summary...`);
    const msgs = session.snapshot();
    const summaryMsg = msgs.find((m) => m.meta?.compacted === true);
    if (summaryMsg) {
      console.log('\n         ────── SUMMARY MESSAGE ──────');
      const txt = typeof summaryMsg.content === 'string' ? summaryMsg.content : JSON.stringify(summaryMsg.content);
      console.log(txt.split('\n').map((l) => '         │ ' + l).join('\n'));
      console.log('         ─────────────────────────────\n');
    }
    break;
  }
}

console.log('\n=== Final transcript shape ===');
for (const [i, m] of session.snapshot().entries()) {
  const flag = m.meta?.compacted ? ' [SUMMARY]' : m.role === 'system' ? ' [SYS]' : '';
  const head = (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).replace(/\s+/g, ' ').slice(0, 80);
  console.log(`  [${i}] ${m.role.padEnd(10)}${flag}  "${head}..."`);
}

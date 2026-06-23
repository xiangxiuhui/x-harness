/**
 * Smoke test: send one message, render the (possibly tool-using) reply, exit.
 *
 * Usage:
 *   DEEPSEEK_API_KEY=sk-xxx pnpm tsx packages/cli/src/smoke.ts "list files in current dir"
 */

import { loadDotEnv } from './dotenv.js';
import { Session, actorBadge } from '@x_harness/core';
import { createDeepSeekProviderFromEnv } from '@x_harness/provider';
import { buildSkillRegistry } from '@x_harness/skills';
import { findRepoRoot } from './repo.js';

async function main(): Promise<number> {
  loadDotEnv();
  const prompt = process.argv.slice(2).join(' ') || 'say hi in one short sentence.';

  let provider;
  try {
    provider = createDeepSeekProviderFromEnv();
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n`);
    return 1;
  }

  const repoRoot = findRepoRoot(process.cwd());
  const registry = buildSkillRegistry({ repoRoot });
  const session = new Session({
    provider,
    humanUserId: process.env.USER ?? 'human',
    humanSurface: 'cli',
    systemPrompt:
      'You are running inside x_harness. Be very concise. Use tools when needed.',
    skills: registry,
    cwd: process.cwd(),
  });

  process.stdout.write(`${actorBadge(session.humanActor)} > ${prompt}\n`);
  session.pushUser(prompt);
  let started = false;
  for await (const ev of session.streamReply()) {
    switch (ev.kind) {
      case 'assistant.delta':
        if (!started) {
          process.stdout.write(`${actorBadge(session.modelActor)} `);
          started = true;
        }
        process.stdout.write(ev.text);
        break;
      case 'assistant.done':
        if (started) process.stdout.write('\n');
        started = false;
        break;
      case 'tool.call':
        process.stdout.write(
          `\x1b[90m  → tool:${ev.name} ${ev.argumentsJson}\x1b[0m\n`,
        );
        break;
      case 'tool.result':
        process.stdout.write(
          `\x1b[90m  ← tool:${ev.name}${ev.error ? ' (error)' : ''}\x1b[0m\n`,
        );
        break;
      case 'turn.done':
        break;
    }
  }
  return 0;
}

main().then(
  (c) => process.exit(c),
  (e) => {
    process.stderr.write(`\n[fatal] ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  },
);

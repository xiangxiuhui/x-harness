/**
 * Smoke test: send one message, print streaming reply, exit.
 *
 * Usage:
 *   DEEPSEEK_API_KEY=sk-xxx pnpm tsx packages/cli/src/smoke.ts "hello"
 */

import { loadDotEnv } from './dotenv.js';
import { Session, actorBadge } from '@x_harness/core';
import { createDeepSeekProviderFromEnv } from '@x_harness/provider';

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

  const session = new Session({
    provider,
    humanUserId: process.env.USER ?? 'human',
    humanSurface: 'cli',
    systemPrompt: 'You are running inside x_harness. Be very concise.',
  });

  process.stdout.write(
    `${actorBadge(session.humanActor)} > ${prompt}\n${actorBadge(session.modelActor)} `,
  );
  session.pushUser(prompt);
  let any = false;
  for await (const chunk of session.streamReply()) {
    if (chunk.deltaContent) {
      any = true;
      process.stdout.write(chunk.deltaContent);
    }
  }
  process.stdout.write(any ? '\n' : '(no content)\n');
  return 0;
}

main().then(
  (c) => process.exit(c),
  (e) => {
    process.stderr.write(`\n[fatal] ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  },
);

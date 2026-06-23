import * as readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { Session, actorBadge } from '@x_harness/core';
import { createDeepSeekProviderFromEnv } from '@x_harness/provider';

const DEFAULT_SYSTEM_PROMPT =
  "You are running inside x_harness, an AI operating system harness. " +
  "Be concise, useful, and prefer concrete answers.";

export async function runChat(_args: string[]): Promise<number> {
  let provider;
  try {
    provider = createDeepSeekProviderFromEnv();
  } catch (e) {
    stdout.write(`\x1b[31m${(e as Error).message}\x1b[0m\n`);
    return 1;
  }

  const session = new Session({
    provider,
    humanUserId: process.env.USER ?? 'human',
    humanSurface: 'cli',
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
  });

  stdout.write(
    `\n${actorBadge(session.humanActor)} ↔ ${actorBadge(session.modelActor)}\n` +
      `(session ${session.id}; type \`/exit\` to quit, \`/reset\` to clear)\n\n`,
  );

  const rl = readline.createInterface({ input: stdin, output: stdout });
  const ac = new AbortController();
  rl.on('SIGINT', () => {
    ac.abort();
    rl.write('\n[interrupted]\n');
  });

  // eslint-disable-next-line no-constant-condition
  while (true) {
    let input: string;
    try {
      input = (
        await rl.question(`${actorBadge(session.humanActor)} > `)
      ).trim();
    } catch {
      break;
    }
    if (!input) continue;
    if (input === '/exit' || input === '/quit') break;
    if (input === '/reset') {
      stdout.write('[session reset not yet implemented; restart `x chat`]\n');
      continue;
    }

    session.pushUser(input);
    stdout.write(`${actorBadge(session.modelActor)} `);
    try {
      for await (const chunk of session.streamReply(ac.signal)) {
        if (chunk.deltaContent) stdout.write(chunk.deltaContent);
      }
      stdout.write('\n\n');
    } catch (e) {
      stdout.write(`\n\x1b[31m[error] ${(e as Error).message}\x1b[0m\n\n`);
    }
  }

  rl.close();
  stdout.write('bye.\n');
  return 0;
}

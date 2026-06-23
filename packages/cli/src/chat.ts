import * as readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { Session, actorBadge } from '@x_harness/core';
import { createDeepSeekProviderFromEnv } from '@x_harness/provider';

const DEFAULT_SYSTEM_PROMPT =
  "You are running inside x_harness, an AI operating system harness. " +
  "Be concise, useful, and prefer concrete answers.";

const EXIT_WORDS = new Set([
  '/exit',
  '/quit',
  '/q',
  ':q',
  ':quit',
  'exit',
  'quit',
  'bye',
  'q',
]);

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
      `(session ${session.id})\n` +
      `(commands: exit | quit | bye | /reset    keys: Ctrl+C aborts reply, Ctrl+D exits)\n\n`,
  );

  const rl = readline.createInterface({ input: stdin, output: stdout });

  // Per-request abort controller; refreshed every turn so that aborting a
  // streaming reply does NOT poison the next turn.
  let inFlight: AbortController | null = null;

  // Ctrl+C handling:
  //   • during a streaming reply  → abort that one reply
  //   • at the prompt with nothing in flight → exit
  rl.on('SIGINT', () => {
    if (inFlight) {
      inFlight.abort();
    } else {
      stdout.write('\n(Ctrl+C at prompt → bye)\n');
      rl.close();
    }
  });

  // Ctrl+D / EOF → exit gracefully
  let closedByEof = false;
  rl.on('close', () => {
    closedByEof = true;
  });

  while (!closedByEof) {
    let input: string;
    try {
      input = (
        await rl.question(`${actorBadge(session.humanActor)} > `)
      ).trim();
    } catch {
      break;
    }
    if (closedByEof) break;
    if (!input) continue;

    if (EXIT_WORDS.has(input.toLowerCase())) break;
    if (input === '/reset') {
      stdout.write('[session reset not yet implemented; restart `x chat`]\n');
      continue;
    }
    if (input === '/help' || input === '?') {
      stdout.write(
        '  exit | quit | bye | q | :q     — leave\n' +
          '  Ctrl+C during reply           — abort the current reply\n' +
          '  Ctrl+C at prompt              — leave\n' +
          '  Ctrl+D                        — leave\n' +
          '  /reset                        — (not implemented yet)\n',
      );
      continue;
    }

    session.pushUser(input);
    stdout.write(`${actorBadge(session.modelActor)} `);
    inFlight = new AbortController();
    let gotAny = false;
    try {
      for await (const chunk of session.streamReply(inFlight.signal)) {
        if (chunk.deltaContent) {
          gotAny = true;
          stdout.write(chunk.deltaContent);
        }
      }
      stdout.write(gotAny ? '\n\n' : '(no content)\n\n');
    } catch (e) {
      if (inFlight.signal.aborted) {
        stdout.write('\n\x1b[33m[aborted]\x1b[0m\n\n');
      } else {
        stdout.write(`\n\x1b[31m[error] ${(e as Error).message}\x1b[0m\n\n`);
      }
    } finally {
      inFlight = null;
    }
  }

  if (!closedByEof) rl.close();
  stdout.write('bye.\n');
  return 0;
}

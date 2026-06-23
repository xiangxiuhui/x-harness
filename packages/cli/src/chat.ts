import * as readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { Session, actorBadge } from '@x_harness/core';
import { createDeepSeekProviderFromEnv } from '@x_harness/provider';
import { buildSkillRegistry } from '@x_harness/skills';
import { findRepoRoot } from './repo.js';

const DEFAULT_SYSTEM_PROMPT =
  'You are running inside x_harness, an AI operating system harness on macOS. ' +
  'You have access to tools (skills) that let you read/write files, run shell ' +
  'commands, and fetch URLs. Use them whenever the user asks for anything that ' +
  'requires looking at or changing the actual system; do not pretend or guess. ' +
  'Be concise — show output, not commentary.';

const EXIT_WORDS = new Set([
  '/exit', '/quit', '/q', ':q', ':quit', 'exit', 'quit', 'bye', 'q',
]);

const ACTOR_SYSTEM = (text: string) => `\x1b[90m${text}\x1b[0m`;
const TOOL_HEAD = '\x1b[33m';
const TOOL_RES = '\x1b[32m';
const RESET = '\x1b[0m';

export async function runChat(_args: string[]): Promise<number> {
  let provider;
  try {
    provider = createDeepSeekProviderFromEnv();
  } catch (e) {
    stdout.write(`\x1b[31m${(e as Error).message}\x1b[0m\n`);
    return 1;
  }

  const repoRoot = findRepoRoot(process.cwd());
  const registry = buildSkillRegistry({ repoRoot });

  const session = new Session({
    provider,
    humanUserId: process.env.USER ?? 'human',
    humanSurface: 'cli',
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    skills: registry,
    cwd: process.cwd(),
  });

  const skillNames = registry.executable().map((s) => s.frontmatter.name);
  stdout.write(
    `\n${actorBadge(session.humanActor)} ↔ ${actorBadge(session.modelActor)}\n` +
      `(session ${session.id})\n` +
      `(skills: ${skillNames.join(', ') || '<none>'})\n` +
      `(commands: exit | bye | /skills | /help    keys: Ctrl+C aborts reply, Ctrl+D exits)\n\n`,
  );

  const rl = readline.createInterface({ input: stdin, output: stdout });
  let inFlight: AbortController | null = null;
  let closedByEof = false;
  rl.on('close', () => {
    closedByEof = true;
  });
  rl.on('SIGINT', () => {
    if (inFlight) {
      inFlight.abort();
    } else {
      stdout.write('\n(Ctrl+C at prompt → bye)\n');
      rl.close();
    }
  });

  while (!closedByEof) {
    let input: string;
    try {
      input = (await rl.question(`${actorBadge(session.humanActor)} > `)).trim();
    } catch {
      break;
    }
    if (closedByEof) break;
    if (!input) continue;

    if (EXIT_WORDS.has(input.toLowerCase())) break;
    if (input === '/help' || input === '?') {
      stdout.write(
        '  exit | quit | bye | q | :q       — leave\n' +
          '  /skills                          — list available skills\n' +
          '  Ctrl+C during reply              — abort the current reply\n' +
          '  Ctrl+C at prompt                 — leave\n' +
          '  Ctrl+D                           — leave\n',
      );
      continue;
    }
    if (input === '/skills') {
      for (const s of registry.list()) {
        const exe = s.handler ? '✓' : ' ';
        stdout.write(
          `  [${exe}] ${s.frontmatter.name}  (${s.source})\n      ${s.frontmatter.description}\n`,
        );
      }
      continue;
    }

    session.pushUser(input);
    inFlight = new AbortController();
    let assistantStarted = false;
    try {
      for await (const ev of session.streamReply(inFlight.signal)) {
        switch (ev.kind) {
          case 'assistant.delta':
            if (!assistantStarted) {
              stdout.write(`${actorBadge(session.modelActor)} `);
              assistantStarted = true;
            }
            stdout.write(ev.text);
            break;
          case 'assistant.done':
            if (assistantStarted) stdout.write('\n');
            assistantStarted = false;
            break;
          case 'tool.call':
            stdout.write(
              ACTOR_SYSTEM(
                `\n  ${TOOL_HEAD}→ tool:${ev.name}${RESET}  ${truncate(ev.argumentsJson, 200)}\n`,
              ),
            );
            break;
          case 'tool.result': {
            const head = ev.error ? `${TOOL_HEAD}← tool:${ev.name} (error)${RESET}` : `${TOOL_RES}← tool:${ev.name}${RESET}`;
            stdout.write(ACTOR_SYSTEM(`  ${head}\n`));
            stdout.write(indent(truncate(ev.output, 1200), '    ') + '\n');
            break;
          }
          case 'turn.done':
            stdout.write('\n');
            break;
        }
      }
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

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + `… (+${s.length - max} chars)`;
}

function indent(s: string, prefix: string): string {
  return s
    .split('\n')
    .map((l) => prefix + l)
    .join('\n');
}

import { homedir } from 'node:os';
import { join } from 'node:path';
import * as readline from 'node:readline/promises';
import { stdin, stdout, stderr } from 'node:process';
import {
  Session,
  actorBadge,
  type ConfirmDangerHandler,
  type DangerConfirmation,
  type MemorySink,
} from '@x_harness/core';
import { createDeepSeekProviderFromEnv } from '@x_harness/provider';
import { buildSkillRegistry } from '@x_harness/skills';
import { DangerEngine, defaultDangerContext } from '@x_harness/danger';
import { MemoryStore, readSession, replayToMessages } from '@x_harness/memory';
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

const RESET = '\x1b[0m';
const DIM = '\x1b[90m';
const YELLOW = '\x1b[33m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const BOLD_RED = '\x1b[1;31m';

export async function runChat(args: string[]): Promise<number> {
  let resumeId: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '--resume') {
      resumeId = args[i + 1];
      i++;
    } else if (a.startsWith('--resume=')) {
      resumeId = a.slice('--resume='.length);
    } else {
      stderr.write(`unknown chat arg: ${a}\n`);
      return 2;
    }
  }

  let provider;
  try {
    provider = createDeepSeekProviderFromEnv();
  } catch (e) {
    stdout.write(`${RED}${(e as Error).message}${RESET}\n`);
    return 1;
  }

  const repoRoot = findRepoRoot(process.cwd());
  const registry = buildSkillRegistry({ repoRoot });

  const xHarnessHome = process.env.X_HARNESS_HOME ?? join(homedir(), '.x_harness');
  const dangerEngine = new DangerEngine();
  const dangerContext = defaultDangerContext({
    xHarnessHome,
    repoRoot,
    selfPids: [process.pid, process.ppid].filter((n) => n > 0),
    recoverSkillNames: registry
      .list()
      .map((s) => s.frontmatter.name)
      .filter((n) => n.startsWith('recover.')),
  });

  const rl = readline.createInterface({ input: stdin, output: stdout });

  const confirmDanger: ConfirmDangerHandler = async ({ verdict, toolName, args }) =>
    promptConfirm(rl, verdict, toolName, args);

  // Resume support
  let resumeMessages;
  let sessionId;
  if (resumeId) {
    const entries = await readSession(xHarnessHome, resumeId);
    if (entries.length === 0) {
      stdout.write(`${RED}no session found: ${resumeId}${RESET}\n`);
      return 1;
    }
    resumeMessages = replayToMessages(entries);
    sessionId = resumeId;
    stdout.write(`${DIM}(resuming ${resumeId}: ${resumeMessages.length} messages)${RESET}\n`);
  }

  const store = await MemoryStore.open({
    home: xHarnessHome,
    sessionId: sessionId ?? `sess-${Math.random().toString(36).slice(2, 10)}`,
    cwd: process.cwd(),
    userId: process.env.USER ?? 'human',
    model: { provider: provider.name, model: provider.defaultModel },
  });

  // For a resumed session, don't replay session.start; for a fresh one, emit it.
  if (!resumeId) {
    await store.append({
      actor: { kind: 'system', subsystem: 'session' },
      kind: 'session.start',
      payload: {
        sessionId: store.filePath.split('/').slice(-1)[0]!.replace(/\.jsonl$/, ''),
        model: { provider: provider.name, model: provider.defaultModel },
        cwd: process.cwd(),
        xHarnessHome,
      },
    });
  }

  const memorySink: MemorySink = {
    onSystemPrompt: (content) =>
      store.append({
        actor: { kind: 'system', subsystem: 'session' },
        kind: 'system.message',
        payload: { content },
      }),
    onUserMessage: (content) =>
      store.append({
        actor: { kind: 'human', userId: process.env.USER ?? 'human', surface: 'cli' },
        kind: 'user.message',
        payload: { content },
      }),
    onAssistantMessage: (p) =>
      store.append({
        actor: { kind: 'model', provider: provider.name, model: provider.defaultModel },
        kind: 'assistant.message',
        payload: p,
      }),
    onToolCall: (p) =>
      store.append({
        actor: { kind: 'model', provider: provider.name, model: provider.defaultModel },
        kind: 'tool.call',
        payload: p,
      }),
    onToolDanger: (p) =>
      store.append({
        actor: { kind: 'system', subsystem: 'danger-guard' },
        kind: 'tool.danger',
        payload: p,
      }),
    onToolApproval: (p) =>
      store.append({
        actor: { kind: 'human', userId: process.env.USER ?? 'human', surface: 'cli' },
        kind: 'tool.approval',
        payload: p,
      }),
    onToolResult: (p) =>
      store.append({
        actor: { kind: 'skill', name: p.name, source: 'builtin' },
        kind: 'tool.result',
        payload: p,
      }),
  };

  const session = new Session({
    provider,
    humanUserId: process.env.USER ?? 'human',
    humanSurface: 'cli',
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    skills: registry,
    cwd: process.cwd(),
    dangerEngine,
    dangerContext,
    confirmDanger,
    memory: memorySink,
    resumeMessages,
    sessionId: store.filePath.split('/').slice(-1)[0]!.replace(/\.jsonl$/, ''),
  });

  const skillNames = registry.executable().map((s) => s.frontmatter.name);
  stdout.write(
    `\n${actorBadge(session.humanActor)} ↔ ${actorBadge(session.modelActor)}\n` +
      `(session ${session.id})\n` +
      `(skills: ${skillNames.join(', ') || '<none>'})\n` +
      `(guard: ADR-0005, home=${xHarnessHome})\n` +
      `(commands: exit | /skills | /help    keys: Ctrl+C aborts reply, Ctrl+D exits)\n\n`,
  );

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

  let turns = 0;
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
    turns++;
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
              `${DIM}  ${YELLOW}→ tool:${ev.name}${RESET}${DIM}  ${truncate(ev.argumentsJson, 200)}${RESET}\n`,
            );
            break;
          case 'tool.danger':
            // Just a notice; the prompt itself happens in confirmDanger handler.
            // For 'block', no confirmation is asked; show banner.
            if (ev.verdict.decision === 'block') {
              stdout.write(`${BOLD_RED}  ⛔ blocked${RESET} ${ev.verdict.reason}\n`);
            }
            break;
          case 'tool.result': {
            const head = ev.blocked
              ? `${BOLD_RED}← tool:${ev.name} (blocked)${RESET}`
              : ev.error
                ? `${YELLOW}← tool:${ev.name} (error)${RESET}`
                : `${GREEN}← tool:${ev.name}${RESET}`;
            stdout.write(`${DIM}  ${head}${RESET}\n`);
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
        stdout.write(`\n${YELLOW}[aborted]${RESET}\n\n`);
      } else {
        stdout.write(`\n${RED}[error] ${(e as Error).message}${RESET}\n\n`);
      }
    } finally {
      inFlight = null;
    }
  }

  if (!closedByEof) rl.close();
  await store.close(closedByEof ? 'eof' : 'bye', turns);
  stdout.write(`bye.  ${DIM}(audit: ${store.filePath})${RESET}\n`);
  return 0;
}

async function promptConfirm(
  rl: readline.Interface,
  verdict: Extract<
    Awaited<ReturnType<DangerEngine['evaluate']>>,
    { decision: 'confirm' }
  >,
  toolName: string,
  args: Record<string, unknown>,
): Promise<DangerConfirmation> {
  stdout.write(`\n${BOLD_RED}⚠  Danger guard${RESET} ${YELLOW}${verdict.headline}${RESET}\n`);
  stdout.write(`${DIM}    tool: ${toolName}\n    args: ${truncate(JSON.stringify(args), 240)}${RESET}\n`);
  for (const line of verdict.explanation) {
    stdout.write(`    ${YELLOW}•${RESET} ${line}\n`);
  }
  if (verdict.recoveryHints) {
    for (const h of verdict.recoveryHints) {
      stdout.write(`    ${DIM}↻ ${h}${RESET}\n`);
    }
  }
  const classAIds = verdict.hits.filter((h) => h.class === 'A').map((h) => h.ruleId);
  const promptText =
    classAIds.length > 0
      ? `Allow this action? [y]es / [N]o / [a]llow & pre-approve (${classAIds.join(',')}) : `
      : `Allow this action? [y]es / [N]o : `;

  let answer = '';
  try {
    answer = (await rl.question(promptText)).trim().toLowerCase();
  } catch {
    return { decision: 'deny' };
  }
  if (answer === 'y' || answer === 'yes') return { decision: 'allow' };
  if (answer === 'a' || answer === 'all' || answer === 'allow') {
    if (classAIds.length > 0) {
      return { decision: 'allow-and-preapprove', ruleIds: classAIds };
    }
    return { decision: 'allow' };
  }
  return { decision: 'deny' };
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + `… (+${s.length - max} chars)`;
}

function indent(s: string, prefix: string): string {
  return s.split('\n').map((l) => prefix + l).join('\n');
}

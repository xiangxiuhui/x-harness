import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import * as readline from 'node:readline/promises';
import { stdin, stdout, stderr } from 'node:process';
import {
  Session,
  actorBadge,
  loadTerritory,
  buildTerritoryAddendum,
  loadConfig,
  compactionFromConfig,
  makeTiktokenTokenizer,
  actorEventDurability,
  type ConfirmDangerHandler,
  type DangerConfirmation,
  type MemorySink,
  type TerritorySummary,
  type ActorEvent,
  type CompactionEvent,
} from '@x_harness/core';
import { createDeepSeekProviderFromEnv } from '@x_harness/provider';
import { buildSkillRegistry, type Skill } from '@x_harness/skills';
import { DangerEngine, defaultDangerContext } from '@x_harness/danger';
import { MemoryStore, readSession, replayToMessages } from '@x_harness/memory';
import { findRepoRoot } from './repo.js';

const DEFAULT_SYSTEM_PROMPT =
  'You are running inside x_harness, an AI operating system harness on macOS. ' +
  'You have access to builtin tools that let you read/write files, run shell ' +
  'commands, and fetch URLs. Use them whenever the user asks for anything that ' +
  'requires looking at or changing the actual system; do not pretend or guess. ' +
  'Be concise — show output, not commentary.';

/**
 * ADR-0008 progressive-disclosure addendum: list every doc-only skill with
 * its name + description + SKILL.md absolute path. The model decides when
 * to `file.read` the SKILL.md and follow its instructions (typically
 * `shell.run` on bundled scripts).
 */
function skillsAddendum(docSkills: Skill[]): string {
  if (docSkills.length === 0) return '';
  const lines: string[] = [];
  lines.push('');
  lines.push('## Available skills (filesystem-based, agentskills.io standard)');
  lines.push('');
  lines.push('These are knowledge packs you can self-load when relevant:');
  lines.push('');
  for (const s of docSkills) {
    const fm = s.frontmatter;
    const dir = s.dir ?? '';
    const md = dir ? `${dir}/SKILL.md` : '<unknown>';
    lines.push(`- **${fm.name}** — ${fm.description}`);
    lines.push(`  path: ${md}`);
  }
  lines.push('');
  lines.push('To use a skill:');
  lines.push('1. Call `file.read` on the SKILL.md path above to load its instructions into your context.');
  lines.push('2. Follow those instructions. They typically tell you to run bundled scripts via `shell.run` (with absolute paths).');
  lines.push('3. Scripts return stdout via the tool result; the script source itself never enters your context unless you read it.');
  lines.push('Pick a skill only when its description clearly matches the user request; otherwise just use builtin tools directly.');
  return lines.join('\n');
}

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
  let snapshotAndExit = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '--resume') {
      resumeId = args[i + 1];
      i++;
    } else if (a.startsWith('--resume=')) {
      resumeId = a.slice('--resume='.length);
    } else if (a === '--snapshot-and-exit') {
      snapshotAndExit = true;
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

  const xHarnessHome = process.env.X_HARNESS_HOME ?? join(homedir(), '.x_harness');
  // Ensure standard subdirs exist so that `cp -R src ~/.x_harness/skills/`
  // never collapses into a file rename when the target dir is missing.
  for (const sub of ['skills', 'memory', 'evolution']) {
    try { mkdirSync(join(xHarnessHome, sub), { recursive: true }); } catch { /* noop */ }
  }

  const registry = buildSkillRegistry({ repoRoot });

  // ADR-0010 — load (or generate default) territory config; emit banner +
  // system-prompt addendum so the model knows its authorized perimeter.
  const territory = loadTerritory({ xHarnessHome });

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
    // ADR-0010 — record territory authorization snapshot for this session.
    await store.append({
      actor: { kind: 'system', subsystem: 'territory' },
      kind: 'territory.loaded',
      payload: {
        path: territory.path,
        version: territory.version,
        zones: territory.zonePaths,
        generatedDefault: territory.generatedDefault,
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
    onProvenanceAttach: (p) =>
      store.append({
        actor: { kind: 'system', subsystem: 'provenance' },
        kind: 'provenance.attach',
        payload: p,
      }),
  };

  const docSkills = registry.docSkills().filter((s) => s.source !== 'builtin');
  const systemPrompt =
    DEFAULT_SYSTEM_PROMPT + buildTerritoryAddendum(territory) + skillsAddendum(docSkills);

  // ADR-0013 Step 4 — load compaction config from ~/.x_harness/config.json.
  // Default: enabled when the file is present and contains a `compaction` block
  // (or implicitly via `{}` if user wants harness defaults). Absent or
  // `enabled: false` → compaction is off and Session falls back to the
  // existing max-rounds bail safety net.
  const xhConfig = loadConfig(xHarnessHome);
  const compactionBlock = compactionFromConfig(xhConfig);

  const session = new Session({
    provider,
    humanUserId: process.env.USER ?? 'human',
    humanSurface: 'cli',
    systemPrompt,
    skills: registry,
    cwd: process.cwd(),
    dangerEngine,
    dangerContext,
    confirmDanger,
    memory: memorySink,
    resumeMessages,
    sessionId: store.filePath.split('/').slice(-1)[0]!.replace(/\.jsonl$/, ''),
    provenance: { xHarnessHome },
    // No summarizer field → Session auto-builds from provider (auxModel route).
    ...(compactionBlock
      ? {
          compaction: {
            config: compactionBlock.config,
            // ADR-0013 Step 5 — bind tiktoken to the active model so token
            // estimates are accurate (±2% vs ±10% heuristic).
            tokenize: makeTiktokenTokenizer(provider.defaultModel),
          },
        }
      : {}),
  });

  session.bus.subscribe((ev: ActorEvent) => {
    if (actorEventDurability(ev.kind) !== 'audit') return;

    if (ev.kind === 'context.compacted') {
      const payload = ev.payload as CompactionEvent;
      void store.append({
        actor: { kind: 'system', subsystem: 'compaction' },
        kind: 'context.compacted',
        ts: new Date(ev.ts).toISOString(),
        payload,
      });
      stdout.write(
        `${DIM}(context compacted: ${payload.strategy}, ${payload.tokensBefore} → ${payload.tokensAfter} tokens, ${payload.durationMs}ms)${RESET}\n`,
      );
      return;
    }

    if (ev.kind === 'context.snapshot.persisted') {
      const payload = ev.payload as {
        sessionId: string;
        path: string;
        messageCount: number;
        estimatedTokens: number;
        pendingToolCalls: number;
        compactionCount: number;
      };
      void store.append({
        actor: { kind: 'system', subsystem: 'snapshot' },
        kind: 'context.snapshot.persisted',
        ts: new Date(ev.ts).toISOString(),
        payload,
      });
      stdout.write(
        `${DIM}(context snapshot persisted: ${payload.messageCount} messages, ~${payload.estimatedTokens} tokens)${RESET}\n`,
      );
      return;
    }

    if (ev.kind === 'error') {
      const payload = ev.payload as { where: string; message: string; subsystem?: string };
      const subsystem =
        payload.subsystem ?? (ev.actor.kind === 'system' ? ev.actor.subsystem : 'unknown');
      void store.append({
        actor: { kind: 'system', subsystem },
        kind: 'error',
        ts: new Date(ev.ts).toISOString(),
        payload: {
          where: payload.where,
          message: payload.message,
          subsystem,
        },
      });
      stdout.write(
        `${YELLOW}(system event: ${payload.where}${payload.message ? ` — ${payload.message}` : ''})${RESET}\n`,
      );
    }
  });

  const skillNames = registry.executable().map((s) => s.frontmatter.name);
  const docNames = docSkills.map((s) => s.frontmatter.name);
  const territoryNote = territory.generatedDefault
    ? `${YELLOW}created default${RESET}`
    : `${territory.zonePaths.length} zone(s)`;

  if (snapshotAndExit) {
    const snap = session.takeSnapshot();
    const file = await session.persistSnapshot();
    if (file) {
      stdout.write(
        `${GREEN}snapshot persisted${RESET}: ${file}\n` +
          `  session=${session.id}, messages=${snap.messageCount}, estimatedTokens=${snap.estimatedTokens}, pendingToolCalls=${snap.pendingToolCalls}, compactions=${snap.compactionCount}\n`,
      );
    } else {
      stdout.write(`${YELLOW}snapshot not persisted (missing xHarnessHome or write failed)${RESET}\n`);
    }
    await store.close('bye', 0);
    stdout.write(`bye.  ${DIM}(audit: ${store.filePath})${RESET}\n`);
    return file ? 0 : 1;
  }

  stdout.write(
    `\n${actorBadge(session.humanActor)} ↔ ${actorBadge(session.modelActor)}\n` +
      `(session ${session.id})\n` +
      `(tools: ${skillNames.join(', ') || '<none>'})\n` +
      `(doc-skills: ${docNames.join(', ') || '<none>'})\n` +
      `(territory: ${territoryNote}, ${territory.path})\n` +
      `(guard: ADR-0005, home=${xHarnessHome})\n` +
      `(compaction: ${compactionBlock ? `${compactionBlock.config.threshold} threshold, ${compactionBlock.config.contextWindow} ctx window` : 'off (no config)'})\n` +
      `(commands: exit | /skills | /snapshot | /help    keys: Ctrl+C aborts reply, Ctrl+D exits)\n\n`,
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
          '  /snapshot                        — persist a runtime context snapshot\n' +
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
    if (input === '/snapshot') {
      const snap = session.takeSnapshot();
      const file = await session.persistSnapshot();
      if (file) {
        stdout.write(
          `${GREEN}snapshot persisted${RESET}: ${file}\n` +
            `  messages=${snap.messageCount}, estimatedTokens=${snap.estimatedTokens}, pendingToolCalls=${snap.pendingToolCalls}, compactions=${snap.compactionCount}\n`,
        );
      } else {
        stdout.write(`${YELLOW}snapshot not persisted (missing xHarnessHome or write failed)${RESET}\n`);
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
  // Class B path-prefix pre-approval: extract the target directory from
  // the first Class B hit's evidence.path, trimming to the parent directory.
  // This lets the user say "allow all writes to this skill directory".
  const classBPaths = verdict.hits
    .filter((h) => h.class === 'B' && h.evidence?.path)
    .map((h) => String(h.evidence!.path));
  const classBDir = classBPaths.length > 0 ? parentDirOf(classBPaths[0]!) : null;

  let promptText: string;
  const options: string[] = ['y', 'N'];
  if (classAIds.length > 0) {
    promptText = `Allow this action? [y]es / [N]o / [a]llow & pre-approve (${classAIds.join(',')}) : `;
    options.push('a');
  } else if (classBDir) {
    promptText = `Allow this action? [y]es / [N]o / [p]re-approve path (${truncate(classBDir, 50)}) : `;
    options.push('p');
  } else {
    promptText = `Allow this action? [y]es / [N]o : `;
  }

  // Loop on unrecognised input so a typo like "yew" doesn't silently deny.
  // Empty / "n" / "no" still mean deny — that's the [N] default.
  for (let attempt = 0; attempt < 3; attempt++) {
    let answer = '';
    try {
      answer = (await rl.question(promptText)).trim().toLowerCase();
    } catch {
      return { decision: 'deny' };
    }
    if (answer === '' || answer === 'n' || answer === 'no') return { decision: 'deny' };
    if (answer === 'y' || answer === 'yes') return { decision: 'allow' };
    if (answer === 'a' || answer === 'all' || answer === 'allow') {
      if (classAIds.length > 0) {
        return { decision: 'allow-and-preapprove', ruleIds: classAIds };
      }
      return { decision: 'allow' };
    }
    if (answer === 'p' || answer === 'preapprove' || answer === 'path') {
      if (classBDir) {
        return { decision: 'allow-and-path-preapprove', pathPrefix: classBDir };
      }
      return { decision: 'allow' };
    }
    stdout.write(
      `${YELLOW}  ?${RESET} unrecognised "${answer}" — please answer y / n${options.length > 2 ? ` / ${options[2]}` : ''}.\n`,
    );
  }
  return { decision: 'deny' };
}

/** Return the parent directory of a path (everything up to the last /). */
function parentDirOf(p: string): string {
  const slash = p.lastIndexOf('/');
  return slash > 0 ? p.slice(0, slash + 1) : p;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + `… (+${s.length - max} chars)`;
}

function indent(s: string, prefix: string): string {
  return s.split('\n').map((l) => prefix + l).join('\n');
}

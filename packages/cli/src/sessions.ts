import { homedir } from 'node:os';
import { join } from 'node:path';
import { stdout, stderr } from 'node:process';
import { listSessions, readSession, digestEntry } from '@x_harness/memory';

const DIM = '\x1b[90m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

function home(): string {
  return process.env.X_HARNESS_HOME ?? join(homedir(), '.x_harness');
}

export async function runSessions(args: string[]): Promise<number> {
  const [sub, ...rest] = args;
  switch (sub) {
    case undefined:
    case 'ls':
      return cmdLs();
    case 'show':
      return cmdShow(rest[0]);
    default:
      stderr.write(`unknown sessions subcommand: ${sub}\n`);
      return 2;
  }
}

async function cmdLs(): Promise<number> {
  const rows = await listSessions(home());
  if (rows.length === 0) {
    stdout.write('(no sessions recorded yet — run `x chat` first)\n');
    return 0;
  }
  stdout.write(
    `${BOLD}${'session id'.padEnd(18)} ${'started'.padEnd(19)} ${'turns'.padStart(5)}  cwd${RESET}\n`,
  );
  for (const r of rows) {
    const open = r.endedAt ? '' : ' (active)';
    stdout.write(
      `${r.sessionId.padEnd(18)} ${r.startedAt.slice(0, 19).replace('T', ' ').padEnd(19)} ${String(r.userTurns).padStart(5)}  ${r.cwd}${DIM}${open}${RESET}\n`,
    );
  }
  return 0;
}

async function cmdShow(id?: string): Promise<number> {
  if (!id) {
    stderr.write('usage: x sessions show <id>\n');
    return 2;
  }
  const entries = await readSession(home(), id);
  if (entries.length === 0) {
    stderr.write(`no entries for session ${id}\n`);
    return 1;
  }
  for (const e of entries) stdout.write(digestEntry(e) + '\n');
  return 0;
}

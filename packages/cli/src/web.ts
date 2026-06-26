/**
 * `x web` — start the local read-only Web UI.
 *
 * Surface Parity (ADR-0011): the web server is a renderer of the same
 * memory/territory/skills sources the CLI reads. We deliberately reuse the
 * same loaders here (skills registry, $X_HARNESS_HOME) so behaviour cannot
 * silently diverge between surfaces.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { stdout, stderr } from 'node:process';

import { buildSkillRegistry } from '@x_harness/skills';
import { startWebServer } from '@x_harness/web';

import { findRepoRoot } from './repo.js';

const USAGE = `Usage: x web [--port N] [--host H]

Defaults:
  --port 7878
  --host 127.0.0.1   (loopback only — your $USER owns the socket)

The server is read-only in v0:
  GET /              SPA shell
  GET /api/sessions  list sessions
  GET /api/sessions/<id>       transcript
  GET /api/sessions/<id>/tail  live SSE
  GET /api/territory           ADR-0010 perimeter
  GET /api/skills              loaded skills (parity with /skills slash command)
`;

export async function runWeb(args: string[]): Promise<number> {
  let port = 7878;
  let host = '127.0.0.1';
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '--port') {
      port = Number(args[++i]);
    } else if (a.startsWith('--port=')) {
      port = Number(a.slice('--port='.length));
    } else if (a === '--host') {
      host = args[++i] ?? host;
    } else if (a.startsWith('--host=')) {
      host = a.slice('--host='.length);
    } else if (a === '-h' || a === '--help') {
      stdout.write(USAGE);
      return 0;
    } else {
      stderr.write(`unknown web arg: ${a}\n\n${USAGE}`);
      return 2;
    }
  }
  if (!Number.isFinite(port) || port <= 0 || port > 65535) {
    stderr.write(`invalid port: ${port}\n`);
    return 2;
  }

  const home = process.env.X_HARNESS_HOME ?? join(homedir(), '.x_harness');
  const repoRoot = findRepoRoot(process.cwd());
  const skills = buildSkillRegistry({ repoRoot });

  let handle;
  try {
    handle = await startWebServer({ home, port, host, skills, version: '0.0.1' });
  } catch (e) {
    stderr.write(`failed to start web server: ${(e as Error).message}\n`);
    return 1;
  }

  stdout.write(
    `\nx_harness web ready\n` +
      `  ${handle.url}\n` +
      `  home   = ${home}\n` +
      `  skills = ${skills.list().length} loaded (${skills.executable().length} executable, ${skills.docSkills().length} doc)\n` +
      `  parity : same loaders as \`x chat\` and \`x sessions\`\n` +
      `  Ctrl+C to stop.\n\n`,
  );

  // Block until SIGINT.
  await new Promise<void>((resolve) => {
    const onSig = (): void => resolve();
    process.once('SIGINT', onSig);
    process.once('SIGTERM', onSig);
  });

  await handle.close();
  stdout.write('web server closed.\n');
  return 0;
}

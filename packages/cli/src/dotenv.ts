/**
 * Tiny .env loader. We don't want a dependency for this in spiral 1.
 *
 * Search order:
 *   1. $X_HARNESS_ENV_FILE (if set)
 *   2. ./.env  (cwd)
 *   3. <repo-root>/.env  (3 levels up from this file when running from source)
 *
 * Only KEY=VALUE lines are parsed. # comments and blank lines are ignored.
 * Values may be optionally wrapped in single or double quotes.
 * Existing env vars are NOT overridden.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export function loadDotEnv(): void {
  const candidates: string[] = [];
  if (process.env.X_HARNESS_ENV_FILE) {
    candidates.push(process.env.X_HARNESS_ENV_FILE);
  }
  candidates.push(resolve(process.cwd(), '.env'));
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    // packages/cli/src -> packages/cli -> packages -> <repo>
    candidates.push(resolve(here, '..', '..', '..', '.env'));
  } catch {
    // ignore
  }

  for (const p of candidates) {
    if (!p || !existsSync(p)) continue;
    try {
      applyEnvFromText(readFileSync(p, 'utf8'));
      return;
    } catch {
      // ignore unreadable files
    }
  }
}

function applyEnvFromText(text: string): void {
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = val;
    }
  }
}

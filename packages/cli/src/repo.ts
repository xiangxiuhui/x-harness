import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/** Walk up from `start` looking for a pnpm-workspace.yaml; return the directory or undefined. */
export function findRepoRoot(start: string): string | undefined {
  let cur = resolve(start);
  for (let i = 0; i < 20; i++) {
    if (existsSync(resolve(cur, 'pnpm-workspace.yaml'))) return cur;
    const parent = dirname(cur);
    if (parent === cur) return undefined;
    cur = parent;
  }
  return undefined;
}

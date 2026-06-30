/**
 * x_harness — runtime config.
 *
 * Single file: `<xHarnessHome>/config.json`. All keys optional. Unknown keys
 * are preserved on save (we never destroy fields we don't recognise — a key
 * harness invariant since users + future versions may add fields).
 *
 * Today only the `compaction` section is read; more sections (logging,
 * model routing, …) will land here in later spirals.
 *
 * Schema (all optional, see ADR-0013 for semantics):
 *
 *   {
 *     "compaction": {
 *       "enabled": true,
 *       "threshold": 0.7,
 *       "contextWindow": 64000,
 *       "headN": 5,
 *       "recentN": 10,
 *       "toolOutputMaxTokens": 4096
 *     }
 *   }
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { CompactionConfig } from './compaction/index.js';

export interface XHarnessConfig {
  /** Compaction tunables (ADR-0013). */
  compaction?: Partial<CompactionConfig> & { enabled?: boolean };
  /** Reserved for future sections; preserved on read. */
  [key: string]: unknown;
}

/** Resolve the canonical config path. */
export function configPathOf(xHarnessHome: string): string {
  return join(xHarnessHome, 'config.json');
}

/**
 * Load `<xHarnessHome>/config.json`. Returns an empty object when the file
 * is missing or unparseable. Never throws.
 */
export function loadConfig(xHarnessHome: string): XHarnessConfig {
  const path = configPathOf(xHarnessHome);
  if (!existsSync(path)) return {};
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as XHarnessConfig;
    }
    return {};
  } catch {
    return {};
  }
}

/**
 * Extract the compaction options as `SessionOptions['compaction']` shape.
 *
 * Returns `undefined` when:
 *   - config.compaction is missing entirely → caller should NOT enable compaction
 *   - config.compaction.enabled === false   → explicitly disabled
 *
 * Returns the partial config otherwise (Session auto-builds provider summarizer
 * when no explicit summarizer is supplied, see ADR-0013 F1).
 */
export function compactionFromConfig(
  cfg: XHarnessConfig,
): { config: Partial<CompactionConfig>; enabled: boolean } | undefined {
  const c = cfg.compaction;
  if (!c) return undefined;
  if (c.enabled === false) return undefined;
  // Strip the 'enabled' field; rest is Partial<CompactionConfig>.
  const { enabled: _enabled, ...rest } = c;
  return { config: rest, enabled: true };
}

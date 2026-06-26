/**
 * Territory configuration loader (ADR-0010).
 *
 * Spiral 2/2a (this commit): only owns
 *   - default config generation on first run
 *   - reading the raw text for system-prompt injection
 *   - extracting zone paths via minimal regex (for banner + prompt addendum)
 *
 * Spiral 2/2b will replace the regex shim with a real YAML parser and add
 * patrol/snapshot logic. We deliberately do NOT introduce a YAML dependency
 * here — the file is a human-edited config, not a hot path.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

export const TERRITORY_FILENAME = 'territory.yaml';

/** Resolved territory snapshot for prompt/banner use (subset, not the full schema). */
export interface TerritorySummary {
  /** Absolute path to the territory.yaml file. */
  path: string;
  /** Raw YAML text (verbatim). */
  raw: string;
  /** True if this run had to generate the default. */
  generatedDefault: boolean;
  /** Top-level `path:` values under `zones:` — expanded with $HOME. */
  zonePaths: string[];
  /** Schema version (from `version: N`); null if unparseable. */
  version: number | null;
}

/**
 * The conservative default written on first run.
 *
 * Why so narrow: we only claim what the AI itself owns (~/.x_harness). Any
 * wider territory is an explicit human grant (edit this file).
 */
export function buildDefaultTerritoryYaml(now: Date = new Date()): string {
  const iso = now.toISOString();
  return `# ~/.x_harness/territory.yaml
# AI 的授权领地配置（ADR-0010）。领地由你（人类）授予；AI 无法自行扩张。
# 文件版本：1
# 生成时间：${iso}
#
# 默认是最保守的："只巡 AI 自家"。想让 AI 感知更广的世界，
# 显式添加 zone（如 ~/Documents、具体项目目录等）。
#
# 编辑此文件后，下次 \`x chat\` 启动时生效（spiral 2 暂不 hot-reload）。

version: 1

# ─── 巡逻领地 ───────────────────────────────────────────
# 每个 zone 一个对象。AI 只会扫描这些路径。
zones:
  - path: ~/.x_harness
    depth: infinite
    hash: sha256
    interval: 1h
    notify: alert

# ─── 黑名单 ────────────────────────────────────────────
# zone 内符合这些 glob 的路径不入快照
ignore:
  - "**/node_modules/**"
  - "**/.git/objects/**"
  - "**/.DS_Store"
  - "**/*.swp"
  - "**/.venv/**"
  - "**/__pycache__/**"
  - "**/dist/**"
  - "**/build/**"
  - "**/target/**"
  - "**/.next/**"

# ─── 通知机制 ──────────────────────────────────────────
# silent / on_resume (默认) / inline / alert
notify_policy:
  default: on_resume
  per_zone_override:
    "~/.x_harness": alert

# ─── 巡逻调度 ──────────────────────────────────────────
# 部分字段 spiral 3+ 生效；spiral 2 只读取，不动作。
schedule:
  idle_trigger: true
  idle_threshold: 5m
  on_resume: true
  on_session_start: false
  scheduled_via_launchd: false

# ─── 隐私与脱敏 ────────────────────────────────────────
privacy:
  hash_only: false
  per_zone_hash_only: {}
  redact_paths_in_jsonl: false

# ─── 自我保护 ──────────────────────────────────────────
# observe / warn (默认) / require_explain
self_integrity:
  on_self_modified: warn
  protected_paths:
    - ~/.x_harness/danger
    - ~/.x_harness/memory
    - ~/.x_harness/territory.yaml
`;
}

/** Expand a leading `~` (with or without `/`) to $HOME. */
export function expandHome(p: string, home: string = homedir()): string {
  if (p === '~') return home;
  if (p.startsWith('~/')) return join(home, p.slice(2));
  return p;
}

/**
 * Spiral 2/2a parser shim: only pulls the fields we currently need without
 * adding a YAML dep. Heuristic regex on a well-known shape. Will be replaced
 * by a proper parser in spiral 2/2b. Stays defensive: any parse failure
 * yields zonePaths=[] and version=null instead of throwing.
 */
function shallowParse(raw: string): { zonePaths: string[]; version: number | null } {
  const lines = raw.split(/\r?\n/);
  let version: number | null = null;
  const zonePaths: string[] = [];
  let inZones = false;
  for (const line of lines) {
    const m1 = /^\s*version:\s*(\d+)\s*(#.*)?$/.exec(line);
    if (m1) {
      const v = Number(m1[1]);
      if (!Number.isNaN(v)) version = v;
      continue;
    }
    if (/^zones\s*:\s*(#.*)?$/.test(line)) {
      inZones = true;
      continue;
    }
    // Leaving zones block: another top-level key starts (no leading space + colon)
    if (inZones && /^[A-Za-z_][A-Za-z0-9_]*\s*:/.test(line)) {
      inZones = false;
    }
    if (inZones) {
      const m2 = /^\s*-?\s*path:\s*(.+?)\s*(#.*)?$/.exec(line);
      if (m2) {
        let p = m2[1]!.trim();
        // strip surrounding quotes if present
        if (
          (p.startsWith('"') && p.endsWith('"')) ||
          (p.startsWith("'") && p.endsWith("'"))
        ) {
          p = p.slice(1, -1);
        }
        zonePaths.push(expandHome(p));
      }
    }
  }
  return { zonePaths, version };
}

export interface LoadTerritoryOptions {
  /** Directory of the harness home (e.g. `~/.x_harness`). */
  xHarnessHome: string;
  /** Override now() for tests. */
  now?: Date;
}

/**
 * Load (or first-time generate) the territory config.
 *
 * Idempotent and side-effecting: writes a default config if missing. Never
 * throws on parse — degrades to empty zonePaths.
 */
export function loadTerritory(opts: LoadTerritoryOptions): TerritorySummary {
  const path = join(opts.xHarnessHome, TERRITORY_FILENAME);
  let generatedDefault = false;

  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, buildDefaultTerritoryYaml(opts.now ?? new Date()), 'utf8');
    generatedDefault = true;
  }

  const raw = readFileSync(path, 'utf8');
  const { zonePaths, version } = shallowParse(raw);

  return { path, raw, generatedDefault, zonePaths, version };
}

/** Build a system-prompt addendum that tells the model its authorized territory. */
export function buildTerritoryAddendum(t: TerritorySummary): string {
  const lines: string[] = [];
  lines.push('');
  lines.push('## Authorized territory (ADR-0010)');
  lines.push('');
  lines.push(
    'The following filesystem zones are the territory the human has authorized you to perceive and patrol. ' +
      'You may NOT extend this list yourself; if you believe a new path should be added, ask the human to ' +
      `edit ${t.path}.`,
  );
  lines.push('');
  if (t.zonePaths.length === 0) {
    lines.push('- (no zones parsed — territory.yaml may be malformed)');
  } else {
    for (const p of t.zonePaths) {
      lines.push(`- ${p}`);
    }
  }
  lines.push('');
  lines.push(
    'Outside these zones, you can still use tools (shell.run / file.*), but you should treat the rest of the ' +
      'system as "out of your watch" — you do not maintain awareness of it. The harness only patrols and ' +
      'snapshots within the zones above (spiral 2/2b).',
  );
  return lines.join('\n');
}

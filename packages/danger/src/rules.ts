/**
 * Default rule set v0 (ADR 0005 §"Class A 规则集 v0" + "Class B 规则集 v0").
 *
 * Each rule is a small pure function. New rules add new files / entries.
 */

import { isAbsolute, normalize, resolve } from 'node:path';
import { homedir } from 'node:os';
import type { DangerContext, DangerRule, ProposedAction, RuleHit } from './types.js';
import { parseShellCommand } from './shell-parse.js';

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

function expandTilde(p: string): string {
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return resolve(homedir(), p.slice(2));
  return p;
}

function absolutize(p: string, cwd?: string): string {
  const e = expandTilde(p);
  if (isAbsolute(e)) return normalize(e);
  return normalize(resolve(cwd ?? process.cwd(), e));
}

function pathIsInside(child: string, parent: string): boolean {
  if (!child || !parent) return false;
  const c = normalize(child);
  const p = normalize(parent);
  if (c === p) return true;
  const withSlash = p.endsWith('/') ? p : p + '/';
  return c.startsWith(withSlash);
}

/** Quick "command name" extractor that strips path: '/usr/bin/rm' → 'rm'. */
function basenameOf(cmd: string): string {
  const slash = cmd.lastIndexOf('/');
  return slash >= 0 ? cmd.slice(slash + 1) : cmd;
}

/* -------------------------------------------------------------------------- */
/*  Class A rules — human accounts / money / outbound identity                */
/* -------------------------------------------------------------------------- */

/**
 * A1: skill name pattern indicates payment / checkout / purchase.
 *
 * Builtin spiral 1 has no such skills, but user-installed ones might.
 */
export const ruleA1Payment: DangerRule = {
  id: 'A1.payment-skill',
  class: 'A',
  describe:
    'Calling a skill whose name suggests payment, checkout, purchase, or order placement.',
  check(action: ProposedAction): RuleHit[] {
    if (action.kind !== 'tool-call') return [];
    const n = action.toolName.toLowerCase();
    if (/(^|[._-])(pay|payment|checkout|purchase|order|invoice|charge)([._-]|$)/.test(n)) {
      return [
        {
          ruleId: this.id,
          class: 'A',
          reason: `Skill name '${action.toolName}' looks payment-related.`,
          evidence: { toolName: action.toolName },
        },
      ];
    }
    return [];
  },
};

/**
 * A2: skill name pattern indicates posting under a human identity.
 *
 * (email / im / social / publish). Builtin spiral 1 has none.
 */
export const ruleA2HumanPost: DangerRule = {
  id: 'A2.human-identity-post',
  class: 'A',
  describe:
    'Calling a skill that posts/sends under a human identity (email, IM, social, publish).',
  check(action: ProposedAction): RuleHit[] {
    if (action.kind !== 'tool-call') return [];
    const n = action.toolName.toLowerCase();
    if (
      /(^|[._-])(send_email|sendmail|email_send|im_send|sms_send|slack_post|tweet|publish_post|wechat_send)([._-]|$)/.test(
        n,
      )
    ) {
      return [
        {
          ruleId: this.id,
          class: 'A',
          reason: `Skill '${action.toolName}' posts under a human identity.`,
          evidence: { toolName: action.toolName },
        },
      ];
    }
    return [];
  },
};

/**
 * A3: `git push --force` (or `-f`) to a remote that looks shared (origin /
 * upstream / team / org).
 */
export const ruleA3GitForcePushShared: DangerRule = {
  id: 'A3.git-force-push-shared',
  class: 'A',
  describe:
    'git push --force / --force-with-lease to a shared remote (origin/upstream/team/org).',
  check(action: ProposedAction): RuleHit[] {
    if (action.kind !== 'tool-call' || action.toolName !== 'shell.run') return [];
    const cmd = String(action.args?.command ?? '');
    if (!cmd) return [];
    const stmts = parseShellCommand(cmd);
    const hits: RuleHit[] = [];
    for (const s of stmts) {
      const [c0, ...rest] = s.argv;
      if (!c0 || basenameOf(c0) !== 'git') continue;
      if (rest[0] !== 'push') continue;
      const hasForce = rest.some(
        (a) => a === '-f' || a === '--force' || a.startsWith('--force-with-lease'),
      );
      if (!hasForce) continue;
      // remote name heuristic: first non-flag after 'push'
      const nonFlags = rest.slice(1).filter((a) => !a.startsWith('-'));
      const remote = nonFlags[0];
      if (!remote) {
        hits.push({
          ruleId: this.id,
          class: 'A',
          reason: 'git push --force without explicit remote (defaults to upstream).',
          evidence: { command: cmd },
        });
        continue;
      }
      if (/^(origin|upstream|team|org|company|main|prod)/i.test(remote)) {
        hits.push({
          ruleId: this.id,
          class: 'A',
          reason: `git push --force to shared-looking remote '${remote}'.`,
          evidence: { command: cmd, remote },
        });
      }
    }
    return hits;
  },
};

/* -------------------------------------------------------------------------- */
/*  Class B rules — x_harness self-preservation                               */
/* -------------------------------------------------------------------------- */

/**
 * B1: file.write / file.read into x_harness home (except scratch).
 */
export const ruleB1WriteXHarnessHome: DangerRule = {
  id: 'B1.write-x_harness-home',
  class: 'B',
  describe: 'Writing into ~/.x_harness/** (except /scratch).',
  recoverableBy: ['recover.x_harness_home'],
  check(action: ProposedAction, ctx: DangerContext): RuleHit[] {
    if (action.kind !== 'tool-call') return [];
    if (action.toolName !== 'file.write') return [];
    const p = String(action.args?.path ?? '');
    if (!p) return [];
    const abs = absolutize(p, action.cwd);
    if (!ctx.xHarnessHome) return [];
    const scratch = `${ctx.xHarnessHome}/scratch`;
    if (pathIsInside(abs, ctx.xHarnessHome) && !pathIsInside(abs, scratch)) {
      return [
        {
          ruleId: this.id,
          class: 'B',
          reason: `Writing into ${abs} would mutate x_harness' own state.`,
          evidence: { path: abs, home: ctx.xHarnessHome },
        },
      ];
    }
    return [];
  },
};

/**
 * B2: any `rm` / `mv` / `cp -f` / `>` redirection / sed -i that targets
 * x_harness home (non-scratch), repo root, or "self binary" paths.
 */
export const ruleB2ShellTouchesSelf: DangerRule = {
  id: 'B2.shell-touches-self',
  class: 'B',
  describe:
    'Shell command targets x_harness home, repo root, or other self-preservation paths.',
  recoverableBy: ['recover.x_harness_home'],
  check(action: ProposedAction, ctx: DangerContext): RuleHit[] {
    if (action.kind !== 'tool-call' || action.toolName !== 'shell.run') return [];
    const cmd = String(action.args?.command ?? '');
    if (!cmd) return [];
    const stmts = parseShellCommand(cmd);
    const hits: RuleHit[] = [];

    const selfRoots = [ctx.xHarnessHome, ctx.repoRoot]
      .filter((p): p is string => !!p)
      .map((p) => normalize(p));
    const scratch = ctx.xHarnessHome ? `${ctx.xHarnessHome}/scratch` : '';

    const flag = (path: string, kind: string) => {
      const abs = absolutize(path, action.cwd);
      for (const root of selfRoots) {
        if (!pathIsInside(abs, root)) continue;
        if (scratch && pathIsInside(abs, scratch)) continue;
        hits.push({
          ruleId: this.id,
          class: 'B',
          reason: `${kind} would affect self-preservation path: ${abs} (inside ${root}).`,
          evidence: { path: abs, root, kind, command: cmd },
        });
      }
    };

    for (const s of stmts) {
      const [c0, ...rest] = s.argv;
      if (!c0) continue;
      const cmdName = basenameOf(c0);

      if (cmdName === 'rm') {
        for (const a of rest) {
          if (a.startsWith('-')) continue;
          flag(a, 'rm');
        }
      } else if (cmdName === 'mv' || cmdName === 'cp') {
        // any operand that is inside self counts; destructive for mv, overwrite for cp
        for (const a of rest) {
          if (a.startsWith('-')) continue;
          flag(a, cmdName);
        }
      } else if (cmdName === 'sed') {
        // sed -i ... files
        const hasInplace = rest.some(
          (a) => a === '-i' || a.startsWith("-i'") || a.startsWith('-i"') || a.startsWith('-iE') || a === "-i''",
        );
        if (hasInplace) {
          for (const a of rest) {
            if (a.startsWith('-')) continue;
            if (a.startsWith('s/') || a.startsWith('/')) continue; // sed expression heuristic
            flag(a, 'sed -i');
          }
        }
      } else if (cmdName === 'tee' || cmdName === 'cat') {
        // tee → writes; cat → only matters with redirection (handled below)
        if (cmdName === 'tee') {
          for (const a of rest) {
            if (a.startsWith('-')) continue;
            flag(a, 'tee');
          }
        }
      } else if (cmdName === 'truncate' || cmdName === 'shred' || cmdName === 'dd') {
        for (const a of rest) {
          if (a.startsWith('-')) continue;
          if (cmdName === 'dd') {
            // only `of=` targets count as "writing to that file"
            if (a.startsWith('of=')) flag(a.slice(3), 'dd of=');
          } else flag(a, cmdName);
        }
      }

      // crude redirection scan: > / >> / 2> / 2>>
      for (let k = 0; k < s.argv.length - 1; k++) {
        const a = s.argv[k]!;
        if (a === '>' || a === '>>' || a === '2>' || a === '2>>') {
          const tgt = s.argv[k + 1]!;
          if (!tgt.startsWith('-')) flag(tgt, `redirect ${a}`);
        } else {
          // glued form like `>file` — basic check
          const m = a.match(/^(>>|2>>|2>|>)(.+)$/);
          if (m) flag(m[2]!, `redirect ${m[1]}`);
        }
      }
    }

    return hits;
  },
};

/**
 * B3: kill -9 (or kill) on a PID in our own process tree.
 */
export const ruleB3KillSelf: DangerRule = {
  id: 'B3.kill-self',
  class: 'B',
  describe: 'kill / kill -9 targeting a PID in x_harness own process tree.',
  check(action: ProposedAction, ctx: DangerContext): RuleHit[] {
    if (action.kind !== 'tool-call' || action.toolName !== 'shell.run') return [];
    const cmd = String(action.args?.command ?? '');
    const stmts = parseShellCommand(cmd);
    const hits: RuleHit[] = [];
    const self = new Set(ctx.selfPids.map(String));
    for (const s of stmts) {
      const [c0, ...rest] = s.argv;
      if (!c0) continue;
      if (basenameOf(c0) !== 'kill' && basenameOf(c0) !== 'pkill') continue;
      for (const a of rest) {
        if (a.startsWith('-')) continue;
        if (/^\d+$/.test(a) && self.has(a)) {
          hits.push({
            ruleId: this.id,
            class: 'B',
            reason: `Killing PID ${a} which is in our own process tree.`,
            evidence: { pid: Number(a), command: cmd },
          });
        }
      }
    }
    return hits;
  },
};

/**
 * B4: modifying /etc/hosts to shadow the model provider host.
 */
export const ruleB4HostsShadowProvider: DangerRule = {
  id: 'B4.hosts-shadow-provider',
  class: 'B',
  describe: 'Modifying /etc/hosts in a way that would shadow our LLM provider host.',
  check(action: ProposedAction, ctx: DangerContext): RuleHit[] {
    if (action.kind !== 'tool-call') return [];
    const hits: RuleHit[] = [];

    if (action.toolName === 'file.write') {
      const p = absolutize(String(action.args?.path ?? ''), action.cwd);
      if (p === '/etc/hosts' || p === '/private/etc/hosts') {
        const content = String(action.args?.content ?? '');
        for (const host of ctx.providerHosts) {
          if (content.includes(host)) {
            hits.push({
              ruleId: this.id,
              class: 'B',
              reason: `Writing /etc/hosts mentioning provider host '${host}'.`,
              evidence: { path: p, host },
            });
          }
        }
      }
    }

    if (action.toolName === 'shell.run') {
      const cmd = String(action.args?.command ?? '');
      if (/\/etc\/hosts/.test(cmd)) {
        for (const host of ctx.providerHosts) {
          if (cmd.includes(host)) {
            hits.push({
              ruleId: this.id,
              class: 'B',
              reason: `Shell command touches /etc/hosts and mentions provider host '${host}'.`,
              evidence: { host, command: cmd },
            });
          }
        }
      }
    }

    return hits;
  },
};

/**
 * B5: clearing x_harness-owned keychain entries.
 */
export const ruleB5KeychainWipe: DangerRule = {
  id: 'B5.keychain-wipe',
  class: 'B',
  describe: 'Deleting / overwriting x_harness-owned keychain entries.',
  check(action: ProposedAction, ctx: DangerContext): RuleHit[] {
    if (action.kind !== 'tool-call' || action.toolName !== 'shell.run') return [];
    const cmd = String(action.args?.command ?? '');
    if (!cmd.includes('security')) return [];
    if (!/(delete-generic-password|delete-internet-password)/.test(cmd)) return [];
    const hits: RuleHit[] = [];
    for (const prefix of ctx.keychainPrefixes) {
      if (cmd.includes(prefix)) {
        hits.push({
          ruleId: this.id,
          class: 'B',
          reason: `Removing a keychain entry under '${prefix}*'.`,
          evidence: { prefix, command: cmd },
        });
      }
    }
    return hits;
  },
};

/* -------------------------------------------------------------------------- */
/*  Default rule list                                                         */
/* -------------------------------------------------------------------------- */

export const DEFAULT_RULES: ReadonlyArray<DangerRule> = [
  // Class A
  ruleA1Payment,
  ruleA2HumanPost,
  ruleA3GitForcePushShared,
  // Class B
  ruleB1WriteXHarnessHome,
  ruleB2ShellTouchesSelf,
  ruleB3KillSelf,
  ruleB4HostsShadowProvider,
  ruleB5KeychainWipe,
];

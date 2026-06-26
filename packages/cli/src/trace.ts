/**
 * `x trace <path>` — show AI-touch provenance on a filesystem object (ADR-0009).
 *
 * Reads the xattr, then cross-references the session JSONL to recover the full
 * IntentProvenance record (originating human message, executor, autonomy).
 *
 * Surface parity (ADR-0011): same loader feeds `/api/provenance/:path` on web.
 */
import { isAbsolute, resolve } from 'node:path';
import { trace, summarize, XATTR_KEY } from '@x_harness/provenance';

const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

export async function runTrace(args: string[]): Promise<number> {
  const targets = args.filter((a) => !a.startsWith('-'));
  const jsonOut = args.includes('--json');
  if (targets.length === 0) {
    process.stderr.write(
      `usage: x trace <path> [<path> ...] [--json]\n` +
        `       reads ${XATTR_KEY} xattr and resolves into session JSONL\n`,
    );
    return 1;
  }

  const out: unknown[] = [];
  let anyMissing = false;
  for (const p of targets) {
    const abs = isAbsolute(p) ? p : resolve(process.cwd(), p);
    const r = trace(abs);
    if (jsonOut) {
      out.push({ path: abs, ...r });
      if (!r.xattr) anyMissing = true;
      continue;
    }
    process.stdout.write(`${BOLD}${abs}${RESET}\n`);
    if (!r.xattr) {
      process.stdout.write(`  ${YELLOW}no AI-touch xattr${RESET} ${DIM}(${r.notes[0] ?? ''})${RESET}\n\n`);
      anyMissing = true;
      continue;
    }
    process.stdout.write(`  ${GREEN}touched${RESET}: ${summarize(r.xattr)}\n`);
    if (r.full) {
      const f = r.full;
      const exec =
        f.executor.kind === 'skill' ? `skill:${f.executor.name}`
          : f.executor.kind === 'model' ? `model:${f.executor.provider}/${f.executor.model}`
          : f.executor.kind === 'human' ? `human:${f.executor.surface}`
          : `system:${f.executor.subsystem}`;
      process.stdout.write(`  executor    : ${exec}\n`);
      process.stdout.write(`  autonomy    : ${f.autonomy}\n`);
      if (f.originatingHumanMessage)
        process.stdout.write(`  originated  : ${DIM}"${f.originatingHumanMessage.replace(/\n/g, ' ')}"${RESET}\n`);
      if (f.humanApproval)
        process.stdout.write(`  approval    : ${f.humanApproval.decision} (${f.humanApproval.ruleIds.join('+')})\n`);
      process.stdout.write(`  session     : ${f.sessionId}\n`);
      process.stdout.write(`  jsonl       : ${f.xHarnessHome}/memory/${f.sessionId}.jsonl\n`);
    } else {
      for (const n of r.notes) process.stdout.write(`  ${RED}note${RESET}: ${n}\n`);
    }
    process.stdout.write('\n');
  }
  if (jsonOut) process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  return anyMissing && targets.length === 1 ? 2 : 0;
}

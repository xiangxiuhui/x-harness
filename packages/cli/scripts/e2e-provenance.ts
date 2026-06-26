import { mkdtempSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Session, type MemorySink } from '@x_harness/core';
import { buildSkillRegistry } from '@x_harness/skills';
import { MemoryStore } from '@x_harness/memory';
import { writeAiTouch, trace, summarize } from '@x_harness/provenance';

async function main() {
  const home = mkdtempSync(join(tmpdir(), 'xh-e2e-'));
  mkdirSync(join(home, 'memory'), { recursive: true });
  const reg = await buildSkillRegistry({ xHarnessHome: home, cwd: process.cwd() });
  const store = await MemoryStore.open({ home, sessionId: 'sess-e2e' });

  const sink: MemorySink = {
    onUserMessage: (c) =>
      store.append({ actor: { kind: 'human', userId: 'u', surface: 'cli' }, kind: 'user.message', payload: { content: c } }),
    onProvenanceAttach: (p) =>
      store.append({ actor: { kind: 'system', subsystem: 'provenance' }, kind: 'provenance.attach', payload: p }),
    onToolResult: (p) =>
      store.append({ actor: { kind: 'skill', name: p.name, source: 'builtin' }, kind: 'tool.result', payload: p }),
  };

  // Provider stub (we won't actually call provider.chat).
  const provider: any = {
    name: 'stub', defaultModel: 'stub-0',
    chat: async () => { throw new Error('stub'); },
  };
  const session = new Session({
    provider, humanUserId: 'u', humanSurface: 'cli',
    skills: reg, memory: sink, sessionId: 'sess-e2e',
    provenance: { xHarnessHome: home },
  });
  session.pushUser('please make a hello note in $HOME');

  // Call the skill handler with a ctx that mirrors what Session would build —
  // we use writeAiTouch + onProvenanceAttach exactly like Session.buildAttachProvenance does.
  const fw = reg.list().find((s) => s.frontmatter.name === 'file.write')!;
  const target = join(home, 'note.txt');
  const ctx = {
    sessionId: session.id, cwd: process.cwd(),
    attachProvenance: async (absPath: string) => {
      const prov = {
        v: 1 as const, ts: new Date().toISOString(), sessionId: session.id,
        originatingHumanMessageSeq: 1,
        originatingHumanMessage: 'please make a hello note in $HOME',
        executor: { kind: 'skill' as const, name: 'file.write' },
        autonomy: 'human-implied' as const,
        sessionTrigger: 'fresh' as const,
        xHarnessHome: home, path: absPath,
      };
      const r = writeAiTouch(prov);
      await sink.onProvenanceAttach?.({ provenance: prov, xattrOk: r.ok, xattrError: r.error });
      return { ok: r.ok, error: r.error, xattr: r.xattr as unknown as Record<string, unknown> };
    },
  };
  const result = await fw.handler!({ path: target, content: 'hello from x_harness\n' }, ctx as any);
  console.log('skill ok:', result.output);

  const t = trace(target);
  console.log('xattr   :', t.xattr && summarize(t.xattr));
  console.log('full    :', t.full?.sessionId, '|', t.full?.autonomy, '|', t.full?.originatingHumanMessage);

  const lines = readFileSync(join(home, 'memory', 'sess-e2e.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l).kind);
  console.log('JSONL kinds:', lines);

  // ensure we see provenance.attach
  if (!lines.includes('provenance.attach')) throw new Error('FAIL: no provenance.attach in JSONL');
  if (!t.xattr) throw new Error('FAIL: no xattr');
  if (!t.full) throw new Error('FAIL: trace did not resolve to JSONL');
  console.log('\nALL CHECKS PASS ✅');
}
main().catch((e) => { console.error(e); process.exit(1); });

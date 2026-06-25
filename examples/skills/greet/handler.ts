// ADR-0007 demo on-disk skill. Receives {args, context} on stdin, emits one
// JSON line on stdout.
import { stdin } from 'node:process';

interface Req {
  args: { name?: unknown };
  context: { sessionId: string; cwd: string; skillDir: string; skillName: string };
}

let buf = '';
stdin.setEncoding('utf8');
stdin.on('data', (chunk: string) => { buf += chunk; });
stdin.on('end', () => {
  let req: Req;
  try {
    req = JSON.parse(buf) as Req;
  } catch (e) {
    console.log(JSON.stringify({ output: `error: bad request: ${(e as Error).message}`, error: true }));
    return;
  }
  const name = typeof req.args?.name === 'string' && req.args.name.trim()
    ? req.args.name.trim()
    : 'world';

  // Chatter (visible only in audit log).
  console.error(`[greet] saying hi to ${name}`);

  // The structured reply MUST be the last JSON-shaped line on stdout.
  console.log(JSON.stringify({
    output: `hello ${name}! (from skill=${req.context.skillName}, session=${req.context.sessionId})`,
    meta: { greeted: name },
  }));
});

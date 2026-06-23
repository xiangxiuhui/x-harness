import type { Skill, SkillHandler } from '../types.js';

const handler: SkillHandler = async (args, ctx) => {
  const url = typeof args.url === 'string' ? args.url : '';
  if (!url) return { output: 'error: `url` is required.', error: true };
  const maxBytes =
    typeof args.max_bytes === 'number' && args.max_bytes > 0
      ? Math.min(args.max_bytes, 512 * 1024)
      : 128 * 1024;
  const method = typeof args.method === 'string' ? args.method.toUpperCase() : 'GET';

  try {
    const resp = await fetch(url, { method, signal: ctx.signal });
    const reader = resp.body?.getReader();
    let received = 0;
    const chunks: Uint8Array[] = [];
    let truncated = false;
    if (reader) {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (received + value.byteLength > maxBytes) {
          const room = maxBytes - received;
          if (room > 0) chunks.push(value.subarray(0, room));
          received = maxBytes;
          truncated = true;
          try {
            await reader.cancel();
          } catch {
            // ignore
          }
          break;
        }
        chunks.push(value);
        received += value.byteLength;
      }
    }
    const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
    const ct = resp.headers.get('content-type') ?? '';
    const isText =
      ct.includes('text/') ||
      ct.includes('json') ||
      ct.includes('xml') ||
      ct.includes('javascript');
    const body = isText
      ? buf.toString('utf8')
      : `(non-text content omitted; ${buf.byteLength} bytes; type=${ct || 'unknown'})`;
    const header = `${method} ${url}\nstatus: ${resp.status}\ncontent-type: ${ct || '?'}\nbytes: ${buf.byteLength}${truncated ? ` (truncated at ${maxBytes})` : ''}\n--- body ---\n`;
    return { output: header + body, error: !resp.ok, meta: { url, status: resp.status, bytes: buf.byteLength } };
  } catch (e) {
    return { output: `fetch failed: ${(e as Error).message}`, error: true };
  }
};

export const webFetch: Skill = {
  source: 'builtin',
  dir: '<builtin:web.fetch>',
  body:
    '# web.fetch\n\nFetch a URL via HTTPS. Default GET. Body cap 128KB (max 512KB). ' +
    'Returns status, content-type, and body (text only).',
  frontmatter: {
    name: 'web.fetch',
    description:
      'Fetch a URL over HTTP(S). Returns status, headers summary, and text body (up to 128KB).',
    version: '0.1.0',
    author: 'x_harness',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Absolute http(s) URL.' },
        method: { type: 'string', description: 'HTTP method (default GET).' },
        max_bytes: {
          type: 'integer',
          description: 'Optional byte cap (default 131072, max 524288).',
        },
      },
      required: ['url'],
      additionalProperties: false,
    },
    metadata: {
      x_harness: {
        actor_required: 'model',
        danger_class: 'none',
        side_effects: ['network'],
        tags: ['web', 'fetch'],
      },
    },
  },
  handler,
};

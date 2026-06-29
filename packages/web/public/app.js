// x_harness web — minimal SPA. Zero deps. Hash-routed.
//
// View parity with CLI:
//   #/sessions          ↔ x sessions ls
//   #/sessions/:id      ↔ x sessions show <id>
//   #/sessions/:id/live ↔ tail -f ~/.x_harness/memory/<id>.jsonl  (via SSE)
//   #/territory         ↔ cat ~/.x_harness/territory.yaml
//   #/skills            ↔ /skills (chat slash command)

const $view = document.getElementById('view');
const $tag = document.getElementById('health-tag');

// ─── health ─────────────────────────────────────────────────────────────
async function pingHealth() {
  try {
    const r = await fetch('/api/health');
    if (!r.ok) throw new Error(r.status);
    const j = await r.json();
    $tag.textContent = `home=${j.home}`;
    $tag.classList.add('ok');
  } catch (e) {
    $tag.textContent = 'offline';
    $tag.classList.add('err');
  }
}

// ─── router ─────────────────────────────────────────────────────────────
const routes = [
  { re: /^#\/sessions$/, fn: viewSessions },
  { re: /^#\/sessions\/([^/]+)\/live$/, fn: (m) => viewSession(m[1], true) },
  { re: /^#\/sessions\/([^/]+)$/, fn: (m) => viewSession(m[1], false) },
  { re: /^#\/territory$/, fn: viewTerritory },
  { re: /^#\/skills$/, fn: viewSkills },
  { re: /^#\/trace(?:\?(.*))?$/, fn: (m) => viewTrace(parseQuery(m[1] || '').path) },
  { re: /^#\/memory(?:\?(.*))?$/, fn: (m) => viewMemory(parseQuery(m[1] || '')) },
  { re: /^#\/feedback(?:\?(.*))?$/, fn: (m) => viewFeedback(parseQuery(m[1] || '')) },
];

function parseQuery(qs) {
  const out = {};
  for (const kv of qs.split('&')) {
    if (!kv) continue;
    const i = kv.indexOf('=');
    const k = decodeURIComponent(i < 0 ? kv : kv.slice(0, i));
    const v = decodeURIComponent(i < 0 ? '' : kv.slice(i + 1));
    out[k] = v;
  }
  return out;
}

function route() {
  const h = location.hash || '#/sessions';
  for (const r of routes) {
    const m = h.match(r.re);
    if (m) {
      highlightNav(h);
      return r.fn(m);
    }
  }
  $view.textContent = 'unknown route';
}

function highlightNav(h) {
  document.querySelectorAll('#nav a').forEach((a) => {
    a.classList.toggle('active', h.startsWith(a.getAttribute('href')));
  });
}

window.addEventListener('hashchange', route);
window.addEventListener('load', () => {
  pingHealth();
  if (!location.hash) location.hash = '#/sessions';
  else route();
});

// ─── helpers ────────────────────────────────────────────────────────────
function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'onclick') e.onclick = v;
    else if (k === 'html') e.innerHTML = v;
    else e.setAttribute(k, v);
  }
  for (const c of children) {
    if (c == null) continue;
    e.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return e;
}
function clear($n) { while ($n.firstChild) $n.removeChild($n.firstChild); }
function fmtTime(iso) { return iso ? iso.replace('T', ' ').replace('Z', '').slice(0, 19) : ''; }
function shorten(s, n) { return !s ? '' : s.length <= n ? s : s.slice(0, n) + '…'; }
function actorBadge(actor) {
  if (!actor) return el('span', { class: 'actor system' }, 'sys');
  if (actor.kind === 'human') return el('span', { class: 'actor human' }, `human:${actor.userId || '?'}`);
  if (actor.kind === 'model') return el('span', { class: 'actor model' }, `model:${actor.model || '?'}`);
  if (actor.kind === 'skill') return el('span', { class: 'actor skill' }, `skill:${actor.name}`);
  if (actor.kind === 'system') return el('span', { class: 'actor system' }, `sys:${actor.subsystem || '?'}`);
  return el('span', { class: 'actor system' }, JSON.stringify(actor));
}
function entryClass(actor, kind) {
  if (!actor) return '';
  if (kind === 'tool.danger') return 'danger';
  return actor.kind || '';
}

// ─── views ──────────────────────────────────────────────────────────────

async function viewSessions() {
  clear($view);
  $view.append(el('h1', {}, 'Sessions'));
  const r = await fetch('/api/sessions');
  const j = await r.json();
  if (!j.sessions || j.sessions.length === 0) {
    $view.append(el('p', { class: 'muted' }, 'No sessions yet. Run `x chat` first.'));
    return;
  }
  const tbl = el('table', {});
  tbl.append(el('thead', {}, el('tr', {},
    el('th', {}, 'Started'),
    el('th', {}, 'Session'),
    el('th', {}, 'Model'),
    el('th', {}, 'Turns'),
    el('th', {}, 'cwd'),
    el('th', {}, 'Live'),
  )));
  const tbody = el('tbody', {});
  for (const s of j.sessions) {
    tbody.append(el('tr', {},
      el('td', {}, fmtTime(s.startedAt)),
      el('td', {}, el('a', { href: `#/sessions/${s.sessionId}` }, s.sessionId)),
      el('td', {}, `${s.model?.provider || ''}/${s.model?.model || ''}`),
      el('td', {}, String(s.userTurns ?? 0)),
      el('td', {}, shorten(s.cwd || '', 60)),
      el('td', {}, s.endedAt ? '—' : el('a', { href: `#/sessions/${s.sessionId}/live` }, 'tail')),
    ));
  }
  tbl.append(tbody);
  $view.append(tbl);
}

async function viewSession(id, live) {
  clear($view);
  const head = el('div', { class: 'row-actions' },
    el('h1', { style: 'flex:1' }, `Session ${id}`),
    el('a', { class: 'btn', href: '#/sessions' }, '← back'),
    el('a', { class: 'btn', href: live ? `#/sessions/${id}` : `#/sessions/${id}/live` },
      live ? 'static' : 'live'),
  );
  $view.append(head);

  if (live) {
    $view.append(el('p', { class: 'muted' },
      el('span', { class: 'live-indicator' }), 'live tail (SSE) — Ctrl+C/close to stop'));
  }
  const $list = el('div', { class: 'entries' });
  $view.append($list);

  function renderEntry(e) {
    const klass = `entry ${entryClass(e.actor, e.kind)}`;
    const meta = el('div', { class: 'meta' },
      String(e.seq ?? '—'),
      fmtTime(e.ts),
      actorBadge(e.actor),
      el('span', { class: 'kind' }, e.kind),
    );
    const body = el('div', { class: 'body' }, formatPayload(e));
    const actions = feedbackActions(id, e);
    const node = el('div', { class: klass }, meta, body);
    if (actions) node.append(actions);
    $list.append(node);
  }

  if (live) {
    const es = new EventSource(`/api/sessions/${encodeURIComponent(id)}/tail`);
    es.addEventListener('entry', (ev) => {
      try { renderEntry(JSON.parse(ev.data)); } catch (e) { /* ignore parse */ }
    });
    es.addEventListener('caughtup', () => {
      $list.append(el('div', { class: 'muted' }, '— caught up, waiting for new entries —'));
    });
    es.addEventListener('truncated', () => {
      clear($list);
      $list.append(el('div', { class: 'muted' }, '— file truncated, restarted —'));
    });
    es.onerror = () => {
      $list.append(el('div', { class: 'muted' }, '— stream closed —'));
      es.close();
    };
    window.addEventListener('hashchange', () => es.close(), { once: true });
  } else {
    const r = await fetch(`/api/sessions/${encodeURIComponent(id)}`);
    if (!r.ok) {
      $view.append(el('p', { class: 'muted' }, `error: ${r.status}`));
      return;
    }
    const j = await r.json();
    for (const e of j.entries) renderEntry(e);
  }
}

function formatPayload(e) {
  const p = e.payload || {};
  switch (e.kind) {
    case 'session.start':
      return `${p.model?.provider}/${p.model?.model}  cwd=${p.cwd}  home=${p.xHarnessHome}`;
    case 'system.message':
      return shorten((p.content || '').replace(/\s+/g, ' '), 200) + '   (system prompt)';
    case 'user.message':
    case 'assistant.message':
      return p.content || '';
    case 'tool.call':
      return `${p.name}  args=${shorten(p.argumentsJson || '', 200)}`;
    case 'tool.result':
      return `${p.name}${p.error ? ' [ERR]' : ''}${p.blocked ? ' [BLOCKED]' : ''}\n${shorten(p.output || '', 600)}`;
    case 'tool.danger':
      return `${p.name} → ${p.decision} (${(p.ruleIds || []).join(', ')})\n${p.headline || ''}`;
    case 'tool.approval':
      return `${p.name} → ${p.decision}`;
    case 'session.end':
      return `${p.reason} (${p.turns} turns)`;
    case 'territory.loaded':
      return `${p.path}  v=${p.version}  zones=${(p.zones || []).join(', ')}${p.generatedDefault ? '  (default created)' : ''}`;
    default:
      return JSON.stringify(p);
  }
}

async function viewTerritory() {
  clear($view);
  $view.append(el('h1', {}, 'Territory'));
  const r = await fetch('/api/territory');
  const j = await r.json();
  $view.append(el('p', { class: 'muted' },
    `Authorized perimeter (ADR-0010). File: ${j.path}  ·  schema v${j.version ?? '?'}`));
  const zoneBox = el('div', {});
  for (const z of j.zonePaths || []) {
    zoneBox.append(el('span', { class: 'zone' }, z));
  }
  $view.append(zoneBox);
  $view.append(el('h2', {}, 'territory.yaml (raw)'));
  $view.append(el('pre', {}, j.raw || ''));
}

async function viewSkills() {
  clear($view);
  $view.append(el('h1', {}, 'Skills'));
  const r = await fetch('/api/skills');
  const j = await r.json();
  if (!j.skills || j.skills.length === 0) {
    $view.append(el('p', { class: 'muted' }, 'No skills loaded.'));
    return;
  }
  const tbl = el('table', {});
  tbl.append(el('thead', {}, el('tr', {},
    el('th', {}, 'Name'),
    el('th', {}, 'Kind'),
    el('th', {}, 'Source'),
    el('th', {}, 'Description'),
    el('th', {}, 'Path'),
  )));
  const tbody = el('tbody', {});
  for (const s of j.skills) {
    tbody.append(el('tr', {},
      el('td', {}, s.name),
      el('td', {}, s.kind),
      el('td', {}, s.source),
      el('td', {}, shorten(s.description || '', 100)),
      el('td', {}, shorten(s.path || '', 80)),
    ));
  }
  tbl.append(tbody);
  $view.append(tbl);
}

// ─── trace view (ADR-0009) ──────────────────────────────────────────────
async function viewTrace(initialPath) {
  $view.replaceChildren();
  $view.append(el('h2', {}, 'AI-touch trace'));
  $view.append(
    el('p', { class: 'muted' },
      'Mirror of ', el('code', {}, 'x trace <path>'),
      '. Reads the ', el('code', {}, 'com.x_harness.ai_touch'),
      ' xattr and resolves into the session JSONL.'),
  );

  const form = el('form', { class: 'trace-form' });
  const input = el('input', {
    type: 'text', name: 'p', placeholder: '/absolute/path/to/file',
    value: initialPath || '', autofocus: 'autofocus', spellcheck: 'false',
  });
  const btn = el('button', { type: 'submit' }, 'trace');
  form.append(input, btn);
  $view.append(form);

  const out = el('div', { class: 'trace-out' });
  $view.append(out);

  async function run(p) {
    out.replaceChildren(el('div', { class: 'muted' }, 'looking up…'));
    try {
      const r = await fetch('/api/trace?path=' + encodeURIComponent(p)).then((x) => x.json());
      out.replaceChildren(renderTrace(r));
    } catch (e) {
      out.replaceChildren(el('div', { class: 'err' }, 'error: ' + (e?.message || e)));
    }
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = input.value.trim();
    if (!v) return;
    location.hash = '#/trace?path=' + encodeURIComponent(v);
    run(v);
  });

  if (initialPath) run(initialPath);
}

function renderTrace(r) {
  const root = el('div', { class: 'trace-card' });
  root.append(el('div', { class: 'trace-path' }, r.path));
  if (!r.xattr) {
    root.append(el('div', { class: 'trace-empty' }, 'no AI-touch xattr on this file'));
    if (r.notes?.length) {
      root.append(el('div', { class: 'muted' }, r.notes.join(' · ')));
    }
    return root;
  }
  const x = r.xattr;
  const f = r.full;
  const exec = f
    ? (f.executor.kind === 'skill' ? 'skill:' + f.executor.name
      : f.executor.kind === 'model' ? 'model:' + f.executor.provider + '/' + f.executor.model
      : f.executor.kind === 'human' ? 'human:' + f.executor.surface
      : 'system:' + f.executor.subsystem)
    : x.x;
  root.append(el('div', { class: 'trace-row' }, el('span', { class: 'k' }, 'touched'), el('span', { class: 'v ok' }, x.ts)));
  root.append(el('div', { class: 'trace-row' }, el('span', { class: 'k' }, 'executor'), el('span', { class: 'v' }, exec)));
  root.append(el('div', { class: 'trace-row' }, el('span', { class: 'k' }, 'autonomy'), el('span', { class: 'v' }, (f?.autonomy) || x.a)));
  if (f?.originatingHumanMessage) {
    root.append(el('div', { class: 'trace-row' },
      el('span', { class: 'k' }, 'originated'),
      el('span', { class: 'v' }, el('em', {}, '"' + f.originatingHumanMessage + '"'))));
  }
  if (f?.humanApproval || x.ap) {
    root.append(el('div', { class: 'trace-row' },
      el('span', { class: 'k' }, 'approval'),
      el('span', { class: 'v' }, f?.humanApproval ? (f.humanApproval.decision + ' (' + f.humanApproval.ruleIds.join('+') + ')') : x.ap)));
  }
  const sess = f?.sessionId || x.s;
  root.append(el('div', { class: 'trace-row' },
    el('span', { class: 'k' }, 'session'),
    el('span', { class: 'v' }, el('a', { href: '#/sessions/' + sess }, sess))));
  if (!f && r.notes?.length) {
    root.append(el('div', { class: 'muted' }, r.notes.join(' · ')));
  }
  return root;
}

// ─── memory grep ───────────────────────────────────────────────────────
async function viewMemory(initial) {
  const form = el('div', { class: 'mem-form' });
  const q = el('input', { type: 'text', placeholder: 'pattern (literal by default)', value: initial.q || '' });
  const kind = el('input', { type: 'text', placeholder: 'kind (e.g. user.message; comma-sep ok)', value: initial.kind || '' });
  const session = el('input', { type: 'text', placeholder: 'session id (optional)', value: initial.session || '' });
  const since = el('input', { type: 'text', placeholder: 'since ISO (optional, e.g. 2026-06-26)', value: initial.since || '' });
  const regex = el('input', { type: 'checkbox' });
  if (initial.regex === '1') regex.checked = true;
  const cs = el('input', { type: 'checkbox' });
  if (initial.case === '1') cs.checked = true;
  const btn = el('button', {}, 'Search');
  const results = el('div', { class: 'mem-results' }, 'enter a pattern and search');
  form.append(
    el('label', {}, 'q ', q),
    el('label', {}, 'kind ', kind),
    el('label', {}, 'session ', session),
    el('label', {}, 'since ', since),
    el('label', { class: 'cb' }, regex, ' regex'),
    el('label', { class: 'cb' }, cs, ' case'),
    btn,
  );
  const root = el('div', { class: 'view' }, el('h2', {}, 'Memory grep'), form, results);
  $view.replaceChildren(root);

  const doSearch = async () => {
    if (!q.value) return;
    results.replaceChildren(el('div', { class: 'muted' }, 'searching…'));
    const params = new URLSearchParams();
    params.set('q', q.value);
    if (regex.checked) params.set('regex', '1');
    if (cs.checked) params.set('case', '1');
    for (const k of kind.value.split(',').map(s => s.trim()).filter(Boolean)) params.append('kind', k);
    if (session.value) params.set('session', session.value);
    if (since.value) params.set('since', since.value);
    location.hash = '#/memory?' + params.toString();
    try {
      const r = await getJSON('/api/memory/grep?' + params.toString());
      renderGrep(results, r, { q: q.value, regex: regex.checked, case: cs.checked });
    } catch (e) {
      results.replaceChildren(el('div', { class: 'err' }, 'error: ' + e.message));
    }
  };
  btn.addEventListener('click', doSearch);
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });
  // Auto-search if invoked with q in URL.
  if (initial.q) doSearch();
}

function renderGrep(host, r, opts) {
  host.replaceChildren();
  if (!r.hits || r.hits.length === 0) {
    host.append(el('div', { class: 'muted' }, `no matches (scanned ${r.totalScanned} across ${r.sessionsScanned} sessions)`));
    return;
  }
  const summary = el('div', { class: 'mem-summary' },
    `${r.totalMatched} matches in ${r.sessionsScanned} sessions${r.truncated ? ' (truncated)' : ''}`);
  host.append(summary);
  const tbl = el('div', { class: 'mem-hits' });
  for (const h of r.hits) {
    const head = el('div', { class: 'mem-head' },
      el('a', { href: '#/sessions/' + h.sessionId }, h.sessionId),
      el('span', { class: 'muted' }, '#' + h.seq),
      el('span', { class: 'mem-ts' }, h.ts),
      el('span', { class: 'mem-kind' }, h.kind),
      el('span', { class: 'muted' }, '[' + h.matchedField + ']'),
    );
    const ex = el('div', { class: 'mem-excerpt' });
    highlightInto(ex, h.excerpt, opts);
    tbl.append(el('div', { class: 'mem-hit' }, head, ex));
  }
  host.append(tbl);
}

function highlightInto(node, text, opts) {
  let re;
  try {
    re = opts.regex
      ? new RegExp(opts.q, opts.case ? 'g' : 'gi')
      : new RegExp(opts.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), opts.case ? 'g' : 'gi');
  } catch { node.textContent = text; return; }
  let last = 0; let m;
  while ((m = re.exec(text))) {
    if (m.index > last) node.appendChild(document.createTextNode(text.slice(last, m.index)));
    node.appendChild(el('mark', {}, m[0]));
    last = m.index + m[0].length;
    if (m[0].length === 0) re.lastIndex++;
  }
  if (last < text.length) node.appendChild(document.createTextNode(text.slice(last)));
}

// ─── evolution feedback (spiral 2/4) ───────────────────────────────────
const FEEDBACK_SKIP_KINDS = new Set([
  'session.start', 'session.end',
  'evolution.feedback',
  'territory.loaded',
  'tool.approval', // user already gave a verdict via danger guard
]);
function feedbackActions(sessionId, e) {
  if (FEEDBACK_SKIP_KINDS.has(e.kind)) return null;
  const row = el('div', { class: 'fb-row' });
  const accept = el('button', { class: 'fb fb-ok', title: 'looks good' }, '👍');
  const reject = el('button', { class: 'fb fb-bad', title: 'this was wrong' }, '👎');
  const iwh = el('button', { class: 'fb fb-iwh', title: 'I would have…' }, '💡');
  const status = el('span', { class: 'fb-status muted' });
  const setStatus = (txt, ok) => { status.textContent = txt; status.className = 'fb-status ' + (ok ? 'ok' : 'err'); };
  const send = async (verdict, extras) => {
    try {
      const r = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          targetSeq: e.seq,
          targetKind: e.kind,
          verdict,
          ...extras,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setStatus('error: ' + (j.error || r.status), false); return; }
      setStatus('recorded seq=' + j.entry.seq + ' (' + verdict + ')', true);
      [accept, reject, iwh].forEach(b => b.disabled = true);
    } catch (err) {
      setStatus('error: ' + err.message, false);
    }
  };
  accept.addEventListener('click', () => {
    const note = prompt('optional note (why was this good?):', '') || undefined;
    send('accept', note ? { note } : {});
  });
  reject.addEventListener('click', () => {
    const note = prompt('why was this wrong? (optional):', '') || undefined;
    send('reject', note ? { note } : {});
  });
  iwh.addEventListener('click', () => {
    const suggestion = prompt('what would you have done instead?');
    if (!suggestion) return;
    send('i-would-have', { suggestion });
  });
  row.append(accept, reject, iwh, status);
  return row;
}

// ─── feedback list view ────────────────────────────────────────────────
async function viewFeedback(initial) {
  clear($view);
  const filters = el('div', { class: 'fb-filters' });
  const verdict = el('select', {},
    el('option', { value: '' }, 'all verdicts'),
    el('option', { value: 'accept' }, 'accept'),
    el('option', { value: 'reject' }, 'reject'),
    el('option', { value: 'i-would-have' }, 'i-would-have'),
  );
  if (initial.verdict) verdict.value = initial.verdict;
  const session = el('input', { type: 'text', placeholder: 'session id (optional)', value: initial.session || '' });
  const apply = el('button', {}, 'Reload');
  filters.append(el('label', {}, 'verdict ', verdict), el('label', {}, 'session ', session), apply);
  const head = el('h2', {}, 'Evolution feedback');
  const host = el('div', { class: 'fb-list' });
  $view.append(head, filters, host);
  const load = async () => {
    const params = new URLSearchParams();
    if (verdict.value) params.set('verdict', verdict.value);
    if (session.value) params.set('session', session.value);
    location.hash = '#/feedback' + (params.toString() ? '?' + params : '');
    host.replaceChildren(el('div', { class: 'muted' }, 'loading…'));
    try {
      const j = await getJSON('/api/feedback?' + params.toString());
      renderFeedbackList(host, j.feedback || []);
    } catch (e) {
      host.replaceChildren(el('div', { class: 'err' }, 'error: ' + e.message));
    }
  };
  apply.addEventListener('click', load);
  await load();
}

function renderFeedbackList(host, rows) {
  host.replaceChildren();
  if (!rows.length) {
    host.append(el('div', { class: 'muted' }, 'no feedback recorded yet'));
    return;
  }
  for (const r of rows) {
    const tag = r.payload.verdict === 'accept' ? '👍'
      : r.payload.verdict === 'reject' ? '👎'
      : '💡';
    const head = el('div', { class: 'fb-head' },
      el('span', { class: 'fb-tag fb-' + r.payload.verdict }, tag + ' ' + r.payload.verdict),
      el('a', { href: '#/sessions/' + r.sessionId }, r.sessionId),
      el('span', { class: 'muted' }, '#' + r.payload.targetSeq + ' ' + r.payload.targetKind),
      el('span', { class: 'mem-ts' }, r.ts),
    );
    const body = el('div', { class: 'fb-body' });
    if (r.payload.suggestion) body.append(el('div', {}, el('em', {}, 'suggestion: '), r.payload.suggestion));
    if (r.payload.note) body.append(el('div', { class: 'muted' }, r.payload.note));
    host.append(el('div', { class: 'fb-item' }, head, body));
  }
  host.append(el('div', { class: 'muted' }, rows.length + ' feedback events'));
}

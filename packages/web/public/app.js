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
];

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
    $list.append(el('div', { class: klass }, meta, body));
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

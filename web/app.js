/* Dry Run front end. Vanilla JS, no build step.
 * Sections: 1 helpers | 2 api + status | 3 modal + drawer (agents, interviews) | 4 router
 *           5 setup | 6 runs list | 7 backtest | 8 run view (live) | 9 verdict | 10 report | 11 tools
 */
'use strict';

/* ============================================================ 1. helpers */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** h('div.card#id', {onclick, title}, child, 'text', [children]) */
function h(spec, attrs, ...kids) {
  const m = /^([a-z0-9]+)?((?:[.#][\w-]+)*)$/i.exec(spec) || [];
  const el = document.createElement(m[1] || 'div');
  for (const t of (m[2] || '').match(/[.#][\w-]+/g) || []) t[0] === '.' ? el.classList.add(t.slice(1)) : (el.id = t.slice(1));
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') v.split(' ').filter(Boolean).forEach((c) => el.classList.add(c));
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'value') el.value = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  (function add(list) {
    for (const k of list) {
      if (k == null || k === false) continue;
      if (Array.isArray(k)) add(k);
      else el.append(k instanceof Node ? k : document.createTextNode(String(k)));
    }
  })(kids);
  return el;
}
const svgNS = 'http://www.w3.org/2000/svg';
function s(tag, attrs, ...kids) {
  const el = document.createElementNS(svgNS, tag);
  for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
  for (const k of kids.flat()) if (k != null) el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return el;
}
const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
const mount = (el, ...kids) => { clear(el); kids.flat().forEach((k) => k != null && el.append(k instanceof Node ? k : document.createTextNode(String(k)))); return el; };
const pct = (x, d = 1) => (x == null || Number.isNaN(x) ? '-' : `${(x * 100).toFixed(d)}%`);
const num = (x, d = 2) => (x == null || Number.isNaN(x) ? '-' : Number(x).toFixed(d));
const fmtInt = (x) => (x == null ? '-' : Number(x).toLocaleString());
const hourStr = (hr) => `${String(hr).padStart(2, '0')}:00`;
/** Action records and memories store the round index in `hour`; turn it into a clock time for the current run. */
function roundTime(r) {
  const sp = typeof RUN !== 'undefined' && RUN?.S?.spec;
  if (!sp) return `round ${r + 1}`;
  const t = sp.startHour + r * sp.hourStep;
  return `D${Math.floor(t / 24) + 1} ${hourStr(t % 24)}`;
}
const spin = () => h('span.spinner');
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

function toast(msg, bad) {
  const t = h('div.toast' + (bad ? '.bad' : ''), msg);
  $('#toasts').append(t);
  setTimeout(() => t.remove(), bad ? 7000 : 3500);
}
function hueOf(id) { let x = 7; for (const c of String(id)) x = (x * 31 + c.charCodeAt(0)) % 360; return x; }
function avatar(id, size = '', onclick) {
  const n = String(id).replace(/^\D+/, '').replace(/^0+(?=\d)/, '') || id;
  return h('div.avatar' + (size ? '.' + size : ''), {
    style: { background: `hsl(${hueOf(id)} 48% 42%)` }, title: `Open ${id}`,
    onclick: onclick || (() => openAgent(id)),
  }, `P${n}`);
}
const ICONS = {
  like: 'M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z',
  comment: 'M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z',
  share: 'M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z',
  save: 'M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z',
  tap_through: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3',
  hide: 'M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24M1 1l22 22',
  scroll_past: 'M6 9l6 6 6-6',
};
const ACTION_LABEL = { scroll_past: 'scrolled past', like: 'liked', comment: 'commented', share: 'shared', save: 'saved', tap_through: 'tapped through', hide: 'hid it' };
function actPill(action) {
  return h('span.act.' + action, s('svg', { viewBox: '0 0 24 24' }, s('path', { d: ICONS[action] || ICONS.scroll_past })), ACTION_LABEL[action] || action);
}
const variantChip = (v) => h('span.chip.' + String(v || 'a').toLowerCase(), `Version ${v}`);
const AGE_BANDS = ['18-24', '25-34', '35-44', '45-54', '55-64', '65+'];
const INCOME_BANDS = ['<$25k', '$25-50k', '$50-75k', '$75-100k', '$100-150k', '$150k+'];

/* ============================================================ 2. api + status */
async function api(path, opts = {}) {
  const init = { method: opts.method || 'GET', headers: {} };
  if (opts.body !== undefined) { init.body = JSON.stringify(opts.body); init.headers['content-type'] = 'application/json'; }
  const res = await fetch(path, init);
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) throw new Error((data && data.error) || `${res.status} ${res.statusText}`);
  return data;
}
const fail = (e) => toast(e.message || String(e), true);

const PROVIDER_LABEL = { nightshift: 'Nightshift', nvidia: 'NVIDIA cloud', ollama: 'ollama-local' };
async function refreshStatus() {
  const pill = $('#status-pill');
  try {
    const st = await api('/api/status');
    pill._status = st;
    const provs = st.providers?.providers || [];
    const online = provs.filter((p) => p.online);
    const order = st.providers?.order || [];
    const active = order.map((n) => online.find((p) => p.provider === n)).find(Boolean) || online[0];
    const engine = st.sources?.engine;
    const engineLabel = engine === 'zetaris' ? 'Federated SQL: Zetaris' : engine === 'local-duckdb' ? 'Federated SQL: local DuckDB (Zetaris not connected)' : `Data engine: ${engine || 'unknown'}`;
    const modelLabel = active ? `Model: ${PROVIDER_LABEL[active.provider] || active.provider} online` : 'Model: none online';
    pill.className = 'status-pill ' + (active ? (engine === 'local-duckdb' ? 'ok' : 'ok') : 'bad');
    mount($('.status-text', pill), `${modelLabel}  |  ${engineLabel}${st.sampleMode ? '  |  SAMPLE_MODE replay' : ''}`);
  } catch (e) {
    pill.className = 'status-pill bad';
    mount($('.status-text', pill), `API unreachable: ${e.message}`);
  }
}
function showStatusDetail() {
  const st = $('#status-pill')._status;
  if (!st) return;
  const provs = st.providers?.providers || [];
  openModal(h('div',
    h('h2', 'System status'),
    st.sampleMode ? h('div.banner.info', 'SAMPLE_MODE is on: model calls replay from recorded samples.') : null,
    h('h3', { style: { margin: '14px 0 6px' } }, 'Model providers (fallback order: ' + (st.providers?.order || []).join(' > ') + ')'),
    h('div.tbl-wrap', h('table', h('thead', h('tr', ['Provider', 'State', 'Detail', 'Crowd model'].map((x) => h('th', x)))),
      h('tbody', provs.map((p) => h('tr', h('td', PROVIDER_LABEL[p.provider] || p.provider),
        h('td', h('span.chip.' + (p.online ? 'good' : p.configured ? 'warn' : ''), p.online ? 'online' : p.configured ? 'offline' : 'not set')),
        h('td.muted', p.detail), h('td.mono', p.models?.crowd || '-')))))),
    h('h3', { style: { margin: '18px 0 6px' } }, `Data engine: ${st.sources?.engine}`),
    h('div.tbl-wrap', h('table', h('thead', h('tr', ['Table', 'Kind', 'Rows', 'Label'].map((x) => h('th', x)))),
      h('tbody', (st.sources?.tables || []).map((t) => h('tr', h('td.mono', t.table), h('td.muted', t.kind), h('td.num', fmtInt(t.rows)), h('td', t.label)))))),
  ));
}

/* ============================================================ 3. modal + drawer */
function openModal(content) { mount($('#modal-body'), content); $('#modal').hidden = false; }
function closeModal() { $('#modal').hidden = true; }
async function openQuery(qid) {
  openModal(h('div', spin(), ' Loading query ', h('span.mono', qid)));
  try {
    const q = await api(`/api/queries/${encodeURIComponent(qid)}`);
    const rows = q.sample || q.rows || [];
    const cols = rows.length ? Object.keys(rows[0]) : [];
    openModal(h('div',
      h('div.row', h('h2', q.label || 'Query'), h('span.chip.qid', q.query_id)),
      h('div.row', { style: { margin: '8px 0' } },
        h('span.chip', 'Engine: ', h('b', q.engine)), h('span.chip', `${fmtInt(q.row_count ?? rows.length)} rows`), q.ms != null ? h('span.chip', `${q.ms} ms`) : null, q.ts ? h('span.chip.mono', q.ts) : null),
      h('h3', 'SQL'), h('pre.sql', q.sql),
      h('h3', `Result${q.row_count > rows.length ? ` (first ${rows.length} of ${q.row_count})` : ''}`),
      rows.length ? h('div.tbl-wrap', h('table', h('thead', h('tr', cols.map((c) => h('th', c)))), h('tbody', rows.slice(0, 50).map((r) => h('tr', cols.map((c) => h('td.mono', r[c] == null ? '' : String(r[c])))))))) : h('div.empty', 'No rows stored for this query.'),
    ));
  } catch (e) { openModal(h('div', h('h2', 'Query not found'), h('p.muted', e.message))); }
}
const qidChip = (qid) => h('button.chip.qid', { title: 'Open the SQL and rows behind this', onclick: (ev) => { ev.stopPropagation(); openQuery(qid); } }, qid);

const drawerEl = () => $('#drawer');
function closeDrawer() { drawerEl().hidden = true; }

/** Agent drawer: persona, receipts, memories, actions, interview chat. */
let drawerToken = 0;
async function openAgent(agentId, opts = {}) {
  const runId = opts.runId || (typeof RUN !== 'undefined' && RUN?.id);
  if (!runId) return;
  const token = ++drawerToken;
  drawerEl().hidden = false;
  mount($('#drawer-body'), h('div', { style: { padding: '30px 0' } }, spin(), ' Loading ', agentId));
  let data;
  try { data = await api(`/api/runs/${runId}/agents/${agentId}`); } catch (e) { mount($('#drawer-body'), h('div.banner.bad', e.message)); return; }
  if (token !== drawerToken) return;
  const p = data.persona;
  const worldIds = Object.keys(data.worlds || {});
  const acted = worldIds.filter((w) => (data.worlds[w].actions || []).length);
  const seedPrefix = typeof RUN !== 'undefined' && RUN?.S ? `s${RUN.S.seed}:` : '';
  let world = opts.world || acted.find((w) => w.startsWith(seedPrefix)) || acted[0] || worldIds[0];
  const history = {};   // world -> [{q,a}]
  const body = $('#drawer-body');

  const chatLog = h('div.chat-log');
  const input = h('input', { type: 'text', placeholder: 'Ask them why... (e.g. "Why did you scroll past?")' });
  const sendBtn = h('button.btn.primary', 'Ask');
  const worldSel = h('div.chips');
  const memBox = h('div'), actBox = h('div');

  function renderWorldPicker() {
    mount(worldSel, worldIds.map((w) => h('button.chip' + (w === world ? '.on' : ''), { onclick: () => { world = w; renderWorldPicker(); renderMem(); renderChat(); } },
      `World ${w}`, (data.worlds[w].actions || []).length ? ` (${data.worlds[w].actions.length} actions)` : ' (did not see it)')));
  }
  function renderMem() {
    const wd = data.worlds[world] || { memories: [], actions: [] };
    mount(memBox, wd.memories?.length ? wd.memories.map((m) => h('div.mem', { 'data-mem': m.id }, h('span.hr', roundTime(m.hour)), m.text)) : h('div.muted', 'No memories in this world: they never saw the post.'));
    mount(actBox, wd.actions?.length ? wd.actions.map((a) => h('div.mem', { 'data-action': a.id },
      h('div.row', { style: { gap: '8px' } }, h('span.hr', roundTime(a.hour)), actPill(a.action), h('span.chip.mono', a.id)),
      a.text ? h('div', { style: { marginTop: '4px' } }, `"${a.text}"`) : null,
      a.reason ? h('div.thought', `thought: ${a.reason}`) : null,
      a.unsaid ? h('div.unsaid', h('b', 'kept to themselves: '), a.unsaid) : null)) : h('div.muted', 'No actions in this world.'));
  }
  function focusAction(id) {
    const el = $(`[data-action="${CSS.escape(id)}"]`, body);
    if (!el) return;
    $$('.hl', body).forEach((x) => x.classList.remove('hl'));
    el.classList.add('hl'); el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  function renderChat() {
    const log = history[world] || (history[world] = []);
    mount(chatLog, log.map((t) => h('div',
      h('div.bubble.me', t.q),
      t.err ? h('div.banner.bad', t.err) : h('div.bubble.them', t.a,
        t.res && t.res.saw_it === false ? h('div', { style: { marginTop: '6px' } }, h('span.chip.warn', "didn't see it")) : null,
        t.res && t.res.invalid_citations?.length ? h('div', { style: { marginTop: '6px' } }, h('span.chip.bad', `Warning: ${t.res.invalid_citations.length} citation(s) did not match its memory (${t.res.invalid_citations.join(', ')})`)) : null,
        t.res && t.res.citations?.length ? h('div.cites', t.res.citations.map((c) => h('div.cite', {
          title: c.action_id ? 'Show the linked action' : 'Memory line', onclick: () => { if (c.action_id) focusAction(c.action_id); },
        }, h('span.hr', roundTime(c.hour)), c.text, c.action_id ? h('span.chip.qid', { style: { marginLeft: '8px' } }, `action ${c.action_id}`) : null))) : null,
        t.res ? h('div.muted', { style: { fontSize: '11px', marginTop: '6px' } }, `served by ${t.res.served_by}`) : null))));
    chatLog.lastChild?.scrollIntoView({ block: 'nearest' });
  }
  async function ask() {
    const q = input.value.trim();
    if (!q) return;
    input.value = ''; sendBtn.disabled = true; input.disabled = true;
    const log = history[world] || (history[world] = []);
    const turn = { q, a: '' };
    log.push(turn);
    mount(chatLog, ...chatLog.childNodes, h('div.muted.pending', spin(), ' thinking...'));
    try {
      const res = await api(`/api/runs/${runId}/interview`, { method: 'POST', body: { world_id: world, agent_id: agentId, question: q, history: log.slice(0, -1).filter((x) => x.a).map((x) => ({ q: x.q, a: x.a })) } });
      turn.a = res.answer; turn.res = res;
    } catch (e) { turn.err = e.message; }
    sendBtn.disabled = false; input.disabled = false; renderChat(); input.focus();
  }
  sendBtn.onclick = ask;
  input.onkeydown = (e) => { if (e.key === 'Enter') ask(); };

  const kvItem = (k, v) => h('div', h('span', k), h('b', v));
  const meter = (label, v) => h('div', { style: { margin: '4px 0' } }, h('div.row.spread', h('span.muted', label), h('b.mono', num(v))), h('div.pbar', h('i', { style: { width: `${Math.round(Math.max(0, Math.min(1, v)) * 100)}%` } })));
  mount(body,
    h('div.row', { style: { gap: '14px', marginBottom: '6px', paddingRight: '40px' } }, avatar(p.id, 'lg', () => {}),
      h('div', h('h2', p.id), h('div.muted', `${p.age} years old, ${p.role} audience, ${p.segment}`))),
    h('p', { style: { fontStyle: 'italic', margin: '10px 0' } }, `"${p.voice}"`),
    h('div.kv', kvItem('Age band', p.age_band), kvItem('Income', p.income_band), kvItem('Education', p.education),
      kvItem('Channel', p.channel), kvItem('Daily minutes', p.daily_minutes), kvItem('Influence', p.influence),
      kvItem('Customer', p.customer ? `${p.customer.visits_per_month} visits/mo, $${p.customer.avg_ticket}` : 'not a customer'), kvItem('Zip', p.zip)),
    meter('Price sensitivity', p.price_sensitivity), meter('Ad skepticism', p.skepticism), meter('Susceptibility', p.susceptibility),
    meter('Speaks up (probability)', p.speak_p), meter('Activity', p.activity),
    h('div.section-title', h('h2', 'Receipts'), h('span.muted', 'where each number came from')),
    p.receipts?.length ? p.receipts.map((r) => h('div.receipt', h('b', r.field), h('span.muted', r.source), qidChip(r.query_id), h('div.ref', r.ref))) : h('div.muted', 'No receipts stored.'),
    h('div.section-title', h('h2', 'Interview'), h('span.muted', 'answers only from their own memory')),
    worldSel, chatLog, h('div.row', { style: { marginTop: '10px', flexWrap: 'nowrap' } }, input, sendBtn),
    h('div.section-title', h('h2', 'Memories')), memBox,
    h('div.section-title', h('h2', 'Actions')), actBox);
  renderWorldPicker(); renderMem(); renderChat();
}

/* ============================================================ 4. router */
let cleanup = null;
let RUN = null; // current run view context {id, S}
const routes = [
  [/^#\/run\/([^/]+)$/, (m, v) => runView(decodeURIComponent(m[1]), v), 'runs'],
  [/^#\/runs$/, (m, v) => runsView(m, v), 'runs'],
  [/^#\/backtest$/, (m, v) => backtestView(m, v), 'backtest'],
  [/^#?\/?$/, (m, v) => setupView(m, v), 'setup'],
];
function route() {
  if (cleanup) { try { cleanup(); } catch { /* ignore */ } cleanup = null; }
  RUN = null; closeDrawer(); closeModal();
  const hash = location.hash || '#/';
  for (const [re, fn, nav] of routes) {
    const m = re.exec(hash);
    if (m) {
      $$('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.nav === nav));
      const view = $('#view'); clear(view); window.scrollTo(0, 0);
      cleanup = fn(m, view) || null;
      return;
    }
  }
  location.hash = '#/';
}
window.addEventListener('hashchange', route);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeModal(); closeDrawer(); } });
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
$('.modal-close').addEventListener('click', closeModal);
$('.drawer-close').addEventListener('click', closeDrawer);
$('#status-pill').addEventListener('click', showStatusDetail);

/* ============================================================ 5. setup */
const setupState = {
  business: '', handle: '', place: '', zip: '', goal: '', postA: '', postB: '',
  crowdSize: 60, rounds: 12, seeds: 2, useCustomers: true,
  audience: null, coreBands: null, coreShare: null, coreShareTouched: false,
};

function estimateCoreShare(join, bands) {
  // Overlap Pew age bands with persona bands by years of age, weighted by Instagram users.
  const pew = { '18-29': [18, 29], '30-49': [30, 49], '50-64': [50, 64], '65+': [65, 90] };
  const per = { '18-24': [18, 24], '25-34': [25, 34], '35-44': [35, 44], '45-54': [45, 54], '55-64': [55, 64], '65+': [65, 90] };
  let core = 0, total = 0;
  for (const row of join || []) {
    const pr = pew[row.band]; if (!pr) continue;
    const users = Number(row.instagram_users) || 0;
    total += users;
    for (const b of bands) {
      const br = per[b]; if (!br) continue;
      const ov = Math.max(0, Math.min(pr[1], br[1]) - Math.max(pr[0], br[0]) + 1);
      core += users * ov / (pr[1] - pr[0] + 1);
    }
  }
  return total ? core / total : null;
}

function setupView(_m, view) {
  const S = setupState;
  const f = {};
  const field = (key, label, el, cls = 'span-6') => { f[key] = el; return h('div.field.' + cls, h('label', label), el); };
  const text = (key, ph) => h('input', { type: 'text', placeholder: ph || '', value: S[key], oninput: (e) => { S[key] = e.target.value; } });
  const area = (key, ph) => h('textarea', { placeholder: ph || '', oninput: (e) => { S[key] = e.target.value; } }, S[key]);
  const select = (key, opts, parse = Number) => {
    const el = h('select', { onchange: (e) => { S[key] = parse(e.target.value); } }, opts.map(([v, l]) => h('option', { value: v, selected: String(S[key]) === String(v) }, l)));
    return el;
  };

  const audienceBox = h('div');
  const runBtn = h('button.btn.primary.lg', 'Run Dry Run');
  const proposeBtn = h('button.btn', 'Propose audience');

  function renderAudience() {
    const a = S.audience;
    if (!a) { mount(audienceBox, h('div.empty', 'Optional: let the Audience agent name the segments from live Census and Pew rows, then edit them. Skip it and the run proposes its own.')); return; }
    const c = a.proposal.core, sp = a.proposal.spillover;
    const est = estimateCoreShare(a.join.rows, S.coreBands);
    const defaultShare = est == null ? 0.6 : Math.max(0.5, Math.min(0.7, est));
    const slider = h('input', { type: 'range', min: 50, max: 70, step: 1, value: Math.round((S.coreShareTouched ? S.coreShare : defaultShare) * 100) });
    const shareLabel = h('b');
    const upd = () => { shareLabel.textContent = S.coreShareTouched ? `${slider.value}% core (your override)` : `${slider.value}% core (data default)`; };
    slider.oninput = () => { S.coreShare = Number(slider.value) / 100; S.coreShareTouched = true; upd(); };
    upd();
    const chips = h('div.chips');
    const drawChips = () => mount(chips, AGE_BANDS.map((b) => h('button.chip' + (S.coreBands.includes(b) ? '.on' : ''), {
      title: 'Toggle this age band in the core audience',
      onclick: () => { S.coreBands = S.coreBands.includes(b) ? S.coreBands.filter((x) => x !== b) : [...S.coreBands, b]; drawChips(); renderAudience(); },
    }, b)));
    drawChips();
    mount(audienceBox, h('div.grid.two',
      h('div.seg-card', h('span.tag', 'Core audience'), h('h3', c.name), chips, h('p', { style: { marginTop: '10px' } }, c.why),
        h('div', { style: { marginTop: '10px' } }, h('div.row.spread', h('span.muted', 'Core share of the crowd'), shareLabel), slider,
          h('div.expl', est != null ? `Data estimate from the join below: about ${(est * 100).toFixed(0)}% (clamped to 50-70%). Exact value is computed when the crowd is sampled.` : 'Exact value is computed when the crowd is sampled.'))),
      h('div.seg-card', h('span.tag', 'Spillover'), h('h3', sp.name), h('p', sp.why),
        a.proposal.interests?.length ? h('div.chips', a.proposal.interests.map((i) => h('span.chip', i))) : null,
        h('div.expl', { style: { marginTop: '10px' } }, `Proposed by ${a.served_by || 'model'}${a.fallback ? ' (fallback: no reasoning model reachable)' : ''}. Segments are names only; shares come from the data.`))),
      h('div.card-head', { style: { marginTop: '18px' } }, h('h3', `Census x Pew: Instagram audience${a.geo ? ` in ${a.geo.geo_name}` : ''}`), h('span.row', h('span.chip', 'Engine: ' + a.join.engine), qidChip(a.join.query_id))),
      h('div.tbl-wrap', h('table', h('thead', h('tr', h('th', 'Age band'), h('th.num', 'Adults (Census)'), h('th.num', 'Instagram use (Pew)'), h('th.num', 'Instagram users'))),
        h('tbody', a.join.rows.map((r) => h('tr', h('td', r.band), h('td.num', fmtInt(r.adults)), h('td.num', `${Number(r.instagram_pct).toFixed(0)}%`), h('td.num', fmtInt(r.instagram_users))))))));
  }

  async function loadExample() {
    try {
      const d = await api('/api/demo');
      Object.assign(S, { business: d.business, handle: d.handle, place: d.place, zip: d.zip, goal: d.goal, postA: d.postA, postB: d.postB });
      S.audience = null; S.coreBands = null; S.coreShareTouched = false;
      for (const k of ['business', 'handle', 'place', 'zip', 'goal', 'postA', 'postB']) f[k].value = S[k];
      renderAudience(); toast('Example loaded');
    } catch (e) { fail(e); }
  }
  const payload = () => ({ business: S.business, handle: S.handle, place: S.place, zip: S.zip, goal: S.goal, postA: S.postA, postB: S.postB });
  const missing = () => ['business', 'zip', 'postA', 'postB'].filter((k) => !String(S[k]).trim());

  proposeBtn.onclick = async () => {
    const m = missing(); if (m.length) return toast(`Fill in: ${m.join(', ')}`, true);
    proposeBtn.disabled = true; mount(proposeBtn, spin(), ' Asking the Audience agent...');
    try {
      S.audience = await api('/api/audience', { method: 'POST', body: payload() });
      S.coreBands = [...S.audience.proposal.core.age_bands]; S.coreShareTouched = false;
      renderAudience();
    } catch (e) { fail(e); }
    proposeBtn.disabled = false; mount(proposeBtn, 'Propose audience');
  };
  runBtn.onclick = async () => {
    const m = missing(); if (m.length) return toast(`Fill in: ${m.join(', ')}`, true);
    const body = { ...payload(), crowdSize: S.crowdSize, rounds: S.rounds, seeds: S.seeds, useCustomers: S.useCustomers };
    if (S.audience && S.coreBands?.length) body.coreAgeBands = S.coreBands;
    if (S.audience && S.coreShareTouched) body.coreShare = S.coreShare;
    runBtn.disabled = true; mount(runBtn, spin(), ' Starting...');
    try { const r = await api('/api/runs', { method: 'POST', body }); location.hash = `#/run/${r.run_id}`; }
    catch (e) { fail(e); runBtn.disabled = false; mount(runBtn, 'Run Dry Run'); }
  };

  view.append(
    h('div.hero', h('h1', 'Two drafts in. A verdict, with reasons, out.'),
      h('p', 'Paste two versions of an Instagram post. A crowd of simulated people, sampled from live Census and Pew data, sees each in a twin world: same people, same follower graph, same schedule. Only the post differs.')),
    h('div.card', h('div.card-head', h('h2', 'Your business and posts'), h('button.btn.sm', { onclick: loadExample }, 'Load example')),
      h('div.form-grid',
        field('business', 'Business', text('business', 'South Congress Coffee'), 'span-4'),
        field('handle', 'Instagram handle', text('handle', '@southcongresscoffee'), 'span-4'),
        field('place', 'Place', text('place', 'Austin, TX 78704'), 'span-4'),
        field('zip', 'ZIP', text('zip', '78704'), 'span-3'),
        field('goal', 'Goal', text('goal', 'Get people within 3 miles to come in this week'), 'span-12'),
        field('postA', 'Version A', area('postA', 'Paste the caption for version A'), 'span-6'),
        field('postB', 'Version B', area('postB', 'Paste the caption for version B'), 'span-6'))),
    h('div.card', h('div.card-head', h('h2', 'Audience'), proposeBtn), audienceBox),
    h('div.card', h('div.card-head', h('h2', 'Run settings')),
      h('div.form-grid',
        field('crowdSize', 'Crowd size', select('crowdSize', [[24, '24 (smoke test)'], [60, '60 (quick)'], [120, '120'], [300, '300'], [600, '600 (full)']]), 'span-3'),
        field('rounds', 'Length', select('rounds', [[6, '6 rounds (smoke test)'], [12, '12 rounds'], [24, '24 rounds (one day, hourly)']]), 'span-3'),
        field('seeds', 'Seeds', select('seeds', [[1, '1 seed'], [2, '2 seeds (check agreement)']]), 'span-3'),
        h('div.span-3', h('label', 'Customer list'), h('label.toggle', { style: { textTransform: 'none', fontSize: '14px', color: 'var(--text)', fontWeight: 500 } },
          h('input', { type: 'checkbox', checked: S.useCustomers, onchange: (e) => { S.useCustomers = e.target.checked; } }), h('span', 'Use customer list (synthetic demo CSV)')))),
      h('div.row.spread', h('span.muted', 'Bigger crowds and more seeds take longer; the 60-person quick run is the demo default.'), runBtn)));
  renderAudience();
}

/* ============================================================ 6. runs list */
async function runsView(_m, view) {
  view.append(h('div.hero', h('h1', 'Runs'), h('p', 'Every Dry Run on this machine, newest first.')));
  const box = h('div', spin()); view.append(box);
  try {
    const list = await api('/api/runs');
    if (!list.length) return mount(box, h('div.empty', 'No runs yet. ', h('a', { href: '#/' }, 'Start one.')));
    mount(box, h('div.runs-grid', list.map((r) => h('a.card.run-card', { href: `#/run/${r.run_id}` },
      h('div.row.spread', h('span.chip.' + (r.status === 'done' ? 'good' : r.status === 'error' ? 'bad' : 'warn'), r.status), h('span.muted', new Date(r.created).toLocaleString())),
      h('h3', r.headline),
      h('div.row', { style: { gap: '6px' } }, h('span.chip', r.business), h('span.chip', `${r.crowd} people`), h('span.chip', `${r.rounds} rounds`), h('span.chip', `${r.seeds} seed${r.seeds > 1 ? 's' : ''}`),
        (r.posts || []).map(variantChip), r.parent ? h('span.chip', 'follow-up run') : null)))));
  } catch (e) { mount(box, h('div.banner.bad', e.message)); }
}

/* ============================================================ 7. backtest */
function wilson(k, n, z = 1.96) {
  if (!n) return [0, 0];
  const p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return [(c - m) / d, (c + m) / d];
}
async function backtestView(_m, view) {
  view.append(h('div.hero', h('h1', 'Backtest: does the crowd pick real winners?'),
    h('p', 'Real A/B headline tests from the Upworthy Research Archive. The crowd sees both headlines; we check its pick against the real click-through winner.')));
  const box = h('div', spin()); view.append(box);
  let data;
  try { data = await api('/api/backtest'); } catch (e) { return mount(box, h('div.banner.bad', e.message)); }
  const runs = (data.runs || []).filter((r) => r && r.scores);
  if (!runs.length) {
    return mount(box, h('div.card', h('h2', 'No backtest has been run yet'),
      h('p.muted', { style: { marginTop: '8px' } }, 'Method: take exploratory tests from the Upworthy Research Archive (4,873 exploratory tests, CC BY 4.0), keep the best-versus-worst headline pairs, show both to a general US crowd sampled from Census and Pew, and record which headline the crowd would tap. Score each pick against the real click-through winner, and compare it with a single prompt to a reasoning model, a single prompt to the crowd model, and a coin flip.'),
      h('p', 'Run it with:'), h('code.code', 'npm run backtest'),
      h('p.muted', { style: { marginTop: '10px' } }, 'Results are shown exactly as measured, with Wilson 95% intervals. These are headlines, not small-business posts.')));
  }
  let idx = 0;
  const body = h('div');
  const draw = () => {
    const r = runs[idx];
    const rate = (o) => (o.rate > 1 ? o.rate / 100 : o.rate ?? (o.n ? o.correct / o.n : 0));
    const rows = [
      ['Dry Run crowd', r.scores.crowd, true], ['Single prompt (reasoning model)', r.scores.single_reason], ['Single prompt (crowd model)', r.scores.single_crowd],
    ].filter((x) => x[1]).map(([name, o, hero]) => {
      const rt = rate(o); const ci = o.ci && o.ci.length === 2 ? o.ci.map((v) => (v > 1 ? v / 100 : v)) : wilson(o.correct ?? rt * o.n, o.n);
      return { name, rt, ci, n: o.n, correct: o.correct, hero };
    });
    const n0 = rows[0]?.n || 0;
    rows.push({ name: 'Coin flip (50%)', rt: 0.5, ci: wilson(n0 / 2, n0), n: n0, correct: n0 / 2, chance: true });
    const cfg = r.config || {};
    mount(body,
      h('div.card', h('div.card-head', h('h2', 'Accuracy at picking the real winner'), runs.length > 1 ? h('select', { style: { width: 'auto' }, onchange: (e) => { idx = Number(e.target.value); draw(); } },
        runs.map((x, i) => h('option', { value: i, selected: i === idx }, x.config?.created || x.created || `run ${i + 1}`))) : null),
        rows.map((x) => h('div.score' + (x.hero ? '.hero-row' : ''),
          h('div.name', x.name, h('div.muted', { style: { fontSize: '12px', fontWeight: 400 } }, `n = ${x.n}${x.correct != null && !x.chance ? `, ${Math.round(x.correct)} correct` : ''}`)),
          h('div.track', h('i', { style: { left: `${x.ci[0] * 100}%`, width: `${Math.max(0.5, (x.ci[1] - x.ci[0]) * 100)}%` } }), h('b', { style: { left: `${x.rt * 100}%` } }), h('u')),
          h('div', h('b', { style: { fontSize: '20px' } }, pct(x.rt, 0)), h('div.muted', { style: { fontSize: '12px' } }, `95% CI ${pct(x.ci[0], 0)} to ${pct(x.ci[1], 0)}`)))),
        h('div.expl', 'Bars show the Wilson 95% interval; the dark tick on the track is chance (50%). If an interval spans the tick, the result is not distinguishable from guessing.'),
        r.mcnemar ? h('div.expl', { style: { marginTop: '6px' } }, 'McNemar (crowd vs single prompt): ', h('span.mono', typeof r.mcnemar === 'object' ? JSON.stringify(r.mcnemar) : String(r.mcnemar))) : null,
        Object.keys(cfg).length ? h('div.chips', { style: { marginTop: '12px' } }, Object.entries(cfg).filter(([, v]) => typeof v !== 'object').map(([k, v]) => h('span.chip', `${k}: ${v}`))) : null),
      h('div.card', h('div.card-head', h('h2', 'Per-test results'), h('span.sub', `${(r.tests || []).length} tests`)),
        (r.tests || []).length ? h('div.tbl-wrap', h('table', h('thead', h('tr', ['Test', 'Headline A (real CTR)', 'Headline B (real CTR)', 'Real winner', 'Crowd taps A / B', 'Crowd pick', 'Single (reasoning)', 'Single (crowd)'].map((x, i) => h('th' + (i === 4 ? '.num' : ''), x)))),
          h('tbody', r.tests.map((t) => {
            const mark = (pick) => (pick == null ? h('span.muted', '-') : h('span.chip.' + (pick === t.real_winner ? 'good' : 'bad'), `${pick} ${pick === t.real_winner ? 'right' : 'wrong'}`));
            return h('tr', h('td.mono', String(t.test_id ?? '').slice(0, 10)), h('td', t.a?.headline, h('div.muted', pct(t.a?.ctr, 2))), h('td', t.b?.headline, h('div.muted', pct(t.b?.ctr, 2))),
              h('td', h('b', t.real_winner)), h('td.num', t.crowd ? `${t.crowd.a_tap ?? '-'} / ${t.crowd.b_tap ?? '-'}` : '-'), h('td', mark(t.crowd?.pick)), h('td', mark(t.single_reason?.pick)), h('td', mark(t.single_crowd?.pick)));
          })))) : h('div.empty', 'No per-test rows in this file.')));
  };
  mount(box, body); draw();
}

/* ============================================================ 8. run view (live) */
const PHASES = [['data', 'Data'], ['audience', 'Audience'], ['sampling', 'Sampling'], ['voices', 'Voices'], ['running', 'Running'], ['analyzing', 'Analyzing'], ['report', 'Report'], ['done', 'Done']];
const FEED_CAP = 150;
const vcolor = (v) => `var(--${String(v).toLowerCase()})`;
const metricName = (m) => (m === 'tap_rate' ? 'tap-through' : 'intent to visit');
const segLabel = (key) => {
  const [d, v] = key.split(':');
  if (d === 'role') return v === 'core' ? 'Core audience' : 'Spillover';
  if (d === 'customer') return v === 'yes' ? 'Existing customers' : 'Not customers';
  return v;
};

function runView(id, view) {
  const S = {
    id, seed: 1, spec: null, status: 'queued', phase: 'queued', detail: '', error: null,
    personas: [], pmap: new Map(), sample: null, proposal: null,
    rec: {}, recIds: new Set(), timeline: {}, counters: {}, events: [], usage: new Map(), traceLog: [],
    verdict: null, tipping: null, validity: null, fairness: [], report: null, focus: [], toolsBuilt: false, verdictShown: false,
  };
  RUN = { id, S };
  let es = null, closed = false;
  const ui = {};
  const worldIds = () => (S.spec?.posts || [{ variant: 'A' }, { variant: 'B' }]).map((p) => `s${S.seed}:${p.variant}`);
  const variants = () => (S.spec?.posts || [{ variant: 'A' }, { variant: 'B' }]).map((p) => p.variant);
  const hourOfRound = (r) => {
    const sp = S.spec; if (!sp) return `Round ${r}`;
    const t = sp.startHour + r * sp.hourStep;
    return `Day ${Math.floor(t / 24) + 1} ${hourStr(t % 24)}`;
  };

  /* ---- skeleton */
  ui.head = h('div.run-head');
  ui.phases = h('div.phases');
  ui.detail = h('div.phase-detail');
  ui.banner = h('div');
  ui.crowd = h('div.card');
  ui.compare = h('div.compare');
  ui.chart = h('div.card.chart-card');
  ui.inject = h('div.card');
  ui.nemo = h('div.card.nemo');
  ui.feeds = h('div.feeds');
  ui.verdict = h('div');
  ui.report = h('div');
  ui.tools = h('div');
  view.append(ui.head, ui.phases, ui.detail, ui.banner, ui.crowd,
    h('div.section-title', h('h2', 'Twin worlds'), h('span.muted', 'identical crowd, graph and schedule; only the post differs')), ui.compare,
    h('div.grid', { style: { gridTemplateColumns: 'minmax(0,1.5fr) minmax(0,1fr)', marginTop: '16px' }, class: 'splitrow' }, ui.chart, h('div.stack', ui.inject, ui.nemo)),
    h('div.section-title', h('h2', 'Live feeds'), h('span.muted', 'newest first; most people scroll past')), ui.feeds,
    ui.verdict, ui.report, ui.tools);
  const style = h('style', '@media (max-width:1100px){.splitrow{grid-template-columns:minmax(0,1fr) !important}}'); document.head.append(style);

  /* ---- head / phases / banner */
  function renderHead() {
    const sp = S.spec;
    const fair = S.fairness || [];
    mount(ui.head,
      h('div', h('h1', sp ? sp.business : 'Loading run...'),
        h('div.row', { style: { marginTop: '6px', gap: '8px' } },
          h('span.chip.mono', id),
          h('span.chip.' + (S.status === 'done' ? 'good' : S.status === 'error' ? 'bad' : 'warn'), S.status),
          sp ? h('span.chip', `${sp.crowdSize} people`) : null, sp ? h('span.chip', `${sp.rounds} rounds`) : null,
          sp?.parent_run ? h('a.chip', { href: `#/run/${sp.parent_run}` }, 'follow-up to ' + sp.parent_run.slice(-4)) : null,
          fair.length ? fair.map((f) => {
            const keys = Object.keys(f.base_shapes || {}); const hash = Object.values(f.base_shapes || {})[0] || f.fingerprint || '';
            return h('span.chip.' + (f.identical ? 'good' : 'bad'), { title: `Base log fingerprint ${f.fingerprint}. The twin worlds start from the same crowd, graph and schedule.` },
              f.identical ? `Base log hash ${keys.join(' = ')} ✓ ` : `Base logs differ for seed ${f.seed} ✗ `, h('span.mono', String(hash).slice(0, 8)));
          }) : h('span.chip', { title: 'Shown once the twin worlds have forked' }, 'Twin-world check pending'),
          h('span.chip#stream-chip', { title: 'Server-sent events connection' }, 'stream: connecting'))),
      h('div.row', { style: { gap: '8px' } }, S.replay ? [h('span.chip.on', `Replaying round ${Math.max(0, S.replayLim + 1)} of ${S.spec.rounds}`), h('button.btn.sm', { onclick: () => stopReplay(true) }, 'Stop')]
        : (S.status === 'done' || S.status === 'error') && (S.spec && Object.keys(S.rec).length) ? h('button.btn.sm.primary', { title: 'Re-play the stored actions round by round', onclick: startReplay }, '\u25B6 Replay') : null,
        h('select', { style: { width: 'auto', padding: '4px 8px' }, title: 'Replay speed', onchange: (e) => { S.speed = Number(e.target.value); } }, [[0.5, '0.5x'], [1, '1x'], [2, '2x']].map(([v, l]) => h('option', { value: v, selected: v === S.speed }, l)))),
      sp && sp.seeds.length > 1 ? h('div.chips', sp.seeds.map((sd) => h('button.chip' + (sd === S.seed ? '.on' : ''), { onclick: () => { S.seed = sd; renderHead(); buildWorlds(); drawChart(); } }, `Seed ${sd}`))) : null);
    setStream(ui._stream);
  }
  function setStream(state) { ui._stream = state; const c = $('#stream-chip'); if (c) c.textContent = 'stream: ' + (state || 'connecting'); }
  function renderPhases() {
    let idx = PHASES.findIndex((p) => p[0] === S.phase);
    if (S.status === 'done') idx = PHASES.length;
    if (idx < 0) idx = S.phaseIdx ?? 0;
    S.phaseIdx = idx;
    mount(ui.phases, PHASES.map((p, i) => h('div.phase' + (i < idx ? '.done' : i === idx ? '.now' : ''), h('i'), p[1])));
    mount(ui.detail, S.status === 'error' ? null : (S.detail || ''));
    mount(ui.banner, S.status === 'error' ? h('div.banner.bad', `Run stopped: ${S.error || 'unknown error'}. Anything already simulated is still shown below.`) : null);
  }

  /* ---- crowd panel */
  function renderCrowd() {
    const ps = S.personas;
    if (!ps.length) { mount(ui.crowd, h('div.row', spin(), h('span.muted', 'Sampling the crowd from Census and Pew...'))); return; }
    const sr = S.sample || {};
    const core = ps.filter((p) => p.role === 'core').length;
    const cust = ps.filter((p) => p.customer).length;
    const dist = (title, keys, field, nat) => h('div', h('h3', { style: { margin: '6px 0' } }, title),
      keys.map((k) => { const share = ps.filter((p) => p[field] === k).length / ps.length; const n = nat?.[k];
        return h('div.dist', h('span', k), h('div.track', h('i', { style: { width: `${share * 100}%` } }), n != null ? h('u', { title: `Natural share ${pct(n)}`, style: { left: `${n * 100}%` } }) : null), h('span.mono', `${pct(share, 0)}${n != null ? ` / ${pct(n, 0)}` : ''}`)); }));
    const cop = sr.copula;
    const dots = ps.map((p) => h('button.dotp', { title: `${p.id}: ${p.age}, ${p.role}, ${p.income_band}`, style: { background: p.role === 'core' ? 'var(--accent)' : 'var(--line-2)' }, onclick: () => openAgent(p.id) }));
    mount(ui.crowd,
      h('div.card-head', h('h2', 'The crowd'), h('span.sub', 'Bars: crowd share / natural share in the data (tick). Click any square to open a person and their receipts.')),
      h('div.grid', { style: { gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))' } },
        h('div',
          h('div.counters', { style: { gridTemplateColumns: 'repeat(2,1fr)' } },
            h('div.counter', h('span', 'People'), h('b', fmtInt(ps.length))),
            h('div.counter', h('span', 'Core / spillover'), h('b', `${core} / ${ps.length - core}`), h('small', ` ${pct(core / ps.length, 0)} core${sr.target_core_share != null ? `, target ${pct(sr.target_core_share, 0)}, natural ${pct(sr.natural_core_share, 0)}` : ''}`)),
            h('div.counter', h('span', 'Existing customers'), h('b', fmtInt(cust)), h('small', cust ? ' from the synthetic demo list' : '')),
            h('div.counter', h('span', 'Voice fallbacks'), h('b', fmtInt(sr.voice_fallbacks ?? 0)), h('small', ` ${fmtInt(sr.voice_rejected ?? 0)} rejected`))),
          sr.instagram_users_est ? h('div.expl', { style: { marginTop: '10px' } }, `Audience estimate: ${fmtInt(sr.instagram_users_est)} Instagram users (Census x Pew join).`) : null,
          h('div.crowd-dots', dots)),
        dist('Age', AGE_BANDS, 'age_band', sr.marginals?.age),
        dist('Household income', INCOME_BANDS, 'income_band', sr.marginals?.income),
        h('div',
          cop ? [h('h3', { style: { margin: '6px 0' } }, `Customer copula (n = ${cop.n})`),
            h('div.corr', { style: { gridTemplateColumns: `repeat(${cop.columns.length}, 1fr)` } }, cop.corr.flatMap((row) => row.map((v) => h('div', { title: String(v), style: { background: `color-mix(in srgb, ${v >= 0 ? 'var(--accent)' : 'var(--b)'} ${Math.round(Math.abs(v) * 70)}%, var(--panel-2))` } }, v.toFixed(2))))),
            h('div.expl', cop.columns.join(' | '))] : null,
          sr.queries?.length ? [h('h3', { style: { margin: '12px 0 6px' } }, 'Queries behind it'), h('div.chips', sr.queries.map((q) => h('button.chip.qid', { title: `${q.label} (${q.engine})`, onclick: () => openQuery(q.query_id) }, q.label)))] : null)));
  }

  /* ---- worlds: counters + feeds */
  const W = {};
  function buildWorlds() {
    const ws = worldIds(), vs = variants();
    for (const k of Object.keys(W)) delete W[k];
    mount(ui.compare, ws.map((wid, i) => {
      const v = vs[i], post = S.spec?.posts.find((p) => p.variant === v);
      const w = W[wid] = {};
      w.title = h('span.muted');
      w.cells = {};
      const cell = (key, label) => { const b = h('b', '-'), sm = h('small'); w.cells[key] = { b, sm }; return h('div.counter', h('span', label), b, sm); };
      w.meterV = h('i.vocal'); w.meterS = h('i.silent');
      w.meterLabel = h('small');
      return h('div.card.world-card.v-' + v, h('div.world-title', variantChip(v), h('h3', `World ${v}`), w.title),
        h('div.post-text', post ? post.text : ''),
        h('div.counters', cell('deciders', 'Deciders'), cell('intent', 'Intent rate'), cell('hides', 'Hides'), cell('stance', 'Mean stance'), cell('calls', 'Model calls'), cell('exposures', 'Exposures')),
        h('div', { style: { marginTop: '12px' } }, h('div.row.spread', h('span.counter', h('span', 'Vocal vs silent')), w.meterLabel), h('div.meter', w.meterV, w.meterS)));
    }));
    mount(ui.feeds, ws.map((wid, i) => {
      const v = vs[i], w = W[wid];
      w.feed = h('div.feed'); w.count = h('span.count');
      return h('div.phone', h('div.phone-top', h('div.row', { style: { gap: '8px' } }, variantChip(v), h('b', S.spec?.handle || '')), w.count), w.feed);
    }));
    ws.forEach((wid) => { updateCounters(wid); redrawFeed(wid); });
  }
  function updateCounters(wid) {
    const w = W[wid]; if (!w) return;
    const c = S.counters[wid];
    const target = Math.min(500, S.spec?.crowdSize || 500);
    if (!c) { w.cells.deciders.b.textContent = '0'; w.cells.deciders.sm.textContent = ` / ${target}`; return; }
    const d = c.deciders;
    w.title.textContent = `${c.hour_label} (round ${c.round + 1}${S.spec ? ` of ${S.spec.rounds}` : ''})`;
    w.cells.deciders.b.textContent = fmtInt(d); w.cells.deciders.sm.textContent = ` / ${fmtInt(target)} target`;
    w.cells.intent.b.textContent = d ? pct(c.intent / d, 0) : '-'; w.cells.intent.sm.textContent = d ? ` ${c.intent} of ${d}` : '';
    w.cells.hides.b.textContent = fmtInt(c.hides); w.cells.hides.sm.textContent = '';
    w.cells.stance.b.textContent = d ? (c.stance_sum / d >= 0 ? '+' : '') + num(c.stance_sum / d) : '-'; w.cells.stance.sm.textContent = ' -1 to +1';
    w.cells.calls.b.textContent = fmtInt(c.calls); w.cells.exposures.b.textContent = fmtInt(c.exposures);
    const vs = d ? c.vocal / d : 0;
    w.meterV.style.width = `${vs * 100}%`; w.meterS.style.width = d ? `${(1 - vs) * 100}%` : '0';
    w.meterLabel.textContent = d ? `${pct(vs, 0)} vocal (commented or shared), ${pct(1 - vs, 0)} silent` : 'waiting for deciders';
  }
  function feedCard(r) {
    const p = S.pmap.get(r.agent_id);
    const scroll = r.action === 'scroll_past';
    return h('div.fcard' + (scroll ? '.scroll' : ''), { 'data-id': r.id },
      avatar(r.agent_id),
      h('div',
        h('div.fhead', h('span.who', { onclick: () => openAgent(r.agent_id, { world: r.world_id }) }, r.agent_id),
          p ? h('span.meta', { title: p.segment }, `${p.age}, ${p.role}`) : null,
          actPill(r.action),
          r.item_kind === 'share' && r.via ? h('span.chip', { style: { fontSize: '11px', padding: '0 7px' } }, `via ${r.via}`) : null,
          r.item_kind === 'event' ? h('span.chip', { style: { fontSize: '11px', padding: '0 7px' } }, 'reacting to news') : null,
          h('span.hr', roundTime(r.hour))),
        r.text ? h('div.said', r.text) : null,
        r.reason ? h('div.thought', `thought: ${r.reason}`) : null,
        r.unsaid ? h('div.unsaid', h('b', 'kept to themselves: '), r.unsaid) : null));
  }
  function redrawFeed(wid) {
    const w = W[wid]; if (!w) return;
    const recs = S.rec[wid] || [];
    mount(w.feed, recs.length ? [...recs].reverse().map(feedCard) : h('div.feed-empty', 'Waiting for the first person to see the post...'));
    w.count.textContent = `${recs.length} shown`;
  }
  const seq = (r) => Number(String(r.id).split(':').pop()) || 0;
  function addAction(r, live) {
    if (S.recIds.has(r.id)) return;
    S.recIds.add(r.id);
    const arr = S.rec[r.world_id] || (S.rec[r.world_id] = []);
    arr.push(r); if (arr.length > FEED_CAP) arr.shift();
    const w = W[r.world_id];
    if (live && w) {
      if (w.feed.firstChild?.classList.contains('feed-empty')) clear(w.feed);
      const c = feedCard(r); if (r.action !== 'scroll_past') c.classList.add('fresh');
      w.feed.prepend(c); setTimeout(() => c.classList.remove('fresh'), 1800);
      while (w.feed.children.length > FEED_CAP) w.feed.lastChild.remove();
      w.count.textContent = `${arr.length} shown`;
    }
  }

  /* ---- chart (hand-rolled SVG) */
  function drawChart() {
    const sp = S.spec; if (!sp) return;
    const ws = worldIds(), vs = variants();
    const W_ = 760, H_ = 250, m = { l: 44, r: 16, t: 14, b: 40 };
    const series = ws.map((wid, i) => {
      const tl = S.timeline[wid] || {};
      return { v: vs[i], pts: Object.values(tl).filter((c) => c.deciders > 0 && c.round <= (S.replayLim ?? 1e9)).map((c) => ({ r: c.round, y: c.intent / c.deciders, c })).sort((a, b) => a.r - b.r) };
    });
    const maxY = Math.min(1, Math.max(0.2, Math.ceil(Math.max(0, ...series.flatMap((x) => x.pts.map((p) => p.y))) * 10 + 1) / 10));
    const n = Math.max(2, sp.rounds);
    const X = (r) => m.l + (r / (n - 1)) * (W_ - m.l - m.r);
    const Y = (y) => H_ - m.b - (y / maxY) * (H_ - m.t - m.b);
    const svg = s('svg', { viewBox: `0 0 ${W_} ${H_}`, role: 'img', 'aria-label': 'Intent rate per round for each world' });
    for (let i = 0; i <= 4; i++) { const y = (maxY / 4) * i; svg.append(s('line', { x1: m.l, x2: W_ - m.r, y1: Y(y), y2: Y(y), stroke: 'var(--line)', 'stroke-width': 1 }), s('text', { x: m.l - 8, y: Y(y) + 4, 'text-anchor': 'end', 'font-size': 11, fill: 'var(--muted)' }, pct(y, 0))); }
    const step = Math.max(1, Math.round(n / 6));
    for (let r = 0; r < n; r += step) svg.append(s('text', { x: X(r), y: H_ - m.b + 16, 'text-anchor': 'middle', 'font-size': 11, fill: 'var(--muted)' }, `r${r + 1}`), s('text', { x: X(r), y: H_ - m.b + 30, 'text-anchor': 'middle', 'font-size': 10, fill: 'var(--faint)' }, hourOfRound(r).replace('Day ', 'D')));
    for (const ev of S.events.filter((e) => e.round <= (S.replayLim ?? 1e9))) {
      svg.append(s('line', { x1: X(ev.round), x2: X(ev.round), y1: m.t, y2: H_ - m.b, stroke: 'var(--bad)', 'stroke-width': 1.5, 'stroke-dasharray': '4 3' }),
        s('path', { d: `M${X(ev.round) - 5},${m.t} h10 l-5,8 z`, fill: 'var(--bad)' }, s('title', {}, `Injected at round ${ev.round + 1} (${ev.target}): ${ev.text}`)));
    }
    for (const sr of series) {
      if (!sr.pts.length) continue;
      const col = vcolor(sr.v);
      svg.append(s('polyline', { points: sr.pts.map((p) => `${X(p.r)},${Y(p.y)}`).join(' '), fill: 'none', stroke: col, 'stroke-width': 3, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
      for (const p of sr.pts) svg.append(s('circle', { cx: X(p.r), cy: Y(p.y), r: 4, fill: col, stroke: 'var(--panel)', 'stroke-width': 2 }, s('title', {}, `Version ${sr.v}, ${hourOfRound(p.r)}: ${pct(p.y)} intent (${p.c.intent} of ${p.c.deciders})`)));
    }
    mount(ui.chart,
      h('div.card-head', h('h2', 'Intent to visit, by round'), h('div.legend', vs.map((v) => h('span', h('i', { style: { background: vcolor(v) } }), `Version ${v}`)), S.events.length ? h('span', h('i', { style: { background: 'var(--bad)' } }), 'injected event') : null)),
      svg, series.every((x) => !x.pts.length) ? h('div.expl', 'The lines appear as the first rounds complete.') : null);
  }

  /* ---- inject */
  function renderInject() {
    const sp = S.spec; if (!sp) return;
    const text = h('input', { type: 'text', placeholder: 'e.g. A competitor posts 30% off' });
    const cur = Math.max(0, ...Object.values(S.counters).map((c) => c.round + 1));
    const round = h('select', Array.from({ length: sp.rounds }, (_, r) => h('option', { value: r, selected: r === Math.min(sp.rounds - 1, cur) }, `${r + 1}: ${hourOfRound(r)}`)));
    const target = h('select', ['all', 'core', 'spillover'].map((t) => h('option', { value: t }, t)));
    const btn = h('button.btn.primary', 'Inject');
    const go = async () => {
      if (!text.value.trim()) return toast('Write the event text first', true);
      btn.disabled = true;
      try { const e = await api(`/api/runs/${id}/events`, { method: 'POST', body: { text: text.value.trim(), round: Number(round.value), target: target.value } }); addEvent(e); text.value = ''; toast(`Injected for round ${e.round + 1}`); }
      catch (e) { fail(e); }
      btn.disabled = false;
    };
    btn.onclick = go; text.onkeydown = (e) => { if (e.key === 'Enter') go(); };
    mount(ui.inject, h('div.card-head', h('h2', 'Inject an event'), h('span.sub', 'affects both worlds equally')),
      h('div.inject', h('div', h('label', 'What happens'), text), h('div', h('label', 'Round'), round), h('div', h('label', 'Who sees it'), target), btn),
      S.status === 'done' || S.status === 'error' ? h('div.expl', { style: { marginTop: '8px' } }, 'This run has finished; new events only matter for runs still in progress.') : null,
      S.events.length ? h('div', { style: { marginTop: '10px' } }, S.events.map((e) => h('div.expl', `Round ${e.round + 1} (${e.target}): ${e.text}`))) : null);
  }
  function addEvent(e) {
    if (S.events.some((x) => x.id === e.id)) return;
    S.events.push(e); drawChart(); renderInject();
  }

  /* ---- nemotron panel */
  function addUsage(rows) {
    S.usage.clear();
    for (const u of rows || []) S.usage.set(`${u.role}|${u.model}`, { role: u.role, model: u.model, calls: u.calls, tin: u.tokens_in, tout: u.tokens_out, ms: u.avg_ms * u.calls, errors: u.errors || 0, served: { ...u.served_by } });
  }
  function addTrace(t) {
    const k = `${t.role}|${t.model}`;
    const u = S.usage.get(k) || { role: t.role, model: t.model, calls: 0, tin: 0, tout: 0, ms: 0, errors: 0, served: {} };
    u.calls++; u.tin += t.tokens_in; u.tout += t.tokens_out; u.ms += t.ms; if (!t.ok) u.errors++;
    u.served[t.served_by] = (u.served[t.served_by] || 0) + 1;
    S.usage.set(k, u);
    S.traceLog.unshift(t); if (S.traceLog.length > 8) S.traceLog.pop();
    scheduleNemo();
  }
  let nemoTimer = null;
  const scheduleNemo = () => { if (!nemoTimer) nemoTimer = setTimeout(() => { nemoTimer = null; renderNemo(); }, 400); };
  function renderNemo() {
    const rows = [...S.usage.values()].sort((a, b) => a.role.localeCompare(b.role));
    const totalCalls = rows.reduce((a, r) => a + r.calls, 0);
    mount(ui.nemo, h('div.card-head', h('h2', 'Nemotron panel'), h('span.sub', `${fmtInt(totalCalls)} calls. served_by shows which model answered each call.`)),
      rows.length ? h('div.tbl-wrap', h('table', h('thead', h('tr', h('th', 'Role'), h('th', 'Model'), h('th.num', 'Calls'), h('th.num', 'Tok in/out'), h('th.num', 'Avg ms'), h('th', 'Served by'))),
        h('tbody', rows.map((r) => h('tr', h('td', h('b', r.role)), h('td.mono', r.model), h('td.num', fmtInt(r.calls)), h('td.num', `${fmtInt(r.tin)} / ${fmtInt(r.tout)}`), h('td.num', fmtInt(Math.round(r.ms / Math.max(1, r.calls)))),
          h('td', Object.entries(r.served).map(([k, c]) => h('span.served', `${k} x${c}`)), r.errors ? h('span.chip.bad', `${r.errors} errors`) : null)))))) : h('div.muted', 'Waiting for the first model call...'),
      S.traceLog.length ? h('div.ticker', S.traceLog.map((t) => h('div', `${t.role} | ${t.served_by} | ${(t.ms / 1000).toFixed(1)}s | ${t.tokens_in}>${t.tokens_out} tok${t.ok ? '' : ' | FAILED'}`))) : null);
  }

  /* ---- state application */
  function mergeTimeline(wid, entries) { const tl = S.timeline[wid] || (S.timeline[wid] = {}); for (const c of entries || []) tl[c.round] = c; }
  function setCounters(wid, c) { mergeTimeline(wid, [c]); const cur = S.counters[wid]; if (!cur || c.round >= cur.round) S.counters[wid] = c; if (wid.startsWith(`s${S.seed}:`)) updateCounters(wid); }
  function applySnap(st, full) {
    S.spec = st.spec; S.status = st.status; S.phase = st.phase; S.error = st.error;
    S.sample = st.sampleReport || S.sample; S.proposal = st.proposal || S.proposal;
    if (st.personas?.length && !S.personas.length) setPersonas(st.personas);
    S.summaries = st.summaries || [];
    S.verdict = st.verdict || S.verdict; S.tipping = st.tipping || S.tipping; S.validity = st.validity || S.validity;
    S.fairness = st.fairness || S.fairness; S.report = st.report || S.report;
    for (const e of st.spec.events || []) if (!S.events.some((x) => x.id === e.id)) S.events.push(e);
    for (const w of st.worlds || []) { mergeTimeline(w.world_id, w.timeline); if (w.counters) S.counters[w.world_id] = w.counters; }
    if (st.usage) addUsage(st.usage);
    if (full && S.spec) { const first = S.spec.seeds?.[0]; if (first && !S.seedInit) { S.seed = first; S.seedInit = true; } }
  }
  function setPersonas(ps) { S.personas = ps; S.pmap = new Map(ps.map((p) => [p.id, p])); }
  async function loadHistory(st) {
    if (!(st.worlds || []).some((w) => w.decisions > 0)) return;
    try {
      const recs = await api(`/api/runs/${id}/actions?limit=2000`);
      const byWorld = {};
      for (const r of recs) (byWorld[r.world_id] || (byWorld[r.world_id] = [])).push(r);
      for (const [wid, list] of Object.entries(byWorld)) {
        const have = S.rec[wid] || [];
        const merged = [...list.filter((r) => !S.recIds.has(r.id)), ...have].sort((a, b) => seq(a) - seq(b)).slice(-FEED_CAP);
        list.forEach((r) => S.recIds.add(r.id)); S.rec[wid] = merged;
      }
      worldIds().forEach(redrawFeed); renderHead();
    } catch (e) { /* feeds fill from the live stream instead */ }
  }
  function renderAll() {
    renderHead(); renderPhases(); renderCrowd(); drawChart(); renderInject(); renderNemo();
    renderVerdict(); renderReport(); renderTools();
  }
  async function refetch() {
    try { applySnap(await api(`/api/runs/${id}`)); renderAll(); worldIds().forEach(updateCounters); } catch { /* keep what we have */ }
  }

  /* ---- replay (finished runs): re-animate stored actions through the same card + counter + chart code */
  let rTimer = null;
  const hoursOf = (r) => ((S.spec.startHour + r * S.spec.hourStep) % 24);
  async function startReplay() {
    if (S.replay) return;
    let all;
    try { all = await api(`/api/runs/${id}/actions?limit=200000`); } catch (e) { return fail(e); }
    const ws = worldIds();
    const byRound = {};   // round -> [records of this seed]
    for (const wid of ws) {
      for (const rec of all.filter((x) => x.world_id === wid)) {
        const r = Math.min(S.spec.rounds - 1, Math.max(0, rec.hour));   // record.hour is the round index
        (byRound[r] || (byRound[r] = [])).push(rec);
      }
    }
    S.saved = { counters: { ...S.counters }, rec: S.rec, recIds: S.recIds };
    S.rec = {}; S.recIds = new Set(); for (const wid of ws) delete S.counters[wid];
    S.replay = true; S.replayLim = -1; S.speed = S.speed || 1;
    ws.forEach((wid) => { redrawFeed(wid); updateCounters(wid); }); drawChart(); renderHead();
    let r = -1;
    const step = () => {
      r++;
      if (r >= S.spec.rounds) return stopReplay(false);
      S.replayLim = r;
      for (const rec of byRound[r] || []) addAction(rec, true);
      for (const wid of ws) { const c = S.timeline[wid]?.[r]; if (c) { S.counters[wid] = c; updateCounters(wid); } }
      for (const ev of S.events.filter((e) => e.round === r)) toast(`Event injected: ${ev.text}`);
      drawChart(); renderHead();
      rTimer = setTimeout(step, 1200 / S.speed);
    };
    step();
  }
  function stopReplay(abort) {
    clearTimeout(rTimer); rTimer = null;
    if (!S.replay) return;
    S.replay = false; S.replayLim = null;
    if (abort || true) { S.counters = S.saved.counters; S.rec = S.saved.rec; S.recIds = S.saved.recIds; }
    worldIds().forEach((wid) => { updateCounters(wid); redrawFeed(wid); }); drawChart(); renderHead();
  }

  /* ---- stream */
  function handle(e) {
    switch (e.type) {
      case 'snapshot': {
        applySnap(e.state, true);
        const first = !ui.built;
        if (first) { ui.built = true; buildWorlds(); }
        renderAll(); worldIds().forEach(updateCounters);
        loadHistory(e.state);
        if (S.verdict) S.verdictShown = true;
        break;
      }
      case 'status': S.phase = e.phase; S.detail = e.detail || ''; if (['building', 'running', 'analyzing'].includes(S.status) === false && S.status !== 'error') S.status = 'building'; renderPhases(); renderHead(); break;
      case 'crowd': setPersonas(e.personas); S.sample = e.report || S.sample; S.proposal = e.proposal || S.proposal; renderCrowd(); break;
      case 'action': addAction(e.record, true); break;
      case 'round': case 'world_done': setCounters(e.world_id, e.counters); if (wid_in_seed(e.world_id)) drawChart(); break;
      case 'event_injected': addEvent(e.event); break;
      case 'verdict': S.verdict = e.verdict; refetch().then(() => { if (!S.verdictShown) { S.verdictShown = true; ui.verdict.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }); break;
      case 'report': S.report = e.report; renderReport(); renderTools(); break;
      case 'error': S.status = 'error'; S.error = e.message; renderPhases(); renderHead(); break;
      case 'done': S.status = 'done'; S.phase = 'done'; refetch(); break;
      case 'trace': addTrace(e.entry); break;
      case 'focus': S.focus.push(e.turn); renderFocus(); break;
      default: break;
    }
  }
  const wid_in_seed = (wid) => wid.startsWith(`s${S.seed}:`);

  api(`/api/runs/${id}`).then(() => {
    if (closed) return;
    es = new EventSource(`/api/runs/${id}/stream`);
    es.onopen = () => setStream('live');
    es.onmessage = (m) => { try { handle(JSON.parse(m.data)); } catch (err) { console.error('stream event failed', err, m.data.slice(0, 200)); } };
    es.onerror = () => setStream(es.readyState === 2 ? 'closed' : 'reconnecting');
  }).catch((e) => { mount(view, h('div.banner.bad', `Could not open run ${id}: ${e.message}`), h('a.btn', { href: '#/runs' }, 'Back to runs')); });

  renderHead(); renderPhases(); renderCrowd();

  /* ============================================================ 9. verdict */
  function renderVerdict() {
    const v = S.verdict;
    if (!v) { mount(ui.verdict); return; }
    const [va, vb] = v.variants, tie = v.call !== 'winner', p = v.pooled;
    const maxD = Math.max(0.15, Math.abs(p.diff) + p.ci_half) * 1.1;
    const pos = (x) => `${50 + (x / maxD) * 50}%`;
    const lo = p.diff - p.ci_half, hi = p.diff + p.ci_half;
    const side = (variant, val, moe, n) => h('div.side.' + variant + (v.winner === variant ? '.lead' : ''),
      h('div.row.spread', h('b', `Version ${variant}`), v.winner === variant ? h('span.chip.good', 'winner') : null),
      h('div.val', pct(val), h('small', ` ± ${(moe * 100).toFixed(1)} pts`)), h('div.muted', `${n} simulated people deciding, ${metricName(v.metric)}`));
    const sec = v.secondary || {};
    const secRows = [['engagement_rate', 'Engagement rate', 'share of exposures that got a like, comment, share, save or tap', pct], ['tap_rate', 'Tap-through rate', 'deciders who tapped through', pct], ['mean_stance', 'Mean private stance', '-1 negative to +1 positive', (x) => (x >= 0 ? '+' : '') + num(x)],
      ['vocal_share', 'Vocal share', 'deciders who commented or shared (the rest stayed silent)', pct], ['silent_negative_share', 'Silent negatives', 'privately negative but said nothing', pct], ['hide_rate', 'Hide rate', 'exposures where the person hid the post', pct]];
    const groups = ['role', 'age', 'income', 'customer'];
    const segRows = [];
    for (const g of groups) {
      const rows = (v.segments || []).filter((x) => x.key.startsWith(g + ':'));
      if (!rows.length) continue;
      segRows.push(h('tr.group-row', h('td', { colspan: 6 }, { role: 'Audience role', age: 'Age', income: 'Household income', customer: 'Customer status' }[g])));
      for (const x of rows) segRows.push(h('tr', { style: x.clear ? { fontWeight: 600 } : {} },
        h('td', segLabel(x.key)), h('td.num', pct(x.a, 0)), h('td.num', pct(x.b, 0)),
        h('td', h('div.segbar', h('i', { style: { background: vcolor(va), width: `${x.a * 100}%` } }), h('i', { style: { background: vcolor(vb), width: `${x.b * 100}%` } }))),
        h('td.num.muted', `${x.na} / ${x.nb}`),
        h('td', x.prefers ? h('span.chip.' + x.prefers.toLowerCase(), x.prefers) : h('span.muted', 'tie'), ' ', x.clear ? h('span.chip.good', 'clear') : h('span.muted', { style: { fontSize: '12px' } }, 'not clear'))));
    }
    const val = S.validity;
    const vexp = val ? [
      ['Repaired share', pct(val.repaired_share), 'Model answers that broke the schema and had to be repaired. Lower is better.'],
      ['Distinct reason ratio', num(val.distinct_reason_ratio, 2), 'Unique private reasons out of all reasons. Near 1 means people are not repeating one script.'],
      ['Top reason opener', val.top_reason_opener ? `"${val.top_reason_opener.text}" (${pct(val.top_reason_opener.share)})` : 'none', 'Most common first three words of a reason. A big share flags templated answers.'],
      ['Scroll-past share', pct(val.scroll_past_share, 0), 'Decisions that were a scroll-past. Real feeds are mostly scroll-past, so a realistic run is high.'],
      ['Stance spread (sd)', (val.stance_sd_by_world || []).map((x) => `${x.world}: ${num(x.sd)}`).join(', '), 'Standard deviation of private stance in each world. Near zero means everyone thinks alike.'],
      ['Silenced reactions', fmtInt(val.silenced), 'Times someone wanted to say something and kept it to themselves (the speak gate).'],
      ['Decisions', fmtInt(val.decisions), 'Total decisions logged across all twin worlds.'],
    ] : [];
    mount(ui.verdict,
      h('div.section-title', h('h2', 'Verdict')),
      h('div.verdict' + (tie ? '.tie' : ''),
        h('span.badge.' + (tie ? 'tie' : 'win'), tie ? 'Too close to call' : 'We have a winner'),
        h('h2', v.headline),
        h('div.bigpair', side(va, p.a, p.moe_a, p.na), side(vb, p.b, p.moe_b, p.nb)),
        h('div.diffbar', h('div.mid'), h('div.ci', { style: { left: pos(Math.max(-maxD, lo)), width: `calc(${pos(Math.min(maxD, hi))} - ${pos(Math.max(-maxD, lo))})` } }), h('div.pt', { style: { left: pos(p.diff) } })),
        h('div.scale', h('span', `${vb} ahead`), h('span', `Difference ${va} - ${vb}: ${p.diff >= 0 ? '+' : ''}${(p.diff * 100).toFixed(1)} pts ± ${(p.ci_half * 100).toFixed(1)}`), h('span', `${va} ahead`)),
        h('div.expl', { style: { marginTop: '8px' } }, tie ? 'The interval around the difference includes zero, or the seeds disagree. We do not pick a winner on noise.' : `The interval excludes zero and ${v.seeds_agree} of ${v.per_seed.length} seeds agree.`)),
      h('div.grid.two', { style: { marginTop: '16px' } },
        h('div.card', h('div.card-head', h('h3', 'Per seed')), h('table', h('thead', h('tr', h('th', 'Seed'), h('th.num', va), h('th.num', vb), h('th.num', 'n'), h('th', 'Leader'))),
          h('tbody', v.per_seed.map((x) => h('tr', h('td', x.seed), h('td.num', pct(x.a)), h('td.num', pct(x.b)), h('td.num.muted', `${x.na} / ${x.nb}`), h('td', x.leader === 'tie' ? h('span.muted', 'tie') : h('span.chip.' + x.leader.toLowerCase(), x.leader))))))),
        h('div.card', h('div.card-head', h('h3', 'Other measures'), h('span.sub', `${va} vs ${vb}`)), h('table', h('thead', h('tr', h('th', 'Measure'), h('th.num', va), h('th.num', vb))),
          h('tbody', secRows.filter((r) => sec[r[0]]).map(([k, label, expl, f]) => h('tr', h('td', label, h('div.expl', expl)), h('td.num', f(sec[k].a)), h('td.num', f(sec[k].b)))))))),
      h('div.card', { style: { marginTop: '16px' } }, h('div.card-head', h('h2', 'By segment'), h('span.sub', `${metricName(v.metric)}; "clear" needs a gap beyond the noise and at least 20 people each side`)),
        h('div.tbl-wrap', h('table', h('thead', h('tr', h('th', 'Segment'), h('th.num', `${va} %`), h('th.num', `${vb} %`), h('th', ''), h('th.num', 'n (A / B)'), h('th', 'Prefers'))), h('tbody', segRows)))),
      S.tipping ? h('div.grid.two', { style: { marginTop: '16px' } }, Object.entries(S.tipping).filter(([w]) => true).map(([wid, t]) => h('div.card',
        h('div.card-head', h('h3', `Tipping point, ${wid}`), h('span.sub', 'the share that reached the most people')),
        t ? h('div', h('div.row', avatar(t.record.agent_id), h('div', h('b', t.record.agent_id), h('div.muted', `shared at ${roundTime(t.record.hour)}`))),
          h('div.said', { style: { margin: '10px 0' } }, t.record.text ? `"${t.record.text}"` : '(shared without a caption)'),
          h('span.chip.' + (t.reached > 0 ? 'good' : ''), `reached ${t.reached} people`), ' ', h('span.chip.mono', t.record.id))
          : h('div.muted', 'Nobody shared the post in this world, so there was no cascade.')))) : null,
      val ? h('div.card', { style: { marginTop: '16px' } }, h('div.card-head', h('h2', 'Validity panel'), h('span.sub', 'checks on whether the crowd behaved like a crowd')),
        h('div.grid', { style: { gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))' } }, vexp.map(([k, value, ex]) => h('div', h('span.tag', k), h('div', { style: { fontSize: '18px', fontWeight: 650, margin: '2px 0' } }, value), h('div.expl', ex))))) : null);
  }

  /* ============================================================ 10. report */
  function renderReport() {
    const b = S.report;
    if (!b) {
      mount(ui.report, S.verdict && S.status !== 'done' && S.status !== 'error' ? h('div.card', { style: { marginTop: '16px' } }, h('div.row', spin(), h('span.muted', 'The report agent is querying the action log...'))) : S.verdict ? h('div.card.muted', { style: { marginTop: '16px' } }, 'This run has no report (older run, or the report step did not finish).') : null);
      return;
    }
    const rep = b.report;
    const quote = (id) => {
      const q = b.quotes?.[id];
      if (!q) return h('div.quote', h('span.chip.qid', id), h('div.muted', 'Action no longer available.'));
      return h('div.quote', { title: 'Open this person and ask them why', onclick: () => openAgent(q.agent_id, { world: q.world_id }) },
        h('div.src', variantChip(q.variant), h('b', q.agent_id), h('span', `world ${q.world_id}`), h('span.mono', roundTime(q.hour)), actPill(q.action), h('span.chip.qid', `action ${id}`)),
        q.text ? h('div.q', `"${q.text}"`) : null,
        q.reason ? h('div.thought', `thought: ${q.reason}`) : null,
        q.unsaid ? h('div.unsaid', h('b', 'kept to themselves: '), q.unsaid) : null);
    };
    const themes = (title, list) => h('div.card', h('div.card-head', h('h2', title)), list.length ? list.map((t) => h('div.theme', h('div.row', { style: { marginBottom: '8px' } }, variantChip(t.variant), h('h4', t.theme)), h('div.stack', (t.action_ids || []).map(quote)))) : h('div.muted', 'None reported.'));
    const crit = b.critic || {};
    mount(ui.report,
      h('div.section-title', h('h2', 'Report'), b.fallback ? h('span.chip.warn', 'Report written without a reasoning model') : null, b.served_by?.length ? h('span.muted', 'served by ' + [...new Set(b.served_by)].join(', ')) : null),
      h('div.card', h('p', { style: { fontSize: '17px', lineHeight: 1.5 } }, rep.summary),
        rep.recommendation ? h('div.banner.info', { style: { marginTop: '8px' } }, h('b', 'Next: '), rep.recommendation) : null,
        rep.tipping_note ? h('div.expl', rep.tipping_note) : null),
      h('div.card', { style: { marginTop: '16px' } }, h('div.card-head', h('h2', 'Claims'), h('span.sub', 'every claim links to the SQL behind it')),
        rep.claims?.length ? rep.claims.map((c) => h('div.claim', h('span', c.text), h('span.chips', (c.query_ids || []).map(qidChip)))) : h('div.muted', 'No claims survived the critic.'),
        b.tools?.length ? h('details', { style: { marginTop: '10px' } }, h('summary.muted', `${b.tools.length} tool queries run by the report agent`), h('div.chips', { style: { marginTop: '8px' } }, b.tools.map((t) => h('button.chip.qid', { title: `${t.tool} ${JSON.stringify(t.args)} (${t.row_count} rows, ${t.engine})`, onclick: () => openQuery(t.query_id) }, `${t.tool} ${t.query_id}`)))) : null),
      h('div.grid.two', { style: { marginTop: '16px' } }, themes('Top objections', rep.objections || []), themes('Top likes', rep.likes || [])),
      h('div.card', { style: { marginTop: '16px' } }, h('div.card-head', h('h3', 'Critic'), h('span.chips', h('span.chip.' + ((crit.code_issues?.length || (crit.model && !crit.model.ok)) ? 'warn' : 'good'), (crit.code_issues?.length || (crit.model && !crit.model.ok)) ? 'issues noted' : 'passed'), crit.revised ? h('span.chip', 'report revised once') : null)),
        h('div.expl', 'Code checks: every claim has a query id that exists, numbers appear in the cited rows, quotes point at real actions.'),
        crit.code_issues?.length ? h('ul', crit.code_issues.map((i) => h('li', i))) : h('div.expl', 'Code checks found no issues.'),
        h('div.expl', { style: { marginTop: '6px' } }, crit.model ? `Model review: ${crit.model.ok ? 'ok' : 'flagged'}` : 'Model review: not available'),
        crit.model?.issues?.length ? h('ul', crit.model.issues.map((i) => h('li', i))) : null));
  }

  /* ============================================================ 11. tools */
  let toolTab = 'agent';
  const toolBox = h('div'); const focusBox = h('div');
  function renderTools() {
    if (!S.verdict) { mount(ui.tools); S.toolsBuilt = false; return; }
    if (S.toolsBuilt) return; // keep user input; segment keys do not change after the verdict
    S.toolsBuilt = true;
    const tabs = [['agent', 'Interview an agent'], ['segment', 'Ask a segment'], ['focus', 'Focus group'], ['c', 'Version C']];
    const bar = h('div.tabs');
    const drawTabs = () => mount(bar, tabs.map(([k, l]) => h('button.tab' + (k === toolTab ? '.active' : ''), { onclick: () => { toolTab = k; drawTabs(); drawTool(); } }, l)));
    mount(ui.tools, h('div.section-title', h('h2', 'Ask why')), h('div.card', bar, toolBox));
    drawTabs(); drawTool();
  }
  function drawTool() {
    if (toolTab === 'agent') toolAgent(); else if (toolTab === 'segment') toolSegment(); else if (toolTab === 'focus') toolFocus(); else toolC();
  }
  function toolAgent() {
    const sel = h('select', S.personas.map((p) => h('option', { value: p.id }, `${p.id}: ${p.age}, ${p.role}, ${p.income_band}`)));
    mount(toolBox, h('p.muted', 'Click any person in a feed, a quote or the crowd grid, or pick one here. They answer only from their own memory and cite the exact action.'),
      h('div.row', { style: { flexWrap: 'nowrap' } }, sel, h('button.btn.primary', { onclick: () => openAgent(sel.value) }, 'Open interview')));
  }
  function toolSegment() {
    const segs = (S.verdict.segments || []).map((x) => x.key);
    const sel = h('select', segs.map((k) => h('option', { value: k }, `${segLabel(k)} (${k})`)));
    const q = h('input', { type: 'text', value: 'Why did you prefer one of these posts over the other?' });
    const vsel = h('select', h('option', { value: '' }, 'Either version'), variants().map((v) => h('option', { value: v }, `Only people who saw ${v}`)));
    const out = h('div', { style: { marginTop: '14px' } });
    const btn = h('button.btn.primary', 'Ask the segment');
    btn.onclick = async () => {
      if (!q.value.trim()) return;
      btn.disabled = true; mount(out, spin(), ' Interviewing up to six people from this segment...');
      try {
        const r = await api(`/api/runs/${id}/segment`, { method: 'POST', body: { segment: sel.value, question: q.value.trim(), variant: vsel.value || undefined } });
        mount(out, r.summary ? h('div.banner.info', h('b', 'Pattern: '), r.summary) : null,
          r.answers.length ? h('div.grid.two', r.answers.map((a) => h('div.card', h('div.row.spread', h('div.row', avatar(a.agent_id), h('div', h('b', a.agent_id), h('div.muted', `${a.persona.age}, ${a.persona.role}, world ${a.world_id}`))), a.saw_it === false ? h('span.chip.warn', "didn't see it") : null),
            h('p', { style: { margin: '10px 0' } }, `"${a.answer}"`),
            a.citations?.length ? h('div.cites', a.citations.map((c) => h('div.cite', { onclick: () => openAgent(a.agent_id, { world: a.world_id }) }, h('span.hr', roundTime(c.hour)), c.text, c.action_id ? h('span.chip.qid', { style: { marginLeft: '8px' } }, `action ${c.action_id}`) : null))) : null,
            a.invalid_citations?.length ? h('span.chip.bad', `${a.invalid_citations.length} unmatched citation(s)`) : null,
            h('div.muted', { style: { fontSize: '11px', marginTop: '6px' } }, `served by ${a.served_by}`)))) : h('div.empty', 'Nobody in that segment decided on the post.'));
      } catch (e) { mount(out, h('div.banner.bad', e.message)); }
      btn.disabled = false;
    };
    mount(toolBox, h('div.grid', { style: { gridTemplateColumns: 'minmax(0,1fr) minmax(0,2fr) minmax(0,1fr) auto', alignItems: 'end' } },
      h('div', h('label', 'Segment'), sel), h('div', h('label', 'Question'), q), h('div', h('label', 'Variant'), vsel), btn), out);
  }
  function renderFocus() {
    if (!focusBox.isConnected) return;
    mount(focusBox, S.focus.length ? S.focus.map((t) => {
      const mod = /^Moderator/.test(t.speaker);
      return h('div.bubble.' + (mod ? 'mod' : 'them'), h('span.who', { onclick: () => t.agent_id && openAgent(t.agent_id) }, t.speaker), t.text);
    }) : h('div.empty', 'The transcript appears here, turn by turn.'));
    focusBox.lastChild?.scrollIntoView({ block: 'nearest' });
  }
  function toolFocus() {
    const btn = h('button.btn.primary', 'Start focus group (6 people, 2 rounds)');
    btn.onclick = async () => {
      btn.disabled = true; S.focus = []; mount(btn, spin(), ' Running...'); renderFocus();
      try { const r = await api(`/api/runs/${id}/focus`, { method: 'POST', body: { size: 6, turns: 2 } }); S.focus = r.transcript; renderFocus(); }
      catch (e) { fail(e); }
      btn.disabled = false; mount(btn, 'Run it again');
    };
    mount(toolBox, h('p.muted', 'A moderator seats people from different segments, shows both posts and runs a short discussion. Each person speaks from their own memory.'), btn, h('div', { style: { marginTop: '14px' } }, focusBox));
    renderFocus();
  }
  function toolC() {
    const btn = h('button.btn.primary', 'Draft version C');
    const out = h('div', { style: { marginTop: '14px' } });
    btn.onclick = async () => {
      btn.disabled = true; mount(btn, spin(), ' Rewriter and honesty check...');
      try {
        const r = await api(`/api/runs/${id}/version-c`, { method: 'POST' });
        const ta = h('textarea', r.c.text);
        const run = h('button.btn.primary.lg', 'Test C vs winner on the same crowd');
        run.onclick = async () => {
          run.disabled = true; mount(run, spin(), ' Starting...');
          try { const n = await api(`/api/runs/${id}/version-c/run`, { method: 'POST', body: { text: ta.value.trim() } }); location.hash = `#/run/${n.run_id}`; }
          catch (e) { fail(e); run.disabled = false; mount(run, 'Test C vs winner on the same crowd'); }
        };
        mount(out, h('div.grid.two',
          h('div', h('label', `Current winner (Version ${r.winner})`), h('div.post-text', r.winner_text)),
          h('div', h('label', 'Version C (editable)'), ta)),
          h('p', { style: { marginTop: '12px' } }, h('b', 'Why: '), r.c.rationale),
          r.c.targets?.length ? h('div.chips', { style: { marginBottom: '10px' } }, r.c.targets.map((t) => h('span.chip', t))) : null,
          h('div.banner.' + (r.honesty.ok ? 'info' : 'warn'), h('b', 'Honesty check: '), r.honesty.ok ? 'passed. Price and offer are kept, no invented claims.' : `flagged: ${r.honesty.issues.join('; ')}`),
          h('div.row.spread', h('span.muted', 'Runs on the same crowd, graph and schedule as this test.'), run));
      } catch (e) { mount(out, h('div.banner.bad', e.message)); }
      btn.disabled = false; mount(btn, 'Draft again');
    };
    mount(toolBox, h('p.muted', 'The Rewriter aims at the objections of the segments that preferred the other version, an honesty check keeps the price and offer visible, and you can edit before testing.'), btn, out);
  }

  return () => { closed = true; clearTimeout(rTimer); if (es) es.close(); style.remove(); if (nemoTimer) clearTimeout(nemoTimer); };
}

/* ============================================================ boot */
refreshStatus(); setInterval(refreshStatus, 30000);
route();

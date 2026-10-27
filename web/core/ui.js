/* Toasts, modal, query viewer, drawer. The agent drawer itself lives in core/agent-drawer.js. */
import { $, h, mount, spin, fmtInt } from './dom.js';
import { current } from './state.js';

export function toast(msg, bad, action) {
  const t = h('div.toast' + (bad ? '.bad' : ''), msg, action ? h('button.btn.sm', { onclick: () => { action.onclick(); dismiss(); } }, action.label) : null);
  const dismiss = () => { t.classList.add('out'); setTimeout(() => t.remove(), 240); };
  $('#toasts').append(t);
  setTimeout(dismiss, bad ? 7000 : action ? 9000 : 3500);
  return dismiss;
}

export function openModal(content) { mount($('#modal-body'), content); $('#modal').hidden = false; }
export function closeModal() { $('#modal').hidden = true; }

export async function openQuery(qid) {
  openModal(h('div', spin(), ' Loading query ', h('span.mono', qid)));
  const { api } = await import('./api.js');
  try {
    const q = await api(`/api/queries/${encodeURIComponent(qid)}`);
    const rows = q.sample || q.rows || [];
    const cols = rows.length ? Object.keys(rows[0]) : [];
    openModal(h('div',
      h('div.row', h('h2', q.label || 'Query'), h('span.chip.qid', q.query_id)),
      h('div.row', { style: { margin: '10px 0' } },
        h('span.chip', 'Engine: ', h('b', q.engine)), h('span.chip', `${fmtInt(q.row_count ?? rows.length)} rows`), q.ms != null ? h('span.chip', `${q.ms} ms`) : null, q.ts ? h('span.chip.mono', q.ts) : null),
      h('h3', { style: { margin: '12px 0 6px' } }, 'SQL'), h('pre.sql', q.sql),
      h('h3', { style: { margin: '12px 0 6px' } }, `Result${q.row_count > rows.length ? ` (first ${rows.length} of ${q.row_count})` : ''}`),
      rows.length ? h('div.tbl-wrap', h('table', h('thead', h('tr', cols.map((c) => h('th', c)))), h('tbody', rows.slice(0, 50).map((r) => h('tr', cols.map((c) => h('td.mono', r[c] == null ? '' : String(r[c])))))))) : h('div.empty', 'No rows stored for this query.'),
    ));
  } catch (e) { openModal(h('div', h('h2', 'Query not found'), h('p.muted', e.message))); }
}
export const qidChip = (qid) => h('button.chip.qid', { title: 'Open the SQL and rows behind this', onclick: (ev) => { ev.stopPropagation(); openQuery(qid); } }, qid);

export const drawerEl = () => $('#drawer');
export function closeDrawer() { drawerEl().hidden = true; }
export async function openAgent(agentId, opts = {}) {
  const mod = await import('./agent-drawer.js');
  return mod.openAgent(agentId, opts);
}

current.openAgent = openAgent;
current.openQuery = openQuery;

/* fetch wrapper + system status pill. Ported from legacy/app.js section 2. */
import { $, h, mount, fmtInt } from './dom.js';
import { toast, openModal } from './ui.js';

export async function api(path, opts = {}) {
  const init = { method: opts.method || 'GET', headers: {} };
  if (opts.body !== undefined) { init.body = JSON.stringify(opts.body); init.headers['content-type'] = 'application/json'; }
  const res = await fetch(path, init);
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) throw new Error((data && data.error) || `${res.status} ${res.statusText}`);
  return data;
}
export const fail = (e) => toast(e.message || String(e), true);

export const PROVIDER_LABEL = { nightshift: 'Nightshift', nvidia: 'NVIDIA cloud', ollama: 'ollama-local' };
export async function refreshStatus() {
  const pill = $('#status-pill');
  try {
    const st = await api('/api/status');
    pill._status = st;
    const provs = st.providers?.providers || [];
    const online = provs.filter((p) => p.online);
    const order = st.providers?.order || [];
    const active = order.map((n) => online.find((p) => p.provider === n)).find(Boolean) || online[0];
    const engine = st.sources?.engine;
    const engineLabel = engine === 'zetaris' ? 'Zetaris' : engine === 'local-duckdb' ? 'local DuckDB' : engine || 'unknown';
    const modelLabel = active ? `${PROVIDER_LABEL[active.provider] || active.provider} online` : 'no model online';
    pill.className = 'status-pill ' + (active ? 'ok' : 'bad');
    mount($('.status-text', pill), `${modelLabel} · ${engineLabel}${st.sampleMode ? ' · replay' : ''}`);
  } catch (e) {
    pill.className = 'status-pill bad';
    mount($('.status-text', pill), `API unreachable: ${e.message}`);
  }
}
export function showStatusDetail() {
  const st = $('#status-pill')._status;
  if (!st) return;
  const provs = st.providers?.providers || [];
  openModal(h('div',
    h('h2', 'System status'),
    st.sampleMode ? h('div.banner.info', { style: { marginTop: '10px' } }, 'SAMPLE_MODE is on: model calls replay from recorded samples.') : null,
    h('h3', { style: { margin: '16px 0 6px' } }, 'Model providers (fallback order: ' + (st.providers?.order || []).join(' > ') + ')'),
    h('div.tbl-wrap', h('table', h('thead', h('tr', ['Provider', 'State', 'Detail', 'Crowd model'].map((x) => h('th', x)))),
      h('tbody', provs.map((p) => h('tr', h('td', PROVIDER_LABEL[p.provider] || p.provider),
        h('td', h('span.chip.' + (p.online ? 'good' : p.configured ? 'warn' : ''), p.online ? 'online' : p.configured ? 'offline' : 'not set')),
        h('td.muted', p.detail), h('td.mono', p.models?.crowd || '-')))))),
    h('h3', { style: { margin: '18px 0 6px' } }, `Data engine: ${st.sources?.engine}`),
    h('div.tbl-wrap', h('table', h('thead', h('tr', ['Table', 'Kind', 'Rows', 'Label'].map((x) => h('th', x)))),
      h('tbody', (st.sources?.tables || []).map((t) => h('tr', h('td.mono', t.table), h('td.muted', t.kind), h('td.num', fmtInt(t.rows)), h('td', t.label)))))),
  ));
}

/* Data sources: the five federated sources behind the crowd, shown on the setup screen (strip) and in the Crowd stage (panel).
 * Live facts (rows, engine) come from GET /api/sources; names, origin and use are client-side text.
 * Query ids come from the run's sampleReport.queries (matched by label). */
import { h, s, fmtInt } from './dom.js';
import { api } from './api.js';
import { qidChip } from './ui.js';

export const SOURCES = [
  { table: 'census.acs', name: 'US Census Bureau ACS 5-year', origin: 'Census Reporter API (live, cached per ZIP)', use: 'Age, income, education and household tables for the ZIP: the natural shape of the crowd.', status: 'public', statusText: 'Public, live', short: 'Census ACS', match: /^ACS /, pending: 'registered on the first run for a ZIP' },
  { table: 'pew.platform_use', name: 'Pew Research Center', origin: 'Social Media Fact Sheet, hand-entered', use: 'Instagram use by age band: who in that ZIP is actually on the platform.', status: 'public', statusText: 'Public', short: 'Pew Instagram', match: /^Pew/ },
  { table: 'priors.behaviour', name: 'Behaviour priors', origin: 'Ripple, labelled assumptions', use: 'Base rates for scroll, like, share and hide, tuned per persona.', status: 'modeled', statusText: 'Modeled', short: 'Priors', match: /^Behaviour/ },
  { table: 'biz.customers', name: 'Business customer list', origin: 'Customer upload (demo file is synthetic)', use: 'A copula over visits, ticket and tenure turns real customers into persona traits.', status: 'synthetic', statusText: 'Synthetic demo', short: 'Customers', match: /^Customer/ },
  { table: 'upworthy.tests', name: 'Upworthy Research Archive', origin: 'Real historical A/B tests, CC BY 4.0', use: 'Backtest only: does the simulated verdict match what headlines actually did?', status: 'public', statusText: 'Public, CC BY 4.0', short: 'Upworthy', match: /^Upworthy/, backtest: true },
];
const STATUS_CLS = { public: 'good', modeled: 'warn', synthetic: 'b' };

let cache = null;
export function loadSources(force = false) {
  if (!cache || force) cache = api('/api/sources').catch((e) => { cache = null; throw e; });
  return cache;
}

const engineChip = (eng, pending, loading) => eng
  ? h('span.chip.src-eng' + (eng === 'zetaris' ? '.zet' : ''), { title: eng === 'zetaris' ? 'Answered by Zetaris (Lightning file-store table)' : 'Answered by local DuckDB' }, h('i'), eng === 'zetaris' ? 'Zetaris' : 'Local DuckDB')
  : h('span.chip.src-eng.off', { title: pending || 'Not registered yet' }, h('i'), loading ? 'Checking...' : 'Not loaded yet');

/** Compact strip for the setup screen. */
export function sourcesStrip() {
  const root = h('section.src-strip', { 'aria-label': 'Data sources' });
  const lead = h('div.src-strip-lead', h('b', 'Your crowd will be built from'), h('span', 'federated through Zetaris'));
  const items = h('div.src-strip-items');
  root.append(lead, items);
  const draw = (info) => {
    const by = new Map((info?.tables || []).map((t) => [t.table, t]));
    items.replaceChildren(...SOURCES.filter((x) => !x.backtest).map((x) => {
      const t = by.get(x.table), eng = t?.engine;
      return h('div.src-pill', { title: `${x.name}: ${x.origin}` }, h('span.dot.' + (eng === 'zetaris' ? 'zet' : eng ? 'loc' : 'off')), h('b', x.short), h('small', t && typeof t.rows === 'number' ? `${fmtInt(t.rows)} rows` : info ? 'on first run' : 'checking...'), h('span.chip.' + STATUS_CLS[x.status], x.statusText));
    }));
  };
  draw(null);
  loadSources().then(draw).catch(() => {});
  return root;
}

const NODE = (cls, title, sub) => h('div.src-node.' + cls, h('b', title), h('small', sub));
const ARROW = () => h('span.src-arrow', { 'aria-hidden': 'true' }, s('svg', { viewBox: '0 0 24 12', width: 24, height: 12, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, s('path', { d: 'M1 6h20M16 1l5 5-5 5' })));

/** Full panel for the Crowd stage. `sr` is the run's sampleReport (queries, instagram_users_est); update(sr) redraws. */
export function sourcesPanel() {
  const body = h('div.src-body');
  const sub = h('span.sub', 'Five sources, one federation layer');
  const root = h('section.card.src-panel', h('header.cw-ph', h('h3', 'Data sources'), sub), body);
  let info = null, report = null;
  function draw() {
    const by = new Map((info?.tables || []).map((t) => [t.table, t]));
    const qs = report?.queries || [];
    const nZ = (info?.tables || []).filter((t) => t.engine === 'zetaris').length;
    sub.textContent = info ? `${SOURCES.length} sources, ${nZ} answered by Zetaris right now` : 'Five sources, one federation layer';
    const flow = h('div.src-flow', NODE('srcs', '5 sources', 'Census, Pew, priors, customers, Upworthy'), ARROW(), NODE('zet', 'Zetaris', 'Lightning file-store tables, database dryrun'), ARROW(), NODE('ag', 'DataAgent', 'runs the SQL, keeps receipts'), ARROW(), NODE('ag', 'AudienceAgent', 'proposes the segments'), ARROW(), NODE('crowd', 'The crowd', report?.instagram_users_est ? `${fmtInt(report.instagram_users_est)} local Instagram users` : 'sampled personas'));
    const cards = SOURCES.map((x) => {
      const t = by.get(x.table), eng = t?.engine;
      const qq = qs.filter((q) => x.match.test(q.label || ''));
      return h('article.src-card' + (eng === 'zetaris' ? '.on' : ''),
        h('header', h('h4', x.name), h('span.chip.' + STATUS_CLS[x.status], x.statusText)),
        h('div.src-origin', x.origin),
        h('p', x.use),
        h('footer', h('code.src-tbl', x.table), h('span.src-rows', t && typeof t.rows === 'number' ? h('b', fmtInt(t.rows)) : null, t && typeof t.rows === 'number' ? ' rows' : (info ? (x.pending || 'not loaded') : 'checking...')), engineChip(eng, x.pending, !info),
          x.backtest ? h('span.src-note', 'backtest only') : qq.length ? h('span.src-qs', qq.slice(0, 3).map((q) => qidChip(q.query_id))) : null));
    });
    const join = qs.find((q) => /Census x Pew/i.test(q.label || ''));
    const joinBox = h('div.src-join',
      h('div.src-join-eq', h('span.chip.good', 'Census ACS'), h('b', '×'), h('span.chip.good', 'Pew Instagram use'), h('b', '→'), h('span.src-join-out', report?.instagram_users_est ? [h('b', fmtInt(report.instagram_users_est)), ' local Instagram users'] : 'local Instagram users')),
      h('div.src-join-meta', h('span', 'One federated join sizes the audience.'), join ? h('span.src-join-q', h('span.chip', { title: 'Engine recorded when this run sampled its crowd' }, 'ran on ' + (join.engine === 'zetaris' ? 'Zetaris' : 'local DuckDB')), qidChip(join.query_id)) : h('span.muted', 'Open a run to see its query id.')));
    body.replaceChildren(flow, h('div.src-grid', cards), joinBox);
  }
  draw();
  loadSources().then((i) => { info = i; draw(); }).catch(() => {});
  return { el: root, update(sr) { report = sr || null; draw(); }, refresh() { loadSources(true).then((i) => { info = i; draw(); }).catch(() => {}); } };
}

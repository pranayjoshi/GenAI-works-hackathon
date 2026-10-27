/* Report stage: an editorial briefing.
 * Summary read line by line, claims as an evidence timeline (each claim wired to its SQL receipts),
 * objections vs likes as flippable quote cards plus a theme bubble chart, and the critic as a checklist.
 * Shape of S.report (from src/api.ts): { report: {summary, recommendation, tipping_note, claims[{text, query_ids}],
 * objections[{variant, theme, action_ids}], likes[...]}, quotes: {[action_id]: {...}}, tools[], critic, fallback, served_by[] }. */
import { h, s, mount, variantChip, actPill, reasonLines, roundTime, spin } from '../../core/dom.js';
import { qidChip, openQuery } from '../../core/ui.js';
import { current } from '../../core/state.js';
import { riseWords, typeText, reduced, stagger, EASE } from '../../core/motion.js';

const variantVar = (v) => { const k = String(v || '').toLowerCase(); return k === 'a' || k === 'b' || k === 'c' ? `var(--${k})` : 'var(--accent)'; };
const SQL_SKETCH = [
  ['SELECT variant, action, COUNT(*) FROM actions', ['A  tap_through  41', 'B  tap_through  57', 'A  hide  9']],
  ['SELECT segment, AVG(intent) FROM decisions GROUP BY 1', ['core  0.42', 'spillover  0.18', 'customers  0.51']],
  ['SELECT reason, COUNT(*) FROM actions WHERE action = \'hide\'', ['too pricey  12', 'seen it before  7', 'not for me  5']],
  ['SELECT agent_id, text FROM actions WHERE text IS NOT NULL', ['P014  "love the colours"', 'P032  "how much though?"']],
];

export default {
  id: 'report',
  mount(el, ctx) {
    const { S, bus } = ctx;
    const root = h('div.rp'); el.append(root);
    const cleanups = [];
    let lastKey = null, visible = false, sketchTimer = null;

    /* ---- reveal: each block fades in shortly after mount (staggered, capped so everything is visible within ~600 ms;
     * content never waits for a scroll position to become visible) */
    let rvIdx = 0; const rvTimers = new Set();
    const onView = (node, fn) => {
      node.classList.add('rp-rv');
      const fire = () => { node.classList.add('in'); fn?.(); };
      if (reduced()) { fire(); return node; }
      const t = setTimeout(() => { rvTimers.delete(t); fire(); }, 40 + Math.min(rvIdx++, 8) * 55);
      rvTimers.add(t);
      return node;
    };

    /* ---------------------------------------------------------- waiting states */
    function pendingView() {
      const lines = h('div.rp-sql-lines'), rows = h('div.rp-sql-rows');
      let i = 0, busy = false;
      const cycle = async () => {
        if (busy || !lines.isConnected) return; busy = true;
        const [sql, out] = SQL_SKETCH[i++ % SQL_SKETCH.length];
        const line = h('div.rp-sql-line', h('i', '>'), h('span')); lines.append(line);
        while (lines.children.length > 4) lines.firstChild.remove();
        await typeText(line.lastChild, sql, 70);
        rows.replaceChildren();
        out.forEach((r, k) => { const row = h('div.rp-sql-row', { style: { '--i': k } }, r); rows.append(row); });
        busy = false;
      };
      setTimeout(cycle, 60); sketchTimer = setInterval(() => { if (visible) cycle(); }, 2600);
      return h('div.rp-wait',
        h('div.rp-wait-copy', h('div.rp-eyebrow', 'Report agent at work'), h('h2', 'Querying the action log'), h('p.muted', 'It reads the stored decisions with SQL, writes claims, and a critic checks every number against the rows. Receipts appear here when it is done.')),
        h('div.rp-term', { 'aria-hidden': 'true' },
          h('div.rp-term-bar', h('i'), h('i'), h('i'), h('span', 'report-agent / read-only')),
          lines, rows, h('div.rp-term-scan')),
        h('div.rp-note.muted', spin(), ' Sketch of the kind of queries it runs, not the live log.'));
    }
    const emptyView = (title, text) => h('div.rp-wait.quiet', h('div.rp-wait-copy',
      s('svg', { class: 'rp-empty-ic', viewBox: '0 0 48 48', 'aria-hidden': 'true' }, s('path', { d: 'M12 5h17l9 9v29H12z' }), s('path', { d: 'M29 5v9h9' }), s('path', { class: 'ln', d: 'M18 23h14M18 29h14M18 35h8' })),
      h('div.rp-eyebrow', 'Report'), h('h2', title), h('p.muted', text)));

    /* ---------------------------------------------------------- pieces */
    // one quote as a flip card: front = what they said, back = what they thought / kept to themselves
    function quoteCard(b, id, i) {
      const q = b.quotes?.[id];
      if (!q) return h('div.rp-qc.gone', h('span.chip.qid', id), h('div.muted', 'Action no longer available.'));
      const flipBtn = h('button.rp-flip', { 'aria-pressed': 'false', title: 'Flip to see what they thought', onclick: (ev) => { ev.stopPropagation(); flip(); } }, s('svg', { viewBox: '0 0 24 24' }, s('path', { d: 'M17 1l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3' })), h('span', 'Why?'));
      const openBtn = (cls) => h('button.btn.sm.ghost' + cls, { title: 'Open this person and ask them why', onclick: (ev) => { ev.stopPropagation(); current.openAgent?.(q.agent_id, { world: q.world_id }); } }, `Open ${q.agent_id}`);
      const thought = reasonLines(q);
      const front = h('div.rp-face.front',
        h('div.rp-src', variantChip(q.variant), h('b', q.agent_id), h('span.mono', roundTime(q.hour)), actPill(q.action)),
        q.text ? h('div.rp-say', `"${q.text}"`) : h('div.rp-say.dim', 'Said nothing, only acted.'),
        h('div.rp-foot', h('span.chip.qid', `action ${id}`), openBtn(''), flipBtn));
      const back = h('div.rp-face.back',
        h('div.rp-src', h('b', q.agent_id), h('span.muted', `world ${q.world_id}`)),
        thought.length || q.unsaid ? h('div.rp-inner', thought, q.unsaid ? h('div.unsaid', h('b', 'kept to themselves: '), q.unsaid) : null) : h('div.rp-say.dim', 'No private reason was logged for this action.'),
        h('div.rp-foot', openBtn(''), h('button.rp-flip', { 'aria-pressed': 'true', onclick: (ev) => { ev.stopPropagation(); flip(); } }, 'Back')));
      const card = h('div.rp-qc', { style: { '--vc': variantVar(q.variant), '--i': i }, tabindex: 0, 'data-aid': id, role: 'group', 'aria-label': `Quote from ${q.agent_id}` },
        h('div.rp-flipper', front, back));
      function flip() {
        const on = card.classList.toggle('flipped');
        card.querySelectorAll('.rp-flip').forEach((b) => b.setAttribute('aria-pressed', String(on)));
      }
      card.addEventListener('click', (ev) => { if (!ev.target.closest('button')) flip(); });
      card.addEventListener('keydown', (ev) => { if ((ev.key === 'Enter' || ev.key === ' ') && ev.target === card) { ev.preventDefault(); flip(); } });
      return card;
    }

    // greedy spiral packing of circles (hand-rolled bubble chart), deterministic
    function themeCloud(list, kind, onPick) {
      const W = 320, H = 168, cx = W / 2, cy = H / 2;
      const max = Math.max(1, ...list.map((t) => (t.action_ids || []).length));
      const items = list.map((t, idx) => ({ t, idx, n: (t.action_ids || []).length, r: 20 + 30 * Math.sqrt(((t.action_ids || []).length || 1) / max) })).sort((a, b) => b.r - a.r);
      const placed = [];
      for (const it of items) {
        let found = false;
        for (let k = 0; k < 900 && !found; k++) {
          const a = k * 0.55, d = 2.2 * Math.sqrt(k) * 3.2;
          const x = cx + Math.cos(a) * d * 1.35, y = cy + Math.sin(a) * d * 0.8;
          if (x - it.r < 2 || x + it.r > W - 2 || y - it.r < 2 || y + it.r > H - 2) continue;
          if (placed.every((p) => Math.hypot(p.x - x, p.y - y) >= p.r + it.r + 3)) { it.x = x; it.y = y; found = true; }
        }
        if (!found) { it.r = Math.max(14, it.r * 0.6); it.x = 20 + (placed.length * 37) % (W - 40); it.y = H - 18; }
        placed.push(it);
      }
      // scale the packed cluster up (or down) and centre it so it fills the card instead of floating in a void
      if (placed.length) {
        const x0 = Math.min(...placed.map((p) => p.x - p.r)), x1 = Math.max(...placed.map((p) => p.x + p.r));
        const y0 = Math.min(...placed.map((p) => p.y - p.r)), y1 = Math.max(...placed.map((p) => p.y + p.r));
        const pad = 10, k = Math.min((W - 2 * pad) / (x1 - x0), (H - 2 * pad) / (y1 - y0), 2.2);
        const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
        for (const p of placed) { p.x = cx + (p.x - mx) * k; p.y = cy + (p.y - my) * k; p.r *= k; }
      }
      const svg = s('svg', { class: 'rp-cloud ' + kind, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `${kind} themes sized by number of quotes` });
      placed.forEach((it, k) => {
        const maxCh = Math.max(6, Math.floor(it.r / 4.2)), th = String(it.t.theme || '');
        const label = th.length > maxCh ? th.slice(0, maxCh - 1) + '\u2026' : th;
        const g = s('g', { class: 'rp-bub', tabindex: 0, role: 'button', 'aria-label': `${it.t.theme}, ${it.n} quote${it.n === 1 ? '' : 's'}`, style: `--vc:${variantVar(it.t.variant)};--i:${k}` },
          s('title', {}, `${it.t.theme} (${it.n} quote${it.n === 1 ? '' : 's'}, Version ${it.t.variant})`),
          s('g', { transform: `translate(${it.x.toFixed(1)} ${it.y.toFixed(1)})` }, s('g', { class: 'rp-bub-in', style: `animation-delay:${k * 90}ms` },
            s('circle', { r: it.r.toFixed(1) }),
            it.r > 27 ? s('text', { y: -it.r * 0.08, 'text-anchor': 'middle', class: 'l', style: `font-size:${Math.min(13, Math.max(8.5, it.r * 0.2)).toFixed(1)}px` }, label) : null,
            s('text', { y: it.r > 27 ? it.r * 0.3 : 4, 'text-anchor': 'middle', class: 'n', style: `font-size:${Math.min(18, Math.max(10, it.r * 0.26)).toFixed(1)}px` }, it.n))));
        g.addEventListener('click', () => onPick(it.idx)); g.addEventListener('keydown', (e) => { if (e.key === 'Enter') onPick(it.idx); });
        svg.append(g);
      });
      return svg;
    }

    // first QUOTES_SHOWN quotes, the rest behind a toggle so the two columns stay close in height
    const QUOTES_SHOWN = 3;
    function quoteList(b, ids) {
      const list = h('div.rp-quotes', ids.slice(0, QUOTES_SHOWN).map((id, qi) => quoteCard(b, id, qi)));
      if (ids.length <= QUOTES_SHOWN) return list;
      const rest = ids.slice(QUOTES_SHOWN);
      const more = h('button.rp-more', { 'aria-expanded': 'false', onclick: () => {
        const open = more.getAttribute('aria-expanded') !== 'true';
        if (open) { rest.forEach((id, k) => { const c = quoteCard(b, id, k); c.classList.add('extra'); list.insertBefore(c, more); }); }
        else list.querySelectorAll('.rp-qc.extra').forEach((c) => c.remove());
        more.setAttribute('aria-expanded', String(open));
        more.textContent = open ? 'Show fewer' : `Show ${rest.length} more quote${rest.length === 1 ? '' : 's'}`;
      } }, `Show ${rest.length} more quote${rest.length === 1 ? '' : 's'}`);
      list.append(more);
      return list;
    }

    function themesColumn(b, title, kind, list) {
      const col = h('section.rp-col.' + kind, h('div.rp-col-head', h('h3', title), h('span.chip', `${list.length} theme${list.length === 1 ? '' : 's'}`)));
      if (!list.length) { col.append(h('div.empty', 'None reported.')); return col; }
      const cards = [];
      const pick = (idx) => {
        const c = cards[idx]; if (!c) return;
        c.scrollIntoView({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' });
        c.classList.remove('ping'); void c.offsetWidth; c.classList.add('ping');
      };
      col.append(h('div.rp-cloud-wrap', themeCloud(list, kind, pick), h('div.rp-cloud-cap.muted', 'bubble size = number of quotes, colour = version')));
      list.forEach((t, ti) => {
        const ids = t.action_ids || [];
        const block = onView(h('div.rp-theme', { style: { '--vc': variantVar(t.variant) } },
          h('div.rp-theme-head', variantChip(t.variant), h('h4', t.theme), h('span.rp-count', `${ids.length}`)),
          ids.length ? quoteList(b, ids) : h('div.muted', 'No quotes attached.')));
        cards[ti] = block; col.append(block);
      });
      return col;
    }

    function claimsTimeline(b, rep) {
      const claims = rep.claims || [];
      const box = h('section.rp-sec', h('div.rp-sec-head', h('div.rp-eyebrow', 'Evidence'), h('h3', 'Claims'), h('span.muted', 'every claim links to the SQL behind it')));
      if (!claims.length) box.append(h('div.empty', 'No claims survived the critic.'));
      else {
        const tl = h('ol.rp-tl');
        claims.forEach((c, i) => {
          const ids = c.query_ids || [];
          tl.append(onView(h('li.rp-claim', { style: { '--i': i } },
            h('span.rp-node', String(i + 1)),
            h('div.rp-claim-body', h('p', c.text),
              ids.length ? h('div.rp-wire', h('span.rp-wire-line', { 'aria-hidden': 'true' }), h('span.rp-receipts', ids.map((q, k) => { const chip = qidChip(q); chip.style.setProperty('--k', k); return chip; }))) : h('div.muted.rp-noreceipt', 'No receipts cited.')))));
        });
        box.append(tl);
      }
      if (b.tools?.length) {
        box.append(h('details.rp-tools', h('summary', h('span', `${b.tools.length} tool queries run by the report agent`)),
          h('div.chips', { style: { marginTop: '10px' } }, b.tools.map((t) => h('button.chip.qid', { title: `${t.tool} ${JSON.stringify(t.args)} (${t.row_count} rows, ${t.engine})`, onclick: () => openQuery(t.query_id) }, `${t.tool} ${t.query_id}`)))));
      }
      return box;
    }

    function criticView(crit) {
      const codeBad = crit.code_issues?.length > 0;
      const modelState = crit.model ? (crit.model.ok ? 'ok' : 'warn') : 'na';
      const tick = (state) => s('svg', { class: 'rp-tick ' + state, viewBox: '0 0 24 24' }, s('circle', { cx: 12, cy: 12, r: 10 }), state === 'ok' ? s('path', { d: 'M7 12.5l3.2 3.2L17 9' }) : state === 'warn' ? s('path', { d: 'M12 7v6M12 16.6v.4' }) : s('path', { d: 'M8 12h8' }));
      const row = (state, title, sub, issues) => h('li.rp-check.' + state, tick(state), h('div', h('b', title), h('div.expl', sub), issues?.length ? h('ul', issues.map((i) => h('li', i))) : null));
      const ok = !codeBad && modelState !== 'warn';
      return onView(h('section.rp-sec.rp-critic',
        h('div.rp-sec-head', h('div.rp-eyebrow', 'Quality gate'), h('h3', 'Critic'),
          h('span.chip.' + (ok ? 'good' : 'warn'), ok ? 'passed' : 'issues noted'), crit.revised ? h('span.chip', 'report revised once') : null),
        h('ul.rp-checks',
          row(codeBad ? 'warn' : 'ok', 'Code checks', codeBad ? 'Every claim has a query id that exists, numbers appear in the cited rows, quotes point at real actions. These were flagged:' : 'Every claim has a query id that exists, numbers appear in the cited rows, quotes point at real actions. No issues found.', crit.code_issues),
          row(modelState, 'Model review', crit.model ? (crit.model.ok ? (crit.model.issues?.length ? 'A second model read the report and passed it, with these notes:' : 'A second model read the report and found nothing to flag.') : 'A second model flagged:') : 'Not available for this run.', crit.model?.issues),
          crit.revised ? row('ok', 'Revision', 'The report agent rewrote the report once after the critic spoke.') : null)));
    }

    /* ---------------------------------------------------------- the briefing */
    function briefing(b) {
      const rep = b.report || {};
      const sentences = String(rep.summary || '').split(/(?<=[.!?])\s+/).filter(Boolean);
      const lead = h('div.rp-summary', sentences.length ? sentences.map((t, i) => onView(h('p.rp-line', t), () => { const p = lead.children[i]; riseWords(p, { gap: 14, delay: 40 }); })) : h('p.rp-line.in', 'The report has no summary.'));
      const head = h('header.rp-head',
        h('div.rp-eyebrow', 'Briefing', b.fallback ? h('span.chip.warn', 'written without a reasoning model') : null, b.served_by?.length ? h('span.muted', 'served by ' + [...new Set(b.served_by)].join(', ')) : null),
        lead,
        rep.recommendation ? onView(h('div.rp-next', h('span.rp-next-tag', 'Next'), h('p', rep.recommendation))) : null,
        rep.tipping_note ? onView(h('div.rp-tip', h('i', { 'aria-hidden': 'true' }), h('p.expl', rep.tipping_note))) : null);
      const cols = h('div.rp-cols', themesColumn(b, 'Top objections', 'objections', rep.objections || []), themesColumn(b, 'Top likes', 'likes', rep.likes || []));
      return [head, claimsTimeline(b, rep),
        h('section.rp-sec', h('div.rp-sec-head', h('div.rp-eyebrow', 'In their words'), h('h3', 'Objections and likes'), h('span.muted', 'click a quote to flip it: what they said vs what they thought')), cols),
        criticView(b.critic || {})];
    }

    /* ---------------------------------------------------------- render */
    function render() {
      const b = S.report;
      const running = S.status !== 'done' && S.status !== 'error';
      const key = b ? 'r:' + JSON.stringify(b).length + ':' + (b.report?.summary || '').length : S.verdict ? (running ? 'pending' : 'none') : running ? 'early' : 'none-nv';
      if (key === lastKey) return;
      lastKey = key;
      clearInterval(sketchTimer); sketchTimer = null; rvIdx = 0;
      if (b) { mount(root, briefing(b)); root.classList.add('has-report'); }
      else {
        root.classList.remove('has-report');
        if (S.verdict && running) mount(root, pendingView());
        else if (S.verdict) mount(root, emptyView('No report for this run', 'This is an older run, or the report step did not finish.'));
        else if (running) mount(root, emptyView('The report comes after the verdict', 'Once both worlds finish and the verdict is computed, the report agent writes the briefing here.'));
        else mount(root, emptyView('No report for this run', 'This run ended without a verdict, so no report was written.'));
      }
      if (!reduced()) stagger(root, { y: 14, gap: 60, ms: 520 });
    }

    cleanups.push(bus.on('report', render), bus.on('verdict', render), bus.on('snapshot', render), bus.on('done', render), bus.on('status', render));
    render();

    return {
      show() { visible = true; },
      hide() { visible = false; },
      destroy() { cleanups.forEach((f) => f()); clearInterval(sketchTimer); rvTimers.forEach(clearTimeout); },
    };
  },
};

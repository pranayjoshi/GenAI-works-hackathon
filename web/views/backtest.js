/* Backtest view: does the crowd pick real winners? Overview (animated forest plot), 3D map, Tests (accordion list).
 * Data: GET /api/backtest -> { runs: [{ config, scores, mcnemar, tests }] }. Numbers are shown exactly as measured;
 * intervals that span 50% are called "not distinguishable from chance" (BUILD_PLAN section 16). Styles: css/library.css. */
import { h, s, mount, pct, cssVar } from '../core/dom.js';
import { api } from '../core/api.js';
import { countUp, stagger, reduced, EASE } from '../core/motion.js';
import { createStage } from '../core/three-kit.js';

function wilson(k, n, z = 1.96) {
  if (!n) return [0, 0];
  const p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return [(c - m) / d, (c + m) / d];
}
const norm = (v) => (v > 1 ? v / 100 : v);
const rateOf = (o) => (o.rate != null ? norm(o.rate) : o.n ? o.correct / o.n : 0);
const spans = (ci) => ci[0] <= 0.5 && ci[1] >= 0.5;

/** 'right' | 'wrong' | 'tie' | 'none' for one method on one test. */
function outcome(o, t) {
  if (!o || o.failed) return 'none';
  const c = typeof o.correct === 'number' ? o.correct : o.pick == null ? null : o.pick === 'tie' ? 0.5 : o.pick === t.real_winner ? 1 : 0;
  return c === 1 ? 'right' : c === 0 ? 'wrong' : c === 0.5 ? 'tie' : 'none';
}
const METHODS = [['crowd', 'Ripple simulated audience'], ['single_reason', 'Single prompt (reasoning model)'], ['single_crowd', 'Single prompt (crowd model)']];
const TONE = { right: 'good', wrong: 'bad', tie: 'warn', none: '' };
const runTitle = (r, i) => r.started || r.config?.created || r.created || `run ${i + 1}`;

/** Rows for the forest plot, from the file's own score objects (Wilson recomputed only when the file lacks an interval). */
function forestRows(r) {
  const rows = METHODS.filter(([k]) => r.scores[k]).map(([k, name]) => {
    const o = r.scores[k], rt = rateOf(o);
    const ci = o.ci && o.ci.length === 2 ? o.ci.map(norm) : wilson(o.correct ?? rt * o.n, o.n);
    return { key: k, name, rt, ci, n: o.n, correct: o.correct, hero: k === 'crowd' };
  });
  const n0 = rows[0]?.n || 0;
  rows.push({ key: 'coin', name: 'Coin flip', rt: 0.5, ci: wilson(n0 / 2, n0), n: n0, chance: true });
  return rows;
}

function chanceCopy(rows) {
  const real = rows.filter((x) => !x.chance);
  const above = real.filter((x) => x.ci[0] > 0.5), below = real.filter((x) => x.ci[1] < 0.5);
  if (!real.length) return 'No scores in this file.';
  if (real.every((x) => spans(x.ci))) return 'Every interval includes 50%. On this sample none of these methods is distinguishable from chance, and the differences between them are within noise.';
  const parts = [];
  if (above.length) parts.push(`${above.map((x) => x.name).join(', ')}: interval sits above 50%, so better than chance on this sample`);
  if (below.length) parts.push(`${below.map((x) => x.name).join(', ')}: interval sits below 50%`);
  const flat = real.filter((x) => spans(x.ci));
  if (flat.length) parts.push(`${flat.map((x) => x.name).join(', ')}: interval includes 50%, not distinguishable from chance`);
  return parts.join('. ') + '.';
}

function forestPlot(rows) {
  const ticks = [0, 25, 50, 75, 100];
  const plot = h('div.lib-forest');
  const axis = h('div.lib-forest-axis', h('span'), h('div.lib-axis-ticks', ticks.map((t) => h('span', { style: { left: `${t}%` } }, `${t}%`))), h('span'));
  plot.append(axis);
  const anims = [];
  rows.forEach((x, i) => {
    const bar = h('i.lib-ci', { style: { left: `${x.ci[0] * 100}%`, width: `${Math.max(0.6, (x.ci[1] - x.ci[0]) * 100)}%`, transformOrigin: `${((x.rt - x.ci[0]) / Math.max(1e-6, x.ci[1] - x.ci[0])) * 100}% 50%` } });
    const dot = h('b.lib-pt', { style: { left: `${x.rt * 100}%` } });
    const val = h('b.lib-val'); countUp(val, x.rt * 100, (v) => `${Math.round(v)}%`, 700);
    const verdict = x.chance ? 'by definition' : spans(x.ci) ? 'spans chance' : x.ci[0] > 0.5 ? 'above chance' : 'below chance';
    plot.append(h('div.lib-frow' + (x.hero ? '.hero' : '') + (x.chance ? '.chance' : ''),
      h('div.lib-fname', x.name, h('small', x.chance ? 'reference line' : `n = ${x.n}${x.correct != null ? `, ${x.correct} correct` : ''}`)),
      h('div.lib-ftrack', ticks.map((t) => h('u.lib-grid-line' + (t === 50 ? '.mid' : ''), { style: { left: `${t}%` } })), bar, dot),
      h('div.lib-fval', val, h(x.chance ? 'span.chip' : 'span.chip.' + (spans(x.ci) ? 'warn' : x.ci[0] > 0.5 ? 'good' : 'bad'), verdict), h('small', `95% CI ${pct(x.ci[0], 0)} to ${pct(x.ci[1], 0)}`))));
    if (!reduced()) {
      anims.push(() => {
        bar.animate([{ transform: 'scaleX(0)', opacity: 0 }, { transform: 'scaleX(1)', opacity: 1 }], { duration: 620, delay: 120 + i * 80, easing: EASE.expo, fill: 'backwards' });
        dot.animate([{ transform: 'translate(-50%, -50%) scale(0)' }, { transform: 'translate(-50%, -50%) scale(1.25)', offset: 0.7 }, { transform: 'translate(-50%, -50%) scale(1)' }], { duration: 480, delay: 80 + i * 80, easing: EASE.out, fill: 'backwards' });
      });
    }
  });
  const mid = h('u.lib-chance-line', { style: { left: 'calc(var(--lib-label) + (100% - var(--lib-label) - var(--lib-value)) * .5)' } });
  plot.append(mid);
  if (!reduced()) anims.push(() => mid.animate([{ transform: 'scaleY(0)' }, { transform: 'scaleY(1)' }], { duration: 560, easing: EASE.expo, fill: 'backwards' }));
  requestAnimationFrame(() => anims.forEach((f) => f()));
  return plot;
}

function mcnemarBlock(m, r) {
  if (!m) return null;
  const pairs = typeof m === 'object' && m.b == null ? Object.entries(m) : [[null, m]];
  const label = { crowd_vs_single_reason: 'the single prompt to the reasoning model', crowd_vs_single_crowd: 'the single prompt to the crowd model' };
  const plain = pairs.map(([k, v]) => {
    if (v == null || typeof v !== 'object' || v.b == null) return h('p', `Crowd vs baseline: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`);
    const disc = v.b + v.c, sig = v.p < 0.05;
    return h('p.lib-mc-line',
      `Against ${label[k] || 'the baseline'}, the two methods disagreed on ${disc} tests: the crowd was right on ${v.b}, the baseline on ${v.c}` + (v.excluded_ties ? ` (${v.excluded_ties} tied pairs left out)` : '') + '. ',
      h('b', sig ? `That gap is unlikely to be chance (p = ${v.p.toFixed(3)}).` : `That gap is not statistically significant (p = ${v.p.toFixed(2)}).`));
  });
  return h('div.lib-mc', h('h3', 'Simulated audience vs single prompt (McNemar exact test)'), plain,
    h('details.lib-raw', h('summary', 'Raw values'), h('pre.sql', JSON.stringify(m, null, 2))));
}

function configChips(cfg = {}) {
  const out = [];
  for (const [k, v] of Object.entries(cfg)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) for (const [k2, v2] of Object.entries(v)) out.push([`${k}.${k2}`, v2]);
    else out.push([k, Array.isArray(v) ? v.join(', ') : v]);
  }
  return h('div.lib-chips', out.map(([k, v]) => h('span.chip', { title: `${k}: ${v}` }, `${k}: ${v}`)));
}

export default function view(el) {
  let dead = false, stage = null, cleanups = [], offResize = null;
  const root = h('div.view-page.lib-page');
  el.append(root);
  root.append(h('header.lib-hero', h('h1', 'Reality check: does the simulated audience pick real winners?'),
    h('p.muted', 'Real A/B headline tests from the Upworthy Research Archive. The simulated audience sees both headlines; we check its pick against the real click-through winner. This is how we know Ripple does not forecast real winners, and why it reports simulated reactions with their uncertainty.')));
  const box = h('div.lib-bt', h('div.card.lib-skel', { style: { height: '220px' } }));
  root.append(box);

  const disposeStage = () => { cleanups.forEach((f) => f()); cleanups = []; if (stage) { stage.dispose(); stage = null; } };

  api('/api/backtest').then((data) => {
    if (dead) return;
    const runs = (data?.runs || []).filter((r) => r && r.scores);
    if (!runs.length) {
      return mount(box, h('div.card', h('h2', 'No reality check has been run yet'),
        h('p.muted', { style: { marginTop: '8px' } }, 'Method: take exploratory tests from the Upworthy Research Archive (4,873 exploratory tests, CC BY 4.0), keep the best-versus-worst headline pairs, show both to a general US crowd sampled from Census and Pew, and record which headline the crowd would tap. Score each pick against the real click-through winner, and compare it with a single prompt to a reasoning model, a single prompt to the crowd model, and a coin flip.'),
        h('p', 'Run it with:'), h('code.code', 'npm run backtest'),
        h('p.muted', { style: { marginTop: '10px' } }, 'Results are shown exactly as measured, with Wilson 95% intervals. These are headlines, not small-business posts.')));
    }
    let idx = 0, tab = 'overview';
    const ui = {};
    const tabs = [['overview', 'Overview'], ['map', '3D map'], ['tests', 'Tests']];

    function openTab(name, after) {
      if (name === tab && !after) return;
      const prev = ui.panels[tab], next = ui.panels[name], dir = tabs.findIndex((t) => t[0] === name) > tabs.findIndex((t) => t[0] === tab) ? 1 : -1;
      tab = name;
      ui.tabBtns.forEach(([k, b]) => b.setAttribute('aria-selected', String(k === name)));
      moveInk();
      prev.hidden = true; next.hidden = false;
      if (name === 'map') ensureMap();
      if (!reduced()) next.animate([{ opacity: 0, transform: `translateX(${dir * 28}px)`, filter: 'blur(4px)' }, { opacity: 1, transform: 'none', filter: 'blur(0)' }], { duration: 380, easing: EASE.expo });
      after?.();
    }
    function moveInk() {
      const b = ui.tabBtns.find(([k]) => k === tab)?.[1];
      if (b && ui.ink) { ui.ink.style.width = `${b.offsetWidth}px`; ui.ink.style.transform = `translateX(${b.offsetLeft}px)`; }
    }

    function build() {
      disposeStage();
      const r = runs[idx], tests = r.tests || [], rows = forestRows(r);
      ui.mapBuilt = false;
      ui.tabBtns = tabs.map(([k, l]) => [k, h('button.lib-tab', { type: 'button', role: 'tab', 'aria-selected': String(k === tab), onclick: () => openTab(k) }, l)]);
      ui.ink = h('span.lib-tab-ink');
      const overview = h('section.lib-panel', { role: 'tabpanel' },
        h('div.card.lib-hero-card',
          h('div.card-head', h('h2', 'Accuracy at picking the real winner'), h('span.sub', `${tests.length} tests`)),
          forestPlot(rows),
          h('div.lib-chance-copy', chanceCopy(rows)),
          h('div.expl', 'Bars are Wilson 95% intervals around the measured rate. The vertical line is chance (50%). A tie counts as half a point.')),
        h('div.lib-two', h('div.card', mcnemarBlock(r.mcnemar, r) || h('p.muted', 'No McNemar result in this file.')),
          h('div.card', h('h3', 'Configuration'), configChips(r.config), r.served_by ? h('p.muted', { style: { marginTop: '10px', fontSize: '12.5px' } }, `Served by ${typeof r.served_by === 'object' ? Object.entries(r.served_by).map(([k, v]) => `${k} (${v})`).join(', ') : r.served_by}`) : null)));
      ui.mapHost = h('div.lib-map-host');
      ui.tip = h('div.lib-tip', { hidden: true });
      ui.mapColor = 'crowd';
      ui.legend = h('div.lib-legend');
      const colorSeg = h('div.lib-seg', { role: 'group', 'aria-label': 'Colour bars by' }, METHODS.map(([k, l]) => h('button.lib-seg-btn', { type: 'button', 'aria-pressed': String(k === ui.mapColor), onclick: (e) => { ui.mapColor = k; colorSeg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget))); ui.recolor?.(); } }, l.replace('Single prompt ', 'Single '))));
      const map = h('section.lib-panel', { role: 'tabpanel', hidden: true },
        h('div.card.lib-map-card', h('div.card-head', h('h2', 'Every test, in space'), colorSeg),
          h('p.muted.lib-map-copy', 'One bar per test, laid out in test order (each row is labelled with its test numbers). Height is the real click-through gap between the two headlines, so tall bars were easy calls in real life. Colour shows whether the selected method picked the real winner.'),
          h('div.lib-map-stage', ui.mapHost, h('div.lib-map-hint', 'Drag to orbit · click a bar to open its test'), ui.legend, ui.tip)));
      ui.list = h('div.lib-tests');
      ui.filter = 'all';
      const counts = { all: tests.length, right: 0, wrong: 0, disagree: 0 };
      tests.forEach((t) => { const c = outcome(t.crowd, t); if (c === 'right') counts.right++; if (c === 'wrong') counts.wrong++; if (isDisagree(t)) counts.disagree++; });
      const filters = [['all', 'All'], ['right', 'Crowd right'], ['wrong', 'Crowd wrong'], ['disagree', 'Disagree with baselines']];
      const fBtns = filters.map(([k, l]) => h('button.lib-seg-btn', { type: 'button', 'aria-pressed': String(k === ui.filter), onclick: () => { ui.filter = k; fBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(filters[i][0] === k))); renderList(true); } }, `${l} `, h('em', String(counts[k]))));
      const testsPanel = h('section.lib-panel', { role: 'tabpanel', hidden: true },
        h('div.card-head', h('h2', 'Per-test results'), h('div.lib-seg.wrap', { role: 'group', 'aria-label': 'Filter tests' }, fBtns)), ui.list);
      ui.panels = { overview, map, tests: testsPanel };
      const picker = runs.length > 1 ? h('label.lib-picker', h('span.muted', 'Reality-check run'), h('select', { onchange: (e) => { idx = Number(e.target.value); tab = 'overview'; build(); } },
        runs.map((x, i) => h('option', { value: i, selected: i === idx }, runTitle(x, i))))) : null;
      mount(box, h('div.lib-bar', h('div.lib-tabs', { role: 'tablist' }, ui.ink, ui.tabBtns.map((x) => x[1])), picker),
        h('div.lib-panels', overview, map, testsPanel));
      ui.panels[tab].hidden = false;
      overview.hidden = tab !== 'overview'; map.hidden = tab !== 'map'; testsPanel.hidden = tab !== 'tests';
      requestAnimationFrame(moveInk);
      if (tab === 'map') ensureMap();
      renderList(false);
      stagger([...overview.children], { y: 16, gap: 70, ms: 520 });
    }

    const isDisagree = (t) => { const c = outcome(t.crowd, t); return ['single_reason', 'single_crowd'].some((k) => t[k] && outcome(t[k], t) !== c); };

    /* ---- tests accordion */
    function ctrBar(v, max, cls) { return h('div.lib-ctr', h('i.' + cls, { style: { '--w': `${max ? (v / max) * 100 : 0}%` } }), h('span', pct(v, 2))); }
    function testRow(t, i) {
      const r = runs[idx], num = i + 1;
      const a = t.a?.ctr ?? 0, b = t.b?.ctr ?? 0, max = Math.max(a, b);
      const co = t.crowd, tapTotal = (co?.a_tap ?? 0) + (co?.b_tap ?? 0), aShare = tapTotal ? (co.a_tap / tapTotal) * 100 : 50;
      const chip = (k, name) => { const o = outcome(t[k], t); return h('span.chip.' + TONE[o], { title: t[k]?.reason || '' }, `${name} ${o === 'none' ? 'n/a' : o === 'tie' ? 'tie' : `${t[k]?.pick} ${o}`}`); };
      const panel = h('div.lib-acc-panel', h('div.lib-acc-inner',
        h('div.lib-heads', [['A', t.a, a], ['B', t.b, b]].map(([v, side, ctr]) => h('div.lib-head.' + v.toLowerCase() + (t.real_winner === v ? '.win' : ''),
          h('div.lib-head-top', h('span.chip.' + v.toLowerCase(), `Headline ${v}`), t.real_winner === v ? h('span.chip.good', 'real winner') : null),
          h('p', side?.headline || ''), ctrBar(ctr, max, v.toLowerCase()), side?.impressions ? h('small.muted', `${side.impressions.toLocaleString()} impressions`) : null))),
        co ? h('div.lib-split', h('div.lib-split-lab', h('span', 'Crowd tap-through'), h('small.muted', `A ${pct(co.a_tap, 1)}${co.a_taps != null ? ` (${co.a_taps}/${co.a_n})` : ''} vs B ${pct(co.b_tap, 1)}${co.b_taps != null ? ` (${co.b_taps}/${co.b_n})` : ''}`)),
          h('div.lib-splitbar', h('i.a', { style: { '--w': `${aShare}%` } }), h('i.b', { style: { '--w': `${100 - aShare}%` } }))) : null,
        h('div.lib-chips', chip('crowd', 'Crowd'), chip('single_reason', 'Reasoning prompt'), chip('single_crowd', 'Crowd-model prompt')),
        t.test_id ? h('small.muted.mono', `test ${t.test_id}`) : null));
      const head = h('button.lib-acc-head', { type: 'button', 'aria-expanded': 'false', onclick: () => toggle(row) },
        h('span.lib-acc-n', String(num).padStart(2, '0')),
        h('span.lib-acc-title', h('span.a', t.a?.headline), h('em', ' vs '), h('span.b', t.b?.headline)),
        h('span.lib-acc-chips', h('span.chip', `real: ${t.real_winner}`), chip('crowd', 'Crowd')),
        h('svg.lib-caret', { viewBox: '0 0 24 24', width: 18, height: 18 }, s('path', { d: 'M6 9l6 6 6-6', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round' })));
      const row = h('div.lib-acc', { 'data-i': i }, head, panel);
      return row;
    }
    function toggle(row, force) {
      const open = force ?? !row.classList.contains('open');
      row.classList.toggle('open', open);
      row.querySelector('.lib-acc-head').setAttribute('aria-expanded', String(open));
    }
    function renderList(animate) {
      const tests = runs[idx].tests || [];
      const keep = tests.map((t, i) => [t, i]).filter(([t]) => {
        const c = outcome(t.crowd, t);
        return ui.filter === 'all' || (ui.filter === 'right' && c === 'right') || (ui.filter === 'wrong' && c === 'wrong') || (ui.filter === 'disagree' && isDisagree(t));
      });
      if (!tests.length) return mount(ui.list, h('div.empty', 'No per-test rows in this file.'));
      if (!keep.length) return mount(ui.list, h('div.empty', 'No tests match this filter.'));
      const rows = keep.map(([t, i]) => testRow(t, i));
      mount(ui.list, rows);
      if (animate) stagger(rows.slice(0, 14), { y: 12, gap: 30, ms: 500 });
    }
    function showTest(i) {
      ui.filter = 'all';
      openTab('tests', () => {
        renderList(false);
        const row = ui.list.querySelector(`[data-i="${i}"]`);
        if (!row) return;
        toggle(row, true);
        row.scrollIntoView({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' });
        row.animate([{ boxShadow: '0 0 0 2px var(--accent)' }, { boxShadow: '0 0 0 0 transparent' }], { duration: 1400, easing: EASE.out });
      });
      // keep filter buttons in sync with the reset
      ui.panels.tests.querySelectorAll('.lib-seg-btn').forEach((b, k) => b.setAttribute('aria-pressed', String(k === 0)));
    }

    /* ---- 3D map */
    async function ensureMap() {
      if (ui.mapBuilt) return;
      ui.mapBuilt = true;
      const r = runs[idx], tests = r.tests || [];
      const host = ui.mapHost;
      if (!tests.length) return mount(host, h('div.empty', 'No tests to plot.'));
      const gaps = tests.map((t) => Math.abs((t.a?.ctr ?? 0) - (t.b?.ctr ?? 0)));
      const colorKey = () => ui.mapColor;
      const toneOf = (t) => outcome(t[colorKey()], t);
      const legend = () => mount(ui.legend, [['right', 'picked the real winner'], ['wrong', 'picked the loser'], ['tie', 'tie'], ['none', 'no answer']].map(([k, l]) => h('span.lib-lg', h('i.' + (TONE[k] || 'none')), l)),
        h('span.lib-lg.muted', h('i.h'), 'height = |CTR A − CTR B|'));
      legend();
      const placeTip = (cx, cy) => {
        const r2 = ui.mapHost.getBoundingClientRect(), tw = ui.tip.offsetWidth, th = ui.tip.offsetHeight;
        let x = cx - r2.left + 14, y = cy - r2.top + 14;
        if (x + tw > r2.width - 8) x = cx - r2.left - tw - 14;
        if (y + th > r2.height - 8) y = cy - r2.top - th - 14;
        ui.tip.style.left = `${Math.max(8, Math.min(r2.width - tw - 8, x))}px`; ui.tip.style.top = `${Math.max(8, Math.min(r2.height - th - 8, y))}px`;
      };
      const tipFor = (t, i) => { ui.tip.hidden = false; mount(ui.tip, h('b', `Test ${String(i + 1).padStart(2, '0')}`), h('div.a', `A (${pct(t.a?.ctr, 2)}): ${t.a?.headline}`), h('div.b', `B (${pct(t.b?.ctr, 2)}): ${t.b?.headline}`), h('small', `Real winner ${t.real_winner}. Crowd ${outcome(t.crowd, t)}.`)); };
      let local;
      try { local = await createStage(host, { camera: { fov: 40, x: 9.5, y: 8.5, z: 12.5 }, controls: { minDistance: 8, maxDistance: 30, autoRotate: !reduced(), autoRotateSpeed: 0.5 } }); } catch (e) { console.warn('[backtest] 3D unavailable', e); local = null; }
      if (dead || !ui.mapHost.isConnected || host !== ui.mapHost) { local?.dispose(); return; }
      if (!local) return fallback2d(host, tests, gaps, toneOf, tipFor, showTest, placeTip);
      stage = local;
      const { THREE, scene } = stage;
      const colors = () => ({ right: new THREE.Color(cssVar('--good') || '#4fe3a0'), wrong: new THREE.Color(cssVar('--bad') || '#ff5f6d'), tie: new THREE.Color(cssVar('--warn') || '#ffc84d'), none: new THREE.Color(cssVar('--faint') || '#5d6278') });
      let pal = colors();
      const cols = Math.ceil(Math.sqrt(tests.length)), gap = 1.35, maxGap = Math.max(...gaps, 1e-9), maxH = 5;
      const geo = new THREE.BoxGeometry(1, 1, 1); geo.translate(0, 0.5, 0);
      const group = new THREE.Group(); scene.add(group);
      const bars = tests.map((t, i) => {
        const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: pal[toneOf(t)], roughness: 0.4, metalness: 0.15, emissive: pal[toneOf(t)], emissiveIntensity: 0.12 }));
        const cx = i % cols, cz = Math.floor(i / cols);
        m.position.set((cx - (cols - 1) / 2) * gap, 0, (cz - (Math.ceil(tests.length / cols) - 1) / 2) * gap);
        m.userData = { i, target: Math.max(0.12, (gaps[i] / maxGap) * maxH), cur: reduced() ? Math.max(0.12, (gaps[i] / maxGap) * maxH) : 0.001, delay: i * 0.025 };
        m.scale.set(0.9, m.userData.cur, 0.9);
        group.add(m); return m;
      });
      const rowsN = Math.ceil(tests.length / cols), span = Math.max(cols, rowsN) * gap + 2;
      const grid = new THREE.GridHelper(span, Math.max(cols, rowsN) + 2, 0x8f7bff, 0x8f7bff); grid.material.transparent = true; grid.material.opacity = 0.2; grid.position.y = -0.01; scene.add(grid);
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(span, span), new THREE.MeshBasicMaterial({ color: new THREE.Color(cssVar('--accent') || '#8f7bff'), transparent: true, opacity: 0.05, depthWrite: false }));
      floor.rotation.x = -Math.PI / 2; floor.position.y = -0.02; scene.add(floor);
      // axes: height (real CTR gap, in percentage points) on the back-left corner, test numbers along the left edge
      const ink = cssVar('--muted') || '#9196ab', inkStrong = cssVar('--text') || '#eef0f7';
      const label = (text, { size: size0 = 0.42, color = ink, weight = 500, align = 'center' } = {}) => {
        const size = size0 * lk, c = document.createElement('canvas'), g = c.getContext('2d'), fs = 48, font = `${weight} ${fs}px Instrument Sans, system-ui, sans-serif`;
        g.font = font; const w = Math.ceil(g.measureText(text).width) + 16; c.width = w; c.height = fs + 16;
        g.font = font; g.fillStyle = color; g.textBaseline = 'middle'; g.textAlign = align === 'left' ? 'left' : align === 'right' ? 'right' : 'center';
        g.fillText(text, align === 'left' ? 8 : align === 'right' ? w - 8 : w / 2, c.height / 2);
        const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false }));
        sp.renderOrder = 10;
        sp.scale.set(size * (c.width / c.height), size, 1);
        sp.center.set(align === 'left' ? 0 : align === 'right' ? 1 : 0.5, 0.5);
        return sp;
      };
      const asp = host.clientWidth / Math.max(1, host.clientHeight), lk = asp < 0.9 ? 2 : 1, narrow = asp < 0.9;
      const half = span / 2, x0 = -half + 0.2, z0 = half - 0.2, xr = ((cols - 1) / 2) * gap + 0.75;
      const axisMat = new THREE.LineBasicMaterial({ color: new THREE.Color(ink), transparent: true, opacity: 0.6 });
      const seg = (pts) => new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts.map(([x, y, z]) => new THREE.Vector3(x, y, z))), axisMat);
      scene.add(seg([[x0, 0, z0], [x0, maxH + 0.4, z0]]));
      [0, 0.5, 1].forEach((f) => {
        const y = f * maxH;
        scene.add(seg([[x0, y, z0], [x0 + 0.35, y, z0]]));
        const tl = label(`${(f * maxGap * 100).toFixed(2)} pts`, { size: 0.34, align: narrow ? 'left' : 'right' }); tl.position.set(narrow ? x0 + 0.5 : x0 - 0.2, y, z0 + 0.2); scene.add(tl);
      });
      const yl = label('real CTR gap', { size: 0.4, color: inkStrong, weight: 600, align: narrow ? 'left' : 'center' }); yl.position.set(x0, maxH + 0.7, z0); scene.add(yl);
      for (let rI = 0; rI < rowsN; rI++) {
        const first = rI * cols + 1, last = Math.min(tests.length, first + cols - 1);
        const z = (rI - (rowsN - 1) / 2) * gap;
        const rl = label(`${String(first).padStart(2, '0')}–${String(last).padStart(2, '0')}`, { size: 0.32, align: 'left' });
        rl.position.set(xr, 0.05, z); scene.add(rl);
      }
      const xl = label('test #', { size: 0.36, color: inkStrong, weight: 600, align: 'left' }); xl.position.set(xr, 0.05, -((rowsN - 1) / 2) * gap - 1.1); scene.add(xl);
      scene.add(new THREE.AmbientLight(0xffffff, 0.75));
      const sun = new THREE.DirectionalLight(0xffffff, 1.4); sun.position.set(6, 12, 8); scene.add(sun);
      const camK = narrow ? 2.1 : asp < 1.4 ? 1.35 : 1.05;
      stage.camera.position.multiplyScalar(camK);
      if (stage.controls) stage.controls.maxDistance = Math.max(30, stage.camera.position.length() * 1.6);
      stage.controls?.target.set(0, maxH * 0.32, 0); stage.controls?.update();
      ui.recolor = () => { pal = colors(); bars.forEach((m, i) => { const c = pal[toneOf(tests[i])]; m.material.color.copy(c); m.material.emissive.copy(c); }); };
      let hover = -1;
      stage.onFrame((t, dt) => {
        for (const m of bars) {
          const u = m.userData, want = hover === u.i ? u.target * 1.08 : u.target;
          if (t > u.delay) { u.cur += (want - u.cur) * Math.min(1, dt * 7); m.scale.y = Math.max(0.001, u.cur); }
          m.material.emissiveIntensity += ((hover === u.i ? 0.6 : 0.12) - m.material.emissiveIntensity) * Math.min(1, dt * 10);
        }
      });
      const cv = stage.canvas;
      let downX = 0, downY = 0;
      const onMove = (e) => {
        const hit = stage.pick(e.clientX, e.clientY, bars);
        hover = hit ? hit.object.userData.i : -1;
        cv.style.cursor = hit ? 'pointer' : 'grab';
        if (hit) {
          tipFor(tests[hover], hover);
          placeTip(e.clientX, e.clientY);
        } else ui.tip.hidden = true;
      };
      const onLeave = () => { hover = -1; ui.tip.hidden = true; };
      const onDown = (e) => { downX = e.clientX; downY = e.clientY; if (stage.controls) stage.controls.autoRotate = false; };
      const onUp = (e) => { if (Math.hypot(e.clientX - downX, e.clientY - downY) < 5) { const hit = stage.pick(e.clientX, e.clientY, bars); if (hit) showTest(hit.object.userData.i); } };
      cv.addEventListener('pointermove', onMove); cv.addEventListener('pointerleave', onLeave); cv.addEventListener('pointerdown', onDown); cv.addEventListener('pointerup', onUp);
      cleanups.push(() => { cv.removeEventListener('pointermove', onMove); cv.removeEventListener('pointerleave', onLeave); cv.removeEventListener('pointerdown', onDown); cv.removeEventListener('pointerup', onUp); ui.recolor = null; });
    }

    /** 2D stand-in: the same bars as an SVG column chart. */
    function fallback2d(host, tests, gaps, toneOf, tipFor, open, placeTip) {
      const max = Math.max(...gaps, 1e-9), W = Math.max(320, tests.length * 14), H = 180;
      const svg = s('svg', { class: 'lib-fallback', viewBox: `0 0 ${W} ${H + 10}`, preserveAspectRatio: 'none', role: 'img', 'aria-label': 'Real CTR gap per test, coloured by whether the crowd was right' });
      tests.forEach((t, i) => {
        const hgt = Math.max(3, (gaps[i] / max) * H), r = s('rect', { class: 'lib-fb-bar ' + TONE[toneOf(t)], x: i * 14 + 2, y: H - hgt, width: 10, height: hgt, rx: 2, tabindex: 0 });
        r.style.animationDelay = `${i * 18}ms`;
        r.addEventListener('mouseenter', (e) => { tipFor(t, i); placeTip(e.clientX, e.clientY); }); r.addEventListener('mouseleave', () => { ui.tip.hidden = true; });
        r.addEventListener('click', () => open(i)); r.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(i); });
        svg.append(r);
      });
      mount(host, svg);
      host.classList.add('flat');
    }

    build();
    window.addEventListener('resize', moveInk);
    offResize = () => window.removeEventListener('resize', moveInk);
  }).catch((e) => { if (!dead) mount(box, h('div.banner.bad', e.message)); });

  return () => { dead = true; offResize?.(); disposeStage(); };
}

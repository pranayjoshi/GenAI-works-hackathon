/* signals stage: A vs B over the rounds.
 * - Main chart (SVG, hand-rolled): metric switcher with a morph, draw-in reveal, hover crosshair + tooltip,
 *   event flags, the gap between the lines shaded in the leading version's colour.
 * - 3D ribbons (three.js, lazy): the same data as two orbitable ribbons; falls back to 2D only when WebGL is missing.
 * - Small multiples: vocal vs silent share per round, cumulative deciders.
 * Timeline entries are cumulative snapshots per round: {round, hour_label, exposures, deciders, intent, engaged, vocal, hides, stance_sum, calls}.
 * Styles live in css/verdict.css (prefix sg-). */
import { h, s, mount, clear, pct, num, fmtInt, vcolor, cssVar, draftName } from '../../core/dom.js';
import { reduced, countUp } from '../../core/motion.js';
import { createStage, dotTexture } from '../../core/three-kit.js';

/* ------------------------------------------------------------------ metrics */
const METRICS = [
  { id: 'intent', label: 'Intent rate', kind: 'rate', note: 'Share of deciders whose latest answer is "would visit".', get: (c) => (c.deciders > 0 ? c.intent / c.deciders : null), fmt: (v) => pct(v, 0), fmt1: (v) => pct(v, 1), sub: (c) => `${fmtInt(c.intent)} of ${fmtInt(c.deciders)} deciders` },
  { id: 'deciders', label: 'Deciders', kind: 'count', note: 'People who have made a decision so far (cumulative).', get: (c) => c.deciders, fmt: fmtInt, fmt1: fmtInt, sub: (c) => `${fmtInt(c.exposures)} exposures` },
  { id: 'hides', label: 'Hides', kind: 'count', note: 'Times the post was hidden so far (cumulative).', get: (c) => c.hides, fmt: fmtInt, fmt1: fmtInt, sub: (c) => `of ${fmtInt(c.deciders)} deciders` },
  { id: 'stance', label: 'Mean stance', kind: 'signed', note: 'Average private feeling, -1 negative to +1 positive.', get: (c) => (c.deciders > 0 ? c.stance_sum / c.deciders : null), fmt: (v) => (v >= 0 ? '+' : '') + num(v, 2), fmt1: (v) => (v >= 0 ? '+' : '') + num(v, 2), sub: (c) => `${fmtInt(c.deciders)} deciders` },
  { id: 'exposures', label: 'Exposures', kind: 'count', note: 'Times the post was shown to someone (cumulative).', get: (c) => c.exposures, fmt: fmtInt, fmt1: fmtInt, sub: (c) => `${fmtInt(c.deciders)} deciders` },
];
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const easeOut = (x) => 1 - Math.pow(1 - x, 3);
/** smallest "nice" step >= x (1, 2, 2.5, 5 x 10^k); integer steps only when ints is set */
function niceStep(x, ints = false) {
  if (!(x > 0)) return ints ? 1 : 0.05;
  const p = Math.pow(10, Math.floor(Math.log10(x)));
  for (const m of [1, 2, 2.5, 5, 10]) { const st = m * p; if (st >= x - 1e-12 && (!ints || (Number.isInteger(st) && st >= 1))) return st; }
  return 10 * p;
}
/** y domain + five evenly spaced, round tick values (four steps) for a metric given every value that exists */
function domainOf(M, vals) {
  const mx = Math.max(0, ...vals), mn = Math.min(0, ...vals);
  let lo = 0, hi = 1;
  if (M.kind === 'rate') { const st = Math.min(0.25, Math.max(0.05, niceStep((mx * 1.04) / 4))); hi = st * 4; }
  else if (M.kind === 'signed') { const st = Math.max(0.05, niceStep(Math.max(mx, -mn) * 1.04 / 2)); lo = -2 * st; hi = 2 * st; }
  else hi = niceStep(Math.max(mx, 4) * 1.04 / 4, true) * 4;
  return { lo, hi, ticks: Array.from({ length: 5 }, (_, i) => lo + ((hi - lo) * i) / 4) };
}

export default {
  id: 'signals',
  mount(el, ctx) {
    const S = ctx.S;
    el.classList.add('sg');
    let metricId = 'intent', mode = '2d', disposed = false, first = true, raf = 0, sched = 0;
    let needsReveal = false, hov = null, W = 640, H = 300, shown = null, curModel = null, lastPts = null, rv = 0;
    let three = undefined;   // undefined = not tried, null = unavailable, object = live
    const M_ = () => METRICS.find((m) => m.id === metricId);
    const cs = {};           // css colours for three.js
    const ml = 48, mr = 18, mt = 26, mb = 44;

    /* ---------------------------------------------------------------- shell */
    const metricBtns = METRICS.map((m) => h('button', { type: 'button', title: m.note, onclick: () => setMetric(m.id) }, m.label));
    const btn2d = h('button.on', { type: 'button', onclick: () => setMode('2d') }, '2D');
    const btn3d = h('button', { type: 'button', title: 'Orbit the same data as two ribbons', onclick: () => setMode('3d') }, '3D');
    const legend = h('div.sg-legend');
    const note = h('div.sg-note');
    const svg = s('svg', { class: 'sg-svg', role: 'img', tabindex: '0', 'aria-label': 'Signals chart' });
    const plot = s('g'); const cross = s('g', { class: 'sg-cross', opacity: 0 });
    const crossLine = s('line', { stroke: 'var(--text)', 'stroke-opacity': .35, 'stroke-dasharray': '3 3' });
    const crossDots = [s('circle', { r: 6, fill: 'none', 'stroke-width': 2 }), s('circle', { r: 6, fill: 'none', 'stroke-width': 2 })];
    cross.append(crossLine, ...crossDots);
    svg.append(plot, cross);
    const tip = h('div.sg-tip', { hidden: true });
    const empty = h('div.sg-empty');
    const view2d = h('div.sg-view.sg-2d', svg);
    const host3d = h('div.sg-view.sg-3d', { 'aria-hidden': 'true', hidden: true });
    const stageBox = h('div.sg-stagebox', view2d, host3d, empty, tip);
    const minis = h('div.sg-minis');
    const chartCard = h('div.card.sg-card',
      h('div.card-head', h('div', h('h2', 'Signals by round'), h('span.sub', 'Same audience, same schedule; only the content differs.')),
        h('div.sg-tools', h('div.ws-seg.sg-metrics', metricBtns), h('div.ws-seg', btn2d, btn3d))),
      legend, stageBox, note);
    el.append(h('div.sg-wrap', h('div.sg-grid', chartCard, minis)));

    /* ---------------------------------------------------------------- model */
    function roundsN() {
      let n = S.spec?.rounds || 0;
      for (const w of ctx.worldIds()) for (const c of Object.values(S.timeline[w] || {})) n = Math.max(n, c.round + 1);
      return n;
    }
    function build() {
      const M = M_(), wids = ctx.worldIds(), vs = ctx.variants(), n = roundsN(), lim = S.replayLim ?? Infinity;
      const cnt = wids.map((w) => { const a = Array(n).fill(null); for (const c of Object.values(S.timeline[w] || {})) if (c && c.round >= 0 && c.round < n && c.round <= lim) a[c.round] = c; return a; });
      const raw = cnt.map((a) => a.map((c) => (c ? M.get(c) : null)));
      const dom = domainOf(M, raw.flat().filter((x) => x != null && Number.isFinite(x)));
      const pos = raw.map((a) => a.map((v) => (v == null || !Number.isFinite(v) ? null : (v - dom.lo) / (dom.hi - dom.lo))));
      const events = (S.events || []).filter((e) => e.round <= lim && e.round < n);
      return { M, vs, wids, n, cnt, raw, pos, dom, ticks: dom.ticks.map((v) => ({ v, p: (v - dom.lo) / (dom.hi - dom.lo) })), tkey: `${M.id}|${dom.lo}|${dom.hi}`, events };
    }

    /* ---------------------------------------------------------------- 2D paint */
    const X = (r, n) => ml + (n > 1 ? r / (n - 1) : 0.5) * (W - ml - mr);
    const Y = (p) => H - mb - p * (H - mt - mb);
    function paint(from, to, k, reveal) {
      rv = reveal;
      const n = to.n;
      clear(plot);
      svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('width', W); svg.setAttribute('height', H);
      const pos = to.pos.map((a, i) => a.map((tp, r) => {
        if (tp == null) return null;
        const fp = from?.pos?.[i]?.[r];
        return fp == null ? tp : fp + (tp - fp) * k;
      }));
      const born = to.pos.map((a, i) => a.map((tp, r) => (tp != null && from?.pos?.[i]?.[r] == null && from ? k : 1)));
      shown = { pos, n, ticks: k >= 0.5 ? to.ticks : (from?.ticks || to.ticks), tkey: k >= 0.5 ? to.tkey : (from?.tkey || to.tkey) };
      const revealX = ml + reveal * (W - ml - mr + 10);
      const clipId = 'sgclip';
      plot.append(s('defs', {}, s('clipPath', { id: clipId }, s('rect', { x: 0, y: 0, width: Math.max(0, revealX), height: H }))));
      // grid + y ticks (cross-fade when the metric changes)
      const drawTicks = (ticks, alpha, M) => ticks.forEach((t) => plot.append(
        s('line', { x1: ml, x2: W - mr, y1: Y(t.p), y2: Y(t.p), stroke: 'var(--line)', opacity: alpha }),
        s('text', { x: ml - 8, y: Y(t.p) + 4, 'text-anchor': 'end', 'font-size': 11, fill: 'var(--muted)', opacity: alpha }, M.fmt(t.v))));
      if (from && from.tkey !== to.tkey && k < 1) { drawTicks(from.ticks, 1 - k, from.M); drawTicks(to.ticks, k, to.M); } else drawTicks(to.ticks, 1, to.M);
      if (to.dom.lo < 0) plot.append(s('line', { x1: ml, x2: W - mr, y1: Y((0 - to.dom.lo) / (to.dom.hi - to.dom.lo)), y2: Y((0 - to.dom.lo) / (to.dom.hi - to.dom.lo)), stroke: 'var(--line-2)' }));
      // x labels
      const step = Math.max(1, Math.ceil(n / (W < 500 ? 4 : 7)));
      for (let r = 0; r < n; r += step) plot.append(
        s('text', { x: X(r, n), y: H - mb + 17, 'text-anchor': 'middle', 'font-size': 11, fill: 'var(--muted)' }, `r${r + 1}`),
        s('text', { x: X(r, n), y: H - mb + 31, 'text-anchor': 'middle', 'font-size': 10, fill: 'var(--faint)' }, ctx.hourOfRound(r).replace('Day ', 'D')));
      // injected events: dashed line + flag
      for (const ev of to.events) {
        const x = X(ev.round, n);
        plot.append(s('line', { x1: x, x2: x, y1: mt, y2: H - mb, stroke: 'var(--bad)', 'stroke-width': 1.3, 'stroke-dasharray': '4 3', opacity: .8 }),
          s('path', { class: 'sg-flag', d: `M${x},${mt + 14} V${mt - 8} h13 l-3.5,5 l3.5,5 h-13`, fill: 'var(--bad)', stroke: 'var(--bad)', 'stroke-linejoin': 'round' }, s('title', {}, `Injected at round ${ev.round + 1} (${ev.target}): ${ev.text}`)));
      }
      // series geometry
      const pts = pos.map((a) => a.map((p, r) => (p == null ? null : { x: X(r, n), y: Y(p), r })));
      lastPts = pts;
      const layer = s('g', { 'clip-path': `url(#${clipId})` });
      plot.append(layer);
      // gap shading between the lines, coloured by who leads
      if (pts.length >= 2) {
        const [pa, pb] = [pts[0], pts[1]], [va, vb] = to.vs;
        for (let r = 0; r < n - 1; r++) {
          const a0 = pa[r], a1 = pa[r + 1], b0 = pb[r], b1 = pb[r + 1];
          if (!a0 || !a1 || !b0 || !b1) continue;
          const d0 = b0.y - a0.y, d1 = b1.y - a1.y;   // positive = A higher on screen value
          const poly = (p, col) => layer.append(s('polygon', { points: p.map((q) => `${q[0]},${q[1]}`).join(' '), fill: vcolor(col), opacity: .16 }));
          if (d0 * d1 >= 0) poly([[a0.x, a0.y], [a1.x, a1.y], [b1.x, b1.y], [b0.x, b0.y]], (d0 + d1) >= 0 ? va : vb);
          else {
            const t = d0 / (d0 - d1), xc = a0.x + (a1.x - a0.x) * t, yc = a0.y + (a1.y - a0.y) * t;
            poly([[a0.x, a0.y], [xc, yc], [b0.x, b0.y]], d0 > 0 ? va : vb);
            poly([[xc, yc], [a1.x, a1.y], [b1.x, b1.y]], d1 > 0 ? va : vb);
          }
        }
      }
      // area + line per version
      const defs = s('defs');
      layer.append(defs);
      const baseY = Y(to.dom.lo < 0 ? -to.dom.lo / (to.dom.hi - to.dom.lo) : 0);
      pts.forEach((arr, i) => {
        const col = vcolor(to.vs[i]);
        const runs = []; let cur = [];
        arr.forEach((p) => { if (p) cur.push(p); else if (cur.length) { runs.push(cur); cur = []; } });
        if (cur.length) runs.push(cur);
        const gid = `sggrad${i}`;
        defs.append(s('linearGradient', { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 }, s('stop', { offset: '0%', 'stop-color': col, 'stop-opacity': .22 }), s('stop', { offset: '100%', 'stop-color': col, 'stop-opacity': 0 })));
        for (const run of runs) {
          const line = run.map((p, j) => `${j ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('');
          if (run.length > 1) layer.append(s('path', { d: `${line}L${run.at(-1).x},${baseY}L${run[0].x},${baseY}Z`, fill: `url(#${gid})` }));
          layer.append(s('path', { d: line, fill: 'none', stroke: col, 'stroke-width': 3, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
        }
      });
      // points pop in as the reveal passes them
      pts.forEach((arr, i) => {
        const col = vcolor(to.vs[i]);
        arr.forEach((p, r) => {
          if (!p) return;
          const sc = clamp((revealX - p.x) / 26, 0, 1) * born[i][r];
          if (sc <= 0) return;
          const last = r === arr.reduce((m, q, j) => (q ? j : m), -1);
          if (last && reveal >= 1 && k >= 1) plot.append(s('circle', { class: 'sg-ping', cx: p.x, cy: p.y, r: 5, fill: 'none', stroke: col, 'stroke-width': 2 }));
          plot.append(s('circle', { cx: p.x, cy: p.y, r: 4.2 * easeOutBack(sc), fill: col, stroke: 'var(--panel-solid)', 'stroke-width': 2 }));
        });
      });
      svg.setAttribute('aria-label', `${to.M.label} by round for ${to.vs.map((v, i) => { const last = to.raw[i].findLast?.((x) => x != null); return last == null ? `${draftName(v)}: no data yet` : `${draftName(v)}: ${to.M.fmt1(last)}`; }).join(', ')}`);
      applyHover();
      if (three) three.apply(from, to, k, reveal);
    }
    const easeOutBack = (x) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };

    /* ---------------------------------------------------------------- tween driver */
    function run(ms, from, to, r0, r1) {
      cancelAnimationFrame(raf);
      curModel = to;
      if (el.offsetParent === null) needsReveal = true;
      if (reduced() || ms <= 0 || el.offsetParent === null) { paint(from, to, 1, r1); return; }
      const t0 = performance.now();
      const tick = (t) => {
        if (disposed) return;
        const x = Math.min(1, (t - t0) / ms), e = easeOut(x);
        paint(from, to, e, r0 + (r1 - r0) * e);
        if (x < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }

    /* ---------------------------------------------------------------- hover */
    function setHover(r) { hov = r; applyHover(); }
    function applyHover() {
      const m = curModel;
      if (hov == null || !m || hov >= m.n || !lastPts) { cross.setAttribute('opacity', 0); tip.hidden = true; return; }
      if (mode === '3d') { cross.setAttribute('opacity', 0); return; }
      const x = X(hov, m.n);
      crossLine.setAttribute('x1', x); crossLine.setAttribute('x2', x); crossLine.setAttribute('y1', mt); crossLine.setAttribute('y2', H - mb);
      crossDots.forEach((d, i) => {
        const p = lastPts[i]?.[hov];
        d.setAttribute('opacity', p ? 1 : 0);
        if (p) { d.setAttribute('cx', p.x); d.setAttribute('cy', p.y); d.setAttribute('stroke', vcolor(m.vs[i])); }
      });
      cross.setAttribute('opacity', 1);
      fillTip(m, hov, mode === '2d' ? x : null);
    }
    function fillTip(m, r, xpx) {
      const rows = m.vs.map((v, i) => {
        const c = m.cnt[i][r], val = m.raw[i][r];
        return h('div.sg-tip-row', h('i', { style: { background: vcolor(v) } }), h('b', `${draftName(v)}`), h('span.mono', val == null ? 'no data yet' : m.M.fmt1(val)), c && val != null ? h('small', m.M.sub(c)) : null);
      });
      const a = m.raw[0]?.[r], b = m.raw[1]?.[r];
      let gap = null;
      if (a != null && b != null) {
        const d = a - b, rate = m.M.kind === 'rate';
        gap = h('div.sg-tip-gap', `${m.vs[0]} - ${m.vs[1]}: ${d >= 0 ? '+' : ''}${rate ? (d * 100).toFixed(1) + ' pts' : m.M.kind === 'signed' ? num(d, 2) : fmtInt(d)}`);
      }
      const evs = m.events.filter((e) => e.round === r).map((e) => h('div.sg-tip-ev', h('b', 'Event'), ` (${e.target}): ${e.text}`));
      mount(tip, h('div.sg-tip-h', h('b', `Round ${r + 1}`), h('span', ctx.hourOfRound(r))), rows, gap, evs);
      tip.hidden = false;
      const box = stageBox.getBoundingClientRect();
      let left = xpx != null ? xpx + 14 : box.width / 2;
      if (xpx != null && left + 230 > box.width) left = xpx - 14 - 220;
      tip.style.left = `${Math.max(6, left)}px`; tip.style.top = `${mt + 4}px`;
    }
    const roundAt = (clientX) => {
      const m = curModel; if (!m || m.n < 1) return null;
      const r = svg.getBoundingClientRect(), x = clientX - r.left;
      return clamp(Math.round(((x - ml) / (W - ml - mr)) * (m.n - 1)), 0, m.n - 1);
    };
    svg.addEventListener('pointermove', (e) => setHover(roundAt(e.clientX)));
    svg.addEventListener('pointerleave', () => setHover(null));
    svg.addEventListener('keydown', (e) => {
      const m = curModel; if (!m || !m.n) return;
      if (e.key === 'ArrowRight') { setHover(clamp((hov ?? -1) + 1, 0, m.n - 1)); e.preventDefault(); }
      if (e.key === 'ArrowLeft') { setHover(clamp((hov ?? m.n) - 1, 0, m.n - 1)); e.preventDefault(); }
      if (e.key === 'Escape') setHover(null);
    });

    /* ---------------------------------------------------------------- 3D ribbons */
    // Same model as the 2D chart: x = round, height = metric, one ribbon per version. Labels are HTML anchored to
    // projected scene points (rounds on the floor, the metric scale on the back wall, the latest value over each
    // ribbon's head, events over their planes). The camera is fitted to the scene box on every resize.
    const XW = 11, ZW = 1.7, HMAX = 4.2, ZBACK = -2.7, ZFRONT = 2.75;
    async function ensure3d() {
      if (three !== undefined) return three;
      three = null;
      let stage = null;
      try { stage = await createStage(host3d, { camera: { fov: 36, x: 15, y: 11, z: 17 }, controls: { minDistance: 8, maxDistance: 40 } }); } catch (e) { console.warn('signals 3D unavailable', e); }
      if (!stage || disposed) { stage?.dispose(); return (three = null); }
      const THREE = stage.THREE, scene = stage.scene;
      cs.a = cssVar('--a') || '#5b8cff'; cs.b = cssVar('--b') || '#ff9a4d'; cs.bad = cssVar('--bad') || '#ff5f6d'; cs.muted = cssVar('--muted') || '#9196ab'; cs.faint = cssVar('--faint') || '#5d6278'; cs.accent = cssVar('--accent') || '#8f7bff';
      scene.add(new THREE.HemisphereLight(0xffffff, 0x223344, 1.1));
      const dl = new THREE.DirectionalLight(0xffffff, 1.4); dl.position.set(6, 12, 8); scene.add(dl);
      // floor: grid + a faint slab under the ribbons
      const grid = new THREE.GridHelper(XW + 2, 13, new THREE.Color(cs.muted), new THREE.Color(cs.faint));
      grid.scale.z = (ZFRONT - ZBACK + 0.6) / (XW + 2); grid.position.set(0, -0.005, (ZFRONT + ZBACK) / 2);
      grid.material.transparent = true; grid.material.opacity = .28; grid.material.depthWrite = false; scene.add(grid);
      const slab = new THREE.Mesh(new THREE.PlaneGeometry(XW + 2, ZFRONT - ZBACK + 0.6), new THREE.MeshBasicMaterial({ color: new THREE.Color(cs.accent), transparent: true, opacity: .05, depthWrite: false }));
      slab.rotation.x = -Math.PI / 2; slab.position.set(0, -0.01, (ZFRONT + ZBACK) / 2); scene.add(slab);
      // back wall with the metric scale
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(XW + 2, HMAX + 0.4), new THREE.MeshBasicMaterial({ color: new THREE.Color(cs.accent), transparent: true, opacity: .035, depthWrite: false, side: THREE.DoubleSide }));
      wall.position.set(0, (HMAX + 0.4) / 2, ZBACK); scene.add(wall);
      const tickMat = new THREE.LineBasicMaterial({ color: new THREE.Color(cs.muted), transparent: true, opacity: .32 });
      const tickGeo = new THREE.BufferGeometry(); const ticks = new THREE.LineSegments(tickGeo, tickMat); scene.add(ticks);
      const labels = h('div.sg-3d-labels'); host3d.append(labels, h('div.sg-3d-hint', 'drag to orbit, scroll to zoom'));
      const tags = [];
      const tag = (cls, text, p, ax = -50, ay = -50) => { const e = h('span.sg-l3' + cls, text); labels.append(e); const o = { el: e, p: new THREE.Vector3(...p), ax, ay }; tags.push(o); return o; };
      const dropTags = (pred) => { for (let i = tags.length - 1; i >= 0; i--) if (pred(tags[i])) { tags[i].el.remove(); tags.splice(i, 1); } };
      const state = { stage, THREE, rib: [], dots: [], heads: [], evGroup: new THREE.Group(), n: -1, camT: 0, dotTex: dotTexture(THREE), tickKey: '' };
      scene.add(state.evGroup);
      for (let i = 0; i < 2; i++) {
        const geo = new THREE.BufferGeometry();
        const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(i ? cs.b : cs.a), emissive: new THREE.Color(i ? cs.b : cs.a), emissiveIntensity: .28, roughness: .38, metalness: .15, transparent: true, opacity: .86, side: THREE.DoubleSide });
        const mesh = new THREE.Mesh(geo, mat); mesh.userData.i = i; scene.add(mesh);
        const dot = new THREE.Sprite(new THREE.SpriteMaterial({ map: state.dotTex, color: new THREE.Color(i ? cs.b : cs.a), transparent: true, depthWrite: false }));
        dot.scale.set(.9, .9, .9); dot.visible = false; scene.add(dot);
        state.rib.push(mesh); state.dots.push(dot);
        const head = tag('.ver.' + (i ? 'b' : 'a'), '', [0, 0, 0], -50, -100); head.el.hidden = true; state.heads.push(head);
      }
      const zc = (i) => (i === 0 ? -1 : 1) * (ZW / 2 + 0.35);
      const xr = (r, n) => (n > 1 ? r / (n - 1) - 0.5 : 0) * XW;
      function layout(n) {   // (re)build index + z once per round count
        state.n = n;
        state.rib.forEach((mesh, i) => {
          const pos = new Float32Array(Math.max(n, 1) * 4 * 3), idx = [];
          for (let r = 0; r < n; r++) {
            const x = xr(r, n), zs = [zc(i) - ZW / 2, zc(i) - ZW / 2, zc(i) + ZW / 2, zc(i) + ZW / 2];
            for (let c = 0; c < 4; c++) { pos[(r * 4 + c) * 3] = x; pos[(r * 4 + c) * 3 + 2] = zs[c]; }
            if (r < n - 1) for (let c = 0; c < 3; c++) { const a = r * 4 + c, b = a + 1, a2 = a + 4, b2 = b + 4; idx.push(a, b, a2, b, b2, a2); }
          }
          mesh.geometry.dispose();
          const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(idx); mesh.geometry = g;
        });
        dropTags((o) => o.round);
        const step = Math.max(1, Math.ceil(n / 8));
        for (let r = 0; r < n; r += step) tag('', `r${r + 1}`, [xr(r, n), 0, ZFRONT], -50, 0).round = true;
        tag('.axis', 'round', [XW / 2 + 0.9, 0, ZFRONT], 0, 0).round = true;
      }
      function scale(to) {   // back-wall gridlines + labels for the current metric
        if (state.tickKey === to.tkey) return;
        state.tickKey = to.tkey;
        const v = [];
        // an L-shaped frame: gridlines across the back wall and along the left side, a ruler at the front-left corner
        const xl = -XW / 2 - 0.6;
        for (const tk of to.ticks) { const y = tk.p * HMAX; v.push(xl, y, ZBACK, XW / 2 + 0.6, y, ZBACK, xl, y, ZBACK, xl, y, ZFRONT, xl, y, ZFRONT, xl - 0.18, y, ZFRONT); }
        v.push(xl, 0, ZFRONT, xl, to.ticks.at(-1).p * HMAX, ZFRONT, xl, 0, ZBACK, xl, HMAX, ZBACK);
        if (to.dom.lo < 0) { const y = (-to.dom.lo / (to.dom.hi - to.dom.lo)) * HMAX; v.push(xl, y, ZBACK + 0.01, XW / 2 + 0.6, y, ZBACK + 0.01, xl, y, ZBACK, xl, y, ZFRONT); }
        tickGeo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); tickGeo.computeBoundingSphere();
        dropTags((o) => o.tick);
        for (const tk of to.ticks) tag('.tick', to.M.fmt(tk.v), [xl - 0.3, tk.p * HMAX, ZFRONT], -100, -50).tick = true;
        tag('.axis', to.M.label, [xl, HMAX + 0.45, ZFRONT], -50, -100).tick = true;
      }
      state.apply = (from, to, k, reveal) => {
        if (state.n !== to.n) layout(to.n);
        scale(to);
        const n = to.n;
        state.rib.forEach((mesh, i) => {
          const pa = mesh.geometry.getAttribute('position'); if (!pa) return;
          let lastR = -1, lastH = 0;
          for (let r = 0; r < n; r++) {
            const tp = to.pos[i]?.[r], fp = from?.pos?.[i]?.[r];
            const p = tp == null ? null : (fp == null ? tp : fp + (tp - fp) * k);
            const grow = easeOut(clamp(reveal * (n + 3) - r, 0, 1));
            const hh = p == null ? 0.02 : Math.max(0.02, p * HMAX) * grow;
            pa.setY(r * 4 + 1, hh); pa.setY(r * 4 + 2, hh);
            if (p != null && grow > 0.05) { lastR = r; lastH = hh; }
          }
          pa.needsUpdate = true; mesh.geometry.computeVertexNormals();
          const d = state.dots[i], hd = state.heads[i];
          d.visible = lastR >= 0; hd.el.hidden = lastR < 0;
          if (lastR >= 0) {
            d.position.set(xr(lastR, n), lastH + 0.35, zc(i));
            hd.p.set(xr(lastR, n), lastH + 0.75, zc(i));
            const val = to.raw[i]?.[lastR];
            hd.el.textContent = `${to.vs[i]} ${val == null ? '' : to.M.fmt1(val)}`;
          }
        });
        // event planes, each labelled with its round
        const ek = to.events.map((e) => e.id ?? e.round).join(',') + '|' + n;
        if (state.evKey !== ek) {
          state.evKey = ek;
          state.evGroup.children.slice().forEach((c) => { c.geometry.dispose(); c.material.dispose(); state.evGroup.remove(c); });
          dropTags((o) => o.ev);
          for (const ev of to.events) {
            const x = xr(ev.round, n);
            const pl = new THREE.Mesh(new THREE.PlaneGeometry(ZFRONT - ZBACK, HMAX + 0.4), new THREE.MeshBasicMaterial({ color: new THREE.Color(cs.bad), transparent: true, opacity: .13, side: THREE.DoubleSide, depthWrite: false }));
            pl.rotation.y = Math.PI / 2; pl.position.set(x, (HMAX + 0.4) / 2, (ZFRONT + ZBACK) / 2); state.evGroup.add(pl);
            const rim = new THREE.LineSegments(new THREE.EdgesGeometry(pl.geometry), new THREE.LineBasicMaterial({ color: new THREE.Color(cs.bad), transparent: true, opacity: .55 }));
            rim.rotation.copy(pl.rotation); rim.position.copy(pl.position); state.evGroup.add(rim);
            const tg = tag('.ev', `Event, round ${ev.round + 1}`, [x, HMAX + 0.45, (ZFRONT + ZBACK) / 2], -50, -100); tg.ev = true; tg.el.title = ev.text || '';
          }
        }
      };
      // camera: fit the scene box (with its labels) into the viewport for the current aspect
      const center0 = new THREE.Vector3(0, HMAX * 0.45, 0), center = center0.clone(), dir = new THREE.Vector3(0.34, 0.33, 0.88).normalize();
      const corners = [];
      for (const x of [-XW / 2 - 1.9, XW / 2 + 1.3]) for (const y of [-0.1, HMAX + 0.8]) for (const z of [ZBACK, ZFRONT + 0.35]) corners.push(new THREE.Vector3(x, y, z));
      const cam = stage.camera, tmp = new THREE.Vector3();
      const right = new THREE.Vector3(), up = new THREE.Vector3();
      function fitDist() {
        // binary-search the distance, then recentre on the projected bounds; twice is enough to converge
        let d = 0;
        for (let pass = 0; pass < 3; pass++) {
          d = fitOnce();
          cam.position.copy(center).addScaledVector(dir, d); cam.lookAt(center); cam.updateMatrixWorld();
          let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
          for (const c of corners) { tmp.copy(c).project(cam); x0 = Math.min(x0, tmp.x); x1 = Math.max(x1, tmp.x); y0 = Math.min(y0, tmp.y); y1 = Math.max(y1, tmp.y); }
          const hh = d * Math.tan((cam.fov * Math.PI) / 360), hw = hh * cam.aspect;
          right.setFromMatrixColumn(cam.matrixWorld, 0); up.setFromMatrixColumn(cam.matrixWorld, 1);
          center.addScaledVector(right, ((x0 + x1) / 2) * hw).addScaledVector(up, ((y0 + y1) / 2) * hh);
        }
        return fitOnce();
      }
      function fitOnce() {
        let lo = 4, hi = 120;
        for (let it = 0; it < 26; it++) {
          const mid = (lo + hi) / 2;
          cam.position.copy(center).addScaledVector(dir, mid); cam.lookAt(center); cam.updateMatrixWorld();
          const ok = corners.every((c) => { tmp.copy(c).project(cam); return Math.abs(tmp.x) < 0.94 && Math.abs(tmp.y) < 0.88 && tmp.z < 1; });
          if (ok) hi = mid; else lo = mid;
        }
        return hi;
      }
      let aspect = 0, userMoved = false;
      state.camTarget = new THREE.Vector3();
      const refit = () => {
        const save = cam.position.clone();
        center.copy(center0);
        const d = fitDist();
        state.camTarget.copy(center).addScaledVector(dir, d);
        if (stage.controls) { stage.controls.target.copy(center); stage.controls.minDistance = d * 0.55; stage.controls.maxDistance = d * 1.8; }
        if (userMoved || state.camT > 0) cam.position.copy(save); else cam.position.copy(state.camTarget);
        cam.lookAt(center);
      };
      stage.controls?.addEventListener('start', () => { userMoved = true; state.camT = 0; });
      state.intro = () => {
        userMoved = false; refit();
        if (reduced()) { cam.position.copy(state.camTarget); state.camT = 0; return; }
        cam.position.copy(center).addScaledVector(dir, center.distanceTo(state.camTarget) * 1.35).add(new THREE.Vector3(2.5, 1.5, 0));
        state.camT = 1.4;
      };
      const pv = new THREE.Vector3();
      state.off = stage.onFrame((t, dt) => {
        if (cam.aspect !== aspect) { aspect = cam.aspect; refit(); }
        if (state.camT > 0) { state.camT -= dt; cam.position.lerp(state.camTarget, 1 - Math.exp(-dt * 4.5)); if (state.camT <= 0) cam.position.copy(state.camTarget); }
        if (curModel && reduced() === false) state.dots.forEach((d, i) => d.scale.setScalar(.85 + Math.sin(t * 3 + i) * .08));
        const w = host3d.clientWidth, hh = host3d.clientHeight;
        cam.updateMatrixWorld();
        for (const o of tags) {
          if (o.el.hidden) continue;
          pv.copy(o.p).project(cam);
          const off = pv.z > 1 || Math.abs(pv.x) > 1.05 || Math.abs(pv.y) > 1.05;
          o.el.style.visibility = off ? 'hidden' : '';
          if (!off) o.el.style.transform = `translate(${((pv.x + 1) / 2 * w).toFixed(1)}px, ${((1 - pv.y) / 2 * hh).toFixed(1)}px) translate(${o.ax}%, ${o.ay}%)`;
        }
      });
      // hover: nearest round under the pointer
      const canvas = stage.canvas;
      canvas.addEventListener('pointermove', (e) => {
        const hit = stage.pick(e.clientX, e.clientY, state.rib);
        if (!hit || !curModel) { setHover(null); return; }
        const n = curModel.n, r = clamp(Math.round((hit.point.x / XW + 0.5) * (n - 1)), 0, Math.max(0, n - 1));
        hov = r; cross.setAttribute('opacity', 0); fillTip(curModel, r, null);
        const sb = stageBox.getBoundingClientRect();
        tip.style.left = `${clamp(e.clientX - sb.left + 14, 6, sb.width - 230)}px`; tip.style.top = `${clamp(e.clientY - sb.top + 10, 6, sb.height - 120)}px`;
      });
      canvas.addEventListener('pointerleave', () => setHover(null));
      three = state;
      if (curModel) state.apply(shown, curModel, 1, rv);
      return state;
    }

    /* ---------------------------------------------------------------- controls */
    function setMetric(id) {
      if (id === metricId) return;
      metricId = id;
      metricBtns.forEach((b, i) => b.classList.toggle('on', METRICS[i].id === id));
      refresh({ morph: true });
    }
    async function setMode(m) {
      if (m === mode) return;
      if (m === '3d') {
        host3d.hidden = false; host3d.classList.add('loading'); const st = await ensure3d(); host3d.classList.remove('loading');
        if (!st) { host3d.hidden = true; btn3d.disabled = true; btn3d.title = '3D is not available in this browser (no WebGL). The 2D chart shows the same data.'; return; }
        st.intro();
      }
      mode = m; hov = null; applyHover();
      if (m === '2d') setTimeout(() => { if (mode === '2d' && !disposed) host3d.hidden = true; }, 600); else host3d.hidden = false;
      btn2d.classList.toggle('on', m === '2d'); btn3d.classList.toggle('on', m === '3d');
      stageBox.dataset.mode = m;
      host3d.setAttribute('aria-hidden', m === '3d' ? 'false' : 'true');
      if (curModel) run(700, shown, curModel, 0, 1);
    }

    /* ---------------------------------------------------------------- legend + notes */
    const lastLeg = {}, lastDec = {};
    function drawLegend(m) {
      mount(legend, m.vs.map((v, i) => {
        const val = m.raw[i].findLast?.((x) => x != null), idx = m.raw[i].reduce((a, x, j) => (x != null ? j : a), -1);
        const num_ = h('b.mono', val == null ? '-' : ''); num_._cu = lastLeg[v] ?? 0; if (val != null) { lastLeg[v] = val; if (m.M.kind === 'rate') countUp(num_, val * 100, (x) => `${x.toFixed(1)}%`, 700); else if (m.M.kind === 'signed') countUp(num_, val, m.M.fmt1, 700); else countUp(num_, val, fmtInt, 700); }
        return h('div.sg-leg', h('i', { style: { background: vcolor(v) } }), h('span.sg-leg-k', `${draftName(v)}`), ' ', num_, ' ', h('small', idx >= 0 ? `after round ${idx + 1}` : 'no rounds yet'));
      }), m.events.length ? h('div.sg-leg.ev', h('i.flag'), h('span.sg-leg-k', `${m.events.length} injected event${m.events.length > 1 ? 's' : ''}`), ' ', h('small', m.events.map((e) => `round ${e.round + 1}`).join(', '))) : null,
      S.replay ? h('span.chip.on', `replaying round ${Math.max(0, (S.replayLim ?? 0) + 1)}`) : null);
      const any = m.raw.some((a) => a.some((x) => x != null));
      empty.hidden = any; empty.textContent = S.status === 'error' ? 'This run stopped before any round finished.' : S.spec ? 'The lines appear as the first rounds complete.' : 'Waiting for the run to start.';
      note.textContent = `${m.M.label}: ${m.M.note} Each point is the running total after that round, so early rounds rest on few people.`;
    }

    /* ---------------------------------------------------------------- small multiples */
    // Two compact cards with one shape: header, a stat per version, then both versions on one small chart
    // with a labelled zero line, so a share of 0% reads as a line on the baseline rather than an empty slot.
    let linesDrawn = false, drawT = 0;
    const miniCard = (title, sub) => {
      const stats = h('div.sg-stats'), chart = h('div.sg-mchart'), foot = h('div.sg-mfoot');
      const card = h('div.card.sg-mini-card', h('div.card-head', h('h3', title), h('span.sub', sub)), stats, chart, foot);
      return { card, stats, chart, foot };
    };
    const vocalCard = miniCard('Vocal vs silent', 'share of deciders who commented or shared');
    const decCard = miniCard('Deciders so far', 'cumulative, against the target audience size');
    minis.append(vocalCard.card, decCard.card);

    function statBlock(v, val, unit, sub) {
      return h('div.sg-stat', h('span.sg-stat-k', h('i', { style: { background: vcolor(v) } }), `${draftName(v)}`),
        h('b.sg-stat-v.mono', val, unit ? h('small', unit) : null), h('small.sg-stat-s', sub));
    }
    /** both versions on one small chart: y from 0 to hi with three labelled gridlines; optional dashed reference */
    function miniChart(host, m, series, hi, fmt, label, ref) {
      const Wm = Math.max(220, Math.floor(host.clientWidth || 320)), Hm = Math.max(96, Math.floor(host.clientHeight || 120));
      const l = 40, r = 12, tp = 10, bt = 22, n = Math.max(2, m.n);
      const sx = (i) => l + (i / (n - 1)) * (Wm - l - r), sy = (v) => Hm - bt - (clamp(v, 0, hi) / hi) * (Hm - tp - bt);
      const svg = s('svg', { class: 'sg-mini', width: Wm, height: Hm, viewBox: `0 0 ${Wm} ${Hm}`, role: 'img', 'aria-label': label });
      [0, hi / 2, hi].forEach((tv, i) => svg.append(
        s('line', { x1: l, x2: Wm - r, y1: sy(tv), y2: sy(tv), stroke: i ? 'var(--line)' : 'var(--line-2)', 'stroke-width': i ? 1 : 1.4 }),
        s('text', { x: l - 8, y: sy(tv) + 3.5, 'text-anchor': 'end', 'font-size': 10.5, fill: 'var(--muted)', 'font-variant-numeric': 'tabular-nums' }, fmt(tv))));
      const step = Math.max(1, Math.ceil(m.n / (Wm < 320 ? 4 : 6)));
      for (let i = 0; i < m.n; i += step) svg.append(s('text', { x: sx(i), y: Hm - 6, 'text-anchor': 'middle', 'font-size': 10, fill: 'var(--faint)' }, `r${i + 1}`));
      if (ref) svg.append(s('line', { x1: l, x2: Wm - r, y1: sy(ref.v), y2: sy(ref.v), stroke: 'var(--muted)', 'stroke-dasharray': '4 4', opacity: .7 }),
        s('text', { x: Wm - r, y: sy(ref.v) - 5, 'text-anchor': 'end', 'font-size': 10, fill: 'var(--muted)' }, ref.label));
      // identical series (e.g. both at zero) would hide one line; draw the first one dashed on top so both read
      const same = series.length === 2 && series[0].vals.every((x, j) => x === series[1].vals[j]);
      (same ? [series[1], series[0]] : series).forEach(({ v, vals }, i) => {
        const pts = vals.map((x, j) => (x == null ? null : [sx(j), sy(x), j])).filter(Boolean);
        if (!pts.length) return;
        const d = pts.map((p, j) => `${j ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
        const col = vcolor(v);
        if (pts.length > 1 && !(same && i === 1)) svg.append(s('path', { d: `${d}L${pts.at(-1)[0]},${sy(0)}L${pts[0][0]},${sy(0)}Z`, fill: col, opacity: .1 }));
        const dash = same && i === 1;
        svg.append(s('path', { class: linesDrawn || dash ? '' : 'sg-draw', d, fill: 'none', stroke: col, 'stroke-width': 2.4, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', pathLength: dash ? null : 1, 'stroke-dasharray': dash ? '6 6' : null }));
        pts.forEach((p, j) => svg.append(s('circle', { cx: p[0], cy: p[1], r: j === pts.length - 1 ? 3.6 : 2.2, fill: col, stroke: 'var(--panel-solid)', 'stroke-width': j === pts.length - 1 ? 1.5 : 0 })));
      });
      mount(host, svg);
    }
    function drawMinis(m) {
      const target = S.spec?.crowdSize || 0;
      const lastOf = (a) => { for (let r = a.length - 1; r >= 0; r--) if (a[r] && a[r].deciders > 0) return a[r]; return null; };
      // vocal vs silent
      const vocal = m.cnt.map((a) => a.map((c) => (c && c.deciders > 0 ? c.vocal / c.deciders : null)));
      const vmax = Math.max(0, ...vocal.flat().filter((x) => x != null));
      const vhi = Math.max(0.1, niceStep((vmax * 1.08) / 2) * 2);
      mount(vocalCard.stats, m.vs.map((v, i) => {
        const c = lastOf(m.cnt[i]);
        return c ? statBlock(v, pct(c.vocal / c.deciders, 0), 'vocal', `${fmtInt(c.vocal)} of ${fmtInt(c.deciders)} spoke up`)
          : statBlock(v, '-', '', 'waiting for deciders');
      }));
      miniChart(vocalCard.chart, m, m.vs.map((v, i) => ({ v, vals: vocal[i] })), vhi, (x) => pct(x, 0), 'Vocal share per round for both drafts');
      const anyDec = vocal.flat().some((x) => x != null);
      vocalCard.foot.textContent = !anyDec ? 'Appears once people start deciding.'
        : vmax === 0 ? 'Nobody has commented or shared yet: every decider so far stayed silent, so both lines sit on 0%.'
          : 'Vocal people are the ones a social listening tool would see; the silent rest still decided.';
      // cumulative deciders
      const dec = m.cnt.map((a) => a.map((c) => (c ? c.deciders : null)));
      const dmax = Math.max(target, ...dec.flat().filter((x) => x != null));
      const dhi = niceStep((Math.max(dmax, 2) * 1.08) / 2, true) * 2;
      mount(decCard.stats, m.vs.map((v, i) => {
        const c = lastOf(m.cnt[i]);
        const num_ = h('span', c ? '' : '0'); num_._cu = lastDec[v] ?? 0;
        if (c) { lastDec[v] = c.deciders; countUp(num_, c.deciders, fmtInt, 600); }
        return statBlock(v, num_, target ? ` / ${fmtInt(target)}` : '', c ? (target ? `${pct(c.deciders / target, 0)} of the audience` : `${fmtInt(c.exposures)} exposures`) : 'waiting for deciders');
      }));
      miniChart(decCard.chart, m, m.vs.map((v, i) => ({ v, vals: dec[i] })), dhi, (x) => fmtInt(Math.round(x)), 'Cumulative deciders per round for both drafts', target ? { v: target, label: `target ${fmtInt(target)}` } : null);
      decCard.foot.textContent = 'Each person decides at most once per exposure; the line flattens when the audience has seen the post.';
      if (m.cnt.flat().some(Boolean) && !linesDrawn && !drawT) drawT = setTimeout(() => { linesDrawn = true; drawT = 0; }, 160);
    }

    /* ---------------------------------------------------------------- refresh */
    function measure() {
      const w = Math.floor(stageBox.clientWidth || el.clientWidth || 640);
      const nw = clamp(w, 260, 1600), nh = clamp(Math.floor(stageBox.clientHeight || (nw < 520 ? 250 : 320)), 200, 900);
      const changed = nw !== W || nh !== H; W = nw; H = nh;
      return changed;
    }
    function refresh({ morph = false, replay = false } = {}) {
      if (disposed) return;
      measure();
      const m = build();
      drawLegend(m); drawMinis(m);
      if (hov != null && hov >= m.n) hov = null;
      if (first || replay) {
        first = false;
        run(650, null, m, 0, 1);
      } else run(morph ? 760 : 420, shown, m, 1, 1);
    }
    const queue = () => { if (!sched) sched = requestAnimationFrame(() => { sched = 0; refresh(); }); };

    /* ---------------------------------------------------------------- live wiring */
    const offs = [
      ctx.bus.on('round', queue), ctx.bus.on('event', queue), ctx.bus.on('snapshot', queue), ctx.bus.on('history', queue),
      ctx.bus.on('seed', () => { linesDrawn = false; refresh({ replay: true }); }),
      ctx.bus.on('replay', (p) => { if (p?.on && p.round === -1) linesDrawn = false; queue(); }),
    ];
    let miniW = 0;
    const ro = new ResizeObserver(() => {
      if (el.offsetParent === null) return;
      if (measure() && curModel) run(0, shown, curModel, 1, 1);
      const mw = vocalCard.chart.clientWidth + 'x' + vocalCard.chart.clientHeight;
      if (mw !== miniW && curModel) { miniW = mw; drawMinis(curModel); }
    });
    ro.observe(stageBox); ro.observe(vocalCard.chart);
    metricBtns[0].classList.add('on'); stageBox.dataset.mode = '2d';
    refresh();

    return {
      show() { measure(); const again = needsReveal; needsReveal = false; refresh({ replay: again }); three?.stage.resize(); },
      hide() { setHover(null); },
      destroy() {
        disposed = true; clearTimeout(drawT); cancelAnimationFrame(raf); cancelAnimationFrame(sched); ro.disconnect(); offs.forEach((o) => o());
        if (three) { three.off?.(); three.dotTex?.dispose(); three.stage.dispose(); }
        three = null; clear(el);
      },
    };
  },
};

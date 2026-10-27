/* signals stage: A vs B over the rounds.
 * - Main chart (SVG, hand-rolled): metric switcher with a morph, draw-in reveal, hover crosshair + tooltip,
 *   event flags, the gap between the lines shaded in the leading version's colour.
 * - 3D ribbons (three.js, lazy): the same data as two orbitable ribbons; falls back to 2D only when WebGL is missing.
 * - Small multiples: vocal vs silent share per round, cumulative deciders.
 * Timeline entries are cumulative snapshots per round: {round, hour_label, exposures, deciders, intent, engaged, vocal, hides, stance_sum, calls}.
 * Styles live in css/verdict.css (prefix sg-). */
import { h, s, mount, clear, pct, num, fmtInt, vcolor, cssVar } from '../../core/dom.js';
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
function niceCeil(x) {
  if (!(x > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(x))), m = x / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
}
/** y domain + five tick values for a metric given every value that exists */
function domainOf(M, vals) {
  const mx = Math.max(0, ...vals), mn = Math.min(0, ...vals);
  let lo = 0, hi = 1;
  if (M.kind === 'rate') hi = Math.min(1, Math.max(0.2, Math.ceil(mx * 10 + 1) / 10));
  else if (M.kind === 'signed') { const m = Math.max(0.2, Math.ceil(Math.max(mx, -mn) * 10) / 10); lo = -m; hi = m; } else hi = niceCeil(mx * 1.05);
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
      h('div.card-head', h('div', h('h2', 'Signals by round'), h('span.sub', 'Same crowd, same schedule; only the post differs.')),
        h('div.sg-tools', h('div.ws-seg.sg-metrics', metricBtns), h('div.ws-seg', btn2d, btn3d))),
      legend, stageBox, note);
    el.append(h('div.sg-wrap', chartCard, minis));

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
      svg.setAttribute('aria-label', `${to.M.label} by round for ${to.vs.map((v, i) => { const last = to.raw[i].findLast?.((x) => x != null); return last == null ? `Version ${v}: no data yet` : `Version ${v}: ${to.M.fmt1(last)}`; }).join(', ')}`);
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
        return h('div.sg-tip-row', h('i', { style: { background: vcolor(v) } }), h('b', `Version ${v}`), h('span.mono', val == null ? 'no data yet' : m.M.fmt1(val)), c && val != null ? h('small', m.M.sub(c)) : null);
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
    const XW = 11, ZW = 1.7, HMAX = 4.2;
    async function ensure3d() {
      if (three !== undefined) return three;
      three = null;
      let stage = null;
      try { stage = await createStage(host3d, { camera: { fov: 40, x: 15, y: 11, z: 17 }, controls: { minDistance: 6, maxDistance: 32 } }); } catch (e) { console.warn('signals 3D unavailable', e); }
      if (!stage || disposed) { stage?.dispose(); return (three = null); }
      const THREE = stage.THREE, scene = stage.scene;
      cs.a = cssVar('--a') || '#5b8cff'; cs.b = cssVar('--b') || '#ff9a4d'; cs.bad = cssVar('--bad') || '#ff5f6d'; cs.muted = cssVar('--muted') || '#9196ab'; cs.line = cssVar('--line-2') || '#444';
      scene.add(new THREE.HemisphereLight(0xffffff, 0x223344, 1.1));
      const dl = new THREE.DirectionalLight(0xffffff, 1.4); dl.position.set(6, 12, 8); scene.add(dl);
      const grid = new THREE.GridHelper(XW + 2, 14, 0x556080, 0x2a3048); grid.material.transparent = true; grid.material.opacity = .45; grid.position.y = -0.01; scene.add(grid);
      const state = { stage, THREE, rib: [], dots: [], evGroup: new THREE.Group(), lblGroup: new THREE.Group(), n: -1, camT: 0, dotTex: dotTexture(THREE) };
      scene.add(state.evGroup, state.lblGroup);
      for (let i = 0; i < 2; i++) {
        const geo = new THREE.BufferGeometry();
        const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(i ? cs.b : cs.a), emissive: new THREE.Color(i ? cs.b : cs.a), emissiveIntensity: .28, roughness: .38, metalness: .15, transparent: true, opacity: .93, side: THREE.DoubleSide });
        const mesh = new THREE.Mesh(geo, mat); mesh.userData.i = i; scene.add(mesh);
        const dot = new THREE.Sprite(new THREE.SpriteMaterial({ map: state.dotTex, color: new THREE.Color(i ? cs.b : cs.a), transparent: true, depthWrite: false }));
        dot.scale.set(.9, .9, .9); dot.visible = false; scene.add(dot);
        state.rib.push(mesh); state.dots.push(dot);
      }
      const zc = (i) => (i === 0 ? -1 : 1) * (ZW / 2 + 0.35);
      function layout(n) {   // (re)build index + z once per round count
        state.n = n;
        state.rib.forEach((mesh, i) => {
          const pos = new Float32Array(Math.max(n, 1) * 4 * 3), idx = [];
          for (let r = 0; r < n; r++) {
            const x = (n > 1 ? r / (n - 1) - 0.5 : 0) * XW, zs = [zc(i) - ZW / 2, zc(i) - ZW / 2, zc(i) + ZW / 2, zc(i) + ZW / 2];
            for (let c = 0; c < 4; c++) { pos[(r * 4 + c) * 3] = x; pos[(r * 4 + c) * 3 + 2] = zs[c]; }
            if (r < n - 1) for (let c = 0; c < 3; c++) { const a = r * 4 + c, b = a + 1, a2 = a + 4, b2 = b + 4; idx.push(a, b, a2, b, b2, a2); }
          }
          mesh.geometry.dispose();
          const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(idx); mesh.geometry = g;
        });
        state.lblGroup.children.slice().forEach((c) => { c.material.map?.dispose(); c.material.dispose(); state.lblGroup.remove(c); });
        const step = Math.max(1, Math.ceil(n / 8));
        for (let r = 0; r < n; r += step) {
          const sp = textSprite(THREE, `r${r + 1}`, cs.muted); sp.position.set((n > 1 ? r / (n - 1) - 0.5 : 0) * XW, 0.05, 3.2); state.lblGroup.add(sp);
        }
      }
      state.apply = (from, to, k, reveal) => {
        if (state.n !== to.n) layout(to.n);
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
          const d = state.dots[i];
          d.visible = lastR >= 0;
          if (lastR >= 0) d.position.set((n > 1 ? lastR / (n - 1) - 0.5 : 0) * XW, lastH + 0.35, zc(i));
        });
        // event planes
        if (state.evKey !== to.events.map((e) => e.id ?? e.round).join(',') + n) {
          state.evKey = to.events.map((e) => e.id ?? e.round).join(',') + n;
          state.evGroup.children.slice().forEach((c) => { c.geometry.dispose(); c.material.dispose(); state.evGroup.remove(c); });
          for (const ev of to.events) {
            const pl = new THREE.Mesh(new THREE.PlaneGeometry(ZW * 2 + .9, HMAX), new THREE.MeshBasicMaterial({ color: new THREE.Color(cs.bad), transparent: true, opacity: .16, side: THREE.DoubleSide, depthWrite: false }));
            pl.rotation.y = Math.PI / 2; pl.position.set((n > 1 ? ev.round / (n - 1) - 0.5 : 0) * XW, HMAX / 2, 0); state.evGroup.add(pl);
          }
        }
      };
      state.off = stage.onFrame((t, dt) => {
        if (state.camT > 0) { state.camT -= dt; stage.camera.position.lerp(state.camTarget, 1 - Math.exp(-dt * 3.2)); }
        if (curModel && reduced() === false) state.dots.forEach((d, i) => d.scale.setScalar(.85 + Math.sin(t * 3 + i) * .08));
      });
      state.camTarget = new THREE.Vector3(8.5, 6.5, 11);
      // hover: nearest round under the pointer
      const canvas = stage.canvas;
      canvas.addEventListener('pointermove', (e) => {
        const hit = stage.pick(e.clientX, e.clientY, state.rib);
        if (!hit || !curModel) { setHover(null); return; }
        const n = curModel.n, r = clamp(Math.round((hit.point.x / XW + 0.5) * (n - 1)), 0, Math.max(0, n - 1));
        hov = r; cross.setAttribute('opacity', 0); fillTip(curModel, r, null);
        const b = canvas.getBoundingClientRect(), sb = stageBox.getBoundingClientRect();
        tip.style.left = `${clamp(e.clientX - sb.left + 14, 6, sb.width - 230)}px`; tip.style.top = `${clamp(e.clientY - sb.top + 10, 6, sb.height - 120)}px`;
        void b;
      });
      canvas.addEventListener('pointerleave', () => setHover(null));
      three = state;
      if (curModel) state.apply(shown, curModel, 1, rv);
      return state;
    }
    function textSprite(THREE, text, color) {
      const c = document.createElement('canvas'); c.width = 128; c.height = 48;
      const g = c.getContext('2d'); g.fillStyle = color; g.font = '600 26px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 64, 24);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false })); sp.scale.set(1.2, .45, 1); return sp;
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
        st.stage.camera.position.set(17, 13, 19); st.camT = 2.2;
        if (reduced()) st.stage.camera.position.copy(st.camTarget);
      }
      mode = m; hov = null; applyHover();
      if (m === '2d') setTimeout(() => { if (mode === '2d' && !disposed) host3d.hidden = true; }, 600); else host3d.hidden = false;
      btn2d.classList.toggle('on', m === '2d'); btn3d.classList.toggle('on', m === '3d');
      stageBox.dataset.mode = m;
      host3d.setAttribute('aria-hidden', m === '3d' ? 'false' : 'true');
      if (curModel) run(900, shown, curModel, 0, 1);
    }

    /* ---------------------------------------------------------------- legend + notes */
    const lastLeg = {}, lastDec = {};
    function drawLegend(m) {
      mount(legend, m.vs.map((v, i) => {
        const val = m.raw[i].findLast?.((x) => x != null), idx = m.raw[i].reduce((a, x, j) => (x != null ? j : a), -1);
        const num_ = h('b.mono', val == null ? '-' : ''); num_._cu = lastLeg[v] ?? 0; if (val != null) { lastLeg[v] = val; if (m.M.kind === 'rate') countUp(num_, val * 100, (x) => `${x.toFixed(1)}%`, 700); else if (m.M.kind === 'signed') countUp(num_, val, m.M.fmt1, 700); else countUp(num_, val, fmtInt, 700); }
        return h('div.sg-leg', h('i', { style: { background: vcolor(v) } }), h('span', `Version ${v}`), num_, idx >= 0 ? h('small', `round ${idx + 1}`) : null);
      }), m.events.length ? h('div.sg-leg', h('i.flag'), h('span', `${m.events.length} injected event${m.events.length > 1 ? 's' : ''}`)) : null,
      S.replay ? h('span.chip.on', `replaying round ${Math.max(0, (S.replayLim ?? 0) + 1)}`) : null);
      const any = m.raw.some((a) => a.some((x) => x != null));
      empty.hidden = any; empty.textContent = S.status === 'error' ? 'This run stopped before any round finished.' : S.spec ? 'The lines appear as the first rounds complete.' : 'Waiting for the run to start.';
      note.textContent = `${m.M.label}: ${m.M.note} Each point is the running total after that round, so early rounds rest on few people.`;
    }

    /* ---------------------------------------------------------------- small multiples */
    let barsDone = {}, linesDrawn = false;
    function drawMinis(m) {
      const target = Math.min(500, S.spec?.crowdSize || 500);
      // vocal vs silent
      const vocalRows = m.vs.map((v, i) => {
        const bars = s('svg', { class: 'sg-mini', viewBox: `0 0 ${Math.max(1, m.n) * 10} 100`, preserveAspectRatio: 'none', role: 'img', 'aria-label': `Vocal share per round, Version ${v}` });
        const done = barsDone[v] ?? 0; let lastC = null;
        m.cnt[i].forEach((c, r) => {
          if (!c || !(c.deciders > 0)) return;
          lastC = c;
          const vs_ = c.vocal / c.deciders;
          const g = s('g', { class: r >= done ? 'sg-bar-new' : '', style: `animation-delay:${Math.min(r - done, 20) * 30}ms` },
            s('rect', { x: r * 10 + 1, y: 0, width: 8, height: 100, fill: 'var(--faint)', opacity: .22, rx: 1.5 }),
            s('rect', { x: r * 10 + 1, y: 100 - vs_ * 100, width: 8, height: vs_ * 100, fill: vcolor(v), rx: 1.5 }, s('title', {}, `${ctx.hourOfRound(r)}: ${pct(vs_, 0)} vocal, ${pct(1 - vs_, 0)} silent (${c.vocal} of ${c.deciders})`)));
          bars.append(g);
        });
        barsDone[v] = m.n;
        const vsL = lastC ? lastC.vocal / lastC.deciders : 0;
        return h('div.sg-mrow', h('div.sg-mhead', h('span.chip.' + v.toLowerCase(), `Version ${v}`), h('small', lastC ? `${pct(vsL, 0)} vocal (commented or shared), ${pct(1 - vsL, 0)} silent` : 'waiting for deciders')),
          bars, h('div.sg-meter', h('i', { style: { width: `${vsL * 100}%`, background: vcolor(v) } })));
      });
      // cumulative deciders
      const maxD = Math.max(target, ...m.cnt.flat().map((c) => c?.deciders || 0));
      const lines = m.vs.map((v, i) => {
        const n = Math.max(2, m.n), sx = (r) => (r / (n - 1)) * 300, sy = (d) => 90 - (d / maxD) * 84;
        const pts = m.cnt[i].map((c, r) => (c ? [sx(r), sy(c.deciders), c] : null)).filter(Boolean);
        const d = pts.map((p, j) => `${j ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
        const last = pts.at(-1)?.[2];
        const num_ = h('b.mono', last ? '' : '0'); num_._cu = lastDec[v] ?? 0; if (last) { lastDec[v] = last.deciders; countUp(num_, last.deciders, fmtInt, 700); }
        return h('div.sg-mrow', h('div.sg-mhead', h('span.chip.' + v.toLowerCase(), `Version ${v}`), h('small', h('b.mono', num_), ` / ${fmtInt(target)} target`)),
          s('svg', { class: 'sg-mini line', viewBox: '0 0 300 96', preserveAspectRatio: 'none', role: 'img', 'aria-label': `Cumulative deciders, Version ${v}` },
            s('line', { x1: 0, x2: 300, y1: sy(target), y2: sy(target), stroke: 'var(--line-2)', 'stroke-dasharray': '4 4', 'vector-effect': 'non-scaling-stroke' }),
            pts.length > 1 ? s('path', { d: `${d}L${pts.at(-1)[0]},90L${pts[0][0]},90Z`, fill: vcolor(v), opacity: .13 }) : null,
            pts.length ? s('path', { class: linesDrawn ? '' : 'sg-draw', d, fill: 'none', stroke: vcolor(v), 'stroke-width': 2.6, 'vector-effect': 'non-scaling-stroke', pathLength: 1 }) : null,
            pts.length ? s('circle', { cx: pts.at(-1)[0], cy: pts.at(-1)[1], r: 3.4, fill: vcolor(v), 'vector-effect': 'non-scaling-stroke' }) : null));
      });
      if (m.cnt.flat().some(Boolean)) linesDrawn = true;
      mount(minis,
        h('div.card.sg-mini-card', h('div.card-head', h('h3', 'Vocal vs silent'), h('span.sub', 'share of deciders who commented or shared, per round')), vocalRows),
        h('div.card.sg-mini-card', h('div.card-head', h('h3', 'Deciders so far'), h('span.sub', 'cumulative; dashed line = target crowd')), lines));
    }

    /* ---------------------------------------------------------------- refresh */
    function measure() {
      const w = Math.floor(stageBox.clientWidth || el.clientWidth || 640);
      const nw = clamp(w, 280, 1400), nh = nw < 520 ? 250 : 320;
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
        run(1100, null, m, 0, 1);
      } else run(morph ? 760 : 420, shown, m, 1, 1);
    }
    const queue = () => { if (!sched) sched = requestAnimationFrame(() => { sched = 0; refresh(); }); };

    /* ---------------------------------------------------------------- live wiring */
    const offs = [
      ctx.bus.on('round', queue), ctx.bus.on('event', queue), ctx.bus.on('snapshot', queue), ctx.bus.on('history', queue),
      ctx.bus.on('seed', () => { barsDone = {}; linesDrawn = false; refresh({ replay: true }); }),
      ctx.bus.on('replay', (p) => { if (p?.on && p.round === -1) { barsDone = {}; linesDrawn = false; } queue(); }),
    ];
    const ro = new ResizeObserver(() => { if (el.offsetParent === null) return; if (measure() && curModel) run(0, shown, curModel, 1, 1); });
    ro.observe(stageBox);
    metricBtns[0].classList.add('on'); stageBox.dataset.mode = '2d';
    refresh();

    return {
      show() { measure(); const again = needsReveal; needsReveal = false; refresh({ replay: again }); three?.stage.resize(); },
      hide() { setHover(null); },
      destroy() {
        disposed = true; cancelAnimationFrame(raf); cancelAnimationFrame(sched); ro.disconnect(); offs.forEach((o) => o());
        if (three) { three.off?.(); three.dotTex?.dispose(); three.stage.dispose(); }
        three = null; clear(el);
      },
    };
  },
};

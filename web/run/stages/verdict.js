/* verdict stage: the answer, how sure we are, and where it holds.
 * Waiting state (no verdict yet): animated "deliberating" visual + live round progress.
 * Verdict: hero (headline, pooled numbers, 3D pillars with CI caps), CI number line, then tabs:
 * segments (diverging bars), seeds + other measures, tipping points, validity + fact check.
 * Data: S.verdict {variants, call, winner, headline, metric, pooled{a,b,moe_a,moe_b,na,nb,diff,ci_half}, per_seed[], seeds_agree,
 * secondary{}, segments[]}, S.tipping, S.validity. A tie is always shown as "Too close to call". Styles: css/verdict.css (prefix vd-). */
import { h, s, mount, clear, pct, num, fmtInt, vcolor, avatar, checkLabel, cssVar } from '../../core/dom.js';
import { roundTime } from '../../core/dom.js';
import { reduced, countUp, riseWords, EASE } from '../../core/motion.js';
import { createStage, dotTexture } from '../../core/three-kit.js';

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const easeOut = (x) => 1 - Math.pow(1 - x, 3);
const metricName = (m) => (m === 'tap_rate' ? 'tap-through' : 'intent to visit');
const segLabel = (key) => {
  const [d, v] = String(key).split(':');
  if (d === 'role') return v === 'core' ? 'Core audience' : 'Spillover';
  if (d === 'customer') return v === 'yes' ? 'Existing customers' : 'Not customers';
  return v;
};
const GROUPS = [['role', 'Audience role'], ['age', 'Age'], ['income', 'Household income'], ['customer', 'Customer status']];
const PHASE_TEXT = { queued: 'Queued', building: 'Getting ready', data: 'Reading the data', audience: 'Choosing the audience', sampling: 'Sampling the crowd', voices: 'Giving people voices', running: 'Simulating both worlds', analyzing: 'Comparing the two worlds', report: 'Writing the report', done: 'Finishing' };
const SECONDARY = [
  ['engagement_rate', 'Engagement rate', 'share of exposures that got a like, comment, share, save or tap', pct, 'rate'],
  ['tap_rate', 'Tap-through rate', 'deciders who tapped through', pct, 'rate'],
  ['mean_stance', 'Mean private stance', '-1 negative to +1 positive', (x) => (x >= 0 ? '+' : '') + num(x), 'signed'],
  ['vocal_share', 'Vocal share', 'deciders who commented or shared (the rest stayed silent)', pct, 'rate'],
  ['silent_negative_share', 'Silent negatives', 'privately negative but said nothing', pct, 'rate'],
  ['hide_rate', 'Hide rate', 'exposures where the person hid the post', pct, 'rate'],
];

/** grow a bar from its origin (WAAPI; instant under reduced motion) */
function grow(el, origin = 'left', delay = 0, ms = 800) {
  if (reduced() || !el) return;
  el.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: ms, delay, easing: EASE.expo, fill: 'backwards' });
  el.style.transformOrigin = `${origin} center`;
}
function fadeIn(el, dx = 0, dy = 14, ms = 520) {
  if (reduced() || !el) return;
  el.animate([{ opacity: 0, transform: `translate(${dx}px, ${dy}px)`, filter: 'blur(4px)' }, { opacity: 1, transform: 'none', filter: 'blur(0)' }], { duration: ms, easing: EASE.expo, fill: 'backwards' });
}

export default {
  id: 'verdict',
  mount(el, ctx) {
    const S = ctx.S;
    el.classList.add('vd');
    const root = h('div.vd-root');
    el.append(root);
    let mode = null, key = null, hero3d = null, ciApi = null, disposed = false, tab = 'segments', segGroup = null, valSel = 0;
    const sigs = {};
    let panel = null, tabsEl = null, tabInk = null, ciRaf = 0, waitEls = null;

    /* ---------------------------------------------------------------- waiting state */
    function buildWait() {
      mode = 'wait'; key = null;
      const phase = h('div.vd-wait-phase'), detail = h('div.vd-wait-detail'), bar = h('i'), prog = h('div.vd-wait-prog', h('div.vd-wait-bar', bar), h('small'));
      waitEls = { phase, detail, bar, label: prog.querySelector('small') };
      mount(root, h('div.card.vd-wait',
        h('div.vd-orbit', { 'aria-hidden': 'true' }, h('i.ring'), h('i.ring.r2'), h('i.dot.a', 'A'), h('i.dot.b', 'B'), h('i.core')),
        h('div.vd-wait-copy', h('span.tag', 'Verdict'), h('h2', 'Deliberating'), phase, detail, prog,
          h('p.expl', 'The verdict appears once both worlds finish. It is computed from every decision, not from a peek at the running totals.'))));
      fadeIn(root.firstChild, 0, 18, 700);
    }
    function updateWait() {
      if (!waitEls) return;
      const err = S.status === 'error';
      waitEls.phase.textContent = err ? 'The run stopped before a verdict was computed.' : (PHASE_TEXT[S.phase] || S.phase || 'Waiting');
      waitEls.detail.textContent = err ? (S.error || '') : (S.detail || '');
      const rounds = S.spec?.rounds || 0;
      const cur = Math.max(-1, ...ctx.worldIds().map((w) => S.counters[w]?.round ?? -1));
      const f = rounds ? clamp((cur + 1) / rounds, 0, 1) : 0;
      waitEls.bar.style.width = `${f * 100}%`;
      waitEls.label.textContent = rounds && cur >= 0 ? `Round ${cur + 1} of ${rounds}` : 'No rounds finished yet';
      root.querySelector('.vd-wait')?.classList.toggle('stopped', err);
    }

    /* ---------------------------------------------------------------- hero */
    function vkey(v) { return JSON.stringify([v.call, v.winner, v.headline, v.pooled]); }
    function buildVerdict(v) {
      destroyHero();
      mode = 'verdict'; key = vkey(v);
      const [va, vb] = v.variants || ['A', 'B'], p = v.pooled, tie = v.call !== 'winner';
      const side = (variant, val, moe, n) => {
        const lead = v.winner === variant && !tie;
        const valEl = h('span.vd-val', '0%'), moeEl = h('small', moe == null ? '' : ` ± ${(moe * 100).toFixed(1)} pts`);
        const card = h('div.vd-side.' + String(variant).toLowerCase() + (lead ? '.lead' : tie ? '.level' : '.trail'),
          h('div.row.spread', h('b', `Version ${variant}`), lead ? h('span.chip.good', 'winner') : null),
          h('div.vd-big', valEl, moeEl),
          h('div.muted', `${fmtInt(n)} simulated people deciding, ${metricName(v.metric)}`));
        countUp(valEl, val, (x) => pct(x), 1300);
        return card;
      };
      const headline = h('h2.vd-headline', v.headline || (tie ? 'Too close to call' : `Version ${v.winner} wins`));
      const explain = tie
        ? 'The interval around the difference includes zero, or the seeds disagree. We do not pick a winner on noise.'
        : `The interval excludes zero and ${v.seeds_agree ?? '?'} of ${(v.per_seed || []).length} seeds agree.`;
      const host = h('div.vd-3d', { 'aria-hidden': 'true' });
      const ciHost = h('div.vd-ci');
      tabsEl = h('div.vd-tabs', { role: 'tablist' }); panel = h('div.vd-panel', { role: 'tabpanel' });
      Object.keys(sigs).forEach((k) => delete sigs[k]);
      mount(root,
        h('div.card.vd-hero' + (tie ? '.tie' : '.win'),
          h('div.vd-hero-copy',
            h('span.vd-badge.' + (tie ? 'tie' : 'win'), tie ? 'Too close to call' : 'We have a winner'),
            headline,
            h('div.vd-pair', side(va, p.a, p.moe_a, p.na), side(vb, p.b, p.moe_b, p.nb)),
            h('p.expl.vd-why', explain)),
          host),
        h('div.card.vd-ci-card', h('div.card-head', h('h3', 'Difference, with its margin of error'), h('span.sub', `Version ${va} minus Version ${vb}; the bar is the 95% interval`)), ciHost),
        h('div.card.vd-sections', tabsEl, panel));
      riseWords(headline, { gap: 40 });
      fadeIn(root.children[1], 0, 20, 700); fadeIn(root.children[2], 0, 24, 800);
      initHero(host, v);
      initCI(ciHost, v);
      renderTabs(v);
    }
    function destroyHero() { cancelAnimationFrame(ciRaf); hero3d?.destroy(); hero3d = null; ciApi?.disconnect(); ciApi = null; }

    /* ---- 3D pillars: height = pooled rate, translucent cap = margin of error */
    function fallbackBars(host, v) {
      const p = v.pooled, [va, vb] = v.variants || ['A', 'B'], tie = v.call !== 'winner';
      const top = Math.max(0.05, (p.a || 0) + (p.moe_a || 0), (p.b || 0) + (p.moe_b || 0));
      const col = (variant, val, moe) => h('div.vd-fb-col' + (v.winner === variant && !tie ? '.lead' : ''),
        h('div.vd-fb-stack', h('i.cap', { style: { bottom: `${((val - (moe || 0)) / top) * 100}%`, height: `${((moe || 0) * 2 / top) * 100}%`, background: vcolor(variant) } }),
          h('i.bar', { style: { height: `${(val / top) * 100}%`, background: vcolor(variant) } })), h('b', variant));
      mount(host, h('div.vd-fb', col(va, p.a || 0, p.moe_a), col(vb, p.b || 0, p.moe_b)));
      host.querySelectorAll('.bar').forEach((b, i) => { if (!reduced()) b.animate([{ transform: 'scaleY(0)' }, { transform: 'none' }], { duration: 1100, delay: 200 + i * 120, easing: EASE.expo, fill: 'backwards' }); b.style.transformOrigin = 'bottom'; });
    }
    async function initHero(host, v) {
      const myKey = key;
      let stage = null;
      try { stage = await createStage(host, { camera: { fov: 38, x: 9, y: 7, z: 14 }, controls: { minDistance: 6, maxDistance: 22 } }); } catch (e) { console.warn('verdict 3D unavailable', e); }
      if (disposed || myKey !== key) { stage?.dispose(); return; }
      if (!stage) { fallbackBars(host, v); return; }
      const THREE = stage.THREE, scene = stage.scene, p = v.pooled, [va, vb] = v.variants || ['A', 'B'], tie = v.call !== 'winner';
      const colA = new THREE.Color(cssVar('--a') || '#5b8cff'), colB = new THREE.Color(cssVar('--b') || '#ff9a4d');
      scene.add(new THREE.HemisphereLight(0xffffff, 0x1a2036, 1.15));
      const dl = new THREE.DirectionalLight(0xffffff, 1.5); dl.position.set(5, 10, 6); scene.add(dl);
      const floor = new THREE.Mesh(new THREE.RingGeometry(2.4, 5.4, 64), new THREE.MeshBasicMaterial({ color: 0x8f7bff, transparent: true, opacity: .12, side: THREE.DoubleSide }));
      floor.rotation.x = -Math.PI / 2; floor.position.y = -0.02; scene.add(floor);
      const grid = new THREE.GridHelper(12, 12, 0x556080, 0x2a3048); grid.material.transparent = true; grid.material.opacity = .35; grid.position.y = -0.03; scene.add(grid);
      const HM = 4, top = Math.max(0.05, (p.a || 0) + (p.moe_a || 0), (p.b || 0) + (p.moe_b || 0));
      const sc = (x) => (x / top) * HM;
      const dotTex = dotTexture(THREE);
      const mk = (variant, val, moe, x, col) => {
        const lead = v.winner === variant && !tie;
        const mat = new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: lead ? .5 : tie ? .28 : .1, roughness: .35, metalness: .2, transparent: true, opacity: lead || tie ? 1 : .72 });
        const pillar = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 56), mat); pillar.position.x = x; scene.add(pillar);
        const capH = Math.max(0.04, sc(2 * (moe || 0)));
        const cap = new THREE.Mesh(new THREE.CylinderGeometry(1.18, 1.18, capH, 56), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: .26, depthWrite: false }));
        cap.position.set(x, sc(val), 0); cap.scale.y = 0; scene.add(cap);
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(cap.geometry), new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: .8 })); cap.add(edges);
        const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTex, color: col, transparent: true, opacity: lead ? .55 : 0, depthWrite: false, blending: THREE.AdditiveBlending }));
        halo.scale.set(5, 5, 1); halo.position.set(x, .2, 0); scene.add(halo);
        const lbl = label(THREE, variant, col); lbl.position.set(x, -.55, 1.6); scene.add(lbl);
        return { pillar, cap, halo, val, lead, mat };
      };
      const A = mk(va, p.a || 0, p.moe_a, -2, colA), B = mk(vb, p.b || 0, p.moe_b, 2, colB);
      const camTo = new THREE.Vector3(5.6, 4.2, 8.6), camFrom = new THREE.Vector3(11, 8, 15);
      let userMoved = false; stage.controls?.addEventListener('start', () => { userMoved = true; });
      if (reduced()) stage.camera.position.copy(camTo);
      const off = stage.onFrame((t) => {
        const g = reduced() ? 1 : easeOut(clamp(t / 1.4, 0, 1)), g2 = reduced() ? 1 : easeOut(clamp((t - .9) / .9, 0, 1));
        for (const o of [A, B]) {
          const hh = Math.max(0.02, sc(o.val) * g);
          o.pillar.scale.set(1, hh, 1); o.pillar.position.y = hh / 2;
          o.cap.scale.y = g2; o.cap.position.y = sc(o.val) * g;
          if (o.lead) { const pulse = .5 + Math.sin(t * 2.2) * .12; o.halo.material.opacity = pulse * g2; o.mat.emissiveIntensity = .45 + Math.sin(t * 2.2) * .12; }
        }
        if (!userMoved && !reduced()) { const k = easeOut(clamp(t / 2.2, 0, 1)); stage.camera.position.lerpVectors(camFrom, camTo, k); }
        if (!userMoved && !tie && !reduced() && t > 2.4) stage.camera.position.applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.sin(t * .35) * .0009);
      });
      hero3d = { destroy() { off(); dotTex.dispose(); stage.dispose(); } };
    }
    function label(THREE, text, col) {
      const c = document.createElement('canvas'); c.width = c.height = 128;
      const g = c.getContext('2d'); g.fillStyle = `#${col.getHexString()}`; g.font = '700 84px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 64, 68);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false })); sp.scale.set(1.1, 1.1, 1); return sp;
    }

    /* ---------------------------------------------------------------- CI number line */
    function initCI(host, v) {
      const p = v.pooled, [va, vb] = v.variants || ['A', 'B'];
      const diff = p.diff ?? ((p.a || 0) - (p.b || 0)), half = p.ci_half ?? 0;
      const maxD = Math.max(0.15, Math.abs(diff) + half) * 1.1, lo = diff - half, hi = diff + half;
      const includesZero = lo <= 0 && hi >= 0;
      const H = 120, ml = 20, mr = 20;
      const svg = s('svg', { class: 'vd-ci-svg', role: 'img', 'aria-label': `Difference ${va} minus ${vb}: ${(diff * 100).toFixed(1)} points, interval ${(lo * 100).toFixed(1)} to ${(hi * 100).toFixed(1)}${includesZero ? ', includes zero' : ', excludes zero'}` });
      const note = h('div.vd-ci-note', h('b', `Difference ${va} - ${vb}: ${diff >= 0 ? '+' : ''}${(diff * 100).toFixed(1)} pts`), h('span', ` ± ${(half * 100).toFixed(1)} (interval ${(lo * 100).toFixed(1)} to ${(hi * 100).toFixed(1)})`),
        h('span.chip.' + (includesZero ? 'warn' : 'good'), includesZero ? 'interval includes zero' : 'interval excludes zero'));
      mount(host, svg, note);
      let W = 640;
      const draw = (k) => {
        const X = (x) => ml + ((x + maxD) / (2 * maxD)) * (W - ml - mr), ax = H - 40, cy = 52;
        clear(svg); svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('width', W); svg.setAttribute('height', H);
        const x0 = X(0), px = X(diff), cl = px + (X(lo) - px) * k, ch = px + (X(hi) - px) * k;
        svg.append(
          s('rect', { x: ml, y: 18, width: x0 - ml, height: ax - 18, fill: vcolor(vb), opacity: .07, rx: 8 }), s('rect', { x: x0, y: 18, width: W - mr - x0, height: ax - 18, fill: vcolor(va), opacity: .07, rx: 8 }),
          s('text', { x: ml + 8, y: 34, 'font-size': 11, fill: vcolor(vb), 'font-weight': 600 }, `${vb} ahead`), s('text', { x: W - mr - 8, y: 34, 'font-size': 11, 'text-anchor': 'end', fill: vcolor(va), 'font-weight': 600 }, `${va} ahead`),
          s('line', { x1: ml, x2: W - mr, y1: ax, y2: ax, stroke: 'var(--line-2)' }),
          s('line', { x1: x0, x2: x0, y1: 20, y2: ax + 6, stroke: 'var(--text)', 'stroke-width': 1.5, opacity: .8 }),
          s('text', { x: x0, y: ax + 22, 'text-anchor': 'middle', 'font-size': 11, fill: 'var(--text)', 'font-weight': 600 }, '0 (no difference)'),
          s('text', { x: ml, y: ax + 22, 'font-size': 10.5, fill: 'var(--faint)' }, `${(-maxD * 100).toFixed(0)} pts`), s('text', { x: W - mr, y: ax + 22, 'text-anchor': 'end', 'font-size': 10.5, fill: 'var(--faint)' }, `+${(maxD * 100).toFixed(0)} pts`),
          s('rect', { x: Math.min(cl, ch), y: cy - 9, width: Math.abs(ch - cl), height: 18, rx: 9, fill: includesZero ? 'var(--warn)' : 'var(--good)', opacity: .28 }),
          s('rect', { x: Math.min(cl, ch), y: cy - 9, width: Math.abs(ch - cl), height: 18, rx: 9, fill: 'none', stroke: includesZero ? 'var(--warn)' : 'var(--good)', 'stroke-width': 1.5 }),
          s('circle', { cx: px, cy, r: 8 * Math.min(1, k * 2), fill: 'var(--text)', stroke: 'var(--panel-solid)', 'stroke-width': 3 }));
      };
      const measure = () => { W = clamp(Math.floor(host.clientWidth || 640), 280, 1200); };
      measure();
      let k = reduced() ? 1 : 0, started = false;
      const play = () => {
        if (started) return; started = true;
        if (reduced()) { draw(1); return; }
        const t0 = performance.now() + 500;
        const tick = (t) => { if (disposed) return; k = easeOut(clamp((t - t0) / 1200, 0, 1)); draw(k); if (k < 1) ciRaf = requestAnimationFrame(tick); };
        ciRaf = requestAnimationFrame(tick);
      };
      draw(k); play();
      const ro = new ResizeObserver(() => { if (host.offsetParent === null) return; const w = W; measure(); if (w !== W) draw(k); });
      ro.observe(host);
      ciApi = ro;
    }

    /* ---------------------------------------------------------------- tabs */
    const TABS = [['segments', 'By segment'], ['seeds', 'Seeds and measures'], ['tipping', 'Tipping points'], ['validity', 'Validity and fact check']];
    function renderTabs(v) {
      tabInk = h('span.vd-tab-ink', { 'aria-hidden': 'true' });
      mount(tabsEl, tabInk, TABS.map(([id, label], i) => h('button.vd-tab' + (id === tab ? '.on' : ''), {
        type: 'button', role: 'tab', 'aria-selected': id === tab ? 'true' : 'false', 'data-tab': id,
        onclick: () => switchTab(id), onkeydown: (e) => {
          if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
          const nx = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length][0]; switchTab(nx); tabsEl.querySelector(`[data-tab="${nx}"]`)?.focus(); e.preventDefault();
        },
      }, label)));
      requestAnimationFrame(moveInk);
      renderPanel(v, 0);
    }
    function moveInk() {
      const on = tabsEl?.querySelector('.vd-tab.on'); if (!on || !tabInk) return;
      tabInk.style.width = `${on.offsetWidth}px`; tabInk.style.transform = `translateX(${on.offsetLeft}px)`;
    }
    function switchTab(id) {
      if (id === tab) return;
      const dir = TABS.findIndex((t) => t[0] === id) > TABS.findIndex((t) => t[0] === tab) ? 1 : -1;
      tab = id;
      tabsEl.querySelectorAll('.vd-tab').forEach((b) => { const on = b.dataset.tab === id; b.classList.toggle('on', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); });
      moveInk();
      if (S.verdict) renderPanel(S.verdict, dir, true);
    }
    function renderPanel(v, dir = 0, force = false) {
      const builders = { segments: segmentsPanel, seeds: seedsPanel, tipping: tippingPanel, validity: validityPanel };
      const sig = JSON.stringify([tab, tab === 'segments' ? v.segments : tab === 'seeds' ? [v.per_seed, v.secondary] : tab === 'tipping' ? S.tipping : S.validity]);
      if (!force && sigs[tab] === sig) return;
      sigs[tab] = sig;
      const body = builders[tab](v);
      mount(panel, body);
      fadeIn(panel, dir * 18, dir ? 0 : 10, 480);
    }

    /* ---- segments: diverging bars (A left, B right), grouped by dimension */
    function segmentsPanel(v) {
      const [va, vb] = v.variants || ['A', 'B'];
      const groups = GROUPS.map(([g, label]) => [g, label, (v.segments || []).filter((x) => String(x.key).startsWith(g + ':'))]).filter((x) => x[2].length);
      if (!groups.length) return h('div.empty', 'No segment breakdown for this run.');
      if (!groups.some((g) => g[0] === segGroup)) segGroup = groups[0][0];
      const list = h('div.vd-segs');
      const gtabs = h('div.ws-seg.vd-gtabs', groups.map(([g, label, rows]) => h('button' + (g === segGroup ? '.on' : ''), { type: 'button', onclick: () => { segGroup = g; renderPanel(S.verdict, 0, true); } }, label, h('small', ` ${rows.length}`))));
      const rows = groups.find((g) => g[0] === segGroup)[2];
      const scale = Math.max(0.2, ...rows.map((x) => Math.max(x.a || 0, x.b || 0)));
      rows.forEach((x, i) => {
        const gap = (x.a - x.b) * 100;
        const small = Math.min(x.na ?? 0, x.nb ?? 0) < 20;
        const detail = h('div.vd-seg-detail', h('div.vd-seg-detail-in',
          h('div.vd-kv', h('span', `Version ${va}`), h('b', `${pct(x.a, 1)} of ${fmtInt(x.na)} people`)),
          h('div.vd-kv', h('span', `Version ${vb}`), h('b', `${pct(x.b, 1)} of ${fmtInt(x.nb)} people`)),
          h('div.vd-kv', h('span', 'Gap'), h('b', `${gap >= 0 ? '+' : ''}${gap.toFixed(1)} pts (${va} - ${vb})`)),
          h('div.vd-kv', h('span', 'Prefers'), h('b', x.prefers ? `Version ${x.prefers}` : 'tie')),
          h('p.expl', x.clear ? 'Clear: the gap is beyond the noise and each side has at least 20 people.' : `Not clear: a clear call needs a gap beyond the noise and at least 20 people on each side${small ? `. Here the smaller side has ${Math.min(x.na ?? 0, x.nb ?? 0)}.` : '.'}`)));
        const l = h('i', { style: { width: `${((x.a || 0) / scale) * 100}%`, background: vcolor(va) } }), r = h('i', { style: { width: `${((x.b || 0) / scale) * 100}%`, background: vcolor(vb) } });
        const row = h('div.vd-seg' + (x.clear ? '.clear' : ''),
          h('button.vd-seg-row', { type: 'button', 'aria-expanded': 'false', onclick: (e) => { const open = row.classList.toggle('open'); e.currentTarget.setAttribute('aria-expanded', String(open)); } },
            h('span.vd-seg-name', segLabel(x.key), x.clear ? h('span.chip.good', 'clear') : null),
            h('span.vd-seg-a.mono', pct(x.a, 0)),
            h('span.vd-seg-bars', h('span.l', l), h('span.r', r)),
            h('span.vd-seg-b.mono', pct(x.b, 0)),
            h('span.vd-seg-pref', x.prefers ? h('span.chip.' + String(x.prefers).toLowerCase(), x.prefers) : h('span.muted', 'tie'))),
          detail);
        list.append(row);
        grow(l, 'right', 80 + i * 55); grow(r, 'left', 80 + i * 55);
      });
      return h('div.vd-seg-wrap',
        h('div.vd-seg-head', gtabs, h('span.sub', `${metricName(v.metric)}; "clear" needs a gap beyond the noise and at least 20 people each side. Click a row for details.`)),
        h('div.vd-seg-legend', h('span', h('i', { style: { background: vcolor(va) } }), `Version ${va}`), h('span', h('i', { style: { background: vcolor(vb) } }), `Version ${vb}`)),
        list);
    }

    /* ---- seeds (cards) + other measures (paired mini bars) */
    function seedsPanel(v) {
      const [va, vb] = v.variants || ['A', 'B'], tie = v.call !== 'winner', seeds = v.per_seed || [];
      const sec = v.secondary || {};
      const cards = seeds.map((x, i) => {
        const agrees = tie ? null : x.leader === v.winner;
        const c = h('div.vd-seedcard' + (agrees === true ? '.yes' : agrees === false ? '.no' : ''),
          h('div.row.spread', h('b', `Seed ${x.seed}`), h('span.vd-mark', { title: agrees === true ? 'Agrees with the overall result' : agrees === false ? 'Does not agree with the overall result' : 'No overall winner to agree with' }, agrees === true ? '✓' : agrees === false ? '✗' : '–')),
          h('div.vd-seed-nums', h('span', h('i', { style: { background: vcolor(va) } }), va, h('b.mono', pct(x.a))), h('span', h('i', { style: { background: vcolor(vb) } }), vb, h('b.mono', pct(x.b)))),
          h('div.row.spread', h('small.muted', `n ${fmtInt(x.na)} / ${fmtInt(x.nb)}`), x.leader === 'tie' || !x.leader ? h('span.muted', 'tie') : h('span.chip.' + String(x.leader).toLowerCase(), `${x.leader} leads`)));
        fadeIn(c, 0, 14, 520 + i * 70);
        return c;
      });
      const rows = SECONDARY.filter((r) => sec[r[0]]).map(([k, label, expl, f, kind], i) => {
        const a = sec[k].a ?? 0, b = sec[k].b ?? 0;
        const mx = kind === 'signed' ? 1 : Math.max(a, b, 0.001) * 1.15;
        const bar = (val, variant) => {
          const i_ = h('i', { style: kind === 'signed'
            ? { left: val >= 0 ? '50%' : `${50 + (val / mx) * 50}%`, width: `${(Math.abs(val) / mx) * 50}%`, background: vcolor(variant) }
            : { width: `${(val / mx) * 100}%`, background: vcolor(variant) } });
          grow(i_, kind === 'signed' ? (val >= 0 ? 'left' : 'right') : 'left', 120 + i * 70);
          return h('div.vd-pbar' + (kind === 'signed' ? '.signed' : ''), i_);
        };
        return h('div.vd-measure', h('div.vd-m-head', h('b', label), h('span.expl', expl)),
          h('div.vd-m-row', h('span.mono', va), bar(a, va), h('span.mono.vd-m-val', f(a))),
          h('div.vd-m-row', h('span.mono', vb), bar(b, vb), h('span.mono.vd-m-val', f(b))));
      });
      return h('div.vd-seeds',
        h('div.vd-sub', h('h3', 'Per seed'), h('span.sub', seeds.length ? (tie ? 'No overall winner; each seed is shown on its own.' : `${v.seeds_agree ?? '?'} of ${seeds.length} seeds agree with the overall result`) : 'No per-seed results.')),
        seeds.length ? h('div.vd-seedgrid', cards) : null,
        h('div.vd-sub', { style: { marginTop: '22px' } }, h('h3', 'Other measures'), h('span.sub', `${va} vs ${vb}; bars share one scale per measure and start at zero`)),
        rows.length ? h('div.vd-measures', rows) : h('div.empty', 'No secondary measures for this run.'));
    }

    /* ---- tipping points */
    function tippingPanel() {
      const tp = S.tipping;
      if (!tp || !Object.keys(tp).length) return h('div.empty', 'Tipping points appear once the run finishes and a share cascade can be traced.');
      return h('div.vd-tip-grid', Object.entries(tp).map(([wid, t], i) => {
        const variant = String(wid).split(':').pop();
        const c = h('div.vd-tipcard',
          h('div.card-head', h('h3', 'Tipping point'), h('span.chip.' + variant.toLowerCase(), `Version ${variant}`)),
          h('div.sub', `${wid}: the share that reached the most people`),
          t && t.record ? h('div', { style: { marginTop: '12px' } },
            h('div.row', avatar(t.record.agent_id), h('div', h('b', t.record.agent_id), h('div.muted', `shared at ${roundTime(t.record.hour)}`))),
            h('div.said.vd-quote', t.record.text ? `"${t.record.text}"` : '(shared without a caption)'),
            h('div.chips', h('span.chip.' + (t.reached > 0 ? 'good' : ''), `reached ${fmtInt(t.reached)} people`), h('span.chip.mono', t.record.id)))
            : h('div.muted', { style: { marginTop: '12px' } }, 'Nobody shared the post in this world, so there was no cascade.'));
        fadeIn(c, 0, 16, 520 + i * 90);
        return c;
      }));
    }

    /* ---- validity gauges + fact check */
    function ring(frac, label) {
      const r = 26, c = 2 * Math.PI * r, f = frac == null ? 0 : clamp(frac, 0, 1);
      const arc = s('circle', { cx: 32, cy: 32, r, fill: 'none', stroke: 'var(--accent)', 'stroke-width': 6, 'stroke-linecap': 'round', 'stroke-dasharray': c, 'stroke-dashoffset': c * (1 - f), transform: 'rotate(-90 32 32)' });
      if (!reduced() && frac != null) arc.animate([{ strokeDashoffset: c }, { strokeDashoffset: c * (1 - f) }], { duration: 1100, easing: EASE.expo, fill: 'backwards', delay: 120 });
      return s('svg', { viewBox: '0 0 64 64', class: 'vd-ring', 'aria-hidden': 'true' }, s('circle', { cx: 32, cy: 32, r, fill: 'none', stroke: 'var(--line-2)', 'stroke-width': 6 }), frac != null ? arc : null,
        s('text', { x: 32, y: 36, 'text-anchor': 'middle', 'font-size': 13, 'font-weight': 700, fill: 'var(--text)' }, label));
    }
    function validityPanel() {
      const val = S.validity;
      if (!val) return h('div.empty', 'Validity checks are computed when the run finishes.');
      const guard = val.guard;
      const items = [
        { k: 'Repaired share', v: pct(val.repaired_share), f: val.repaired_share, ex: 'Model answers that broke the schema and had to be repaired. Lower is better.' },
        { k: 'Distinct reason ratio', v: num(val.distinct_reason_ratio, 2), f: val.distinct_reason_ratio, ex: 'Unique private reasons out of all reasons. Near 1 means people are not repeating one script.' },
        { k: 'Scroll-past share', v: pct(val.scroll_past_share, 0), f: val.scroll_past_share, ex: 'Decisions that were a scroll-past. Real feeds are mostly scroll-past, so a realistic run is high.' },
        { k: 'Stance spread (sd)', v: (val.stance_sd_by_world || []).map((x) => num(x.sd)).join(' / ') || '-', f: null, ex: `Standard deviation of private stance in each world${(val.stance_sd_by_world || []).length ? ` (${val.stance_sd_by_world.map((x) => `${x.world}: ${num(x.sd)}`).join(', ')})` : ''}. Near zero means everyone thinks alike.` },
        { k: 'Top reason opener', v: val.top_reason_opener ? pct(val.top_reason_opener.share) : 'none', f: val.top_reason_opener ? val.top_reason_opener.share : null, ex: val.top_reason_opener ? `Most common first three words of a reason: "${val.top_reason_opener.text}" (${pct(val.top_reason_opener.share)}). A big share flags templated answers.` : 'Most common first three words of a reason. A big share flags templated answers. None stood out.' },
        { k: 'Silenced reactions', v: fmtInt(val.silenced), f: null, ex: 'Times someone wanted to say something and kept it to themselves (the speak gate).' },
        { k: 'Decisions', v: fmtInt(val.decisions), f: null, ex: 'Total decisions logged across all twin worlds.' },
      ];
      if (guard) items.push({ k: 'Decisions with a check', v: pct(val.decisions ? guard.decisions_with_a_check / val.decisions : 0, 0), f: val.decisions ? guard.decisions_with_a_check / val.decisions : 0, ex: `${fmtInt(guard.decisions_with_a_check)} of ${fmtInt(val.decisions)} decisions had a fact check fire before anything was logged or quoted.` });
      valSel = Math.min(valSel, items.length - 1);
      const exEl = h('div.vd-gauge-ex');
      const showEx = (i) => { valSel = i; gauges.forEach((g, j) => g.classList.toggle('on', i === j)); mount(exEl, h('b', items[i].k), h('p.expl', items[i].ex)); fadeIn(exEl, 0, 6, 300); };
      const gauges = items.map((it, i) => h('button.vd-gauge' + (i === valSel ? '.on' : ''), { type: 'button', title: it.ex, onclick: () => showEx(i), onfocus: () => {} },
        it.f != null ? ring(it.f, it.v.length > 5 ? '' : it.v) : h('div.vd-gauge-num.mono', it.v), h('span.vd-gauge-k', it.k)));
      showEx(valSel);
      gauges.forEach((g, i) => fadeIn(g, 0, 12, 480 + i * 55));
      const checks = guard ? Object.entries(guard.by_check || {}).sort((a, b) => b[1] - a[1]) : [];
      return h('div.vd-valid',
        h('div.vd-sub', h('h3', 'Validity'), h('span.sub', 'did the crowd behave like a crowd? Click a gauge for what it means.')),
        h('div.vd-gauges', gauges), exEl,
        guard ? h('div.vd-guard',
          h('div.vd-sub', h('h3', 'Fact check'), h('span.sub', `${pct(val.decisions ? guard.decisions_with_a_check / val.decisions : 0)} of decisions had a check fire (${fmtInt(guard.decisions_with_a_check)} of ${fmtInt(val.decisions)})`)),
          h('p.expl', 'Before anything is logged or quoted, a guard withholds invented prices, details from the other version, false “seen it before” claims and identity tropes, and resolves likes that contradict a negative feeling.'),
          checks.length ? h('div.vd-checks', checks.map(([k, c], i) => { const mx = checks[0][1] || 1; const bar = h('i', { style: { width: `${(c / mx) * 100}%` } }); grow(bar, 'left', 100 + i * 50); return h('div.vd-check', { title: k }, h('span', checkLabel(k)), h('div.vd-pbar', bar), h('b.mono', fmtInt(c))); })) : h('div.muted', 'No check fired in this run.')) : null);
    }

    /* ---------------------------------------------------------------- render + wiring */
    function render() {
      if (disposed) return;
      const v = S.verdict;
      if (!v || !v.pooled) {
        if (mode !== 'wait') { destroyHero(); buildWait(); }
        updateWait(); return;
      }
      if (mode !== 'verdict' || key !== vkey(v)) buildVerdict(v);
      else renderPanel(v);   // validity / tipping may arrive after the verdict itself
    }
    const offs = [
      ctx.bus.on('verdict', render), ctx.bus.on('snapshot', render), ctx.bus.on('done', render),
      ctx.bus.on('status', updateWait), ctx.bus.on('round', () => { if (mode === 'wait') updateWait(); }), ctx.bus.on('error', render),
    ];
    const onResize = () => moveInk();
    window.addEventListener('resize', onResize);
    render();

    return {
      show() { render(); requestAnimationFrame(moveInk); },
      hide() {},
      destroy() {
        disposed = true; offs.forEach((o) => o()); window.removeEventListener('resize', onResize);
        destroyHero(); clear(el);
      },
    };
  },
};

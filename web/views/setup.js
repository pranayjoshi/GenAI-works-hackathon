/* New test: a five-step wizard (business, drafts, audience, run settings, launch) under a compact "twin worlds" hero.
 * Ported from legacy/app.js section 5. API shapes: GET /api/demo, POST /api/audience, POST /api/runs (see src/api.ts).
 * State lives at module level so it survives navigation. 3D is created in mount and disposed in the returned cleanup. */
import { h, s, mount, spin, fmtInt, sleepMs, AGE_BANDS, cssVar } from '../core/dom.js';
import { api, fail } from '../core/api.js';
import { toast, qidChip } from '../core/ui.js';
import { reduced, EASE, riseWords, stagger, tilt, magnetic, countUp } from '../core/motion.js';
import { createStage, dotTexture } from '../core/three-kit.js';

const setupState = {
  business: '', handle: '', place: '', zip: '', goal: '', postA: '', postB: '',
  crowdSize: 60, rounds: 12, seeds: 2, useCustomers: true,
  audience: null, coreBands: null, coreShare: null, coreShareTouched: false,
  step: 0,
};

/* ---------- audience maths (ported unchanged from legacy) ---------- */
const PEW = { '18-29': [18, 29], '30-49': [30, 49], '50-64': [50, 64], '65+': [65, 90] };
const PER = { '18-24': [18, 24], '25-34': [25, 34], '35-44': [35, 44], '45-54': [45, 54], '55-64': [55, 64], '65+': [65, 90] };
const overlap = (a, b) => Math.max(0, Math.min(a[1], b[1]) - Math.max(a[0], b[0]) + 1);
function estimateCoreShare(join, bands) {
  // Overlap Pew age bands with persona bands by years of age, weighted by Instagram users.
  let core = 0, total = 0;
  for (const row of join || []) {
    const pr = PEW[row.band]; if (!pr) continue;
    const users = Number(row.instagram_users) || 0;
    total += users;
    for (const b of bands) { const br = PER[b]; if (br) core += users * overlap(pr, br) / (pr[1] - pr[0] + 1); }
  }
  return total ? core / total : null;
}

const STEPS = [
  { key: 'business', label: 'Your business', hint: 'Who is posting' },
  { key: 'drafts', label: 'Two drafts', hint: 'Version A and B' },
  { key: 'audience', label: 'Audience', hint: 'Optional' },
  { key: 'settings', label: 'Run settings', hint: 'Crowd and length' },
  { key: 'launch', label: 'Launch', hint: 'Fold into worlds' },
];
const FIELD_STEP = { business: 0, handle: 0, place: 0, zip: 0, goal: 0, postA: 1, postB: 1 };
const REQUIRED = ['business', 'zip', 'postA', 'postB'];
const CROWDS = [[24, 'smoke test'], [60, 'quick'], [120, 'fuller'], [300, 'large'], [600, 'full']];
const ROUNDS = [[6, 'smoke test'], [12, 'standard'], [24, 'one day, hourly']];

const prefersLight = () => { const t = document.documentElement.dataset.theme; return t ? t === 'light' : matchMedia('(prefers-color-scheme: light)').matches; };

/* ============================================================ hero: twin worlds */
function mountHero(host) {
  let dead = false, stage = null, stop2D = null;
  const N = 520;
  const seedParts = Array.from({ length: N }, () => ({ u: Math.random(), sp: 0.05 + Math.random() * 0.1, dir: Math.random() < 0.5 ? 1 : -1, o: [Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5], w: Math.random() * 6.28 }));
  const mouse = { x: 0, y: 0, in: false };
  const onMove = (e) => { const r = host.getBoundingClientRect(); mouse.x = ((e.clientX - r.left) / r.width - 0.5) * 2; mouse.y = ((e.clientY - r.top) / r.height - 0.5) * 2; mouse.in = true; };
  const onLeave = () => { mouse.in = false; };
  host.addEventListener('pointermove', onMove); host.addEventListener('pointerleave', onLeave);

  createStage(host, { camera: { fov: 40, z: 9.5 } }).then((st) => {
    if (dead) { st?.dispose(); return; }
    if (!st) { stop2D = twin2D(host, seedParts, mouse); return; }
    stage = st;
    const { THREE, scene } = st, light = prefersLight();
    const cA = new THREE.Color(cssVar('--a') || '#5b8cff'), cB = new THREE.Color(cssVar('--b') || '#ff9a4d');
    const group = new THREE.Group(); scene.add(group);
    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(3, 4, 6); scene.add(key);
    const glow = dotTexture(THREE);
    const mk = (c) => {
      const orb = new THREE.Mesh(new THREE.SphereGeometry(0.85, 40, 28), new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.35, roughness: 0.45, metalness: 0.1 }));
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: c, transparent: true, opacity: light ? 0.35 : 0.6, depthWrite: false, blending: light ? THREE.NormalBlending : THREE.AdditiveBlending }));
      halo.scale.setScalar(4.2); orb.add(halo); group.add(orb); return orb;
    };
    const orbA = mk(cA), orbB = mk(cB);
    const ring = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 96 }, (_, i) => new THREE.Vector3(Math.cos(i / 96 * 6.2832) * 2.7, 0, Math.sin(i / 96 * 6.2832) * 2.7))),
      new THREE.LineBasicMaterial({ color: light ? 0x8890aa : 0xffffff, transparent: true, opacity: 0.12 }));
    group.add(ring);
    const pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.17, map: glow, vertexColors: true, transparent: true, opacity: light ? 0.8 : 0.9, depthWrite: false, blending: light ? THREE.NormalBlending : THREE.AdditiveBlending, sizeAttenuation: true }));
    pts.frustumCulled = false; group.add(pts);
    const tmp = new THREE.Color(), still = reduced();
    let ang = 0, tx = 0, ty = 0;
    st.onFrame((t, dt) => {
      const boost = !still && mouse.in ? 1.8 : 1;
      if (!still) ang += dt * 0.45 * boost;
      const R = 2.7;
      orbA.position.set(Math.cos(ang) * R, Math.sin(ang * 0.7) * 0.35, Math.sin(ang) * R);
      orbB.position.set(-orbA.position.x, -orbA.position.y, -orbA.position.z);
      orbA.rotation.y = orbB.rotation.y = ang * 2;
      tx += ((still ? 0 : mouse.y * 0.35) + 0.25 - tx) * 0.06; ty += ((still ? 0 : mouse.x * 0.5) - ty) * 0.06;
      group.rotation.x = tx; group.rotation.y = ty;
      const wx = mouse.x * 7, wy = -mouse.y * 2.8; // pointer in roughly world units at z=0
      for (let i = 0; i < N; i++) {
        const p = seedParts[i];
        if (!still) p.u = (p.u + dt * p.sp) % 1;
        const u = p.dir > 0 ? p.u : 1 - p.u;
        const e = u * u * (3 - 2 * u);
        const sw = Math.sin(p.u * Math.PI);
        let x = orbA.position.x + (orbB.position.x - orbA.position.x) * e + p.o[0] * 0.9 * sw;
        let y = orbA.position.y + (orbB.position.y - orbA.position.y) * e + p.o[1] * 0.9 * sw + Math.sin(p.u * 6.28 + p.w + (still ? 0 : t)) * 0.18 * sw;
        const z = orbA.position.z + (orbB.position.z - orbA.position.z) * e + p.o[2] * 0.9 * sw;
        if (!still && mouse.in) { const dx = x - wx, dy = y - wy, d = Math.hypot(dx, dy); if (d < 2) { const k = (1 - d / 2) * 0.7 / (d || 1); x += dx * k; y += dy * k; } }
        pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
        tmp.copy(cA).lerp(cB, u); col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b;
      }
      geo.attributes.position.needsUpdate = true; geo.attributes.color.needsUpdate = true;
    });
    host.classList.add('ready');
  }).catch(() => { if (!dead) stop2D = twin2D(host, seedParts, mouse); });

  return () => { dead = true; host.removeEventListener('pointermove', onMove); host.removeEventListener('pointerleave', onLeave); stop2D?.(); stage?.dispose(); };
}

/** 2D canvas version of the same picture, used when WebGL is missing. */
function twin2D(host, parts, mouse) {
  const cv = h('canvas'); cv.style.cssText = 'display:block;width:100%;height:100%'; host.append(cv);
  const g = cv.getContext('2d'), still = reduced();
  const cA = cssVar('--a') || '#5b8cff', cB = cssVar('--b') || '#ff9a4d';
  let W = 1, H = 1, raf = 0, ang = 0, last = performance.now();
  const size = () => { const d = Math.min(2, devicePixelRatio || 1); W = host.clientWidth || 1; H = host.clientHeight || 1; cv.width = W * d; cv.height = H * d; g.setTransform(d, 0, 0, d, 0, 0); };
  const ro = new ResizeObserver(size); ro.observe(host); size();
  const frame = (now) => {
    raf = requestAnimationFrame(frame);
    if (document.hidden || host.offsetParent === null) { last = now; return; }
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (!still) ang += dt * 0.45 * (mouse.in ? 1.8 : 1);
    g.clearRect(0, 0, W, H);
    const cx = W / 2, cy = H / 2, R = Math.min(W * 0.28, H * 0.9), ax = cx + Math.cos(ang) * R, ay = cy + Math.sin(ang) * R * 0.35, bx = 2 * cx - ax, by = 2 * cy - ay;
    for (const p of parts) {
      if (!still) p.u = (p.u + dt * p.sp) % 1;
      const u = p.dir > 0 ? p.u : 1 - p.u, sw = Math.sin(p.u * Math.PI);
      const x = ax + (bx - ax) * u + p.o[0] * 26 * sw, y = ay + (by - ay) * u + p.o[1] * 26 * sw;
      g.globalAlpha = 0.35 + 0.5 * sw; g.fillStyle = u < 0.5 ? cA : cB; g.beginPath(); g.arc(x, y, 1.6, 0, 6.2832); g.fill();
    }
    g.globalAlpha = 1;
    for (const [x, y, c] of [[ax, ay, cA], [bx, by, cB]]) { g.fillStyle = c; g.shadowColor = c; g.shadowBlur = 18; g.beginPath(); g.arc(x, y, Math.min(16, H * 0.14), 0, 6.2832); g.fill(); g.shadowBlur = 0; }
  };
  raf = requestAnimationFrame(frame);
  host.classList.add('ready');
  return () => { cancelAnimationFrame(raf); ro.disconnect(); cv.remove(); };
}

/* ============================================================ crowd dot field (step 4) */
function dotField(host) {
  const cv = h('canvas'); cv.style.cssText = 'display:block;width:100%;height:100%'; host.append(cv);
  const g = cv.getContext('2d');
  let W = 1, H = 1, shown = 0, target = 0, share = null, raf = 0;
  const MAX = 600;
  const size = () => { const d = Math.min(2, devicePixelRatio || 1); W = host.clientWidth || 1; H = host.clientHeight || 1; cv.width = W * d; cv.height = H * d; g.setTransform(d, 0, 0, d, 0, 0); draw(); };
  function draw() {
    g.clearRect(0, 0, W, H);
    let sp = Math.max(5, Math.floor(Math.sqrt(W * H / (MAX * 1.05))));
    let cols = Math.max(1, Math.floor(W / sp));
    while (Math.ceil(MAX / cols) * sp > H && sp > 5) { sp--; cols = Math.max(1, Math.floor(W / sp)); }
    const rows = Math.ceil(MAX / cols), ox = (W - cols * sp) / 2 + sp / 2, oy = (H - rows * sp) / 2 + sp / 2;
    const accent = cssVar('--accent') || '#8f7bff', teal = cssVar('--accent-2') || '#4fe3c1', faint = cssVar('--line-2') || 'rgba(255,255,255,.13)';
    const r0 = sp * 0.33;
    for (let i = 0; i < MAX; i++) {
      const x = ox + (i % cols) * sp, y = oy + Math.floor(i / cols) * sp;
      let k = i < Math.floor(shown) ? 1 : i < shown ? shown - Math.floor(shown) : 0;
      g.beginPath();
      if (k <= 0) { g.fillStyle = faint; g.globalAlpha = 0.6; g.arc(x, y, r0 * 0.5, 0, 6.2832); }
      else {
        const isCore = share != null && ((i * 0.6180339887) % 1) < share;
        g.fillStyle = share == null || isCore ? accent : teal; g.globalAlpha = 0.95; g.arc(x, y, r0 * (0.4 + 0.9 * k), 0, 6.2832);
      }
      g.fill();
    }
    g.globalAlpha = 1;
  }
  function tick() {
    raf = 0;
    const d = target - shown;
    if (Math.abs(d) < 0.05) shown = target; else shown += Math.sign(d) * Math.max(0.6, Math.abs(d) * 0.1);
    draw();
    if (shown !== target) raf = requestAnimationFrame(tick);
  }
  const ro = new ResizeObserver(size); ro.observe(host); size();
  return {
    set(n, coreShare) { target = n; share = coreShare; if (reduced()) { shown = n; draw(); } else if (!raf) raf = requestAnimationFrame(tick); },
    redraw: draw,
    destroy() { cancelAnimationFrame(raf); ro.disconnect(); cv.remove(); },
  };
}

/* ============================================================ view */
export default function mountSetup(view) {
  const S = setupState;
  const cleanups = [];
  const f = {};          // key -> input element
  const wrap = {};       // key -> field wrapper (shake target)
  const syncers = [];    // functions re-run when state changes from outside an input
  let cur = Math.min(Math.max(S.step || 0, 0), STEPS.length - 1), goSeq = 0, launching = false;

  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const missing = () => REQUIRED.filter((k) => !String(S[k]).trim());
  const payload = () => ({ business: S.business, handle: S.handle, place: S.place, zip: S.zip, goal: S.goal, postA: S.postA, postB: S.postB });
  const stepDone = (i) => [
    !!(S.business.trim() && S.zip.trim()), !!(S.postA.trim() && S.postB.trim()), !!S.audience, true, false,
  ][i];

  /* ---- fields ---- */
  const field = (key, label, el, cls = '') => { f[key] = el; wrap[key] = h('div.su-field.' + (cls || 'x'), h('label', label), el); return wrap[key]; };
  const text = (key, ph) => h('input', {
    type: 'text', placeholder: ph || '', value: S[key], autocomplete: 'off',
    oninput: (e) => { S[key] = e.target.value; if (key === 'handle') syncers.forEach((fn) => fn()); railDone(); },
  });

  /* ---- hero ---- */
  const heroHost = h('div.su-orbs', { 'aria-hidden': 'true' });
  const title = h('h1', 'Two drafts in. A verdict, with reasons, out.');
  const hero = h('header.su-hero',
    h('div.su-hero-copy', title,
      h('p', 'A crowd sampled from live Census and Pew data sees each draft in a twin world: same people, same follower graph, same schedule. Only the post differs.')),
    heroHost);

  /* ---- panel scaffolding ---- */
  const panel = (i, sub, actions, ...body) => h('section.su-panel', { hidden: i !== cur, 'data-step': i, 'aria-label': STEPS[i].label },
    h('div.su-phead', h('div', h('div.su-kicker', `Step ${i + 1} of ${STEPS.length}`), h('h2', STEPS[i].label), h('p.su-sub', sub)), actions ? h('div.su-pact', actions) : null),
    h('div.su-body', body));

  /* ---------- step 1: business ---------- */
  const exampleBtn = h('button.btn.sm', { onclick: loadExample }, 'Load example');
  const p0 = panel(0, 'Tell the crowd who is posting. Business and ZIP are required; the rest sharpens the read.', exampleBtn,
    h('div.su-grid',
      field('business', 'Business', text('business', 'South Congress Coffee'), 'w2'),
      field('handle', 'Instagram handle', text('handle', '@southcongresscoffee'), 'w2'),
      field('place', 'Place', text('place', 'Austin, TX 78704'), 'w2'),
      field('zip', 'ZIP', text('zip', '78704'), 'w1'),
      field('goal', 'Goal', text('goal', 'Get people within 3 miles to come in this week'), 'w5')));

  /* ---------- step 2: drafts ---------- */
  const cardTilts = [];
  function postCard(v) {
    const key = 'post' + v, lc = v.toLowerCase();
    const handle = h('b.su-handle'), count = h('span.su-count'), peek = h('div.su-peek');
    const ta = h('textarea', { placeholder: `Paste or write the caption for version ${v}`, value: S[key], maxlength: 4000, 'aria-label': `Version ${v} caption`,
      oninput: (e) => { S[key] = e.target.value; upd(); railDone(); } });
    f[key] = ta;
    const upd = () => {
      handle.textContent = S.handle.trim() || '@yourhandle';
      const t = S[key], n = t.length;
      count.textContent = `${n.toLocaleString()} / 2,200`; count.classList.toggle('over', n > 2200);
      const words = t.trim() ? t.trim().split(/\s+/).length : 0;
      peek.replaceChildren(h('span.su-peek-l', 'In the feed'), t.trim() ? [t.length > 125 ? t.slice(0, 125).trimEnd() : t, t.length > 125 ? h('span.su-more', '… more') : null] : h('i', 'Nothing yet'), h('span.su-words', `${words} words`));
    };
    syncers.push(upd); upd();
    const card = h('article.su-post.' + lc,
      h('div.su-post-head', h('div.su-ava', v), h('div', handle, h('div.su-meta', 'Sponsored preview')), h('span.chip.' + lc, `Version ${v}`)),
      wrap[key] = h('div.su-post-body', ta),
      h('div.su-post-foot', peek, count),
      h('div.su-glare'));
    cardTilts.push(tilt(card, { max: 3.5, scale: 1.005 }));
    return card;
  }
  const seam = h('div.su-seam', { 'aria-hidden': 'true' },
    h('i.su-seam-line'),
    h('div.su-seam-node', s('svg', { viewBox: '0 0 48 32', width: 48, height: 32 }, s('circle', { cx: 18, cy: 16, r: 12, class: 'sa' }), s('circle', { cx: 30, cy: 16, r: 12, class: 'sb' }))),
    h('div.su-seam-cap', 'same people', h('br'), 'same graph', h('br'), 'same schedule'),
    h('i.su-seam-line'));
  const p1 = panel(1, 'Write the two versions as they would appear. They run in twin worlds that differ only by this text.', null,
    h('div.su-twins', postCard('A'), seam, postCard('B')));

  /* ---------- step 3: audience ---------- */
  const audienceBox = h('div.su-aud');
  const proposeBtn = h('button.btn', { onclick: propose }, 'Propose audience');
  const p2 = panel(2, 'Optional. The Audience agent names the segments from live Census and Pew rows; you adjust them. Skip it and the run proposes its own.', proposeBtn, audienceBox);
  let playBars = () => {};

  function scanVisual(live) {
    const cols = 18, rows = 7, dots = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const d = Math.hypot(c - (cols - 1) / 2, (r - (rows - 1) / 2) * 1.8);
      dots.push(h('i', { style: { '--d': d.toFixed(2) } }));
    }
    return h('div.su-scan' + (live ? '.live' : ''), h('div.su-scan-grid', { style: { '--cols': cols } }, dots),
      h('div.su-scan-cap', live ? `Joining Census adults to Pew Instagram use${S.zip ? ` around ${S.zip}` : ''}...` : 'No audience yet'));
  }

  function renderAudience() {
    const a = S.audience;
    playBars = () => {};
    if (!a) { mount(audienceBox, scanVisual(false)); return; }
    const c = a.proposal.core, sp = a.proposal.spillover;
    const rows = a.join.rows || [];
    const est = () => estimateCoreShare(rows, S.coreBands);
    const defShare = () => { const e = est(); return e == null ? 0.6 : clamp(e, 0.5, 0.7); };
    const share = () => (S.coreShareTouched && S.coreShare != null ? S.coreShare : defShare());

    // share visuals
    const C = 2 * Math.PI * 52;
    const arcCore = s('circle', { cx: 70, cy: 70, r: 52, class: 'dn core', 'stroke-dasharray': `0 ${C}` });
    const arcSp = s('circle', { cx: 70, cy: 70, r: 52, class: 'dn sp', 'stroke-dasharray': `0 ${C}`, 'stroke-dashoffset': 0 });
    const dnText = s('text', { x: 70, y: 68, class: 'dn-big', 'text-anchor': 'middle' }, '0%');
    const donut = s('svg', { viewBox: '0 0 140 140', class: 'su-donut', role: 'img', 'aria-label': 'Core versus spillover share of the crowd' },
      s('g', { transform: 'rotate(-90 70 70)' }, s('circle', { cx: 70, cy: 70, r: 52, class: 'dn track' }), arcSp, arcCore),
      dnText, s('text', { x: 70, y: 88, class: 'dn-sm', 'text-anchor': 'middle' }, 'core'));
    const stackCore = h('i.core'), stackSp = h('i.sp');
    const stack = h('div.su-stack', stackCore, stackSp);
    const legend = h('div.su-legend');
    const slider = h('input', { type: 'range', min: 50, max: 70, step: 1, value: Math.round(share() * 100), 'aria-label': 'Core share of the crowd' });
    const shareLabel = h('b'), note = h('div.expl'), resetBtn = h('button.btn.sm.ghost', { onclick: () => { S.coreShareTouched = false; update(); } }, 'Use data default');
    slider.oninput = () => { S.coreShare = Number(slider.value) / 100; S.coreShareTouched = true; update(); };

    const chips = h('div.chips');
    const drawChips = () => mount(chips, AGE_BANDS.map((b) => h('button.chip' + (S.coreBands.includes(b) ? '.on' : ''), {
      title: 'Toggle this age band in the core audience', 'aria-pressed': String(S.coreBands.includes(b)),
      onclick: () => { S.coreBands = S.coreBands.includes(b) ? S.coreBands.filter((x) => x !== b) : [...S.coreBands, b]; drawChips(); update(); },
    }, b)));

    // join chart
    const maxAdults = Math.max(1, ...rows.map((r) => Number(r.adults) || 0));
    const fills = [], rowEls = [];
    const chart = h('div.su-chart', { role: 'img', 'aria-label': 'Adults and Instagram users by age band' },
      h('div.su-chart-key', h('span.k.ad', 'Adults (Census)'), h('span.k.ig', 'Instagram users (Pew rate x adults)'), h('span.k.core', 'Overlaps core bands')),
      rows.map((r) => {
        const ad = h('i'), ig = h('i');
        fills.push([ad, (Number(r.adults) || 0) / maxAdults * 100], [ig, (Number(r.instagram_users) || 0) / maxAdults * 100]);
        const el = h('div.su-crow', h('div.su-cband', r.band),
          h('div.su-cbars', h('div.su-bar.ad', ad), h('div.su-bar.ig', ig)),
          h('div.su-cnum', h('b', fmtInt(r.instagram_users)), h('span', `${Number(r.instagram_pct).toFixed(0)}% use it`)));
        rowEls.push([el, r.band]); return el;
      }));
    playBars = () => {
      fills.forEach(([el]) => { el.style.transition = 'none'; el.style.width = '0%'; });
      void chart.offsetWidth;
      fills.forEach(([el, w], i) => { el.style.transition = ''; el.style.transitionDelay = `${Math.floor(i / 2) * 70 + (i % 2) * 90}ms`; el.style.width = `${w}%`; });
    };
    const tbl = h('div.tbl-wrap', { hidden: true }, h('table', h('thead', h('tr', h('th', 'Age band'), h('th.num', 'Adults (Census)'), h('th.num', 'Instagram use (Pew)'), h('th.num', 'Instagram users'))),
      h('tbody', rows.map((r) => h('tr', h('td', r.band), h('td.num', fmtInt(r.adults)), h('td.num', `${Number(r.instagram_pct).toFixed(0)}%`), h('td.num', fmtInt(r.instagram_users)))))));
    const tblBtn = h('button.btn.sm.ghost', { 'aria-expanded': 'false', onclick: () => { tbl.hidden = !tbl.hidden; tblBtn.setAttribute('aria-expanded', String(!tbl.hidden)); tblBtn.textContent = tbl.hidden ? 'Show table' : 'Hide table'; if (!tbl.hidden && !reduced()) tbl.animate([{ opacity: 0, transform: 'translateY(-6px)' }, { opacity: 1, transform: 'none' }], { duration: 300, easing: EASE.out }); } }, 'Show table');

    function update() {
      const e = est(), v = share(), pc = Math.round(v * 100);
      if (!S.coreShareTouched) slider.value = pc;
      shareLabel.textContent = S.coreShareTouched ? `${slider.value}% core (your override)` : `${slider.value}% core (data default)`;
      arcCore.setAttribute('stroke-dasharray', `${v * C} ${C}`);
      arcSp.setAttribute('stroke-dasharray', `${(1 - v) * C} ${C}`); arcSp.setAttribute('stroke-dashoffset', String(-v * C));
      countUp(dnText, pc, (x) => `${Math.round(x)}%`, 600);
      stackCore.style.width = `${pc}%`; stackSp.style.width = `${100 - pc}%`;
      stackCore.textContent = `Core ${pc}%`; stackSp.textContent = `Spillover ${100 - pc}%`;
      mount(legend, h('span', h('i.sw.core'), c.name), h('span', h('i.sw.sp'), sp.name));
      resetBtn.hidden = !S.coreShareTouched;
      note.textContent = e != null ? `Data estimate from the join: about ${(e * 100).toFixed(0)}% (clamped to 50-70%). The exact value is computed when the crowd is sampled.` : 'Exact value is computed when the crowd is sampled.';
      rowEls.forEach(([el, band]) => { const pr = PEW[band]; el.classList.toggle('core', !!pr && S.coreBands.some((b) => PER[b] && overlap(pr, PER[b]) > 0)); });
      syncers.forEach((fn) => fn());
    }

    mount(audienceBox,
      h('div.su-segs',
        h('div.seg-card.su-seg.core', h('span.tag', 'Core audience'), h('h3', c.name), chips, h('p', c.why)),
        h('div.seg-card.su-seg.sp', h('span.tag', 'Spillover'), h('h3', sp.name), h('p', sp.why),
          a.proposal.interests?.length ? h('div.chips', a.proposal.interests.map((i) => h('span.chip', i))) : null,
          h('div.expl', `Proposed by ${a.served_by || 'model'}${a.fallback ? ' (fallback: no reasoning model reachable)' : ''}. Segments are names only; shares come from the data.`))),
      h('div.su-share',
        h('div.su-share-vis', donut, h('div.su-share-side', stack, legend)),
        h('div.su-share-ctl', h('div.row.spread', h('span.muted', 'Core share of the crowd'), shareLabel), slider, h('div.row.spread', note, resetBtn))),
      h('div.card-head.su-join-head', h('h3', `Census x Pew: Instagram audience${a.geo ? ` in ${a.geo.geo_name}` : ''}`),
        h('span.row', h('span.chip', 'Engine: ' + a.join.engine), qidChip(a.join.query_id), tblBtn)),
      chart, tbl);
    drawChips(); update();
    requestAnimationFrame(playBars);
  }

  async function propose() {
    const m = missing(); if (m.length) return flagMissing(m);
    proposeBtn.disabled = true; mount(proposeBtn, spin(), ' Asking the Audience agent...');
    mount(audienceBox, scanVisual(true));
    try {
      S.audience = await api('/api/audience', { method: 'POST', body: payload() });
      S.coreBands = [...S.audience.proposal.core.age_bands]; S.coreShareTouched = false;
    } catch (e) { fail(e); }
    proposeBtn.disabled = false; mount(proposeBtn, S.audience ? 'Propose again' : 'Propose audience');
    renderAudience(); railDone(); renderSummary(); syncCrowd();
  }

  /* ---------- step 4: run settings ---------- */
  const fieldHost = h('div.su-dots');
  let dots = null;
  const estLine = h('p.su-est');
  function choiceRow(label, key, opts, fmt) {
    const row = h('div.su-seg-row', { role: 'group', 'aria-label': label });
    const draw = () => mount(row, opts.map(([v, tag]) => h('button.su-opt' + (S[key] === v ? '.on' : ''), { 'aria-pressed': String(S[key] === v),
      onclick: () => { S[key] = v; draw(); settingsChanged(); } }, h('b', fmt ? fmt(v) : v), tag ? h('span', tag) : null)));
    draw(); return h('div.su-set', h('label', label), row);
  }
  const custToggle = h('input', { type: 'checkbox', checked: S.useCustomers, onchange: (e) => { S.useCustomers = e.target.checked; settingsChanged(); } });
  const p3 = panel(3, 'Bigger crowds and more seeds take longer. The 60-person quick run is the demo default.', null,
    h('div.su-settings',
      h('div.su-set-col',
        choiceRow('Crowd size', 'crowdSize', CROWDS, (v) => String(v)),
        choiceRow('Length', 'rounds', ROUNDS, (v) => `${v} rounds`),
        choiceRow('Seeds', 'seeds', [[1, 'one pass'], [2, 'check agreement']], (v) => `${v} seed${v > 1 ? 's' : ''}`),
        h('label.su-switch', custToggle, h('span.su-track', h('i')), h('span', 'Use customer list ', h('em', '(synthetic demo CSV)')))),
      h('div.su-set-vis', fieldHost, estLine)));

  function crowdShare() { return S.audience && S.coreBands?.length ? (S.coreShareTouched && S.coreShare != null ? S.coreShare : clamp(estimateCoreShare(S.audience.join.rows, S.coreBands) ?? 0.6, 0.5, 0.7)) : null; }
  function syncCrowd() { dots?.set(S.crowdSize, crowdShare()); }
  function settingsChanged() {
    syncCrowd();
    const pr = S.crowdSize * S.rounds * S.seeds;
    mount(estLine, h('b', `${S.crowdSize} people`), ` over ${S.rounds} rounds, ${S.seeds} seed${S.seeds > 1 ? 's' : ''}, in both worlds: `, h('b', `${(pr * 2).toLocaleString()} person-rounds`),
      `. ${S.seeds > 1 ? 'Two seeds let us check the passes agree. ' : 'One seed cannot show whether the result is stable. '}No clock time is promised; larger settings take longer.`,
      crowdShare() != null ? h('span.su-dot-key', h('i.core'), 'core', h('i.sp'), 'spillover') : null);
    renderSummary();
  }

  /* ---------- step 5: launch ---------- */
  const summary = h('div.su-summary');
  const fold = h('div.su-fold');
  const runBtn = h('button.btn.primary.lg.su-run', { onclick: launch }, 'Run Dry Run');
  cleanups.push(magnetic(runBtn, 0.18));
  const foldLabel = h('div.su-fold-cap', 'Folding the two drafts into twin worlds...');
  const p4 = panel(4, 'One last look. Launching samples the crowd and starts both worlds.', null,
    h('div.su-launch', fold, h('div.su-launch-side', summary, runBtn, foldLabel)));

  function excerpt(t) { const x = t.trim().replace(/\s+/g, ' '); return x.length > 90 ? x.slice(0, 90).trimEnd() + '…' : x || 'Empty draft'; }
  function renderSummary() {
    mount(fold,
      h('div.su-mini.a', h('span.su-mini-tag', 'A'), h('p', excerpt(S.postA)), h('span.su-orb-cap', 'World A')),
      h('i.su-fold-seam'),
      h('div.su-mini.b', h('span.su-mini-tag', 'B'), h('p', excerpt(S.postB)), h('span.su-orb-cap', 'World B')));
    const core = S.audience && S.coreBands?.length ? `${S.coreBands.join(', ')} (${Math.round((crowdShare() ?? 0.6) * 100)}% core)` : 'the run proposes its own';
    const facts = [
      ['Business', S.business.trim() || null, 'business'], ['ZIP', S.zip.trim() || null, 'zip'],
      ['Crowd', `${S.crowdSize} people, ${S.rounds} rounds, ${S.seeds} seed${S.seeds > 1 ? 's' : ''}`], ['Audience', core], ['Customer list', S.useCustomers ? 'used (synthetic demo CSV)' : 'not used'],
    ];
    mount(summary, facts.map(([k, v, key]) => h('div.su-fact' + (v ? '' : '.miss'), { onclick: key ? () => flagMissing([key]) : null }, h('span', k), h('b', v || 'missing'))),
      missing().includes('postA') || missing().includes('postB') ? h('div.su-fact.miss', { onclick: () => flagMissing(['postA', 'postB'].filter((k) => missing().includes(k))) }, h('span', 'Drafts'), h('b', 'a version is empty')) : null);
  }

  async function launch() {
    const m = missing(); if (m.length) return flagMissing(m);
    if (launching) return;
    const body = { ...payload(), crowdSize: S.crowdSize, rounds: S.rounds, seeds: S.seeds, useCustomers: S.useCustomers };
    if (S.audience && S.coreBands?.length) body.coreAgeBands = S.coreBands;
    if (S.audience && S.coreShareTouched) body.coreShare = S.coreShare;
    launching = true; runBtn.disabled = true; mount(runBtn, spin(), ' Starting...');
    fold.classList.add('folding'); shell.classList.add('launching');
    const t0 = performance.now();
    try {
      const r = await api('/api/runs', { method: 'POST', body });
      if (!reduced()) await sleepMs(Math.max(0, 1300 - (performance.now() - t0)));
      location.hash = `#/run/${r.run_id}`;
    } catch (e) {
      fail(e); launching = false; runBtn.disabled = false; mount(runBtn, 'Run Dry Run');
      fold.classList.remove('folding'); shell.classList.remove('launching');
    }
  }

  /* ---------- validation ---------- */
  async function flagMissing(keys) {
    const first = keys[0];
    toast(`Fill in: ${keys.join(', ')}`, true);
    await go(FIELD_STEP[first] ?? 0);
    for (const k of keys) {
      const w = wrap[k]; if (!w) continue;
      w.classList.add('bad'); setTimeout(() => w.classList.remove('bad'), 1800);
      if (!reduced()) w.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-8px)' }, { transform: 'translateX(7px)' }, { transform: 'translateX(-5px)' }, { transform: 'translateX(3px)' }, { transform: 'none' }], { duration: 420, easing: EASE.out });
    }
    f[first]?.focus({ preventScroll: true });
  }

  async function loadExample() {
    exampleBtn.disabled = true;
    try {
      const d = await api('/api/demo');
      Object.assign(S, { business: d.business, handle: d.handle, place: d.place, zip: d.zip, goal: d.goal, postA: d.postA, postB: d.postB });
      S.audience = null; S.coreBands = null; S.coreShareTouched = false;
      for (const k of ['business', 'handle', 'place', 'zip', 'goal', 'postA', 'postB']) f[k].value = S[k];
      syncers.forEach((fn) => fn()); renderAudience(); renderSummary(); settingsChanged(); railDone();
      mount(proposeBtn, 'Propose audience');
      stagger([...p0.querySelectorAll('.su-field')], { y: 10, gap: 40, ms: 500 });
      toast('Example loaded');
    } catch (e) { fail(e); }
    exampleBtn.disabled = false;
  }

  /* ---------- rail, nav, transitions ---------- */
  const ind = h('i.su-ind');
  const railBtns = STEPS.map((st, i) => h('button.su-step', { type: 'button', 'data-i': i, onclick: () => go(i), 'aria-label': `Step ${i + 1}: ${st.label}` },
    h('span.su-num', h('em', String(i + 1)), s('svg', { viewBox: '0 0 16 16', width: 14, height: 14 }, s('path', { d: 'M3 8.5l3.2 3L13 4.5', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }))),
    h('span.su-st', h('b', st.label), h('small', st.hint))));
  const rail = h('nav.su-rail', { 'aria-label': 'New test steps' }, ind, railBtns);
  const progress = h('i.su-prog');
  rail.append(progress);
  function railDone() {
    railBtns.forEach((b, i) => { b.classList.toggle('done', i !== cur && stepDone(i)); b.classList.toggle('now', i === cur); b.setAttribute('aria-current', i === cur ? 'step' : 'false'); });
  }
  function moveInd() {
    const b = railBtns[cur]; if (!b) return;
    ind.style.width = `${b.offsetWidth}px`; ind.style.height = `${b.offsetHeight}px`; ind.style.transform = `translate(${b.offsetLeft}px, ${b.offsetTop}px)`;
    progress.style.setProperty('--p', String(cur / (STEPS.length - 1)));
  }
  const backBtn = h('button.btn.ghost', { onclick: () => go(cur - 1) }, 'Back');
  const nextBtn = h('button.btn.primary', { onclick: () => go(cur + 1) }, 'Next');
  const navCount = h('span.su-ncount');
  const nav = h('div.su-nav', backBtn, navCount, nextBtn);
  function updateNav() {
    backBtn.disabled = cur === 0; nextBtn.hidden = cur === STEPS.length - 1;
    nextBtn.textContent = cur === 2 && !S.audience ? 'Skip audience' : 'Next';
    navCount.textContent = `${cur + 1} / ${STEPS.length}`;
  }
  const panels = [p0, p1, p2, p3, p4];
  const stagePane = h('div.su-stage', panels);

  function onEnter(i) {
    if (i === 1) syncers.forEach((fn) => fn());
    if (i === 2) playBars();
    if (i === 3) { settingsChanged(); dots?.redraw(); }
    if (i === 4) renderSummary();
  }

  async function go(i) {
    i = clamp(i, 0, STEPS.length - 1);
    if (launching || i === cur) return;
    const seq = ++goSeq, prev = cur, dir = i > prev ? 1 : -1;
    panels.forEach((p) => p.getAnimations().forEach((a) => a.cancel()));
    panels.forEach((p, k) => { p.hidden = k !== prev; });
    cur = S.step = i; railDone(); moveInd(); updateNav();
    const to = panels[i];
    if (!reduced()) {
      const out = panels[prev].animate([{ opacity: 1, transform: 'none', filter: 'blur(0)' }, { opacity: 0, transform: `translateX(${-dir * 36}px) scale(.985)`, filter: 'blur(6px)' }], { duration: 220, easing: EASE.exit, fill: 'forwards' });
      await out.finished.catch(() => {});
      if (seq !== goSeq) return;
    }
    panels[prev].hidden = true; panels[prev].getAnimations().forEach((a) => a.cancel());
    to.hidden = false;
    onEnter(i);
    if (!reduced()) {
      to.animate([{ opacity: 0, transform: `translateX(${dir * 44}px) scale(.99)`, filter: 'blur(6px)' }, { opacity: 1, transform: 'none', filter: 'blur(0)' }], { duration: 520, easing: EASE.expo });
      stagger([...to.querySelectorAll(':scope > .su-body > *')], { y: 14, gap: 70, ms: 600, delay: 80 });
    }
    window.scrollTo({ top: 0, behavior: reduced() ? 'auto' : 'smooth' });
  }

  const shell = h('div.su-shell', rail, h('div.su-main', stagePane, nav));
  shell.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('input[type=text]') && cur < STEPS.length - 1) { e.preventDefault(); go(cur + 1); }
  });

  view.append(h('div.view-page.su-page', hero, shell));
  riseWords(title, { gap: 55, delay: 80 });
  cleanups.push(mountHero(heroHost));
  stagger([...hero.querySelectorAll('.su-hero-copy > p')], { y: 10, ms: 700, delay: 500 });
  stagger(railBtns, { y: 8, gap: 60, ms: 600, delay: 200 });

  dots = dotField(fieldHost); cleanups.push(() => dots.destroy());
  const ro = new ResizeObserver(moveInd); ro.observe(rail); cleanups.push(() => ro.disconnect());
  document.fonts?.ready.then(moveInd);

  renderAudience(); if (S.audience) mount(proposeBtn, 'Propose again');
  settingsChanged(); railDone(); updateNav(); moveInd(); onEnter(cur);
  return () => { goSeq++; cleanups.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } }); cardTilts.forEach((fn) => fn()); };
}

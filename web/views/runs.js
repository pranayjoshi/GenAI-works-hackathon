/* Runs gallery: tilt cards with generative twin glyphs, filters, grid / timeline modes,
 * and a zoom transition into the run. Data: GET /api/runs. Styles: css/library.css (lib-*). */
import { h, s, mount, hueOf, cssVar } from '../core/dom.js';
import { api } from '../core/api.js';
import { tilt, stagger, reduced, EASE } from '../core/motion.js';
import { createStage } from '../core/three-kit.js';

const STATUS_RANK = { running: 0, queued: 1, error: 2, done: 3 };
const isLive = (st) => st === 'running' || st === 'queued';
const statusTone = (st) => (isLive(st) ? 'live' : st === 'done' ? 'good' : st === 'error' ? 'bad' : 'idle');

function hash32(str) {
  let x = 2166136261;
  for (const c of String(str)) { x ^= c.charCodeAt(0); x = Math.imul(x, 16777619); }
  return x >>> 0;
}

/** Two half-orbs drawn from the run id: angle, separation, ring tilt and moon position all differ per run. */
export function twinGlyph(id, size = 56) {
  const k = hash32(id), r = 15;
  const rot = (k % 180) - 90, sep = 1.5 + ((k >>> 8) % 5), ringTilt = (k >>> 4) % 180, ringRy = 6 + ((k >>> 12) % 9), moon = ((k >>> 16) % 360) * Math.PI / 180;
  const half = (dir) => `M 28 ${28 - r} A ${r} ${r} 0 0 ${dir} 28 ${28 + r} Z`;
  const mx = 28 + 25 * Math.cos(moon), my = 28 + ringRy * Math.sin(moon);
  return s('svg', { class: 'lib-glyph', viewBox: '0 0 56 56', width: size, height: size, 'aria-hidden': 'true' },
    s('ellipse', { cx: 28, cy: 28, rx: 25, ry: ringRy, fill: 'none', stroke: 'currentColor', 'stroke-opacity': '.28', transform: `rotate(${ringTilt} 28 28)` }),
    s('g', { transform: `rotate(${rot} 28 28)` },
      s('path', { class: 'g-a', d: half(0), transform: `translate(${-sep} 0)` }),
      s('path', { class: 'g-b', d: half(1), transform: `translate(${sep} 0)` })),
    s('circle', { cx: mx, cy: my, r: 2.4, fill: `hsl(${hueOf(id)} 80% 65%)`, transform: `rotate(${ringTilt} 28 28)` }));
}

const dayLabel = (iso) => new Date(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
const timeLabel = (iso) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

/** Shared-element feel: a panel grows from the card's rectangle to full screen carrying the run's glyph and headline,
 * the route changes underneath it, and the panel fades as soon as the run view has painted (never a blank screen). */
function zoomOpen(card, id, title) {
  const go = () => { location.hash = `#/run/${id}`; };
  if (reduced() || !card?.animate) return go();
  const r = card.getBoundingClientRect();
  const ov = h('div.lib-zoom', { style: { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` } },
    h('div.lib-zoom-body', twinGlyph(id, 72), h('div.lib-zoom-title', title || 'Opening run'), h('div.lib-zoom-sub', 'Loading twin worlds')));
  document.body.append(ov);
  const full = { left: '0px', top: '0px', width: `${innerWidth}px`, height: `${innerHeight}px`, borderRadius: '0px' };
  const anim = ov.animate([{ left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, borderRadius: '16px' }, full], { duration: 420, easing: EASE.inOut, fill: 'forwards' });
  ov.firstChild.animate([{ opacity: 0, transform: 'scale(.85)' }, { opacity: 1, transform: 'none' }], { duration: 360, delay: 80, easing: EASE.out, fill: 'backwards' });
  let gone = false;
  const remove = () => { if (!gone) { gone = true; ov.remove(); } };
  const fade = () => ov.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, easing: EASE.out, fill: 'forwards' }).finished.then(remove, remove);
  // route change, then fade after two frames so the run view has rendered under the overlay
  anim.finished.then(() => { go(); requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(fade, 60))); }, () => { go(); remove(); });
  setTimeout(remove, 2000); // safety net if the animation never resolves
}

/* ---------- run constellation: each run is an A/B twin pair on a start-time axis ---------- */
const STATUS_VAR = { good: '--good', bad: '--bad', live: '--warn', idle: '--faint' };

/** Compact 3D header. Runs ordered by start time along x; ring colour = status, orb size = crowd size (log).
 *  Returns { dispose, highlight(set|null) }. Falls back to an SVG strip when WebGL is unavailable. */
function constellation(host, labels, tip, runs, open) {
  const ordered = runs.slice().sort((a, b) => (a.created < b.created ? -1 : 1));
  const n = ordered.length, maxCrowd = Math.max(...ordered.map((r) => r.crowd || 1), 1);
  const sizeOf = (r) => 0.2 + 0.16 * (Math.log10((r.crowd || 1) + 1) / Math.log10(maxCrowd + 1));
  let stage = null, dead = false, match = null, hover = -1, offs = [];
  const fmtDay = (iso) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const showTip = (r, x, y) => {
    mount(tip, h('b', r.headline || 'Untitled run'), h('span', `${r.status} · ${r.crowd} people · ${new Date(r.created).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`));
    tip.hidden = false;
    const W = host.clientWidth, H = host.clientHeight, tw = tip.offsetWidth, th = tip.offsetHeight;
    tip.style.left = `${Math.max(6, Math.min(W - tw - 6, x - tw / 2))}px`;
    tip.style.top = `${y - th - 14 < 6 ? Math.min(H - th - 6, y + 16) : y - th - 14}px`;
  };
  const fallback = () => {
    const W = 1000, H = 120, step = n > 1 ? 880 / (n - 1) : 0;
    const svg = s('svg', { class: 'lib-const-flat', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'xMidYMid meet', role: 'img', 'aria-label': 'Runs ordered by start time' },
      s('line', { x1: 40, x2: 960, y1: 92, y2: 92, class: 'lib-const-axis' }));
    ordered.forEach((r, i) => {
      const x = n > 1 ? 60 + i * step : 500, rad = sizeOf(r) * 40;
      const g = s('g', { class: 'lib-const-node', tabindex: 0, transform: `translate(${x} 52)` },
        s('circle', { r: rad * 2.1, fill: 'none', stroke: `var(${STATUS_VAR[statusTone(r.status)]})`, 'stroke-width': 2 }),
        s('circle', { cx: -rad * 0.75, r: rad, fill: 'var(--a)' }), s('circle', { cx: rad * 0.75, r: rad, fill: 'var(--b)' }),
        s('line', { y1: rad * 2.1, y2: 40, class: 'lib-const-stem' }));
      g.addEventListener('click', () => open(r)); g.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(r); });
      g.addEventListener('mouseenter', () => { const b = g.getBoundingClientRect(), hr = host.getBoundingClientRect(); showTip(r, b.left + b.width / 2 - hr.left, b.top - hr.top); });
      g.addEventListener('mouseleave', () => { tip.hidden = true; });
      svg.append(g);
    });
    mount(host, svg); host.classList.add('flat');
  };
  (async () => {
    let st = null;
    try { st = await createStage(host, { camera: { fov: 30, x: 0, y: 1.4, z: 8.5 } }); } catch (e) { console.warn('[runs] 3D unavailable', e); }
    if (dead) { st?.dispose(); return; }
    if (!st) return fallback();
    stage = st;
    const { THREE, scene, camera } = stage;
    camera.lookAt(0, -0.35, 0);
    const col = (v, d) => new THREE.Color(cssVar(v) || d);
    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const sun = new THREE.DirectionalLight(0xffffff, 1.5); sun.position.set(-4, 6, 8); scene.add(sun);
    const sphere = new THREE.SphereGeometry(1, 28, 20), ringGeo = new THREE.TorusGeometry(1, 0.035, 8, 64), hitGeo = new THREE.SphereGeometry(1, 8, 6);
    const axisMat = new THREE.LineBasicMaterial({ color: col('--line-2', '#444'), transparent: true, opacity: 0.9 });
    const axis = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-1, 0, 0), new THREE.Vector3(1, 0, 0)]), axisMat);
    axis.position.y = -1.05; scene.add(axis);
    const grid = new THREE.GridHelper(40, 80, 0x8f7bff, 0x8f7bff); grid.material.transparent = true; grid.material.opacity = 0.07; grid.position.y = -1.06; scene.add(grid);
    const nodes = ordered.map((r, i) => {
      const k = hash32(r.run_id), g = new THREE.Group(), sz = sizeOf(r), tone = statusTone(r.status);
      const a = new THREE.Mesh(sphere, new THREE.MeshStandardMaterial({ color: col('--a', '#5b8cff'), roughness: 0.35, metalness: 0.1, emissive: col('--a', '#5b8cff'), emissiveIntensity: 0.18, transparent: true }));
      const b = new THREE.Mesh(sphere, new THREE.MeshStandardMaterial({ color: col('--b', '#ff9a4d'), roughness: 0.35, metalness: 0.1, emissive: col('--b', '#ff9a4d'), emissiveIntensity: 0.18, transparent: true }));
      a.scale.setScalar(sz); b.scale.setScalar(sz);
      const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: col(STATUS_VAR[tone], '#888'), transparent: true, opacity: 0.9 }));
      ring.scale.setScalar(sz * 2.3); ring.rotation.x = Math.PI / 2 - 0.35; ring.rotation.y = ((k % 60) - 30) * Math.PI / 180;
      const stem = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, -1.05, 0), new THREE.Vector3(0, -sz * 1.4, 0)]), new THREE.LineBasicMaterial({ color: col(STATUS_VAR[tone], '#888'), transparent: true, opacity: 0.45 }));
      const hit = new THREE.Mesh(hitGeo, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
      hit.scale.setScalar(0.85); hit.userData.i = i;
      g.add(a, b, ring, stem, hit); scene.add(g);
      return { r, g, a, b, ring, stem, hit, sz, phase: (k % 628) / 100, live: isLive(r.status), y0: ((k >>> 9) % 5) * 0.08 };
    });
    // HTML labels under the axis: one date per day boundary, anchored to its first run
    const lab = []; let lastDay = '';
    nodes.forEach((nd) => { const d = fmtDay(nd.r.created); if (d !== lastDay) { lastDay = d; const el = h('span.lib-const-lab', d); labels.append(el); lab.push([nd, el]); } });
    let aspect = 0, step = 0, fit = 1;
    const layout = () => {
      aspect = camera.aspect;
      const visW = 2 * camera.position.z * Math.tan((camera.fov * Math.PI) / 360) * aspect;
      const usable = Math.max(2, visW - 3);
      step = n > 1 ? Math.min(5, usable / (n - 1)) : 0;
      nodes.forEach((nd, i) => { nd.g.position.set((i - (n - 1) / 2) * step, nd.y0, 0); });
      fit = n > 1 ? Math.min(1, (step * 0.45) / (Math.max(...nodes.map((nd) => nd.sz)) * 2.3)) : 1;
      const half = n > 1 ? ((n - 1) / 2) * step + 1 : 1.5;
      axis.scale.x = half;
    };
    const v = new THREE.Vector3();
    const placeLabels = () => {
      const W = host.clientWidth, H = host.clientHeight;
      for (const [nd, el] of lab) {
        v.set(nd.g.position.x, -1.05, 0).project(camera);
        el.style.transform = `translate(${((v.x + 1) / 2) * W}px, ${((1 - v.y) / 2) * H + 6}px) translateX(-50%)`;
      }
    };
    stage.onFrame((t, dt) => {
      if (camera.aspect !== aspect) layout();
      nodes.forEach((nd, i) => {
        const spin = reduced() ? nd.phase : nd.phase + t * (nd.live ? 1.6 : 0.5), d = nd.sz * 0.95;
        nd.a.position.set(Math.cos(spin) * d, Math.sin(spin) * d * 0.25, Math.sin(spin) * d);
        nd.b.position.set(-Math.cos(spin) * d, -Math.sin(spin) * d * 0.25, -Math.sin(spin) * d);
        const on = match == null || match.has(nd.r.run_id), want = fit * (on ? (hover === i ? 1.25 : 1) : 0.75);
        const s0 = nd.g.scale.x + (want - nd.g.scale.x) * Math.min(1, dt * 8); nd.g.scale.setScalar(s0); nd.stem.scale.y = 1 / Math.max(0.2, s0);
        const op = on ? 1 : 0.22;
        for (const m of [nd.a.material, nd.b.material]) { m.opacity += (op - m.opacity) * Math.min(1, dt * 8); m.emissiveIntensity += ((hover === i ? 0.55 : 0.18) - m.emissiveIntensity) * Math.min(1, dt * 8); }
        nd.ring.material.opacity += ((on ? (nd.live ? 0.55 + 0.4 * Math.sin(t * 4) : 0.9) : 0.2) - nd.ring.material.opacity) * Math.min(1, dt * 8);
        nd.ring.rotation.z = reduced() ? 0 : t * 0.3;
        if (!reduced()) nd.g.position.y = nd.y0 + Math.sin(t * 0.9 + nd.phase) * 0.06;
      });
      placeLabels();
    });
    const cv = stage.canvas, hits = nodes.map((nd) => nd.hit);
    const onMove = (e) => {
      const hit = stage.pick(e.clientX, e.clientY, hits);
      hover = hit ? hit.object.userData.i : -1;
      cv.style.cursor = hit ? 'pointer' : 'default';
      if (hit) { const hr = host.getBoundingClientRect(); showTip(nodes[hover].r, e.clientX - hr.left, e.clientY - hr.top); } else tip.hidden = true;
    };
    const onLeave = () => { hover = -1; tip.hidden = true; };
    const onClick = (e) => { const hit = stage.pick(e.clientX, e.clientY, hits); if (hit) open(nodes[hit.object.userData.i].r); };
    cv.addEventListener('pointermove', onMove); cv.addEventListener('pointerleave', onLeave); cv.addEventListener('click', onClick);
    offs.push(() => { cv.removeEventListener('pointermove', onMove); cv.removeEventListener('pointerleave', onLeave); cv.removeEventListener('click', onClick); });
  })();
  return {
    highlight(set) {
      match = set;
      host.querySelectorAll('.lib-const-node').forEach((g, i) => g.classList.toggle('dim', !!set && !set.has(ordered[i].run_id)));
    },
    dispose() { dead = true; offs.forEach((f) => f()); offs = []; stage?.dispose(); stage = null; },
  };
}

export default function view(el) {
  const state = { q: '', status: 'all', sort: 'new', mode: 'grid' };
  let runs = [], cleanups = [], dead = false, searchT = 0, cons = null;
  const kids = new Map(); // parent run id -> follow-up count

  const results = h('div.lib-results');
  const count = h('span.lib-count.muted');
  const search = h('input.lib-search', { type: 'search', placeholder: 'Search headline, business or id', 'aria-label': 'Search runs', oninput: (e) => { state.q = e.target.value.trim().toLowerCase(); clearTimeout(searchT); searchT = setTimeout(render, 120); } });
  const statusSel = h('select', { 'aria-label': 'Filter by status', onchange: (e) => { state.status = e.target.value; render(); } },
    [['all', 'All statuses'], ['running', 'Running'], ['done', 'Done'], ['error', 'Error']].map(([v, l]) => h('option', { value: v }, l)));
  const sortSel = h('select', { 'aria-label': 'Sort runs', onchange: (e) => { state.sort = e.target.value; render(); } },
    [['new', 'Newest first'], ['old', 'Oldest first'], ['crowd', 'Largest crowd'], ['status', 'Live first']].map(([v, l]) => h('option', { value: v }, l)));
  const modeBtns = ['grid', 'timeline'].map((m) => h('button.lib-seg-btn', { type: 'button', 'aria-pressed': String(m === state.mode), onclick: () => { state.mode = m; modeBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(['grid', 'timeline'][i] === m))); render(); } }, m === 'grid' ? 'Grid' : 'Timeline'));

  function card(r) {
    const live = isLive(r.status), follow = kids.get(r.run_id) || 0;
    const c = h('article.card.lib-card', { tabindex: '-1', 'data-id': r.run_id },
      h('div.lib-card-top', twinGlyph(r.run_id),
        h('div.lib-card-meta', h('span.lib-status.' + statusTone(r.status), h('i.lib-dot' + (live ? '.pulse' : '')), r.status),
          h('span.muted.lib-when', state.mode === 'timeline' ? timeLabel(r.created) : new Date(r.created).toLocaleString()))),
      h('h3.lib-card-title', h('a', { href: `#/run/${r.run_id}`, onclick: (e) => e.preventDefault() }, r.headline || 'Untitled run')),
      h('div.lib-card-biz', r.business),
      h('div.lib-chips', h('span.chip', `${r.crowd} people`), h('span.chip', `${r.rounds} rounds`), h('span.chip', `${r.seeds} seed${r.seeds > 1 ? 's' : ''}`),
        (r.posts || []).length ? h('span.chip.lib-ab', { title: `Versions ${(r.posts || []).join(' and ')}` }, (r.posts || []).map((v, i) => [i ? h('em', 'vs') : null, h('b.' + String(v).toLowerCase(), v)])) : null),
      (r.parent || follow) ? h('div.lib-chain',
        r.parent ? h('a.lib-chain-link', { href: `#/run/${r.parent}`, title: 'Open the run this one followed up', onclick: (e) => e.stopPropagation() }, `↳ follow-up of ${r.parent.slice(-4)}`) : null,
        follow ? h('span.lib-chain-link.out', `${follow} follow-up${follow > 1 ? 's' : ''}`) : null) : null,
      h('span.lib-glare', { 'aria-hidden': 'true' }));
    c.addEventListener('click', (e) => { if (e.target.closest('.lib-chain-link[href]')) return; zoomOpen(c, r.run_id, r.headline); });
    c.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.closest('a')) { e.preventDefault(); zoomOpen(c, r.run_id, r.headline); } });
    cleanups.push(tilt(c, { max: 7, scale: 1.012 }));
    return c;
  }

  function render() {
    cleanups.forEach((f) => f()); cleanups = [];
    let list = runs.filter((r) => (state.status === 'all' || (state.status === 'running' ? isLive(r.status) : r.status === state.status))
      && (!state.q || `${r.headline} ${r.business} ${r.run_id}`.toLowerCase().includes(state.q)));
    const by = { new: (a, b) => (a.created < b.created ? 1 : -1), old: (a, b) => (a.created < b.created ? -1 : 1), crowd: (a, b) => b.crowd - a.crowd,
      status: (a, b) => (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9) || (a.created < b.created ? 1 : -1) };
    list = list.slice().sort(by[state.sort]);
    count.textContent = `${list.length} of ${runs.length} runs`;
    cons?.highlight(list.length === runs.length ? null : new Set(list.map((r) => r.run_id)));
    if (!list.length) {
      mount(results, h('div.empty', runs.length ? 'No runs match these filters.' : ['No runs yet. ', h('a', { href: '#/' }, 'Start a new test.')]));
      return;
    }
    let cards;
    if (state.mode === 'grid') {
      const grid = h('div.lib-grid', list.map(card));
      mount(results, grid); cards = [...grid.children];
    } else {
      const groups = new Map();
      for (const r of list) { const d = dayLabel(r.created); (groups.get(d) || groups.set(d, []).get(d)).push(r); }
      const tl = h('div.lib-timeline', [...groups].map(([d, rs]) => h('section.lib-day', h('h2.lib-day-h', h('span', d), h('em', `${rs.length} run${rs.length > 1 ? 's' : ''}`)),
        h('div.lib-tl', rs.map((r) => h('div.lib-tl-item', h('i.lib-tl-node.' + statusTone(r.status)), card(r)))))));
      mount(results, tl); cards = [...tl.querySelectorAll('.lib-card')];
    }
    stagger(cards, { y: 20, gap: 40, ms: 520, scale: 0.98 });
  }

  const empty = () => mount(results, h('div.empty', ['No runs yet. ', h('a', { href: '#/' }, 'Start a new test.')]));
  const constHost = h('div.lib-const-host'), constLabels = h('div.lib-const-labels', { 'aria-hidden': 'true' }), constTip = h('div.lib-const-tip', { hidden: true });
  const constCard = h('section.card.lib-const', { hidden: true },
    h('div.lib-const-head', h('h2', 'Run constellation'),
      h('div.lib-const-key', h('span', h('i.a'), h('i.b'), 'twin worlds A / B'), h('span', h('i.ring.good'), 'done'), h('span', h('i.ring.live'), 'live'), h('span', h('i.ring.bad'), 'error'), h('span.muted', 'size = crowd'))),
    h('div.lib-const-stage', constHost, constLabels, constTip));
  el.append(h('div.view-page.lib-page',
    h('header.lib-hero', h('div.lib-hero-text', h('h1', 'Runs'), h('p.muted', 'Every Dry Run on this machine. Open one to replay its twin worlds, verdict and report.')),
      h('a.btn.primary', { href: '#/' }, 'New test')),
    constCard,
    h('div.lib-toolbar', search, h('div.lib-selects', statusSel, sortSel), h('div.lib-seg', { role: 'group', 'aria-label': 'Layout' }, modeBtns), count),
    results));
  mount(results, h('div.lib-grid', Array.from({ length: 6 }, () => h('div.card.lib-card.lib-skel'))));

  api('/api/runs').then((list) => {
    if (dead) return;
    runs = Array.isArray(list) ? list : [];
    for (const r of runs) if (r.parent) kids.set(r.parent, (kids.get(r.parent) || 0) + 1);
    if (runs.length) {
      constCard.hidden = false;
      cons = constellation(constHost, constLabels, constTip, runs, (r) => zoomOpen(results.querySelector(`.lib-card[data-id="${r.run_id}"]`) || constCard, r.run_id, r.headline));
      render();
    } else empty();
  }).catch((e) => { if (!dead) mount(results, h('div.banner.bad', e.message)); });

  return () => { dead = true; clearTimeout(searchT); cleanups.forEach((f) => f()); cleanups = []; cons?.dispose(); cons = null; };
}

/* Crowd stage: who was sampled, and from where.
 * Hero: a three.js constellation (one glowing point per persona) that morphs between four layouts.
 * Panels: counters, age + income distributions (crowd share vs natural share), customer copula heatmap, queries.
 * Everything is computed from S.personas; natural shares come only from S.sample.marginals.
 * Without WebGL the hero falls back to an SVG scatter that morphs with CSS transitions. */
import { h, s, mount, clear, pct, fmtInt, cssVar, AGE_BANDS, INCOME_BANDS } from '../../core/dom.js';
import { openAgent, openQuery } from '../../core/ui.js';
import { countUp, reduced, EASE } from '../../core/motion.js';
import { createStage } from '../../core/three-kit.js';

/* ------------------------------------------------------------------ helpers */
const fin = (v) => (v == null || v === '' || !Number.isFinite(+v) ? null : +v);
const dash = (v, f = (x) => x) => (v == null ? '-' : f(v));
const rnd = (i, k = 0) => { const x = Math.sin((i + 1) * 127.1 + k * 311.7) * 43758.5453; return x - Math.floor(x); };
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const expoOut = (k) => (k >= 1 ? 1 : 1 - Math.pow(2, -10 * k));
const LAYOUTS = [['sphere', 'Sphere'], ['age', 'By age'], ['income', 'By income'], ['traits', 'Traits']];
const TRAITS = [['price_sensitivity', 'Price sensitivity'], ['skepticism', 'Skepticism'], ['susceptibility', 'Susceptibility']];

/** Keys for a categorical field: the known bands first, then anything else seen, then "-" for missing. */
function keysFor(ps, field, base, extra = []) {
  const keys = [...base];
  for (const v of [...ps.map((p) => p[field]), ...extra]) if (v != null && !keys.includes(v)) keys.push(v);
  if (ps.some((p) => p[field] == null)) keys.push('-');
  return keys;
}
const catOf = (p, field) => (p[field] == null ? '-' : p[field]);

/* ------------------------------------------------------------------ layouts (shared by the 3D and SVG views) */
function buildLayouts(ps, sample) {
  const out = {};
  // sphere: core inner shell, spillover outer shell (fibonacci spiral)
  {
    const pos = [], core = [], spill = [];
    ps.forEach((p, i) => (p.role === 'core' ? core : spill).push(i));
    const place = (idxs, R) => idxs.forEach((i, j) => {
      const m = idxs.length, y = 1 - ((j + 0.5) / m) * 2, r = Math.sqrt(Math.max(0, 1 - y * y)), th = j * 2.399963, rr = R * (1 + (rnd(i) - 0.5) * 0.07);
      pos[i] = [Math.cos(th) * r * rr, y * rr, Math.sin(th) * r * rr];
    });
    place(core, 2.3); place(spill, 3.7);
    const labels = [];
    if (core.length) labels.push({ t: 'Core', sub: `${core.length}`, p: [0, 2.7, 0], c: 'core' });
    if (spill.length) labels.push({ t: 'Spillover', sub: `${spill.length}`, p: [0, 4.15, 0], c: 'spill' });
    out.sphere = { pos, labels, lines: [] };
  }
  // columns: a 3D bar chart of stacked people, one column per band
  const columns = (field, base, extra) => {
    const keys = keysFor(ps, field, base, extra), K = keys.length, cnt = new Map(keys.map((k) => [k, 0]));
    ps.forEach((p) => cnt.set(catOf(p, field), cnt.get(catOf(p, field)) + 1));
    const maxN = Math.max(1, ...cnt.values());
    const side = clamp(Math.ceil(Math.sqrt(maxN / 9)), 4, 8), per = side * side, sp = Math.min(0.3, 1.5 / side), lh = 0.28;
    const colW = Math.min(1.75, 11 / K), layers = Math.ceil(maxN / per), y0 = -(layers * lh) / 2 - 0.2;
    const seen = new Map(keys.map((k) => [k, 0]));
    const pos = ps.map((p) => {
      const k = catOf(p, field), j = seen.get(k); seen.set(k, j + 1);
      const cell = j % per, layer = Math.floor(j / per), ki = keys.indexOf(k);
      return [(ki - (K - 1) / 2) * colW + ((cell % side) - (side - 1) / 2) * sp, y0 + layer * lh, (Math.floor(cell / side) - (side - 1) / 2) * sp];
    });
    const labels = keys.map((k, ki) => ({ t: String(k), sub: ps.length ? `${Math.round((cnt.get(k) / ps.length) * 100)}%` : '', p: [(ki - (K - 1) / 2) * colW, y0 - 0.55, 0], c: 'col' }));
    const w = (K * colW) / 2;
    return { pos, labels, lines: [[-w, y0 - 0.12, 0, w, y0 - 0.12, 0]] };
  };
  out.age = columns('age_band', AGE_BANDS, Object.keys(sample?.marginals?.age || {}));
  out.income = columns('income_band', INCOME_BANDS, Object.keys(sample?.marginals?.income || {}));
  // traits: 3D scatter
  {
    const ranges = TRAITS.map(([f]) => {
      const v = ps.map((p) => fin(p[f])).filter((x) => x != null);
      let lo = v.length ? Math.min(...v) : 0, hi = v.length ? Math.max(...v) : 1;
      let norm = false;
      if (lo >= 0 && hi <= 1) { lo = 0; hi = 1; } else { norm = true; if (hi === lo) hi = lo + 1; }
      return { lo, hi, norm };
    });
    let missing = 0;
    const pos = ps.map((p) => {
      let miss = false;
      const v = TRAITS.map(([f], k) => { const x = fin(p[f]); if (x == null) { miss = true; return 0; } return ((x - ranges[k].lo) / (ranges[k].hi - ranges[k].lo)) * 6 - 3; });
      if (miss) missing++;
      return v;
    });
    const L = 3, o = -3, lines = [
      [o, o, o, L, o, o], [o, o, o, o, L, o], [o, o, o, o, o, L],
      [L, o, o, L, L, o], [L, o, o, L, o, L], [o, L, o, L, L, o], [o, L, o, o, L, L], [o, o, L, L, o, L], [o, o, L, o, L, L], [L, L, o, L, L, L], [L, o, L, L, L, L], [o, L, L, L, L, L],
    ];
    const labels = [
      { t: 'Price sensitivity', sub: ranges[0].norm ? 'min to max' : '0 to 1', p: [3.6, -3.2, -3], c: 'axis' },
      { t: 'Skepticism', sub: ranges[1].norm ? 'min to max' : '0 to 1', p: [-3.2, 3.6, -3], c: 'axis' },
      { t: 'Susceptibility', sub: ranges[2].norm ? 'min to max' : '0 to 1', p: [-3.2, -3.4, 3.7], c: 'axis' },
    ];
    out.traits = { pos, labels, lines, missing };
  }
  return out;
}

/* ------------------------------------------------------------------ 3D point shader */
const VERT = `attribute float aSize; attribute float aRing; attribute float aAlpha; attribute vec3 aColor;
uniform float uScale; varying vec3 vC; varying float vR; varying float vA;
void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = max(2.0, aSize * uScale / -mv.z); gl_Position = projectionMatrix * mv; vC = aColor; vR = aRing; vA = aAlpha; }`;
const FRAG = `uniform vec3 uRing; varying vec3 vC; varying float vR; varying float vA;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0; if (d > 1.0) discard;
  float body = smoothstep(0.62, 0.5, d), glow = pow(1.0 - d, 2.2) * 0.5, ring = vR * (1.0 - smoothstep(0.0, 0.1, abs(d - 0.82)));
  vec3 col = mix(vC * (1.0 + body * 0.25), uRing, ring);
  float a = clamp(body + glow + ring, 0.0, 1.0) * vA; if (a < 0.01) discard;
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}`;

function makeCloud(THREE, n, ringCol) {
  const geo = new THREE.BufferGeometry();
  const a = { pos: new Float32Array(n * 3), size: new Float32Array(n), ring: new Float32Array(n), alpha: new Float32Array(n).fill(1), col: new Float32Array(n * 3) };
  geo.setAttribute('position', new THREE.BufferAttribute(a.pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aSize', new THREE.BufferAttribute(a.size, 1).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aRing', new THREE.BufferAttribute(a.ring, 1));
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(a.alpha, 1).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aColor', new THREE.BufferAttribute(a.col, 3));
  const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, uniforms: { uScale: { value: 600 }, uRing: { value: new THREE.Color(ringCol) } } });
  const pts = new THREE.Points(geo, mat); pts.frustumCulled = false;
  return { pts, geo, mat, ...a };
}
const toColor = (THREE, css, fallback) => { const c = new THREE.Color(); try { c.set(css || fallback); } catch { c.set(fallback); } return c; };

/* sizes by influence (world diameter), missing influence sits mid-range */
function baseSizes(ps) {
  const v = ps.map((p) => fin(p.influence)), ok = v.filter((x) => x != null);
  const lo = ok.length ? Math.min(...ok) : 0, hi = ok.length ? Math.max(...ok) : 1;
  return v.map((x) => 0.26 + 0.3 * (x == null || hi === lo ? 0.4 : (x - lo) / (hi - lo)));
}

/* ------------------------------------------------------------------ 3D view */
async function createThreeView(host, cb) {
  const st = await createStage(host, { camera: { fov: 45, y: 2.2, z: 13 }, controls: { autoRotate: !reduced(), autoRotateSpeed: 0.55, minDistance: 5, maxDistance: 26 } });
  if (!st) return null;
  const { THREE, camera, canvas, scene } = st;
  let cloud = null, ghost = null, data = null, colors = null;
  let from = null, to = null, delay = null, dur = 1.3, swirl = null, pending = false, t0 = 0, enter = false, anim = false, baseSize = [], hoverI = -1;
  let guide = null, guideTarget = 0;
  const filterTarget = [];
  const tmp = new THREE.Vector3();

  // guide lines (axes, box, floor) swapped per layout
  {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(40 * 6), 3)); g.setDrawRange(0, 0);
    guide = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x8890aa, transparent: true, opacity: 0, depthWrite: false })); guide.frustumCulled = false; scene.add(guide);
  }
  const setGuide = (lines) => {
    const arr = guide.geometry.attributes.position.array; let n = 0;
    for (const l of lines.slice(0, 40)) { arr.set(l, n * 6); n++; }
    guide.geometry.attributes.position.needsUpdate = true; guide.geometry.setDrawRange(0, n * 2);
    guide.material.opacity = 0; guideTarget = n ? 0.4 : 0;
  };

  // ghost "sampling" cloud: a Census-like grid that condenses into a sphere and relaxes again
  const ghostGrid = [], ghostSph = [];
  function makeGhost() {
    const n = 420; ghost = makeCloud(THREE, n, '#4fe3c1');
    const c = toColor(THREE, cssVar('--accent'), '#8f7bff');
    for (let i = 0; i < n; i++) {
      const gc = i % 28, gr = Math.floor(i / 28);
      ghostGrid[i] = [(gc - 13.5) * 0.34, -2 + (rnd(i) - 0.5) * 0.15, (gr - 7) * 0.34];
      const y = 1 - ((i + 0.5) / n) * 2, r = Math.sqrt(1 - y * y), th = i * 2.399963, R = 2.2 + (rnd(i, 2) - 0.5) * 0.3;
      ghostSph[i] = [Math.cos(th) * r * R, y * R, Math.sin(th) * r * R];
      ghost.size[i] = 0.2; ghost.col.set([c.r, c.g, c.b], i * 3);
    }
    scene.add(ghost.pts);
  }
  function setSampling(on) {
    if (on && !ghost && !cloud) makeGhost();
    if (!on && ghost) { const g = ghost; ghost = null; g.fading = 1; fading.push(g); }
  }
  const fading = [];

  // data -> points
  function setData(ps, layouts, cols, layoutKey, animate) {
    data = { ps, layouts }; colors = cols;
    if (cloud) { scene.remove(cloud.pts); cloud.geo.dispose(); cloud.mat.dispose(); }
    cloud = makeCloud(THREE, ps.length, cols.cust);
    baseSize = baseSizes(ps);
    paintColors();
    const L = layouts[layoutKey];
    from = new Float32Array(ps.length * 3); to = new Float32Array(ps.length * 3); delay = new Float32Array(ps.length); swirl = new Float32Array(ps.length * 3);
    ps.forEach((_, i) => { to.set(L.pos[i], i * 3); swirl.set([rnd(i, 3) - 0.5, rnd(i, 4) - 0.5, rnd(i, 5) - 0.5], i * 3); delay[i] = animate ? rnd(i, 6) * 0.9 + i * 0.002 : 0; });
    enter = animate && !reduced(); dur = enter ? 1.7 : 0.01;
    cloud.pos.set(enter ? from : to); cloud.size.fill(enter ? 0 : 1);
    ps.forEach((_, i) => { cloud.size[i] = enter ? 0 : baseSize[i]; filterTarget[i] = 1; });
    cloud.pts.visible = true; scene.add(cloud.pts);
    pending = true; anim = enter; if (!enter) cloud.pos.set(to);
    setGuide(L.lines);
    fit();
  }
  function paintColors() {
    if (!cloud || !data) return;
    const core = toColor(THREE, colors.core, '#8f7bff'), sp = toColor(THREE, colors.spill, '#9196ab');
    data.ps.forEach((p, i) => { const c = p.role === 'core' ? core : sp; cloud.col.set([c.r, c.g, c.b], i * 3); cloud.ring[i] = p.customer ? 1 : 0; });
    cloud.geo.attributes.aColor.needsUpdate = true; cloud.geo.attributes.aRing.needsUpdate = true;
    cloud.mat.uniforms.uRing.value = toColor(THREE, colors.cust, '#4fe3c1');
    guide.material.color = toColor(THREE, colors.line, '#8890aa');
  }
  function setLayout(key, animate = true) {
    if (!cloud || !data) return;
    const L = data.layouts[key];
    from = Float32Array.from(cloud.pos); data.ps.forEach((_, i) => { to.set(L.pos[i], i * 3); delay[i] = rnd(i, 7) * 0.4; });
    if (enter) { baseSize.forEach((b, i) => { cloud.size[i] = b; }); cloud.geo.attributes.aSize.needsUpdate = true; }
    enter = false; dur = animate && !reduced() ? 1.25 : 0.01; pending = true; anim = true;
    setGuide(L.lines);
  }
  function setFilter(pred) {
    if (!data) return;
    data.ps.forEach((p, i) => { filterTarget[i] = !pred || pred(p) ? 1 : 0.1; });
    if (reduced()) { filterTarget.forEach((v, i) => { cloud.alpha[i] = v; }); cloud.geo.attributes.aAlpha.needsUpdate = true; }
  }
  function fit() {
    const aspect = camera.aspect || 1.4, d = 13 / clamp(aspect / 1.25, 0.55, 1.2);
    camera.position.setLength(Math.hypot(0, 2.2, d));
  }

  // per-frame: morph, filter fade, ghost, uniforms
  const off = st.onFrame((t, dt) => {
    const sc = canvas.height / (2 * Math.tan((camera.fov * Math.PI) / 360));
    if (cloud) cloud.mat.uniforms.uScale.value = sc;
    if (ghost) ghost.mat.uniforms.uScale.value = sc;
    if (cloud && anim) {
      if (pending) { t0 = t; pending = false; }
      const el = t - t0; let done = true;
      for (let i = 0; i < baseSize.length; i++) {
        const k = clamp((el - delay[i]) / dur, 0, 1), e = expoOut(k), w = Math.sin(Math.PI * k) * 0.9;
        for (let a = 0; a < 3; a++) cloud.pos[i * 3 + a] = from[i * 3 + a] + (to[i * 3 + a] - from[i * 3 + a]) * e + swirl[i * 3 + a] * w;
        if (enter) cloud.size[i] = baseSize[i] * e * (i === hoverI ? 1.5 : 1);
        if (k < 1) done = false;
      }
      cloud.geo.attributes.position.needsUpdate = true; cloud.geo.attributes.aSize.needsUpdate = true;
      if (done) { anim = false; enter = false; cloud.size.forEach((_, i) => { cloud.size[i] = baseSize[i] * (i === hoverI ? 1.5 : 1); }); cloud.geo.attributes.aSize.needsUpdate = true; }
    }
    if (cloud) {
      let ch = false;
      for (let i = 0; i < filterTarget.length; i++) { const d = filterTarget[i] - cloud.alpha[i]; if (Math.abs(d) > 0.004) { cloud.alpha[i] += d * Math.min(1, dt * 9); ch = true; } }
      if (ch) cloud.geo.attributes.aAlpha.needsUpdate = true;
    }
    guide.material.opacity += (guideTarget - guide.material.opacity) * Math.min(1, dt * 2.5);
    if (ghost) {
      const k = reduced() ? 0.5 : 0.5 - 0.5 * Math.cos(t * 1.05), e = k * k * (3 - 2 * k);
      for (let i = 0; i < ghostGrid.length; i++) for (let a = 0; a < 3; a++) ghost.pos[i * 3 + a] = ghostGrid[i][a] + (ghostSph[i][a] - ghostGrid[i][a]) * e;
      ghost.geo.attributes.position.needsUpdate = true; ghost.geo.attributes.aSize.needsUpdate = true;
    }
    for (let j = fading.length - 1; j >= 0; j--) {
      const g = fading[j]; g.fading -= dt * 2.2; g.alpha.fill(Math.max(0, g.fading)); g.geo.attributes.aAlpha.needsUpdate = true;
      if (g.fading <= 0) { scene.remove(g.pts); g.geo.dispose(); g.mat.dispose(); fading.splice(j, 1); }
    }
    cb.frame?.();
  });

  // picking: nearest projected point to the pointer
  const nearest = (cx, cy) => {
    if (!cloud || !data) return -1;
    const r = canvas.getBoundingClientRect(), px = cx - r.left, py = cy - r.top;
    let best = -1, bd = 1e9;
    for (let i = 0; i < baseSize.length; i++) {
      if (cloud.alpha[i] < 0.5 || cloud.size[i] <= 0) continue;
      tmp.set(cloud.pos[i * 3], cloud.pos[i * 3 + 1], cloud.pos[i * 3 + 2]).project(camera);
      if (tmp.z > 1) continue;
      const d = Math.hypot((tmp.x * 0.5 + 0.5) * r.width - px, (-tmp.y * 0.5 + 0.5) * r.height - py);
      if (d < Math.max(10, 12 - tmp.z * 2) && d < bd) { bd = d; best = i; }
    }
    return best;
  };
  const setHover = (i, x, y) => {
    if (i !== hoverI && cloud) {
      if (hoverI >= 0) cloud.size[hoverI] = baseSize[hoverI];
      if (i >= 0) cloud.size[i] = baseSize[i] * 1.5;
      cloud.geo.attributes.aSize.needsUpdate = true;
    }
    hoverI = i; canvas.style.cursor = i >= 0 ? 'pointer' : 'grab';
    cb.hover(i, x, y);
  };
  let raf = 0, down = null, lastEv = null;
  const onMove = (e) => {
    lastEv = e; if (raf || e.buttons) return;
    raf = requestAnimationFrame(() => { raf = 0; setHover(nearest(lastEv.clientX, lastEv.clientY), lastEv.clientX, lastEv.clientY); });
  };
  const onLeave = () => setHover(-1);
  const onDown = (e) => { down = { x: e.clientX, y: e.clientY }; setHover(-1); if (st.controls) st.controls.autoRotate = false; };
  const onUp = (e) => {
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6) { const i = nearest(e.clientX, e.clientY); if (i >= 0) cb.pick(i); }
    down = null; resumeSpin();
  };
  let spinT = 0;
  const resumeSpin = () => { clearTimeout(spinT); spinT = setTimeout(() => { if (st.controls && !reduced()) st.controls.autoRotate = true; }, 4000); };
  canvas.addEventListener('pointermove', onMove); canvas.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('pointerdown', onDown); canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('wheel', () => { if (st.controls) st.controls.autoRotate = false; resumeSpin(); }, { passive: true });
  canvas.style.cursor = 'grab'; canvas.style.touchAction = 'none';

  return {
    kind: '3d', setData, setLayout, setFilter, setSampling, repaint(cols) { colors = cols; paintColors(); },
    project(p) { tmp.set(p[0], p[1], p[2]).project(camera); return { x: (tmp.x * 0.5 + 0.5) * canvas.clientWidth, y: (-tmp.y * 0.5 + 0.5) * canvas.clientHeight, front: tmp.z < 1 }; },
    resize() { st.resize(); fit(); },
    dispose() {
      clearTimeout(spinT); cancelAnimationFrame(raf); off();
      canvas.removeEventListener('pointermove', onMove); canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('pointerdown', onDown); canvas.removeEventListener('pointerup', onUp);
      st.dispose();
    },
  };
}

/* ------------------------------------------------------------------ SVG fallback view (no WebGL) */
function createSvgView(host, cb) {
  const svg = s('svg', { class: 'cw-svg', role: 'img', 'aria-label': 'Crowd scatter' });
  host.append(svg);
  let W = 1, H = 1, circles = [], data = null, colors = null, layoutKey = 'sphere', filt = null;
  const view = (v) => { // fixed oblique projection of the 3D layout
    const yaw = 0.55, pitch = 0.3, x1 = v[0] * Math.cos(yaw) + v[2] * Math.sin(yaw), z1 = -v[0] * Math.sin(yaw) + v[2] * Math.cos(yaw);
    const y1 = v[1] * Math.cos(pitch) - z1 * Math.sin(pitch), z2 = v[1] * Math.sin(pitch) + z1 * Math.cos(pitch), k = Math.min(W / 11, H / 9.5) / (1 - z2 / 30);
    return { x: W / 2 + x1 * k, y: H / 2 - y1 * k, k, front: true };
  };
  const place = (animate) => {
    if (!data) return;
    const L = data.layouts[layoutKey], bs = baseSizes(data.ps);
    circles.forEach((c, i) => {
      const q = view(L.pos[i]);
      c.style.transitionDelay = animate && !reduced() ? `${Math.round(rnd(i, 7) * 350)}ms` : '0ms';
      c.style.transform = `translate(${q.x.toFixed(1)}px, ${q.y.toFixed(1)}px) scale(${(bs[i] * q.k * 0.5).toFixed(2)})`;
    });
  };
  const size = () => { W = host.clientWidth || 1; H = host.clientHeight || 1; svg.setAttribute('width', W); svg.setAttribute('height', H); place(false); cb.frame?.(); };
  const ro = new ResizeObserver(size); ro.observe(host);
  return {
    kind: 'svg',
    setData(ps, layouts, cols, key, animate) {
      data = { ps, layouts }; colors = cols; layoutKey = key; clear(svg); W = host.clientWidth || 1; H = host.clientHeight || 1;
      circles = ps.map((p, i) => {
        const c = s('circle', { r: 1, class: 'cw-c' }, s('title', {}, p.id));
        c.style.fill = p.role === 'core' ? cols.core : cols.spill; c.style.stroke = p.customer ? cols.cust : 'none'; c.style.strokeWidth = '0.28';
        c.style.transform = `translate(${W / 2}px, ${H / 2}px) scale(0)`;
        c.addEventListener('pointerenter', (e) => cb.hover(i, e.clientX, e.clientY)); c.addEventListener('pointermove', (e) => cb.hover(i, e.clientX, e.clientY));
        c.addEventListener('pointerleave', () => cb.hover(-1)); c.addEventListener('click', () => cb.pick(i));
        svg.append(c); return c;
      });
      requestAnimationFrame(() => place(animate)); cb.frame?.();
    },
    setLayout(key, animate = true) { layoutKey = key; place(animate); cb.frame?.(); },
    setFilter(pred) { filt = pred; circles.forEach((c, i) => { c.style.opacity = !pred || pred(data.ps[i]) ? 1 : 0.12; }); },
    setSampling() {}, repaint(cols) { colors = cols; circles.forEach((c, i) => { c.style.fill = data.ps[i].role === 'core' ? cols.core : cols.spill; c.style.stroke = data.ps[i].customer ? cols.cust : 'none'; }); },
    project(p) { return view(p); }, resize: size,
    dispose() { ro.disconnect(); svg.remove(); },
  };
}

/* ------------------------------------------------------------------ stage */
export default {
  id: 'crowd',
  mount(el, ctx) {
    const { S, bus } = ctx;
    let destroyed = false, visible = false, view = null, viewSig = '', panelSig = '', layoutKey = 'sphere', focus = null, hl = null, hoverIdx = -1;
    const offs = [];
    const colors = () => ({ core: cssVar('--accent'), spill: cssVar('--muted'), cust: cssVar('--accent-2'), line: cssVar('--faint') });

    /* ---- hero DOM */
    const seg = h('div.cw-seg', { role: 'group', 'aria-label': 'Layout' });
    const segInk = h('span.cw-seg-ink', { 'aria-hidden': 'true' });
    const segBtns = LAYOUTS.map(([k, label]) => h('button.cw-seg-b', { type: 'button', 'aria-pressed': String(k === layoutKey), 'data-k': k, onclick: () => setLayoutKey(k) }, label));
    seg.append(segInk, ...segBtns);
    const labelLayer = h('div.cw-labels', { 'aria-hidden': 'true' });
    const tip = h('div.cw-tip', { hidden: true });
    const sampName = h('b', 'Sampling the crowd');
    const sampDetail = h('span.cw-samp-detail');
    const sampFallback = h('div.cw-grid-fb', { 'aria-hidden': 'true' });
    for (let i = 0; i < 96; i++) {
      const c = i % 12, r = Math.floor(i / 12), dx = (5.5 - c) * 26, dy = (3.5 - r) * 26;
      sampFallback.append(h('i', { style: { '--dx': `${dx}px`, '--dy': `${dy}px`, '--d': `${Math.round((Math.hypot(5.5 - c, 3.5 - r)) * 90)}ms` } }));
    }
    const sampling = h('div.cw-sampling', h('div.cw-samp-text', h('span.cw-pulse'), sampName, sampDetail));
    const host = h('div.cw-host', labelLayer, sampFallback, tip, sampling);
    const legend = h('div.cw-legend');
    const hint = h('div.cw-hint');
    const heroSub = h('span.sub');
    const hero = h('section.card.cw-hero',
      h('header.cw-hero-top', h('div', h('h2', 'The crowd'), heroSub), seg),
      host, h('footer.cw-hero-bot', legend, hint));

    /* ---- panels */
    const panels = {};
    const expandIcon = () => s('svg', { viewBox: '0 0 24 24', width: 14, height: 14, fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, s('path', { d: 'M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7' }));
    function makePanel(id, title, sub) {
      const body = h('div.cw-body');
      const x = h('button.cw-x', { type: 'button', title: 'Expand', 'aria-label': `Expand ${title}`, onclick: () => (openId === id ? collapse() : expand(id)) }, expandIcon());
      const subEl = h('span.sub', sub || '');
      const elp = h('section.card.cw-panel.s-' + id, h('header.cw-ph', h('h3', title), subEl, x), body);
      return (panels[id] = { id, el: elp, body, subEl, x });
    }
    makePanel('stats', 'Who is in it', 'Counted from the sampled personas');
    makePanel('age', 'Age', '');
    makePanel('income', 'Household income', '');
    makePanel('copula', 'Customer copula', '');
    makePanel('queries', 'Queries behind it', 'Open the SQL and rows');

    const root = h('div.cw-root', hero, panels.stats.el, panels.age.el, panels.income.el, panels.copula.el, panels.queries.el);
    el.append(root);

    /* ---- expand / collapse a panel (FLIP on the box) */
    let openId = null, openState = null;
    function expand(id) {
      if (openId) return;
      const p = panels[id], rr = root.getBoundingClientRect(), a = p.el.getBoundingClientRect();
      const ph = h('div.cw-slot.s-' + id), scrim = h('div.cw-scrim', { onclick: collapse });
      p.el.before(ph); root.append(scrim, p.el); p.el.classList.add('xl'); p.x.setAttribute('aria-label', 'Close'); p.x.title = 'Close';
      openId = id; openState = { ph, scrim };
      const from = { left: `${a.left - rr.left}px`, top: `${a.top - rr.top}px`, width: `${a.width}px`, height: `${a.height}px` };
      if (!reduced()) {
        scrim.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, easing: EASE.out });
        p.el.animate([from, { left: '0px', top: '0px', width: `${rr.width}px`, height: `${rr.height}px` }], { duration: 560, easing: EASE.expo });
        [...p.body.querySelectorAll('.cw-detail')].forEach((d, i) => d.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 500, delay: 250 + i * 25, easing: EASE.out, fill: 'backwards' }));
      }
    }
    function collapse() {
      if (!openId) return;
      const p = panels[openId], { ph, scrim } = openState;
      openId = null; openState = null;
      const done = () => { p.el.classList.remove('xl'); ph.replaceWith(p.el); scrim.remove(); p.x.setAttribute('aria-label', `Expand ${p.id}`); p.x.title = 'Expand'; };
      if (reduced()) { done(); return; }
      const b = ph.getBoundingClientRect(), rr = root.getBoundingClientRect();
      scrim.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 260, fill: 'forwards' });
      p.el.animate([{ left: '0px', top: '0px', width: `${rr.width}px`, height: `${rr.height}px` }, { left: `${b.left - rr.left}px`, top: `${b.top - rr.top}px`, width: `${b.width}px`, height: `${b.height}px` }], { duration: 420, easing: EASE.inOut, fill: 'forwards' }).finished.then(done, done);
    }
    const onKey = (e) => { if (e.key === 'Escape' && openId) collapse(); };
    document.addEventListener('keydown', onKey);

    /* ---- hero: labels, tooltip, layout switch, filters */
    let labelSets = {};
    function buildLabels(layouts) {
      clear(labelLayer); labelSets = {};
      for (const [k] of LAYOUTS) {
        labelSets[k] = (layouts[k]?.labels || []).map((l) => {
          const e = h('div.cw-lab.' + l.c, h('span', l.t), l.sub ? h('small', l.sub) : null); labelLayer.append(e); return { e, p: l.p };
        });
      }
      activateLabels();
    }
    function activateLabels() {
      for (const [k, list] of Object.entries(labelSets)) list.forEach((l, i) => { l.e.style.transitionDelay = k === layoutKey ? `${300 + i * 50}ms` : '0ms'; l.e.classList.toggle('on', k === layoutKey); });
      placeLabels();
    }
    function placeLabels() {
      if (!view) return;
      for (const l of labelSets[layoutKey] || []) {
        const q = view.project(l.p);
        l.e.style.transform = `translate(${q.x.toFixed(1)}px, ${q.y.toFixed(1)}px) translate(-50%, -50%)`;
        l.e.style.visibility = q.front ? '' : 'hidden';
      }
    }
    function moveInk() {
      const b = segBtns.find((x) => x.dataset.k === layoutKey);
      if (b && b.offsetWidth) { segInk.style.width = `${b.offsetWidth}px`; segInk.style.transform = `translateX(${b.offsetLeft}px)`; segInk.style.opacity = 1; }
    }
    function setLayoutKey(k) {
      layoutKey = k; segBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.k === k)));
      moveInk(); activateLabels(); view?.setLayout(k, true); updateHint();
    }
    function showTip(i, x, y) {
      hoverIdx = i;
      const p = S.personas[i];
      if (!p || i < 0) { tip.hidden = true; return; }
      const bar = (label, v) => (fin(v) == null ? null : h('div.cw-tb', h('span', label), h('i', h('u', { style: { width: `${clamp(+v, 0, 1) * 100}%` } })), h('b.mono', (+v).toFixed(2))));
      mount(tip, h('div.cw-tip-h', h('b.mono', p.id), h('span.chip' + (p.role === 'core' ? '.on' : ''), p.role || '-'), p.customer ? h('span.chip.good', 'customer') : null),
        h('div.cw-tip-l', `${dash(p.age)} yrs, ${dash(p.age_band)}`), h('div.cw-tip-l', dash(p.income_band)), p.segment ? h('div.cw-tip-s', p.segment) : null,
        h('div.cw-tip-bars', bar('price sens.', p.price_sensitivity), bar('skeptic', p.skepticism), bar('suscept.', p.susceptibility), bar('speaks', p.speak_p)),
        h('div.cw-tip-f', 'click to open'));
      tip.hidden = false;
      const r = host.getBoundingClientRect(), w = tip.offsetWidth || 200, hh = tip.offsetHeight || 140;
      tip.style.transform = `translate(${clamp(x - r.left + 16, 6, Math.max(6, r.width - w - 6))}px, ${clamp(y - r.top + 16, 6, Math.max(6, r.height - hh - 6))}px)`;
    }
    const cb = { hover: showTip, pick: (i) => { const p = S.personas[i]; if (p) openAgent(p.id); }, frame: placeLabels };

    function applyFilter() {
      const preds = [];
      if (focus === 'core') preds.push((p) => p.role === 'core');
      if (focus === 'spill') preds.push((p) => p.role !== 'core');
      if (focus === 'cust') preds.push((p) => !!p.customer);
      if (hl) preds.push(hl);
      view?.setFilter(preds.length ? (p) => preds.every((f) => f(p)) : null);
    }
    function setHl(pred) { hl = pred; applyFilter(); }

    function renderLegend(ps) {
      const core = ps.filter((p) => p.role === 'core').length, cust = ps.filter((p) => p.customer).length;
      const chip = (k, label, n, dot) => h('button.chip.cw-lg' + (focus === k ? '.on' : ''), { type: 'button', 'aria-pressed': String(focus === k), title: 'Highlight these people', onclick: () => { focus = focus === k ? null : k; renderLegend(S.personas); applyFilter(); } }, h('i.cw-dot', { style: { '--c': dot } }), `${label} `, h('b', fmtInt(n)));
      mount(legend, ps.length ? [chip('core', 'Core', core, 'var(--accent)'), chip('spill', 'Spillover', ps.length - core, 'var(--muted)'), chip('cust', 'Customers', cust, 'var(--accent-2)')] : null);
    }
    function updateHint() {
      const L = viewLayouts?.[layoutKey], base = 'Size = influence. Drag to orbit, scroll to zoom, click a point to open the person.';
      hint.textContent = layoutKey === 'traits' && L?.missing ? `${base} ${L.missing} people lack a trait value and sit on the axes' origin.` : base;
    }

    /* ---- hero data sync */
    let viewLayouts = null, viewPending = true;
    function syncHero() {
      const ps = S.personas || [];
      const has = ps.length > 0;
      sampling.classList.toggle('on', !has); host.classList.toggle('samp', !has);
      sampling.classList.toggle('still', S.status === 'error' && !has);
      if (!has) {
        const err = S.status === 'error';
        sampName.textContent = err ? 'The run stopped before the crowd was sampled' : 'Sampling the crowd';
        sampDetail.textContent = err ? (S.error || '') : (S.detail || 'Joining Census and Pew, then drawing people from the joint distribution.');
        heroSub.textContent = err ? 'No crowd to show' : 'Waiting for the sample';
        mount(legend); mount(hint); tip.hidden = true;
        if (view && !err) view.setSampling(true); else view?.setSampling(false);
        viewSig = '';
        return;
      }
      heroSub.textContent = `${fmtInt(ps.length)} people, one point each`;
      const sig = `${ps.length}:${ps[0].id}:${ps[ps.length - 1].id}`;
      if (sig === viewSig) return;
      viewSig = sig;
      viewLayouts = buildLayouts(ps, S.sample);
      buildLabels(viewLayouts); renderLegend(ps); updateHint();
      if (view) { view.setSampling(false); view.setData(ps, viewLayouts, colors(), layoutKey, true); applyFilter(); placeLabels(); }
    }
    async function initView() {
      let v = null;
      try { v = await createThreeView(host, cb); } catch (e) { console.warn('crowd: 3D view failed, using 2D', e); }
      if (!v) { host.classList.add('fb'); v = createSvgView(host, cb); }
      if (destroyed) { v.dispose(); return; }
      view = v; host.dataset.view = v.kind;
      if (!(S.personas || []).length) { v.setSampling(true); return; }
      v.setData(S.personas, viewLayouts, colors(), layoutKey, true); applyFilter(); placeLabels();
    }

    /* ---- panels render */
    const dashBody = (txt) => h('div.cw-wait', h('div.cw-skel'), h('div.cw-skel.s'), h('div.cw-skel.m'), h('small', txt));
    function renderStats(ps, sr) {
      const b = panels.stats.body;
      if (!ps.length) { mount(b, dashBody(S.status === 'error' ? 'No crowd was sampled.' : 'Counts appear once the crowd is sampled.')); return; }
      const core = ps.filter((p) => p.role === 'core').length, cust = ps.filter((p) => p.customer).length, share = core / ps.length;
      const val = (n, f) => { const e = h('b', '-'); countUp(e, n, f); return e; };
      const tick = (v, cls, label) => (fin(v) == null ? null : h('u.' + cls, { title: `${label} ${pct(v)}`, style: { left: `${clamp(v, 0, 1) * 100}%` } }));
      const split = h('div.cw-split', h('i', { style: { width: `${share * 100}%` } }), tick(sr.target_core_share, 'tgt', 'Target core share'), tick(sr.natural_core_share, 'nat', 'Natural core share'));
      if (!reduced()) split.firstChild.animate([{ transform: 'scaleX(0)' }, { transform: 'none' }], { duration: 1000, easing: EASE.expo, fill: 'backwards', delay: 200 });
      mount(b,
        h('div.cw-stats',
          h('div.cw-stat', h('span.l', 'People'), val(ps.length, (x) => fmtInt(Math.round(x))), h('small', fin(S.spec?.crowdSize) != null ? `requested ${fmtInt(S.spec.crowdSize)}` : '')),
          h('div.cw-stat', h('span.l', 'Core / spillover'), val(core, (x) => `${Math.round(x)} / ${Math.round(ps.length - x)}`), h('small', `${pct(share, 0)} core`)),
          h('div.cw-stat', h('span.l', 'Existing customers'), val(cust, (x) => fmtInt(Math.round(x))), h('small', cust ? 'from the synthetic demo list' : 'none in this crowd')),
          h('div.cw-stat', h('span.l', 'Voice fallbacks'), fin(sr.voice_fallbacks) == null ? h('b', '-') : val(+sr.voice_fallbacks, (x) => fmtInt(Math.round(x))), h('small', fin(sr.voice_rejected) == null ? 'rejected: -' : `${fmtInt(sr.voice_rejected)} rejected`))),
        h('div.cw-core', h('div.row.spread', h('small', 'Core share of the crowd'), h('small.mono', `${pct(share, 0)}${fin(sr.target_core_share) != null ? ` | target ${pct(sr.target_core_share, 0)}` : ''}${fin(sr.natural_core_share) != null ? ` | natural ${pct(sr.natural_core_share, 0)}` : ''}`)), split,
          h('div.cw-detail.expl', 'Fill: share of core people in the sample. Ticks: the target share and the natural share in the data (when the run reports them).')),
        fin(sr.instagram_users_est) != null ? h('div.cw-ig', h('span.l', 'Audience estimate'), val(+sr.instagram_users_est, (x) => fmtInt(Math.round(x))), h('small', 'Instagram users (Census x Pew join)')) : h('div.cw-ig.off', h('small', 'No audience estimate in this run.')));
    }
    function renderDist(id, title, ps, keys, field, nat) {
      const p = panels[id], hasNat = nat && typeof nat === 'object' && Object.keys(nat).length > 0;
      if (!ps.length) { mount(p.body, dashBody('Shares appear once the crowd is sampled.')); p.subEl.textContent = ''; return; }
      const cnt = keys.map((k) => ps.filter((q) => catOf(q, field) === k).length), shares = cnt.map((c) => c / ps.length);
      const natV = keys.map((k) => (hasNat ? fin(nat[k]) : null));
      const sc = 0.94 / Math.max(0.01, ...shares, ...natV.filter((x) => x != null));
      p.subEl.textContent = hasNat ? 'Bar: crowd. Tick: natural share.' : 'Bar: crowd. No natural share in this run.';
      const cap = h('div.cw-cap', hasNat ? 'Hover a row. Bars are scaled to the largest share.' : 'The run reports no natural shares for this field, so only the crowd is shown.');
      const dflt = cap.textContent;
      const rows = keys.map((k, i) => {
        const fill = h('i', { style: { width: `${shares[i] * sc * 100}%` } });
        const tk = natV[i] != null ? h('u', { title: `Natural share ${pct(natV[i])}`, style: { left: `${natV[i] * sc * 100}%` } }) : null;
        const v = h('b.mono', '0%'); countUp(v, shares[i] * 100, (x) => `${x.toFixed(0)}%`);
        const diff = natV[i] != null ? (shares[i] - natV[i]) * 100 : null;
        const row = h('div.cw-row', { tabindex: 0, onpointerenter: on, onfocus: on, onpointerleave: off, onblur: off },
          h('span.k', k), h('div.track', fill, tk), h('span.v', v, natV[i] != null ? h('small.mono', ` / ${pct(natV[i], 0)}`) : null),
          h('span.cw-detail.d.mono', `n=${cnt[i]}${diff != null ? `  ${diff >= 0 ? '+' : ''}${diff.toFixed(1)} pp` : ''}`));
        function on() {
          row.classList.add('hl');
          cap.textContent = `${k}: ${cnt[i]} of ${ps.length} people (${pct(shares[i])})${natV[i] != null ? `, natural share ${pct(natV[i])} (${diff >= 0 ? '+' : ''}${diff.toFixed(1)} pp)` : ''}`;
          setHl((q) => catOf(q, field) === k);
        }
        function off() { row.classList.remove('hl'); cap.textContent = dflt; setHl(null); }
        if (!reduced()) {
          fill.animate([{ transform: 'scaleX(0)' }, { transform: 'none' }], { duration: 950, delay: 120 + i * 70, easing: EASE.expo, fill: 'backwards' });
          tk?.animate([{ opacity: 0, transform: 'scaleY(0)' }, { opacity: 1, transform: 'none' }], { duration: 400, delay: 700 + i * 70, easing: EASE.out, fill: 'backwards' });
        }
        return row;
      });
      mount(p.body, h('div.cw-dist', rows), cap);
    }
    function renderCopula(ps, sr) {
      const p = panels.copula, cop = sr.copula;
      if (!cop || !Array.isArray(cop.corr) || !Array.isArray(cop.columns)) {
        p.subEl.textContent = ''; mount(p.body, ps.length ? h('div.empty.cw-empty', 'No customer copula in this run (no customer list was joined).') : dashBody('The correlation matrix appears once customers are modelled.')); return;
      }
      p.subEl.textContent = `n = ${fmtInt(cop.n)}`;
      const n = cop.columns.length, cells = [], cap = h('div.cw-cap', 'Hover a cell for the pair. Violet = positive, orange = negative.');
      const dflt = `${cop.columns.join(' | ')}`; cap.title = dflt;
      const grid = h('div.cw-corr', { style: { '--n': n }, onpointerleave: () => { cells.flat().forEach((c) => c.classList.remove('hl', 'hx')); cap.textContent = 'Hover a cell for the pair. Violet = positive, orange = negative.'; } });
      grid.append(h('i.cw-corner'));
      cop.columns.forEach((c) => grid.append(h('span.cw-ch', { title: c }, c)));
      cop.corr.forEach((row, r) => {
        grid.append(h('span.cw-rh', { title: cop.columns[r] }, cop.columns[r]));
        cells[r] = row.map((v, c) => {
          const num = fin(v);
          const cell = h('div.cw-cell', { style: { background: num == null ? 'var(--panel-2)' : `color-mix(in srgb, ${num >= 0 ? 'var(--accent)' : 'var(--b)'} ${Math.round(Math.min(1, Math.abs(num)) * 78)}%, var(--panel-2))` }, onpointerenter: () => {
            cells.forEach((rr, ri) => rr.forEach((cc, ci) => { cc.classList.toggle('hl', ri === r && ci === c); cc.classList.toggle('hx', (ri === r || ci === c) && !(ri === r && ci === c)); }));
            cap.textContent = `${cop.columns[r]} x ${cop.columns[c]}: ${num == null ? '-' : num.toFixed(2)}`;
          } }, num == null ? '-' : num.toFixed(2));
          if (!reduced()) cell.animate([{ opacity: 0, transform: 'scale(.6)' }, { opacity: 1, transform: 'none' }], { duration: 520, delay: 150 + (r + c) * 45, easing: EASE.expo, fill: 'backwards' });
          grid.append(cell); return cell;
        });
      });
      mount(p.body, grid, cap);
    }
    function renderQueries(ps, sr) {
      const qs = Array.isArray(sr.queries) ? sr.queries : [];
      mount(panels.queries.body, qs.length ? h('div.chips', qs.map((q, i) => { const c = h('button.chip.qid', { type: 'button', title: `${q.label || q.query_id} (${q.engine || '?'}) - ${q.query_id}`, onclick: () => openQuery(q.query_id) }, q.label || q.query_id); if (!reduced()) c.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 500, delay: 200 + i * 50, easing: EASE.expo, fill: 'backwards' }); return c; }))
        : h('small.muted', ps.length ? 'No queries were recorded for this crowd.' : 'Queries appear once the crowd is sampled.'));
    }
    function syncPanels() {
      const ps = S.personas || [], sr = S.sample || {};
      const sig = `${ps.length}:${ps[0]?.id}:${JSON.stringify(sr)}:${S.status === 'error'}`;
      if (sig === panelSig) return; panelSig = sig;
      renderStats(ps, sr);
      renderDist('age', 'Age', ps, keysFor(ps, 'age_band', AGE_BANDS, Object.keys(sr.marginals?.age || {})), 'age_band', sr.marginals?.age);
      renderDist('income', 'Household income', ps, keysFor(ps, 'income_band', INCOME_BANDS, Object.keys(sr.marginals?.income || {})), 'income_band', sr.marginals?.income);
      renderCopula(ps, sr); renderQueries(ps, sr);
    }
    const sync = () => { if (destroyed) return; syncPanels(); syncHero(); };

    /* ---- wire up */
    offs.push(bus.on('crowd', sync), bus.on('snapshot', sync), bus.on('status', () => { if (!(S.personas || []).length) syncHero(); }), bus.on('error', sync));
    sync();
    initView();
    const ro = new ResizeObserver(() => moveInk()); ro.observe(seg);

    return {
      show() {
        visible = true;
        requestAnimationFrame(() => { moveInk(); view?.resize(); view?.repaint?.(colors()); placeLabels(); });
        sync();
      },
      hide() { visible = false; tip.hidden = true; if (openId) collapse(); },
      destroy() {
        destroyed = true; offs.forEach((f) => f()); document.removeEventListener('keydown', onKey); ro.disconnect();
        view?.dispose(); view = null;
      },
    };
  },
};

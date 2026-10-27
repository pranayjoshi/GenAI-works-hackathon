/* Twin worlds stage. Layout (desktop): one grid, so both worlds share every row edge:
 *   [World A head | duel | World B head] [post | duel | post] [counters | duel | counters] [meter | duel | meter]
 *   [filter + search toolbar, full width] [phone A | phone B]
 * Below 820px one world shows at a time (flip toggle with a 3D card turn). The duel is two planets (three.js, 2D canvas
 * fallback): size and orbiting dots follow deciders, glow follows intent rate, the beam's thickness follows the gap. Counters come from S.counters[wid] only; a dash
 * means "not reported yet". Ported from legacy/app.js buildWorlds / updateCounters / feedCard / addAction / renderInject. */
import { h, s, mount, pct, fmtInt, fmtInt as fmtIntRaw, avatar, actPill, reasonLines, variantChip, vcolor, roundTime, cssVar, ICONS } from '../../core/dom.js';
import { countUp, tilt, reduced, stagger, EASE } from '../../core/motion.js';
import { createStage, dotTexture } from '../../core/three-kit.js';
import { api, fail } from '../../core/api.js';
import { toast, openAgent } from '../../core/ui.js';

const FILTERS = [['all', 'All'], ['engaged', 'Engaged only'], ['comment', 'Comments'], ['share', 'Shares'], ['hide', 'Hides']];
const icon = (d) => s('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' }, s('path', { d }));
const colorOf = (v, fallback) => cssVar(`--${String(v).toLowerCase()}`) || fallback;

/* ------------------------------------------------------------------ duel planets (three.js, 2D fallback) */
/* Each world is a planet. Encodings (all from S.counters, nothing invented):
 *   planet size + orbiting dots = deciders (one dot per decider; bright dots = intended to act)
 *   atmosphere glow = intent rate
 *   beam between the planets: thickness = intent-rate gap, flow runs from the leader, the bead sits at the tug share.
 * set([{has, size 0..1, glow 0..1, n, k}, ...]), burst(i, action), show(), hide(), theme(), dispose() */
const RING_MAX = 500, PX = 1.4;
function makeDuel(host, getCols, isDead) {
  let impl = null, disposed = false, pending = null, shownNow = false;
  const labels = [0, 1].map((i) => h('div.wx-orb-lab.i' + i));
  host.append(...labels);
  const label = (st) => st.forEach((x, i) => { if (labels[i]) labels[i].textContent = x && x.has ? `${fmtInt(x.n)} decider${x.n === 1 ? '' : 's'}` : 'waiting'; });
  const api_ = {
    set(st) { pending = st; label(st); impl?.set(st); },
    burst(i, action) { impl?.burst(i, action); },
    show() { shownNow = true; impl?.show?.(); },
    hide() { shownNow = false; impl?.hide?.(); },
    theme() { impl?.theme?.(); },
    dispose() { disposed = true; impl?.dispose(); impl = null; labels.forEach((l) => l.remove()); },
  };
  (async () => {
    let stage = null;
    try { stage = await createStage(host, { camera: { fov: 38, y: 1.4, z: 9 } }); } catch (e) { console.warn('worlds: 3D unavailable, using 2D', e); }
    if (disposed || isDead()) { stage?.dispose(); return; }
    try { impl = stage ? make3d(host, stage, getCols, labels) : make2d(host, getCols, labels); }
    catch (e) { console.warn('worlds: 3D failed, using 2D', e); stage?.dispose(); impl = make2d(host, getCols, labels); }
    host.classList.add(stage ? 'is-3d' : 'is-2d');
    if (pending) impl.set(pending);
    if (shownNow) impl.show?.();
  })();
  return api_;
}

/** gap/share from the two worlds' intent rates (null when either world has no deciders yet) */
function duelGap(st) {
  if (!st?.[0]?.has || !st?.[1]?.has) return null;
  const a = st[0].glow, b = st[1].glow;
  return { gap: a - b, share: a + b > 0 ? a / (a + b) : 0.5 };
}
const isLight = () => { const m = /#?([0-9a-f]{6})/i.exec(cssVar('--panel-solid') || ''); if (!m) return false; const v = parseInt(m[1], 16); return ((v >> 16) & 255) + ((v >> 8) & 255) + (v & 255) > 540; };

const ATMO_V = `varying vec3 vN; varying vec3 vV;
void main(){ vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`;
const ATMO_F = `uniform vec3 uC; uniform float uI; varying vec3 vN; varying vec3 vV;
void main(){ float f = pow(clamp(0.72 + dot(vN, vV), 0.0, 1.0), 3.0); gl_FragColor = vec4(uC, clamp(f * uI, 0.0, 1.0)); }`;
const BEAM_V = `varying vec2 vU; void main(){ vU = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const BEAM_F = `uniform vec3 uA; uniform vec3 uB; uniform float uT; uniform float uDir; uniform float uO; varying vec2 vU;
void main(){ float x = vU.y; vec3 c = mix(uA, uB, x); float d = fract(x * 7.0 - uT * 0.9 * uDir); float p = smoothstep(0.0, 0.35, d) * smoothstep(1.0, 0.55, d);
  float edge = 1.0 - abs(vU.x * 2.0 - 1.0); gl_FragColor = vec4(c, uO * (0.35 + 0.65 * p) * (0.55 + 0.45 * edge)); }`;

/** grayscale banded planet surface; tinted by material colour */
function bandTexture(T, seed) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const g = c.getContext('2d'); let s = seed * 9301 + 49297;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  for (let y = 0; y < 128; y++) {
    const v = 168 + 52 * Math.sin(y * 0.19 + seed) + 26 * Math.sin(y * 0.53 + seed * 3) + 14 * (rnd() - 0.5);
    g.fillStyle = `rgb(${v | 0},${v | 0},${v | 0})`; g.fillRect(0, y, 256, 1);
  }
  for (let k = 0; k < 14; k++) { g.fillStyle = `rgba(255,255,255,${0.06 + rnd() * 0.08})`; g.beginPath(); g.ellipse(rnd() * 256, rnd() * 128, 10 + rnd() * 26, 2 + rnd() * 4, 0, 0, Math.PI * 2); g.fill(); }
  const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; t.wrapS = T.RepeatWrapping; return t;
}

function make3d(host, stage, getCols, labels) {
  const T = stage.THREE, { scene, camera } = stage, still = reduced();
  let cols = getCols(), light = isLight(), state = null, aspect = 0;
  scene.add(new T.AmbientLight(0xffffff, 0.55));
  const sun = new T.DirectionalLight(0xffffff, 2.2); sun.position.set(-3, 4, 5); scene.add(sun);
  scene.fog = new T.Fog(new T.Color(cssVar('--panel-solid') || '#12151f'), 8, 19);
  const dot = dotTexture(T, 64);

  // floor grid + starfield: framing only
  const grid = new T.GridHelper(16, 32, 0xffffff, 0xffffff);
  grid.position.y = -1.7; grid.material.transparent = true; grid.material.depthWrite = false; scene.add(grid);
  const SN = 240, sp = new Float32Array(SN * 3);
  for (let k = 0; k < SN; k++) { sp[k * 3] = (Math.random() - 0.5) * 30; sp[k * 3 + 1] = -1 + Math.random() * 12; sp[k * 3 + 2] = -6 - Math.random() * 10; }
  const sg = new T.BufferGeometry(); sg.setAttribute('position', new T.BufferAttribute(sp, 3));
  const stars = new T.Points(sg, new T.PointsMaterial({ size: 0.09, map: dot, transparent: true, depthWrite: false, fog: false }));
  stars.frustumCulled = false; scene.add(stars);

  const planets = [0, 1].map((i) => {
    const col = new T.Color(cols[i]);
    const g = new T.Group(); g.position.x = i ? PX : -PX; scene.add(g);
    const body = new T.Group(); g.add(body); body.rotation.z = i ? -0.35 : 0.35;
    const core = new T.Mesh(new T.SphereGeometry(0.58, 48, 32), new T.MeshStandardMaterial({ map: bandTexture(T, i + 1), color: col, emissive: col, emissiveIntensity: 0.2, roughness: 0.6, metalness: 0.05 }));
    const atmo = new T.Mesh(new T.SphereGeometry(0.58 * 1.28, 48, 32), new T.ShaderMaterial({ vertexShader: ATMO_V, fragmentShader: ATMO_F, side: T.BackSide, transparent: true, depthWrite: false, uniforms: { uC: { value: col.clone() }, uI: { value: 0.4 } } }));
    body.add(core, atmo);
    // decider ring: one dot per decider, golden-angle spacing so any count looks even
    const pos = new Float32Array(RING_MAX * 3), cl = new Float32Array(RING_MAX * 3);
    for (let k = 0; k < RING_MAX; k++) {
      const a = k * 2.39996323, r = 0.86 + 0.2 * ((k * 0.618034) % 1);
      pos[k * 3] = Math.cos(a) * r; pos[k * 3 + 1] = (((k * 0.414) % 1) - 0.5) * 0.06; pos[k * 3 + 2] = Math.sin(a) * r;
    }
    const rg = new T.BufferGeometry(); rg.setAttribute('position', new T.BufferAttribute(pos, 3)); rg.setAttribute('color', new T.BufferAttribute(cl, 3)); rg.setDrawRange(0, 0);
    const ring = new T.Points(rg, new T.PointsMaterial({ size: 0.13, map: dot, vertexColors: true, transparent: true, depthWrite: false }));
    ring.frustumCulled = false;
    const tiltG = new T.Group(); tiltG.rotation.x = 0.32; tiltG.rotation.z = i ? -0.18 : 0.18; tiltG.add(ring); g.add(tiltG);
    g.scale.setScalar(0.6);
    return { g, body, core, atmo, ring, rg, col, sc: 0.6, tsc: 0.6, em: 0.2, tem: 0.2, ai: 0.4, tai: 0.4, n: -1, k: -1 };
  });

  // beam: thickness = intent gap, flow from the leader, bead at the tug share
  const beamMat = new T.ShaderMaterial({ vertexShader: BEAM_V, fragmentShader: BEAM_F, transparent: true, depthWrite: false, side: T.DoubleSide,
    uniforms: { uA: { value: planets[0].col.clone() }, uB: { value: planets[1].col.clone() }, uT: { value: 0 }, uDir: { value: 1 }, uO: { value: 0.9 } } });
  const beam = new T.Mesh(new T.CylinderGeometry(1, 1, 1, 20, 1, true), beamMat);
  beam.rotation.z = Math.PI / 2; beam.visible = false; scene.add(beam);
  const bead = new T.Sprite(new T.SpriteMaterial({ map: dot, color: 0xffffff, transparent: true, depthWrite: false }));
  bead.scale.setScalar(0.34); bead.visible = false; scene.add(bead);
  let br = 0.02, tbr = 0.02, bx = 0, tbx = 0;

  // burst particle pool
  const N = 110, bp = new Float32Array(N * 3), bc = new Float32Array(N * 3), vel = new Float32Array(N * 3), life = new Float32Array(N), base = new Float32Array(N * 3);
  for (let k = 0; k < N; k++) bp[k * 3 + 2] = -100;
  const geo = new T.BufferGeometry();
  geo.setAttribute('position', new T.BufferAttribute(bp, 3)); geo.setAttribute('color', new T.BufferAttribute(bc, 3));
  const pts = new T.Points(geo, new T.PointsMaterial({ size: 0.3, map: dot, vertexColors: true, transparent: true, depthWrite: false }));
  pts.frustumCulled = false; scene.add(pts);
  let cursor = 0;

  function paintRing(o, n, k) {
    const c = o.rg.attributes.color.array, hi = o.col.clone().lerp(new T.Color(light ? 0x111320 : 0xffffff), light ? 0.35 : 0.55), lo = o.col.clone().multiplyScalar(light ? 0.9 : 0.55);
    for (let q = 0; q < n; q++) { const s = q < k ? hi : lo; c[q * 3] = s.r; c[q * 3 + 1] = s.g; c[q * 3 + 2] = s.b; }
    o.rg.attributes.color.needsUpdate = true; o.rg.setDrawRange(0, n);
    o.ring.material.size = n > 200 ? 0.08 : n > 60 ? 0.12 : 0.17;
  }
  function applyTheme() {
    light = isLight(); cols = getCols();
    const add = light ? T.NormalBlending : T.AdditiveBlending;
    scene.fog.color.set(cssVar('--panel-solid') || '#12151f');
    const gc = new T.Color(light ? 0x2a2f4a : 0xaab0d0);
    grid.material.color = gc; grid.material.vertexColors = false; grid.material.opacity = light ? 0.16 : 0.13; grid.material.needsUpdate = true;
    stars.material.color.set(light ? 0x6a6f8c : 0xffffff); stars.material.opacity = light ? 0.35 : 0.7; stars.material.blending = add; stars.material.needsUpdate = true;
    planets.forEach((o, i) => {
      o.col.set(cols[i]); o.core.material.color.copy(o.col); o.core.material.emissive.copy(o.col);
      o.atmo.material.uniforms.uC.value.copy(o.col); o.atmo.material.blending = add; o.atmo.material.needsUpdate = true;
      o.ring.material.blending = add; o.ring.material.needsUpdate = true;
      if (o.n >= 0) paintRing(o, o.n, o.k);
    });
    beamMat.uniforms.uA.value.copy(planets[0].col); beamMat.uniforms.uB.value.copy(planets[1].col); beamMat.blending = add; beamMat.needsUpdate = true;
    bead.material.color.set(light ? 0x12141f : 0xffffff); bead.material.blending = add;
    pts.material.blending = add; pts.material.needsUpdate = true;
  }
  applyTheme();

  const v3 = new T.Vector3();
  const off = stage.onFrame((t, dt) => {
    // keep both systems in frame whatever the card's aspect ratio
    if (camera.aspect !== aspect) {
      aspect = camera.aspect; const tv = Math.tan((camera.fov / 2) * Math.PI / 180);
      const z = Math.max(2.75 / (tv * aspect), 1.9 / tv, 5.5);
      camera.position.set(0, z * 0.17, z); camera.lookAt(0, -0.2, 0);
    }
    const k = Math.min(1, dt * 4);
    planets.forEach((o, i) => {
      o.sc += (o.tsc - o.sc) * k; o.em += (o.tem - o.em) * k; o.ai += (o.tai - o.ai) * k;
      o.g.scale.setScalar(o.sc); o.core.material.emissiveIntensity = o.em; o.atmo.material.uniforms.uI.value = o.ai;
      if (!still) { o.core.rotation.y += dt * (0.25 + o.em * 0.3); o.ring.rotation.y += dt * (i ? -0.22 : 0.22); o.g.position.y = Math.sin(t * 1.1 + i * 2) * 0.06; }
      // anchor the HTML label under the ring
      const l = labels[i];
      if (l) { v3.set(o.g.position.x, o.g.position.y - 1.25 * o.sc, 0).project(camera); l.style.transform = `translate(${((v3.x + 1) / 2) * host.clientWidth}px, ${((1 - v3.y) / 2) * host.clientHeight}px) translate(-50%, 0)`; }
    });
    br += (tbr - br) * k; bx += (tbx - bx) * k;
    const a = planets[0], b = planets[1], x0 = a.g.position.x + 0.58 * a.sc * 1.1, x1 = b.g.position.x - 0.58 * b.sc * 1.1, y = (a.g.position.y + b.g.position.y) / 2;
    beam.scale.set(br, Math.max(0.01, x1 - x0), br); beam.position.set((x0 + x1) / 2, y, 0);
    bead.position.set(x0 + (x1 - x0) * bx, y, 0.02);
    if (!still) beamMat.uniforms.uT.value = t;
    if (!still) stars.rotation.y = Math.sin(t * 0.05) * 0.05;
    let any = false;
    for (let q = 0; q < N; q++) {
      if (life[q] <= 0) continue;
      any = true; life[q] -= dt;
      const j = q * 3;
      bp[j] += vel[j] * dt; bp[j + 1] += vel[j + 1] * dt; bp[j + 2] += vel[j + 2] * dt;
      vel[j] *= 0.985; vel[j + 1] *= 0.985;
      const lf = Math.max(0, life[q]);
      bc[j] = base[j] * lf; bc[j + 1] = base[j + 1] * lf; bc[j + 2] = base[j + 2] * lf;
      if (life[q] <= 0) { bp[j + 2] = -100; bc[j] = bc[j + 1] = bc[j + 2] = 0; }
    }
    if (any) { geo.attributes.position.needsUpdate = true; geo.attributes.color.needsUpdate = true; }
  });
  return {
    set(st) {
      state = st;
      st.forEach((x, i) => {
        const o = planets[i]; if (!o || !x) return;
        o.tsc = x.has ? 0.7 + 0.35 * x.size : 0.6;
        o.tem = x.has ? 0.15 + 0.9 * Math.min(1, x.glow * 1.6) : 0.08;
        o.tai = x.has ? 0.35 + 1.4 * Math.min(1, x.glow * 1.6) : 0.25;
        const n = x.has ? Math.min(RING_MAX, x.n || 0) : 0, kk = Math.min(n, x.k || 0);
        if (n !== o.n || kk !== o.k) { o.n = n; o.k = kk; paintRing(o, n, kk); }
        if (still) { o.sc = o.tsc; o.em = o.tem; o.ai = o.tai; }
      });
      const gp = duelGap(st);
      beam.visible = bead.visible = !!gp;
      if (gp) {
        tbr = Math.min(0.15, 0.012 + 0.5 * Math.abs(gp.gap)); tbx = gp.share;
        beamMat.uniforms.uDir.value = gp.gap >= 0 ? 1 : -1;
        if (still) { br = tbr; bx = tbx; }
      }
    },
    burst(i, action) {
      if (still) return;
      const o = planets[i]; if (!o) return;
      const c = action === 'hide' ? new T.Color(cssVar('--bad') || '#ff5f6d') : o.col;
      const n = action === 'scroll_past' ? 2 : 9;
      for (let q = 0; q < n; q++) {
        const kq = cursor = (cursor + 1) % N, j = kq * 3, a = Math.random() * Math.PI * 2, s = 1.2 + Math.random() * 2.4;
        bp[j] = o.g.position.x; bp[j + 1] = o.g.position.y; bp[j + 2] = 0.2;
        vel[j] = Math.cos(a) * s + (i ? -0.6 : 0.6); vel[j + 1] = Math.sin(a) * s; vel[j + 2] = (Math.random() - 0.3) * 1.2;
        base[j] = c.r; base[j + 1] = c.g; base[j + 2] = c.b; life[kq] = 0.9 + Math.random() * 0.7;
      }
    },
    show() { stage.resize(); },
    theme() { applyTheme(); if (state) this.set(state); },
    dispose() { off(); dot.dispose(); stage.dispose(); },
  };
}

function make2d(host, getCols, labels) {
  const cv = document.createElement('canvas'); cv.style.cssText = 'display:block;width:100%;height:100%'; host.prepend(cv);
  const g = cv.getContext('2d'), still = reduced();
  let cols = getCols(), W = 1, H = 1, dpr = 1, raf = 0, tm = 0, running = false, last = performance.now(), gone = false, gp = null, bw = 1, bx = 0.5;
  const orbs = [0, 1].map(() => ({ sc: 0.6, tsc: 0.6, gl: 0.15, tgl: 0.15, rot: 0, n: 0, k: 0 })), parts = [];
  const size = () => { dpr = Math.min(2, window.devicePixelRatio || 1); W = host.clientWidth || 1; H = host.clientHeight || 1; cv.width = W * dpr; cv.height = H * dpr; };
  const ro = new ResizeObserver(size); ro.observe(host); size();
  const geom = (i, o) => { const cx = W * (i ? 0.73 : 0.27), cy = H * 0.46, r = Math.min(W * 0.12, H * 0.2) * (o.sc / 0.9); return { cx, cy, r }; };
  function frame(now) {
    raf = 0; if (!running || gone) return;
    if (document.hidden || host.offsetParent === null) { tm = setTimeout(() => { tm = 0; frame(performance.now()); }, 300); return; }
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    // floor lines
    g.save(); g.strokeStyle = cssVar('--line-2') || 'rgba(255,255,255,.13)'; g.lineWidth = 1;
    for (let q = 0; q < 6; q++) { const y = H * 0.78 + q * q * 3; g.globalAlpha = 0.8 - q * 0.12; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    g.restore();
    const gs = orbs.map((o, i) => {
      o.sc += (o.tsc - o.sc) * Math.min(1, dt * 4); o.gl += (o.tgl - o.gl) * Math.min(1, dt * 4); if (!still) o.rot += dt * 0.4 * (i ? -1 : 1);
      return geom(i, o);
    });
    if (gp) {
      const a = gs[0], b = gs[1], x0 = a.cx + a.r, x1 = b.cx - b.r, grd = g.createLinearGradient(x0, 0, x1, 0);
      grd.addColorStop(0, cols[0]); grd.addColorStop(1, cols[1]);
      g.save(); g.strokeStyle = grd; g.lineWidth = bw; g.lineCap = 'round'; g.globalAlpha = 0.85; g.beginPath(); g.moveTo(x0, a.cy); g.lineTo(x1, b.cy); g.stroke();
      g.fillStyle = cssVar('--text') || '#fff'; g.beginPath(); g.arc(x0 + (x1 - x0) * bx, a.cy, 4, 0, Math.PI * 2); g.fill(); g.restore();
    }
    orbs.forEach((o, i) => {
      const { cx, cy, r } = gs[i];
      g.save(); g.shadowColor = cols[i]; g.shadowBlur = 8 + 36 * o.gl; g.fillStyle = cols[i]; g.globalAlpha = 0.92;
      g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill(); g.restore();
      g.save(); g.globalAlpha = 0.25; g.fillStyle = '#fff'; g.beginPath(); g.arc(cx - r * 0.3, cy - r * 0.3, r * 0.4, 0, Math.PI * 2); g.fill(); g.restore();
      g.save(); g.fillStyle = cols[i];
      for (let q = 0; q < o.n; q++) {
        const a = q * 2.39996323 + o.rot, rr = r * (1.55 + 0.35 * ((q * 0.618034) % 1));
        g.globalAlpha = q < o.k ? 0.95 : 0.4; g.beginPath(); g.arc(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.32, o.n > 120 ? 1.2 : 2, 0, Math.PI * 2); g.fill();
      }
      g.restore();
      if (labels[i]) labels[i].style.transform = `translate(${cx}px, ${cy + r * 2.1}px) translate(-50%, 0)`;
    });
    for (let q = parts.length - 1; q >= 0; q--) {
      const p = parts[q]; p.life -= dt; if (p.life <= 0) { parts.splice(q, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.985; p.vy *= 0.985;
      g.save(); g.globalAlpha = Math.min(1, p.life); g.fillStyle = p.c; g.beginPath(); g.arc(p.x, p.y, 2.5, 0, Math.PI * 2); g.fill(); g.restore();
    }
    raf = requestAnimationFrame(frame);
  }
  return {
    set(st) {
      st.forEach((x, i) => { const o = orbs[i]; if (!o || !x) return; o.tsc = x.has ? 0.7 + 0.35 * x.size : 0.6; o.tgl = x.has ? 0.2 + Math.min(1, x.glow * 1.6) : 0.1; o.n = x.has ? Math.min(RING_MAX, x.n || 0) : 0; o.k = Math.min(o.n, x.k || 0); if (still) { o.sc = o.tsc; o.gl = o.tgl; } });
      gp = duelGap(st); if (gp) { bw = 1.5 + Math.min(10, Math.abs(gp.gap) * 40); bx = gp.share; }
      if (!running) return;
    },
    burst(i, action) {
      if (still) return;
      const c = action === 'hide' ? (cssVar('--bad') || '#ff5f6d') : cols[i], { cx, cy } = geom(i, orbs[i]);
      for (let q = 0; q < (action === 'scroll_past' ? 2 : 9) && parts.length < 150; q++) { const a = Math.random() * Math.PI * 2, s = 40 + Math.random() * 90; parts.push({ x: cx, y: cy, vx: Math.cos(a) * s + (i ? -20 : 20), vy: Math.sin(a) * s, life: 0.9 + Math.random() * 0.7, c }); }
    },
    show() { if (running) return; running = true; last = performance.now(); size(); if (!raf && !tm) raf = requestAnimationFrame(frame); },
    hide() { running = false; cancelAnimationFrame(raf); raf = 0; clearTimeout(tm); tm = 0; },
    theme() { cols = getCols(); },
    dispose() { gone = true; running = false; cancelAnimationFrame(raf); clearTimeout(tm); ro.disconnect(); cv.remove(); },
  };
}

/* ------------------------------------------------------------------ stage */
export default {
  id: 'worlds',
  mount(el, ctx) {
    const { S, bus } = ctx;
    let dead = false, visible = false, dirty = false, sig = '';
    let filter = 'all', query = '', roundTouched = false, searchT = 0, lastPulse = 0;
    const offs = [], cleanups = [], cleanups0 = [], W = {};
    el.classList.add('wx');

    /* ---- helpers */
    const wids = () => ctx.worldIds();
    const vars = () => ctx.variants();
    const targetOf = () => Math.min(500, S.spec?.crowdSize || 500);
    const done = () => S.status === 'done' || S.status === 'error';
    const colsNow = () => [colorOf(vars()[0] || 'A', '#5b8cff'), colorOf(vars()[1] || 'B', '#ff9a4d')];
    const matchR = (r) => {
      if (filter === 'engaged' && r.action === 'scroll_past') return false;
      if (['comment', 'share', 'hide'].includes(filter) && r.action !== filter) return false;
      if (!query) return true;
      return [r.agent_id, r.text, r.unsaid, r.reason].some((x) => x && String(x).toLowerCase().includes(query));
    };

    /* ---- shell */
    const ui = {
      replay: h('div.wx-replay'), rpLabel: h('div.wx-rp-label'), rpSegs: h('div.wx-segs'), rpAct: h('div.wx-rp-act'),
      roundSel: h('select', { 'aria-label': 'Round the event lands in' }),
      target: h('select', { 'aria-label': 'Who sees it' }, ['all', 'core', 'spillover'].map((t) => h('option', { value: t }, t === 'all' ? 'everyone' : t))),
      text: h('input', { type: 'text', placeholder: 'Inject an event, e.g. rival posts 30% off', 'aria-label': 'What happens' }),
      btn: h('button.btn.primary.sm', { type: 'button' }, 'Inject'),
      note: h('div.wx-inj-note'), evs: h('div.wx-evs'),
      chips: h('div.wx-chips', { role: 'group', 'aria-label': 'Filter feed' }),
      search: h('input', { type: 'search', placeholder: 'Search person or text', 'aria-label': 'Search feeds' }),
      stage: h('div.wx-stage', { 'data-side': '0' }), flip: h('div.wx-flip'),
      pulses: h('div.wx-pulses'), duelHost: h('div.wx-duel-host'),
      tugA: h('i.wx-tug-a'), tugB: h('i.wx-tug-b'), tugKnob: h('i.wx-knob'), tugLa: h('b', '-'), tugLb: h('b', '-'), tugNote: h('small', 'waiting for both worlds'),
      vs: h('div.wx-vs'),
    };
    ui.replay.append(ui.rpLabel, ui.rpSegs, ui.rpAct);
    const bar = h('div.wx-cmd',
      h('div.wx-cmd-row',
        h('span.wx-cmd-ico', { title: 'Inject an event into both worlds' }, icon('M13 2L3 14h8l-1 8 10-12h-8z')), ui.text,
        h('label.wx-sel', h('small', 'Round'), ui.roundSel), h('label.wx-sel', h('small', 'Seen by'), ui.target), ui.btn),
      h('div.wx-cmd-foot', ui.note, ui.evs));
    const tools = h('div.wx-tools', ui.chips, h('div.wx-search', icon('M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3'), ui.search));
    // centre duel card (spans the four top rows on desktop)
    const center = h('div.wx-center',
      h('div.wx-duel-head', h('span.wx-duel-title', 'The duel'), h('small', 'intent rate')),
      ui.duelHost,
      h('div.wx-tug',
        h('div.wx-tug-lab', h('span.a', ctx.variants()[0] || 'A', ' ', ui.tugLa), h('span.b', ui.tugLb, ' ', ctx.variants()[1] || 'B')),
        h('div.wx-tug-bar', ui.tugA, ui.tugB, ui.tugKnob), ui.tugNote),
      ui.vs,
      h('div.wx-duel-key', h('span', h('i.k-dot'), 'dot = 1 decider'), h('span', h('i.k-glow'), 'glow = intent'), h('span', h('i.k-beam'), 'beam = gap')));
    const seam = h('div.wx-seam', ui.pulses);
    el.append(h('div.wx-wrap', ui.replay, bar, ui.stage));

    const duel = makeDuel(ui.duelHost, colsNow, () => dead);
    // follow theme switches (data-theme attribute or OS scheme)
    const mo = new MutationObserver(() => duel.theme());
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
    const mq = window.matchMedia?.('(prefers-color-scheme: light)'), onMq = () => duel.theme();
    mq?.addEventListener?.('change', onMq);
    cleanups0.push(() => { mo.disconnect(); mq?.removeEventListener?.('change', onMq); });

    /* ---- mobile flip toggle */
    function renderFlip() {
      const vs = vars();
      mount(ui.flip, vs.map((v, i) => h('button' + (ui.stage.dataset.side === String(i) ? '.on' : ''), { type: 'button', 'aria-pressed': String(ui.stage.dataset.side === String(i)), style: { '--wc': vcolor(v) }, onclick: () => { ui.stage.dataset.side = String(i); renderFlip(); } }, h('i'), `World ${v}`)));
    }

    /* ---- filter chips + search */
    function renderChips() {
      const ws = wids(), all = ws.flatMap((w) => S.rec[w] || []);
      const cnt = { all: all.length, engaged: all.filter((r) => r.action !== 'scroll_past').length, comment: 0, share: 0, hide: 0 };
      for (const r of all) if (cnt[r.action] != null) cnt[r.action]++;
      mount(ui.chips, FILTERS.map(([k, l]) => h('button.wx-chip' + (filter === k ? '.on' : ''), { type: 'button', 'aria-pressed': String(filter === k), onclick: () => { filter = k; renderChips(); wids().forEach(applyFilter); } }, l, h('em', fmtInt(cnt[k])))));
    }
    ui.search.addEventListener('input', () => { clearTimeout(searchT); searchT = setTimeout(() => { query = ui.search.value.trim().toLowerCase(); wids().forEach(applyFilter); }, 120); });

    /* ---- feed card (ported feedCard) */
    function card(r) {
      const p = S.pmap.get(r.agent_id), scroll = r.action === 'scroll_past';
      const open = (e) => { e.stopPropagation(); openAgent(r.agent_id, { world: r.world_id }); };
      const extra = [reasonLines(r), r.unsaid ? h('div.unsaid', h('b', 'kept to themselves: '), r.unsaid) : null].flat().filter(Boolean);
      const head = h('div.wx-head',
        h('span.who', { onclick: open, title: 'Open this person' }, r.agent_id),
        p ? h('span.meta', { title: p.segment }, `${p.age}, ${p.role}`) : null,
        actPill(r.action),
        r.item_kind === 'share' && r.via ? h('span.chip.wx-mini', `via ${r.via}`) : null,
        r.item_kind === 'event' ? h('span.chip.wx-mini.ev', { title: 'reacting to an injected event' }, scroll ? 'news' : 'reacting to news') : null,
        h('span.hr', roundTime(r.hour)));
      const el_ = h('div.wx-card.act-' + r.action + (scroll ? '.scroll' : ''), { 'data-id': r.id },
        avatar(r.agent_id, '', open),
        h('div.wx-body', head,
          r.text ? h('div.said', r.text) : null,
          scroll ? (extra.length ? h('div.wx-more', extra) : null) : extra));
      if (scroll && extra.length) { el_.classList.add('has-more'); el_.addEventListener('click', () => el_.classList.toggle('open')); }
      el_._r = r;
      return el_;
    }
    function enter(c, r, w) {
      c.classList.add('fresh');
      setTimeout(() => c.classList.remove('fresh'), 1600);
      if (reduced() || !visible || c.hidden) return;
      const hgt = c.offsetHeight;
      c.style.overflow = 'hidden';
      const a = c.animate([{ height: '0px', opacity: 0, transform: 'translateY(-22px) scale(.95)', marginBottom: '0px' }, { height: `${hgt}px`, opacity: 1, transform: 'none', marginBottom: '' }], { duration: r.action === 'scroll_past' ? 320 : 640, easing: EASE.expo });
      a.onfinish = a.oncancel = () => { c.style.overflow = ''; };
    }
    /** Pop the action's icon over the phone. */
    function burst(w, action) {
      if (reduced() || !visible || action === 'scroll_past' || w.bursts > 6) return;
      w.bursts++;
      const node = h('div.wx-burst.act-' + action, icon(ICONS[action] || ICONS.like), h('i'));
      w.fx.append(node);
      const x = 12 + Math.random() * 76;
      node.style.left = `${x}%`;
      const dots = 7;
      for (let k = 0; k < dots; k++) {
        const d = h('u'); node.append(d);
        const a = (k / dots) * Math.PI * 2, dist = 26 + Math.random() * 14;
        d.animate([{ transform: 'translate(0,0) scale(1)', opacity: 1 }, { transform: `translate(${Math.cos(a) * dist}px, ${Math.sin(a) * dist}px) scale(0)`, opacity: 0 }], { duration: 650, easing: EASE.out, fill: 'forwards' });
      }
      const a = node.animate([
        { transform: 'translate(-50%,0) scale(.2)', opacity: 0 }, { transform: 'translate(-50%,-12px) scale(1.5)', opacity: 1, offset: 0.3 },
        { transform: 'translate(-50%,-30px) scale(1)', opacity: 1, offset: 0.6 }, { transform: 'translate(-50%,-80px) scale(.9)', opacity: 0 }], { duration: 1100, easing: EASE.out });
      a.onfinish = () => { node.remove(); w.bursts--; };
    }
    /** A pulse travels along the seam in the colour of the world that just acted. */
    function pulse(i, color) {
      const now = performance.now();
      if (reduced() || !visible || now - lastPulse < 140) return;
      lastPulse = now;
      const p = h('i.wx-pulse', { style: { background: color, boxShadow: `0 0 14px 4px ${color}` } });
      ui.pulses.append(p);
      const a = p.animate([{ top: '100%', opacity: 0, transform: 'scaleY(.6)' }, { opacity: 1, offset: 0.15 }, { top: '0%', opacity: 0, transform: 'scaleY(1.6)' }], { duration: 1100, easing: EASE.out });
      a.onfinish = () => p.remove();
      ui.pulses.parentElement.animate([{ filter: 'brightness(1.8)' }, { filter: 'none' }], { duration: 500, easing: EASE.out });
    }

    /* ---- feeds */
    function applyFilter(wid) {
      const w = W[wid]; if (!w) return;
      let n = 0;
      for (const c of w.feed.children) { c.hidden = !matchR(c._r); if (!c.hidden) n++; }
      const total = (S.rec[wid] || []).length;
      w.count.textContent = total ? (n === total ? `${total} shown` : `${n} of ${total} match`) : '0 shown';
      w.empty.hidden = n > 0;
      w.empty.textContent = total ? 'No cards match this filter or search.' : done() ? 'No actions were recorded for this world.' : S.replay ? 'Replay starting...' : 'Waiting for the first person to see the post...';
    }
    function redrawFeed(wid) {
      const w = W[wid]; if (!w) return;
      const recs = S.rec[wid] || [];
      mount(w.feed, [...recs].reverse().map(card));
      applyFilter(wid);
    }
    const redrawAll = () => { wids().forEach((w) => { redrawFeed(w); updateCounters(w); }); renderChips(); updateDuel(); };

    /* ---- counters (ported updateCounters) */
    function put(cell, val, fmt, sub) {
      if (val == null || Number.isNaN(val)) { cell.b.textContent = '-'; cell.b._cu = 0; } else countUp(cell.b, val, fmt, 800);
      cell.sm.textContent = sub || '';
    }
    function updateCounters(wid) {
      const w = W[wid]; if (!w) return;
      const c = S.counters[wid], t = targetOf(), cl = w.cells;
      const fmtInt = (x) => fmtIntRaw(Math.round(x));   // countUp tweens through fractions
      if (!c) {
        w.title.textContent = done() ? 'no counters recorded' : 'not started';
        put(cl.deciders, 0, fmtInt, `of ${fmtInt(t)}`);
        for (const k of ['intent', 'hides', 'stance', 'calls', 'exposures']) put(cl[k], null, fmtInt, '');
        w.mV.style.width = '0'; w.mS.style.width = '0'; w.mLabel.textContent = 'waiting for deciders';
        updateDuel();
        return;
      }
      const d = c.deciders || 0;
      w.title.textContent = `${c.hour_label || ctx.hourOfRound(c.round)} · round ${c.round + 1}${S.spec ? ` of ${S.spec.rounds}` : ''}`;
      put(cl.deciders, d, fmtInt, `of ${fmtInt(t)}`);
      put(cl.intent, d ? (c.intent / d) * 100 : null, (x) => `${Math.round(x)}%`, d ? `${c.intent} of ${d}` : '');
      put(cl.hides, c.hides, fmtInt, '');
      put(cl.stance, d ? c.stance_sum / d : null, (x) => (x >= 0 ? '+' : '') + x.toFixed(2), '-1 to +1');
      cl.stance.b.classList.toggle('pos', d && c.stance_sum > 0); cl.stance.b.classList.toggle('neg', d && c.stance_sum < 0);
      put(cl.calls, c.calls, fmtInt, ''); put(cl.exposures, c.exposures, fmtInt, '');
      const vs = d ? (c.vocal || 0) / d : 0;
      w.mV.style.width = `${vs * 100}%`; w.mS.style.width = d ? `${(1 - vs) * 100}%` : '0';
      w.mLabel.textContent = d ? `${pct(vs, 0)} vocal · ${pct(1 - vs, 0)} silent` : 'waiting for deciders';
    }
    function updateDuel() {
      const ws = wids(), cs = ws.map((w) => S.counters[w]);
      const rate = cs.map((c) => (c && c.deciders ? c.intent / c.deciders : null));
      const t = targetOf();
      duel.set(cs.map((c, i) => ({ has: !!c && c.deciders > 0, size: c ? Math.min(1, (c.deciders || 0) / t) : 0, glow: rate[i] || 0, n: c?.deciders || 0, k: c?.intent || 0 })));
      const [ra, rb] = rate;
      const stance = (c) => (c && c.deciders ? c.stance_sum / c.deciders : null), vocal = (c) => (c && c.deciders ? (c.vocal || 0) / c.deciders : null);
      const sgn = (x) => (x == null ? '-' : (x >= 0 ? '+' : '') + x.toFixed(2));
      const row = (label, fa, fb, va, vb, hiBetter = true) => {
        const win = va != null && vb != null && va !== vb ? ((va > vb) === hiBetter ? 0 : 1) : -1;
        return h('div.wx-vs-row', h('b.a' + (win === 0 ? '.win' : ''), fa), h('span', label), h('b.b' + (win === 1 ? '.win' : ''), fb));
      };
      mount(ui.vs, [
        row('deciders', cs[0] ? fmtInt(cs[0].deciders || 0) : '-', cs[1] ? fmtInt(cs[1].deciders || 0) : '-', null, null),
        row('mean stance', sgn(stance(cs[0])), sgn(stance(cs[1])), stance(cs[0]), stance(cs[1])),
        row('vocal', vocal(cs[0]) == null ? '-' : pct(vocal(cs[0]), 0), vocal(cs[1]) == null ? '-' : pct(vocal(cs[1]), 0), vocal(cs[0]), vocal(cs[1])),
        row('hides', cs[0] ? fmtInt(cs[0].hides || 0) : '-', cs[1] ? fmtInt(cs[1].hides || 0) : '-', cs[0]?.hides, cs[1]?.hides, false),
      ]);
      ui.tugLa.textContent = ra == null ? '-' : pct(ra, 0); ui.tugLb.textContent = rb == null ? '-' : pct(rb, 0);
      if (ra == null || rb == null) {
        ui.tugA.style.width = '50%'; ui.tugB.style.width = '50%'; ui.tugKnob.style.left = '50%';
        ui.tugNote.textContent = 'waiting for both worlds';
        return;
      }
      const share = ra + rb > 0 ? ra / (ra + rb) : 0.5;
      ui.tugA.style.width = `${share * 100}%`; ui.tugB.style.width = `${(1 - share) * 100}%`; ui.tugKnob.style.left = `${share * 100}%`;
      const lead = (ra - rb) * 100, small = Math.min(cs[0].deciders, cs[1].deciders) < 30;
      const vs = vars();
      ui.tugNote.textContent = (Math.abs(lead) < 1 ? 'level on intent' : `${lead > 0 ? vs[0] : vs[1]} ahead by ${Math.abs(lead).toFixed(1)} pts`) + (small ? ' (early, small sample)' : '');
    }

    /* ---- build the two sides */
    function buildSide(i, wid, v) {
      const post = S.spec?.posts?.find((p) => p.variant === v), handle = S.spec?.handle || '';
      const w = W[wid] = { i, v, cells: {}, bursts: 0 };
      const cell = (key, label, title) => { const b = h('b', '-'), sm = h('small'); w.cells[key] = { b, sm }; return h('div.wx-ctr.k-' + key, { title }, h('span', label), b, sm); };
      w.title = h('span.wx-when', '');
      w.mV = h('i.vocal'); w.mS = h('i.silent'); w.mLabel = h('small', 'waiting for deciders');
      const long = (post?.text || '').length > 190;
      const cap = h('p.wx-caption' + (long ? '.clamp' : ''), post ? post.text : 'Post text not available yet');
      if (long) cap.addEventListener('click', () => cap.classList.toggle('clamp'));
      w.postEl = h('article.wx-post',
        h('header', h('span.wx-post-av', (handle.replace(/^@/, '')[0] || v).toUpperCase()), h('div', h('b', handle || `Version ${v}`), h('small', `Sponsored · Version ${v}`)), variantChip(v)),
        cap,
        h('footer', icon(ICONS.like), icon(ICONS.comment), icon(ICONS.share), h('span'), icon(ICONS.save)));
      cleanups.push(tilt(w.postEl, { max: 5, scale: 1.01 }));
      w.feed = h('div.wx-feed', { role: 'log', 'aria-label': `World ${v} feed` });
      w.count = h('span.wx-count', '0 shown'); w.empty = h('div.wx-empty'); w.fx = h('div.wx-fx');
      return h('section.wx-side.i' + i, { style: { '--wc': vcolor(v) } },
        h('div.wx-whead', variantChip(v), h('h3', `World ${v}`), w.title),
        w.postEl,
        h('div.wx-counters',
          cell('deciders', 'Deciders', 'People who have decided, of the target crowd size'), cell('intent', 'Intent', 'Intent rate: deciders who would act on the post'),
          cell('hides', 'Hides', 'People who hid the post'), cell('stance', 'Stance', 'Mean stance, -1 to +1'),
          cell('calls', 'Calls', 'Model calls made in this world'), cell('exposures', 'Seen', 'Exposures: times the post was shown')),
        h('div.wx-meter', { title: 'Vocal = commented or shared; silent = everyone else who decided' }, h('div.wx-meter-h', h('span', 'Vocal vs silent'), w.mLabel), h('div.meter', w.mV, w.mS)),
        h('div.wx-phone',
          h('div.wx-phone-top', h('i.notch'), h('div.wx-phone-row', variantChip(v), h('b', handle), w.count)),
          h('div.wx-feedwrap', w.feed, w.empty, w.fx),
          h('i.wx-home')));
    }
    function build() {
      cleanups.splice(0).forEach((f) => f());
      for (const k of Object.keys(W)) delete W[k];
      const ws = wids(), vs = vars();
      const sides = ws.map((wid, i) => buildSide(i, wid, vs[i]));
      mount(ui.stage, sides[0], center, ui.flip, tools, seam, sides[1]);
      if (!reduced()) stagger([center, ...sides.flatMap((sd) => [...sd.children])].sort((a, b) => (a.compareDocumentPosition(b) & 4 ? -1 : 1)).slice(0, 12), { y: 14, gap: 18, ms: 460 });
      renderFlip(); redrawAll();
    }
    const signature = () => `${wids().join()}|${S.spec?.handle}|${(S.spec?.posts || []).map((p) => p.text).join('~')}`;

    /* ---- replay / progress strip */
    let segN = -1;
    function renderReplay() {
      const sp = S.spec, n = sp?.rounds || 0, ws = wids();
      const hasRecs = ws.some((w) => (S.rec[w] || []).length) || Object.keys(S.saved?.rec || {}).length > 0;
      const cur = S.replay ? (S.replayLim ?? -1) + 1 : Math.max(0, ...ws.map((w) => (S.counters[w] ? S.counters[w].round + 1 : 0)));
      const mode = S.replay ? 'replay' : done() ? 'done' : S.status === 'queued' ? 'idle' : 'live';
      ui.replay.className = `wx-replay mode-${mode}`;
      if (segN !== n) {
        segN = n;
        mount(ui.rpSegs, Array.from({ length: n }, (_, r) => h('i', { title: ctx.hourOfRound(r) })));
      }
      [...ui.rpSegs.children].forEach((sg, r) => {
        sg.classList.toggle('on', r < cur); sg.classList.toggle('now', r === cur - 1 && mode !== 'done');
        const ev = S.events.filter((e) => e.round === r); sg.classList.toggle('ev', ev.length > 0);
        sg.title = `${ctx.hourOfRound(r)}${ev.length ? ' · event: ' + ev.map((e) => e.text).join('; ') : ''}`;
      });
      let label, act = null;
      if (mode === 'replay') {
        label = [h('b', cur ? `Replaying round ${cur} of ${n}` : 'Replay starting'), cur ? h('span', ` · ${ctx.hourOfRound(cur - 1)}`) : null];
        act = h('button.btn.sm', { type: 'button', onclick: () => ctx.stopReplay() }, 'Stop replay');
      } else if (mode === 'done') {
        label = [h('b', S.status === 'error' ? 'Run stopped' : 'Run finished'), h('span', hasRecs ? ' · watch the two worlds unfold again, round by round.' : ' · no actions were recorded to replay.')];
        act = hasRecs ? h('button.btn.primary', { type: 'button', onclick: () => ctx.startReplay() }, icon('M6 4l14 8-14 8z'), 'Replay this run') : null;
      } else if (mode === 'live') {
        label = [h('span.wx-dot'), h('b', 'Live'), h('span', n ? ` · round ${Math.min(cur, n) || 1} of ${n}${cur ? ' · ' + ctx.hourOfRound(Math.max(0, cur - 1)) : ''}` : '')];
      } else label = [h('b', 'Waiting for the run to start')];
      mount(ui.rpLabel, label); mount(ui.rpAct, act);
    }

    /* ---- inject (ported renderInject) */
    function renderRounds() {
      const n = S.spec?.rounds || 0;
      const have = ui.roundSel.options.length;
      if (have !== n) {
        mount(ui.roundSel, n ? Array.from({ length: n }, (_, r) => h('option', { value: r }, `${r + 1}: ${ctx.hourOfRound(r)}`)) : h('option', { value: 0 }, '-'));
        roundTouched = false;
      }
      if (n && !roundTouched) ui.roundSel.value = String(Math.min(n - 1, Math.max(0, ...wids().map((w) => (S.counters[w] ? S.counters[w].round + 1 : 0)))));
    }
    function renderInject() {
      renderRounds();
      const off = !S.spec || S.replay;
      ui.text.disabled = ui.btn.disabled = ui.roundSel.disabled = ui.target.disabled = off;
      ui.note.textContent = S.replay ? 'Events are disabled while replaying.' : done() ? 'This run has finished; new events only matter for runs still in progress.' : 'Applies to both worlds equally, from the chosen round.';
      ui.note.classList.toggle('warn', done());
      mount(ui.evs, S.events.map((e) => h('span.wx-ev', { title: e.text }, h('b', `R${e.round + 1}`), h('em', e.target || 'all'), h('span', e.text))));
    }
    ui.roundSel.addEventListener('change', () => { roundTouched = true; });
    async function inject() {
      const text = ui.text.value.trim();
      if (!text) { toast('Write the event text first', true); ui.text.focus(); return; }
      ui.btn.disabled = true;
      try {
        const e = await api(`/api/runs/${ctx.id}/events`, { method: 'POST', body: { text, round: Number(ui.roundSel.value), target: ui.target.value } });
        ctx.addEvent(e); ui.text.value = ''; roundTouched = false;
        toast(`Injected for round ${e.round + 1}`);
      } catch (e) { fail(e); }
      ui.btn.disabled = !S.spec || S.replay;
    }
    ui.btn.addEventListener('click', inject);
    ui.text.addEventListener('keydown', (e) => { if (e.key === 'Enter') inject(); });

    /* ---- bus */
    const on = (t, f) => offs.push(bus.on(t, f));
    on('action', ({ record: r, live }) => {
      const w = W[r.world_id]; if (!w) return;
      if (!visible) dirty = true;
      const c = card(r);
      w.feed.prepend(c);
      while (w.feed.children.length > ctx.FEED_CAP) w.feed.lastChild.remove();
      c.hidden = !matchR(r);
      if (live) enter(c, r, w);
      applyFilter(r.world_id);
      if (live) {
        burst(w, r.action); duel.burst(w.i, r.action);
        pulse(w.i, vcolor(w.v));
      }
      scheduleChips();
    });
    let chipRaf = 0;
    const scheduleChips = () => { if (!chipRaf) chipRaf = requestAnimationFrame(() => { chipRaf = 0; renderChips(); }); };
    on('history', () => redrawAll());
    on('round', ({ world_id }) => { if (W[world_id]) { updateCounters(world_id); updateDuel(); } renderReplay(); renderRounds(); });
    on('seed', () => { sig = signature(); build(); renderReplay(); renderInject(); });
    on('snapshot', () => {
      const sg = signature();
      if (sg !== sig) { sig = sg; build(); } else { wids().forEach(updateCounters); updateDuel(); }
      renderReplay(); renderInject();
    });
    on('replay', ({ on: isOn, round }) => {
      if (!isOn || round < 0) redrawAll(); else { wids().forEach(updateCounters); updateDuel(); }
      renderReplay(); renderInject();
    });
    on('event', () => { renderInject(); renderReplay(); if (visible && !reduced()) { lastPulse = 0; pulse(0, 'var(--bad)'); lastPulse = 0; pulse(1, 'var(--bad)'); } });
    for (const t of ['done', 'error', 'status']) on(t, () => { renderReplay(); renderInject(); wids().forEach(applyFilter); });

    /* ---- init */
    sig = signature();
    build(); renderReplay(); renderInject(); renderChips();
    return {
      show() {
        visible = true; duel.show();
        if (dirty) { dirty = false; redrawAll(); }
        renderReplay();
      },
      hide() { visible = false; duel.hide(); },
      destroy() {
        dead = true; visible = false;
        offs.forEach((f) => f()); cleanups.splice(0).forEach((f) => f()); cleanups0.splice(0).forEach((f) => f());
        clearTimeout(searchT); cancelAnimationFrame(chipRaf);
        duel.dispose();
      },
    };
  },
};

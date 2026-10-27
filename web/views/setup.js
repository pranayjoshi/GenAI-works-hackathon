/* New test: a five-step wizard (business, drafts, audience, run settings, launch) under a compact "twin worlds" hero.
 * Ported from legacy/app.js section 5. API shapes: GET /api/demo, POST /api/audience, POST /api/runs (see src/api.ts).
 * State lives at module level so it survives navigation. 3D is created in mount and disposed in the returned cleanup. */
import { h, s, mount, spin, fmtInt, sleepMs, AGE_BANDS, cssVar, draftName } from '../core/dom.js';
import { api, fail } from '../core/api.js';
import { toast, qidChip } from '../core/ui.js';
import { reduced, EASE, stagger, tilt, magnetic, countUp } from '../core/motion.js';
import { sourcesStrip } from '../core/sources.js';
import { createStage, dotTexture } from '../core/three-kit.js';

const setupState = {
  business: '', handle: '', place: '', zip: '', goal: '', postA: '', postB: '',
  crowdSize: 60, rounds: 12, seeds: 2, useCustomers: true,
  audience: null, coreBands: null, coreShare: null, coreShareTouched: false,
  step: 0, visited: [0],
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
  { key: 'business', label: 'Who is posting', hint: 'Business and place' },
  { key: 'drafts', label: 'Your drafts', hint: 'Draft A and Draft B' },
  { key: 'audience', label: 'Audience', hint: 'Optional: choose a core group' },
  { key: 'settings', label: 'Run settings', hint: 'Audience size and length' },
  { key: 'launch', label: 'Launch', hint: 'Fold into worlds' },
];
const FIELD_STEP = { business: 0, handle: 0, place: 0, zip: 0, goal: 0, postA: 1, postB: 1 };
const REQUIRED = ['business', 'zip', 'postA', 'postB'];
const CROWDS = [[24, 'smoke test'], [60, 'quick'], [120, 'fuller'], [300, 'large'], [600, 'full']];
const ROUNDS = [[6, 'smoke test'], [12, 'standard'], [24, 'one day, hourly']];

const prefersLight = () => { const t = document.documentElement.dataset.theme; return t ? t === 'light' : matchMedia('(prefers-color-scheme: light)').matches; };

/* ============================================================ hero: twin worlds
 * One crowd (wireframe sphere in the middle, one dot per person at the configured crowd size) is copied into two
 * worlds (planets A and B) along a curved bridge. Same people go both ways; only the post each world sees differs.
 * The returned object has setCrowd(n) and destroy(). WebGL is paused offscreen by createStage; 2D fallback below. */
const HERO_MAX = 600;
const heroGeom = { ax: -3.9, ay: -0.5, cx: 0, cy: 0.55, ctrlY: 1.6 };
/** Point on the bridge: quadratic from A (t=0) through the crowd (t=.5) to B (t=1). */
function bridgeAt(t, out) {
  const { ax, ay, ctrlY } = heroGeom, bx = -ax, mt = 1 - t;
  out[0] = mt * mt * ax + 2 * mt * t * 0 + t * t * bx;
  out[1] = mt * mt * ay + 2 * mt * t * ctrlY + t * t * ay;
  return out;
}
function heroLabels(host) {
  const mk = (cls, a, b) => { const el = h('div.su-hl.' + cls, h('b', a), h('span', b)); host.append(el); return el; };
  return { a: mk('a', 'World A', 'sees Draft A'), c: mk('c', 'Same audience', ''), b: mk('b', 'World B', 'sees Draft B') };
}

function mountHero(host, initialCrowd) {
  let dead = false, stage = null, fallback = null, crowd = initialCrowd;
  const labels = heroLabels(host);
  const setCrowdLabel = () => { labels.c.querySelector('span').textContent = `${crowd} people, both worlds`; };
  setCrowdLabel();
  const N = 440;
  const parts = Array.from({ length: N }, (_, i) => ({ u: Math.random(), sp: 0.07 + Math.random() * 0.08, side: i % 2 ? 1 : -1, o: [Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5], w: Math.random() * 6.28 }));
  // Crowd members: fixed points inside a unit sphere (golden-angle spiral, cube-root radius for even volume).
  const members = Array.from({ length: HERO_MAX }, (_, i) => {
    const y = 1 - 2 * ((i * 0.6180339887) % 1), r = Math.sqrt(Math.max(0, 1 - y * y)), th = i * 2.39996, rad = 0.35 + 0.6 * Math.cbrt(((i * 0.7548776662) % 1));
    return [Math.cos(th) * r * rad, y * rad, Math.sin(th) * r * rad];
  });
  const mouse = { x: 0, y: 0, in: false };
  const onMove = (e) => { const r = host.getBoundingClientRect(); mouse.x = ((e.clientX - r.left) / r.width - 0.5) * 2; mouse.y = ((e.clientY - r.top) / r.height - 0.5) * 2; mouse.in = true; };
  const onLeave = () => { mouse.in = false; };
  host.addEventListener('pointermove', onMove); host.addEventListener('pointerleave', onLeave);
  let applyCrowd = () => {};

  createStage(host, { camera: { fov: 34, y: 0.7, z: 8.6 } }).then((st) => {
    if (dead) { st?.dispose(); return; }
    if (!st) { fallback = twin2D(host, parts, members, mouse, labels, () => crowd); return; }
    stage = st;
    const { THREE, scene, camera } = st, light = prefersLight();
    camera.lookAt(0, 0.1, 0);
    const blend = light ? THREE.NormalBlending : THREE.AdditiveBlending;
    const cA = new THREE.Color(cssVar('--a') || '#5b8cff'), cB = new THREE.Color(cssVar('--b') || '#ff9a4d');
    const cMid = new THREE.Color(light ? (cssVar('--accent') || '#6a52ff') : '#e9e6ff');
    const lineCol = light ? 0x5a6080 : 0xffffff;
    const group = new THREE.Group(); scene.add(group);
    scene.add(new THREE.AmbientLight(0xffffff, light ? 1.0 : 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 1.8); key.position.set(-2, 4, 6); scene.add(key);
    const glow = dotTexture(THREE);

    // floor grid: frames the scene without competing with it
    const grid = new THREE.GridHelper(16, 32, lineCol, lineCol);
    grid.material.transparent = true; grid.material.opacity = light ? 0.06 : 0.035; grid.material.depthWrite = false; grid.position.y = -1.9;
    scene.add(grid);

    // planets with a fresnel atmosphere, a thin tilted orbit ring and a small moon
    const atmoMat = (c) => new THREE.ShaderMaterial({
      uniforms: { c: { value: c }, k: { value: light ? 0.7 : 1.0 } }, transparent: true, depthWrite: false, side: THREE.BackSide, blending: blend,
      vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform vec3 c; uniform float k; varying vec3 vN; varying vec3 vV; void main(){ float f = pow(1.0 - abs(dot(vN, vV)), 2.2); gl_FragColor = vec4(c, f * k); }',
    });
    const planets = [cA, cB].map((c, i) => {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.7, 48, 32), new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: light ? 0.15 : 0.32, roughness: 0.55, metalness: 0.05 }));
      const atmo = new THREE.Mesh(new THREE.SphereGeometry(0.7, 48, 32), atmoMat(c)); atmo.scale.setScalar(1.32);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: c, transparent: true, opacity: light ? 0.18 : 0.38, depthWrite: false, blending: blend })); halo.scale.setScalar(3.4);
      const tilt = new THREE.Group(); tilt.rotation.set(1.18, 0, i ? -0.32 : 0.32);
      const ring = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 128 }, (_, k) => new THREE.Vector3(Math.cos(k / 128 * 6.2832) * 1.18, Math.sin(k / 128 * 6.2832) * 1.18, 0))),
        new THREE.LineBasicMaterial({ color: c, transparent: true, opacity: light ? 0.55 : 0.4 }));
      const moon = new THREE.Mesh(new THREE.SphereGeometry(0.075, 16, 12), new THREE.MeshBasicMaterial({ color: light ? c : 0xffffff }));
      tilt.add(ring, moon);
      g.add(halo, body, atmo, tilt); group.add(g);
      return { g, body, moon, side: i ? 1 : -1 };
    });

    // the crowd: faint wireframe sphere with one dot per person
    const crowdG = new THREE.Group(); crowdG.position.set(heroGeom.cx, heroGeom.cy, 0); group.add(crowdG);
    const wire = new THREE.LineSegments(new THREE.WireframeGeometry(new THREE.IcosahedronGeometry(0.95, 2)), new THREE.LineBasicMaterial({ color: light ? 0x6a52ff : 0xb9adff, transparent: true, opacity: light ? 0.22 : 0.14, depthWrite: false }));
    crowdG.add(wire);
    const mPos = new Float32Array(HERO_MAX * 3); members.forEach((m, i) => { mPos[i * 3] = m[0] * 0.92; mPos[i * 3 + 1] = m[1] * 0.92; mPos[i * 3 + 2] = m[2] * 0.92; });
    const mGeo = new THREE.BufferGeometry(); mGeo.setAttribute('position', new THREE.BufferAttribute(mPos, 3));
    const mPts = new THREE.Points(mGeo, new THREE.PointsMaterial({ size: 0.11, map: glow, color: cMid, transparent: true, opacity: 0.95, depthWrite: false, blending: blend }));
    crowdG.add(mPts);
    applyCrowd = () => { mGeo.setDrawRange(0, Math.min(HERO_MAX, crowd)); mPts.material.size = crowd > 200 ? 0.07 : crowd > 80 ? 0.09 : 0.12; };
    applyCrowd();

    // bridge guide line + streaming copies of the crowd
    const guide = new THREE.Line(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 81 }, (_, k) => { const p = bridgeAt(k / 80, [0, 0]); return new THREE.Vector3(p[0], p[1], 0); })),
      new THREE.LineDashedMaterial({ color: lineCol, transparent: true, opacity: light ? 0.25 : 0.16, dashSize: 0.12, gapSize: 0.1 }));
    guide.computeLineDistances(); group.add(guide);
    const pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.12, map: glow, vertexColors: true, transparent: true, opacity: light ? 0.85 : 0.9, depthWrite: false, blending: blend }));
    pts.frustumCulled = false; group.add(pts);

    const tmp = new THREE.Color(), still = reduced(), b2 = [0, 0], v3 = new THREE.Vector3();
    let tx = 0, ty = 0;
    const place = (el, obj, dy) => {
      obj.getWorldPosition(v3); v3.y += dy; v3.project(camera);
      const H = host.clientHeight, lh = el.offsetHeight, y = (1 - v3.y) / 2 * H;
      const top = Math.max(6, Math.min(H - lh - 6, dy > 0 ? y - lh : y)); // keep labels inside the frame
      el.style.transform = `translate(-50%, 0) translate(${((v3.x + 1) / 2 * host.clientWidth).toFixed(1)}px, ${top.toFixed(1)}px)`;
    };
    const halfTan = Math.tan((34 / 2) * Math.PI / 180);
    st.onFrame((t, dt) => {
      const T = still ? 0 : t, boost = !still && mouse.in ? 1.7 : 1;
      // keep both planets and their rings in frame on narrow cards: fit ~5.4 world units of half-width
      const z = Math.max(8.6, 5.4 / (halfTan * camera.aspect));
      if (Math.abs(camera.position.z - z) > 0.01) { camera.position.z = z; camera.lookAt(0, 0.1, 0); }
      planets.forEach((p) => {
        p.g.position.set(-heroGeom.ax * p.side, heroGeom.ay + Math.sin(T * 0.8 + (p.side > 0 ? 1.6 : 0)) * 0.08, 0);
        p.body.rotation.y = T * 0.3;
        const a = T * 0.9 * p.side + (p.side > 0 ? 3.1 : 0); p.moon.position.set(Math.cos(a) * 1.18, Math.sin(a) * 1.18, 0);
      });
      crowdG.rotation.y = T * 0.25; crowdG.rotation.x = Math.sin(T * 0.2) * 0.15;
      tx += ((still ? 0 : mouse.y * 0.12) - tx) * 0.06; ty += ((still ? 0 : mouse.x * 0.28) - ty) * 0.06;
      group.rotation.x = tx; group.rotation.y = ty;
      const wx = mouse.x * 6.2, wy = -mouse.y * 2.1;
      for (let i = 0; i < N; i++) {
        const p = parts[i];
        if (!still) p.u = (p.u + dt * p.sp * boost) % 1;
        const t2 = 0.5 + p.side * 0.5 * p.u;               // from the crowd (t=.5) out to one planet
        bridgeAt(t2, b2);
        const sw = Math.sin(p.u * Math.PI) * 0.55 + 0.08;   // tube widens mid-flight
        let x = b2[0] + p.o[0] * sw * 0.5, y = b2[1] + p.o[1] * sw + Math.sin(p.u * 6.28 + p.w + T) * 0.06;
        const z = p.o[2] * sw * 1.2;
        if (!still && mouse.in) { const dx = x - wx, dy = y - wy, d = Math.hypot(dx, dy); if (d < 1.6) { const k = (1 - d / 1.6) * 0.5 / (d || 1); x += dx * k; y += dy * k; } }
        pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
        tmp.copy(cMid).lerp(p.side < 0 ? cA : cB, Math.min(1, p.u * 1.4)); col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b;
      }
      geo.attributes.position.needsUpdate = true; geo.attributes.color.needsUpdate = true;
      place(labels.a, planets[0].g, -1.05); place(labels.b, planets[1].g, -1.05); place(labels.c, crowdG, 1.12);
    });
    host.classList.add('ready');
  }).catch(() => { if (!dead) fallback = twin2D(host, parts, members, mouse, labels, () => crowd); });

  return {
    setCrowd(n) { crowd = n; setCrowdLabel(); applyCrowd(); fallback?.draw?.(); },
    destroy() { dead = true; host.removeEventListener('pointermove', onMove); host.removeEventListener('pointerleave', onLeave); fallback?.stop(); stage?.dispose(); Object.values(labels).forEach((l) => l.remove()); },
  };
}

/** 2D canvas version of the same picture, used when WebGL is missing. Pauses when hidden or offscreen. */
function twin2D(host, parts, members, mouse, labels, getCrowd) {
  const cv = h('canvas'); cv.style.cssText = 'display:block;width:100%;height:100%'; host.append(cv);
  const g = cv.getContext('2d'), still = reduced();
  const cA = cssVar('--a') || '#5b8cff', cB = cssVar('--b') || '#ff9a4d', cM = cssVar('--accent') || '#8f7bff';
  let W = 1, H = 1, raf = 0, last = performance.now(), onScreen = true, T = 0;
  const size = () => { const d = Math.min(2, devicePixelRatio || 1); W = host.clientWidth || 1; H = host.clientHeight || 1; cv.width = W * d; cv.height = H * d; g.setTransform(d, 0, 0, d, 0, 0); draw(); };
  const io = new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; }); io.observe(host);
  const b2 = [0, 0];
  function draw() {
    const S = Math.min(W / 9, H / 4.2), ox = W / 2, oy = H * 0.55;
    const X = (x) => ox + x * S, Y = (y) => oy - y * S;
    g.clearRect(0, 0, W, H);
    g.strokeStyle = cM; g.globalAlpha = 0.25; g.setLineDash([4, 4]); g.beginPath();
    for (let k = 0; k <= 60; k++) { bridgeAt(k / 60, b2); k ? g.lineTo(X(b2[0]), Y(b2[1])) : g.moveTo(X(b2[0]), Y(b2[1])); } g.stroke(); g.setLineDash([]);
    for (const p of parts) {
      bridgeAt(0.5 + p.side * 0.5 * p.u, b2);
      const sw = Math.sin(p.u * Math.PI) * 0.55 + 0.08;
      g.globalAlpha = 0.3 + 0.5 * Math.sin(p.u * Math.PI); g.fillStyle = p.u < 0.35 ? cM : p.side < 0 ? cA : cB;
      g.beginPath(); g.arc(X(b2[0] + p.o[0] * sw * 0.5), Y(b2[1] + p.o[1] * sw), 1.5, 0, 6.2832); g.fill();
    }
    const cx = X(heroGeom.cx), cy = Y(heroGeom.cy), r = 0.95 * S, n = Math.min(HERO_MAX, getCrowd());
    g.globalAlpha = 0.35; g.strokeStyle = cM; g.beginPath(); g.arc(cx, cy, r, 0, 6.2832); g.stroke(); g.beginPath(); g.ellipse(cx, cy, r, r * 0.35, 0, 0, 6.2832); g.stroke();
    g.globalAlpha = 0.9; g.fillStyle = cM;
    for (let i = 0; i < n; i++) { const m = members[i], c = Math.cos(T * 0.25), s2 = Math.sin(T * 0.25); g.beginPath(); g.arc(cx + (m[0] * c - m[2] * s2) * r * 0.92, cy - m[1] * r * 0.92, n > 200 ? 1 : 1.6, 0, 6.2832); g.fill(); }
    g.globalAlpha = 1;
    const pr = 0.7 * S, py = Y(heroGeom.ay);
    for (const [x, c] of [[X(heroGeom.ax), cA], [X(-heroGeom.ax), cB]]) {
      g.fillStyle = c; g.shadowColor = c; g.shadowBlur = 22; g.beginPath(); g.arc(x, py, pr, 0, 6.2832); g.fill(); g.shadowBlur = 0;
      g.strokeStyle = c; g.globalAlpha = 0.5; g.beginPath(); g.ellipse(x, py, pr * 1.7, pr * 0.45, -0.2, 0, 6.2832); g.stroke(); g.globalAlpha = 1;
    }
    const lab = (el, x, y) => { const top = Math.max(6, Math.min(H - el.offsetHeight - 6, y)); el.style.transform = `translate(-50%, 0) translate(${x.toFixed(1)}px, ${top.toFixed(1)}px)`; };
    lab(labels.a, X(heroGeom.ax), Y(heroGeom.ay - 1.05)); lab(labels.b, X(-heroGeom.ax), Y(heroGeom.ay - 1.05)); lab(labels.c, cx, Y(heroGeom.cy + 1.12) - 32);
  }
  const frame = (now) => {
    raf = requestAnimationFrame(frame);
    if (!onScreen || document.hidden || host.offsetParent === null) { last = now; return; }
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (still) return;
    T += dt;
    for (const p of parts) p.u = (p.u + dt * p.sp * (mouse.in ? 1.7 : 1)) % 1;
    draw();
  };
  const ro = new ResizeObserver(size); ro.observe(host); size();
  raf = requestAnimationFrame(frame);
  host.classList.add('ready');
  return { draw, stop() { cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); cv.remove(); } };
}

/* ============================================================ crowd dot field (step 4) */
function dotField(host) {
  // One slot per possible person (600 max). The chosen crowd lights up scattered across the field (seeded order),
  // so a 60-person crowd reads as a sample of the full population rather than a filled first row.
  const cv = h('canvas'); cv.style.cssText = 'position:absolute;inset:0;display:block;width:100%;height:100%'; host.append(cv);
  const g = cv.getContext('2d');
  let W = 1, H = 1, shown = 0, target = 0, share = null, raf = 0;
  const MAX = 600;
  const rank = new Array(MAX);
  { const order = Array.from({ length: MAX }, (_, i) => i); let seed = 7;
    for (let i = MAX - 1; i > 0; i--) { seed = (seed * 16807) % 2147483647; const j = seed % (i + 1); [order[i], order[j]] = [order[j], order[i]]; }
    order.forEach((slot, r) => { rank[slot] = r; }); }
  const size = () => { const d = Math.min(2, devicePixelRatio || 1); W = host.clientWidth || 1; H = host.clientHeight || 1; cv.width = W * d; cv.height = H * d; g.setTransform(d, 0, 0, d, 0, 0); draw(); };
  function draw() {
    g.clearRect(0, 0, W, H);
    const HH = Math.max(40, H - 40), WW = W - 16; // leave room for the caption pill under the field
    let sp = Math.max(5, Math.floor(Math.sqrt(WW * HH / (MAX * 1.05))));
    let cols = Math.max(1, Math.floor(WW / sp));
    while (Math.ceil(MAX / cols) * sp > HH && sp > 5) { sp--; cols = Math.max(1, Math.floor(WW / sp)); }
    const rows = Math.ceil(MAX / cols), ox = (W - cols * sp) / 2 + sp / 2, oy = 8 + (HH - rows * sp) / 2 + sp / 2;
    const accent = cssVar('--accent') || '#8f7bff', teal = cssVar('--accent-2') || '#4fe3c1', faint = cssVar('--line-2') || 'rgba(255,255,255,.13)';
    const r0 = sp * 0.33;
    for (let i = 0; i < MAX; i++) {
      const x = ox + (i % cols) * sp, y = oy + Math.floor(i / cols) * sp, r = rank[i];
      const k = r < Math.floor(shown) ? 1 : r < shown ? shown - Math.floor(shown) : 0;
      g.beginPath();
      if (k <= 0) { g.fillStyle = faint; g.globalAlpha = 0.6; g.arc(x, y, r0 * 0.5, 0, 6.2832); }
      else {
        const isCore = share != null && ((r * 0.6180339887) % 1) < share;
        g.fillStyle = share == null || isCore ? accent : teal; g.globalAlpha = 0.95; g.arc(x, y, r0 * (0.4 + 0.9 * k), 0, 6.2832);
      }
      g.fill();
    }
    g.globalAlpha = 1;
  }
  function tick() {
    raf = 0;
    const d = target - shown;
    if (Math.abs(d) < 0.5) shown = target; else shown += Math.sign(d) * Math.max(2, Math.abs(d) * 0.16);
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
  let cur = Math.min(Math.max(S.step || 0, 0), STEPS.length - 1), goSeq = 0, launching = false, heroCtl = null;

  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const missing = () => REQUIRED.filter((k) => !String(S[k]).trim());
  const payload = () => ({ business: S.business, handle: S.handle, place: S.place, zip: S.zip, goal: S.goal, postA: S.postA, postB: S.postB });
  // A step reads as done once its inputs are complete. Run settings has working defaults, so it only counts once seen.
  const seen = new Set([...(S.visited || []), cur]);
  const stepDone = (i) => [
    !!(S.business.trim() && S.zip.trim()), !!(S.postA.trim() && S.postB.trim()), !!S.audience, seen.has(3), false,
  ][i];

  /* ---- fields ---- */
  const field = (key, label, el, cls = '') => { f[key] = el; wrap[key] = h('div.su-field.' + (cls || 'x'), h('label', label), el); return wrap[key]; };
  const text = (key, ph) => h('input', {
    type: 'text', placeholder: ph || '', value: S[key], autocomplete: 'off',
    oninput: (e) => { S[key] = e.target.value; if (key === 'handle') syncers.forEach((fn) => fn()); railDone(); },
  });

  /* ---- hero ---- */
  const heroHost = h('div.su-orbs', { 'aria-hidden': 'true' });
  const title = h('h1', 'See how people react before you post, and why.');
  const hero = h('header.su-hero',
    h('div.su-hero-copy', h('div.su-kicker', 'New simulation'), title,
      h('p', 'An audience sampled from live Census and Pew data sees each draft in a counterfactual world: same people, same follower graph, same schedule. Only the content differs. You get who reacts, how they feel and why, with the evidence for each reason.'),
      h('ul.su-hero-pts', h('li', h('b', '1 audience'), ' sampled once'), h('li', h('b', '2 worlds'), ' in parallel'), h('li', h('b', '1 result'), ' with evidence'))),
    heroHost);

  /* ---- panel scaffolding ---- */
  const panel = (i, sub, actions, ...body) => h('section.su-panel', { hidden: i !== cur, 'data-step': i, 'aria-label': STEPS[i].label },
    h('div.su-phead', h('div', h('div.su-kicker', `Step ${i + 1} of ${STEPS.length}`), h('h2', STEPS[i].label), h('p.su-sub', sub)), actions ? h('div.su-pact', actions) : null),
    h('div.su-body', body));

  /* ---------- step 1: business ---------- */
  const exampleBtn = h('button.btn.sm', { onclick: loadExample }, 'Load example');
  const p0 = panel(0, 'Tell the audience who is posting. Business and ZIP are required; the rest sharpens the read.', exampleBtn,
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
    const ta = h('textarea', { placeholder: `Paste or write the caption for Draft ${v}`, value: S[key], maxlength: 4000, 'aria-label': `${draftName(v)} caption`,
      oninput: (e) => { S[key] = e.target.value; upd(); railDone(); } });
    f[key] = ta;
    const upd = () => {
      handle.textContent = S.handle.trim() || '@yourhandle';
      const t = S[key], n = t.length;
      count.textContent = `${n.toLocaleString()} / 2,200`; count.classList.toggle('over', n > 2200);
      const words = t.trim() ? t.trim().split(/\s+/).length : 0;
      peek.replaceChildren(h('span.su-peek-l', 'In the feed'), h('span.su-peek-t', t.trim() ? [t.length > 125 ? t.slice(0, 125).trimEnd() : t, t.length > 125 ? h('span.su-more', ' … more') : null] : h('i', 'Nothing yet')), h('span.su-words', `${words} words`));
    };
    syncers.push(upd); upd();
    const card = h('article.su-post.' + lc,
      h('div.su-post-head', h('div.su-ava', v), h('div', handle, h('div.su-meta', 'Sponsored preview')), h('span.chip.' + lc, `${draftName(v)}`)),
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
  const p1 = panel(1, 'Write the two drafts as they would appear. They run in counterfactual worlds that differ only by this text.', null,
    h('div.su-twins', postCard('A'), seam, postCard('B')));

  /* ---------- step 3: audience ---------- */
  const audienceBox = h('div.su-aud');
  const proposeBtn = h('button.btn', { onclick: propose }, 'Propose audience');
  const p2 = panel(2, 'Optional. The audience is the ZIP\'s Instagram users. The Audience agent names a core group and a spillover group from live Census and Pew rows; you choose which age bands are core and how large their share is. Skip it and the run proposes its own.', proposeBtn, audienceBox);
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
    const donut = s('svg', { viewBox: '0 0 140 140', class: 'su-donut', role: 'img', 'aria-label': 'Core versus spillover share of the audience' },
      s('g', { transform: 'rotate(-90 70 70)' }, s('circle', { cx: 70, cy: 70, r: 52, class: 'dn track' }), arcSp, arcCore),
      dnText, s('text', { x: 70, y: 88, class: 'dn-sm', 'text-anchor': 'middle' }, 'core'));
    const stackCore = h('i.core'), stackSp = h('i.sp');
    const stack = h('div.su-stack', stackCore, stackSp);
    const legend = h('div.su-legend');
    const slider = h('input', { type: 'range', min: 50, max: 70, step: 1, value: Math.round(share() * 100), 'aria-label': 'Core share of the audience' });
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
      fills.forEach(([el, w], i) => { el.style.transition = ''; el.style.transitionDelay = `${Math.floor(i / 2) * 40 + (i % 2) * 60}ms`; el.style.width = `${w}%`; });
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
      note.textContent = e != null ? `Data estimate from the join: about ${(e * 100).toFixed(0)}% (clamped to 50-70%). The exact value is computed when the audience is sampled.` : 'Exact value is computed when the audience is sampled.';
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
        h('div.su-share-ctl', h('div.row.spread', h('span.muted', 'Core share of the audience'), shareLabel), slider, h('div.row.spread', note, resetBtn))),
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
  const dotsCap = h('div.su-dots-cap');
  const fieldHost = h('div.su-dots', dotsCap);
  let dots = null;
  const estLine = h('p.su-est');
  function choiceRow(label, key, opts, fmt) {
    const row = h('div.su-seg-row', { role: 'group', 'aria-label': label });
    const draw = () => mount(row, opts.map(([v, tag]) => h('button.su-opt' + (S[key] === v ? '.on' : ''), { 'aria-pressed': String(S[key] === v),
      onclick: () => { S[key] = v; draw(); settingsChanged(); } }, h('b', fmt ? fmt(v) : v), tag ? h('span', tag) : null)));
    draw(); return h('div.su-set', h('label', label), row);
  }
  const custToggle = h('input', { type: 'checkbox', checked: S.useCustomers, onchange: (e) => { S.useCustomers = e.target.checked; settingsChanged(); } });
  const p3 = panel(3, 'Bigger audiences and more seeds take longer. The 60-person quick run is the demo default.', null,
    h('div.su-settings',
      h('div.su-set-col',
        choiceRow('Audience size', 'crowdSize', CROWDS, (v) => String(v)),
        choiceRow('Length', 'rounds', ROUNDS, (v) => `${v} rounds`),
        choiceRow('Seeds', 'seeds', [[1, 'one pass'], [2, 'check agreement']], (v) => `${v} seed${v > 1 ? 's' : ''}`),
        h('label.su-switch', custToggle, h('span.su-track', h('i')), h('span', 'Use customer list ', h('em', '(synthetic demo CSV)')))),
      h('div.su-set-vis', fieldHost, estLine)));

  function crowdShare() { return S.audience && S.coreBands?.length ? (S.coreShareTouched && S.coreShare != null ? S.coreShare : clamp(estimateCoreShare(S.audience.join.rows, S.coreBands) ?? 0.6, 0.5, 0.7)) : null; }
  function syncCrowd() { dots?.set(S.crowdSize, crowdShare()); heroCtl?.setCrowd(S.crowdSize); }
  function settingsChanged() {
    syncCrowd();
    mount(dotsCap, h('b', `${S.crowdSize}`), ` of 600 people`, h('span', S.crowdSize === 600 ? 'full population' : 'one dot per person'));
    const pr = S.crowdSize * S.rounds * S.seeds;
    mount(estLine, h('b', `${S.crowdSize} people`), ` over ${S.rounds} rounds, ${S.seeds} seed${S.seeds > 1 ? 's' : ''}, in both worlds: `, h('b', `${(pr * 2).toLocaleString()} person-rounds`),
      `. ${S.seeds > 1 ? 'Two seeds let us check the passes agree. ' : 'One seed cannot show whether the result is stable. '}No clock time is promised; larger settings take longer.`,
      crowdShare() != null ? h('span.su-dot-key', h('i.core'), 'core', h('i.sp'), 'spillover') : null);
    renderSummary();
  }

  /* ---------- step 5: launch ---------- */
  const summary = h('div.su-summary');
  const fold = h('div.su-fold');
  const runBtn = h('button.btn.primary.su-run', { onclick: launch }, 'Run Ripple');
  cleanups.push(magnetic(runBtn, 0.18));
  const foldLabel = h('div.su-fold-cap', 'Folding the two drafts into counterfactual worlds...');
  const p4 = panel(4, 'One last look. Launching samples the audience and starts both worlds.', null,
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
      ['Audience size', `${S.crowdSize} people, ${S.rounds} rounds, ${S.seeds} seed${S.seeds > 1 ? 's' : ''}`], ['Audience', core], ['Customer list', S.useCustomers ? 'used (synthetic demo CSV)' : 'not used'],
    ];
    mount(summary, facts.map(([k, v, key]) => h('div.su-fact' + (v ? '' : '.miss'), { onclick: key ? () => flagMissing([key]) : null }, h('span', k), h('b', v || 'missing'))),
      missing().includes('postA') || missing().includes('postB') ? h('div.su-fact.miss', { onclick: () => flagMissing(['postA', 'postB'].filter((k) => missing().includes(k))) }, h('span', 'Drafts'), h('b', 'a draft is empty')) : null);
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
      fail(e); launching = false; runBtn.disabled = false; mount(runBtn, 'Run Ripple');
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
  const rail = h('nav.su-rail', { 'aria-label': 'New simulation steps' }, ind, railBtns);
  const progFill = h('i'), progText = h('span');
  const progress = h('div.su-prog', h('div.su-prog-bar', progFill), progText);
  rail.append(progress);
  function railDone() {
    railBtns.forEach((b, i) => { b.classList.toggle('done', i !== cur && stepDone(i)); b.classList.toggle('now', i === cur); b.setAttribute('aria-current', i === cur ? 'step' : 'false'); });
    const ready = [0, 1, 2, 3].filter(stepDone).length, req = missing().length;
    progFill.style.width = `${(ready / 4) * 100}%`;
    progText.textContent = req ? `${ready} of 4 steps ready` : 'Ready to launch';
    progress.classList.toggle('ok', !req);
  }
  function moveInd() {
    const b = railBtns[cur]; if (!b) return;
    ind.style.width = `${b.offsetWidth}px`; ind.style.height = `${b.offsetHeight}px`; ind.style.transform = `translate(${b.offsetLeft}px, ${b.offsetTop}px)`;
  }
  const backBtn = h('button.btn.ghost', { onclick: () => go(cur - 1) }, 'Back');
  const nextBtn = h('button.btn.primary', { onclick: () => go(cur + 1) }, 'Next');
  const navCount = h('span.su-ncount');
  const nav = h('div.su-nav', backBtn, navCount, nextBtn);
  function updateNav() {
    backBtn.disabled = cur === 0; nextBtn.hidden = cur === STEPS.length - 1;
    nextBtn.textContent = cur === 2 && !S.audience ? 'Skip audience' : 'Next';
    navCount.textContent = `${cur + 1} of ${STEPS.length}`;
  }
  const panels = [p0, p1, p2, p3, p4];
  const stagePane = h('div.su-stage', h('div.su-panels', panels), nav);

  function onEnter(i) {
    if (i === 1) syncers.forEach((fn) => fn());
    if (i === 2) playBars();
    if (i === 3) { settingsChanged(); dots?.redraw(); }
    if (i === 4) renderSummary();
  }

  // Swap panels at once (never blank) and let the new one settle in under ~300 ms.
  async function go(i) {
    i = clamp(i, 0, STEPS.length - 1);
    if (launching || i === cur) return;
    goSeq++;
    const dir = i > cur ? 1 : -1;
    panels.forEach((p) => p.getAnimations().forEach((a) => a.cancel()));
    cur = S.step = i; seen.add(i); S.visited = [...seen];
    panels.forEach((p, k) => { p.hidden = k !== i; });
    railDone(); moveInd(); updateNav();
    onEnter(i);
    if (!reduced()) panels[i].animate([{ opacity: 0.25, transform: `translateX(${dir * 12}px)` }, { opacity: 1, transform: 'none' }], { duration: 280, easing: EASE.out });
    const top = stagePane.getBoundingClientRect().top;
    if (top < 70) window.scrollTo({ top: Math.max(0, window.scrollY + top - 84), behavior: reduced() ? 'auto' : 'smooth' });
  }

  const shell = h('div.su-shell', rail, h('div.su-main', stagePane));
  shell.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('input[type=text]') && cur < STEPS.length - 1) { e.preventDefault(); go(cur + 1); }
  });

  view.append(h('div.view-page.su-page', hero, sourcesStrip(), shell));
  if (!reduced()) {
    [...hero.querySelectorAll('.su-hero-copy > *')].forEach((el, k) => el.animate([{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], { duration: 420, delay: k * 50, easing: EASE.out, fill: 'backwards' }));
    stagger(railBtns, { y: 6, gap: 35, ms: 360, delay: 60 });
  }
  heroCtl = mountHero(heroHost, S.crowdSize); cleanups.push(() => heroCtl.destroy());

  dots = dotField(fieldHost); cleanups.push(() => dots.destroy());
  const ro = new ResizeObserver(moveInd); ro.observe(rail); cleanups.push(() => ro.disconnect());
  document.fonts?.ready.then(moveInd);

  renderAudience(); if (S.audience) mount(proposeBtn, 'Propose again');
  settingsChanged(); railDone(); updateNav(); moveInd(); onEnter(cur);
  return () => { goSeq++; cleanups.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } }); cardTilts.forEach((fn) => fn()); };
}

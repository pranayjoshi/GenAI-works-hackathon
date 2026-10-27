/* Twin worlds stage: World A | duel strip | World B. Each world has a post card, live counters, a vocal/silent
 * meter and a phone-framed feed. The centre strip is a tug-of-war on intent rate plus two orbs (three.js, 2D canvas
 * fallback) whose size follows deciders and glow follows intent. Counters come from S.counters[wid] only; a dash
 * means "not reported yet". Ported from legacy/app.js buildWorlds / updateCounters / feedCard / addAction / renderInject. */
import { h, s, mount, pct, fmtInt, avatar, actPill, reasonLines, variantChip, vcolor, roundTime, cssVar, ICONS } from '../../core/dom.js';
import { countUp, tilt, reduced, stagger, EASE } from '../../core/motion.js';
import { createStage, dotTexture } from '../../core/three-kit.js';
import { api, fail } from '../../core/api.js';
import { toast, openAgent } from '../../core/ui.js';

const FILTERS = [['all', 'All'], ['engaged', 'Engaged only'], ['comment', 'Comments'], ['share', 'Shares'], ['hide', 'Hides']];
const icon = (d) => s('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' }, s('path', { d }));
const colorOf = (v, fallback) => cssVar(`--${String(v).toLowerCase()}`) || fallback;

/* ------------------------------------------------------------------ duel orbs (three.js, 2D fallback) */
/* set([{size 0..1, glow 0..1, has}, ...]), burst(i, action), show(), hide(), dispose() */
function makeDuel(host, getCols, isDead) {
  let impl = null, disposed = false, pending = null, shownNow = false;
  const api_ = {
    set(st) { pending = st; impl?.set(st); },
    burst(i, action) { impl?.burst(i, action); },
    show() { shownNow = true; impl?.show?.(); },
    hide() { shownNow = false; impl?.hide?.(); },
    dispose() { disposed = true; impl?.dispose(); impl = null; },
  };
  (async () => {
    let stage = null;
    try { stage = await createStage(host, { camera: { fov: 38, z: 9 } }); } catch (e) { console.warn('worlds: 3D unavailable, using 2D', e); }
    if (disposed || isDead()) { stage?.dispose(); return; }
    impl = stage ? make3d(host, stage, getCols) : make2d(host, getCols);
    if (pending) impl.set(pending);
    if (shownNow) impl.show?.();
  })();
  return api_;
}

function make3d(host, stage, getCols) {
  const T = stage.THREE, cols = getCols();
  const still = reduced();
  stage.scene.add(new T.AmbientLight(0xffffff, 0.7));
  const key = new T.PointLight(0xffffff, 45, 40); key.position.set(0, 3, 6); stage.scene.add(key);
  const orbs = [0, 1].map((i) => {
    const col = new T.Color(cols[i]);
    const g = new T.Group(); g.position.x = i ? 1.3 : -1.3;
    const core = new T.Mesh(new T.SphereGeometry(0.8, 32, 24), new T.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.25, roughness: 0.35, metalness: 0.2 }));
    const shell = new T.Mesh(new T.IcosahedronGeometry(1.05, 1), new T.MeshBasicMaterial({ color: col, wireframe: true, transparent: true, opacity: 0.3 }));
    const ring = new T.Mesh(new T.TorusGeometry(1.3, 0.018, 8, 72), new T.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.55 }));
    ring.rotation.x = 1.15 + i * 0.3;
    g.add(core, shell, ring); stage.scene.add(g);
    g.scale.setScalar(0.5);
    return { g, core, shell, ring, col, sc: 0.5, tsc: 0.5, em: 0.25, tem: 0.25 };
  });
  // particle pool
  const N = 110, pos = new Float32Array(N * 3), colr = new Float32Array(N * 3), vel = new Float32Array(N * 3), life = new Float32Array(N), base = new Float32Array(N * 3);
  for (let k = 0; k < N; k++) pos[k * 3 + 2] = -100;
  const geo = new T.BufferGeometry();
  geo.setAttribute('position', new T.BufferAttribute(pos, 3)); geo.setAttribute('color', new T.BufferAttribute(colr, 3));
  const tex = dotTexture(T, 64);
  const pts = new T.Points(geo, new T.PointsMaterial({ size: 0.34, map: tex, vertexColors: true, transparent: true, depthWrite: false, blending: T.AdditiveBlending }));
  pts.frustumCulled = false; stage.scene.add(pts);
  let cursor = 0;
  const off = stage.onFrame((t, dt) => {
    orbs.forEach((o, i) => {
      o.sc += (o.tsc - o.sc) * Math.min(1, dt * 4); o.em += (o.tem - o.em) * Math.min(1, dt * 4);
      o.g.scale.setScalar(o.sc); o.core.material.emissiveIntensity = o.em;
      o.shell.material.opacity = 0.2 + Math.min(0.5, o.em * 0.3);
      if (!still) { o.g.rotation.y += dt * (0.35 + o.em * 0.6); o.shell.rotation.x -= dt * 0.25; o.ring.rotation.z += dt * (0.4 + i * 0.1); o.g.position.y = Math.sin(t * 1.1 + i * 2) * 0.08; }
    });
    let any = false;
    for (let k = 0; k < N; k++) {
      if (life[k] <= 0) continue;
      any = true;
      life[k] -= dt;
      const j = k * 3;
      pos[j] += vel[j] * dt; pos[j + 1] += vel[j + 1] * dt; pos[j + 2] += vel[j + 2] * dt;
      vel[j] *= 0.985; vel[j + 1] *= 0.985;
      const l = Math.max(0, life[k]);
      colr[j] = base[j] * l; colr[j + 1] = base[j + 1] * l; colr[j + 2] = base[j + 2] * l;
      if (life[k] <= 0) { pos[j + 2] = -100; colr[j] = colr[j + 1] = colr[j + 2] = 0; }
    }
    if (any) { geo.attributes.position.needsUpdate = true; geo.attributes.color.needsUpdate = true; }
  });
  return {
    set(st) {
      st.forEach((x, i) => { const o = orbs[i]; if (!o || !x) return; o.tsc = x.has ? 0.55 + 0.5 * x.size : 0.5; o.tem = x.has ? 0.3 + 1.4 * Math.min(1, x.glow * 1.6) : 0.15; if (still) { o.sc = o.tsc; o.em = o.tem; } });
    },
    burst(i, action) {
      if (still) return;
      const o = orbs[i]; if (!o) return;
      const c = action === 'hide' ? new T.Color(cssVar('--bad') || '#ff5f6d') : o.col;
      const n = action === 'scroll_past' ? 2 : 9;
      for (let q = 0; q < n; q++) {
        const k = cursor = (cursor + 1) % N, j = k * 3, a = Math.random() * Math.PI * 2, sp = 1.2 + Math.random() * 2.4;
        pos[j] = o.g.position.x; pos[j + 1] = o.g.position.y; pos[j + 2] = 0.2;
        vel[j] = Math.cos(a) * sp + (i ? -0.6 : 0.6); vel[j + 1] = Math.sin(a) * sp; vel[j + 2] = (Math.random() - 0.3) * 1.2;
        base[j] = c.r; base[j + 1] = c.g; base[j + 2] = c.b; life[k] = 0.9 + Math.random() * 0.7;
      }
    },
    show() { stage.resize(); },
    dispose() { off(); tex.dispose(); stage.dispose(); },
  };
}

function make2d(host, getCols) {
  const cv = document.createElement('canvas'); cv.style.cssText = 'display:block;width:100%;height:100%'; host.append(cv);
  const g = cv.getContext('2d'), cols = getCols(), still = reduced();
  let W = 1, H = 1, dpr = 1, raf = 0, tm = 0, running = false, last = performance.now(), gone = false;
  const orbs = [0, 1].map(() => ({ sc: 0.5, tsc: 0.5, gl: 0.15, tgl: 0.15, rot: 0 })), parts = [];
  const size = () => { dpr = Math.min(2, window.devicePixelRatio || 1); W = host.clientWidth || 1; H = host.clientHeight || 1; cv.width = W * dpr; cv.height = H * dpr; };
  const ro = new ResizeObserver(size); ro.observe(host); size();
  function frame(now) {
    raf = 0; if (!running || gone) return;
    if (document.hidden || host.offsetParent === null) { tm = setTimeout(() => { tm = 0; frame(performance.now()); }, 300); return; }
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    orbs.forEach((o, i) => {
      o.sc += (o.tsc - o.sc) * Math.min(1, dt * 4); o.gl += (o.tgl - o.gl) * Math.min(1, dt * 4); if (!still) o.rot += dt * 30;
      const cx = W * (i ? 0.72 : 0.28), cy = H / 2, r = Math.min(W / 2, H) * 0.3 * o.sc;
      g.save(); g.shadowColor = cols[i]; g.shadowBlur = 8 + 40 * o.gl; g.fillStyle = cols[i]; g.globalAlpha = 0.9;
      g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill(); g.restore();
      g.save(); g.globalAlpha = 0.28; g.fillStyle = '#fff'; g.beginPath(); g.arc(cx - r * 0.3, cy - r * 0.3, r * 0.4, 0, Math.PI * 2); g.fill(); g.restore();
      g.save(); g.strokeStyle = cols[i]; g.globalAlpha = 0.5; g.setLineDash([4, 6]); g.lineDashOffset = -o.rot; g.beginPath(); g.arc(cx, cy, r * 1.35, 0, Math.PI * 2); g.stroke(); g.restore();
    });
    for (let k = parts.length - 1; k >= 0; k--) {
      const p = parts[k]; p.life -= dt; if (p.life <= 0) { parts.splice(k, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.985; p.vy *= 0.985;
      g.save(); g.globalAlpha = Math.min(1, p.life); g.fillStyle = p.c; g.beginPath(); g.arc(p.x, p.y, 2.5, 0, Math.PI * 2); g.fill(); g.restore();
    }
    raf = requestAnimationFrame(frame);
  }
  return {
    set(st) { st.forEach((x, i) => { const o = orbs[i]; if (!o || !x) return; o.tsc = x.has ? 0.6 + 0.5 * x.size : 0.5; o.tgl = x.has ? 0.2 + Math.min(1, x.glow * 1.6) : 0.1; if (still) { o.sc = o.tsc; o.gl = o.tgl; } }); },
    burst(i, action) {
      if (still) return;
      const c = action === 'hide' ? (cssVar('--bad') || '#ff5f6d') : cols[i], cx = W * (i ? 0.72 : 0.28), cy = H / 2;
      for (let q = 0; q < (action === 'scroll_past' ? 2 : 9) && parts.length < 150; q++) { const a = Math.random() * Math.PI * 2, sp = 40 + Math.random() * 90; parts.push({ x: cx, y: cy, vx: Math.cos(a) * sp + (i ? -20 : 20), vy: Math.sin(a) * sp, life: 0.9 + Math.random() * 0.7, c }); }
    },
    show() { if (running) return; running = true; last = performance.now(); size(); if (!raf && !tm) raf = requestAnimationFrame(frame); },
    hide() { running = false; cancelAnimationFrame(raf); raf = 0; clearTimeout(tm); tm = 0; },
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
    const offs = [], cleanups = [], W = {};
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
      text: h('input', { type: 'text', placeholder: 'What happens: e.g. a competitor posts 30% off', 'aria-label': 'What happens' }),
      btn: h('button.btn.primary.sm', { type: 'button' }, 'Inject'),
      note: h('div.wx-inj-note'), evs: h('div.wx-evs'),
      chips: h('div.wx-chips', { role: 'group', 'aria-label': 'Filter feed' }),
      search: h('input', { type: 'search', placeholder: 'Search person or text', 'aria-label': 'Search feeds' }),
      stage: h('div.wx-stage', { 'data-side': '0' }), flip: h('div.wx-flip'),
      pulses: h('div.wx-pulses'), duelHost: h('div.wx-duel-host'),
      tugA: h('i.wx-tug-a'), tugB: h('i.wx-tug-b'), tugKnob: h('i.wx-knob'), tugLa: h('b', '-'), tugLb: h('b', '-'), tugNote: h('small', 'waiting for both worlds'),
    };
    ui.replay.append(ui.rpLabel, ui.rpSegs, ui.rpAct);
    const bar = h('div.wx-bar',
      h('div.wx-cmd', h('div.wx-cmd-row',
        h('span.wx-cmd-ico', icon('M13 2L3 14h8l-1 8 10-12h-8z')), ui.text,
        h('label.wx-sel', h('small', 'Round'), ui.roundSel), h('label.wx-sel', h('small', 'Who sees it'), ui.target), ui.btn),
      ui.note, ui.evs),
      h('div.wx-tools', ui.chips, h('div.wx-search', icon('M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3'), ui.search)));
    // centre duel column
    const center = h('div.wx-center',
      h('div.wx-seam', ui.pulses),
      h('div.wx-duel-card',
        h('div.wx-duel-title', 'The duel'),
        ui.duelHost,
        h('div.wx-duel-key', 'orb size = deciders, glow = intent rate'),
        h('div.wx-tug',
          h('div.wx-tug-lab', h('span.a', ctx.variants()[0] || 'A', ' ', ui.tugLa), h('span.b', ui.tugLb, ' ', ctx.variants()[1] || 'B')),
          h('div.wx-tug-bar', ui.tugA, ui.tugB, ui.tugKnob), ui.tugNote)));
    el.append(h('div.wx-wrap', ui.replay, bar, ui.flip, ui.stage));

    const duel = makeDuel(ui.duelHost, colsNow, () => dead);

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
        r.item_kind === 'event' ? h('span.chip.wx-mini', 'reacting to news') : null,
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
      if (!c) {
        w.title.textContent = done() ? 'no counters recorded' : 'not started';
        put(cl.deciders, 0, fmtInt, ` / ${fmtInt(t)}`);
        for (const k of ['intent', 'hides', 'stance', 'calls', 'exposures']) put(cl[k], null, fmtInt, '');
        w.mV.style.width = '0'; w.mS.style.width = '0'; w.mLabel.textContent = 'waiting for deciders';
        return;
      }
      const d = c.deciders || 0;
      w.title.textContent = `${c.hour_label || ctx.hourOfRound(c.round)} · round ${c.round + 1}${S.spec ? ` of ${S.spec.rounds}` : ''}`;
      put(cl.deciders, d, fmtInt, ` / ${fmtInt(t)} target`);
      put(cl.intent, d ? (c.intent / d) * 100 : null, (x) => `${Math.round(x)}%`, d ? `${c.intent} of ${d}` : '');
      put(cl.hides, c.hides, fmtInt, '');
      put(cl.stance, d ? c.stance_sum / d : null, (x) => (x >= 0 ? '+' : '') + x.toFixed(2), '-1 to +1');
      cl.stance.b.classList.toggle('pos', d && c.stance_sum > 0); cl.stance.b.classList.toggle('neg', d && c.stance_sum < 0);
      put(cl.calls, c.calls, fmtInt, ''); put(cl.exposures, c.exposures, fmtInt, '');
      const vs = d ? (c.vocal || 0) / d : 0;
      w.mV.style.width = `${vs * 100}%`; w.mS.style.width = d ? `${(1 - vs) * 100}%` : '0';
      w.mLabel.textContent = d ? `${pct(vs, 0)} vocal (commented or shared), ${pct(1 - vs, 0)} silent` : 'waiting for deciders';
    }
    function updateDuel() {
      const ws = wids(), cs = ws.map((w) => S.counters[w]);
      const rate = cs.map((c) => (c && c.deciders ? c.intent / c.deciders : null));
      const t = targetOf();
      duel.set(cs.map((c, i) => ({ has: !!c && c.deciders > 0, size: c ? Math.min(1, (c.deciders || 0) / t) : 0, glow: rate[i] || 0 })));
      const [ra, rb] = rate;
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
      const cell = (key, label) => { const b = h('b', '-'), sm = h('small'); w.cells[key] = { b, sm }; return h('div.wx-ctr.k-' + key, h('span', label), b, sm); };
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
        h('div.wx-counters', cell('deciders', 'Deciders'), cell('intent', 'Intent rate'), cell('hides', 'Hides'), cell('stance', 'Mean stance'), cell('calls', 'Model calls'), cell('exposures', 'Exposures')),
        h('div.wx-meter', h('div.wx-meter-h', h('span', 'Vocal vs silent'), w.mLabel), h('div.meter', w.mV, w.mS)),
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
      mount(ui.stage, sides[0], center, sides[1]);
      if (!reduced()) stagger([...ui.stage.children], { y: 22, gap: 90, ms: 800 });
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
      mount(ui.evs, S.events.map((e) => h('span.chip.wx-ev', { title: e.text }, h('b', `R${e.round + 1}`), ` ${e.target || 'all'} · ${e.text.length > 46 ? e.text.slice(0, 45) + '…' : e.text}`)));
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
        offs.forEach((f) => f()); cleanups.splice(0).forEach((f) => f());
        clearTimeout(searchT); cancelAnimationFrame(chipRaf);
        duel.dispose();
      },
    };
  },
};

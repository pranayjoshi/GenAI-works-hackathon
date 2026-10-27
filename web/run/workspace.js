/* Run workspace: one run, many stages. Owns the run state (S), the SSE stream, replay, and the stage dock.
 * Stages are lazy modules in run/stages/*.js. Contract (see run/stages/README.md):
 *
 *   export default {
 *     id, label, icon,                      // icon = SVG path d (24x24, stroked)
 *     mount(el, ctx) -> { show?(), hide?(), destroy?() }
 *   }
 *
 * A stage is mounted the first time it is opened and kept alive (hidden) afterwards, so it keeps
 * receiving bus events. ctx gives it the state and the bus; it never opens its own EventSource. */
import { $, h, s, mount, clear, spin, fmtInt, hourStr, draftName } from '../core/dom.js';
import { current, createBus } from '../core/state.js';
import { api, fail } from '../core/api.js';
import { toast } from '../core/ui.js';
import { EASE, reduced, stagger } from '../core/motion.js';
import { setAmbientMood } from '../core/ambient.js';

export const STAGES = [
  { id: 'pipeline', label: 'Agents', hint: 'Live multi-agent workflow', icon: 'M5 3v4M5 17v4M19 3v4M19 17v4M3 5h4M17 5h4M3 19h4M17 19h4M7 5h10M7 19h10M5 7v10M19 7v10M9 12h6', load: () => import('./stages/pipeline.js') },
  { id: 'crowd', label: 'Audience', hint: 'Who was sampled, and from which data', icon: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75', load: () => import('./stages/crowd.js') },
  { id: 'worlds', label: 'Counterfactual worlds', hint: 'Two feeds, same people; only the content differs', icon: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 2v20M2 12h20', load: () => import('./stages/worlds.js') },
  { id: 'signals', label: 'Signals', hint: 'Intent by round, events, momentum', icon: 'M3 3v18h18M7 15l4-4 3 3 6-7', load: () => import('./stages/signals.js') },
  { id: 'verdict', label: 'Result', hint: 'Who leads, the interval, segments', icon: 'M12 15l-3.5 2 1-4L6.5 10l4-.3L12 6l1.5 3.7 4 .3-3 3 1 4z M4 21h16', load: () => import('./stages/verdict.js') },
  { id: 'report', label: 'Report', hint: 'Reasons, each with its evidence', icon: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h5', load: () => import('./stages/report.js') },
  { id: 'decision', label: 'Spend gate', hint: 'What to do next, action plan, approvals', icon: 'M12 2v20M5 8l7-6 7 6M4 22h16M7 12h10M9 17h6', load: () => import('./stages/decision.js') },
  { id: 'ask', label: 'Why', hint: 'Ask the audience why: people, segments, focus group, suggested rewrite', icon: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z', load: () => import('./stages/ask.js') },
];
export const PHASES = [['data', 'Data'], ['audience', 'Audience'], ['sampling', 'Sampling'], ['voices', 'Voices'], ['running', 'Simulating'], ['analyzing', 'Investigating'], ['report', 'Report'], ['done', 'Done']];
const FEED_CAP = 150;

let active = null;   // the live workspace, for onParams
export function onParams(p) { active?.go(p.stage, true); }

export default function workspace(view, params) {
  const id = params.id;
  const S = {
    id, seed: 1, spec: null, status: 'queued', phase: 'queued', detail: '', error: null,
    personas: [], pmap: new Map(), sample: null, proposal: null,
    rec: {}, recIds: new Set(), timeline: {}, counters: {}, events: [], usage: new Map(), traceLog: [], summaries: [],
    verdict: null, tipping: null, validity: null, fairness: [], report: null, focus: [],
    replay: false, replayLim: null, speed: 1, stream: 'connecting', phaseIdx: 0,
  };
  const bus = createBus();
  current.run = { id, S };
  let es = null, closed = false;

  const worldIds = () => (S.spec?.posts || [{ variant: 'A' }, { variant: 'B' }]).map((p) => `s${S.seed}:${p.variant}`);
  const variants = () => (S.spec?.posts || [{ variant: 'A' }, { variant: 'B' }]).map((p) => p.variant);
  const hourOfRound = (r) => {
    const sp = S.spec; if (!sp) return `Round ${r + 1}`;
    const t = sp.startHour + r * sp.hourStep;
    return `Day ${Math.floor(t / 24) + 1} ${hourStr(t % 24)}`;
  };

  /* ---------------------------------------------------------------- shell */
  const ui = {
    title: h('h1.ws-title', 'Loading run...'),
    chips: h('div.ws-chips'),
    tools: h('div.ws-tools'),
    phases: h('div.ws-phases'),
    dock: h('nav.ws-dock', { 'aria-label': 'Run stages' }),
    stage: h('section.ws-stage'),
    banner: h('div.ws-banner'),
  };
  const root = h('div.ws',
    h('header.ws-head',
      h('div.ws-head-main', h('div.ws-crumb', h('a.ws-back', { href: '#/runs', title: 'All runs' }, '← Runs'), h('span.ws-crumb-sep', '/'), ui.title), ui.chips),
      ui.tools),
    ui.phases, ui.banner,
    h('div.ws-body', ui.dock, ui.stage));
  view.append(root);

  const badges = {};
  function setBadge(stageId, text, pulse) {
    badges[stageId] = { text, pulse };
    const b = $(`[data-stage="${stageId}"] .ws-badge`, ui.dock);
    if (b) { b.textContent = text ?? ''; b.hidden = text == null || text === ''; b.classList.toggle('pulse', !!pulse); }
  }
  function renderDock() {
    mount(ui.dock, h('span.ws-dock-ink', { 'aria-hidden': 'true' }), STAGES.map((st, i) => h('a.ws-dock-item', { href: `#/run/${encodeURIComponent(id)}/${st.id}`, 'data-stage': st.id, title: `${st.hint} (${i + 1})` },
      h('span.ws-dock-icon', s('svg', { viewBox: '0 0 24 24' }, s('path', { d: st.icon }))),
      h('span.ws-dock-label', st.label),
      h('span.ws-badge', { hidden: !badges[st.id]?.text }, badges[st.id]?.text ?? ''))));
    stagger($('.ws-dock', root).querySelectorAll('.ws-dock-item'), { y: 10, gap: 40, ms: 600 });
  }
  function moveDockInk() {
    const a = $('.ws-dock-item.active', ui.dock), ink = $('.ws-dock-ink', ui.dock);
    if (!a || !ink) return;
    const horiz = getComputedStyle(ui.dock).flexDirection === 'row';
    ink.style.transform = horiz ? `translateX(${a.offsetLeft}px)` : `translateY(${a.offsetTop}px)`;
    ink.style.width = `${a.offsetWidth}px`; ink.style.height = `${a.offsetHeight}px`;
  }

  /* ---------------------------------------------------------------- stages */
  const mounted = {};      // id -> { el, api }
  let cur = null, goSeq = 0;
  const ctx = {
    id, S, bus, worldIds, variants, hourOfRound, FEED_CAP,
    go: (stage) => { location.hash = `#/run/${encodeURIComponent(id)}/${stage}`; },
    setBadge, refetch: () => refetch(),
    startReplay: () => startReplay(), stopReplay: () => stopReplay(),
    setSeed: (sd) => { S.seed = sd; bus.emit('seed', sd); renderHead(); },
  };
  async function go(stageId, fromHash) {
    const def = STAGES.find((x) => x.id === stageId) || STAGES.find((x) => x.id === defaultStage());
    if (cur === def.id) return;
    const seq = ++goSeq;
    const prevId = cur, prev = cur ? mounted[cur] : null;
    cur = def.id;
    [...ui.dock.querySelectorAll('.ws-dock-item')].forEach((a) => a.classList.toggle('active', a.dataset.stage === def.id));
    moveDockInk();
    if (!fromHash && location.hash !== `#/run/${encodeURIComponent(id)}/${def.id}`) history.replaceState(null, '', `#/run/${encodeURIComponent(id)}/${def.id}`);
    let m = mounted[def.id];
    if (!m) {
      const el = h('div.ws-pane', { 'data-pane': def.id }, h('div.ws-pane-loading', spin(), ` Opening ${def.label}...`));
      ui.stage.append(el);
      m = mounted[def.id] = { el, api: null };
      const mod = (await def.load()).default;
      clear(el);
      try { m.api = mod.mount(el, ctx) || {}; } catch (e) { console.error(e); mount(el, h('div.banner.bad', `This stage failed to open: ${e.message}`)); m.api = {}; }
    }
    if (seq !== goSeq) return;
    const idxOf = (sid) => STAGES.findIndex((x) => x.id === sid);
    const dir = prevId && idxOf(def.id) < idxOf(prevId) ? -1 : 1;
    if (prev && prev !== m) {
      prev.api?.hide?.();
      if (!reduced()) {
        const out = prev.el.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `translateY(${-14 * dir}px) scale(.985)`, filter: 'blur(3px)' }], { duration: 180, easing: EASE.exit });
        await out.finished.catch(() => {});
      }
      prev.el.hidden = true;
      if (seq !== goSeq) return;
    }
    m.el.hidden = false;
    m.api?.show?.();
    if (!reduced()) m.el.animate([{ opacity: 0, transform: `translateY(${22 * dir}px) scale(.985) perspective(1200px) rotateX(${3 * dir}deg)`, filter: 'blur(6px)' }, { opacity: 1, transform: 'none', filter: 'blur(0)' }], { duration: 560, easing: EASE.expo });
  }
  const defaultStage = () => (S.verdict ? 'verdict' : 'pipeline');

  /* ---------------------------------------------------------------- head */
  function renderHead() {
    const sp = S.spec;
    ui.title.textContent = sp ? sp.business : 'Loading run...';
    const fair = S.fairness || [];
    mount(ui.chips,
      h('span.chip.mono', id),
      h('span.chip.' + (S.status === 'done' ? 'good' : S.status === 'error' ? 'bad' : 'warn'), S.status === 'done' ? 'done' : S.status === 'error' ? 'error' : h('span.ws-live', 'live')),
      sp ? h('span.chip', `${sp.crowdSize} people`) : null, sp ? h('span.chip', `${sp.rounds} rounds`) : null,
      sp?.parent_run ? h('a.chip', { href: `#/run/${sp.parent_run}` }, 'follow-up to ' + sp.parent_run.slice(-4)) : null,
      fair.length ? fair.map((f) => {
        const keys = Object.keys(f.base_shapes || {}); const hash = Object.values(f.base_shapes || {})[0] || f.fingerprint || '';
        return h('span.chip.' + (f.identical ? 'good' : 'bad'), { title: `Base log fingerprint ${f.fingerprint}. The counterfactual worlds start from the same audience, graph and schedule.` },
          f.identical ? `worlds identical ${keys.join(' = ')} ✓ ` : `base logs differ, seed ${f.seed} ✗ `, h('span.mono', String(hash).slice(0, 8)));
      }) : h('span.chip', { title: 'Shown once the counterfactual worlds have forked' }, 'fairness check pending'),
      S.status === 'done' || S.status === 'error' ? null : h('span.chip.ws-stream.' + S.stream, { title: 'Server-sent events connection' }, S.stream));
    mount(ui.tools,
      sp && sp.seeds?.length > 1 ? h('div.ws-seg', sp.seeds.map((sd) => h('button' + (sd === S.seed ? '.on' : ''), { onclick: () => ctx.setSeed(sd), title: `Show seed ${sd}` }, `Seed ${sd}`))) : null,
      S.replay ? [h('span.chip.on', `Replaying round ${Math.max(0, S.replayLim + 1)} of ${sp.rounds}`), h('button.btn.sm', { onclick: () => stopReplay() }, 'Stop')]
        : (S.status === 'done' || S.status === 'error') && sp && Object.keys(S.rec).length ? h('button.btn.sm.primary', { title: 'Re-play the stored actions round by round', onclick: startReplay }, '▶ Replay') : null,
      h('div.ws-seg', [[0.5, '0.5×'], [1, '1×'], [2, '2×'], [4, '4×']].map(([v, l]) => h('button' + (v === S.speed ? '.on' : ''), { title: 'Replay speed', onclick: () => { S.speed = v; renderHead(); } }, l))));
  }
  function renderPhases() {
    let idx = PHASES.findIndex((p) => p[0] === S.phase);
    if (S.status === 'done') idx = PHASES.length;
    if (idx < 0) idx = S.phaseIdx ?? 0;
    S.phaseIdx = idx;
    const frac = Math.min(1, idx / (PHASES.length - 1));
    mount(ui.phases,
      h('div.ws-phase-track', h('i', { style: { width: `${frac * 100}%` } })),
      h('div.ws-phase-list', PHASES.map((p, i) => h('div.ws-phase' + (i < idx ? '.done' : i === idx ? '.now' : ''), h('i'), h('span', p[1])))),
      S.status === 'error' || !S.detail || S.status === 'done' ? null : h('div.ws-phase-detail', S.detail));
    mount(ui.banner, S.status === 'error' ? h('div.banner.bad', `Run stopped: ${S.error || 'unknown error'}. Anything already simulated is still shown.`) : null);
    setAmbientMood(S.status === 'done' || S.status === 'error' ? 0.35 : 0.9);
  }
  function setStream(state) { S.stream = state; const c = $('.ws-stream', ui.chips); if (c) { c.textContent = state; c.className = 'chip ws-stream ' + state; } bus.emit('stream', state); }

  /* ---------------------------------------------------------------- state */
  function mergeTimeline(wid, entries) { const tl = S.timeline[wid] || (S.timeline[wid] = {}); for (const c of entries || []) tl[c.round] = c; }
  function setCounters(wid, c) { mergeTimeline(wid, [c]); const cur = S.counters[wid]; if (!cur || c.round >= cur.round) S.counters[wid] = c; }
  function setPersonas(ps) { S.personas = ps; S.pmap = new Map(ps.map((p) => [p.id, p])); }
  function addUsage(rows) {
    S.usage.clear();
    for (const u of rows || []) S.usage.set(`${u.role}|${u.model}`, { role: u.role, model: u.model, calls: u.calls, tin: u.tokens_in, tout: u.tokens_out, ms: u.avg_ms * u.calls, errors: u.errors || 0, served: { ...u.served_by } });
  }
  function addTrace(t) {
    const k = `${t.role}|${t.model}`;
    const u = S.usage.get(k) || { role: t.role, model: t.model, calls: 0, tin: 0, tout: 0, ms: 0, errors: 0, served: {} };
    u.calls++; u.tin += t.tokens_in; u.tout += t.tokens_out; u.ms += t.ms; if (!t.ok) u.errors++;
    u.served[t.served_by] = (u.served[t.served_by] || 0) + 1;
    S.usage.set(k, u);
    S.traceLog.unshift(t); if (S.traceLog.length > 40) S.traceLog.pop();
  }
  function applySnap(st, full) {
    S.spec = st.spec; S.status = st.status; S.phase = st.phase; S.error = st.error;
    S.sample = st.sampleReport || S.sample; S.proposal = st.proposal || S.proposal;
    if (st.personas?.length && !S.personas.length) setPersonas(st.personas);
    S.summaries = st.summaries || [];
    S.verdict = st.verdict || S.verdict; S.tipping = st.tipping || S.tipping; S.validity = st.validity || S.validity;
    S.fairness = st.fairness || S.fairness; S.report = st.report || S.report;
    for (const e of st.spec.events || []) if (!S.events.some((x) => x.id === e.id)) S.events.push(e);
    for (const w of st.worlds || []) { mergeTimeline(w.world_id, w.timeline); if (w.counters) S.counters[w.world_id] = w.counters; }
    if (st.usage) addUsage(st.usage);
    S.worlds = st.worlds || S.worlds;
    if (full && S.spec) { const first = S.spec.seeds?.[0]; if (first && !S.seedInit) { S.seed = first; S.seedInit = true; } }
  }
  const seqOf = (r) => Number(String(r.id).split(':').pop()) || 0;
  function addAction(r, live) {
    if (S.recIds.has(r.id)) return false;
    S.recIds.add(r.id);
    const arr = S.rec[r.world_id] || (S.rec[r.world_id] = []);
    arr.push(r); if (arr.length > FEED_CAP) arr.shift();
    bus.emit('action', { record: r, live });
    return true;
  }
  async function loadHistory(st) {
    if (!(st.worlds || []).some((w) => w.decisions > 0)) return;
    try {
      const recs = await api(`/api/runs/${id}/actions?limit=2000`);
      const byWorld = {};
      for (const r of recs) (byWorld[r.world_id] || (byWorld[r.world_id] = [])).push(r);
      for (const [wid, list] of Object.entries(byWorld)) {
        const have = S.rec[wid] || [];
        const merged = [...list.filter((r) => !S.recIds.has(r.id)), ...have].sort((a, b) => seqOf(a) - seqOf(b)).slice(-FEED_CAP);
        list.forEach((r) => S.recIds.add(r.id)); S.rec[wid] = merged;
      }
      bus.emit('history');
      renderHead();
    } catch { /* feeds fill from the live stream instead */ }
  }
  async function refetch() {
    try { applySnap(await api(`/api/runs/${id}`)); renderHead(); renderPhases(); bus.emit('snapshot', S); updateBadges(); } catch { /* keep what we have */ }
  }
  function updateBadges() {
    const n = Object.values(S.rec).reduce((a, r) => a + r.length, 0);
    setBadge('crowd', S.personas.length ? fmtInt(S.personas.length) : null);
    setBadge('worlds', n ? fmtInt(n) : null, S.status !== 'done' && S.status !== 'error' && n > 0);
    const calls = [...S.usage.values()].reduce((a, u) => a + u.calls, 0);
    setBadge('pipeline', calls ? fmtInt(calls) : null, S.status !== 'done' && S.status !== 'error');
    setBadge('verdict', S.verdict ? (S.verdict.call === 'winner' ? S.verdict.winner : '=') : null, !!S.verdict && cur !== 'verdict' && !S.verdictSeen);
    setBadge('report', S.report ? '✓' : null);
  }

  /* ---------------------------------------------------------------- replay */
  let rTimer = null;
  async function startReplay() {
    if (S.replay) return;
    let all;
    try { all = await api(`/api/runs/${id}/actions?limit=200000`); } catch (e) { return fail(e); }
    const ws = worldIds();
    const byRound = {};
    for (const rec of all.filter((x) => ws.includes(x.world_id))) {
      const r = Math.min(S.spec.rounds - 1, Math.max(0, rec.hour));
      (byRound[r] || (byRound[r] = [])).push(rec);
    }
    S.saved = { counters: { ...S.counters }, rec: S.rec, recIds: S.recIds };
    S.rec = {}; S.recIds = new Set(); for (const wid of ws) delete S.counters[wid];
    S.replay = true; S.replayLim = -1;
    bus.emit('replay', { on: true, round: -1 }); renderHead();
    if (cur !== 'worlds' && cur !== 'signals') go('worlds');
    let r = -1;
    const step = () => {
      r++;
      if (r >= S.spec.rounds) return stopReplay();
      S.replayLim = r;
      for (const rec of byRound[r] || []) addAction(rec, true);
      for (const wid of ws) { const c = S.timeline[wid]?.[r]; if (c) { S.counters[wid] = c; bus.emit('round', { world_id: wid, counters: c }); } }
      for (const ev of S.events.filter((e) => e.round === r)) toast(`Event injected: ${ev.text}`);
      bus.emit('replay', { on: true, round: r }); renderHead();
      rTimer = setTimeout(step, 1200 / S.speed);
    };
    step();
  }
  function stopReplay() {
    clearTimeout(rTimer); rTimer = null;
    if (!S.replay) return;
    S.replay = false; S.replayLim = null;
    S.counters = S.saved.counters; S.rec = S.saved.rec; S.recIds = S.saved.recIds;
    bus.emit('replay', { on: false }); bus.emit('history'); renderHead();
  }

  /* ---------------------------------------------------------------- stream */
  function handle(e) {
    switch (e.type) {
      case 'snapshot': {
        applySnap(e.state, true);
        renderHead(); renderPhases();
        bus.emit('snapshot', S);
        if (!cur) go(params.stage || defaultStage());
        loadHistory(e.state);
        if (S.verdict) S.verdictShown = true;
        break;
      }
      case 'status': S.phase = e.phase; S.detail = e.detail || ''; if (!['building', 'running', 'analyzing'].includes(S.status) && S.status !== 'error') S.status = 'building'; renderPhases(); renderHead(); bus.emit('status', { phase: e.phase, detail: S.detail }); break;
      case 'crowd': setPersonas(e.personas); S.sample = e.report || S.sample; S.proposal = e.proposal || S.proposal; bus.emit('crowd', S.personas); break;
      case 'action': addAction(e.record, true); break;
      case 'round': case 'world_done': setCounters(e.world_id, e.counters); bus.emit('round', { world_id: e.world_id, counters: e.counters, done: e.type === 'world_done' }); break;
      case 'event_injected': if (!S.events.some((x) => x.id === e.event.id)) { S.events.push(e.event); bus.emit('event', e.event); } break;
      case 'verdict':
        S.verdict = e.verdict;
        refetch().then(() => {
          bus.emit('verdict', S.verdict);
          if (!S.verdictShown) { S.verdictShown = true; if (cur !== 'verdict') toast(S.verdict.call === 'winner' ? `Result: ${draftName(S.verdict.winner)} wins` : `Result: ${draftName(S.verdict.leader || (S.verdict.pooled.a >= S.verdict.pooled.b ? 'A' : 'B'))} leads`, false, { label: 'Open result', onclick: () => ctx.go('verdict') }); }
        });
        break;
      case 'report': S.report = e.report; bus.emit('report', S.report); break;
      case 'error': S.status = 'error'; S.error = e.message; renderPhases(); renderHead(); bus.emit('error', e.message); break;
      case 'done': S.status = 'done'; S.phase = 'done'; refetch().then(() => bus.emit('done')); break;
      case 'trace': addTrace(e.entry); bus.emit('trace', e.entry); break;
      case 'focus': S.focus.push(e.turn); bus.emit('focus', e.turn); break;
      default: break;
    }
    if (e.type !== 'trace' || !badgeTimer) scheduleBadges();
  }
  let badgeTimer = null;
  const scheduleBadges = () => { if (!badgeTimer) badgeTimer = setTimeout(() => { badgeTimer = null; updateBadges(); }, 300); };
  ctx.addEvent = (ev) => { if (!S.events.some((x) => x.id === ev.id)) { S.events.push(ev); bus.emit('event', ev); } };

  api(`/api/runs/${id}`).then((st) => {
    if (closed) return;
    handle({ type: 'snapshot', state: st });
    es = new EventSource(`/api/runs/${id}/stream`);
    es.onopen = () => setStream('live');
    es.onmessage = (m) => { try { handle(JSON.parse(m.data)); } catch (err) { console.error('stream event failed', err, m.data.slice(0, 200)); } };
    es.onerror = () => setStream(es.readyState === 2 ? 'closed' : 'reconnecting');
  }).catch((e) => { mount(view, h('div.view-page', h('div.banner.bad', `Could not open run ${id}: ${e.message}`), h('p'), h('a.btn', { href: '#/runs' }, 'Back to runs'))); });

  renderDock(); renderHead(); renderPhases();
  const onKey = (e) => {
    if (e.target.closest('input, textarea, select, [contenteditable]') || e.metaKey || e.ctrlKey || e.altKey) return;
    const n = Number(e.key); if (n >= 1 && n <= STAGES.length) ctx.go(STAGES[n - 1].id);
  };
  document.addEventListener('keydown', onKey);
  window.addEventListener('resize', moveDockInk);
  // The ink is measured from the dock's layout, which changes when the header wraps or fonts load.
  const dockRo = 'ResizeObserver' in window ? new ResizeObserver(moveDockInk) : null;
  dockRo?.observe(ui.dock); document.fonts?.ready.then(moveDockInk);
  bus.on('verdict', () => { if (cur === 'verdict') S.verdictSeen = true; });

  const self = { go: (st, fromHash) => { if (st === 'verdict') S.verdictSeen = true; go(st || defaultStage(), fromHash); updateBadges(); } };
  active = self;
  return () => {
    closed = true; active = null; clearTimeout(rTimer); clearTimeout(badgeTimer);
    if (es) es.close();
    for (const m of Object.values(mounted)) { try { m.api?.destroy?.(); } catch (e) { console.error(e); } }
    bus.clear(); current.run = null; setAmbientMood(0.4);
    document.removeEventListener('keydown', onKey); window.removeEventListener('resize', moveDockInk);
    dockRo?.disconnect();
  };
}

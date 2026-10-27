/* Agents stage: the live multi-agent workflow as a flow-based node graph (flow runs UPWARD).
 * Hand-rolled SVG edges + HTML nodes, a pooled set of SVG packets for model calls, A/B sparks for decisions,
 * a side drawer per node and a Nemotron panel (gauges, token bars, served_by, live ticker).
 * Driven by ctx.S and the bus: status, trace, action, round, snapshot, history, verdict, report, done, error, seed. */
import { h, s, mount, fmtInt, vcolor } from '../../core/dom.js';
import { countUp, reduced } from '../../core/motion.js';

/* ---------------------------------------------------------------- layout (logical 1000 x 860 canvas, y grows downward) */
const W = 1000, H = 860;
const SPINE = 440;
// i = pipeline order (0 = first), ord = vertical order in the phone list (0 = top)
const NODES = [
  { id: 'verdict', i: 9, ord: 0, x: SPINE, y: 40, w: 300, h: 54, label: 'Verdict and report', rc: '--good', go: 'verdict',
    short: 'The call: a winner, or too close to call, with the written report.', long: 'The finished answer: which version wins, how sure the simulation is, or "too close to call" when the interval spans zero.' },
  { id: 'critic', i: 8, ord: 1, x: SPINE, y: 120, w: 300, h: 54, label: 'Critic', role: 'review', rc: '--warn', go: 'report',
    short: 'Reviews every claim against the data before it ships.', long: 'Role review. Checks the written report against the numbers and flags claims the data does not support.' },
  { id: 'report', i: 7, ord: 2, x: SPINE, y: 200, w: 300, h: 54, label: 'Report agent', role: 'reason', rc: '--accent', go: 'report',
    short: 'Writes the claims, with SQL tool calls as receipts.', long: 'Role reason. Queries the run database with SQL tool calls and writes each claim with the query that backs it.' },
  { id: 'analyst', i: 6, ord: 3, x: SPINE, y: 280, w: 300, h: 54, label: 'Analyst', rc: '--good', go: 'verdict',
    short: 'Verdict, segment splits and the tipping point.', long: 'Computes the verdict with intervals, segment splits (role, age, income, customer status) and the tipping point. This step is statistics, not a model call.' },
  { id: 'guard', i: 5, ord: 4, x: SPINE, y: 360, w: 300, h: 54, label: 'Fact-check guard', rc: '--bad', go: 'worlds',
    short: 'Withholds invented prices, version leaks and contradictions.', long: 'Rule-based checks on every decision: invented prices, details leaked from the other version, false "seen it before" claims, duplicates, and private feelings that contradict the public action.' },
  { id: 'twin0', i: 4, ord: 5, kind: 'twin', v: 0, x: 290, y: 470, w: 270, h: 84, label: 'Twin world A', role: 'crowd', rc: '--a', go: 'worlds',
    short: 'Every simulated person decides. Same crowd, graph and schedule.', long: 'Role crowd. Each simulated person decides what to do with this version. Both worlds share the same crowd, social graph and schedule, so only the post differs.' },
  { id: 'twin1', i: 4, ord: 5, kind: 'twin', v: 1, x: 590, y: 470, w: 270, h: 84, label: 'Twin world B', role: 'crowd', rc: '--b', go: 'worlds',
    short: 'Every simulated person decides. Same crowd, graph and schedule.', long: 'Role crowd. Each simulated person decides what to do with this version. Both worlds share the same crowd, social graph and schedule, so only the post differs.' },
  { id: 'voice', i: 3, ord: 6, x: SPINE, y: 580, w: 300, h: 54, label: 'Voice writer', role: 'voice', rc: '--accent-2', go: 'crowd',
    short: 'Writes each persona\'s own voice lines.', long: 'Role voice. Gives each sampled persona the words they would use in a comment or a private thought.' },
  { id: 'sampler', i: 2, ord: 7, x: SPINE, y: 660, w: 300, h: 54, label: 'Crowd sampler', rc: '--accent-2', go: 'crowd',
    short: 'Copula sampling matched to Census marginals.', long: 'Draws a synthetic crowd whose age, income and role mix matches the Census marginals while keeping realistic correlations (a copula). Statistics, not a model call.' },
  { id: 'audience', i: 1, ord: 8, x: SPINE, y: 740, w: 300, h: 54, label: 'Audience agent', role: 'reason', rc: '--accent', go: 'crowd',
    short: 'Names the core and spillover segments.', long: 'Role reason. Reads the post and the business and names the core audience segments plus the spillover segments the post might reach.' },
  { id: 'sources', i: 0, ord: 9, kind: 'sources', x: SPINE, y: 815, w: 440, h: 64, label: 'Data sources', rc: '--faint', go: 'crowd',
    chips: ['Census ACS', 'Pew platform use', 'Priors', 'Customer list'],
    short: 'Federated SQL (Zetaris / DuckDB) over four sources.', long: 'Census ACS demographics, Pew platform use, behavioural priors and your customer list, joined through federated SQL (Zetaris, DuckDB).' },
  // "Ask why" side branch, dimmer
  { id: 'interviewer', side: true, ord: 31, x: 860, y: 200, w: 200, h: 54, label: 'Interviewer', role: 'interview', rc: '--muted', go: 'ask',
    short: 'Asks one simulated person why.', long: 'Role interview. Answers "why did you do that" in the voice of one specific simulated person, using their own memories.' },
  { id: 'moderator', side: true, ord: 32, x: 860, y: 280, w: 200, h: 54, label: 'Focus group', role: 'interview', rc: '--muted', go: 'ask',
    short: 'Moderates a group of people.', long: 'Role interview. A moderator puts a question to a sampled group and records each turn.' },
  { id: 'rewriter', side: true, ord: 33, x: 860, y: 360, w: 200, h: 54, label: 'Rewriter', role: 'reason', rc: '--c', go: 'ask',
    short: 'Drafts Version C.', long: 'Role reason. Rewrites the post into a Version C using what the crowd disliked, ready for a follow-up run.' },
];
const NODE = Object.fromEntries(NODES.map((n) => [n.id, n]));

// [id, from, to, kind]
const EDGES = [
  ['e-src', 'sources', 'audience'], ['e-aud', 'audience', 'sampler'], ['e-smp', 'sampler', 'voice'],
  ['e-v0', 'voice', 'twin0'], ['e-v1', 'voice', 'twin1'], ['e-t0', 'twin0', 'guard'], ['e-t1', 'twin1', 'guard'],
  ['e-gd', 'guard', 'analyst'], ['e-an', 'analyst', 'report'], ['e-rp', 'report', 'critic'], ['e-cr', 'critic', 'verdict'],
  ['e-s0', 'analyst', 'interviewer', 'side'], ['e-s1', 'analyst', 'moderator', 'side'], ['e-s2', 'analyst', 'rewriter', 'side'],
];
const PHASE_IDX = { data: 0, audience: 1, sampling: 2, voices: 3, running: 4, analyzing: 6, report: 7 };
const ROLE_ORDER = ['reason', 'voice', 'crowd', 'review', 'interview'];
const ROLE_META = {
  reason: { c: 'var(--accent)', d: 'Audience agent, report agent, rewriter' },
  voice: { c: 'var(--accent-2)', d: 'Persona voice lines' },
  crowd: { c: 'var(--warn)', d: 'Every simulated decision' },
  review: { c: 'var(--good)', d: 'Critic and honesty check' },
  interview: { c: 'var(--muted)', d: 'Interviews and focus group' },
};
const CIRC = 2 * Math.PI * 30;
const POOL = 36;
const pctX = (x) => `${(x / W) * 100}%`, pctY = (y) => `${(y / H) * 100}%`;
const ms1 = (x) => (x >= 1000 ? `${(x / 1000).toFixed(1)}s` : `${Math.round(x)}ms`);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const vkey = (v) => String(v || 'a').toLowerCase();

export default {
  id: 'pipeline',
  mount(el, ctx) {
    const { S, bus } = ctx;
    const offs = [];
    const timers = new Set();
    const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); return t; };
    let visible = false, destroyed = false, listMode = false, raf = 0, paintT = 0;
    let replayIdx = null, replayTimers = [], altTick = 0, sparkLive = 0;
    const tally = [0, 0];                 // live decisions seen per twin world, a floor under the server counters
    const lastSpark = {}, lastHit = {}, edgeEls = {}, nodeEls = {};
    let openId = null, lastTop = null;
    const pool = [], active = [];

    /* ---------------------------------------------------------------- DOM */
    const nodeEls_ = NODES.map(buildNode);
    const svgEdges = s('g', { class: 'pl-edges' }), svgPk = s('g', { class: 'pl-pkts' });
    const svg = s('svg', { class: 'pl-svg', viewBox: `0 0 ${W} ${H}`, 'aria-hidden': 'true' }, svgEdges, svgPk);
    const nodesLayer = h('div.pl-nodes', nodeEls_);
    const tiltEl = h('div.pl-tilt', svg, nodesLayer);
    const canvas = h('div.pl-canvas', tiltEl);
    const stageBox = h('div.pl-stage', canvas);
    const drawer = h('aside.pl-drawer', { hidden: true, 'aria-label': 'Node details' });
    const summary = h('div.pl-summary');
    const replayBtn = h('button.btn.sm', { type: 'button', onclick: () => replayFlow() }, 'Replay flow');
    const head = h('div.pl-head',
      h('div.pl-head-t', h('h2', 'Agents at work'), h('p.muted', 'Sources at the bottom, the verdict at the top. Each glowing packet is one model call.')),
      h('div.pl-head-r', summary, replayBtn));
    const legend = h('div.pl-legend', h('span', h('i.lg.done'), 'done'), h('span', h('i.lg.now'), 'working now'), h('span', h('i.lg.future'), 'waiting'), h('span', h('i.lg.side'), 'Ask why (after the verdict)'));
    const nemo = h('section.pl-nemo');
    const root = h('div.pl', head, h('div.pl-main', stageBox, drawer), legend, nemo);
    el.append(root);
    NODES.forEach((n, k) => { nodeEls[n.id] = nodeEls_[k]; });
    buildEdges();
    buildPool();

    /* ---------------------------------------------------------------- builders */
    function buildNode(n) {
      const nd = h('div.pl-node' + (n.side ? '.side' : '') + (n.kind ? '.' + n.kind : ''), {
        tabindex: 0, role: 'button', 'data-id': n.id, 'data-state': 'future', title: n.long,
        style: { left: pctX(n.x), top: pctY(n.y), width: pctX(n.w), height: pctY(n.h), '--rc': `var(${n.rc})`, '--ord': String(n.ord) },
        onclick: () => openDrawer(n.id),
        onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDrawer(n.id); } },
        onpointerenter: () => highlight(n.id), onpointerleave: () => highlight(null),
        onfocus: () => highlight(n.id), onblur: () => highlight(null),
      },
        h('span.pl-glow'), h('span.pl-hit'),
        h('div.pl-top', h('span.pl-dot'), h('b.pl-name', n.label), n.role ? h('span.pl-role', n.role) : null, h('span.pl-stat')),
        n.chips ? h('div.pl-chips', n.chips.map((c) => h('span', c))) : h('div.pl-desc', n.short),
        n.kind === 'twin' ? h('div.pl-twin', h('span.pl-count'), h('span.pl-count-l', 'decisions'), h('span.pl-round')) : null,
        h('div.pl-spark-layer'),
        h('div.pl-detail'));
      return nd;
    }
    // anchor points in canvas units: spine edges leave a node's top and enter the next node's bottom
    function pathFor(a, b, side) {
      if (side) { const x1 = a.x + a.w / 2, y1 = a.y, x2 = b.x - b.w / 2, y2 = b.y, mx = (x1 + x2) / 2; return `M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`; }
      const x1 = a.x, y1 = a.y - a.h / 2, x2 = b.x, y2 = b.y + b.h / 2, my = (y1 + y2) / 2;
      return `M${x1} ${y1} C${x1} ${my} ${x2} ${my} ${x2} ${y2}`;
    }
    function buildEdges() {
      for (const [id, from, to, kind] of EDGES) {
        const a = NODE[from], b = NODE[to], d = pathFor(a, b, kind === 'side');
        const col = b.kind === 'twin' ? vcolor(vkey(variantOf(b.v))) : a.kind === 'twin' ? vcolor(vkey(variantOf(a.v))) : `var(${b.rc === '--faint' ? '--accent' : b.rc})`;
        const base = s('path', { class: 'pl-e-base', d });
        const flow = s('path', { class: 'pl-e-flow', d });
        flow.style.setProperty('--ec', col);
        const g = s('g', { class: 'pl-edge' + (kind ? ' ' + kind : ''), 'data-from': from, 'data-to': to }, base, flow);
        svgEdges.append(g);
        edgeEls[id] = { g, flow, d, path: base, from, to, col, lastSpawn: 0, len: 0 };
      }
    }
    function buildPool() {
      for (let k = 0; k < POOL; k++) {
        const g = s('g', { class: 'pl-pkt' }, s('circle', { class: 'halo', r: 10 }), s('circle', { class: 'core', r: 3.6 }));
        g.style.visibility = 'hidden';
        svgPk.append(g); pool.push(g);
      }
    }
    function variantOf(k) { return ctx.variants?.()[k] || (k ? 'B' : 'A'); }

    /* ---------------------------------------------------------------- derived state */
    const usageOf = (role) => [...S.usage.values()].filter((u) => u.role === role);
    function roleTotals(role) {
      const rows = usageOf(role);
      const t = { calls: 0, tin: 0, tout: 0, ms: 0, errors: 0, served: {}, models: [] };
      for (const u of rows) {
        t.calls += u.calls || 0; t.tin += u.tin || 0; t.tout += u.tout || 0; t.ms += u.ms || 0; t.errors += u.errors || 0;
        for (const [k, c] of Object.entries(u.served || {})) t.served[k] = (t.served[k] || 0) + c;
        if (u.model && !t.models.includes(u.model)) t.models.push(u.model);
      }
      return t;
    }
    // reason calls are split by the phase they arrived in, only for traces seen live in this session
    const reasonSplit = { audience: { calls: 0, ms: 0, tin: 0, tout: 0 }, report: { calls: 0, ms: 0, tin: 0, tout: 0 } };
    function nodeStats(n) {
      const roleOf = { voice: 'voice', twin0: 'crowd', twin1: 'crowd', critic: 'review', interviewer: 'interview', moderator: 'interview', audience: 'reason', report: 'reason', rewriter: 'reason' }[n.id];
      if (!roleOf) return null;
      const t = roleTotals(roleOf);
      if (n.id === 'audience' || n.id === 'report') {
        const sp = reasonSplit[n.id];
        if (sp.calls > 0) return { ...t, calls: sp.calls, ms: sp.ms, tin: sp.tin, tout: sp.tout, role: roleOf, shared: false, note: 'Counted from model calls seen live in this session.' };
        return { ...t, role: roleOf, shared: true, note: 'Role total, shared by the audience agent, report agent and rewriter. A finished run does not store which step made each call.' };
      }
      const shared = ['twin0', 'twin1', 'interviewer', 'moderator', 'rewriter'].includes(n.id);
      return { ...t, role: roleOf, shared, note: shared ? 'Role total, shared with the other nodes that use this role.' : '' };
    }
    function curIdx() {
      if (replayIdx != null) return replayIdx;
      if (S.status === 'done' || S.phase === 'done') return 10;
      let i = PHASE_IDX[S.phase];
      if (i == null) return -1;
      if (i === 7 && S.report && roleTotals('review').calls > 0) i = 8;
      return i;
    }
    function stateOf(n, cur) {
      if (n.side) return 'side';
      const errored = S.status === 'error' && replayIdx == null;
      const at = errored && cur < 0 ? 0 : cur;
      if (n.i < at) return 'done';
      if (n.i === at) return errored ? 'error' : 'now';
      if (at === 4 && n.id === 'guard') return errored ? 'error' : 'now';   // the guard checks decisions while the worlds run
      return 'future';
    }
    const decisionsOf = (k) => {
      const v = variantOf(k), c = S.counters?.[`s${S.seed}:${v}`];
      return Math.max(c?.deciders || 0, tally[k] || 0);
    };

    /* ---------------------------------------------------------------- painting */
    function queuePaint() { if (!paintT && !destroyed) paintT = setTimeout(() => { paintT = 0; paintAll(); }, 140); }
    function paintAll() {
      if (destroyed) return;
      paintStates(); paintSummary(); if (visible) paintNemo(); if (openId) paintDrawer(true);
    }
    function paintStates() {
      const cur = curIdx(), running = replayIdx != null || (S.status !== 'done' && S.status !== 'error' && cur >= 0);
      root.dataset.status = S.status === 'error' ? 'error' : cur >= 10 ? 'done' : running ? 'live' : 'idle';
      for (const n of NODES) {
        const nd = nodeEls[n.id], st = stateOf(n, cur);
        const prev = nd.dataset.state;
        nd.dataset.state = st;
        if (n.side) nd.classList.toggle('used', usageOf('interview').length > 0 && n.id !== 'rewriter');
        nd.setAttribute('aria-label', `${n.label}: ${st === 'now' ? 'working now' : st === 'done' ? 'done' : st === 'error' ? 'failed' : st === 'side' ? 'optional follow-up' : 'waiting'}. Open details.`);
        if (prev !== st && visible && !reduced() && (st === 'done' || st === 'now')) nd.animate([{ transform: 'translate(-50%,-50%) scale(1.06)' }, { transform: 'translate(-50%,-50%) scale(1)' }], { duration: 520, easing: 'cubic-bezier(0.34,1.4,0.64,1)' });
        const det = nd.querySelector('.pl-detail');
        const txt = st === 'now' ? (S.detail || '') : st === 'error' ? (S.error || 'The run stopped here.') : '';
        if (det.textContent !== txt) det.textContent = txt;
        det.dataset.on = txt ? '1' : '0';
        paintNodeStat(n, nd);
      }
      for (const e of Object.values(edgeEls)) {
        const to = NODE[e.to], side = to.side;
        const on = side ? nodeEls[to.id].classList.contains('used') : to.i <= cur || (to.id === 'analyst' && cur === 4);
        const live = !side && ((to.i === cur) || (cur === 4 && to.id === 'guard')) && S.status !== 'error';
        e.g.classList.toggle('on', on);
        e.g.classList.toggle('live', live);
        e.g.classList.toggle('calm', on && !live);
      }
    }
    function paintNodeStat(n, nd) {
      const out = nd.querySelector('.pl-stat');
      let txt = '';
      if (n.kind === 'twin') {
        const cnt = nd.querySelector('.pl-count');
        const d = decisionsOf(n.v);
        const target = Math.min(500, S.spec?.crowdSize || 500);
        if (cnt._v !== d) { cnt._v = d; countUp(cnt, d, (x) => fmtInt(Math.round(x)), 500); }
        const c = S.counters?.[`s${S.seed}:${variantOf(n.v)}`];
        nd.querySelector('.pl-round').textContent = c ? `round ${(c.round ?? 0) + 1}${S.spec ? ` of ${S.spec.rounds}` : ''}` : (S.spec ? `of ${fmtInt(target)} target` : '');
        nd.querySelector('.pl-name').textContent = `Twin world ${variantOf(n.v)}`;
        nd.style.setProperty('--rc', vcolor(vkey(variantOf(n.v))));
      } else if (n.id === 'guard') {
        const recs = Object.entries(S.rec || {}).filter(([w]) => w.startsWith(`s${S.seed}:`)).flatMap(([, r]) => r);
        if (recs.length) txt = `${recs.filter((r) => r.checks?.length).length} flagged / ${recs.length} shown`;
      } else if (n.id === 'analyst') {
        txt = S.verdict ? 'verdict ready' : '';
      } else if (n.id === 'verdict') {
        const v = S.verdict;
        if (v) txt = v.call === 'winner' ? `Version ${v.winner} wins` : 'too close to call';
        nd.dataset.call = v ? (v.call === 'winner' ? 'win' : 'tie') : '';
      } else {
        const st = nodeStats(n);
        if (st && st.calls && !st.shared) txt = `${fmtInt(st.calls)} calls`;
        if (n.id === 'moderator' && S.focus?.length) txt = `${S.focus.length} turns`;
      }
      if (n.kind !== 'twin' && out.textContent !== txt) out.textContent = txt;
    }
    function paintSummary() {
      const rows = [...S.usage.values()];
      const calls = rows.reduce((a, u) => a + (u.calls || 0), 0), ms = rows.reduce((a, u) => a + (u.ms || 0), 0);
      const tin = rows.reduce((a, u) => a + (u.tin || 0), 0), tout = rows.reduce((a, u) => a + (u.tout || 0), 0), err = rows.reduce((a, u) => a + (u.errors || 0), 0);
      mount(summary,
        h('span.pl-pill', h('b', fmtInt(calls)), ' calls'),
        h('span.pl-pill', h('b', calls ? ms1(ms / calls) : '-'), ' avg'),
        h('span.pl-pill', h('b', `${fmtInt(tin)} / ${fmtInt(tout)}`), ' tokens in / out'),
        err ? h('span.pl-pill.bad', h('b', fmtInt(err)), ' failed') : null);
      replayBtn.disabled = !calls || (S.status !== 'done' && S.status !== 'error');
      replayBtn.title = replayBtn.disabled ? 'Available once the run has finished and made model calls' : 'Re-play the model calls over about 6 seconds, in proportion to the run totals';
      replayBtn.textContent = replayIdx != null ? 'Replaying...' : 'Replay flow';
    }

    /* ---------------------------------------------------------------- Nemotron panel */
    function paintNemo() {
      const roles = ROLE_ORDER.filter((r) => usageOf(r).length).concat([...new Set([...S.usage.values()].map((u) => u.role))].filter((r) => !ROLE_ORDER.includes(r)));
      const totalCalls = roles.reduce((a, r) => a + roleTotals(r).calls, 0);
      let wrap = nemo.querySelector('.pl-gauges');
      if (!nemo.firstChild) {
        mount(nemo, h('div.card-head', h('h2', 'Nemotron panel'), h('span.sub.pl-nemo-sub')), h('div.pl-gauges'), h('div.pl-ticker-h', 'Latest calls'), h('div.pl-ticker'));
        wrap = nemo.querySelector('.pl-gauges');
      }
      nemo.querySelector('.pl-nemo-sub').textContent = `${fmtInt(totalCalls)} calls. served_by shows which model actually answered each call.`;
      if (!roles.length) {
        wrap.classList.add('empty');
        if (!wrap.querySelector('.pl-empty')) mount(wrap, h('div.pl-empty.muted', S.status === 'done' ? 'No model calls were recorded for this run.' : 'Waiting for the first model call...'));
        else wrap.querySelector('.pl-empty').textContent = S.status === 'done' ? 'No model calls were recorded for this run.' : 'Waiting for the first model call...';
      } else {
        wrap.classList.remove('empty');
        wrap.querySelector('.pl-empty')?.remove();
        for (const r of roles) {
          const t = roleTotals(r), meta = ROLE_META[r] || { c: 'var(--muted)', d: '' };
          let card = wrap.querySelector(`[data-role="${r}"]`);
          if (!card) {
            card = h('div.pl-gauge', { 'data-role': r, style: { '--gc': meta.c }, onclick: () => { const t0 = NODES.find((n) => nodeStats(n)?.role === r && !n.side) || NODES.find((n) => nodeStats(n)?.role === r); if (t0) openDrawer(t0.id); } },
              h('div.pl-g-ring', s('svg', { viewBox: '0 0 72 72' }, s('circle', { class: 'trk', cx: 36, cy: 36, r: 30 }), s('circle', { class: 'val', cx: 36, cy: 36, r: 30, transform: 'rotate(-90 36 36)', 'stroke-dasharray': `0 ${CIRC}` })), h('b.pl-g-n', '0')),
              h('div.pl-g-body', h('div.pl-g-role', h('b', r), h('span.muted', meta.d)), h('div.pl-g-model.mono'), h('div.pl-g-tok'), h('div.pl-g-meta'), h('div.pl-g-served')));
            wrap.append(card);
            if (!reduced()) card.animate([{ opacity: 0, transform: 'translateY(14px) scale(.97)' }, { opacity: 1, transform: 'none' }], { duration: 600, easing: 'cubic-bezier(0.16,1,0.3,1)' });
          }
          const share = totalCalls ? t.calls / totalCalls : 0;
          card.querySelector('.val').setAttribute('stroke-dasharray', `${share * CIRC} ${CIRC}`);
          countUp(card.querySelector('.pl-g-n'), t.calls, (x) => fmtInt(Math.round(x)), 700);
          card.querySelector('.pl-g-model').textContent = t.models.join(', ') || '-';
          const tt = t.tin + t.tout;
          mount(card.querySelector('.pl-g-tok'), h('div.pl-bar', { title: `${fmtInt(t.tin)} tokens in, ${fmtInt(t.tout)} out` }, h('i.in', { style: { width: `${tt ? (t.tin / tt) * 100 : 0}%` } }), h('i.out', { style: { width: `${tt ? (t.tout / tt) * 100 : 0}%` } })),
            h('div.pl-bar-l', h('span', `${fmtInt(t.tin)} in`), h('span', `${fmtInt(t.tout)} out`)));
          mount(card.querySelector('.pl-g-meta'), h('span', `avg ${t.calls ? ms1(t.ms / t.calls) : '-'}`), t.errors ? h('span.chip.bad', `${t.errors} failed`) : h('span.chip.good', 'no failures'));
          const sv = Object.entries(t.served).sort((a, b) => b[1] - a[1]), sn = sv.reduce((a, [, c]) => a + c, 0);
          mount(card.querySelector('.pl-g-served'), sv.length ? [h('div.pl-bar.stack', sv.map(([k, c], idx) => h('i', { title: `${k} x ${c}`, style: { width: `${(c / sn) * 100}%`, opacity: String(1 - idx * 0.22) } }))),
            h('div.pl-bar-l.wrap', sv.map(([k, c]) => h('span.served', `${k} × ${fmtInt(c)}`)))] : null);
        }
      }
      // live ticker, newest first; rows that arrived since the last paint slide in
      const tk = nemo.querySelector('.pl-ticker'), log = S.traceLog || [];
      const idx = lastTop ? log.indexOf(lastTop) : -1, fresh = idx < 0 ? Math.min(log.length, 6) : idx;
      lastTop = log[0] || null;
      mount(tk, log.length ? log.slice(0, 8).map((t, k) => {
        const row = h('div.pl-tick' + (t.ok ? '' : '.bad'), h('i', { style: { background: (ROLE_META[t.role] || {}).c || 'var(--muted)' } }), h('b', t.role), h('span.mono', t.served_by || '-'), h('span', ms1(t.ms || 0)), h('span.mono', `${t.tokens_in ?? 0} > ${t.tokens_out ?? 0} tok`), t.ok ? null : h('span.chip.bad', 'FAILED'));
        if (k < fresh && !reduced()) row.animate([{ opacity: 0, transform: 'translateX(-14px)' }, { opacity: 1, transform: 'none' }], { duration: 420, easing: 'cubic-bezier(0.22,1,0.36,1)', delay: k * 40, fill: 'backwards' });
        return row;
      }) : h('div.muted', { style: { fontSize: '13px' } }, 'Live call ticker fills while a run is working. Finished runs keep the totals above.'));
    }

    /* ---------------------------------------------------------------- detail drawer */
    function openDrawer(id) {
      openId = id; drawer.hidden = false; root.classList.add('has-drawer');
      Object.values(nodeEls).forEach((nd) => nd.classList.toggle('sel', nd.dataset.id === id));
      paintDrawer(false);
      if (!reduced()) drawer.animate([{ opacity: 0, transform: 'translateX(28px) rotateY(-8deg)' }, { opacity: 1, transform: 'none' }], { duration: 480, easing: 'cubic-bezier(0.16,1,0.3,1)' });
      if (listMode) drawer.scrollIntoView?.({ block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' });
    }
    function closeDrawer() {
      if (!openId) return;
      const prev = nodeEls[openId]; openId = null;
      Object.values(nodeEls).forEach((nd) => nd.classList.remove('sel'));
      root.classList.remove('has-drawer');
      const done = () => { if (!openId) drawer.hidden = true; };
      if (reduced()) done(); else drawer.animate([{ opacity: 1 }, { opacity: 0, transform: 'translateX(20px)' }], { duration: 200, easing: 'cubic-bezier(0.55,0.055,0.675,0.19)' }).finished.then(done, done);
      prev?.focus?.({ preventScroll: true });
    }
    function paintDrawer(soft) {
      const n = NODE[openId]; if (!n) return;
      const cur = curIdx(), st = stateOf(n, cur), stats = nodeStats(n);
      const stLabel = { done: 'Done', now: 'Working now', error: 'Failed here', future: 'Waiting', side: 'Optional follow-up' }[st];
      const log = (S.traceLog || []).filter((t) => stats && t.role === stats.role && t.ok !== undefined);
      const body = [
        h('div.pl-d-top', h('div', h('h3', n.id.startsWith('twin') ? `Twin world ${variantOf(NODE[n.id].v)}` : n.label), n.role ? h('span.pl-role', n.role) : null, h('span.pl-state.' + st, stLabel)),
          h('button.pl-x', { type: 'button', 'aria-label': 'Close details', onclick: closeDrawer }, '×')),
        h('p', n.long),
        st === 'now' && S.detail ? h('div.pl-d-now', S.detail) : null,
        st === 'error' && S.error ? h('div.banner.bad', S.error) : null,
        n.chips ? h('div.pl-chips.big', n.chips.map((c) => h('span', c))) : null,
        n.kind === 'twin' ? h('div.pl-d-grid', h('div', h('small', 'Decisions'), h('b', fmtInt(decisionsOf(n.v)))), h('div', h('small', 'Rounds'), h('b', S.spec ? fmtInt(S.spec.rounds) : '-'))) : null,
        stats ? [
          h('div.pl-d-grid',
            h('div', h('small', stats.shared ? 'Calls (role total)' : 'Calls'), h('b', fmtInt(stats.calls))),
            h('div', h('small', 'Avg latency'), h('b', stats.calls ? ms1(stats.ms / stats.calls) : '-')),
            h('div', h('small', 'Tokens in'), h('b', fmtInt(stats.tin))),
            h('div', h('small', 'Tokens out'), h('b', fmtInt(stats.tout)))),
          stats.note ? h('p.muted.pl-note', stats.note) : null,
          stats.models.length ? h('div.pl-d-model', h('small', 'Model'), h('span.mono', stats.models.join(', '))) : null,
          stats.errors ? h('div', h('span.chip.bad', `${stats.errors} failed call${stats.errors > 1 ? 's' : ''}`)) : null,
          h('div.pl-hist-h', h('small', 'Latency of the latest calls'), h('small.muted', log.length ? `${log.length} calls` : '')),
          histogram(log.map((t) => t.ms || 0)),
        ] : h('p.muted.pl-note', 'This step is statistics and rules, not a model call, so it has no model latency to show.'),
        h('button.btn.primary.pl-go', { type: 'button', onclick: () => ctx.go(n.go) }, `Go to ${({ crowd: 'Crowd', worlds: 'Twin worlds', verdict: 'Verdict', report: 'Report', ask: 'Ask why' })[n.go] || n.go}`),
      ];
      mount(drawer, body);
      if (!soft && !reduced()) drawer.querySelectorAll('.pl-hist i').forEach((b, k) => b.animate([{ transform: 'scaleY(0)' }, { transform: 'scaleY(1)' }], { duration: 600, delay: 120 + k * 40, easing: 'cubic-bezier(0.16,1,0.3,1)', fill: 'backwards' }));
    }
    function histogram(vals) {
      if (vals.length < 2) return h('div.pl-hist.empty', h('span.muted', vals.length ? 'Only one live call so far.' : 'No live calls captured in this session. Finished runs keep totals only.'));
      const lo = Math.min(...vals), hi = Math.max(...vals), bins = 8, step = (hi - lo) / bins || 1, cnt = Array(bins).fill(0);
      for (const v of vals) cnt[Math.min(bins - 1, Math.floor((v - lo) / step))]++;
      const mx = Math.max(...cnt);
      return h('div.pl-hist-w', h('div.pl-hist', cnt.map((c, k) => h('i', { title: `${ms1(lo + k * step)} to ${ms1(lo + (k + 1) * step)}: ${c} calls`, style: { height: `${Math.max(4, (c / mx) * 100)}%` } }))),
        h('div.pl-hist-ax', h('small', ms1(lo)), h('small', ms1(hi))));
    }

    /* ---------------------------------------------------------------- hover highlight */
    function highlight(id) {
      root.classList.toggle('hl', !!id);
      for (const e of Object.values(edgeEls)) e.g.classList.toggle('hot', !!id && (e.from === id || e.to === id));
      for (const [nid, nd] of Object.entries(nodeEls)) nd.classList.toggle('hot', !!id && (nid === id || EDGES.some(([, f, t]) => (f === id && t === nid) || (t === id && f === nid))));
    }

    /* ---------------------------------------------------------------- packets (model calls) */
    function ensureLen(e) { if (!e.len) { try { e.len = e.path.getTotalLength(); } catch { e.len = 0; } } return e.len; }
    function spawn(edgeId, color, dur = 900, bad = false) {
      if (!visible || listMode || reduced() || destroyed) return false;
      const e = edgeEls[edgeId]; if (!e || !ensureLen(e)) return false;
      const now = performance.now();
      if (now - e.lastSpawn < 70 || active.length >= POOL) return false;     // throttle: hundreds of calls stay smooth
      const g = pool.find((x) => x.style.visibility === 'hidden'); if (!g) return false;
      e.lastSpawn = now;
      g.style.visibility = 'visible'; g.style.setProperty('--pc', bad ? 'var(--bad)' : color);
      active.push({ g, e, t0: now, dur: dur * (0.85 + Math.random() * 0.3), color });
      if (!raf) raf = requestAnimationFrame(tick);
      return true;
    }
    function tick(now) {
      raf = 0;
      for (let k = active.length - 1; k >= 0; k--) {
        const p = active[k], u = (now - p.t0) / p.dur;
        if (u >= 1) { p.g.style.visibility = 'hidden'; active.splice(k, 1); hitNode(p.e.to, p.color); continue; }
        const q = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
        const pt = p.e.path.getPointAtLength(p.e.len * q);
        p.g.setAttribute('transform', `translate(${pt.x.toFixed(1)} ${pt.y.toFixed(1)})`);
        p.g.style.opacity = String(Math.min(1, u * 8, (1 - u) * 6 + 0.4));
      }
      if (active.length && visible) raf = requestAnimationFrame(tick);
    }
    function clearPackets() { active.splice(0).forEach((p) => { p.g.style.visibility = 'hidden'; }); if (raf) { cancelAnimationFrame(raf); raf = 0; } }
    function hitNode(id, color) {
      const nd = nodeEls[id]; if (!nd || reduced()) return;
      const now = performance.now(); if (now - (lastHit[id] || 0) < 160) return; lastHit[id] = now;
      const ring = nd.querySelector('.pl-hit');
      ring.style.setProperty('--hc', color);
      ring.animate([{ opacity: 0.9, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(1.1)' }], { duration: 520, easing: 'cubic-bezier(0.22,1,0.36,1)' });
    }
    // which edge a model call travels along
    function routeTrace(t, replay) {
      const A = vcolor(vkey(variantOf(0))), B = vcolor(vkey(variantOf(1))), acc = 'var(--accent)';
      const tag = String(t.tag || '').toLowerCase(), bad = t.ok === false;
      switch (t.role) {
        case 'crowd': { const k = altTick++ & 1; spawn(k ? 'e-v1' : 'e-v0', k ? B : A, 800, bad); break; }
        case 'voice': spawn('e-smp', 'var(--accent-2)', 800, bad); break;
        case 'review': spawn('e-rp', 'var(--warn)', 800, bad); break;
        case 'interview': spawn(/focus|moder|group/.test(tag) ? 'e-s1' : 'e-s0', 'var(--muted)', 800, bad); break;
        case 'reason': {
          const post = S.status === 'done' && !replay;
          const k = post ? 'rewriter' : (/audience|segment/.test(tag) || (!/report|analy|sql|tool/.test(tag) && PHASE_IDX[S.phase] <= 3)) ? 'audience' : 'report';
          if (k === 'rewriter') spawn('e-s2', 'var(--c)', 800, bad);
          else { spawn(k === 'audience' ? 'e-src' : 'e-an', acc, 800, bad); if (!replay && reasonSplit[k]) { const sp = reasonSplit[k]; sp.calls++; sp.ms += t.ms || 0; sp.tin += t.tokens_in || 0; sp.tout += t.tokens_out || 0; } }
          break;
        }
        default: break;
      }
    }

    /* ---------------------------------------------------------------- sparks (decisions) */
    function spark(rec) {
      if (!visible || listMode || reduced()) return;
      const wid = String(rec?.world_id || ''), v = wid.split(':')[1] || rec?.variant;
      const k = variants().indexOf(v);
      if (k < 0) return;
      tally[k]++;
      const now = performance.now(); if (now - (lastSpark[k] || 0) < 60 || sparkLive >= 16) return; lastSpark[k] = now;
      const layer = nodeEls[`twin${k}`]?.querySelector('.pl-spark-layer'); if (!layer) return;
      const big = rec.action && rec.action !== 'scroll_past';
      const sp = h('i.pl-spark' + (big ? '.big' : ''), { style: { left: `${10 + Math.random() * 80}%`, background: vcolor(vkey(v)) } });
      layer.append(sp); sparkLive++;
      const a = sp.animate([{ opacity: 0, transform: 'translateY(0) scale(.4)' }, { opacity: 1, offset: 0.2 }, { opacity: 0, transform: `translate(${(Math.random() - 0.5) * 30}px, ${-(big ? 90 : 60) - Math.random() * 40}px) scale(${big ? 1.3 : 0.8})` }], { duration: 1100 + Math.random() * 500, easing: 'cubic-bezier(0.22,1,0.36,1)' });
      const end = () => { sp.remove(); sparkLive--; };
      a.onfinish = end; a.oncancel = end;
    }
    const variants = () => ctx.variants?.() || ['A', 'B'];

    /* ---------------------------------------------------------------- replay of the flow, proportional to S.usage */
    function replayFlow() {
      if (replayIdx != null) return;
      const reason = roleTotals('reason').calls, voice = roleTotals('voice').calls, crowd = roleTotals('crowd').calls, review = roleTotals('review').calls;
      const total = reason + voice + crowd + review;
      if (!total) return;
      const budget = 110, n = (c) => (c > 0 ? clamp(Math.round((c / total) * budget), 1, 60) : 0);
      // [start s, end s, role, tag, count, node index to light]
      const waves = [[0, 1.1, 'reason', 'audience', n(reason * 0.4), 1], [1.1, 2.3, 'voice', '', n(voice), 3], [2.3, 4.4, 'crowd', '', n(crowd), 4], [4.4, 5.3, 'reason', 'report', n(reason * 0.6), 7], [5.3, 6, 'review', '', n(review), 8]];
      replayIdx = 0; paintAll();
      const t = { ts: Date.now() };
      for (const [a, b, role, tag, cnt, idx] of waves) {
        replayTimers.push(later(() => { replayIdx = idx; paintStates(); }, a * 1000));
        for (let k = 0; k < cnt; k++) replayTimers.push(later(() => routeTrace({ role, tag, ok: true, ts: t.ts }, true), (a + ((b - a) * k) / Math.max(1, cnt)) * 1000 + Math.random() * 60));
      }
      replayTimers.push(later(() => { replayIdx = null; replayTimers = []; paintAll(); }, 6600));
    }
    function stopReplay() { replayTimers.forEach((t) => { clearTimeout(t); timers.delete(t); }); replayTimers = []; replayIdx = null; }

    /* ---------------------------------------------------------------- pointer tilt (a subtle 3D feel) */
    let tiltOn = !reduced() && !matchMedia('(pointer: coarse)').matches;
    const onMove = (e) => {
      if (!tiltOn || listMode) return;
      const r = stageBox.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
      tiltEl.style.transform = `rotateX(${(-y * 3.2).toFixed(2)}deg) rotateY(${(x * 4.2).toFixed(2)}deg)`;
    };
    const onLeave = () => { tiltEl.style.transform = ''; };
    stageBox.addEventListener('pointermove', onMove);
    stageBox.addEventListener('pointerleave', onLeave);
    const onKey = (e) => { if (e.key === 'Escape' && openId && visible) closeDrawer(); };
    document.addEventListener('keydown', onKey);

    /* ---------------------------------------------------------------- responsive: list-flow on phones */
    const measure = () => {
      const w = root.clientWidth;
      if (!w) return;
      const lm = w < 760;
      if (lm !== listMode) { listMode = lm; root.classList.toggle('pl-list', lm); clearPackets(); onLeave(); }
    };
    const ro = 'ResizeObserver' in window ? new ResizeObserver(measure) : null;
    ro?.observe(root);

    /* ---------------------------------------------------------------- bus */
    offs.push(bus.on('status', () => { paintStates(); queuePaint(); }));
    offs.push(bus.on('trace', (t) => { if (!t) return; if (replayIdx == null) routeTrace(t, false); queuePaint(); }));
    offs.push(bus.on('action', ({ record } = {}) => { if (record) spark(record); queuePaint(); }));
    for (const ev of ['round', 'snapshot', 'history', 'verdict', 'report', 'done', 'error', 'seed', 'focus', 'crowd']) {
      offs.push(bus.on(ev, () => { if (ev === 'snapshot' || ev === 'history' || ev === 'seed') { tally[0] = 0; tally[1] = 0; } queuePaint(); }));
    }

    /* ---------------------------------------------------------------- first paint */
    measure();
    paintAll();
    paintNemo();

    return {
      show() {
        visible = true; measure(); paintAll();
        if (!reduced()) {
          const nodes = [...nodeEls_];
          nodes.forEach((nd, k) => nd.animate([{ opacity: 0, transform: 'translate(-50%,-50%) translateY(26px) scale(.92)', filter: 'blur(4px)' }, { opacity: 1, transform: 'translate(-50%,-50%)', filter: 'blur(0)' }], { duration: 650, delay: k * 45, easing: 'cubic-bezier(0.16,1,0.3,1)', fill: 'backwards' }));
        }
      },
      hide() { visible = false; clearPackets(); },
      destroy() {
        destroyed = true; visible = false;
        offs.forEach((o) => o && o()); offs.length = 0;
        timers.forEach((t) => clearTimeout(t)); timers.clear(); clearTimeout(paintT);
        clearPackets(); stopReplay();
        ro?.disconnect();
        stageBox.removeEventListener('pointermove', onMove); stageBox.removeEventListener('pointerleave', onLeave);
        document.removeEventListener('keydown', onKey);
        root.remove();
      },
    };
  },
};

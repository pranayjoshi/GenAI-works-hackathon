/* Ask why stage: four tools behind a launcher of tilting cards.
 *  - Interview an agent: searchable avatar grid -> openAgent()
 *  - Ask a segment:      POST /api/runs/:id/segment {segment, question, variant}
 *  - Focus group:        POST /api/runs/:id/focus {size, turns}; live turns also arrive on bus 'focus' (S.focus)
 *  - Version C:          POST /api/runs/:id/version-c, then /version-c/run {text} -> #/run/<new id>
 * All tools need S.verdict (segments come from it), so the stage shows a locked state before that. */
import { h, s, mount, spin, avatar, actPill, roundTime, hueOf } from '../../core/dom.js';
import { current } from '../../core/state.js';
import { api, fail } from '../../core/api.js';
import { stagger, tilt, magnetic, typeText, reduced, EASE } from '../../core/motion.js';

const AGE_ORDER = ['18-24', '25-34', '35-44', '45-54', '55-64', '65+'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const segLabel = (key) => {
  const [d, v] = String(key).split(':');
  if (d === 'role') return v === 'core' ? 'Core audience' : 'Spillover';
  if (d === 'customer') return v === 'yes' ? 'Existing customers' : 'Not customers';
  return v || key;
};
const anim = (el, frames, opts) => { if (!reduced() && el?.animate) return el.animate(frames, opts); return null; };

/* ---------------------------------------------------------------- animated launcher icons (48x48) */
const ICONS = {
  agent: () => s('svg', { class: 'ak-ic', viewBox: '0 0 48 48' },
    s('path', { class: 'a', d: 'M8 10h22a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H18l-7 6v-6H8a4 4 0 0 1-4-4V14a4 4 0 0 1 4-4z' }),
    s('path', { class: 'b', d: 'M38 20h2a4 4 0 0 1 4 4v8a4 4 0 0 1-4 4h-1v5l-6-5h-8a4 4 0 0 1-2.5-.9' }),
    [0, 1, 2].map((i) => s('circle', { class: 'dot', cx: 13 + i * 8, cy: 19, r: 1.9, style: `animation-delay:${i * 160}ms` }))),
  segment: () => s('svg', { class: 'ak-ic', viewBox: '0 0 48 48' },
    s('circle', { class: 'a', cx: 24, cy: 24, r: 18 }),
    s('g', { class: 'spin' }, s('path', { class: 'fill', d: 'M24 24V6a18 18 0 0 1 15.6 9z' })),
    s('path', { class: 'b', d: 'M24 24l-12.7 12.7M24 24h18' })),
  focus: () => s('svg', { class: 'ak-ic', viewBox: '0 0 48 48' },
    s('circle', { class: 'a', cx: 24, cy: 24, r: 9 }),
    s('g', { class: 'orbit' }, [0, 1, 2, 3, 4].map((i) => { const a = (i / 5) * Math.PI * 2 - Math.PI / 2; return s('circle', { class: 'seat', cx: (24 + Math.cos(a) * 17).toFixed(1), cy: (24 + Math.sin(a) * 17).toFixed(1), r: 3.4 }); }))),
  c: () => s('svg', { class: 'ak-ic', viewBox: '0 0 48 48' },
    s('rect', { class: 'a', x: 5, y: 8, width: 20, height: 28, rx: 3 }),
    s('rect', { class: 'b c-doc', x: 23, y: 12, width: 20, height: 28, rx: 3 }),
    s('path', { class: 'ln', d: 'M10 16h10M10 22h10M10 28h6' }),
    s('path', { class: 'ln add', d: 'M28 20h10M28 26h10M28 32h6' }),
    s('path', { class: 'spark', d: 'M40 4v6M37 7h6' })),
};
const TOOLS = [
  { key: 'agent', title: 'Interview an agent', desc: 'Pick anyone from the crowd. They answer only from their own memory and cite the exact action.' },
  { key: 'segment', title: 'Ask a segment', desc: 'Put one question to up to six people from a segment and read the pattern.' },
  { key: 'focus', title: 'Focus group', desc: 'A moderator seats six people around a table, shows both posts and runs a short discussion.' },
  { key: 'c', title: 'Version C', desc: 'The rewriter answers the objections, an honesty check guards the offer, then C runs against the winner.' },
];

/* ---------------------------------------------------------------- word diff (LCS) */
function wordDiff(a, b) {
  const A = String(a || '').match(/\S+\s*/g) || [], B = String(b || '').match(/\S+\s*/g) || [];
  const n = A.length, m = B.length;
  if (!n || !m || n * m > 160000) return { left: A.map((t) => ({ t, k: 0 })), right: B.map((t) => ({ t, k: 0 })), add: 0, del: 0, skipped: true };
  const eq = (i, j) => A[i].trim().toLowerCase() === B[j].trim().toLowerCase();
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = eq(i, j) ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const left = [], right = [];
  let i = 0, j = 0, add = 0, del = 0;
  while (i < n || j < m) {
    if (i < n && j < m && eq(i, j)) { left.push({ t: A[i++], k: 0 }); right.push({ t: B[j++], k: 0 }); }
    else if (j < m && (i >= n || L[i][j + 1] >= L[i + 1][j])) { right.push({ t: B[j++], k: 1 }); add++; }
    else { left.push({ t: A[i++], k: -1 }); del++; }
  }
  return { left, right, add, del };
}
const diffNodes = (toks) => toks.map((x) => (x.k ? h('mark.' + (x.k > 0 ? 'add' : 'del'), x.t) : x.t));

/* ================================================================ stage */
export default {
  id: 'ask',
  mount(el, ctx) {
    const { S, bus, id: runId } = ctx;
    const root = h('div.ak');
    el.append(root);
    const offs = [], tiltOffs = [], destroyers = [];
    let dead = false, mountedGate = null, active = null;
    const panes = {};     // key -> { el, api }
    const cards = {};

    /* ------------------------------------------------------------ locked state */
    const lockedView = () => h('div.ak-locked',
      h('div.ak-lock', s('svg', { viewBox: '0 0 48 48' }, s('rect', { x: 10, y: 21, width: 28, height: 20, rx: 5 }), s('path', { class: 'shackle', d: 'M16 21v-6a8 8 0 0 1 16 0v6' }), s('circle', { cx: 24, cy: 31, r: 2.6 }))),
      h('h2', 'Ask why opens after the verdict'),
      h('p.muted', 'Segments, interviews and the focus group read from the finished twin worlds. Hang on until both feeds are scored.'),
      S.status === 'done' || S.status === 'error' ? h('p.muted', 'This run has no verdict, so these tools stay closed.') : h('div.chip', spin(), S.detail || S.phase || 'running'));

    /* ------------------------------------------------------------ tool: interview an agent */
    function buildAgent() {
      const st = { q: '', role: '', age: '' };
      const search = h('input', { type: 'text', placeholder: 'Search by id, role, age, income...', 'aria-label': 'Search people', autocomplete: 'off' });
      const filters = h('div.ak-filters'), grid = h('div.ak-people'), count = h('div.muted.ak-count');
      let built = -1;
      const chipRow = (label, key, values) => h('div.ak-filter', h('span.ak-flabel', label), h('div.chips', ['', ...values].map((v) => {
        const b = h('button.chip' + (st[key] === v ? '.on' : ''), { onclick: () => { st[key] = v; draw(); apply(true); } }, v || 'All');
        return b;
      })));
      function draw() {   // chips depend on the crowd
        const ps = S.personas || [];
        const roles = [...new Set(ps.map((p) => p.role).filter(Boolean))];
        const ages = [...new Set(ps.map((p) => p.age_band).filter(Boolean))].sort((a, b) => AGE_ORDER.indexOf(a) - AGE_ORDER.indexOf(b));
        mount(filters, chipRow('Role', 'role', roles), chipRow('Age', 'age', ages));
      }
      const hay = (p) => `${p.id} ${p.age} ${p.age_band} ${p.role} ${p.segment} ${p.income_band} ${p.education} ${p.channel}`.toLowerCase();
      function build() {
        const ps = S.personas || [];
        if (built === ps.length) return;
        built = ps.length; draw();
        if (!ps.length) { mount(grid, h('div.empty', 'The crowd is not sampled yet.')); count.textContent = ''; return; }
        mount(grid, ps.map((p) => {
          const t = h('button.ak-tile', { 'data-id': p.id, title: `${p.id}: ${p.age}, ${p.role}, ${p.income_band}`, style: { '--h': hueOf(p.id) }, onclick: () => current.openAgent?.(p.id) },
            avatar(p.id, '', () => {}), h('b', p.id), h('span', `${p.age ?? '?'} · ${p.role || '?'}`));
          t._hay = hay(p); t._p = p; return t;
        }));
        apply(false);
        stagger(grid, { y: 12, gap: 12, ms: 500 });
      }
      function apply(animate) {
        let n = 0, first = null;
        const q = st.q.trim().toLowerCase();
        for (const t of grid.children) {
          if (!t._p) continue;
          const ok = (!q || t._hay.includes(q)) && (!st.role || t._p.role === st.role) && (!st.age || t._p.age_band === st.age);
          const was = !t.hidden; t.hidden = !ok;
          if (ok) { n++; first = first || t; if (animate && !was) anim(t, [{ opacity: 0, transform: 'scale(.85)' }, { opacity: 1, transform: 'none' }], { duration: 360, easing: EASE.expo }); }
        }
        count.textContent = grid.children.length && grid.children[0]._p ? `${n} of ${S.personas.length} people` : '';
        grid._first = first;
        if (grid.children[0]?._p && !n) { if (!grid._none) { grid._none = h('div.empty', 'Nobody matches those filters.'); grid.after(grid._none); } } else if (grid._none) { grid._none.remove(); grid._none = null; }
      }
      search.addEventListener('input', () => { st.q = search.value; apply(true); });
      search.addEventListener('keydown', (e) => { if (e.key === 'Enter' && grid._first) current.openAgent?.(grid._first._p.id); });
      const lucky = h('button.btn.sm', { onclick: () => { const vis = [...grid.children].filter((t) => t._p && !t.hidden); if (vis.length) current.openAgent?.(vis[Math.floor(Math.random() * vis.length)]._p.id); } }, 'Surprise me');
      const body = h('div', h('div.ak-bar', search, lucky), filters, count, grid);
      offs.push(bus.on('crowd', build));
      return { el: body, show: build };
    }

    /* ------------------------------------------------------------ tool: ask a segment */
    function buildSegment() {
      const segs = (S.verdict?.segments || []).map((x) => x.key);
      const st = { seg: segs[0] || '', variant: '' };
      const q = h('input', { type: 'text', value: 'Why did you prefer one of these posts over the other?', 'aria-label': 'Question' });
      const out = h('div.ak-answers');
      const segRow = h('div.chips'), varRow = h('div.ak-seg-switch', { role: 'group', 'aria-label': 'Variant' });
      const drawSegs = () => mount(segRow, segs.length ? segs.map((k) => h('button.chip' + (k === st.seg ? '.on' : ''), { title: k, onclick: () => { st.seg = k; drawSegs(); } }, segLabel(k))) : h('span.muted', 'The verdict has no segments.'));
      const drawVar = () => mount(varRow, [['', 'Either version'], ...ctx.variants().map((v) => [v, `Only people who saw ${v}`])].map(([v, l]) => h('button' + (v === st.variant ? '.on' : ''), { onclick: () => { st.variant = v; drawVar(); } }, l)));
      drawSegs(); drawVar();
      const btn = h('button.btn.primary', 'Ask the segment');
      const presets = ['Why did you prefer one of these posts over the other?', 'What put you off?', 'What would make you actually visit?'];
      const card = (a, i) => h('article.ak-answer', { style: { '--h': hueOf(a.agent_id) } },
        h('div.row.spread', h('div.row', avatar(a.agent_id), h('div', h('b', a.agent_id), h('div.muted', `${a.persona?.age ?? '?'}, ${a.persona?.role ?? '?'}, world ${a.world_id}`))), a.saw_it === false ? h('span.chip.warn', "didn't see it") : null),
        h('p.ak-quote', `"${a.answer}"`),
        a.citations?.length ? h('div.dz-cites', a.citations.map((c) => h('button.dz-cite', { title: 'Open this person at that moment', onclick: () => current.openAgent?.(a.agent_id, { world: a.world_id }) },
          h('span.hr', roundTime(c.hour)), c.text, c.action_id ? h('span.chip.qid', `action ${c.action_id}`) : null))) : null,
        a.invalid_citations?.length ? h('span.chip.bad', `${a.invalid_citations.length} unmatched citation(s)`) : null,
        h('div.muted.ak-served', `served by ${a.served_by}`));
      btn.onclick = async () => {
        if (!q.value.trim() || !st.seg) return;
        btn.disabled = true;
        mount(out, h('div.muted.row', spin(), ' Interviewing up to six people from this segment...'), h('div.ak-answers-grid', [0, 1, 2].map(() => h('div.skeleton.ak-skel'))));
        try {
          const r = await api(`/api/runs/${encodeURIComponent(runId)}/segment`, { method: 'POST', body: { segment: st.seg, question: q.value.trim(), variant: st.variant || undefined } });
          const answers = r.answers || [];
          const cardsEl = answers.map(card);
          mount(out, r.summary ? h('div.banner.info.ak-pattern', h('b', 'Pattern: '), r.summary) : null,
            answers.length ? h('div.ak-answers-grid', cardsEl) : h('div.empty', 'Nobody in that segment decided on the post.'));
          cardsEl.forEach((c, i) => anim(c, [{ opacity: 0, transform: 'translate(-60px,-70px) rotate(-9deg) scale(.85)' }, { opacity: 1, transform: 'none' }], { duration: 760, delay: 150 + i * 110, easing: EASE.expo, fill: 'backwards' }));
        } catch (e) { mount(out, h('div.banner.bad', e.message)); }
        btn.disabled = false;
      };
      q.addEventListener('keydown', (e) => { if (e.key === 'Enter') btn.click(); });
      const body = h('div', h('div.ak-form',
        h('div', h('label', 'Segment'), segRow), h('div', h('label', 'Version'), varRow),
        h('div', h('label', 'Question'), q, h('div.chips', { style: { marginTop: '8px' } }, presets.map((t) => h('button.chip', { onclick: () => { q.value = t; } }, t)))), h('div', btn)), out);
      return { el: body };
    }

    /* ------------------------------------------------------------ tool: focus group (round table) */
    function buildFocus() {
      const MOD = '__moderator';
      let shown = 0, busy = false, running = false, slotsN = 6;
      const queue = [], seats = new Map(), ghosts = [];
      const spoke = h('svg.ak-spoke', { viewBox: '0 0 100 100', 'aria-hidden': 'true' });
      const bubbleName = h('b'), bubbleText = h('span'), bubble = h('div.ak-fg-bubble', { 'aria-live': 'polite' }, bubbleName, bubbleText);
      const table = h('div.ak-table',
        s('svg', { class: 'ak-table-svg', viewBox: '0 0 100 100', 'aria-hidden': 'true' },
          s('circle', { class: 'rim', cx: 50, cy: 50, r: 30 }), s('circle', { class: 'top', cx: 50, cy: 50, r: 27.5 }), s('circle', { class: 'ring', cx: 50, cy: 50, r: 33.5 })),
        spoke, bubble);
      const transcript = h('div.ak-transcript', { role: 'log' }, h('div.empty', 'The transcript appears here, turn by turn.'));
      const startBtn = h('button.btn.primary.lg', 'Start focus group (6 people, 2 rounds)');
      const skipBtn = h('button.btn.sm.ghost', { hidden: true, onclick: () => { skipping = true; } }, 'Skip to the end');
      const status = h('div.muted.ak-fg-status', 'A moderator seats people from different segments, shows both posts and runs a short discussion. Each person speaks from their own memory.');
      let skipping = false;

      const place = (el, angleDeg, r = 40) => { const a = (angleDeg * Math.PI) / 180; el.style.left = `${(50 + Math.cos(a) * r).toFixed(2)}%`; el.style.top = `${(50 + Math.sin(a) * r).toFixed(2)}%`; };
      const slotAngle = (i, n) => -90 + (360 * (i + 1)) / (n + 1);
      function layout() {
        const parts = [...seats.entries()].filter(([k]) => k !== MOD).map(([, v]) => v);
        slotsN = Math.max(6, parts.length);
        while (ghosts.length < slotsN - parts.length) { const g = h('div.ak-seat.ghost', h('i')); ghosts.push(g); table.append(g); }
        while (ghosts.length > slotsN - parts.length) ghosts.pop().remove();
        parts.forEach((v, i) => { v.idx = i; v.angle = slotAngle(i, slotsN); place(v.el, v.angle); });
        ghosts.forEach((g, i) => place(g, slotAngle(parts.length + i, slotsN)));
        const mod = seats.get(MOD); if (mod) place(mod.el, -90);
      }
      function claim(t) {
        const isMod = /^Moderator/.test(t.speaker || '');
        const key = isMod ? MOD : (t.agent_id || t.speaker);
        let seat = seats.get(key);
        if (seat) return seat;
        const p = t.agent_id ? S.pmap?.get(t.agent_id) : null;
        const face = isMod ? h('div.avatar.ak-modav', s('svg', { viewBox: '0 0 24 24' }, s('path', { d: 'M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3zM19 11a7 7 0 0 1-14 0M12 18v4' }))) : avatar(t.agent_id || key, '', () => {});
        const seatEl = h('button.ak-seat', { title: isMod ? 'Moderator' : `Open ${t.agent_id || key}`, onclick: () => { if (!isMod && t.agent_id) current.openAgent?.(t.agent_id); } },
          face, h('span.ak-seat-name', isMod ? 'Moderator' : (t.agent_id || key)), isMod || !p ? null : h('span.ak-seat-sub', `${p.age ?? ''} ${p.role || ''}`.trim()),
          h('span.ak-eq', h('i'), h('i'), h('i')));
        seat = { el: seatEl };
        seats.set(key, seat);
        if (!isMod && ghosts.length) ghosts.shift().remove();
        table.append(seatEl); layout();
        anim(seatEl, [{ opacity: 0, transform: 'translate(-50%,-50%) scale(.3)' }, { opacity: 1, transform: 'translate(-50%,-50%) scale(1)' }], { duration: 600, easing: 'cubic-bezier(0.34,1.4,0.64,1)' });
        return seat;
      }
      function aim(seat) {   // draw the spoke from the table centre to the speaker
        const ang = seat === seats.get(MOD) ? -90 : seat.angle;
        const a = (ang * Math.PI) / 180;
        const line = s('line', { x1: 50, y1: 50, x2: 50 + Math.cos(a) * 31, y2: 50 + Math.sin(a) * 31, pathLength: 1, class: 'spoke-line' });
        spoke.replaceChildren(line);
        anim(line, [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: 500, easing: EASE.expo });
      }
      function addTranscript(t) {
        const mod = /^Moderator/.test(t.speaker || '');
        if (transcript.querySelector('.empty')) transcript.replaceChildren();
        const b = h('div.bubble.' + (mod ? 'mod' : 'them'), h('span.who', { onclick: () => t.agent_id && current.openAgent?.(t.agent_id) }, t.speaker), t.text);
        transcript.append(b);
        anim(b, [{ opacity: 0, transform: 'translateY(10px) scale(.97)' }, { opacity: 1, transform: 'none' }], { duration: 480, easing: EASE.expo });
        transcript.scrollTop = transcript.scrollHeight;
      }
      async function speak(t, instant) {
        const seat = claim(t);
        for (const v of seats.values()) v.el.classList.remove('speaking');
        seat.el.classList.add('speaking');
        addTranscript(t);
        bubbleName.textContent = t.speaker || '';
        bubble.classList.add('on');
        if (instant || skipping) { bubbleText.textContent = t.text || ''; aim(seat); return; }
        aim(seat);
        anim(bubble, [{ transform: 'translate(-50%,-50%) scale(.85)', opacity: 0.2 }, { transform: 'translate(-50%,-50%) scale(1)', opacity: 1 }], { duration: 480, easing: EASE.expo });
        await typeText(bubbleText, t.text || '', 110);
        await sleep(reduced() ? 0 : Math.min(1500, 400 + (t.text || '').length * 6));
      }
      async function pump() {
        if (busy) return; busy = true;
        while (queue.length && !dead) { await speak(queue.shift()); skipBtn.hidden = queue.length < 2; }
        busy = false; skipping = false; skipBtn.hidden = true;
        if (!running && !queue.length) for (const v of seats.values()) v.el.classList.remove('speaking');
        table.classList.toggle('live', running);
      }
      function sync() {
        const list = S.focus || [];
        while (shown < list.length) queue.push(list[shown++]);
        if (queue.length) { skipBtn.hidden = queue.length < 2; pump(); }
      }
      function reset() {
        queue.length = 0; shown = 0; skipping = false;
        for (const [k, v] of [...seats]) { v.el.remove(); seats.delete(k); }
        spoke.replaceChildren(); bubble.classList.remove('on'); bubbleText.textContent = ''; bubbleName.textContent = '';
        mount(transcript, h('div.empty', 'The transcript appears here, turn by turn.'));
        layout();
      }
      startBtn.onclick = async () => {
        startBtn.disabled = true; running = true; S.focus = []; reset(); table.classList.add('live');
        mount(startBtn, spin(), ' Running...'); status.textContent = 'The moderator is seating people and reading both posts...';
        try {
          const r = await api(`/api/runs/${encodeURIComponent(runId)}/focus`, { method: 'POST', body: { size: 6, turns: 2 } });
          if (Array.isArray(r.transcript) && r.transcript.length >= (S.focus || []).length) S.focus = r.transcript;
          status.textContent = `${(S.focus || []).length} turns. Click a seat to interview that person.`;
        } catch (e) { fail(e); status.textContent = 'The focus group could not run.'; }
        running = false; sync();
        startBtn.disabled = false; mount(startBtn, 'Run it again');
        if (!busy) table.classList.remove('live');
      };
      layout();
      offs.push(bus.on('focus', () => { table.classList.add('live'); sync(); }));
      // restore a transcript that already exists (earlier in this session) without replaying it
      (async () => { const list = S.focus || []; if (list.length) { shown = list.length; busy = true; for (const t of list) await speak(t, true); busy = false; mount(startBtn, 'Run it again'); status.textContent = `${list.length} turns from the last focus group.`; } })();
      const body = h('div', status, h('div.row', { style: { margin: '12px 0' } }, startBtn, skipBtn),
        h('div.ak-fg', table, transcript));
      return { el: body };
    }

    /* ------------------------------------------------------------ tool: version C (diff view) */
    function buildC() {
      const out = h('div.ak-c-out');
      const btn = h('button.btn.primary.lg', 'Draft version C');
      btn.onclick = async () => {
        btn.disabled = true; mount(btn, spin(), ' Rewriter and honesty check...');
        mount(out, h('div.ak-c-grid', h('div.skeleton.ak-skel.tall'), h('div.ak-c-mid'), h('div.skeleton.ak-skel.tall')));
        try {
          const r = await api(`/api/runs/${encodeURIComponent(runId)}/version-c`, { method: 'POST' });
          show(r);
        } catch (e) { mount(out, h('div.banner.bad', e.message)); }
        btn.disabled = false; mount(btn, 'Draft again');
      };
      function show(r) {
        let cText = r.c?.text || '', editing = false;
        const ta = h('textarea', { 'aria-label': 'Version C text' }, cText);
        const left = h('div.ak-post'), right = h('div.ak-post'), stats = h('div.ak-diffstats');
        const redraw = () => {
          const d = wordDiff(r.winner_text, cText);
          mount(left, diffNodes(d.left)); mount(right, d.skipped ? cText : diffNodes(d.right));
          mount(stats, h('span.chip.good', `+${d.add} added`), h('span.chip.bad', `-${d.del} removed`));
        };
        redraw();
        let tmr = null;
        ta.addEventListener('input', () => { cText = ta.value; clearTimeout(tmr); tmr = setTimeout(redraw, 160); });
        const editBtn = h('button.btn.sm.ghost', { onclick: () => {
          editing = !editing; mount(editBtn, editing ? 'Show changes' : 'Edit');
          cText = ta.value; redraw();
          rightBox.replaceChildren(editing ? ta : right); if (editing) ta.focus();
        } }, 'Edit');
        const rightBox = h('div.ak-rightbox', right);
        const hon = r.honesty;
        const honest = hon
          ? h('div.ak-honesty.' + (hon.ok ? 'ok' : 'warn'), s('svg', { viewBox: '0 0 24 24' }, s('path', { class: 'shield', d: 'M12 2l8 3v6c0 5-3.4 9.3-8 11-4.6-1.7-8-6-8-11V5z' }), s('path', { class: 'mark', d: hon.ok ? 'M8 12.5l3 3 5-6' : 'M12 8v5M12 16v.5' })),
            h('div', h('b', 'Honesty check: '), hon.ok ? 'passed. Price and offer are kept, no invented claims.' : `flagged: ${(hon.issues || []).join('; ') || 'see the rewrite'}`))
          : h('div.ak-honesty.warn', h('div', h('b', 'Honesty check: '), 'no result returned.'));
        const go = h('button.btn.primary.lg.ak-go', 'Test C vs winner on the same crowd');
        go.onclick = async () => {
          const text = (editing ? ta.value : cText).trim();
          if (!text) return fail(new Error('Version C is empty.'));
          go.disabled = true; mount(go, spin(), ' Starting...');
          try { const n = await api(`/api/runs/${encodeURIComponent(runId)}/version-c/run`, { method: 'POST', body: { text } }); location.hash = `#/run/${n.run_id}`; }
          catch (e) { fail(e); go.disabled = false; mount(go, 'Test C vs winner on the same crowd'); }
        };
        tiltOffs.push(magnetic(go, 0.12));
        const grid = h('div.ak-c-grid',
          h('div.ak-c-col.w', h('label', `Current winner (Version ${r.winner ?? '?'})`), left),
          h('div.ak-c-mid', { 'aria-hidden': 'true' }, s('svg', { viewBox: '0 0 48 24' }, s('path', { d: 'M4 12h38M32 4l10 8-10 8' }))),
          h('div.ak-c-col.c', h('div.row.spread', h('label', { style: { margin: 0 } }, 'Version C'), editBtn), rightBox, stats));
        mount(out, grid,
          r.c?.rationale ? h('p.ak-why', h('b', 'Why: '), r.c.rationale) : null,
          r.c?.targets?.length ? h('div.chips', { style: { marginBottom: '12px' } }, r.c.targets.map((t) => h('span.chip', t))) : null,
          honest, h('div.row.spread.ak-cta', h('span.muted', 'Runs on the same crowd, graph and schedule as this test.'), go));
        stagger([grid, ...[...out.children].slice(1)], { y: 14, gap: 100, ms: 700 });
        anim(left.parentElement, [{ transform: 'translateX(-24px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 700, easing: EASE.expo });
      }
      const body = h('div', h('p.muted', 'The Rewriter aims at the objections of the segments that preferred the other version, an honesty check keeps the price and offer visible, and you can edit before testing.'),
        h('div', { style: { margin: '12px 0' } }, btn), out);
      return { el: body };
    }

    const BUILDERS = { agent: buildAgent, segment: buildSegment, focus: buildFocus, c: buildC };

    /* ------------------------------------------------------------ launcher + morph transitions */
    const stack = h('div.ak-stack');
    const launcher = h('div.ak-launcher');
    stack.append(launcher);

    function buildLauncher() {
      mount(launcher,
        h('div.ak-intro', h('div.ak-eyebrow', 'Ask why'), h('h2', 'Interrogate the simulation'), h('p.muted', 'The verdict says what happened. These tools ask the people in the twin worlds why.')),
        h('div.ak-cards', TOOLS.map((t) => (cards[t.key] = h('button.ak-card', { 'data-tool': t.key, onclick: () => openTool(t.key) },
          h('span.ak-card-ic', ICONS[t.key]()), h('h3', t.title), h('p', t.desc), h('span.ak-open', 'Open', s('svg', { viewBox: '0 0 24 24' }, s('path', { d: 'M5 12h14M13 6l6 6-6 6' }))))))));
      TOOLS.forEach((t) => tiltOffs.push(tilt(cards[t.key], { max: 9, scale: 1.02 })));
      stagger(launcher.querySelector('.ak-cards'), { y: 26, gap: 90, ms: 800, scale: 0.96 });
    }

    function getPane(key) {
      if (panes[key]) return panes[key];
      const def = TOOLS.find((t) => t.key === key);
      const built = BUILDERS[key]();
      const back = h('button.btn.sm.ak-back', { onclick: closeTool }, s('svg', { viewBox: '0 0 24 24' }, s('path', { d: 'M19 12H5M11 6l-6 6 6 6' })), 'All tools');
      const pane = h('section.ak-pane', { hidden: true, 'aria-label': def.title },
        h('header.ak-pane-head', back, h('span.ak-card-ic.sm', ICONS[key]()), h('h2', def.title)),
        h('div.ak-pane-body', built.el));
      stack.append(pane);
      return (panes[key] = { el: pane, api: built });
    }

    function openTool(key) {
      if (active) return;
      active = key;
      const p = getPane(key), card = cards[key];
      const from = card.getBoundingClientRect();
      p.el.hidden = false;
      p.api.show?.();
      const to = p.el.getBoundingClientRect();
      if (!reduced() && from.width && to.width) {
        const dx = from.left - to.left, dy = from.top - to.top, sx = from.width / to.width, sy = Math.max(0.05, from.height / to.height);
        p.el.animate([{ transformOrigin: '0 0', transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, opacity: 0.35 }, { transformOrigin: '0 0', transform: 'none', opacity: 1 }], { duration: 640, easing: EASE.expo });
        p.el.querySelectorAll('.ak-pane-head > *, .ak-pane-body').forEach((c, i) => c.animate([{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'none' }], { duration: 520, delay: 240 + i * 60, easing: EASE.expo, fill: 'backwards' }));
        launcher.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.96)' }], { duration: 260, easing: EASE.exit }).onfinish = () => { if (active) launcher.hidden = true; };
      } else launcher.hidden = true;
      root.scrollIntoView?.({ block: 'nearest' });
    }
    function closeTool() {
      if (!active) return;
      const p = panes[active], card = cards[active];
      active = null;
      launcher.hidden = false;
      if (!reduced() && card) {
        const to = card.getBoundingClientRect(), from = p.el.getBoundingClientRect();
        const dx = to.left - from.left, dy = to.top - from.top, sx = to.width / from.width, sy = Math.max(0.05, to.height / from.height);
        p.el.animate([{ transformOrigin: '0 0', transform: 'none', opacity: 1 }, { transformOrigin: '0 0', transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, opacity: 0 }], { duration: 420, easing: EASE.inOut, fill: 'forwards' }).onfinish = () => { p.el.hidden = true; };
        launcher.animate([{ opacity: 0, transform: 'scale(.97)' }, { opacity: 1, transform: 'none' }], { duration: 480, delay: 120, easing: EASE.expo, fill: 'backwards' });
      } else p.el.hidden = true;
    }
    el.addEventListener('keydown', (e) => { if (e.key === 'Escape' && active && !e.target.closest?.('textarea')) closeTool(); });

    /* ------------------------------------------------------------ gate on the verdict */
    function render() {
      const gate = S.verdict ? 'open' : 'locked';
      if (gate === mountedGate) return;
      mountedGate = gate;
      active = null;
      tiltOffs.splice(0).forEach((f) => f());
      Object.values(panes).forEach((p) => p.el.remove());
      for (const k of Object.keys(panes)) delete panes[k];
      if (gate === 'locked') { mount(root, lockedView()); stagger(root.firstChild.children, { y: 16, gap: 90, ms: 800 }); }
      else { mount(root, stack); launcher.hidden = false; buildLauncher(); }
    }
    offs.push(bus.on('verdict', render), bus.on('snapshot', render), bus.on('status', () => { if (mountedGate === 'locked') { mountedGate = null; render(); } }));
    render();

    return {
      show() { panes[active]?.api.show?.(); },
      hide() {},
      destroy() { dead = true; offs.forEach((f) => f()); tiltOffs.forEach((f) => f()); destroyers.forEach((f) => f()); },
    };
  },
};

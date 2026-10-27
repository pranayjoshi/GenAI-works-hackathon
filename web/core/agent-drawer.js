/* Agent drawer: a slide-in dossier for one simulated person.
 * Header (avatar + trait radar) / tabs: Profile, Receipts, Interview, Timeline (memories + actions per world).
 * Ported from legacy/app.js openAgent(); data comes from GET /api/runs/:id/agents/:agentId and
 * POST /api/runs/:id/interview. Styles live in css/insights.css (.dz-*). */
import { $, $$, h, s, mount, spin, num, avatar, actPill, reasonLines, roundTime } from './dom.js';
import { current } from './state.js';
import { api } from './api.js';
import { qidChip } from './ui.js';
import { reduced, EASE, typeText } from './motion.js';

const TRAITS = [
  ['price_sensitivity', 'Price sensitivity', 'Price'],
  ['skepticism', 'Ad skepticism', 'Skeptic'],
  ['susceptibility', 'Susceptibility', 'Persuadable'],
  ['speak_p', 'Speaks up (probability)', 'Speaks up'],
  ['activity', 'Activity', 'Activity'],
];
const TABS = [['profile', 'Profile'], ['receipts', 'Receipts'], ['interview', 'Interview'], ['timeline', 'Timeline']];
const SUGGESTED = ['Why did you scroll past?', 'What would have made you tap?', 'Did the price matter to you?', 'What did you not say out loud?'];

const clamp01 = (v) => (typeof v === 'number' && !Number.isNaN(v) ? Math.max(0, Math.min(1, v)) : 0);
const worldColor = (w) => { const v = String(w).split(':').pop().toLowerCase(); return v === 'a' || v === 'b' || v === 'c' ? `var(--${v})` : 'var(--accent)'; };
const anim = (el, frames, opts) => { if (!reduced() && el?.animate) el.animate(frames, opts); };

/* ---------------------------------------------------------------- radar chart */
function radar(p) {
  const cx = 130, cy = 112, R = 70, n = TRAITS.length;
  const ang = (i) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const pt = (i, k) => [cx + Math.cos(ang(i)) * R * k, cy + Math.sin(ang(i)) * R * k];
  const ring = (k) => TRAITS.map((_, i) => pt(i, k).map((v) => v.toFixed(1)).join(',')).join(' ');
  const vals = TRAITS.map(([k]) => clamp01(p[k]));
  const shape = s('polygon', { class: 'dz-radar-shape', points: vals.map((v, i) => pt(i, v).map((x) => x.toFixed(1)).join(',')).join(' ') });
  shape.style.transformOrigin = `${cx}px ${cy}px`;
  const dots = vals.map((v, i) => { const [x, y] = pt(i, v); return s('circle', { class: 'dz-radar-dot', cx: x.toFixed(1), cy: y.toFixed(1), r: 3.6 }, s('title', {}, `${TRAITS[i][1]}: ${num(p[TRAITS[i][0]])}`)); });
  const svg = s('svg', { class: 'dz-radar', viewBox: '0 0 260 224', role: 'img', 'aria-label': 'Trait radar: ' + TRAITS.map(([k, l]) => `${l} ${num(p[k])}`).join(', ') },
    [0.25, 0.5, 0.75, 1].map((k) => s('polygon', { class: 'dz-radar-ring', points: ring(k) })),
    TRAITS.map((_, i) => { const [x, y] = pt(i, 1); return s('line', { class: 'dz-radar-axis', x1: cx, y1: cy, x2: x.toFixed(1), y2: y.toFixed(1) }); }),
    shape, dots,
    TRAITS.map(([k, , short], i) => {
      const [x, y] = pt(i, 1.3), c = Math.cos(ang(i));
      const anchor = c > 0.3 ? 'start' : c < -0.3 ? 'end' : 'middle';
      return s('g', { class: 'dz-radar-label' }, s('text', { x: x.toFixed(1), y: y.toFixed(1), 'text-anchor': anchor }, short),
        s('text', { class: 'v', x: x.toFixed(1), y: (y + 12).toFixed(1), 'text-anchor': anchor }, p[k] == null ? '-' : num(p[k])));
    }));
  // grow from the centre once it is on screen
  anim(shape, [{ transform: 'scale(.05)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 1100, delay: 250, easing: EASE.expo, fill: 'backwards' });
  dots.forEach((d, i) => anim(d, [{ opacity: 0, transform: 'scale(0)' }, { opacity: 1, transform: 'none' }], { duration: 500, delay: 900 + i * 70, easing: 'cubic-bezier(0.34,1.4,0.64,1)', fill: 'backwards' }));
  return svg;
}

/* ---------------------------------------------------------------- open */
let drawerToken = 0;
export async function openAgent(agentId, opts = {}) {
  const drawer = $('#drawer'), body = $('#drawer-body');
  if (!drawer || !body) return;
  const runId = opts.runId || current.run?.id;
  const token = ++drawerToken;
  drawer.hidden = false; drawer.classList.add('dz'); drawer.scrollTop = 0;
  if (!runId) { mount(body, h('div.banner.bad', { style: { margin: '24px' } }, 'Open a run first: people only exist inside a run.')); return; }
  mount(body, h('div.dz-loading', spin(), ' Loading ', h('b', agentId), '...'));

  let data;
  try { data = await api(`/api/runs/${encodeURIComponent(runId)}/agents/${encodeURIComponent(agentId)}`); }
  catch (e) { if (token === drawerToken) mount(body, h('div.banner.bad', { style: { margin: '24px' } }, e.message)); return; }
  if (token !== drawerToken) return;

  const p = data.persona || { id: agentId };
  const worlds = data.worlds || {};
  const worldIds = Object.keys(worlds);
  const acted = worldIds.filter((w) => (worlds[w].actions || []).length);
  const seedPrefix = current.run?.S ? `s${current.run.S.seed}:` : '';
  let world = opts.world || acted.find((w) => w.startsWith(seedPrefix)) || acted[0] || worldIds[0];
  const history = {};            // world -> [{q, a, res, err}]
  let tab = 'profile';
  const show = { mem: true, act: true };

  /* ---- shared pieces */
  const worldSel = h('div.dz-worlds');
  const tlBox = h('div.dz-timeline');
  const chatLog = h('div.dz-chat');
  const input = h('input', { type: 'text', placeholder: 'Ask them why... (e.g. "Why did you scroll past?")', 'aria-label': 'Question for ' + p.id });
  const sendBtn = h('button.btn.primary', 'Ask');
  const wd = () => worlds[world] || { memories: [], actions: [] };

  function renderWorldPicker() {
    if (!worldIds.length) { mount(worldSel, h('span.muted', 'No worlds recorded for this person.')); return; }
    mount(worldSel, worldIds.map((w) => {
      const n = (worlds[w].actions || []).length;
      return h('button.dz-world' + (w === world ? '.on' : ''), { style: { '--wc': worldColor(w) }, onclick: () => { if (w === world) return; world = w; renderWorldPicker(); renderTimeline(); renderChat(false); } },
        h('i'), `World ${w}`, h('small', n ? `${n} action${n === 1 ? '' : 's'}` : 'did not see it'));
    }));
  }

  /* ---- timeline: memories and actions merged by round */
  function renderTimeline() {
    const d = wd();
    const items = [
      ...(show.mem ? (d.memories || []).map((m) => ({ kind: 'mem', hour: Number(m.hour) || 0, m })) : []),
      ...(show.act ? (d.actions || []).map((a) => ({ kind: 'act', hour: Number(a.hour) || 0, a })) : []),
    ].sort((x, y) => x.hour - y.hour);
    tlBox.style.setProperty('--wc', worldColor(world));
    if (!items.length) {
      mount(tlBox, h('div.dz-empty', (d.memories?.length || d.actions?.length) ? 'Everything is filtered out.' : 'Nothing recorded in this world: they never saw the post.'));
      return;
    }
    let lastHour = null;
    mount(tlBox, items.map((it, i) => {
      const head = it.hour !== lastHour ? h('div.dz-tl-hour', roundTime(it.hour)) : null;
      lastHour = it.hour;
      const style = { '--i': Math.min(i, 14) };
      if (it.kind === 'mem') return [head, h('div.dz-tl-item.dz-mem', { style, 'data-mem': it.m.id }, h('i.dz-tl-dot'), h('div.dz-tl-card', h('span.dz-tl-tag', 'memory'), it.m.text))];
      const a = it.a;
      return [head, h('div.dz-tl-item.dz-act', { style, 'data-action': a.id }, h('i.dz-tl-dot'),
        h('div.dz-tl-card', h('div.row', { style: { gap: '8px' } }, actPill(a.action), h('span.chip.mono', a.id)),
          a.text ? h('div.dz-tl-say', `"${a.text}"`) : null, reasonLines(a),
          a.unsaid ? h('div.unsaid', h('b', 'kept to themselves: '), a.unsaid) : null))];
    }).flat().filter(Boolean));
  }
  function focusTarget(sel) {
    setTab('timeline');
    requestAnimationFrame(() => {
      const el = $(sel, tlBox);
      if (!el) return;
      $$('.hl', tlBox).forEach((x) => x.classList.remove('hl'));
      el.classList.add('hl');
      el.scrollIntoView({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' });
      setTimeout(() => el.classList.remove('hl'), 3200);
    });
  }
  const focusAction = (id) => focusTarget(`[data-action="${CSS.escape(String(id))}"]`);
  function focusCitation(c) {
    if (c.action_id) return focusAction(c.action_id);
    const m = (wd().memories || []).find((x) => x.text === c.text);   // memory-only citation
    if (m) focusTarget(`[data-mem="${CSS.escape(String(m.id))}"]`);
  }

  /* ---- interview chat */
  const citeList = (res) => (res?.citations?.length ? h('div.dz-cites', res.citations.map((c) => h('button.dz-cite', { title: c.action_id ? 'Show the linked action in the timeline' : 'Show this memory in the timeline', onclick: () => focusCitation(c) },
    h('span.hr', roundTime(c.hour)), c.text, c.action_id ? h('span.chip.qid', `action ${c.action_id}`) : null))) : null);
  const bubbleMeta = (res) => [
    res?.saw_it === false ? h('div', h('span.chip.warn', "didn't see it")) : null,
    res?.invalid_citations?.length ? h('div', h('span.chip.bad', `Warning: ${res.invalid_citations.length} citation(s) did not match its memory (${res.invalid_citations.join(', ')})`)) : null,
    citeList(res),
    res?.served_by ? h('div.muted.dz-served', `served by ${res.served_by}`) : null,
  ];
  function turnNodes(t) {
    const out = [h('div.dz-msg.me', t.q)];
    if (t.err) out.push(h('div.banner.bad', t.err));
    else if (t.a != null && t.res) out.push(h('div.dz-msg.them', h('span.dz-say', t.a), bubbleMeta(t.res)));
    return out;
  }
  function renderChat(animate) {
    const log = history[world] || (history[world] = []);
    if (!log.length) { mount(chatLog, h('div.dz-chat-empty', h('b', 'Ask ' + p.id + ' why.'), h('span.muted', ' They answer only from their own memory and cite the exact action.'),
      h('div.chips', { style: { marginTop: '10px' } }, SUGGESTED.map((q) => h('button.chip', { onclick: () => { input.value = q; ask(); } }, q))))); return; }
    mount(chatLog, log.flatMap(turnNodes));
    if (animate) chatLog.lastElementChild && anim(chatLog.lastElementChild, [{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], { duration: 420, easing: EASE.expo });
    chatLog.lastElementChild?.scrollIntoView({ block: 'nearest' });
  }
  async function ask() {
    const q = input.value.trim();
    if (!q || sendBtn.disabled) return;
    const w = world;
    input.value = ''; sendBtn.disabled = true; input.disabled = true;
    const log = history[w] || (history[w] = []);
    const turn = { q, a: null };
    log.push(turn);
    if (w === world) {
      if (log.length === 1) mount(chatLog);
      const me = h('div.dz-msg.me', q); chatLog.append(me);
      anim(me, [{ opacity: 0, transform: 'translate(12px,8px) scale(.96)' }, { opacity: 1, transform: 'none' }], { duration: 380, easing: EASE.expo });
      var typing = h('div.dz-msg.them.dz-typing', h('i'), h('i'), h('i'));
      chatLog.append(typing); typing.scrollIntoView({ block: 'nearest' });
    }
    try {
      const res = await api(`/api/runs/${encodeURIComponent(runId)}/interview`, { method: 'POST', body: { world_id: w, agent_id: agentId, question: q, history: log.slice(0, -1).filter((x) => x.a).map((x) => ({ q: x.q, a: x.a })) } });
      turn.a = res.answer ?? ''; turn.res = res;
    } catch (e) { turn.err = e.message; }
    if (token === drawerToken && w === world) {
      typing?.remove();
      if (turn.err) renderChat(true);
      else {
        const say = h('span.dz-say'), bubble = h('div.dz-msg.them', say);
        chatLog.append(bubble); bubble.scrollIntoView({ block: 'nearest' });
        await typeText(say, turn.a, 110);
        bubble.append(...bubbleMeta(turn.res).filter(Boolean));
        anim(bubble.lastElementChild, [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 360, easing: EASE.expo });
        bubble.scrollIntoView({ block: 'nearest' });
      }
    }
    sendBtn.disabled = false; input.disabled = false; if (token === drawerToken) input.focus();
  }
  sendBtn.onclick = ask;
  input.onkeydown = (e) => { if (e.key === 'Enter') ask(); };

  /* ---- panels */
  const fact = (k, v) => h('div.dz-fact', h('span', k), h('b', v == null || v === '' ? '-' : v));
  const profile = h('div.dz-panel', { 'data-panel': 'profile' },
    h('div.dz-facts', fact('Age band', p.age_band), fact('Income', p.income_band), fact('Education', p.education), fact('Channel', p.channel),
      fact('Daily minutes', p.daily_minutes), fact('Influence', p.influence),
      fact('Customer', p.customer ? `${p.customer.visits_per_month} visits/mo, $${p.customer.avg_ticket}` : 'not a customer'), fact('Zip', p.zip), fact('Segment', p.segment)),
    h('div.dz-section', 'Traits'),
    TRAITS.map(([k, label], i) => h('div.dz-meter', h('div.row.spread', h('span.muted', label), h('b.mono', num(p[k]))),
      h('div.dz-bar', h('i', { style: { width: `${Math.round(clamp01(p[k]) * 100)}%`, '--d': `${300 + i * 90}ms` } })))));
  const receipts = h('div.dz-panel', { 'data-panel': 'receipts' },
    h('div.dz-section', 'Receipts', h('span.muted', ' where each number came from')),
    p.receipts?.length ? h('div.dz-receipts', p.receipts.map((r, i) => h('div.dz-receipt', { style: { '--i': i } },
      h('div.row.spread', h('b', r.field), r.query_id ? qidChip(r.query_id) : null), h('span.muted', r.source), r.ref ? h('div.dz-ref', r.ref) : null))) : h('div.dz-empty', 'No receipts stored.'));
  const interview = h('div.dz-panel', { 'data-panel': 'interview' }, chatLog,
    h('div.dz-ask', input, sendBtn));
  const timeline = h('div.dz-panel', { 'data-panel': 'timeline' },
    h('div.row.spread', h('div.dz-section', 'Memories and actions'), h('div.chips', [['mem', 'Memories'], ['act', 'Actions']].map(([k, l]) => {
      const b = h('button.chip.on', { 'aria-pressed': 'true', onclick: () => { show[k] = !show[k]; b.classList.toggle('on', show[k]); b.setAttribute('aria-pressed', String(show[k])); renderTimeline(); } }, l);
      return b;
    }))), tlBox);
  const panels = { profile, receipts, interview, timeline };

  /* ---- tabs with a sliding underline */
  const ink = h('span.dz-ink', { 'aria-hidden': 'true' });
  const tabBtns = {};
  const tabs = h('div.dz-tabs', { role: 'tablist' }, ink, TABS.map(([k, l]) => (tabBtns[k] = h('button.dz-tab', { role: 'tab', onclick: () => setTab(k), onkeydown: (e) => {
    const i = TABS.findIndex((t) => t[0] === tab), d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (d) { setTab(TABS[(i + d + TABS.length) % TABS.length][0]); tabBtns[tab].focus(); }
  } }, l))));
  const moveInk = () => { const b = tabBtns[tab]; if (b) { ink.style.transform = `translateX(${b.offsetLeft}px)`; ink.style.width = `${b.offsetWidth}px`; } };
  function setTab(k, first) {
    const prevIdx = TABS.findIndex((t) => t[0] === tab), nextIdx = TABS.findIndex((t) => t[0] === k);
    tab = k;
    for (const [id] of TABS) { tabBtns[id].classList.toggle('on', id === k); tabBtns[id].setAttribute('aria-selected', String(id === k)); panels[id].hidden = id !== k; }
    worldSel.hidden = !(k === 'interview' || k === 'timeline');
    moveInk();
    if (!first) {
      const dir = nextIdx > prevIdx ? 1 : -1;
      anim(panels[k], [{ opacity: 0, transform: `translateX(${dir * 22}px)` }, { opacity: 1, transform: 'none' }], { duration: 420, easing: EASE.expo });
      if (k === 'interview') input.focus({ preventScroll: true });
    }
  }

  /* ---- header: avatar, name, voice, radar */
  const av = avatar(p.id, '', () => {}); av.title = p.id; av.style.cursor = 'default';
  const actionTotal = worldIds.reduce((n, w) => n + (worlds[w].actions || []).length, 0);
  const head = h('div.dz-head',
    h('div.dz-hero',
      h('div.dz-avatar', h('span.dz-ring'), av),
      h('div.dz-id', h('h2', p.id), h('div.muted', [p.age != null ? `${p.age} years old` : null, p.role ? `${p.role} audience` : null, p.segment].filter(Boolean).join(', ')),
        h('div.chips', { style: { marginTop: '8px' } }, p.role ? h('span.chip' + (p.role === 'core' ? '.on' : ''), p.role) : null, h('span.chip', `${actionTotal} action${actionTotal === 1 ? '' : 's'}`), p.customer ? h('span.chip.good', 'customer') : null))),
    p.voice ? h('blockquote.dz-voice', `"${p.voice}"`) : null,
    radar(p));

  mount(body, h('div.dz-wrap', head, tabs, worldSel, h('div.dz-panels', profile, receipts, interview, timeline)));
  renderWorldPicker(); renderTimeline(); renderChat(false);
  setTab('profile', true);
  requestAnimationFrame(moveInk);
  if (!reduced()) {
    $$('.dz-fact', profile).forEach((el, i) => el.animate([{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], { duration: 520, delay: 200 + i * 40, easing: EASE.expo, fill: 'backwards' }));
    anim(head.querySelector('.dz-voice'), [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 700, delay: 150, easing: EASE.expo, fill: 'backwards' });
  }
}

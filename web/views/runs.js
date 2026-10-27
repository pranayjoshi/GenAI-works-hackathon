/* Runs gallery: tilt cards with generative twin glyphs, filters, grid / timeline modes,
 * and a zoom transition into the run. Data: GET /api/runs. Styles: css/library.css (lib-*). */
import { h, s, mount, hueOf } from '../core/dom.js';
import { api } from '../core/api.js';
import { tilt, stagger, reduced, EASE } from '../core/motion.js';

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

/** Shared-element feel: a panel grows from the card's rectangle to full screen, then the route changes underneath it. */
function zoomOpen(card, id) {
  const go = () => { location.hash = `#/run/${id}`; };
  if (reduced() || !card.animate) return go();
  const r = card.getBoundingClientRect();
  const glyph = card.querySelector('.lib-glyph')?.cloneNode(true);
  const gr = card.querySelector('.lib-glyph')?.getBoundingClientRect();
  const ov = h('div.lib-zoom', { style: { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` } });
  if (glyph && gr) {
    glyph.classList.add('lib-zoom-glyph');
    Object.assign(glyph.style, { left: `${gr.left - r.left}px`, top: `${gr.top - r.top}px`, width: `${gr.width}px`, height: `${gr.height}px` });
    ov.append(glyph);
    glyph.animate([{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(9)', opacity: 0 }], { duration: 520, easing: EASE.inOut, fill: 'forwards' });
  }
  document.body.append(ov);
  const full = { left: '0px', top: '0px', width: `${innerWidth}px`, height: `${innerHeight}px`, borderRadius: '0px' };
  const anim = ov.animate([{ left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, borderRadius: '16px' }, full], { duration: 480, easing: EASE.inOut, fill: 'forwards' });
  const fade = () => ov.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 380, fill: 'forwards' }).finished.then(() => ov.remove(), () => ov.remove());
  anim.finished.then(() => { go(); setTimeout(fade, 160); }, () => { go(); ov.remove(); });
  setTimeout(() => ov.remove(), 3000); // safety net if the animation never resolves
}

export default function view(el) {
  const state = { q: '', status: 'all', sort: 'new', mode: 'grid' };
  let runs = [], cleanups = [], dead = false, searchT = 0;
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
        (r.posts || []).map((v) => h('span.chip.' + String(v).toLowerCase(), `Version ${v}`))),
      (r.parent || follow) ? h('div.lib-chain',
        r.parent ? h('a.lib-chain-link', { href: `#/run/${r.parent}`, title: 'Open the run this one followed up', onclick: (e) => e.stopPropagation() }, `↳ follow-up of ${r.parent.slice(-4)}`) : null,
        follow ? h('span.lib-chain-link.out', `${follow} follow-up${follow > 1 ? 's' : ''}`) : null) : null,
      h('span.lib-glare', { 'aria-hidden': 'true' }));
    c.addEventListener('click', (e) => { if (e.target.closest('.lib-chain-link[href]')) return; zoomOpen(c, r.run_id); });
    c.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.closest('a')) { e.preventDefault(); zoomOpen(c, r.run_id); } });
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
    stagger(cards, { y: 26, gap: 45, ms: 750, scale: 0.97 });
  }

  const empty = () => mount(results, h('div.empty', ['No runs yet. ', h('a', { href: '#/' }, 'Start a new test.')]));
  el.append(h('div.view-page.lib-page',
    h('header.lib-hero', h('h1', 'Runs'), h('p.muted', 'Every Dry Run on this machine. Open one to replay its twin worlds, verdict and report.'),
      h('a.btn.primary', { href: '#/' }, 'New test')),
    h('div.lib-toolbar', search, statusSel, sortSel, h('div.lib-seg', { role: 'group', 'aria-label': 'Layout' }, modeBtns), count),
    results));
  mount(results, h('div.lib-grid', Array.from({ length: 6 }, () => h('div.card.lib-card.lib-skel'))));

  api('/api/runs').then((list) => {
    if (dead) return;
    runs = Array.isArray(list) ? list : [];
    for (const r of runs) if (r.parent) kids.set(r.parent, (kids.get(r.parent) || 0) + 1);
    runs.length ? render() : empty();
  }).catch((e) => { if (!dead) mount(results, h('div.banner.bad', e.message)); });

  return () => { dead = true; clearTimeout(searchT); cleanups.forEach((f) => f()); cleanups = []; };
}

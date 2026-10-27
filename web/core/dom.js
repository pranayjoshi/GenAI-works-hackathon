/* DOM helpers, formatters and the small shared renderers (avatar, action pill, reason lines).
 * Ported from legacy/app.js section 1. Every view imports from here. */
import { current } from './state.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** h('div.card#id', {onclick, title}, child, 'text', [children]) */
export function h(spec, attrs, ...kids) {
  const m = /^([a-z0-9]+)?((?:[.#][\w-]+)*)$/i.exec(spec) || [];
  const el = document.createElement(m[1] || 'div');
  for (const t of (m[2] || '').match(/[.#][\w-]+/g) || []) t[0] === '.' ? el.classList.add(t.slice(1)) : (el.id = t.slice(1));
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') v.split(' ').filter(Boolean).forEach((c) => el.classList.add(c));
    else if (k === 'style' && typeof v === 'object') { for (const [sk, sv] of Object.entries(v)) sk.startsWith('--') ? el.style.setProperty(sk, sv) : (el.style[sk] = sv); }
    else if (k === 'value') el.value = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  (function add(list) {
    for (const k of list) {
      if (k == null || k === false) continue;
      if (Array.isArray(k)) add(k);
      else el.append(k instanceof Node ? k : document.createTextNode(String(k)));
    }
  })(kids);
  return el;
}
export const svgNS = 'http://www.w3.org/2000/svg';
export function s(tag, attrs, ...kids) {
  const el = document.createElementNS(svgNS, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v != null) el.setAttribute(k, v);
  for (const k of kids.flat()) if (k != null) el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return el;
}
export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
export const mount = (el, ...kids) => { clear(el); kids.flat().forEach((k) => k != null && el.append(k instanceof Node ? k : document.createTextNode(String(k)))); return el; };

export const pct = (x, d = 1) => (x == null || Number.isNaN(x) ? '-' : `${(x * 100).toFixed(d)}%`);
export const num = (x, d = 2) => (x == null || Number.isNaN(x) ? '-' : Number(x).toFixed(d));
export const fmtInt = (x) => (x == null ? '-' : Number(x).toLocaleString());
export const hourStr = (hr) => `${String(hr).padStart(2, '0')}:00`;
/** Action records and memories store the round index in `hour`; turn it into a clock time for the current run. */
export function roundTime(r) {
  const sp = current.run?.S?.spec;
  if (!sp) return `round ${r + 1}`;
  const t = sp.startHour + r * sp.hourStep;
  return `D${Math.floor(t / 24) + 1} ${hourStr(t % 24)}`;
}
export const spin = () => h('span.spinner');
export const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

/** Stable hue per person. Sequential ids (p0001, p0002...) step by the golden angle so neighbours sit far apart. */
export function hueOf(id) {
  const n = /(\d+)\s*$/.exec(String(id));
  if (n) return Math.round((Number(n[1]) * 137.508 + 200) % 360);
  let x = 7; for (const c of String(id)) x = (x * 31 + c.charCodeAt(0)) % 360; return x;
}
export function avatar(id, size = '', onclick) {
  const n = String(id).replace(/^\D+/, '').replace(/^0+(?=\d)/, '') || id;
  return h('div.avatar' + (size ? '.' + size : ''), {
    style: { background: `linear-gradient(140deg, hsl(${hueOf(id)} 62% 52%), hsl(${(hueOf(id) + 40) % 360} 55% 36%))` }, title: `Open ${id}`,
    onclick: onclick || (() => current.openAgent?.(id)),
  }, `P${n}`);
}
export const ICONS = {
  like: 'M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z',
  comment: 'M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z',
  share: 'M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z',
  save: 'M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z',
  tap_through: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3',
  hide: 'M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24M1 1l22 22',
  scroll_past: 'M6 9l6 6 6-6',
};
export const ACTION_LABEL = { scroll_past: 'scrolled past', like: 'liked', comment: 'commented', share: 'shared', save: 'saved', tap_through: 'tapped through', hide: 'hid it' };
export function actPill(action) {
  return h('span.act.' + action, s('svg', { viewBox: '0 0 24 24' }, s('path', { d: ICONS[action] || ICONS.scroll_past })), ACTION_LABEL[action] || action);
}
export const CHECK_LABEL = {
  'reason:invented_price': 'invented price', 'reason:other_version_leak': 'detail from the other version', 'reason:false_repeat_claim': 'false "seen it before" claim',
  'reason:identity_trope': 'identity trope', 'reason:duplicate_in_batch': 'duplicate answer', 'text:brand_voice': 'comment sounded like the brand',
  'text:copied_reason': 'comment copied the private reason', 'coherence:positive_action_negative_feeling': 'like contradicted a negative feeling',
  'coherence:visit_with_strong_dislike': 'visit intent contradicted strong dislike', 'coherence:hide_positive_feeling': 'hide contradicted a positive feeling',
};
export const checkLabel = (c) => CHECK_LABEL[c] || c.replace(/^\w+:/, '').replace(/_/g, ' ');
/** The private-reason line, or the guard's explanation when it withheld the reason, plus "resolved" chips for coherence fixes. */
export function reasonLines(r) {
  const checks = r.checks || [];
  const out = [];
  const why = checks.filter((c) => c.startsWith('reason:'));
  if (r.reason) out.push(h('div.thought', `thought: ${r.reason}`));
  else if (why.length) out.push(h('div.thought', `reason withheld by the fact check (${why.map(checkLabel).join(', ')})`));
  const coh = checks.filter((c) => c.startsWith('coherence:'));
  if (coh.length) out.push(h('div.chips', { style: { marginTop: '4px' } }, coh.map((c) => h('span.chip', { title: 'The private feeling wins over the public action: the guard changed the logged action or intent to match how they actually felt.' }, `resolved: ${checkLabel(c)}`))));
  return out;
}
/** Display name of a variant: the poster's drafts are A and B; C is the agent's suggested rewrite. */
export const draftName = (v) => (String(v).toUpperCase() === 'C' ? 'Rewrite C' : `Draft ${v}`);
export const variantChip = (v) => h('span.chip.' + String(v || 'a').toLowerCase(), draftName(v));
export const vcolor = (v) => `var(--${String(v).toLowerCase()})`;
export const AGE_BANDS = ['18-24', '25-34', '35-44', '45-54', '55-64', '65+'];
export const INCOME_BANDS = ['<$25k', '$25-50k', '$50-75k', '$75-100k', '$100-150k', '$150k+'];
/** Read a CSS custom property as a concrete colour string (for canvas / three.js). */
export const cssVar = (name, el = document.documentElement) => getComputedStyle(el).getPropertyValue(name).trim();

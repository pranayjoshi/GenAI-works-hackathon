/* Motion helpers shared by every view. All respect prefers-reduced-motion (finished state = reduced state). */
export const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
export const EASE = { out: 'cubic-bezier(0.22, 1, 0.36, 1)', expo: 'cubic-bezier(0.16, 1, 0.3, 1)', inOut: 'cubic-bezier(0.76, 0, 0.24, 1)', exit: 'cubic-bezier(0.55, 0.055, 0.675, 0.19)' };

/** Animate a number in an element from its last value to `to`. fmt(x) formats each frame. */
export function countUp(el, to, fmt = (x) => Math.round(x).toLocaleString(), ms = 900) {
  if (to == null || Number.isNaN(to)) { el.textContent = fmt(to); return; }
  const from = el._cu ?? 0; el._cu = to;
  if (reduced() || from === to) { el.textContent = fmt(to); return; }
  cancelAnimationFrame(el._cuRaf);
  const t0 = performance.now();
  const tick = (t) => {
    const k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - k, 4);
    el.textContent = fmt(from + (to - from) * e);
    if (k < 1) el._cuRaf = requestAnimationFrame(tick);
  };
  el._cuRaf = requestAnimationFrame(tick);
}

/** Staggered entrance for children (or a list of elements). */
export function stagger(elsOrParent, { y = 18, gap = 60, ms = 700, delay = 0, scale = 1 } = {}) {
  const els = elsOrParent instanceof Element ? [...elsOrParent.children] : [...elsOrParent];
  if (reduced()) return;
  els.forEach((el, i) => el.animate(
    [{ opacity: 0, transform: `translateY(${y}px) scale(${scale})`, filter: 'blur(4px)' }, { opacity: 1, transform: 'none', filter: 'blur(0)' }],
    { duration: ms, delay: delay + i * gap, easing: EASE.expo, fill: 'backwards' }));
}

/** Reveal once when scrolled into view (adds .in to elements with .reveal). */
const io = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
}, { rootMargin: '0px 0px -8% 0px' }) : null;
export function reveal(el) { el.classList.add('reveal'); io ? io.observe(el) : el.classList.add('in'); return el; }

/** 3D tilt toward the pointer. Returns a cleanup. */
export function tilt(el, { max = 8, scale = 1.015, glare = true } = {}) {
  if (reduced() || matchMedia('(pointer: coarse)').matches) return () => {};
  el.style.transformStyle = 'preserve-3d';
  el.style.transition = 'transform 400ms cubic-bezier(0.22, 1, 0.36, 1)';
  const move = (e) => {
    const r = el.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
    el.style.transform = `perspective(900px) rotateX(${-y * max}deg) rotateY(${x * max}deg) scale(${scale})`;
    if (glare) { el.style.setProperty('--gx', `${(x + 0.5) * 100}%`); el.style.setProperty('--gy', `${(y + 0.5) * 100}%`); }
  };
  const leave = () => { el.style.transform = ''; };
  el.addEventListener('pointermove', move); el.addEventListener('pointerleave', leave);
  return () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerleave', leave); };
}

/** Pull an element slightly toward the pointer. */
export function magnetic(el, strength = 0.25) {
  if (reduced() || matchMedia('(pointer: coarse)').matches) return () => {};
  const move = (e) => { const r = el.getBoundingClientRect(); el.style.transform = `translate(${(e.clientX - r.left - r.width / 2) * strength}px, ${(e.clientY - r.top - r.height / 2) * strength}px)`; };
  const leave = () => { el.style.transform = ''; };
  el.addEventListener('pointermove', move); el.addEventListener('pointerleave', leave);
  return () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerleave', leave); };
}

/** Click ripple on every .btn (installed once in main.js). */
export function installRipples() {
  document.addEventListener('pointerdown', (e) => {
    const b = e.target.closest?.('.btn'); if (!b || b.disabled || reduced()) return;
    const r = b.getBoundingClientRect(), d = Math.max(r.width, r.height);
    const i = document.createElement('span'); i.className = 'ripple';
    Object.assign(i.style, { width: `${d}px`, height: `${d}px`, left: `${e.clientX - r.left - d / 2}px`, top: `${e.clientY - r.top - d / 2}px` });
    b.append(i); setTimeout(() => i.remove(), 650);
  });
}

/** Typewriter: reveal text char by char. Returns a promise. */
export function typeText(el, text, cps = 60) {
  if (reduced()) { el.textContent = text; return Promise.resolve(); }
  el.textContent = '';
  return new Promise((res) => {
    let i = 0; const step = () => { i = Math.min(text.length, i + Math.max(1, Math.round(cps / 30))); el.textContent = text.slice(0, i); if (i < text.length) setTimeout(step, 33); else res(); };
    step();
  });
}

/** Split a heading into masked words that rise in. */
export function riseWords(el, { gap = 45, delay = 0 } = {}) {
  const words = el.textContent.split(/(\s+)/);
  el.textContent = '';
  words.forEach((w, i) => {
    if (/^\s+$/.test(w)) { el.append(w); return; }
    const outer = document.createElement('span'); outer.style.cssText = 'display:inline-block;overflow:hidden;vertical-align:top;padding-bottom:.08em';
    const inner = document.createElement('span'); inner.style.display = 'inline-block'; inner.textContent = w;
    outer.append(inner); el.append(outer);
    if (!reduced()) inner.animate([{ transform: 'translateY(105%)' }, { transform: 'none' }], { duration: 900, delay: delay + i * gap, easing: EASE.expo, fill: 'backwards' });
  });
}

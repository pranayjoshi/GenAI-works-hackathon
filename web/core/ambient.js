/* Ambient background: a slow field of crowd "dots" in two colours (A and B), linked when close.
 * 2D canvas, ~60 points, pauses when the tab is hidden. setAmbientMood(level) brightens it during a live run. */
import { reduced } from './motion.js';
import { cssVar } from './dom.js';

let mood = 0.4;
export function setAmbientMood(level) { mood = Math.max(0, Math.min(1, level)); }

export function startAmbient(canvas) {
  const g = canvas.getContext('2d');
  let W = 0, H = 0, dpr = 1, pts = [];
  const N = window.innerWidth < 760 ? 28 : 64;
  const resize = () => {
    dpr = Math.min(2, window.devicePixelRatio || 1); W = window.innerWidth; H = window.innerHeight;
    canvas.width = W * dpr; canvas.height = H * dpr; g.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize(); window.addEventListener('resize', resize);
  for (let i = 0; i < N; i++) pts.push({ x: Math.random() * W, y: Math.random() * H, vx: (Math.random() - 0.5) * 0.18, vy: (Math.random() - 0.5) * 0.18, b: i % 2, r: 0.8 + Math.random() * 1.6 });
  let colA = cssVar('--a'), colB = cssVar('--b');
  new MutationObserver(() => { colA = cssVar('--a'); colB = cssVar('--b'); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  matchMedia('(prefers-color-scheme: light)').addEventListener?.('change', () => { colA = cssVar('--a'); colB = cssVar('--b'); });
  const mouse = { x: -999, y: -999 };
  window.addEventListener('pointermove', (e) => { mouse.x = e.clientX; mouse.y = e.clientY; }, { passive: true });
  function frame() {
    if (document.hidden) { setTimeout(() => requestAnimationFrame(frame), 400); return; }
    g.clearRect(0, 0, W, H);
    const speed = reduced() ? 0 : 0.5 + mood;
    for (const p of pts) {
      p.x += p.vx * speed; p.y += p.vy * speed;
      const dx = p.x - mouse.x, dy = p.y - mouse.y, d2 = dx * dx + dy * dy;
      if (d2 < 14000) { p.x += dx * 0.004; p.y += dy * 0.004; }
      if (p.x < -10) p.x = W + 10; if (p.x > W + 10) p.x = -10; if (p.y < -10) p.y = H + 10; if (p.y > H + 10) p.y = -10;
    }
    g.lineWidth = 1;
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
      const a = pts[i], b = pts[j], dx = a.x - b.x, dy = a.y - b.y, d = Math.hypot(dx, dy);
      if (d < 130) { g.strokeStyle = a.b ? colB : colA; g.globalAlpha = (1 - d / 130) * 0.09 * (0.6 + mood); g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); }
    }
    for (const p of pts) { g.globalAlpha = 0.25 + mood * 0.35; g.fillStyle = p.b ? colB : colA; g.beginPath(); g.arc(p.x, p.y, p.r, 0, 6.283); g.fill(); }
    g.globalAlpha = 1;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

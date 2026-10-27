/* Dry Run front end entry. Vanilla ES modules, no build step.
 * Routes lazy-load a view module whose default export is mount(viewEl, params) -> cleanup | void.
 * Route changes run inside the View Transitions API when the browser has it. */
import { $, $$, clear } from './core/dom.js';
import { refreshStatus, showStatusDetail } from './core/api.js';
import { closeModal, closeDrawer } from './core/ui.js';
import { installRipples } from './core/motion.js';
import { startAmbient } from './core/ambient.js';

const routes = [
  [/^#\/run\/([^/]+)(?:\/([a-z]+))?$/, () => import('./run/workspace.js'), 'runs', (m) => ({ id: decodeURIComponent(m[1]), stage: m[2] || null })],
  [/^#\/runs$/, () => import('./views/runs.js'), 'runs', () => ({})],
  [/^#\/backtest$/, () => import('./views/backtest.js'), 'backtest', () => ({})],
  [/^#?\/?$/, () => import('./views/setup.js'), 'setup', () => ({})],
];

let cleanup = null, curKey = null, curMod = null, navSeq = 0;

function moveInk() {
  const nav = $('.nav'), ink = $('.nav-ink', nav), a = $('a.active', nav);
  if (!a) { ink.style.width = '0'; return; }
  ink.style.width = `${a.offsetWidth}px`; ink.style.transform = `translateX(${a.offsetLeft - 4}px)`;
}

async function route() {
  const hash = location.hash || '#/';
  const hit = routes.find(([re]) => re.test(hash));
  if (!hit) { location.hash = '#/'; return; }
  const [re, load, nav, params] = hit;
  const p = params(re.exec(hash));
  // Same run, different stage: let the workspace switch stages in place.
  const key = nav === 'runs' && p.id ? `run:${p.id}` : hash;
  if (key === curKey && curMod?.onParams) { curMod.onParams(p); return; }
  const seq = ++navSeq;
  const mod = await load();
  if (seq !== navSeq) return;
  const swap = () => {
    if (cleanup) { try { cleanup(); } catch (e) { console.error(e); } cleanup = null; }
    closeDrawer(); closeModal();
    $$('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.nav === nav));
    moveInk();
    const view = $('#view'); clear(view); window.scrollTo(0, 0);
    curKey = key; curMod = mod;
    cleanup = mod.default(view, p) || null;
  };
  if (document.startViewTransition && curKey && !document.hidden) {
    const t = document.startViewTransition(swap);
    t.ready.catch(() => {}); t.finished.catch(() => {}); t.updateCallbackDone.catch(() => {});
  } else swap();
}

window.addEventListener('hashchange', route);
window.addEventListener('resize', moveInk);
if ('ResizeObserver' in window) new ResizeObserver(moveInk).observe($('.nav'));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeModal(); closeDrawer(); } });
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
$('.modal-close').addEventListener('click', closeModal);
$('.drawer-close').addEventListener('click', closeDrawer);
$('#status-pill').addEventListener('click', showStatusDetail);
$('#theme-btn').addEventListener('click', () => {
  const root = document.documentElement;
  const dark = root.dataset.theme ? root.dataset.theme === 'dark' : !matchMedia('(prefers-color-scheme: light)').matches;
  root.dataset.theme = dark ? 'light' : 'dark';
  try { localStorage.setItem('dryrun-theme', root.dataset.theme); } catch { /* private mode */ }
});
try { const t = localStorage.getItem('dryrun-theme'); if (t) document.documentElement.dataset.theme = t; } catch { /* private mode */ }

installRipples();
startAmbient($('#ambient'));
document.fonts?.ready.then(moveInk);
refreshStatus(); setInterval(refreshStatus, 30000);
route();

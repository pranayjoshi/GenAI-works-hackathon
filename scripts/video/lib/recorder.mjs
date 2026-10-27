// Records the real Ripple UI with Chromium's CDP screencast (high-quality JPEG frames with timestamps),
// a visible cursor with a click ripple, eased mouse moves and smooth scrolls. Markers let the edit trim
// each clip to its voiceover line. Output: media/rec/<name>/clip.mp4 (30 fps CFR) + markers.json.
import fs from 'node:fs';
import path from 'node:path';
import { MEDIA, playwright, ff, sleep } from './util.mjs';

const CURSOR_JS = `(() => {
  if (window.__cursor) return; window.__cursor = 1;
  const css = document.createElement('style');
  css.textContent = \`
  #__cur{position:fixed;left:0;top:0;width:30px;height:30px;z-index:2147483647;pointer-events:none;transform:translate(-100px,-100px);transition:opacity .2s}
  #__cur svg{filter:drop-shadow(0 2px 4px rgba(0,0,0,.55))}
  #__cur .halo{position:absolute;left:-15px;top:-15px;width:30px;height:30px;border-radius:50%;background:rgba(143,123,255,.28);box-shadow:0 0 0 1.5px rgba(185,173,255,.65)}
  .__rip{position:fixed;z-index:2147483646;pointer-events:none;width:16px;height:16px;margin:-8px 0 0 -8px;border-radius:50%;border:3px solid #b9adff;animation:__rip .65s cubic-bezier(.22,1,.36,1) forwards}
  @keyframes __rip{from{transform:scale(.4);opacity:1}to{transform:scale(4.2);opacity:0}}\`;
  const cur = document.createElement('div'); cur.id = '__cur';
  cur.innerHTML = '<div class="halo"></div><svg width="26" height="30" viewBox="0 0 26 30" style="position:absolute;left:-3px;top:-2px"><path d="M3 2l18 15.5-8.2.9 4.9 9.3-3.6 1.8-4.8-9.4L3 25.5z" fill="#fff" stroke="#11131c" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  const add = () => { if (!document.body) return requestAnimationFrame(add); document.documentElement.appendChild(css); document.body.appendChild(cur); };
  add();
  addEventListener('mousemove', (e) => { cur.style.transform = 'translate(' + e.clientX + 'px,' + e.clientY + 'px)'; }, true);
  addEventListener('mousedown', (e) => { const r = document.createElement('div'); r.className = '__rip'; r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px'; document.body.appendChild(r); setTimeout(() => r.remove(), 800); }, true);
  window.__hideCursor = (h) => { cur.style.opacity = h ? 0 : 1; };
})();`;

export async function startRecorder(name, { theme = 'dark', baseURL = 'http://localhost:8790/' } = {}) {
  const { chromium } = await playwright();
  const dir = path.join(MEDIA, 'rec', name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, 'frames'), { recursive: true });
  const browser = await chromium.launch({ args: ['--hide-scrollbars', '--font-render-hinting=none'] });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, colorScheme: theme, baseURL });
  await context.addInitScript(CURSOR_JS);
  await context.addInitScript(`try{localStorage.setItem('dryrun-theme','${theme}')}catch{}`);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const frames = []; let n = 0; let recording = true;
  cdp.on('Page.screencastFrame', async (f) => {
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
    if (!recording) return;
    const file = `f${String(++n).padStart(6, '0')}.jpg`;
    fs.writeFileSync(path.join(dir, 'frames', file), Buffer.from(f.data, 'base64'));
    frames.push({ file, t: f.metadata.timestamp ?? Date.now() / 1000 });
  });
  const markers = {};
  const texts = [];   // visible page text at each marker, grepped for credentials by check.mjs
  let pos = { x: 960, y: 600 };

  const r = {
    page, dir,
    async start(url) {
      await page.goto(url, { waitUntil: 'networkidle' }).catch(() => {});
      await page.mouse.move(pos.x, pos.y);
      await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
      markers.__t0 = Date.now() / 1000;
    },
    mark(label) { markers[label] = Date.now() / 1000; console.log(`  [${name}] mark ${label}`); texts.push(page.evaluate(() => document.body.innerText).then((t) => `### ${label}\n${t}`).catch(() => '')); },
    hold: (ms) => sleep(ms),
    /** eased mouse move to a point or the centre of a locator */
    async moveTo(target, { ms = 650, dx = 0, dy = 0 } = {}) {
      let to = target;
      if (typeof target?.boundingBox === 'function') {
        await target.scrollIntoViewIfNeeded({ timeout: 4000 }).catch(() => {});
        const b = await target.boundingBox({ timeout: 4000 }); if (!b) throw new Error('no box for target');
        to = { x: b.x + b.width / 2 + dx, y: b.y + b.height / 2 + dy };
      }
      const from = { ...pos }, steps = Math.max(8, Math.round(ms / 16));
      for (let i = 1; i <= steps; i++) {
        const k = i / steps, e = k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
        await page.mouse.move(from.x + (to.x - from.x) * e, from.y + (to.y - from.y) * e);
        await sleep(ms / steps * 0.6);
      }
      pos = to;
    },
    async click(target, opts = {}) {
      await r.moveTo(target, opts); await sleep(140);
      await page.mouse.down(); await sleep(70); await page.mouse.up(); await sleep(opts.after ?? 350);
    },
    async type(target, text, { delay = 28 } = {}) {
      await r.click(target, { after: 120 });
      await page.keyboard.type(text, { delay });
    },
    /** smooth window scroll by dy pixels (or to absolute y when abs=true) */
    async scroll(dy, { ms = 900, abs = false, el = null } = {}) {
      await page.evaluate(([dy, ms, abs, sel]) => new Promise((res) => {
        const box = sel ? document.querySelector(sel) : null;
        const get = () => box ? box.scrollTop : scrollY, set = (v) => box ? (box.scrollTop = v) : scrollTo(0, v);
        const y0 = get(), y1 = abs ? dy : y0 + dy, t0 = performance.now();
        const step = (t) => { const k = Math.min(1, (t - t0) / ms), e = k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; set(y0 + (y1 - y0) * e); k < 1 ? requestAnimationFrame(step) : res(); };
        requestAnimationFrame(step);
      }), [dy, ms, abs, el]);
      await sleep(120);
    },
    async scrollToEl(locator, { offset = 140, ms = 900 } = {}) {
      const y = await locator.evaluate((e, off) => e.getBoundingClientRect().top + scrollY - off, offset);
      await r.scroll(Math.max(0, y), { abs: true, ms });
    },
    async finish() {
      markers.__end = Date.now() / 1000;
      texts.push(page.evaluate(() => document.body.innerText).then((t) => `### end\n${t}`).catch(() => ''));
      fs.writeFileSync(path.join(dir, 'page-text.txt'), (await Promise.all(texts)).join('\n\n'));
      await sleep(300); recording = false;
      await cdp.send('Page.stopScreencast').catch(() => {});
      await browser.close();
      if (!frames.length) throw new Error(`${name}: no frames captured`);
      const t0 = frames[0].t;
      const lines = [];
      frames.forEach((f, i) => {
        const next = i + 1 < frames.length ? frames[i + 1].t : markers.__end;
        lines.push(`file 'frames/${f.file}'`, `duration ${Math.max(0.001, next - f.t).toFixed(4)}`);
      });
      lines.push(`file 'frames/${frames.at(-1).file}'`);
      fs.writeFileSync(path.join(dir, 'frames.txt'), lines.join('\n'));
      const rel = {}; for (const [k, v] of Object.entries(markers)) rel[k === '__t0' ? 'start0' : k === '__end' ? 'end' : k] = +(v - t0).toFixed(3);
      if (rel.start == null) rel.start = rel.start0;
      fs.writeFileSync(path.join(dir, 'markers.json'), JSON.stringify(rel, null, 2));
      ff(['-f', 'concat', '-safe', '0', '-i', path.join(dir, 'frames.txt'), '-vf', 'fps=30,format=yuv420p', '-c:v', 'libx264', '-preset', 'medium', '-crf', '15', path.join(dir, 'clip.mp4')]);
      fs.rmSync(path.join(dir, 'frames'), { recursive: true, force: true });
      console.log(`  [${name}] ${frames.length} frames -> ${path.join(dir, 'clip.mp4')}`, rel);
      return rel;
    },
  };
  return r;
}

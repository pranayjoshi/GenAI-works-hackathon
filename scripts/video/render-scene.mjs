// Render an HTML scene page frame by frame (deterministic: CSS animations are paused and seeked,
// and the page's optional window.seek(ms) drives scripted parts), then encode to a 30 fps MP4.
// Usage: node scripts/video/render-scene.mjs <scene> <seconds> [query]  -> media/scenes/<scene>.mp4
import fs from 'node:fs';
import path from 'node:path';
import { MEDIA, SCENES, playwright, ff } from './lib/util.mjs';

export async function renderScene(name, seconds, { query = '', out = path.join(MEDIA, 'scenes', `${name}.mp4`), fps = 30, browser } = {}) {
  const { chromium } = await playwright();
  const own = !browser;
  browser ||= await chromium.launch({ args: ['--font-render-hinting=none'] });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const url = `file://${path.join(SCENES, name + '.html')}?dur=${seconds}${query ? '&' + query : ''}`;
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  const dir = path.join(MEDIA, 'scenes', `${name}-frames`);
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const n = Math.round(seconds * fps);
  for (let i = 0; i < n; i++) {
    const t = (i / fps) * 1000;
    await page.evaluate((t) => {
      for (const a of document.getAnimations()) { a.pause(); a.currentTime = t; }
      window.seek?.(t);
    }, t);
    await page.screenshot({ path: path.join(dir, `f${String(i).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 93 });
  }
  await page.close();
  if (own) await browser.close();
  ff(['-framerate', String(fps), '-i', path.join(dir, 'f%05d.jpg'), '-c:v', 'libx264', '-preset', 'medium', '-crf', '14', '-pix_fmt', 'yuv420p', out]);
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`  scene ${name} ${seconds.toFixed(2)} s -> ${out}`);
  return out;
}

if (process.argv[1].endsWith('render-scene.mjs')) {
  const [name, secs, query] = process.argv.slice(2);
  await renderScene(name, Number(secs), { query });
}

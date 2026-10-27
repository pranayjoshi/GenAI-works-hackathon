// Verify the final cut and export review frames + thumbnail.
// Usage: node scripts/video/check.mjs  -> media/frames/*.png, media/ripple-demo-thumbnail.png, a pass/fail report
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, MEDIA, SCENES, playwright, probeDuration, ff } from './lib/util.mjs';

const final = path.join(MEDIA, 'ripple-demo.mp4');
const tl = JSON.parse(fs.readFileSync(path.join(MEDIA, 'build/timeline.json'), 'utf8'));
const problems = [];

// 1. duration window and streams
const dur = probeDuration(final);
const streams = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,width,height,r_frame_rate,sample_rate,duration', '-of', 'compact', final]).toString().trim();
console.log(`duration ${dur.toFixed(2)} s (${Math.floor(dur / 60)}:${String(Math.round(dur % 60)).padStart(2, '0')})\n${streams}`);
if (dur < 210 || dur > 240) problems.push(`duration ${dur.toFixed(1)} s is outside 3:30-4:00`);
const vDur = Number(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=duration', '-of', 'csv=p=0', final]).toString());
const aDur = Number(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=duration', '-of', 'csv=p=0', final]).toString());
if (Math.abs(vDur - aDur) > 0.1) problems.push(`audio ${aDur.toFixed(2)} s vs video ${vDur.toFixed(2)} s`);

// 2. black frames anywhere except the deliberate fade-in/out at the very ends
const bdErr = (() => { try { return execFileSync('sh', ['-c', `ffmpeg -hide_banner -i "${final}" -vf blackdetect=d=0.1:pic_th=0.97:pix_th=0.06 -an -f null - 2>&1 | grep black_start || true`]).toString(); } catch { return ''; } })();
for (const m of bdErr.matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)) {
  const a = Number(m[1]), b = Number(m[2]);
  if (a > 0.7 && b < dur - 1.3) problems.push(`black frames ${a.toFixed(2)}-${b.toFixed(2)} s`);
}

// 3. no credentials in anything rendered: scene pages, generated data, recorded pages' text
const pat = /nvapi-|Bearer |EAA[A-Za-z0-9]{10}|sk-[A-Za-z0-9]{20}/;
for (const dir of [SCENES, path.join(MEDIA, 'scenes')]) {
  for (const f of fs.readdirSync(dir).filter((f) => /\.(html|js|css|txt)$/.test(f))) if (pat.test(fs.readFileSync(path.join(dir, f), 'utf8'))) problems.push(`credential-like text in ${f}`);
}
for (const f of fs.readdirSync(path.join(MEDIA, 'rec'), { recursive: true }).filter((f) => f.endsWith('page-text.txt'))) {
  if (pat.test(fs.readFileSync(path.join(MEDIA, 'rec', f), 'utf8'))) problems.push(`credential-like text in recorded page ${f}`);
}

// 4. one review frame per segment, taken mid-segment
const frames = path.join(MEDIA, 'frames');
fs.rmSync(frames, { recursive: true, force: true }); fs.mkdirSync(frames, { recursive: true });
tl.forEach((s, i) => {
  const t = s.start + Math.min(s.D * 0.7, s.D - 0.6);
  ff(['-ss', t.toFixed(2), '-i', final, '-frames:v', '1', path.join(frames, `${String(i + 1).padStart(2, '0')}-${s.id}.png`)]);
});
console.log(`frames -> ${frames} (${tl.length})`);

// 5. thumbnail
const { chromium } = await playwright();
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
await p.goto(`file://${path.join(SCENES, 'thumbnail.html')}`, { waitUntil: 'networkidle' });
await p.evaluate(() => document.fonts.ready);
await p.screenshot({ path: path.join(MEDIA, 'ripple-demo-thumbnail.png') });
await b.close();

console.log(problems.length ? `\nPROBLEMS:\n - ${problems.join('\n - ')}` : '\nall checks passed');
process.exitCode = problems.length ? 1 : 0;
void ROOT;

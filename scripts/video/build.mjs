// Assemble the Ripple demo video from the timeline: voiceover, scenes, UI recordings, overlays, music.
// Usage: node scripts/video/build.mjs [--draft]   -> media/ripple-demo.mp4
// Inputs: media/vo/*.wav (scripts/video/vo.mjs), media/rec/<clip>/clip.mp4 + markers.json (rec-*.mjs).
// Scenes are re-rendered from scripts/video/scenes/*.html at exactly the length each line needs.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { SEGMENTS, TRANSITION, BADGES } from './timeline.mjs';
import { ROOT, MEDIA, SCENES, playwright, ff, probeDuration } from './lib/util.mjs';
import { renderScene } from './render-scene.mjs';

const T = TRANSITION;
const VO_DELAY = 0.35;          // voice starts a beat after the cut lands
const BUILD = path.join(MEDIA, 'build');
fs.mkdirSync(BUILD, { recursive: true });
fs.mkdirSync(path.join(MEDIA, 'scenes'), { recursive: true });

// real trace output for the proof scene (never hand-written)
const CMD = `python3 -c "import json;[print(r['agent_name'],'->',r.get('target_agent') or '','|',r['action'],r['status'],'|',r.get('served_by') or '') for r in map(json.loads,open('output_examples/hosted/example_1_live.trace.jsonl'))]"`;
const traceOut = execFileSync('sh', ['-c', CMD], { cwd: ROOT }).toString().split('\n').filter(Boolean);
fs.writeFileSync(path.join(MEDIA, 'scenes/proof-data.js'), `window.TRACE_CMD=${JSON.stringify(CMD)};window.TRACE_LINES=${JSON.stringify(traceOut)};`);

const durs = JSON.parse(fs.readFileSync(path.join(MEDIA, 'vo/durations.json'), 'utf8'));
const segs = SEGMENTS.filter((s) => !s.pending && durs[s.id] != null);
segs.forEach((s, i) => {
  s.D = +(VO_DELAY + durs[s.id] + (s.pad || 0)).toFixed(3);        // time this segment owns on the timeline
  s.L = +(s.D + (i < segs.length - 1 ? T : 0)).toFixed(3);         // video length incl. the overlap into the next
});
let acc = 0; for (const s of segs) { s.start = acc; acc += s.D; }
const total = acc;
console.log(`timeline ${total.toFixed(1)} s across ${segs.length} segments`);

const { chromium } = await playwright();
const browser = await chromium.launch({ args: ['--font-render-hinting=none'] });

async function overlayPng(s) {
  const o = s.overlay; if (!o) return null;
  const bl = [].concat(o.badge || []).flatMap((b) => (BADGES[b] ? [{ ...BADGES[b], kind: b }] : []));
  const sped = (s.src.ranges || []).some((r) => (r[2] || 1) > 1.01);
  const speeds = (s.src.ranges || []).map((r) => r[2] || 1).filter((x) => x > 1.01);
  const data = { act: o.act, title: o.title, live: o.live, saved: o.saved, chip: o.chip || (sped ? `sped up ${Math.max(...speeds)}×` : null), badges: bl };
  const out = path.join(BUILD, `ov_${s.id}.png`);
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto(`file://${path.join(SCENES, 'overlay.html')}?o=${encodeURIComponent(JSON.stringify(data))}`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: out, omitBackground: true });
  await page.close();
  return out;
}

function markerTime(clip, v) {
  if (typeof v === 'number') return v;
  const m = JSON.parse(fs.readFileSync(path.join(MEDIA, 'rec', clip, 'markers.json'), 'utf8'));
  const [, name, off] = String(v).match(/^([a-z_0-9]+)([+-][\d.]+)?$/) || [];
  if (m[name] == null) throw new Error(`${clip}: no marker ${v}`);
  return m[name] + Number(off || 0);
}

async function segVideo(s) {
  const out = path.join(BUILD, `seg_${s.id}.mp4`);
  let base;
  if (s.src.scene) {
    const q = s.src.query || '';
    const htmlPath = path.join(SCENES, s.src.scene + '.html');
    const key = crypto.createHash('md5').update([s.L, q, fs.readFileSync(htmlPath), fs.readFileSync(path.join(SCENES, 'base.css')), s.src.scene === 'proof' ? traceOut.join() : ''].join('|')).digest('hex').slice(0, 10);
    base = path.join(MEDIA, 'scenes', `${s.id}_${key}.mp4`);
    if (!fs.existsSync(base)) await renderScene(s.src.scene, s.L, { query: q, out: base, browser });
  } else if (s.src.clip) {
    const clipFile = path.join(MEDIA, 'rec', s.src.clip, 'clip.mp4');
    if (!fs.existsSync(clipFile)) {   // not recorded yet: a labelled placeholder so the cut still times out
      base = path.join(BUILD, `ph_${s.id}.mp4`);
      await renderScene('placeholder', s.L, { query: 'title=' + encodeURIComponent(`${s.overlay?.act || ''} · ${s.overlay?.title || s.id} (not recorded yet)`), out: base, browser });
    } else {
      const ranges = s.src.ranges || [[s.src.from ?? 'start', s.src.to ?? 'end', s.src.speed || 1]];
      const parts = ranges.map(([a, b, sp = 1], k) => `[0:v]trim=${markerTime(s.src.clip, a).toFixed(3)}:${markerTime(s.src.clip, b).toFixed(3)},setpts=(PTS-STARTPTS)/${sp}[p${k}]`);
      const cat = `${ranges.map((_, k) => `[p${k}]`).join('')}concat=n=${ranges.length}:v=1:a=0[c]`;
      base = path.join(BUILD, `cut_${s.id}.mp4`);
      ff(['-i', clipFile, '-filter_complex', `${parts.join(';')};${cat};[c]fps=30,tpad=stop_mode=clone:stop_duration=${s.L + 1},trim=0:${s.L},setpts=PTS-STARTPTS[v]`, '-map', '[v]', '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '15', '-pix_fmt', 'yuv420p', base]);
    }
  }
  const ov = await overlayPng(s);
  const norm = 'scale=1920:1080:flags=lanczos,setsar=1,fps=30,format=yuv420p';
  if (ov) {
    const fo = Math.max(0.6, s.L - T - 0.45);
    ff(['-i', base, '-loop', '1', '-t', String(s.L), '-i', ov, '-filter_complex',
      `[1:v]format=rgba,fade=in:st=0.45:d=0.45:alpha=1,fade=out:st=${fo.toFixed(2)}:d=0.4:alpha=1[o];[0:v][o]overlay=0:0:shortest=1,trim=0:${s.L},${norm}[v]`,
      '-map', '[v]', '-c:v', 'libx264', '-preset', 'medium', '-crf', '15', out]);
  } else {
    ff(['-i', base, '-vf', `trim=0:${s.L},${norm}`, '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '15', out]);
  }
  const got = probeDuration(out);
  if (Math.abs(got - s.L) > 0.08) console.warn(`  ! ${s.id}: video ${got.toFixed(2)} s vs wanted ${s.L.toFixed(2)} s`);
  console.log(`  seg ${s.id.padEnd(9)} ${s.L.toFixed(2)} s`);
  return out;
}

const files = [];
for (const s of segs) files.push(await segVideo(s));
await browser.close();

// ---- video: xfade chain
const xf = (a, b) => (a.src.scene && b.src.scene ? 'fade' : a.src.clip && b.src.clip && a.src.clip === b.src.clip ? 'fade' : 'smoothleft');
const inputs = files.flatMap((f) => ['-i', f]);
let chain = '', last = '[0:v]';
for (let i = 1; i < files.length; i++) {
  const off = (segs[i].start).toFixed(3);
  const lab = i === files.length - 1 ? '[vx]' : `[x${i}]`;
  chain += `${last}[${i}:v]xfade=transition=${xf(segs[i - 1], segs[i])}:duration=${T}:offset=${off}${lab};`;
  last = lab;
}
const videoOut = path.join(BUILD, 'video.mp4');
ff([...inputs, '-filter_complex', chain + '[vx]fade=in:st=0:d=0.6,fade=out:st=' + (total - 1.2).toFixed(2) + ':d=1.2[v]', '-map', '[v]', '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-r', '30', videoOut]);

// ---- audio: voice lines at their offsets, normalised; a soft synthesized pad underneath
const vo = segs.map((s) => path.join(MEDIA, 'vo', `${s.id}.wav`));
const vin = vo.flatMap((f) => ['-i', f]);
const vf = segs.map((s, i) => `[${i}:a]adelay=${Math.round((s.start + VO_DELAY) * 1000)}:all=1[a${i}]`).join(';');
const voiceOut = path.join(BUILD, 'voice.wav');
ff([...vin, '-filter_complex', `${vf};${segs.map((_, i) => `[a${i}]`).join('')}amix=inputs=${segs.length}:normalize=0:dropout_transition=0,apad=whole_dur=${total.toFixed(3)},atrim=0:${total.toFixed(3)},loudnorm=I=-16:TP=-1.5:LRA=11[a]`, '-map', '[a]', '-ar', '48000', voiceOut]);

const musicOut = path.join(BUILD, 'music.wav');
makeMusic(total, musicOut);
const mixOut = path.join(BUILD, 'mix.wav');
ff(['-i', voiceOut, '-i', musicOut, '-filter_complex', '[0:a][1:a]amix=inputs=2:normalize=0:duration=first,alimiter=limit=0.89[a]', '-map', '[a]', '-ar', '48000', mixOut]);

const final = path.join(MEDIA, 'ripple-demo.mp4');
ff(['-i', videoOut, '-i', mixOut, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-shortest', final]);
fs.writeFileSync(path.join(BUILD, 'timeline.json'), JSON.stringify(segs.map(({ id, start, D, L }) => ({ id, start: +start.toFixed(2), D, L })), null, 2));
console.log(`\n${final}  ${probeDuration(final).toFixed(2)} s`);

/** A gentle four-chord pad (Am7, Fmaj7, Cmaj7, G6), sine partials with slow swells, lowpassed and echoed, at about -28 LUFS. */
function makeMusic(len, out) {
  const chords = [[220, 261.63, 329.63, 392], [174.61, 220, 261.63, 329.63], [130.81, 196, 246.94, 329.63], [196, 246.94, 293.66, 329.63]];
  const parts = chords.map((c, i) => {
    const f = path.join(BUILD, `pad${i}.wav`);
    const expr = c.map((hz, k) => `${(0.16 / (k + 1)).toFixed(3)}*sin(2*PI*${hz}*t)+${(0.05 / (k + 1)).toFixed(3)}*sin(2*PI*${hz * 2}*t)`).join('+');
    ff(['-f', 'lavfi', '-i', `aevalsrc='(${expr})*(0.75+0.25*sin(2*PI*0.18*t))*min(1,t/2.5)*min(1,(8.5-t)/2.5)':s=48000:d=8.5`, '-ac', '2', f]);
    return f;
  });
  const loopLen = 4 * 8;
  const loops = Math.ceil(len / loopLen) + 1;
  const list = path.join(BUILD, 'pad.txt');
  fs.writeFileSync(list, Array.from({ length: loops }, () => parts.map((p) => `file '${p}'\ninpoint 0\noutpoint 8`).join('\n')).join('\n'));
  ff(['-f', 'concat', '-safe', '0', '-i', list, '-af', `lowpass=f=1400,aecho=0.8:0.7:120|260:0.25|0.18,atrim=0:${len.toFixed(3)},afade=in:st=0:d=3,afade=out:st=${(len - 4).toFixed(2)}:d=4,loudnorm=I=-28:TP=-6`, '-ar', '48000', out]);
}

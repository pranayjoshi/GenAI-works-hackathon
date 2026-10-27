// Render the voiceover: one WAV per segment with macOS `say`, durations measured with ffprobe.
// Usage: node scripts/video/vo.mjs [--phase1]   -> media/vo/<id>.wav, media/vo/durations.json, docs/pitch/VOICEOVER.md
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { SEGMENTS, VOICE, RATE } from './timeline.mjs';
import { ROOT, MEDIA, probeDuration } from './lib/util.mjs';

const out = path.join(MEDIA, 'vo');
fs.mkdirSync(out, { recursive: true });
const durations = {};
for (const s of SEGMENTS.filter((x) => !x.pending)) {
  const aiff = path.join(out, `${s.id}.aiff`), wav = path.join(out, `${s.id}.wav`);
  execFileSync('say', ['-v', VOICE, '-r', String(RATE), '-o', aiff, s.say || s.vo]);
  // mono 48 kHz, gentle high-pass and a touch of compression so the synthetic voice sits forward
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', aiff, '-af', 'highpass=f=80,acompressor=threshold=-20dB:ratio=2.5:attack=5:release=80,aresample=48000', '-ac', '1', wav]);
  durations[s.id] = probeDuration(wav);
  console.log(`${s.id.padEnd(9)} ${durations[s.id].toFixed(2)} s`);
}
fs.writeFileSync(path.join(out, 'durations.json'), JSON.stringify(durations, null, 2));
const LIVE = SEGMENTS.filter((x) => !x.pending);
const total = LIVE.reduce((a, s) => a + durations[s.id] + (s.pad || 0), 0);
console.log(`voice + pads: ${total.toFixed(1)} s`);

// docs/pitch/VOICEOVER.md, generated from the timeline so the script and the video never drift
const act = (s) => s.overlay?.act || ({ intro1: 'Story', intro2: 'Story', intro3: 'Story', logo: 'Title', impact: 'Impact', cast: 'Cast', close: 'Close' }[s.id] || '');
let t = 0;
const rows = LIVE.map((s) => { const r = `| ${fmt(t)} | ${act(s)} | ${s.overlay?.title || s.id} | ${s.vo.replace(/\|/g, '\\|')} |`; t += durations[s.id] + (s.pad || 0); return r; });
function fmt(x) { const m = Math.floor(x / 60), sec = Math.floor(x % 60); return `${m}:${String(sec).padStart(2, '0')}`; }
const md = `# Ripple demo video: voiceover script

Generated from \`scripts/video/timeline.mjs\` by \`node scripts/video/vo.mjs\`. Voice: macOS \`say -v ${VOICE} -r ${RATE}\`.
Numbers are the claim-checked ones from [DEMO_PLAN.md](DEMO_PLAN.md). Start times are approximate (before cross-fades).

| Start | Act | On screen | Voiceover |
|---|---|---|---|
${rows.join('\n')}

Total voice plus pauses: about ${Math.round(total)} s. The final cut adds cross-fades and is checked to run 3:30 to 4:00.

On-screen honesty rules: every shot of the app is the real app; shots of the saved runs (\`20261027-south-congress-coffe-e52a\`, 600 people on Nemotron 3 Nano 4B, and \`20261027-south-congress-coffe-344c\`, Version C vs A on Lightning via Nightshift) carry a "saved run" corner label; live shots carry a "live" label; sped-up footage carries a "sped up" chip; nothing shows a credential.
`;
fs.writeFileSync(path.join(ROOT, 'docs/pitch/VOICEOVER.md'), md);

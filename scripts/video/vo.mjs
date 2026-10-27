// Render the voiceover: one WAV per segment, durations measured with ffprobe.
// Backend per line: ElevenLabs when ELEVENLABS_API_KEY (read from .env at runtime, never printed) works,
// else macOS `say`. ElevenLabs audio is cached by sha256(text + voice + model) so re-renders spend no credits.
// Usage: node scripts/video/vo.mjs   -> media/vo/<id>.wav, durations.json, backends.json, docs/pitch/VOICEOVER.md
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { SEGMENTS, VOICE, RATE, ELEVEN } from './timeline.mjs';
import { ROOT, MEDIA, probeDuration } from './lib/util.mjs';

const out = path.join(MEDIA, 'vo');
const cache = path.join(out, 'cache');
fs.mkdirSync(cache, { recursive: true });
const LIVE = SEGMENTS.filter((x) => !x.pending);

/** The key stays in this process: read from the environment or the repo's .env, never logged. */
function elevenKey() {
  if (process.env.ELEVENLABS_API_KEY) return process.env.ELEVENLABS_API_KEY.trim();
  try {
    const m = fs.readFileSync(path.join(ROOT, '.env'), 'utf8').match(/^\s*ELEVENLABS_API_KEY\s*=\s*(.*)$/m);
    return m ? m[1].trim().replace(/^['"]|['"]$/g, '') : '';
  } catch { return ''; }
}
const KEY = elevenKey();

// The SDK reads ELEVENLABS_API_KEY from the environment (make.sh runs this with node --env-file=.env).
if (KEY && !process.env.ELEVENLABS_API_KEY) process.env.ELEVENLABS_API_KEY = KEY;
const client = KEY ? new ElevenLabsClient({ timeoutInSeconds: 30 }) : null;

/** ELEVEN.voiceId if set; otherwise the first preferred premade voice the account has. */
async function resolveVoice() {
  if (!KEY) return null;
  if (ELEVEN.voiceId) return { id: ELEVEN.voiceId, name: ELEVEN.voiceName || ELEVEN.voiceId };
  try {
    const { voices = [] } = await client.voices.getAll();
    for (const want of ELEVEN.prefer) {
      const v = voices.find((x) => x.name?.toLowerCase().startsWith(want.toLowerCase()) && (x.category || 'premade') === 'premade');
      if (v) return { id: v.voiceId, name: v.name };
    }
    console.log('note: none of the preferred ElevenLabs voices found; using macOS say'); return null;
  } catch (e) { console.log(`note: ElevenLabs voices failed (${e.statusCode ?? e.name}); using macOS say`); return null; }
}

/** text for ElevenLabs: the spoken (`say`) text with say's pause commands turned into break tags */
const elText = (s) => (s.say || s.vo).replace(/\[\[slnc (\d+)\]\]/g, (_, ms) => `<break time="${(Number(ms) / 1000).toFixed(1)}s" />`);

async function elevenLine(s, voice) {
  const text = elText(s);
  const key = crypto.createHash('sha256').update([text, voice.id, ELEVEN.model, JSON.stringify(ELEVEN.settings)].join('\u0000')).digest('hex').slice(0, 24);
  const mp3 = path.join(cache, `${key}.mp3`);
  if (fs.existsSync(mp3)) return mp3;
  try {
    const st = ELEVEN.settings;
    const audio = await client.textToSpeech.convert(voice.id, {
      text, modelId: ELEVEN.model, outputFormat: 'mp3_44100_128',
      voiceSettings: { stability: st.stability, similarityBoost: st.similarity_boost, style: st.style, useSpeakerBoost: st.use_speaker_boost, speed: st.speed },
    });
    const chunks = [];
    for await (const c of Readable.fromWeb(audio)) chunks.push(c);
    fs.writeFileSync(mp3, Buffer.concat(chunks));
    return mp3;
  } catch (e) { console.log(`note: ElevenLabs failed for ${s.id} (${e.statusCode ?? e.name}); using macOS say for this line`); return null; }
}

const chars = LIVE.reduce((a, s) => a + elText(s).length, 0);
console.log(`voiceover text: ${chars} characters${chars > 3500 ? ' (over the 3,500 budget)' : ''}`);
const voice = await resolveVoice();
if (voice) console.log(`ElevenLabs voice: ${voice.name}`);

const durations = {}, backends = {};
// mono 48 kHz, gentle high-pass and a touch of compression so the voice sits forward
const polish = (src, wav) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-af', 'highpass=f=80,acompressor=threshold=-20dB:ratio=2.5:attack=5:release=80,aresample=48000', '-ac', '1', wav]);
for (const s of LIVE) {
  const wav = path.join(out, `${s.id}.wav`);
  const mp3 = voice ? await elevenLine(s, voice) : null;
  if (mp3) { polish(mp3, wav); backends[s.id] = `elevenlabs:${voice.name}`; }
  else {
    const aiff = path.join(out, `${s.id}.aiff`);
    execFileSync('say', ['-v', VOICE, '-r', String(RATE), '-o', aiff, s.say || s.vo]);
    polish(aiff, wav); backends[s.id] = `say:${VOICE}`;
  }
  durations[s.id] = probeDuration(wav);
  console.log(`${s.id.padEnd(9)} ${durations[s.id].toFixed(2)} s  ${backends[s.id]}`);
}
fs.writeFileSync(path.join(out, 'durations.json'), JSON.stringify(durations, null, 2));
fs.writeFileSync(path.join(out, 'backends.json'), JSON.stringify(backends, null, 2));
const total = LIVE.reduce((a, s) => a + durations[s.id] + (s.pad || 0), 0);
console.log(`voice + pads: ${total.toFixed(1)} s`);

// docs/pitch/VOICEOVER.md, generated from the timeline so the script and the video never drift
const usedEleven = Object.values(backends).some((b) => b.startsWith('elevenlabs'));
const voiceLine = usedEleven ? `ElevenLabs (${voice.name}, \`${ELEVEN.model}\`), falling back to macOS \`say -v ${VOICE}\` per line` : `macOS \`say -v ${VOICE} -r ${RATE}\``;
const act = (s) => s.overlay?.act || ({ intro1: 'Story', intro2: 'Story', intro3: 'Story', logo: 'Title', impact: 'Impact', cast: 'Cast', close: 'Close' }[s.id] || '');
let t = 0;
const rows = LIVE.map((s) => { const r = `| ${fmt(t)} | ${act(s)} | ${s.overlay?.title || s.id} | ${s.vo.replace(/\|/g, '\\|')} |`; t += durations[s.id] + (s.pad || 0); return r; });
function fmt(x) { const m = Math.floor(x / 60), sec = Math.floor(x % 60); return `${m}:${String(sec).padStart(2, '0')}`; }
const md = `# Ripple demo video: voiceover script

Generated from \`scripts/video/timeline.mjs\` by \`node scripts/video/vo.mjs\`. Voice: ${voiceLine}.
Numbers are the claim-checked figures of the copy-only demo run \`20261027-south-congress-coffe-1458\` (600 people, 2 seeds, 12 rounds, Nemotron 3.5 Lightning via Nightshift, audience queries on Zetaris). Start times are approximate.

| Start | Act | On screen | Voiceover |
|---|---|---|---|
${rows.join('\n')}

Total voice plus pauses: about ${Math.round(total)} s (${chars} characters). The final cut adds cross-fades and is checked to run 3:30 to 4:00.

On-screen honesty rules: every shot of the app is the real app; shots of the saved run \`20261027-south-congress-coffe-1458\` carry a "saved run" corner label; live shots carry a "live" label; sped-up footage carries a "sped up" chip; nothing shows a credential.
`;
fs.writeFileSync(path.join(ROOT, 'docs/pitch/VOICEOVER.md'), md);

/**
 * Post-sensitivity probe: do the same people react differently to post A and post B?
 * Takes personas from a finished run, shows each batch post A and then post B (first exposure, no memories,
 * identical batches), and compares intent, feeling and engagement. Run with CROWD_PROMPT=v1 or v2.
 * Usage: npx tsx scripts/probe-sensitivity.ts --run <run_id> --n 36 --reps 1
 */
import { loadRun } from '../src/sim/run.js';
import { decideBatch, type AgentTurn } from '../src/sim/crowd.js';
import { config } from '../src/config.js';
import { CAFE_DEMO } from '../src/demo.js';

const args = process.argv.slice(2);
const flag = (k: string, d?: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const st = await loadRun(flag('run')!);
if (!st) throw new Error('run not found');
const n = Number(flag('n', '36')), reps = Number(flag('reps', '1'));
const variant = (flag('prompt', config.crowdPrompt) as 'v1' | 'v2');
const people = st.personas.filter((_, i) => i % Math.max(1, Math.floor(st.personas.length / n)) === 0).slice(0, n);
const posts = [{ variant: 'A', text: flag('a', CAFE_DEMO.postA)!, business: st.spec.business, handle: st.spec.handle }, { variant: 'B', text: flag('b', CAFE_DEMO.postB)!, business: st.spec.business, handle: st.spec.handle }];
const out: Record<string, { visit: number; feel: number; engaged: number; n: number; missing: number }> = {};
const t0 = Date.now();
const diffs: number[] = [];
for (let rep = 0; rep < reps; rep++) {
  for (let i = 0; i < people.length; i += 6) {
    const batch = people.slice(i, i + 6);
    const res: Record<string, Map<string, any>> = {};
    for (const post of posts) {
      const turns: AgentTurn[] = batch.map((p) => ({ persona: p, items: [{ item_id: 'ad', kind: 'ad', delivered_round: 0, via: null }], memories: [], seenBefore: 0 }));
      const r = await decideBatch(turns, { post, place: st.spec.place, hourLabel: 'Day 1 20:00', worldNote: 'The post just started running.', topComments: () => [], eventText: () => '', mode: 'ab' }, `probe:${variant}`, variant);
      res[post.variant] = r.decisions;
      const o = (out[post.variant] ??= { visit: 0, feel: 0, engaged: 0, n: 0, missing: 0 });
      for (const p of batch) {
        const d = r.decisions.get(`${p.id}/ad`);
        if (!d) { o.missing++; continue; }
        o.n++; o.visit += d.would_visit ? 1 : 0; o.feel += d.feeling; o.engaged += d.action !== 'scroll_past' && d.action !== 'hide' ? 1 : 0;
      }
    }
    for (const p of batch) { const a = res.A.get(`${p.id}/ad`), b = res.B.get(`${p.id}/ad`); if (a && b) diffs.push(Math.abs(a.feeling - b.feeling) + (a.would_visit !== b.would_visit ? 1 : 0) + (a.action !== b.action ? 1 : 0)); }
    process.stdout.write('.');
  }
}
console.log(`\nprompt ${variant}, ${people.length} people x ${reps} reps, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
for (const [v, o] of Object.entries(out)) console.log(`  ${v}: n=${o.n} missing=${o.missing} visit=${(o.visit / o.n * 100).toFixed(1)}% meanFeeling=${(o.feel / o.n).toFixed(2)} engaged=${(o.engaged / o.n * 100).toFixed(1)}%`);
console.log(`  per-person change A vs B (feeling diff + visit flip + action flip), mean: ${(diffs.reduce((a, b) => a + b, 0) / diffs.length).toFixed(2)}; share of people with any change: ${(diffs.filter((d) => d > 0).length / diffs.length * 100).toFixed(0)}%`);
process.exit(0);

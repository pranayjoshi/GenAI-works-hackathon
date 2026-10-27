/** CLI: run a reaction simulation (two drafts in counterfactual worlds) end to end. Example: npm run run:ab -- --crowd 120 --rounds 12 --seeds 1 */
import { startRun, type RunInput } from '../src/sim/run.js';
import { CAFE_DEMO } from '../src/demo.js';

const args = process.argv.slice(2);
const flag = (k: string, d?: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const input: RunInput = {
  ...CAFE_DEMO,
  crowdSize: Number(flag('crowd', '120')),
  rounds: Number(flag('rounds', '12')),
  seeds: Number(flag('seeds', '1')),
  // --event "7|Bean There across the street just posted 30% off all lattes today"
  events: args.flatMap((a, i) => (a === '--event' ? [args[i + 1]] : [])).map((e) => { const [r, ...t] = e.split('|'); return { round: Number(r), text: t.join('|'), target: 'all' as const }; }),
};
const t0 = Date.now();
const st = startRun(input);
let actions = 0;
st.bus.on((e) => {
  if (e.type === 'status') console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${e.phase}: ${e.detail ?? ''}`);
  if (e.type === 'action') { actions++; if (e.record.text && Math.random() < 0.3) console.log(`   ${e.world_id} ${e.record.agent_id} ${e.record.action}: "${e.record.text}"`); }
  if (e.type === 'round') console.log(`   ${e.world_id} ${e.counters.hour_label} deciders=${e.counters.deciders} intent=${e.counters.intent} calls=${e.counters.calls}`);
  if (e.type === 'error') { console.error('ERROR', e.message); process.exit(1); }
  if (e.type === 'done') {
    console.log('\nVERDICT:', st.verdict?.headline);
    console.log('validity:', JSON.stringify(st.validity));
    console.log('fairness:', JSON.stringify(st.fairness));
    console.log('usage:', JSON.stringify(st.usage));
    console.log(`run ${st.spec.run_id}: ${actions} decisions in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    process.exit(0);
  }
});

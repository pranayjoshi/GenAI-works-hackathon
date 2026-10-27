/** Build (or rebuild) the spend gate and action plan for a finished run. Usage: npx tsx scripts/decide.ts <run_id> [--no-draft] [--keep-variant] */
import { buildDecision, writeLaunchPlan } from '../src/report/decision.js';
import { loadRun, persist, runDir } from '../src/sim/run.js';

const id = process.argv[2];
const st = await loadRun(id);
if (!st?.verdict) { console.error(`${id}: no finished run`); process.exit(1); }
st.decision = await buildDecision(st, { draft: !process.argv.includes('--no-draft'), keepVariant: process.argv.includes('--keep-variant') });
persist(st);
console.log(`wrote ${writeLaunchPlan(runDir(id), st.decision)}`);
console.log(JSON.stringify({ headline: st.decision.headline, reasons: st.decision.reasons, sample_size: st.decision.sample_size, affordable: st.decision.affordable, variant: st.decision.variant, actions: st.decision.actions.map((a) => `${a.policy}/${a.status}: ${a.title} | ${a.detail}`) }, null, 2));
process.exit(0);

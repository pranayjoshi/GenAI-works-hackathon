/** Recompute the stored verdict headline, report wording and decision of finished runs from their saved summaries. No model calls.
 * Usage: npx tsx scripts/rebuild-decisions.ts <run_id> [...]   (a run with a parent_run is rebuilt as a verification and linked back) */
import { verdict } from '../src/sim/metrics.js';
import { buildDecision, writeLaunchPlan, recordVerification } from '../src/report/decision.js';
import { loadRun, persist, runDir } from '../src/sim/run.js';

for (const id of process.argv.slice(2)) {
  const st = await loadRun(id);
  if (!st?.verdict || !st.summaries?.length) { console.log(`${id}: no finished run`); continue; }
  const old = st.verdict.headline;
  const vs = st.verdict.variants;
  st.verdict = verdict(st.summaries, vs, st.verdict.metric, st.verdict.metric === 'tap_rate' ? 'click-through' : 'intent to visit');
  const rep = (st.report as any)?.report;
  if (rep) {
    if (rep.summary?.trim() === old.trim()) rep.summary = st.verdict.headline;
    if (/too close to call|test a sharper version C/i.test(rep.recommendation ?? '')) rep.recommendation = `Launch version ${st.verdict.leader}, then try a sharper version C on the same crowd aimed at the segments that preferred the other one.`;
  }
  st.decision = await buildDecision(st, { draft: false, keepVariant: true });
  persist(st);
  writeLaunchPlan(runDir(id), st.decision);
  if (st.spec.parent_run) {
    const parent = await loadRun(st.spec.parent_run);
    if (parent?.decision) { recordVerification(parent, st); persist(parent); writeLaunchPlan(runDir(parent.spec.run_id), parent.decision); console.log(`  parent ${parent.spec.run_id}: ${parent.decision.actions.find((a) => a.kind === 'simulate_variant')?.result ? (parent.decision.actions.find((a) => a.kind === 'simulate_variant')!.result as any).headline : ''}`); }
  }
  console.log(`${id}\n  verdict:  ${st.verdict.headline}\n  decision: ${st.decision.headline}`);
}
process.exit(0);

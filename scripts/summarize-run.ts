/** Rewrite config.json and summary.json for finished runs from their actions.sqlite. Usage: npx tsx scripts/summarize-run.ts [run_id ...] */
import { listRunsOnDisk, loadRun, persist } from '../src/sim/run.js';

const ids = process.argv.slice(2);
const targets = ids.length ? ids : listRunsOnDisk();
for (const id of targets) {
  const st = await loadRun(String(id));
  if (!st) { console.log(`${id}: not found`); continue; }
  persist(st);
  console.log(`${id}: ${st.status} ${st.verdict ? (st.verdict as any).headline : '(no verdict)'}`);
}

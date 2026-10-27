/** Rebuild the report for a finished run (after a report-agent change). Usage: npx tsx scripts/rebuild-report.ts <run_id> */
import { buildReport } from '../src/report/agent.js';
import { exportForFederation, loadRun, persist } from '../src/sim/run.js';
import { ensureCensus, registerSources, US_GEO } from '../src/data/sources.js';

const id = process.argv[2];
const st = await loadRun(id);
if (!st?.verdict) { console.error(`${id}: no finished run`); process.exit(1); }
await registerSources();
await ensureCensus([st.spec.geoId, US_GEO]);
await exportForFederation(st);
st.report = await buildReport(st);
persist(st);
const r = (st.report as any).report;
console.log(JSON.stringify({ summary: r.summary, claims: r.claims.map((c: any) => c.text), objections: r.objections, likes: r.likes, tipping: r.tipping_note, rec: r.recommendation, critic: (st.report as any).critic }, null, 2));
process.exit(0);

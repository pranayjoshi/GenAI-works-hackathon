/**
 * Recompute a finished run's audience size (Census x Pew join) and rebuild its report and decision.
 * For runs made before the age-band regex fix: on Zetaris (Spark) '\d' in a SQL string read as 'd', so every
 * age fell into 65+ and the local Instagram audience came out wrong. The simulation itself is unaffected.
 * Usage: npx tsx scripts/fix-audience.ts <run_id>
 */
import { query } from '../src/data/federation.js';
import { buildReport } from '../src/report/agent.js';
import { buildDecision, writeLaunchPlan } from '../src/report/decision.js';
import { exportForFederation, loadRun, persist, runDir } from '../src/sim/run.js';
import { ensureCensus, registerSources, US_GEO } from '../src/data/sources.js';

const id = process.argv[2];
const st = await loadRun(id);
if (!st?.verdict || !st.sampleReport) { console.error(`${id}: no finished run with a sample report`); process.exit(1); }
await registerSources();
await ensureCensus([st.spec.geoId, US_GEO]);
const geo = st.spec.geoId.replace(/'/g, '');
const label = 'Audience size: Census x Pew join';
const r = await query(`
    WITH ages AS (
      SELECT CASE WHEN column_name LIKE 'Under%' THEN 0 ELSE TRY_CAST(regexp_extract(column_name, '([0-9]+)', 1) AS INTEGER) END AS age_lo, estimate
      FROM census.acs WHERE geo_id = '${geo}' AND table_id = 'B01001' AND indent = 2
    ), banded AS (
      SELECT CASE WHEN age_lo < 18 THEN NULL WHEN age_lo < 30 THEN '18-29' WHEN age_lo < 50 THEN '30-49' WHEN age_lo < 65 THEN '50-64' ELSE '65+' END AS band, SUM(estimate) AS adults
      FROM ages GROUP BY 1
    )
    SELECT b.band, b.adults, p.pct_us_adults_ever_use AS instagram_pct, ROUND(b.adults * p.pct_us_adults_ever_use / 100.0) AS instagram_users
    FROM banded b JOIN pew.platform_use p ON p.platform = 'instagram' AND p.dimension = 'age' AND p.band = b.band
    WHERE b.band IS NOT NULL ORDER BY b.band`, label, id);
const before = st.sampleReport.instagram_users_est;
st.sampleReport.instagram_users_est = Math.round((r.rows as any[]).reduce((s, x) => s + Number(x.instagram_users ?? 0), 0));
st.sampleReport.queries = st.sampleReport.queries.map((q) => (q.label === label ? { label, query_id: r.query_id, engine: r.engine } : q));
await exportForFederation(st);
st.report = await buildReport(st);
st.decision = await buildDecision(st, { draft: true });
writeLaunchPlan(runDir(id), st.decision);
persist(st);
console.log(JSON.stringify({ before, after: st.sampleReport.instagram_users_est, engine: r.engine, rows: r.rows, call: st.decision.call, headline: st.decision.headline, reasons: st.decision.reasons, variant: st.decision.variant }, null, 2));
process.exit(0);

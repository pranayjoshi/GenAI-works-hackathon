/**
 * USL statements sent through Zetaris's REST API with the app's own client (src/data/federation.ts zetarisQuery):
 * 1. usl_q1 again: the app can read the USL on its normal path, not only over JDBC.
 * 2. LIST DQ and RUN DQ: whether an app that only has the REST API can see or run the quality rules.
 * Prints one JSON line per statement in the LightningRunner receipt shape.
 */
import { zetarisQuery } from '../../src/data/federation.js';

const checks: [string, string, string][] = [
  ['usl_q1_via_rest_api', 'usl_q1 again, through the REST API the app uses', "SELECT age_band, adults, pct_ever_use, reachable_users FROM lightning.metastore.ripple.audience.platform_reach WHERE geo_id = '86000US78704' AND platform = 'instagram' ORDER BY age_band"],
  ['dq_list_via_rest_api', 'Can the REST API list the USL quality rules?', 'LIST DQ USL lightning.metastore.ripple.audience'],
  ['dq_run_via_rest_api', 'Can the REST API run a USL quality rule?', 'RUN DQ reach_pct_in_range TABLE lightning.metastore.ripple.audience.platform_reach'],
];
for (const [id, question, sql] of checks) {
  const t0 = Date.now();
  try {
    const rows = await zetarisQuery(sql);
    const columns = rows.length ? Object.keys(rows[0]) : [];
    console.log(JSON.stringify({ id, question, sql, ok: true, ms: Date.now() - t0, columns, row_count: rows.length, rows: rows.slice(0, 50).map((r) => columns.map((c) => (r[c] === null || r[c] === undefined ? null : String(r[c])))) }));
  } catch (e) {
    console.log(JSON.stringify({ id, question, sql, ok: false, ms: Date.now() - t0, error: String((e as Error).message ?? e).slice(0, 1500) }));
  }
}

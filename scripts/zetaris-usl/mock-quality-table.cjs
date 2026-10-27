// MOCK generator for docs/ZETARIS_USL.md 2c. Builds what the proposed lightning.metastore.ripple.audience_v2.__quality
// table would return, using only numbers Zetaris really returned today (RUN DQ results and the CHECK-as-SELECT
// workaround in docs/zetaris-usl/receipts.json). The table, its columns and the severities are the proposal; the
// counts are real. Output: docs/zetaris-usl/mock/MOCK_quality_table.json
const fs = require('fs');
const r = JSON.parse(fs.readFileSync('docs/zetaris-usl/receipts.json', 'utf8'));
const all = r.steps.flatMap((s) => s.statements);
const get = (id) => all.find((s) => s.id === id);
const severity = { reach_pct_in_range: 'ERROR', customer_is_adult_with_ticket: 'ERROR', headline_clicks_within_impressions: 'ERROR', backtest_min_impressions: 'WARN', customer_id: 'ERROR', pct_not_negative: 'ERROR', pct_at_most_100: 'ERROR' };
const rows = [];
for (const id of ['dq_run_reach', 'dq_run_customer', 'dq_run_headline', 'dq_run_backtest', 'dq_run_primary_key']) {
  const s = get(id); if (!s?.ok) continue;
  const [rule, table, type, total, valid, invalid] = s.rows[0];
  rows.push({ rule, table_name: table, kind: type, severity: severity[rule] ?? 'WARN', total_record: +total, invalid_record: +invalid, status: +invalid === 0 ? 'pass' : severity[rule] === 'ERROR' ? 'fail' : 'warn', source: `real: receipts ${id}` });
}
const w = get('dq_check_constraints_as_select');
if (w?.ok) for (const [rule, total, valid, invalid] of w.rows) rows.push({ rule, table_name: 'platform_reach', kind: 'CHECK constraint (from DDL)', severity: 'ERROR', total_record: +total, invalid_record: +invalid, status: +invalid === 0 ? 'pass' : 'fail', source: 'real counts via SELECT workaround: receipts dq_check_constraints_as_select' });
fs.writeFileSync('docs/zetaris-usl/mock/MOCK_quality_table.json', JSON.stringify({
  MOCK: 'Proposed feature, not a Zetaris output format. Counts are copied from real Zetaris results in docs/zetaris-usl/receipts.json; table name, columns, severity and status are the proposal.',
  table: 'lightning.metastore.ripple.audience_v2.__quality', generated_from: 'docs/zetaris-usl/receipts.json', receipts_generated_at: r.generated_at, rows,
}, null, 1) + '\n');
console.log(`MOCK quality table: ${rows.length} rules, ${rows.filter((x) => x.status !== 'pass').length} not passing. Wrote docs/zetaris-usl/mock/MOCK_quality_table.json`);

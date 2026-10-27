// Combines docs/zetaris-usl/receipts/*.jsonl (written by LightningRunner / rest-check) into docs/zetaris-usl/receipts.json.
const fs = require('fs'), path = require('path');
const d = 'docs/zetaris-usl/receipts';
const files = fs.readdirSync(d).filter((f) => f.endsWith('.jsonl')).sort();
const steps = files.map((f) => {
  const sql = 'docs/zetaris-usl/sql/' + f.replace('.jsonl', '.sql');
  return { file: `${d}/${f}`, sql_file: fs.existsSync(sql) ? sql : null, statements: fs.readFileSync(path.join(d, f), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) };
});
const all = steps.flatMap((s) => s.statements);
fs.writeFileSync('docs/zetaris-usl/receipts.json', JSON.stringify({
  generated_at: new Date().toISOString(),
  engine: 'Zetaris Lightning 2.4.3 (local hackathon bundle). JDBC jdbc:zetaris:lightning@localhost:10000 through scripts/zetaris-usl/LightningRunner.java; 06_rest_api through the REST API with the app client',
  note: 'Every row here was returned by Zetaris. Row lists are capped at 50 per statement (row_count is the full count). Errors are the real messages. 00_onboard is the receipt of the first run (later runs find the table and skip it).',
  totals: { statements: all.length, ok: all.filter((s) => s.ok).length, failed: all.filter((s) => !s.ok).map((s) => s.id), total_ms: all.reduce((a, s) => a + (s.ms || 0), 0) },
  steps,
}, null, 1) + '\n');
// The catalog's own record of the compiled USL (what COMPILE USL returned), kept next to the DDL.
const compiled = all.find((s) => s.id === 'compile_usl_audience' && s.ok);
if (compiled) fs.writeFileSync('docs/zetaris-usl/usl_audience_compiled.json', JSON.stringify(JSON.parse(compiled.rows[0][0]), null, 1) + '\n');
console.log(`   ${all.length} statements, ${all.filter((s) => s.ok).length} ok; failed: ${all.filter((s) => !s.ok).map((s) => s.id).join(', ') || 'none'}`);

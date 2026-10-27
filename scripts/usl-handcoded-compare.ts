/**
 * The hand-coded alternative to the USL, for docs/ZETARIS_USL.md section 2a.
 * Same answers as the USL's platform_reach + customer tables and two of its DQ rules, written in plain
 * TypeScript over the CSV files: parse, type, band, join, aggregate and check by hand. No Zetaris, no DuckDB.
 * Then it compares its numbers to what Zetaris returned (docs/zetaris-usl/receipts.json).
 * Usage: npx tsx scripts/usl-handcoded-compare.ts
 */
import fs from 'node:fs';

// --- 1. CSV parsing (quoted fields, doubled quotes, line breaks inside quotes)
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (ch !== '\r') cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}
const read = (p: string) => parseCsv(fs.readFileSync(p, 'utf8'));

// --- 2. typing and banding (what the USL DDL + activation queries declare once)
const num = (s: string) => { const n = Number(s); if (s === '' || !Number.isFinite(n)) throw new Error(`not a number: "${s}"`); return n; };
const ageLo = (name: string) => (/^Under/.test(name) ? 0 : Number((name.match(/[0-9]+/) ?? ['NaN'])[0]));
const band = (a: number) => (a < 18 ? null : a < 30 ? '18-29' : a < 50 ? '30-49' : a < 65 ? '50-64' : '65+');

const t0 = performance.now();
const census = read('data/cache/census_usl.csv');
const pew = read('data/sources/pew_platform_use.csv');
const customers = read('data/sources/biz_customers_cafe.csv');

// --- 3. the Census x Pew join (platform_reach)
type Reach = { geo_id: string; platform: string; age_band: string; adults: number; pct: number; users: number };
const adults = new Map<string, number>(); // geo|band -> adults
for (const r of census) {
  if (r.table_id !== 'B01001' || r.indent !== '2') continue;
  const b = band(ageLo(r.column_name));
  if (!b) continue;
  const k = `${r.geo_id}|${b}`;
  adults.set(k, (adults.get(k) ?? 0) + num(r.estimate));
}
const reach: Reach[] = [];
for (const p of pew) {
  if (p.dimension !== 'age') continue;
  for (const [k, n] of adults) {
    const [geo_id, b] = k.split('|');
    if (b !== p.band) continue;
    const pct = num(p.pct_us_adults_ever_use);
    reach.push({ geo_id, platform: p.platform, age_band: b, adults: n, pct, users: Math.round((n * pct) / 100) });
  }
}

// --- 4. customers vs reach in 78704 (usl_q2)
const custByBand = new Map<string, number>();
for (const c of customers) { const b = band(num(c.age))!; custByBand.set(b, (custByBand.get(b) ?? 0) + 1); }
const ig = reach.filter((r) => r.geo_id === '86000US78704' && r.platform === 'instagram').sort((a, b) => a.age_band.localeCompare(b.age_band));
const totalCust = [...custByBand.values()].reduce((a, b) => a + b, 0);
const totalReach = ig.reduce((a, r) => a + r.users, 0);
const q2 = ig.map((r) => ({ age_band: r.age_band, customers: custByBand.get(r.age_band) ?? 0, customer_share: +((custByBand.get(r.age_band) ?? 0) / totalCust).toFixed(3), reachable_users: r.users, reach_share: +(r.users / totalReach).toFixed(3) }));

// --- 5. two DQ rules, by hand
const dqReach = reach.filter((r) => !(r.pct >= 0 && r.pct <= 100 && r.users <= r.adults)).length;
const dqCust = customers.filter((c) => !(num(c.age) >= 18 && num(c.avg_ticket) > 0)).length;
const ms = performance.now() - t0;

// --- 6. compare with what Zetaris returned
const receipts = JSON.parse(fs.readFileSync('docs/zetaris-usl/receipts.json', 'utf8'));
const stmt = (id: string) => receipts.steps.flatMap((s: any) => s.statements).find((s: any) => s.id === id);
const z1 = stmt('usl_q1_instagram_reach_78704').rows.map((r: string[]) => [r[0], Number(r[1]), Number(r[3])]);
const h1 = ig.map((r) => [r.age_band, r.adults, r.users]);
const z2 = stmt('usl_q2_customers_vs_reach').rows.map((r: string[]) => [r[0], Number(r[1]), Number(r[2]), Number(r[3]), Number(r[4])]);
const h2 = q2.map((r) => [r.age_band, r.customers, r.customer_share, r.reachable_users, r.reach_share]);
const zReach = stmt('dq_run_reach').rows[0], zCust = stmt('dq_run_customer').rows[0];
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const result = {
  handcoded_ms: Math.round(ms),
  reach_rows: reach.length,
  usl_q1_matches: same(h1, z1), handcoded_q1: h1, zetaris_q1: z1,
  usl_q2_matches: same(h2, z2), handcoded_q2: h2,
  dq_reach: { handcoded_invalid: dqReach, zetaris_invalid: Number(zReach[5]), total: reach.length, zetaris_total: Number(zReach[3]) },
  dq_customer: { handcoded_invalid: dqCust, zetaris_invalid: Number(zCust[5]), total: customers.length, zetaris_total: Number(zCust[3]) },
};
fs.writeFileSync('docs/zetaris-usl/handcoded-compare.json', JSON.stringify(result, null, 1) + '\n');
console.log(`hand-coded: ${result.handcoded_ms} ms, ${result.reach_rows} reach rows; usl_q1 matches Zetaris: ${result.usl_q1_matches}; usl_q2 matches: ${result.usl_q2_matches}; ` +
  `DQ invalid rows reach ${dqReach} vs ${result.dq_reach.zetaris_invalid}, customer ${dqCust} vs ${result.dq_customer.zetaris_invalid}. Wrote docs/zetaris-usl/handcoded-compare.json`);

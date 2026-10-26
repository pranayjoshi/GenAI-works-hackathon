/** Generates the demo café loyalty list. SYNTHETIC and labelled as such (BUILD_PLAN §3.1). */
import fs from 'node:fs';
import { Rng, clamp } from '../src/util/core.js';

const rng = new Rng('south-congress-coffee-loyalty-v1');
const rows = ['customer_id,age,zip,visits_per_month,avg_ticket,tenure_months,label'];
for (let i = 0; i < 640; i++) {
  const age = Math.round(clamp(18 + rng.logNormal(Math.log(14), 0.55), 18, 82));
  const z = rng.normal();
  // younger regulars visit more often; tenure grows with age; ticket loosely tied to visits
  const visits = Math.round(clamp(Math.exp(1.6 - 0.012 * (age - 30) + 0.55 * z), 1, 30));
  const ticket = Math.round(clamp(5.2 + 0.9 * rng.normal() + 0.25 * z + 0.02 * (age - 30), 3.25, 14) * 100) / 100;
  const tenure = Math.round(clamp(rng.logNormal(Math.log(8 + 0.4 * (age - 18)), 0.6), 1, 120));
  const zip = rng.chance(0.62) ? '78704' : rng.pick(['78701', '78745', '78741', '78702', '78703']);
  rows.push(`C-${String(i + 1).padStart(5, '0')},${age},${zip},${visits},${ticket.toFixed(2)},${tenure},SYNTHETIC DEMO DATA`);
}
fs.writeFileSync('data/sources/biz_customers_cafe.csv', rows.join('\n') + '\n');
console.log(`wrote ${rows.length - 1} synthetic customers`);

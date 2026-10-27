/** CLI: reality check (Upworthy backtest). Example: npm run backtest -- --slice dev --n 20 --crowd 60 --rounds 8 --parallel 2 */
import { runBacktest } from '../src/backtest/run.js';

const args = process.argv.slice(2);
const flag = (k: string, d: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const slice = flag('slice', 'dev') as 'dev' | 'scored';
if (slice !== 'dev' && slice !== 'scored') { console.error('--slice must be dev or scored'); process.exit(2); }
const t0 = Date.now();

(async () => {
  const { file, out } = await runBacktest({
    slice, n: Number(flag('n', slice === 'dev' ? '20' : '50')), crowd: Number(flag('crowd', '60')), rounds: Number(flag('rounds', '8')),
    parallel: Number(flag('parallel', '2')), baselinesOnly: args.includes('--baselines-only'),
    log: (s) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${s}`),
  });
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  console.log('\nmethod             correct/n      rate    95% CI');
  const row = (name: string, s: any) => console.log(`${name.padEnd(18)} ${s ? `${String(s.correct).padStart(5)}/${String(s.n).padEnd(6)} ${pct(s.rate).padStart(7)}   [${pct(s.ci[0])}, ${pct(s.ci[1])}]` : '(not run)'}`);
  row('coin flip', { correct: '-', n: '-', rate: 0.5, ci: [0.5, 0.5] });
  row('single (reason)', out.scores.single_reason);
  row('single (crowd model)', out.scores.single_crowd);
  row('Dry Run crowd', out.scores.crowd);
  const m = out.mcnemar;
  for (const [k, v] of Object.entries(m)) if (v) console.log(`McNemar ${k}: b=${v.b} c=${v.c} p=${v.p.toFixed(3)}`);
  console.log(`\nwrote ${file} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });

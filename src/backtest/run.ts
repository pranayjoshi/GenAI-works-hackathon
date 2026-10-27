/**
 * Upworthy backtest driver (BUILD_PLAN §7): real headline A/B pairs -> Dry Run crowd vs single-prompt baselines.
 * The crowd is built ONCE and reused for every test; only the two headlines change. Which headline is variant A is
 * randomized per test with a seeded Rng so position bias cannot favour the real winner. Headline only is shown (the
 * pair shares the same lede and eyecatcher by construction, so the lede adds no signal and costs tokens).
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { ensureCensus } from '../data/sources.js';
import { AGE_BANDS, type SegmentProposal } from '../schemas/persona.js';
import { Rng } from '../util/core.js';
import { buildCrowd, startRun, runs, specFromInput, type RunInput } from '../sim/run.js';
import type { RunSpec } from '../sim/types.js';
import { selectTests, type Pair, type Selection } from './select.js';
import { singlePrompt, type BaselineResult } from './baselines.js';
import { score, mcnemar, type Score } from './score.js';

export interface BacktestOpts {
  slice: 'dev' | 'scored';
  n?: number;
  crowd: number;
  rounds: number;
  parallel: number;
  baselinesOnly?: boolean;
  log?: (s: string) => void;
}

const GEO = '01000US';
const PROPOSAL: SegmentProposal = {
  core: { name: 'US adults on Facebook', age_bands: [...AGE_BANDS], why: 'Upworthy traffic was a general US Facebook audience.' },
  spillover: { name: 'none', why: 'everyone is core in the backtest' },
  interests: [],
};

export interface TestResult {
  test_id: string; created_at: string;
  a: { headline: string; ctr: number; impressions: number };
  b: { headline: string; ctr: number; impressions: number };
  real_winner: 'A' | 'B';
  crowd?: { a_tap: number; b_tap: number; a_n: number; b_n: number; a_taps: number; b_taps: number; pick: 'A' | 'B' | 'tie'; correct: number; error?: string };
  single_reason?: { pick: 'A' | 'B'; correct: number; reason: string; failed: boolean };
  single_crowd?: { pick: 'A' | 'B'; correct: number; reason: string; failed: boolean };
  run_id?: string;
}

const pickOutcome = (pick: 'A' | 'B' | 'tie', real: 'A' | 'B') => (pick === 'tie' ? 0.5 : pick === real ? 1 : 0);
const baseOutcome = (b: BaselineResult, real: 'A' | 'B') => (b.failed ? 0.5 : b.pick === real ? 1 : 0);

function waitDone(st: ReturnType<typeof startRun>): Promise<void> {
  return new Promise((resolve, reject) => {
    const off = st.bus.on((e) => {
      if (e.type === 'done') { off(); resolve(); } else if (e.type === 'error') { off(); reject(new Error(e.message)); }
    });
    if (st.status === 'done') { off(); resolve(); } else if (st.status === 'error') { off(); reject(new Error(st.error)); }
  });
}

export function summarize(tests: TestResult[]) {
  const col = <K extends 'crowd' | 'single_reason' | 'single_crowd'>(k: K) => tests.filter((t) => t[k]).map((t) => ({ id: t.test_id, v: t[k]!.correct }));
  const sc = (k: 'crowd' | 'single_reason' | 'single_crowd'): Score | null => { const c = col(k); return c.length ? score(c.map((x) => x.v)) : null; };
  const mc = (k: 'single_reason' | 'single_crowd') => {
    const c = new Map(col('crowd').map((x) => [x.id, x.v])), o = col(k).filter((x) => c.has(x.id));
    return o.length ? mcnemar(o.map((x) => c.get(x.id)!), o.map((x) => x.v)) : null;
  };
  return {
    scores: { crowd: sc('crowd'), single_reason: sc('single_reason'), single_crowd: sc('single_crowd'), coin: { rate: 0.5 } },
    mcnemar: { crowd_vs_single_reason: mc('single_reason'), crowd_vs_single_crowd: mc('single_crowd') },
  };
}

export async function runBacktest(o: BacktestOpts) {
  const log = o.log ?? (() => {});
  const t0 = Date.now();
  const stamp = new Date().toISOString();
  const file = path.join(config.paths.samples, 'backtest', `${stamp.replace(/[:.]/g, '-')}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const btId = `bt-${stamp.replace(/\D/g, '').slice(2, 14)}`;

  const sel: Selection = await selectTests();
  const pool: Pair[] = o.slice === 'dev' ? sel.dev : sel.scored;
  const pairs = pool.slice(0, o.n ?? (o.slice === 'dev' ? 20 : 50));
  log(`selected ${sel.qualifying} qualifying tests; dev ${sel.dev.length}; running ${pairs.length} from the ${o.slice} slice`);

  const served: Record<string, number> = {};
  const addServed = (m: Record<string, number> | string) => {
    if (typeof m === 'string') served[m] = (served[m] ?? 0) + 1;
    else for (const [k, v] of Object.entries(m)) served[k] = (served[k] ?? 0) + v;
  };
  const tests: TestResult[] = [];
  const models: Record<string, string> = { crowd_hosted: config.nvidia.models.crowd, reason_hosted: config.nvidia.models.reason, crowd_local: config.ollama.models.crowd, reason_local: config.ollama.models.reason };
  const save = (partial: boolean) => {
    const out = {
      partial, started: stamp, finished: partial ? null : new Date().toISOString(),
      config: { slice: o.slice, n_tests: pairs.length, crowd_size: o.crowd, rounds: o.rounds, seeds: [1], platform: 'facebook', baselines_only: !!o.baselinesOnly, headline_only: true, models },
      selection: { query_ids: sel.query_ids, excluded_window: sel.excluded_window, filters: sel.filters, qualifying: sel.qualifying, dev_n: sel.dev.length },
      ...summarize(tests), tests, served_by: served, wall_ms: Date.now() - t0,
    };
    fs.writeFileSync(file + '.tmp', JSON.stringify(out, null, 1));
    fs.renameSync(file + '.tmp', file);
    return out;
  };
  save(true);

  // one crowd for every test
  let crowd: { personas: any[]; proposal: any; sampleReport: any } | undefined;
  const base = (run_id: string, a = 'A', b = 'B'): RunSpec => {
    const inp: RunInput = { business: 'Upworthy', handle: 'Upworthy', place: 'the United States', zip: 'US', goal: 'Get the click', postA: a, postB: b, crowdSize: o.crowd, rounds: o.rounds, seeds: 1, useCustomers: false };
    const s = specFromInput(inp, run_id);
    Object.assign(s, { mode: 'backtest', platform: 'facebook', geoId: GEO, zip: 'US', place: 'the United States', business: 'Upworthy', handle: 'Upworthy', useCustomers: false,
      crowdSize: o.crowd, rounds: o.rounds, hourStep: 3, seeds: [1], batchSize: 6, coreShare: 1, coreAgeBands: [...AGE_BANDS] });
    return s;
  };
  if (!o.baselinesOnly) {
    await ensureCensus([GEO]);
    const spec = base(`${btId}-crowd`);
    const c = await buildCrowd(spec, { postA: '', postB: '' }, (p, d) => log(`crowd: ${p} ${d ?? ''}`), JSON.parse(JSON.stringify(PROPOSAL)));
    crowd = { personas: c.personas, proposal: c.proposal, sampleReport: c.report };
    log(`crowd built: ${c.personas.length} personas in ${(c.ms / 1000).toFixed(0)}s`);
  }

  const one = async (p: Pair, i: number) => {
    const bestIsA = new Rng(`${btId}:order:${p.test_id}`).chance(0.5);
    const A = bestIsA ? p.best : p.worst, B = bestIsA ? p.worst : p.best;
    const real: 'A' | 'B' = bestIsA ? 'A' : 'B';
    const t: TestResult = {
      test_id: p.test_id, created_at: p.created_at,
      a: { headline: A.headline, ctr: A.ctr, impressions: A.impressions }, b: { headline: B.headline, ctr: B.ctr, impressions: B.impressions }, real_winner: real,
    };
    const crowdTask = async () => {
      if (!crowd) return;
      const run_id = `${btId}-${String(i + 1).padStart(2, '0')}-${p.test_id.slice(-6)}`;
      t.run_id = run_id;
      const spec = base(run_id, A.headline, B.headline);
      spec.posts[0].text = A.headline; spec.posts[1].text = B.headline;
      try {
        const st = startRun({ business: 'Upworthy', zip: 'US', goal: 'Get the click', postA: A.headline, postB: B.headline }, { spec, parent: `${btId}-crowd`, crowd });
        await waitDone(st);
        const v = st.verdict!.pooled;
        const pick = v.a === v.b ? 'tie' : v.a > v.b ? 'A' : 'B';
        t.crowd = { a_tap: v.a, b_tap: v.b, a_n: v.na, b_n: v.nb, a_taps: Math.round(v.a * v.na), b_taps: Math.round(v.b * v.nb), pick, correct: pickOutcome(pick, real) };
        for (const u of st.usage ?? []) addServed(u.served_by);
        runs.delete(run_id);
      } catch (e) {
        t.crowd = { a_tap: 0, b_tap: 0, a_n: 0, b_n: 0, a_taps: 0, b_taps: 0, pick: 'tie', correct: 0.5, error: (e as Error).message };
        log(`  crowd error on ${p.test_id}: ${(e as Error).message}`);
      }
    };
    const baseTask = async (k: 'single_reason' | 'single_crowd', role: 'reason' | 'crowd') => {
      try {
        const r = await singlePrompt(role, A.headline, B.headline);
        addServed(r.served_by);
        t[k] = { pick: r.pick, correct: baseOutcome(r, real), reason: r.reason, failed: r.failed };
      } catch (e) {
        t[k] = { pick: 'A', correct: 0.5, reason: `call failed: ${(e as Error).message.slice(0, 120)}`, failed: true };
      }
    };
    await Promise.all([crowdTask(), baseTask('single_reason', 'reason'), baseTask('single_crowd', 'crowd')]);
    tests.push(t);
    save(true);
    const c = t.crowd;
    log(`[${tests.length}/${pairs.length}] ${p.test_id} real=${real} crowd=${c ? `${c.pick} (${c.a_taps}/${c.a_n} vs ${c.b_taps}/${c.b_n})` : '-'} reason=${t.single_reason?.pick} crowd1=${t.single_crowd?.pick}`);
  };

  let next = 0;
  await Promise.all(Array.from({ length: Math.max(1, o.parallel) }, async () => {
    while (next < pairs.length) { const i = next++; await one(pairs[i], i); }
  }));
  tests.sort((x, y) => pairs.findIndex((p) => p.test_id === x.test_id) - pairs.findIndex((p) => p.test_id === y.test_id));
  const out = save(false);
  return { file, out };
}

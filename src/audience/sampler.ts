/**
 * Statistics own who the people are and how much they vary (BUILD_PLAN §3.3).
 * Demographics: live ACS rows (B01001 sex x age, B19037 householder age x income, B15003 education).
 * Channel: Pew Instagram use by age and gender. Behaviour: labelled priors. Customer habits: Gaussian
 * copula fitted to the customer list. No model touches any of these fields.
 */
import { agentLog } from '../util/agentlog.js';
import { query, type Row } from '../data/federation.js';
import { AGE_BANDS, EDUCATION, INCOME_BANDS, type Persona, type Receipt } from '../schemas/persona.js';
import { Rng, clamp, round } from '../util/core.js';
import { GaussianCopula } from './copula.js';

export interface SampleSpec {
  geoId: string;          // "86000US78704" or "01000US"
  zip: string;            // label for the persona record
  n: number;
  seed: string;
  coreAgeBands: string[];
  coreName: string;
  spilloverName: string;
  coreShare?: number;     // user override; default = natural share clamped to [0.5, 0.7]
  useCustomers: boolean;
  idPrefix?: string;
  run_id?: string;        // for the agent trace
  platform?: string;      // Pew platform used for channel weighting (default instagram)
}

export interface SampleReport {
  queries: { label: string; query_id: string; engine: string }[];
  natural_core_share: number;
  target_core_share: number;
  instagram_users_est: number;
  marginals: { age: Record<string, number>; income: Record<string, number> };
  copula?: { n: number; columns: string[]; corr: number[][] };
}

interface AgeCell { sex: 'man' | 'woman'; lo: number; hi: number; est: number; label: string }
interface IncomeCell { group: string; lo: number; band: (typeof INCOME_BANDS)[number]; est: number; label: string }

function parseAgeRange(name: string): [number, number] | null {
  if (/^Under/i.test(name)) return [0, 4];
  const nums = (name.match(/\d+/g) ?? []).map(Number);
  if (!nums.length) return null;
  if (/and over/i.test(name)) return [nums[0], 90];
  if (nums.length >= 2 && /to|and/.test(name)) return [nums[0], nums[1]];
  return [nums[0], nums[0]];
}
export function ageBand(age: number): (typeof AGE_BANDS)[number] {
  if (age < 25) return '18-24'; if (age < 35) return '25-34'; if (age < 45) return '35-44';
  if (age < 55) return '45-54'; if (age < 65) return '55-64'; return '65+';
}
function pewAgeBand(age: number) { return age < 30 ? '18-29' : age < 50 ? '30-49' : age < 65 ? '50-64' : '65+'; }
function householderGroup(age: number) { return age < 25 ? 'under 25' : age < 45 ? '25 to 44' : age < 65 ? '45 to 64' : '65 years and over'; }
function incomeBand(lo: number): (typeof INCOME_BANDS)[number] {
  if (lo < 25000) return '<$25k'; if (lo < 50000) return '$25-50k'; if (lo < 75000) return '$50-75k';
  if (lo < 100000) return '$75-100k'; if (lo < 150000) return '$100-150k'; return '$150k+';
}
function eduCategory(name: string): (typeof EDUCATION)[number] | null {
  if (/Regular high school|GED/i.test(name)) return 'High school';
  if (/Some college|Associate/i.test(name)) return 'Some college';
  if (/Bachelor/i.test(name)) return "Bachelor's";
  if (/Master|Professional|Doctorate/i.test(name)) return 'Graduate';
  if (/Total/i.test(name)) return null;
  return 'No HS diploma';
}

export async function sampleCrowd(spec: SampleSpec): Promise<{ personas: Omit<Persona, 'voice'>[]; report: SampleReport }> {
  const rng = new Rng(`crowd:${spec.seed}`);
  const geo = spec.geoId.replace(/'/g, '');
  const queries: SampleReport['queries'] = [];
  agentLog({ run_id: spec.run_id, agent_name: 'AudienceAgent', action: 'request_data', target_agent: 'DataAgent', status: 'started', input_summary: `Census ACS + Pew + priors for ${spec.geoId}, ${spec.n} people, core ${spec.coreAgeBands.join('/')}` });
  const q = async (label: string, sql: string) => { const r = await query(sql, label, spec.run_id); queries.push({ label, query_id: r.query_id, engine: r.engine }); return r; };

  const qAge = await q('ACS B01001 sex by age', `SELECT column_id, column_name, indent, estimate FROM census.acs WHERE geo_id = '${geo}' AND table_id = 'B01001' ORDER BY column_id`);
  const qInc = await q('ACS B19037 householder age x income', `SELECT column_id, column_name, indent, estimate FROM census.acs WHERE geo_id = '${geo}' AND table_id = 'B19037' ORDER BY column_id`);
  const qEdu = await q('ACS B15003 education 25+', `SELECT column_id, column_name, estimate FROM census.acs WHERE geo_id = '${geo}' AND table_id = 'B15003' ORDER BY column_id`);
  const platform = (spec.platform ?? 'instagram').replace(/[^a-z]/g, '');
  const qPew = await q(`Pew ${platform} use`, `SELECT dimension, band, pct_us_adults_ever_use AS pct FROM pew.platform_use WHERE platform = '${platform}'`);
  const qPri = await q('Behaviour priors', `SELECT param, dimension, band, dist, a, b, label FROM priors.behaviour`);
  // Cross-source join: Census population by Pew age band x Pew Instagram rate = Instagram users in this geography.
  const qJoin = await q('Audience size: Census x Pew join', `
    WITH ages AS (
      SELECT CASE WHEN column_name LIKE 'Under%' THEN 0 ELSE TRY_CAST(regexp_extract(column_name, '([0-9]+)', 1) AS INTEGER) END AS age_lo, estimate
      FROM census.acs WHERE geo_id = '${geo}' AND table_id = 'B01001' AND indent = 2
    ), banded AS (
      SELECT CASE WHEN age_lo < 18 THEN NULL WHEN age_lo < 30 THEN '18-29' WHEN age_lo < 50 THEN '30-49' WHEN age_lo < 65 THEN '50-64' ELSE '65+' END AS band, SUM(estimate) AS adults
      FROM ages GROUP BY 1
    )
    SELECT b.band, b.adults, p.pct_us_adults_ever_use AS instagram_pct, ROUND(b.adults * p.pct_us_adults_ever_use / 100.0) AS instagram_users
    FROM banded b JOIN pew.platform_use p ON p.platform = '${platform}' AND p.dimension = 'age' AND p.band = b.band
    WHERE b.band IS NOT NULL ORDER BY b.band`);

  // ---- parse ACS
  const ageCells: AgeCell[] = [];
  let sex: 'man' | 'woman' | null = null;
  for (const r of qAge.rows as Row[]) {
    const name = String(r.column_name);
    if (/^Male/i.test(name)) { sex = 'man'; continue; }
    if (/^Female/i.test(name)) { sex = 'woman'; continue; }
    if (!sex || Number(r.indent) < 2) continue;
    const range = parseAgeRange(name);
    if (!range || range[0] < 18) continue;
    ageCells.push({ sex, lo: Math.max(18, range[0]), hi: range[1], est: Number(r.estimate), label: `${r.column_id} ${sex === 'man' ? 'Male' : 'Female'} ${name}` });
  }
  const incCells: IncomeCell[] = [];
  let group = '';
  for (const r of qInc.rows as Row[]) {
    const name = String(r.column_name);
    if (/^Householder/i.test(name)) { group = name.replace(/^Householder\s*/i, '').replace(/:$/, '').replace(/\s*years?:?$/, ''); continue; }
    if (!group || /Total/i.test(name)) continue;
    const nums = (name.replace(/,/g, '').match(/\d+/g) ?? []).map(Number);
    const lo = /Less than/i.test(name) ? 0 : nums[0] ?? 0;
    incCells.push({ group, lo, band: incomeBand(lo), est: Number(r.estimate), label: `${r.column_id} householder ${group} / ${name}` });
  }
  const eduCells = (qEdu.rows as Row[]).map((r) => ({ cat: eduCategory(String(r.column_name)), est: Number(r.estimate), label: `${r.column_id} ${r.column_name}` })).filter((c) => c.cat);

  const pew: Record<string, number> = {};
  for (const r of qPew.rows as Row[]) pew[`${r.dimension}:${r.band}`] = Number(r.pct) / 100;
  const genderAvg = ((pew['gender:men'] ?? 0.5) + (pew['gender:women'] ?? 0.5)) / 2;
  const pIg = (age: number, s: 'man' | 'woman') => clamp((pew[`age:${pewAgeBand(age)}`] ?? 0.5) * ((pew[s === 'man' ? 'gender:men' : 'gender:women'] ?? genderAvg) / genderAvg), 0.01, 0.97);

  const priors = new Map<string, Row>();
  for (const r of qPri.rows as Row[]) priors.set(`${r.param}:${r.dimension}:${r.band}`, r);
  const prior = (param: string, dim: string, band: string) => priors.get(`${param}:${dim}:${band}`) ?? priors.get(`${param}:all:all`);
  const drawPrior = (p: Row | undefined, fallback: number) => {
    if (!p) return fallback;
    if (p.dist === 'beta') return rng.beta(Number(p.a), Number(p.b));
    if (p.dist === 'lognormal') return rng.logNormal(Number(p.a), Number(p.b));
    return Number(p.a);
  };

  // ---- core share: natural share of Instagram users in the core age bands
  const coreSet = new Set(spec.coreAgeBands);
  let igCore = 0, igAll = 0;
  for (const c of ageCells) {
    const mid = (c.lo + Math.min(c.hi, 85)) / 2;
    const w = c.est * pIg(mid, c.sex);
    igAll += w;
    if (coreSet.has(ageBand(mid))) igCore += w;
  }
  const natural = igAll ? igCore / igAll : 0.5;
  const allCore = AGE_BANDS.every((b) => coreSet.has(b));
  const target = allCore ? 1 : spec.coreShare ?? clamp(natural, 0.5, 0.7);
  const nCore = Math.round(spec.n * target);

  // ---- customers copula
  let copula: GaussianCopula | null = null;
  let qCust: { query_id: string } | null = null;
  if (spec.useCustomers) {
    try {
      const r = await q('Customer list (copula fit)', `SELECT age, visits_per_month, avg_ticket, tenure_months FROM biz.customers`);
      qCust = r;
      const rows = (r.rows as Row[]).map((x) => ({ age: Number(x.age), visits_per_month: Number(x.visits_per_month), avg_ticket: Number(x.avg_ticket), tenure_months: Number(x.tenure_months) }));
      if (rows.length >= 30) copula = new GaussianCopula(rows, ['age', 'visits_per_month', 'avg_ticket', 'tenure_months']);
    } catch { copula = null; }
  }

  // ---- draw people
  const personas: Omit<Persona, 'voice'>[] = [];
  const ageWeights = ageCells.map((c) => c.est * pIg((c.lo + Math.min(c.hi, 85)) / 2, c.sex));
  let core = 0, spill = 0, guard = 0;
  while (personas.length < spec.n && guard++ < spec.n * 400) {
    const cell = rng.weighted(ageCells, ageWeights);
    const age = rng.int(cell.lo, Math.min(cell.hi, 89));
    // channel membership is already in the weights (Census count x Pew rate), so every draw is an Instagram user
    const band = ageBand(age);
    const isCore = coreSet.has(band);
    if (isCore && core >= nCore) continue;
    if (!isCore && spill >= spec.n - nCore) continue;
    isCore ? core++ : spill++;

    const grp = householderGroup(age);
    const grpCells = incCells.filter((c) => c.group === grp);
    const inc = rng.weighted(grpCells.length ? grpCells : incCells, (grpCells.length ? grpCells : incCells).map((c) => c.est));
    let edu = rng.weighted(eduCells, eduCells.map((c) => c.est));
    for (let t = 0; t < 10 && age < 22 && (edu.cat === "Bachelor's" || edu.cat === 'Graduate'); t++) edu = rng.weighted(eduCells, eduCells.map((c) => c.est));
    const eduCat = age < 22 && (edu.cat === "Bachelor's" || edu.cat === 'Graduate') ? 'Some college' : edu.cat!;

    const minutes = clamp(drawPrior(prior('daily_minutes', 'age', band), 30), 3, 300);
    const role = isCore ? 'core' : 'spillover';
    const id = `${spec.idPrefix ?? 'p'}${String(personas.length + 1).padStart(4, '0')}`;
    const receipts: Receipt[] = [
      { field: 'age, gender', source: 'census.acs B01001 (ACS 5-year, live REST)', query_id: qAge.query_id, ref: cell.label },
      { field: 'income_band', source: 'census.acs B19037 (householder age x income)', query_id: qInc.query_id, ref: inc.label },
      { field: 'education', source: 'census.acs B15003', query_id: qEdu.query_id, ref: edu.label },
      { field: 'channel', source: `pew.platform_use (${platform}, by age and gender)`, query_id: qPew.query_id, ref: `${platform} age ${pewAgeBand(age)} x gender ${cell.sex}` },
      { field: 'segment share', source: 'Census x Pew join', query_id: qJoin.query_id, ref: `core share ${round(target, 2)} (natural ${round(natural, 2)})` },
      { field: 'behaviour', source: 'priors.behaviour (MODELED PRIOR)', query_id: qPri.query_id, ref: `price:${inc.band} skepticism:${band} speak:${band}` },
    ];

    let customer: Persona['customer'] = null;
    const custRate = Number(prior('customer_share', 'role', role)?.a ?? 0);
    if (copula && rng.chance(custRate)) {
      for (let t = 0; t < 300; t++) {
        const s = copula.sample(rng);
        if (Math.abs(s.age - age) <= 4) { customer = { visits_per_month: s.visits_per_month, avg_ticket: s.avg_ticket, tenure_months: s.tenure_months }; break; }
      }
      if (customer && qCust) receipts.push({ field: 'customer', source: 'biz.customers via Gaussian copula (SYNTHETIC demo list)', query_id: qCust.query_id, ref: `copula draw conditioned on age ${age}±4` });
    }

    personas.push({
      id, age, age_band: band, gender: cell.sex, zip: spec.zip, income_band: inc.band, education: eduCat,
      channel: platform, daily_minutes: Math.round(minutes), segment: isCore ? spec.coreName : spec.spilloverName, role,
      customer,
      price_sensitivity: round(drawPrior(prior('price_sensitivity', 'income', inc.band), 0.5), 2),
      skepticism: round(drawPrior(prior('skepticism', 'age', band), 0.6), 2),
      susceptibility: round(clamp(drawPrior(prior('susceptibility', 'all', 'all'), 0.3), 0.05, 0.9), 2),
      speak_p: round(drawPrior(prior('speak_p', 'age', band), 0.15), 2),
      activity: round(clamp(minutes / 75, 0.1, 1), 2),
      influence: Math.round(clamp(drawPrior(prior('influence', 'all', 'all'), 200), 5, 250000)),
      receipts,
    });
  }

  const marg = (f: (p: Omit<Persona, 'voice'>) => string) => {
    const m: Record<string, number> = {};
    for (const p of personas) m[f(p)] = (m[f(p)] ?? 0) + 1;
    for (const k of Object.keys(m)) m[k] = round(m[k] / personas.length, 3);
    return m;
  };
  agentLog({ run_id: spec.run_id, agent_name: 'AudienceAgent', action: 'sample_crowd', status: 'success', output_summary: `${personas.length} people sampled from ${queries.length} DataAgent queries (${[...new Set(queries.map((x) => x.engine))].join(', ')}); demographics from data, not a model`, refs: { query_ids: queries.map((x) => x.query_id) } });
  return {
    personas,
    report: {
      queries,
      natural_core_share: round(natural, 3),
      target_core_share: round(target, 3),
      instagram_users_est: Math.round((qJoin.rows as Row[]).reduce((s, r) => s + Number(r.instagram_users ?? 0), 0)),
      marginals: { age: marg((p) => p.age_band), income: marg((p) => p.income_band) },
      copula: copula ? { n: copula.n, columns: copula.columns, corr: copula.corr.map((r) => r.map((x) => round(x, 2))) } : undefined,
    },
  };
}

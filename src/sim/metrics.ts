/** Metrics, verdict and validity panel, computed in code from the action log (BUILD_PLAN §5). */
import type { Persona } from '../schemas/persona.js';
import { ENGAGED, VOCAL, type ActionRecord } from '../schemas/action.js';
import { round } from '../util/core.js';

export interface Metrics {
  n: number; intent: number; intent_rate: number; tap_rate: number; engagement_rate: number;
  mean_stance: number; stance_sd: number; vocal_share: number; silent_negative_share: number; hide_rate: number; exposures: number;
}

export function metricsFor(records: ActionRecord[], finalStance: Map<string, number>, finalIntent: Map<string, boolean>, filter?: (agentId: string) => boolean): Metrics {
  const adRecs = records.filter((r) => r.item_kind !== 'event' && (!filter || filter(r.agent_id)));
  const deciders = [...new Set(adRecs.map((r) => r.agent_id))];
  const n = deciders.length;
  const vocal = new Set(adRecs.filter((r) => VOCAL.has(r.action)).map((r) => r.agent_id));
  const tapped = new Set(adRecs.filter((r) => r.action === 'tap_through').map((r) => r.agent_id));
  const stances = deciders.map((id) => finalStance.get(id) ?? 0);
  const mean = n ? stances.reduce((a, b) => a + b, 0) / n : 0;
  const sd = n ? Math.sqrt(stances.reduce((a, b) => a + (b - mean) ** 2, 0) / n) : 0;
  const intent = deciders.filter((id) => finalIntent.get(id)).length;
  const silentNeg = deciders.filter((id) => !vocal.has(id) && (finalStance.get(id) ?? 0) < -0.15).length;
  return {
    n, intent, intent_rate: n ? round(intent / n, 4) : 0, tap_rate: n ? round(tapped.size / n, 4) : 0,
    engagement_rate: adRecs.length ? round(adRecs.filter((r) => ENGAGED.has(r.action)).length / adRecs.length, 4) : 0,
    mean_stance: round(mean, 3), stance_sd: round(sd, 3), vocal_share: n ? round(vocal.size / n, 4) : 0,
    silent_negative_share: n ? round(silentNeg / n, 4) : 0,
    hide_rate: adRecs.length ? round(adRecs.filter((r) => r.action === 'hide').length / adRecs.length, 4) : 0,
    exposures: adRecs.length,
  };
}

export interface WorldSummary { world_id: string; variant: string; seed: number; overall: Metrics; segments: Record<string, Metrics>; }

export function segmentKeys(p: Persona): string[] { return [`role:${p.role}`, `age:${p.age_band}`, `income:${p.income_band}`, ...(p.customer ? ['customer:yes'] : ['customer:no'])]; }

export function summarizeWorld(world_id: string, variant: string, seed: number, records: ActionRecord[], stance: Map<string, number>, intent: Map<string, boolean>, personas: Persona[]): WorldSummary {
  const byId = new Map(personas.map((p) => [p.id, p]));
  const keys = new Set<string>();
  for (const p of personas) for (const k of segmentKeys(p)) keys.add(k);
  const segments: Record<string, Metrics> = {};
  for (const k of [...keys].sort()) segments[k] = metricsFor(records, stance, intent, (id) => segmentKeys(byId.get(id)!).includes(k));
  return { world_id, variant, seed, overall: metricsFor(records, stance, intent), segments };
}

const z = 1.96;
export const moe = (p: number, n: number) => (n ? z * Math.sqrt((p * (1 - p)) / n) : 1);

export interface Verdict {
  metric: 'intent_rate' | 'tap_rate';
  variants: [string, string];
  per_seed: { seed: number; a: number; b: number; na: number; nb: number; leader: string }[];
  pooled: { a: number; b: number; na: number; nb: number; diff: number; ci_half: number; moe_a: number; moe_b: number };
  seeds_agree: number;
  winner: string | null;
  call: 'winner' | 'leader';
  /** Version ahead on the pooled rate (A on an exact tie). */
  leader?: string;
  /** P(leader is the better version) = Phi(diff / se), normal approximation of the pooled difference. */
  p_better?: number;
  headline: string;
  segments: { key: string; a: number; b: number; na: number; nb: number; prefers: string | null; clear: boolean }[];
  secondary: Record<string, { a: number; b: number }>;
}

/** Standard normal CDF (Abramowitz-Stegun 7.1.26 erf, error < 1.5e-7). */
export function normCdf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x / 2);
  return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

export function verdict(summaries: WorldSummary[], variants: [string, string], metric: Verdict['metric'], label: string): Verdict {
  const [va, vb] = variants;
  const seeds = [...new Set(summaries.map((s) => s.seed))].sort((x, y) => x - y);
  const get = (seed: number, v: string) => summaries.find((s) => s.seed === seed && s.variant === v)!;
  const per_seed = seeds.map((seed) => {
    const A = get(seed, va).overall, B = get(seed, vb).overall;
    return { seed, a: A[metric], b: B[metric], na: A.n, nb: B.n, leader: A[metric] === B[metric] ? 'tie' : A[metric] > B[metric] ? va : vb };
  });
  // Every seed reuses the same crowd, so seeds are repeat measurements of the same people, not new people.
  // The rate is pooled across seeds; the effective n for the interval is the mean per-seed decider count.
  const pool = (v: string, f: (m: Metrics) => number) => {
    const ws = summaries.filter((s) => s.variant === v);
    const total = ws.reduce((s, w) => s + w.overall.n, 0);
    const k = ws.reduce((s, w) => s + f(w.overall) * w.overall.n, 0);
    return { p: total ? k / total : 0, n: ws.length ? Math.round(total / ws.length) : 0 };
  };
  const A = pool(va, (m) => m[metric]), B = pool(vb, (m) => m[metric]);
  const diff = A.p - B.p;
  const ci_half = z * Math.sqrt((A.p * (1 - A.p)) / Math.max(1, A.n) + (B.p * (1 - B.p)) / Math.max(1, B.n));
  const leaders = per_seed.map((s) => s.leader);
  const lead = diff >= 0 ? va : vb;
  const agree = leaders.filter((l) => l === lead).length;
  const winner = agree === seeds.length && Math.abs(diff) > ci_half ? lead : null;
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const gap = Math.abs(diff);
  const p_better = ci_half > 0 ? normCdf(gap / (ci_half / z)) : gap > 0 ? 1 : 0.5;
  const sgn = (x: number) => `${x < 0 ? '\u2212' : '+'}${Math.abs(x * 100).toFixed(1)}`;
  const [pl, po] = lead === va ? [A.p, B.p] : [B.p, A.p];
  const headline = `${lead} ${winner ? 'wins' : 'leads'} on ${label}: ${pct(pl)} vs ${pct(po)} (${sgn(gap)} pts, 95% CI ${sgn(gap - ci_half)} to ${sgn(gap + ci_half)}); ${lead} ahead in ${agree} of ${seeds.length} seed${seeds.length > 1 ? 's' : ''}; ${Math.round(p_better * 100)}% likely to be the better version.`;

  const segKeys = Object.keys(summaries[0]?.segments ?? {});
  const segments = segKeys.map((key) => {
    const sa = summaries.filter((s) => s.variant === va).map((s) => s.segments[key]);
    const sb = summaries.filter((s) => s.variant === vb).map((s) => s.segments[key]);
    const ta = sa.reduce((s, m) => s + m.n, 0), tb = sb.reduce((s, m) => s + m.n, 0);
    const a = ta ? sa.reduce((s, m) => s + m[metric] * m.n, 0) / ta : 0;
    const b = tb ? sb.reduce((s, m) => s + m[metric] * m.n, 0) / tb : 0;
    const na = sa.length ? Math.round(ta / sa.length) : 0, nb = sb.length ? Math.round(tb / sb.length) : 0;
    const half = z * Math.sqrt((a * (1 - a)) / Math.max(1, na) + (b * (1 - b)) / Math.max(1, nb));
    return { key, a: round(a, 4), b: round(b, 4), na, nb, prefers: a === b ? null : a > b ? va : vb, clear: Math.abs(a - b) > half && na >= 20 && nb >= 20 };
  });
  const sec = (f: (m: Metrics) => number) => ({ a: round(pool(va, f).p, 4), b: round(pool(vb, f).p, 4) });
  return {
    metric, variants, per_seed,
    pooled: { a: round(A.p, 4), b: round(B.p, 4), na: A.n, nb: B.n, diff: round(diff, 4), ci_half: round(ci_half, 4), moe_a: round(moe(A.p, A.n), 4), moe_b: round(moe(B.p, B.n), 4) },
    seeds_agree: agree, winner, call: winner ? 'winner' : 'leader', leader: lead, p_better: round(p_better, 4), headline, segments,
    secondary: {
      engagement_rate: sec((m) => m.engagement_rate), mean_stance: sec((m) => m.mean_stance), vocal_share: sec((m) => m.vocal_share),
      silent_negative_share: sec((m) => m.silent_negative_share), hide_rate: sec((m) => m.hide_rate), tap_rate: sec((m) => m.tap_rate),
    },
  };
}

/** The share whose cascade reached the most people (tipping point), per world. */
export function tippingPoint(records: ActionRecord[]) {
  const shares = records.filter((r) => r.action === 'share');
  const reached = (agent: string, depth = 0, seen = new Set<string>()): number => {
    if (depth > 6) return 0;
    const recs = records.filter((r) => r.via === agent && !seen.has(r.agent_id));
    let n = 0;
    for (const r of recs) { seen.add(r.agent_id); n++; if (r.action === 'share') n += reached(r.agent_id, depth + 1, seen); }
    return n;
  };
  let best: { record: ActionRecord; reached: number } | null = null;
  for (const s of shares) {
    const n = reached(s.agent_id);
    if (!best || n > best.reached) best = { record: s, reached: n };
  }
  return best;
}

export function validity(records: ActionRecord[], summaries: WorldSummary[]) {
  const reasons = records.filter((r) => r.reason).map((r) => r.reason.toLowerCase().replace(/[^a-z ]/g, '').trim());
  const distinct = new Set(reasons).size;
  const openers = new Map<string, number>();
  for (const r of reasons) { const k = r.split(' ').slice(0, 3).join(' '); openers.set(k, (openers.get(k) ?? 0) + 1); }
  const topOpener = [...openers.entries()].sort((a, b) => b[1] - a[1])[0];
  return {
    decisions: records.length,
    repaired_share: records.length ? round(records.filter((r) => r.repaired).length / records.length, 4) : 0,
    distinct_reason_ratio: reasons.length ? round(distinct / reasons.length, 3) : 0,
    top_reason_opener: topOpener ? { text: topOpener[0], share: round(topOpener[1] / reasons.length, 3) } : null,
    scroll_past_share: records.length ? round(records.filter((r) => r.action === 'scroll_past').length / records.length, 3) : 0,
    stance_sd_by_world: summaries.map((s) => ({ world: s.world_id, sd: s.overall.stance_sd })),
    silenced: records.filter((r) => r.unsaid).length,
    guard: (() => {
      const counts: Record<string, number> = {};
      for (const r of records) for (const c of r.checks ?? []) counts[c] = (counts[c] ?? 0) + 1;
      return { decisions_with_a_check: records.filter((r) => r.checks?.length).length, by_check: counts };
    })(),
  };
}

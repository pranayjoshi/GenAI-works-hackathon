/** POST /run: structured input -> full A/B simulation -> structured output (one call, awaited). */
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { config } from './config.js';
import { traceStats } from './llm.js';
import { startRun, persist, runDir, type RunInput, type RunState } from './sim/run.js';
import { buildDecision, writeLaunchPlan } from './report/decision.js';
import { offlineCalls } from './sim/offline.js';

const Version = z.object({
  text: z.string().min(3).optional(),
  caption: z.string().min(3).optional(),
  offer: z.string().optional(),
  image: z.string().optional(),
}).refine((v) => v.text || v.caption, { message: 'text (or caption) is required' });

export const RunBody = z.object({
  business: z.object({
    name: z.string().min(1),
    type: z.string().optional(),
    address: z.string().optional(),
    zip: z.string().regex(/^\d{5}$/, 'zip must be a 5 digit US ZIP code').optional(),
    place: z.string().optional(),
    handle: z.string().optional(),
    goal: z.string().optional(),
    use_customer_list: z.boolean().optional(),
  }),
  version_a: Version,
  version_b: Version,
  crowd: z.number().int().min(20, 'crowd must be 20 to 300').max(300, 'crowd must be 20 to 300').default(60),
  rounds: z.number().int().min(6, 'rounds must be 6 to 32').max(32, 'rounds must be 6 to 32').default(8),
  seeds: z.number().int().min(1).max(3).default(1),
  events: z.array(z.object({ round: z.number().int().min(0), text: z.string().min(3), target: z.enum(['all', 'core', 'spillover']).optional() })).default([]),
  decision: z.object({ budget: z.number().positive().optional() }).optional(),
});
export type RunBody = z.infer<typeof RunBody>;

const textOf = (v: z.infer<typeof Version>) => {
  const t = (v.text ?? v.caption)!.trim();
  return v.offer && !t.toLowerCase().includes(v.offer.toLowerCase()) ? `${t} ${v.offer.trim()}` : t;
};

/** Map the public input onto the same RunInput the UI uses (POST /api/runs). */
export function toRunInput(b: RunBody): RunInput {
  const zip = b.business.zip ?? b.business.address?.match(/\b(\d{5})(?:-\d{4})?\b/)?.[1];
  if (!zip) throw Object.assign(new Error('business.zip is required (or a business.address that contains a 5 digit ZIP)'), { statusCode: 400 });
  return {
    business: b.business.name,
    handle: b.business.handle,
    place: b.business.place ?? b.business.address ?? `ZIP ${zip}`,
    zip,
    goal: b.business.goal ?? `Get people nearby to visit ${b.business.name} this week${b.business.type ? ` (${b.business.type})` : ''}`,
    postA: textOf(b.version_a), postB: textOf(b.version_b),
    imageA: b.version_a.image, imageB: b.version_b.image,
    crowdSize: b.crowd, rounds: b.rounds, seeds: b.seeds,
    events: b.events,
    // the bundled customer list is the demo cafe's; other businesses start from Census and Pew only
    useCustomers: b.business.use_customer_list ?? zip === '78704',
  };
}

export const runTimeoutMs = () => Number(process.env.RUN_TIMEOUT_MS) || 10 * 60_000;

/** Resolves when the run is done, rejects on error or timeout (the run is aborted on timeout). */
export function waitForRun(st: RunState, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { st.abort.abort(); off(); reject(Object.assign(new Error(`run exceeded ${Math.round(timeoutMs / 1000)}s and was stopped`), { statusCode: 504, hint: 'Lower crowd, rounds or seeds, or raise RUN_TIMEOUT_MS.' })); }, timeoutMs);
    const off = st.bus.on((e) => {
      if (e.type === 'done') { clearTimeout(timer); off(); resolve(); }
      if (e.type === 'error') { clearTimeout(timer); off(); reject(new Error(e.message)); }
    });
    if (st.status === 'done') { clearTimeout(timer); off(); resolve(); }
    if (st.status === 'error') { clearTimeout(timer); off(); reject(new Error(st.error ?? 'run failed')); }
  });
}

const pts = (x: number) => Math.round(x * 1000) / 10;

export function buildOutput(st: RunState, body: RunBody, input: RunInput, ms: number) {
  const v = st.verdict!;
  const [va, vb] = v.variants;
  const bundle = (st.report as any) ?? {};
  const rep = bundle.report ?? {};
  const byRole: Record<string, number> = {}, byAge: Record<string, number> = {};
  for (const p of st.personas) { byRole[p.role] = (byRole[p.role] ?? 0) + 1; byAge[p.age_band] = (byAge[p.age_band] ?? 0) + 1; }
  const usage = traceStats(st.spec.run_id);
  const models: Record<string, number> = {};
  for (const u of usage) for (const [k, n] of Object.entries(u.served_by)) models[k] = (models[k] ?? 0) + n;
  const off = offlineCalls.get(st.spec.run_id);
  if (off) models['offline-model'] = (models['offline-model'] ?? 0) + off;
  const engines: Record<string, number> = {};
  const qs = [...(st.sampleReport?.queries ?? []), ...(bundle.tools ?? [])];
  for (const q of qs) engines[q.engine] = (engines[q.engine] ?? 0) + 1;
  const logFile = path.join('logs', `${st.spec.run_id}.jsonl`);
  const metric = (variant: string, rate: number, n: number, moe: number) => ({
    variant, [v.metric]: pts(rate) / 100, rate_pct: pts(rate), n_deciders: n, margin_of_error_pts: pts(moe),
    ...Object.fromEntries(Object.entries(v.secondary).map(([k, x]) => [k, variant === va ? x.a : x.b])),
  });
  return {
    run_id: st.spec.run_id,
    input_echo: body,
    audience: {
      size: st.personas.length,
      place: st.spec.place,
      core: st.proposal ? { name: st.proposal.core.name, age_bands: st.proposal.core.age_bands, why: st.proposal.core.why } : null,
      spillover: st.proposal ? { name: st.proposal.spillover.name, why: st.proposal.spillover.why } : null,
      interests: st.proposal?.interests ?? [],
      segments: { role: byRole, age_band: byAge, customers: st.personas.filter((p) => p.customer).length },
      census_geo: st.spec.geoId,
      instagram_users_est: st.sampleReport?.instagram_users_est ?? null,
    },
    verdict: { headline: v.headline, winner: v.winner, call: v.call, metric: v.metric, gap_pts: pts(v.pooled.diff), ci_half_pts: pts(v.pooled.ci_half), seeds_agree: v.seeds_agree, per_seed: v.per_seed, segments: v.segments.filter((s) => s.clear) },
    metrics: { [va]: metric(va, v.pooled.a, v.pooled.na, v.pooled.moe_a), [vb]: metric(vb, v.pooled.b, v.pooled.nb, v.pooled.moe_b) },
    report: { summary: rep.summary ?? null, claims: rep.claims ?? [], themes: { objections: rep.objections ?? [], likes: rep.likes ?? [] }, tipping_note: rep.tipping_note ?? null, recommendation: rep.recommendation ?? null, quotes: bundle.quotes ?? {}, fallback: bundle.fallback ?? null, error: (st.report as any)?.error ?? null },
    decision: st.decision ? { ...st.decision, budget_input: body.decision?.budget ?? null } : null,
    validity: st.validity ?? null,
    trace: {
      log_file: fs.existsSync(path.join(config.root, logFile)) ? logFile : null,
      models_used: models,
      queries: { count: qs.length, by_engine: engines },
      timing_ms: { total: ms, ...(st.timing ?? {}) },
    },
    ui_url: `http://localhost:${config.port}/#/run/${st.spec.run_id}`,
  };
}

export async function handleRun(raw: unknown) {
  const parsed = RunBody.safeParse(raw);
  if (!parsed.success) {
    throw Object.assign(new Error('Invalid input: ' + parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ')), { statusCode: 400, hint: 'See input_examples/example_1.json for the expected shape.' });
  }
  const body = parsed.data;
  const input = toRunInput(body);
  const t0 = Date.now();
  const st = startRun(input);
  await waitForRun(st, runTimeoutMs());
  if (!st.decision) {
    // the in-run draft needs a model for the rewrite; without one, the decision still stands (no draft variant)
    st.decision = await buildDecision(st, { draft: false });
    writeLaunchPlan(runDir(st.spec.run_id), st.decision);
    persist(st);
  }
  return buildOutput(st, body, input, Date.now() - t0);
}

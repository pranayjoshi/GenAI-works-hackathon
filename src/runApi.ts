/** POST /run: structured input -> full A/B simulation -> structured output (one call, awaited). */
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { config } from './config.js';
import { traceStats } from './llm.js';
import { startRun, persist, runDir, adText, type RunInput, type RunState, type VersionExtra } from './sim/run.js';
import { PLATFORMS } from './sim/types.js';
import { buildDecision, writeLaunchPlan } from './report/decision.js';
import { offlineCalls } from './sim/offline.js';
/** Largest crowd /run accepts (keeps a judge's call to minutes); raise with RUN_MAX_CROWD for long runs. */
const MAX_CROWD = Number(process.env.RUN_MAX_CROWD ?? 300);

/** An image is a data URL (data:image/png;base64,...) or an https URL. */
const ImageRef = z.string().regex(/^(data:image\/[\w+.-]+;base64,|https:\/\/)/, 'image must be a data URL or an https URL');
const Version = z.object({
  type: z.enum(['post', 'image', 'ad', 'campaign']).optional(),
  text: z.string().min(3).optional(),
  caption: z.string().min(3).optional(),
  offer: z.string().optional(),
  image: ImageRef.optional(),
  headline: z.string().min(2).optional(),
  primary_text: z.string().min(3).optional(),
  cta: z.string().min(2).max(30).optional(),
  posts: z.array(z.object({ text: z.string().min(3), image: ImageRef.optional() })).min(2, 'a campaign needs 2 or 3 posts').max(3, 'a campaign has at most 3 posts').optional(),
}).superRefine((v, ctx) => {
  const t = v.type ?? (v.posts ? 'campaign' : v.headline ? 'ad' : 'post');
  const need = (ok: unknown, message: string) => { if (!ok) ctx.addIssue({ code: 'custom', message }); };
  if (t === 'post') need(v.text || v.caption, 'text (or caption) is required');
  if (t === 'image') need(v.image, 'image is required for an image version');
  if (t === 'ad') need(v.headline && v.primary_text, 'headline and primary_text are required for an ad');
  if (t === 'campaign') need(v.posts, 'posts (2 or 3) are required for a campaign');
});

export const RunBody = z.object({
  business: z.object({
    name: z.string().min(1),
    type: z.string().optional(),
    address: z.string().optional(),
    zip: z.string().regex(/^\d{5}$/, 'zip must be a 5 digit US ZIP code').optional(),
    place: z.string().optional(),
    location: z.string().optional(), // LOCATION: US ZIP, country, or "City, Country" (see data/geo.ts)
    handle: z.string().optional(),
    goal: z.string().optional(),
    use_customer_list: z.boolean().optional(),
  }),
  platform: z.enum(PLATFORMS).default('instagram'),
  version_a: Version,
  version_b: Version,
  crowd: z.number().int().min(20, `crowd must be 20 to ${MAX_CROWD}`).max(MAX_CROWD, `crowd must be 20 to ${MAX_CROWD}`).default(60),
  rounds: z.number().int().min(6, 'rounds must be 6 to 32').max(32, 'rounds must be 6 to 32').default(8),
  seeds: z.number().int().min(1).max(3).default(1),
  events: z.array(z.object({ round: z.number().int().min(0), text: z.string().min(3), target: z.enum(['all', 'core', 'spillover']).optional() })).default([]),
  decision: z.object({ budget: z.number().positive().optional() }).optional(),
});
export type RunBody = z.infer<typeof RunBody>;

const withOffer = (t: string, offer?: string) => (offer && !t.toLowerCase().includes(offer.toLowerCase()) ? `${t} ${offer.trim()}` : t);

/** One version -> the composed text (what the crowd reads), its main image, and the extra shape for the engine. */
function versionOf(v: z.infer<typeof Version>): { text: string; image?: string; extra: VersionExtra } {
  const kind = v.type ?? (v.posts ? 'campaign' : v.headline ? 'ad' : 'post');
  if (kind === 'campaign') {
    const items = v.posts!.map((p) => ({ text: p.text.trim(), image: p.image }));
    return { text: items.map((it, i) => `Post ${i + 1}: ${it.text}`).join(' '), extra: { kind, items } };
  }
  if (kind === 'ad') {
    const ad = { headline: v.headline!, primary: withOffer(v.primary_text!.trim(), v.offer), cta: v.cta ?? 'Learn more' };
    return { text: adText(ad), image: v.image, extra: { kind, ad } };
  }
  if (kind === 'image') return { text: withOffer((v.caption ?? v.text ?? '(no caption)').trim(), v.offer), image: v.image, extra: { kind } };
  return { text: withOffer((v.text ?? v.caption)!.trim(), v.offer), image: v.image, extra: { kind: 'post' } };
}

/** Echo the input without megabytes of base64. */
export const redactImages = (x: unknown): unknown => JSON.parse(JSON.stringify(x, (_k, v) => (typeof v === 'string' && v.startsWith('data:image/') ? `${v.slice(0, v.indexOf(','))},...(${Math.round(v.length * 0.75 / 1024)} KB)` : v)));

/** Map the public input onto the same RunInput the UI uses (POST /api/runs). */
export function toRunInput(b: RunBody): RunInput {
  const zip = b.business.zip ?? b.business.address?.match(/\b(\d{5})(?:-\d{4})?\b/)?.[1];
  const location = zip ? undefined : b.business.location;
  if (!zip && !location) throw Object.assign(new Error('business.zip or business.location is required (or a business.address that contains a 5 digit ZIP)'), { statusCode: 400 });
  const va = versionOf(b.version_a), vb = versionOf(b.version_b);
  return {
    business: b.business.name,
    handle: b.business.handle,
    place: b.business.place ?? b.business.address ?? location ?? `ZIP ${zip}`,
    zip: zip ?? '', location,
    goal: b.business.goal ?? `Get people nearby to visit ${b.business.name} this week${b.business.type ? ` (${b.business.type})` : ''}`,
    platform: b.platform,
    postA: va.text, postB: vb.text,
    imageA: va.image, imageB: vb.image, versionA: va.extra, versionB: vb.extra,
    crowdSize: b.crowd, rounds: b.rounds, seeds: b.seeds,
    events: b.events,
    // the bundled customer list is the demo cafe's (synthetic): off unless the request asks for it with business.use_customer_list
    useCustomers: b.business.use_customer_list ?? false,
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
    input_echo: redactImages(body),
    platform: st.spec.platform ?? 'instagram',
    versions: st.spec.posts.map((p) => ({ variant: p.variant, type: p.kind ?? 'post', text: p.text, image_id: p.image_id ?? null, image_description: p.image ?? null, campaign_posts: p.items?.map((i) => ({ text: i.text, image_description: i.image ?? null })) ?? null })),
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

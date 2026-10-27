/** Fastify API + SSE for the Dry Run UI. */
import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { config } from './config.js';
import { providerStatus, traceStats, traceBus, type TraceEntry } from './llm.js';
import { getQuery } from './data/federation.js';
import { registerSources, ensureCensus, sourceSummary, geoIdForZip } from './data/sources.js';
import { proposeSegments } from './audience/agent.js';
import { CAFE_DEMO } from './demo.js';
import { runs, startRun, loadRun, listRunsOnDisk, injectEvent, allRecords, specFromInput, persist, runDir, type RunState, type RunInput } from './sim/run.js';
import { buildDecision, decideAction, writeLaunchPlan, recordVerification } from './report/decision.js';
import { metaConfigured } from './actions/meta.js';
import { interview, askSegment, focusGroup } from './report/interview.js';
import { draftVersionC } from './report/rewriter.js';
import { queryActions } from './report/tools.js';
import { query } from './data/federation.js';
import { handleRun } from './runApi.js';

const app = Fastify({ logger: false, bodyLimit: 5 * 1024 * 1024 });
app.register(fastifyStatic, { root: path.join(config.root, 'web'), prefix: '/' });

async function getRun(id: string): Promise<RunState> {
  const st = runs.get(id) ?? (await loadRun(id));
  if (!st) throw Object.assign(new Error(`run ${id} not found`), { statusCode: 404 });
  return st;
}

function snapshot(st: RunState) {
  return {
    spec: st.spec, status: st.status, phase: st.phase, error: st.error, created: st.created,
    proposal: st.proposal, sampleReport: st.sampleReport,
    personas: st.personas.map(({ receipts, ...p }) => p),
    summaries: st.summaries, verdict: st.verdict, tipping: st.tipping, validity: st.validity, fairness: st.fairness,
    report: st.report, decision: st.decision, usage: st.usage ?? traceStats(st.spec.run_id), timing: st.timing,
    worlds: st.worlds.map(({ records, ...w }) => ({ ...w, decisions: records.length })),
  };
}

// judges' programmatic entry: structured input in, structured output out (src/runApi.ts)
app.get('/health', async () => ({ ok: true, sampleMode: config.sampleMode, port: config.port }));
app.post('/run', async (req) => handleRun(req.body));

app.get('/api/status', async () => {
  const [providers, sources] = await Promise.all([providerStatus(), sourceSummary().catch((e) => ({ engine: 'error', tables: [], error: (e as Error).message }))]);
  return { providers, sources, sampleMode: config.sampleMode, meta: { configured: metaConfigured(), mode: metaConfigured() ? 'live (paused objects)' : 'preview' } };
});
app.get('/api/demo', async () => CAFE_DEMO);

app.post('/api/audience', async (req) => {
  const b = req.body as RunInput;
  await registerSources();
  await ensureCensus([geoIdForZip(b.zip)]);
  const r = await proposeSegments({ postA: b.postA, postB: b.postB, goal: b.goal, place: b.place || `ZIP ${b.zip}`, business: b.business }, 'audience-preview');
  const geo = geoIdForZip(b.zip).replace(/'/g, '');
  const join = await query(`
    WITH ages AS (
      SELECT CASE WHEN column_name LIKE 'Under%' THEN 0 ELSE TRY_CAST(regexp_extract(column_name, '(\\d+)', 1) AS INTEGER) END AS age_lo, estimate
      FROM census.acs WHERE geo_id = '${geo}' AND table_id = 'B01001' AND indent = 2),
    banded AS (SELECT CASE WHEN age_lo < 18 THEN NULL WHEN age_lo < 30 THEN '18-29' WHEN age_lo < 50 THEN '30-49' WHEN age_lo < 65 THEN '50-64' ELSE '65+' END AS band, SUM(estimate) AS adults FROM ages GROUP BY 1)
    SELECT b.band, b.adults, p.pct_us_adults_ever_use AS instagram_pct, ROUND(b.adults * p.pct_us_adults_ever_use / 100.0) AS instagram_users
    FROM banded b JOIN pew.platform_use p ON p.platform = 'instagram' AND p.dimension = 'age' AND p.band = b.band
    WHERE b.band IS NOT NULL ORDER BY b.band`, 'audience preview: Census x Pew');
  const place = await query(`SELECT DISTINCT geo_name, release FROM census.acs WHERE geo_id = '${geo}'`, 'geo name');
  return { proposal: r.proposal, served_by: r.served_by, fallback: r.fallback, join: { query_id: join.query_id, engine: join.engine, rows: join.rows }, geo: place.rows[0] ?? null };
});

app.post('/api/runs', async (req) => {
  const b = req.body as RunInput;
  if (!b?.postA || !b?.postB || !b?.zip || !b?.business) throw Object.assign(new Error('business, zip, postA and postB are required'), { statusCode: 400 });
  const st = startRun(b);
  return { run_id: st.spec.run_id, spec: st.spec };
});

app.get('/api/runs', async () => {
  const ids = new Set([...runs.keys(), ...listRunsOnDisk()]);
  const out = [];
  for (const id of ids) {
    const st = await loadRun(id).catch(() => undefined);
    if (!st || st.spec.mode !== 'ab') continue;
    out.push({ run_id: id, business: st.spec.business, status: st.status, created: st.created, headline: st.verdict?.headline ?? st.phase, crowd: st.spec.crowdSize, rounds: st.spec.rounds, seeds: st.spec.seeds.length, parent: st.spec.parent_run ?? null, posts: st.spec.posts.map((p) => p.variant) });
  }
  return out.sort((a, b) => (a.created < b.created ? 1 : -1));
});

app.get('/api/runs/:id', async (req) => snapshot(await getRun((req.params as any).id)));

app.get('/api/runs/:id/actions', async (req) => {
  const st = await getRun((req.params as any).id);
  const q = req.query as { world?: string; agent?: string; limit?: string };
  let recs = allRecords(st);
  if (q.world) recs = recs.filter((r) => r.world_id === q.world);
  if (q.agent) recs = recs.filter((r) => r.agent_id === q.agent);
  return recs.slice(-(Number(q.limit) || 5000));
});

app.get('/api/runs/:id/stream', async (req, reply) => {
  const st = await getRun((req.params as any).id);
  reply.raw.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' });
  const send = (e: unknown) => reply.raw.write(`data: ${JSON.stringify(e)}\n\n`);
  send({ type: 'snapshot', state: snapshot(st) });
  for (const e of st.recent) if (e.type === 'action' || e.type === 'round' || e.type === 'event_injected') send(e);
  const off = st.bus.on(send);
  const offTrace = traceBus.on((t: TraceEntry) => { if (t.tag.startsWith(st.spec.run_id)) send({ type: 'trace', entry: t }); });
  const ping = setInterval(() => reply.raw.write(': ping\n\n'), 15000);
  req.raw.on('close', () => { off(); offTrace(); clearInterval(ping); });
  return reply;
});

app.post('/api/runs/:id/events', async (req) => {
  const st = await getRun((req.params as any).id);
  const b = req.body as { round: number; text: string; target?: 'all' | 'core' | 'spillover' };
  if (!b?.text) throw Object.assign(new Error('text is required'), { statusCode: 400 });
  return injectEvent(st, { round: Math.max(0, Math.min(st.spec.rounds - 1, Number(b.round))), text: b.text, target: b.target });
});

app.get('/api/runs/:id/agents/:agent', async (req) => {
  const p = req.params as { id: string; agent: string };
  const st = await getRun(p.id);
  const persona = st.personas.find((x) => x.id === p.agent);
  if (!persona) throw Object.assign(new Error('agent not found'), { statusCode: 404 });
  const worlds: Record<string, unknown> = {};
  for (const [w, m] of st.memories) worlds[w] = { memories: m.get(p.agent) ?? [], actions: allRecords(st).filter((r) => r.world_id === w && r.agent_id === p.agent) };
  const followers = null;
  return { persona, worlds, followers };
});

app.post('/api/runs/:id/interview', async (req) => {
  const st = await getRun((req.params as any).id);
  const b = req.body as { world_id: string; agent_id: string; question: string; history?: { q: string; a: string }[] };
  return interview(st, b.world_id, b.agent_id, b.question, b.history ?? []);
});
app.post('/api/runs/:id/segment', async (req) => {
  const st = await getRun((req.params as any).id);
  const b = req.body as { segment: string; question: string; variant?: string };
  return askSegment(st, b.segment, b.question, b.variant);
});
app.post('/api/runs/:id/focus', async (req) => {
  const st = await getRun((req.params as any).id);
  const b = (req.body ?? {}) as { size?: number; turns?: number; topic?: string };
  return focusGroup(st, b, (t) => st.bus.emit({ type: 'focus', run_id: st.spec.run_id, turn: t }));
});
app.post('/api/runs/:id/version-c', async (req) => draftVersionC(await getRun((req.params as any).id)));
// spend decision and launch plan (src/report/decision.ts)
app.get('/api/runs/:id/decision', async (req) => {
  const st = await getRun((req.params as any).id);
  if (!st.decision) { st.decision = await buildDecision(st, { draft: false }); persist(st); writeLaunchPlan(runDir(st.spec.run_id), st.decision); }
  return st.decision;
});
app.post('/api/runs/:id/decision', async (req) => {
  const st = await getRun((req.params as any).id);
  st.decision = await buildDecision(st, { draft: Boolean((req.body as any)?.draft ?? true) });
  persist(st);
  writeLaunchPlan(runDir(st.spec.run_id), st.decision);
  return st.decision;
});
app.post('/api/runs/:id/decision/actions/:action', async (req) => {
  const st = await getRun((req.params as any).id);
  if (!st.decision) throw Object.assign(new Error('No decision yet'), { statusCode: 404 });
  const choice = (req.body as any)?.choice === 'reject' ? 'reject' : 'approve';
  const action = await decideAction(st.decision, (req.params as any).action, choice, st.spec.business);
  persist(st);
  const file = writeLaunchPlan(runDir(st.spec.run_id), st.decision);
  return { action, launch_plan: `/api/runs/${st.spec.run_id}/launch-plan.json`, file: path.relative(process.cwd(), file), note: (action.result as any)?.note ?? 'Nothing was posted or spent. The plan is exported.' };
});
app.get('/api/runs/:id/launch-plan.json', async (req, reply) => {
  const st = await getRun((req.params as any).id);
  if (!st.decision) throw Object.assign(new Error('No decision yet'), { statusCode: 404 });
  const existing = path.join(runDir(st.spec.run_id), 'launch_plan.json');
  const file = fs.existsSync(existing) ? existing : writeLaunchPlan(runDir(st.spec.run_id), st.decision);
  reply.header('content-type', 'application/json').header('content-disposition', `attachment; filename="launch_plan_${st.spec.run_id}.json"`);
  return fs.readFileSync(file, 'utf8');
});
app.post('/api/runs/:id/version-c/run', async (req) => {
  const parent = await getRun((req.params as any).id);
  const b = req.body as { text: string; seeds?: number };
  const winner = parent.verdict?.winner ?? (parent.verdict && parent.verdict.pooled.a >= parent.verdict.pooled.b ? parent.verdict.variants[0] : parent.verdict?.variants[1]) ?? 'A';
  const wpost = parent.spec.posts.find((p) => p.variant === winner)!;
  const spec = specFromInput({ business: parent.spec.business, handle: parent.spec.handle, place: parent.spec.place, zip: parent.spec.zip, goal: parent.spec.goal, postA: wpost.text, postB: b.text, crowdSize: parent.spec.crowdSize, rounds: parent.spec.rounds, seeds: b.seeds ?? parent.spec.seeds.length, useCustomers: parent.spec.useCustomers });
  spec.posts = [{ ...wpost }, { ...wpost, variant: 'C', text: b.text, image: undefined }];
  spec.crowd_seed = parent.spec.crowd_seed; // same crowd, same follower graph, same schedules as the parent run
  const st = startRun({} as RunInput, { parent: parent.spec.run_id, spec, crowd: { personas: parent.personas, proposal: parent.proposal, sampleReport: parent.sampleReport } });
  // the decision's own check: record the C run on the parent's decision now, and its result when it finishes
  if (parent.decision) {
    recordVerification(parent, st);
    persist(parent);
    st.bus.on((e: any) => { if (e.type === 'done' || e.type === 'error') { recordVerification(parent, st); persist(parent); } });
  }
  return { run_id: st.spec.run_id };
});
app.post('/api/runs/:id/sql', async (req) => queryActions(await getRun((req.params as any).id), (req.body as any).sql));

app.get('/api/queries/:qid', async (req) => {
  const q = getQuery((req.params as any).qid);
  if (!q) throw Object.assign(new Error('query not found'), { statusCode: 404 });
  return q;
});
app.get('/api/sources', async () => sourceSummary());
app.get('/api/trace', async (req) => traceStats((req.query as any).tag));
app.get('/api/backtest', async () => {
  const dir = path.join(config.paths.samples, 'backtest');
  if (!fs.existsSync(dir)) return { runs: [] };
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort().reverse();
  return { runs: files.map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))) };
});

app.setErrorHandler((err, _req, reply) => {
  const code = (err as any).statusCode ?? 500;
  const hint = (err as any).hint ?? (code === 404 ? 'Check the id or path.' : code >= 500 ? 'The run failed on the server; see the server log, or retry with SAMPLE_MODE=true for an offline run.' : 'Check the request body.');
  reply.status(code).send({ error: err.message, hint });
});

const start = async () => {
  await registerSources().catch((e) => console.warn('[sources]', e.message));
  for (const id of listRunsOnDisk().slice(0, 20)) await loadRun(id).catch(() => undefined);
  await app.listen({ port: config.port, host: process.env.HOST || '127.0.0.1' });
  const st = await providerStatus();
  console.log(`Dry Run on http://localhost:${config.port}  (sample mode: ${config.sampleMode})`);
  for (const p of st.providers) console.log(`  ${p.provider.padEnd(10)} ${p.online ? 'online ' : p.configured ? 'offline' : 'not set'}  ${p.detail}`);
};
start();

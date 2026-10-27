/**
 * Orchestrates a Dry Run: crowd builder -> per seed: base world -> twin forks (A, B) run side by side ->
 * metrics + verdict -> persisted run (SQLite + CSV registered as federated tables) -> report (async).
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from '../config.js';
import { registerSources, ensureCensus, geoIdForZip } from '../data/sources.js';
import { registerCsv } from '../data/federation.js';
import { proposeSegments } from '../audience/agent.js';
import { sampleCrowd, type SampleReport } from '../audience/sampler.js';
import { writeVoices } from '../audience/voice.js';
import type { Persona, SegmentProposal } from '../schemas/persona.js';
import type { ActionRecord } from '../schemas/action.js';
import { AgentMemory, type MemoryLine } from '../memory/hmem.js';
import { traceStats } from '../llm.js';
import { buildReport } from '../report/agent.js';
import { buildDecision, writeLaunchPlan } from '../report/decision.js';
import { Bus, Rng, sha } from '../util/core.js';
import { agentLog } from '../util/agentlog.js';
import { buildGraph } from './graph.js';
import { buildSchedule } from './schedule.js';
import { buildBase, SimWorld } from './world.js';
import { WorldRunner, type WorldResult } from './engine.js';
import { summarizeWorld, verdict, tippingPoint, validity, type Verdict, type WorldSummary } from './metrics.js';
import type { InjectedEvent, Post, RunSpec, SimEvent } from './types.js';

export interface RunInput {
  business: string;
  handle?: string;
  place?: string;
  zip: string;
  goal: string;
  postA: string;
  postB: string;
  imageA?: string;
  imageB?: string;
  crowdSize?: number;
  rounds?: number;
  seeds?: number;
  coreAgeBands?: string[];
  coreShare?: number;
  useCustomers?: boolean;
  events?: { round: number; text: string; target?: 'all' | 'core' | 'spillover' }[];
}

export interface RunState {
  spec: RunSpec;
  status: 'queued' | 'building' | 'running' | 'analyzing' | 'done' | 'error';
  phase: string;
  error?: string;
  created: string;
  proposal?: SegmentProposal & { served_by?: string; fallback?: boolean };
  sampleReport?: SampleReport;
  personas: Persona[];
  worlds: Omit<WorldResult, 'memories'>[];
  summaries: WorldSummary[];
  verdict?: Verdict;
  tipping?: Record<string, ReturnType<typeof tippingPoint>>;
  validity?: ReturnType<typeof validity>;
  fairness?: { seed: number; fingerprint: string; base_shapes: Record<string, string>; identical: boolean }[];
  report?: unknown;
  decision?: import('../report/decision.js').Decision;
  memories: Map<string, Map<string, MemoryLine[]>>; // world -> agent -> lines
  bus: Bus<SimEvent>;
  recent: SimEvent[];
  abort: AbortController;
  usage?: ReturnType<typeof traceStats>;
  live: WorldRunner[];   // runners of the seed in progress (interviews and records during a run)
  timing?: Record<string, number>;
}

export const runs = new Map<string, RunState>();

function newRunId(business: string) {
  const d = new Date();
  return `${d.toISOString().slice(0, 10).replace(/-/g, '')}-${business.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 20)}-${sha(String(d.getTime()) + Math.random(), 4)}`;
}

export function specFromInput(inp: RunInput, run_id = newRunId(inp.business)): RunSpec {
  const handle = inp.handle || `@${inp.business.toLowerCase().replace(/[^a-z0-9]+/g, '')}`;
  const rounds = Math.min(32, Math.max(6, inp.rounds ?? 24));
  const seeds = Math.max(1, Math.min(3, inp.seeds ?? 2));
  const local = !config.nvidia.apiKey && !config.nightshift.token;
  const crowd_seed = sha(JSON.stringify([inp.business, inp.zip, inp.postA, inp.postB, inp.crowdSize ?? 600, rounds, inp.coreAgeBands ?? null, inp.coreShare ?? null, inp.useCustomers ?? true]), 12);
  return {
    run_id, crowd_seed, business: inp.business, handle, place: inp.place || `ZIP ${inp.zip}`, zip: inp.zip, geoId: geoIdForZip(inp.zip), goal: inp.goal,
    posts: [
      { variant: 'A', text: inp.postA, business: inp.business, handle, image: inp.imageA },
      { variant: 'B', text: inp.postB, business: inp.business, handle, image: inp.imageB },
    ],
    crowdSize: Math.max(20, Math.min(1000, inp.crowdSize ?? 600)),
    rounds, startHour: 7, hourStep: rounds >= 24 ? 1 : Math.round(24 / rounds) || 1,
    seeds: Array.from({ length: seeds }, (_, i) => i + 1),
    batchSize: local ? 6 : 8,
    coreAgeBands: inp.coreAgeBands, coreShare: inp.coreShare, useCustomers: inp.useCustomers ?? true,
    events: (inp.events ?? []).map((e, i) => ({ id: `ev_${i + 1}`, round: e.round, text: e.text, target: e.target ?? 'all', author: 'user' })),
    mode: 'ab',
  };
}

function push(st: RunState, e: SimEvent) {
  if (e.type !== 'action') st.recent.push(e);
  else { st.recent.push(e); if (st.recent.length > 3000) st.recent.splice(0, st.recent.length - 3000); }
  st.bus.emit(e);
}
function phase(st: RunState, p: string, detail?: string, progress?: number) {
  st.phase = p;
  push(st, { type: 'status', run_id: st.spec.run_id, phase: p, detail, progress });
}

export interface StartOpts { parent?: string; spec?: RunSpec; crowd?: { personas: Persona[]; proposal: RunState['proposal']; sampleReport?: SampleReport } }

export function startRun(inp: RunInput, opts: StartOpts = {}): RunState {
  const spec = opts.spec ?? specFromInput(inp);
  if (opts.parent) spec.parent_run = opts.parent;
  const st: RunState = {
    spec, status: 'queued', phase: 'queued', created: new Date().toISOString(), personas: [], worlds: [], summaries: [],
    memories: new Map(), bus: new Bus(), recent: [], abort: new AbortController(), live: [],
  };
  runs.set(spec.run_id, st);
  execute(st, inp, opts.crowd).catch((e) => {
    st.status = 'error'; st.error = (e as Error).message;
    push(st, { type: 'error', run_id: spec.run_id, message: st.error });
    persist(st);
  });
  return st;
}

/** Crowd builder, shared by A/B runs and the backtest. */
export async function buildCrowd(spec: RunSpec, inp: { postA: string; postB: string }, onStatus: (p: string, d?: string, prog?: number) => void, presetProposal?: SegmentProposal) {
  const t0 = Date.now();
  onStatus('data', 'Registering Census, Pew, priors and customer sources');
  await registerSources({ customers: spec.useCustomers ? undefined : null });
  await ensureCensus([spec.geoId]);
  onStatus('audience', 'Audience agent is naming the segments');
  agentLog({ run_id: spec.run_id, agent_name: 'Orchestrator', action: 'build_crowd', target_agent: 'AudienceAgent', status: 'started', input_summary: `${spec.business}, ${spec.place}, ${spec.crowdSize} people` });
  let proposal: SegmentProposal & { served_by?: string; fallback?: boolean };
  if (presetProposal) proposal = presetProposal;
  else {
    const r = await proposeSegments({ postA: inp.postA, postB: inp.postB, goal: spec.goal, place: spec.place, business: spec.business }, spec.run_id);
    proposal = { ...r.proposal, served_by: r.served_by, fallback: r.fallback };
  }
  if (spec.coreAgeBands?.length) proposal.core.age_bands = spec.coreAgeBands as any;
  onStatus('sampling', 'Sampling people from Census and Pew rows');
  const { personas: raw, report } = await sampleCrowd({
    geoId: spec.geoId, zip: spec.zip, n: spec.crowdSize, seed: spec.crowd_seed ?? spec.run_id, coreAgeBands: proposal.core.age_bands,
    run_id: spec.run_id, coreName: proposal.core.name, spilloverName: proposal.spillover.name, coreShare: spec.coreShare, useCustomers: spec.useCustomers, platform: spec.platform,
  });
  onStatus('voices', 'Writing one-line voices (numbers first, model second)', 0);
  const ctx = `${spec.business} in ${spec.place}. Core: ${proposal.core.name}. ${proposal.interests.length ? `Interests: ${proposal.interests.join(', ')}.` : ''}`;
  const { voices, fallbacks, rejected } = await writeVoices(raw, ctx, spec.run_id, (done) => onStatus('voices', `${done}/${raw.length} voices`, done / raw.length));
  const personas: Persona[] = raw.map((p) => ({ ...p, voice: voices.get(p.id)! }));
  agentLog({ run_id: spec.run_id, agent_name: 'Orchestrator', action: 'crowd_ready', target_agent: 'CrowdAgent', status: 'success', output_summary: `${personas.length} people with voices; handing the crowd to the simulator`, ms: Date.now() - t0 });
  return { personas, proposal, report: { ...report, voice_fallbacks: fallbacks, voice_rejected: rejected } as SampleReport, ms: Date.now() - t0 };
}

async function execute(st: RunState, inp: RunInput, preset?: StartOpts['crowd']) {
  const spec = st.spec;
  agentLog({
    run_id: spec.run_id, agent_name: 'Orchestrator', action: 'run_started', status: 'started',
    input_summary: `${spec.business} (${spec.place}); A: "${spec.posts[0].text.slice(0, 70)}" vs B: "${spec.posts[1].text.slice(0, 70)}"; crowd ${spec.crowdSize}, ${spec.rounds} rounds, seeds ${spec.seeds.join(',')}, ${spec.events.length} scripted events`,
    refs: { crowd_seed: spec.crowd_seed, mode: spec.mode, parent_run: spec.parent_run, reused_crowd: Boolean(preset) },
  });
  const timing: Record<string, number> = {};
  st.status = 'building';
  if (preset) {
    await registerSources({ customers: spec.useCustomers ? undefined : null });
    await ensureCensus([spec.geoId]);
    st.personas = preset.personas; st.proposal = preset.proposal; st.sampleReport = preset.sampleReport;
    timing.crowd_ms = 0;
    phase(st, 'sampling', `Reusing the ${preset.personas.length}-person crowd from run ${spec.parent_run}`);
  } else {
    const crowd = await buildCrowd(spec, inp, (p, d, prog) => phase(st, p, d, prog));
    st.personas = crowd.personas; st.proposal = crowd.proposal; st.sampleReport = crowd.report;
    timing.crowd_ms = crowd.ms;
  }
  push(st, { type: 'crowd', run_id: spec.run_id, personas: st.personas, report: st.sampleReport, proposal: st.proposal });
  persist(st);
  await runWorlds(st, timing);
}

export async function runWorlds(st: RunState, timing: Record<string, number> = {}) {
  const spec = st.spec;
  st.status = 'running';
  const t1 = Date.now();
  const startMs = Date.UTC(2026, 9, 27, spec.startHour + 5, 0, 0); // local start hour (Central time) on 27 Oct 2026
  const results: WorldResult[] = [];
  st.fairness = [];
  for (const seed of spec.seeds) {
    phase(st, 'running', `Seed ${seed} of ${spec.seeds.length}: forking twin worlds`);
    const rng = new Rng(`${spec.crowd_seed ?? spec.run_id}:seed:${seed}`);
    const graph = buildGraph(st.personas, rng.fork('graph'));
    const schedule = buildSchedule(st.personas, rng.fork('schedule'), spec.rounds, spec.startHour, spec.hourStep);
    const base = buildBase(seed, st.personas, graph, schedule, startMs, spec.hourStep);
    const worlds = await Promise.all(spec.posts.map((post) => SimWorld.fork(`s${seed}:${post.variant}`, base, post)));
    const shapes = Object.fromEntries(worlds.map((w) => [w.worldId, w.baseShape]));
    st.fairness.push({ seed, fingerprint: base.fingerprint, base_shapes: shapes, identical: new Set(Object.values(shapes)).size === 1 });
    phase(st, 'running', `Seed ${seed} of ${spec.seeds.length}: ${spec.rounds} rounds, ${st.personas.length} people per world`);
    const runners = worlds.map((w, i) => new WorldRunner(spec, base, w, spec.posts[i], (e) => push(st, e), () => spec.events, st.abort.signal));
    st.live = runners;
    const res = await Promise.all(runners.map((r) => r.run()));
    results.push(...res);
    for (const r of res) {
      const m = new Map<string, MemoryLine[]>();
      for (const [aid, mem] of r.memories) m.set(aid, mem.all());
      st.memories.set(r.world_id, m);
    }
    const recs = res.flatMap((r) => r.records);
    const fired = recs.filter((x) => x.checks?.length).length;
    agentLog({ run_id: spec.run_id, agent_name: 'Orchestrator', action: 'seed_done', status: 'success', output_summary: `seed ${seed}: ${recs.length} decisions in ${res.length} twin worlds (${res.map((r) => `${r.world_id} ${r.records.length}`).join(', ')}); base shapes identical: ${st.fairness[st.fairness.length - 1].identical}` });
    agentLog({ run_id: spec.run_id, agent_name: 'Guard', action: 'validate_seed', target_agent: 'Orchestrator', status: fired ? 'needs_revision' : 'success', output_summary: `seed ${seed}: ${fired} of ${recs.length} decisions had a reason or comment withheld or an action made coherent`, refs: { seed, fired, total: recs.length } });
    agentLog({ run_id: spec.run_id, agent_name: 'MemoryAgent', action: 'hmem_seed', status: 'success', output_summary: `seed ${seed}: ${res.reduce((n, r) => n + [...r.memories.values()].reduce((m, a) => m + a.size, 0), 0)} H-MEM records stored across ${res.reduce((n, r) => n + r.memories.size, 0)} agent memories; ${recs.reduce((n, x) => n + Math.max(0, x.memory_ids.length - 1), 0)} recalls fed into prompts` });
    // save each finished seed, so an interrupted run keeps the seeds it completed
    try { persist(st); } catch (e) { console.warn(`[run] could not save seed ${seed}: ${(e as Error).message}`); }
  }
  timing.sim_ms = Date.now() - t1;
  st.status = 'analyzing';
  phase(st, 'analyzing', 'Computing verdict, segments and validity panel');
  st.worlds = results.map(({ memories, ...rest }) => rest);
  st.live = [];
  st.summaries = results.map((r) => summarizeWorld(r.world_id, r.variant, r.seed, r.records, r.stance, r.intent, st.personas));
  const vs = [spec.posts[0].variant, spec.posts[1].variant] as [string, string];
  st.verdict = verdict(st.summaries, vs, spec.mode === 'backtest' ? 'tap_rate' : 'intent_rate', spec.mode === 'backtest' ? 'click-through' : 'intent to visit');
  st.tipping = Object.fromEntries(results.map((r) => [r.world_id, tippingPoint(r.records)]));
  st.validity = validity(results.flatMap((r) => r.records), st.summaries);
  st.usage = traceStats(spec.run_id);
  st.timing = timing;
  push(st, { type: 'verdict', run_id: spec.run_id, verdict: st.verdict });
  agentLog({ run_id: spec.run_id, agent_name: 'Orchestrator', action: 'verdict', target_agent: spec.mode === 'ab' ? 'ReportWriter' : undefined, status: 'success', output_summary: st.verdict.headline, ms: timing.sim_ms, refs: { winner: st.verdict.winner, pooled: st.verdict.pooled } });
  persist(st);
  if (spec.mode === 'ab') {
    await exportForFederation(st);
    phase(st, 'report', 'Report agent is querying the action log');
    const t2 = Date.now();
    try {
      agentLog({ run_id: spec.run_id, agent_name: 'Orchestrator', action: 'handoff', target_agent: 'ReportWriter', status: 'started', input_summary: 'verdict and action log (queried through DataAgent)' });
      st.report = await buildReport(st);
      push(st, { type: 'report', run_id: spec.run_id, report: st.report });
    } catch (e) {
      st.report = { error: (e as Error).message };
      agentLog({ run_id: spec.run_id, agent_name: 'ReportWriter', action: 'build_report', status: 'error', output_summary: (e as Error).message.slice(0, 200) });
    }
    timing.report_ms = Date.now() - t2;
    // spend decision and launch plan: is a real test worth paying for, and what to test instead
    phase(st, 'report', 'Deciding whether a real test is worth paying for');
    const t3 = Date.now();
    try {
      agentLog({ run_id: spec.run_id, agent_name: 'Orchestrator', action: 'handoff', target_agent: 'DecisionAgent', status: 'started', input_summary: 'verdict, report and audience size' });
      st.decision = await buildDecision(st, { draft: false });
      writeLaunchPlan(runDir(spec.run_id), st.decision);
      persist(st);
    } catch (e) { console.warn(`[run] decision skipped: ${(e as Error).message}`); }
    // the Version C draft is separate: a provider failure here must not drop the decision above
    if (st.decision && !spec.parent_run && st.decision.call !== 'launch_winner') {
      try {
        st.decision = await buildDecision(st, { draft: true });
        writeLaunchPlan(runDir(spec.run_id), st.decision);
      } catch (e) {
        agentLog({ run_id: spec.run_id, agent_name: 'VersionCWriter', action: 'draft_version_c', target_agent: 'DecisionAgent', status: 'error', output_summary: `draft failed, decision kept without Version C: ${(e as Error).message.slice(0, 160)}` });
      }
    }
    timing.decision_ms = Date.now() - t3;
    st.usage = traceStats(spec.run_id);
  }
  st.status = 'done';
  st.phase = 'done';
  persist(st);
  phase(st, 'done', st.verdict.headline);
  push(st, { type: 'done', run_id: spec.run_id });
}

/**
 * Twin fairness: worlds run unsynchronised, so an event must land on a round that no world of the current seed
 * has started yet. The requested round is bumped past the furthest world; if the run is too far along, it is refused.
 */
export function injectEvent(st: RunState, ev: { round: number; text: string; target?: 'all' | 'core' | 'spillover' }): InjectedEvent {
  const furthest = Math.max(-1, ...st.live.map((r) => r.currentRound));
  const round = Math.max(ev.round, furthest + 1);
  if (st.status === 'done' || st.status === 'error' || round > st.spec.rounds - 1) throw Object.assign(new Error('Too late in the run for an event to reach both worlds.'), { statusCode: 409 });
  const e: InjectedEvent = { id: `ev_${st.spec.events.length + 1}`, round, text: ev.text, target: ev.target ?? 'all', author: 'user' };
  st.spec.events.push(e);
  push(st, { type: 'event_injected', run_id: st.spec.run_id, event: e });
  agentLog({ run_id: st.spec.run_id, agent_name: 'Orchestrator', action: 'event_injected', target_agent: 'CrowdAgent', status: 'success', input_summary: `round ${round} (${ev.round === round ? 'as asked' : `asked ${ev.round}, bumped for twin fairness`}), target ${e.target}`, output_summary: e.text.slice(0, 120), refs: { event_id: e.id } });
  return e;
}

// ------------------------------------------------------------------ persistence
export function runDir(id: string) { return path.join(config.paths.runs, id); }
export function allRecords(st: RunState): ActionRecord[] {
  return [...st.worlds.flatMap((w) => w.records), ...st.live.flatMap((r) => r.records)];
}

export function persist(st: RunState) {
  const dir = runDir(st.spec.run_id);
  fs.mkdirSync(dir, { recursive: true });
  const db = new Database(path.join(dir, 'actions.sqlite'));
  db.exec(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS personas (id TEXT PRIMARY KEY, json TEXT);
    CREATE TABLE IF NOT EXISTS actions (id TEXT PRIMARY KEY, run_id TEXT, agent_id TEXT, world_id TEXT, variant TEXT, seed INT, hour INT, item_id TEXT, item_kind TEXT, via TEXT, action TEXT, stance REAL, feeling INT, would_visit INT, reason TEXT, text TEXT, unsaid TEXT, memory_ids TEXT, repaired INT, checks TEXT);
    CREATE TABLE IF NOT EXISTS memories (world_id TEXT, agent_id TEXT, id TEXT, hour INT, text TEXT, tags TEXT, PRIMARY KEY (world_id, id));`);
  // runs saved before the guard existed have no checks column
  if (!(db.prepare('PRAGMA table_info(actions)').all() as { name: string }[]).some((c) => c.name === 'checks')) db.exec('ALTER TABLE actions ADD COLUMN checks TEXT');
  const meta = {
    spec: st.spec, status: st.status, phase: st.phase, error: st.error, created: st.created, proposal: st.proposal, sampleReport: st.sampleReport,
    summaries: st.summaries, verdict: st.verdict, tipping: st.tipping, validity: st.validity, fairness: st.fairness, report: st.report, decision: st.decision, usage: st.usage, timing: st.timing,
    worlds: st.worlds.map(({ records, ...w }) => w),
  };
  const tx = db.transaction(() => {
    const up = db.prepare('INSERT OR REPLACE INTO meta VALUES (?, ?)');
    for (const [k, v] of Object.entries(meta)) up.run(k, JSON.stringify(v ?? null));
    const pp = db.prepare('INSERT OR REPLACE INTO personas VALUES (?, ?)');
    for (const p of st.personas) pp.run(p.id, JSON.stringify(p));
    const ap = db.prepare('INSERT OR REPLACE INTO actions VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    for (const r of allRecords(st)) ap.run(r.id, r.run_id, r.agent_id, r.world_id, r.variant, r.seed, r.hour, r.item_id, r.item_kind, r.via, r.action, r.stance, r.feeling, r.would_visit ? 1 : 0, r.reason, r.text, r.unsaid, JSON.stringify(r.memory_ids), r.repaired ? 1 : 0, JSON.stringify(r.checks ?? []));
    const mp = db.prepare('INSERT OR REPLACE INTO memories VALUES (?,?,?,?,?,?)');
    for (const [w, agents] of st.memories) for (const [a, lines] of agents) for (const l of lines) mp.run(w, a, l.id, l.hour, l.text, JSON.stringify(l.tags));
  });
  tx();
  db.close();
  // plain-JSON files next to the action log so a run can be inspected without SQLite (BUILD_PLAN §9)
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(st.spec, null, 2));
  if (st.verdict || st.status === 'done' || st.status === 'error') {
    const recs = allRecords(st);
    fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify({
      run_id: st.spec.run_id, status: st.status, error: st.error, created: st.created,
      crowd: st.personas.length, rounds: st.spec.rounds, seeds: st.spec.seeds, events: st.spec.events,
      decisions: recs.length, reactions_to_post: recs.filter((r) => r.item_kind !== 'event').length, reactions_to_events: recs.filter((r) => r.item_kind === 'event').length,
      verdict: st.verdict, summaries: st.summaries, tipping: st.tipping, validity: st.validity, fairness: st.fairness,
      decision: st.decision ? { call: st.decision.call, headline: st.decision.headline, reasons: st.decision.reasons, actions: st.decision.actions.map((a) => ({ id: a.id, title: a.title, policy: a.policy, status: a.status })) } : null,
      usage: st.usage, timing: st.timing, report: (st.report as any)?.report ? { summary: (st.report as any).report.summary, recommendation: (st.report as any).report.recommendation, claims: (st.report as any).report.claims } : null,
    }, null, 2));
  }
}

const csvCell = (v: unknown) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

/** Export the run's action log and personas as CSV and register them as sim.* tables (BUILD_PLAN §6.1). */
export async function exportForFederation(st: RunState) {
  const dir = runDir(st.spec.run_id);
  const id = st.spec.run_id.replace(/[^a-z0-9]/gi, '_');
  const acols = ['id', 'agent_id', 'world_id', 'variant', 'seed', 'hour', 'item_id', 'item_kind', 'via', 'action', 'stance', 'feeling', 'would_visit', 'reason', 'text', 'unsaid'] as const;
  const recs = allRecords(st);
  fs.writeFileSync(path.join(dir, 'actions.csv'), [acols.join(','), ...recs.map((r) => acols.map((c) => csvCell((r as any)[c])).join(','))].join('\n') + '\n');
  const pcols = ['id', 'age', 'age_band', 'gender', 'zip', 'income_band', 'education', 'role', 'segment', 'price_sensitivity', 'skepticism', 'susceptibility', 'speak_p', 'activity', 'influence', 'daily_minutes', 'is_customer', 'voice'];
  fs.writeFileSync(path.join(dir, 'personas.csv'), [pcols.join(','), ...st.personas.map((p) => pcols.map((c) => csvCell(c === 'is_customer' ? (p.customer ? 1 : 0) : (p as any)[c])).join(','))].join('\n') + '\n');
  await registerCsv(`sim.actions_${id}`, path.join(dir, 'actions.csv'));
  await registerCsv(`sim.personas_${id}`, path.join(dir, 'personas.csv'));
}

export function tableIds(st: RunState) {
  const id = st.spec.run_id.replace(/[^a-z0-9]/gi, '_');
  return { actions: `sim.actions_${id}`, personas: `sim.personas_${id}` };
}

/** Load a finished run from disk (after a server restart). */
export async function loadRun(id: string): Promise<RunState | undefined> {
  if (runs.has(id)) return runs.get(id);
  const file = path.join(runDir(id), 'actions.sqlite');
  if (!fs.existsSync(file)) return undefined;
  const db = new Database(file, { readonly: true });
  const meta = Object.fromEntries((db.prepare('SELECT key, value FROM meta').all() as any[]).map((r) => [r.key, JSON.parse(r.value)]));
  const personas = (db.prepare('SELECT json FROM personas ORDER BY id').all() as any[]).map((r) => JSON.parse(r.json));
  const actions = (db.prepare('SELECT * FROM actions ORDER BY rowid').all() as any[]).map((r) => ({ ...r, would_visit: !!r.would_visit, repaired: !!r.repaired, memory_ids: JSON.parse(r.memory_ids), checks: r.checks ? JSON.parse(r.checks) : [] })) as ActionRecord[];
  const memories = new Map<string, Map<string, MemoryLine[]>>();
  for (const r of db.prepare('SELECT * FROM memories ORDER BY hour, rowid').all() as any[]) {
    if (!memories.has(r.world_id)) memories.set(r.world_id, new Map());
    const m = memories.get(r.world_id)!;
    if (!m.has(r.agent_id)) m.set(r.agent_id, []);
    m.get(r.agent_id)!.push({ id: r.id, hour: r.hour, text: r.text, tags: JSON.parse(r.tags) });
  }
  db.close();
  const st: RunState = {
    spec: meta.spec, status: meta.status, phase: meta.phase, error: meta.error, created: meta.created, proposal: meta.proposal, sampleReport: meta.sampleReport,
    personas, worlds: (meta.worlds ?? []).map((w: any) => ({ ...w, records: actions.filter((a) => a.world_id === w.world_id) })),
    summaries: meta.summaries ?? [], verdict: meta.verdict, tipping: meta.tipping, validity: meta.validity, fairness: meta.fairness, report: meta.report, decision: meta.decision ?? undefined,
    usage: meta.usage, timing: meta.timing, memories, bus: new Bus(), recent: [], abort: new AbortController(), live: [],
  };
  if (st.status !== 'done' && st.status !== 'error') {
    if (st.verdict) st.status = 'done';
    else { st.status = 'error'; st.error = 'Run was interrupted (server restarted).'; }
  }
  runs.set(id, st);
  if (st.spec.mode === 'ab' && fs.existsSync(path.join(runDir(id), 'actions.csv'))) {
    const t = tableIds(st);
    await registerCsv(t.actions, path.join(runDir(id), 'actions.csv'));
    await registerCsv(t.personas, path.join(runDir(id), 'personas.csv'));
  }
  return st;
}

export function listRunsOnDisk() {
  if (!fs.existsSync(config.paths.runs)) return [];
  return fs.readdirSync(config.paths.runs).filter((d) => fs.existsSync(path.join(config.paths.runs, d, 'actions.sqlite'))).sort().reverse();
}

/** Rebuild an agent's H-MEM from its stored lines (for interviews after a restart). */
export function memoryFor(st: RunState, worldId: string, agentId: string): AgentMemory {
  const live = st.live.find((r) => r.worldId === worldId)?.memories.get(agentId);
  if (live) return live;
  const lines = st.memories.get(worldId)?.get(agentId) ?? [];
  const mem = new AgentMemory(agentId, worldId, 0, st.spec.hourStep);
  for (const l of lines) mem.remember(l.hour, l.text, l.tags, l.id);
  return mem;
}

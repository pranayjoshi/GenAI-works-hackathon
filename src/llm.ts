/**
 * Every model call in Dry Run goes through here.
 * Provider chain: Nightshift (Meterless local proxy) -> direct NVIDIA API -> local Nemotron via Ollama.
 * Each call is traced (role, provider, model, served_by, latency, tokens), validated with zod
 * (one repair retry), and recorded by request hash so SAMPLE_MODE can replay a whole run offline.
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { config, THINKING, type ProviderName, type Role } from './config.js';
import { Bus, RpmLimiter, Semaphore, sha, sleep } from './util/core.js';

export interface TraceEntry {
  ts: string;
  tag: string;
  role: Role;
  provider: ProviderName | 'replay';
  model: string;
  served_by: string;
  ms: number;
  tokens_in: number;
  tokens_out: number;
  ok: boolean;
  repaired: boolean;
  error?: string;
}

export interface ChatOpts<T> {
  role: Role;
  system: string;
  user: string;
  schema?: z.ZodType<T>;
  schemaName?: string;
  maxTokens?: number;
  temperature?: number;
  /** groups calls in the trace (run id, "backtest", ...) */
  tag?: string;
  /** override thinking for this call */
  thinking?: boolean;
}

export interface ChatResult<T> {
  text: string;
  data?: T;
  ok: boolean;
  repaired: boolean;
  served_by: string;
  provider: string;
  model: string;
  tokens_in: number;
  tokens_out: number;
}

export const traceBus = new Bus<TraceEntry>();

// ---------------------------------------------------------------- trace + stats
const tracePath = path.join(config.paths.runs, 'trace.jsonl');
fs.mkdirSync(config.paths.runs, { recursive: true });
const stats = new Map<string, { calls: number; tokens_in: number; tokens_out: number; ms: number; errors: number; served_by: Record<string, number> }>();

function trace(e: TraceEntry) {
  try { fs.appendFileSync(tracePath, JSON.stringify(e) + '\n'); } catch { /* trace is best effort */ }
  const key = `${e.tag}|${e.role}|${e.model}`;
  const s = stats.get(key) ?? { calls: 0, tokens_in: 0, tokens_out: 0, ms: 0, errors: 0, served_by: {} };
  s.calls++; s.tokens_in += e.tokens_in; s.tokens_out += e.tokens_out; s.ms += e.ms;
  if (!e.ok) s.errors++;
  s.served_by[e.served_by] = (s.served_by[e.served_by] ?? 0) + 1;
  stats.set(key, s);
  traceBus.emit(e);
}

export function traceStats(tag?: string) {
  const out: { tag: string; role: string; model: string; calls: number; tokens_in: number; tokens_out: number; avg_ms: number; errors: number; served_by: Record<string, number> }[] = [];
  for (const [k, s] of stats) {
    const [t, role, model] = k.split('|');
    if (tag && t !== tag) continue;
    out.push({ tag: t, role, model, calls: s.calls, tokens_in: s.tokens_in, tokens_out: s.tokens_out, avg_ms: Math.round(s.ms / Math.max(1, s.calls)), errors: s.errors, served_by: s.served_by });
  }
  return out;
}

// ---------------------------------------------------------------- record / replay
let recDb: Database.Database | null = null;
function rec() {
  if (!recDb) {
    fs.mkdirSync(path.dirname(config.paths.recordings), { recursive: true });
    recDb = new Database(config.paths.recordings);
    recDb.pragma('busy_timeout = 10000');
    try { recDb.pragma('journal_mode = WAL'); } catch { /* another process holds it; keep its mode */ }
    recDb.exec('CREATE TABLE IF NOT EXISTS llm (key TEXT PRIMARY KEY, role TEXT, provider TEXT, model TEXT, served_by TEXT, text TEXT, tokens_in INT, tokens_out INT, created TEXT)');
    try { recDb.exec('ALTER TABLE llm ADD COLUMN repaired INT DEFAULT 0'); } catch { /* column exists */ }
  }
  return recDb;
}
const occurrences = new Map<string, number>();
/** Identical prompts within one run are numbered #1, #2...; the counter is per run so a second replay starts at #1. */
function recordKey(o: ChatOpts<unknown>) {
  const base = sha(JSON.stringify([o.role, o.system, o.user, o.schemaName ?? '', o.temperature ?? null]), 24);
  const scope = `${(o.tag ?? 'misc').split(':')[0]}|${base}`;
  const n = (occurrences.get(scope) ?? 0) + 1;
  occurrences.set(scope, n);
  return `${base}#${n}`;
}

// ---------------------------------------------------------------- providers
interface RawResult { text: string; tokens_in: number; tokens_out: number; served_by: string; model: string }

const sems: Record<ProviderName, Semaphore> = {
  nightshift: new Semaphore(config.nightshift.concurrency),
  nvidia: new Semaphore(config.nvidia.concurrency),
  ollama: new Semaphore(config.ollama.concurrency),
};
const nvidiaRpm = new RpmLimiter(config.nvidia.rpm);
const downUntil: Partial<Record<ProviderName, number>> = {};
const lastError: Partial<Record<ProviderName, string>> = {};

function providerConfigured(p: ProviderName): boolean {
  if (p === 'nightshift') return Boolean(config.nightshift.token);
  if (p === 'nvidia') return Boolean(config.nvidia.apiKey);
  return true;
}

async function openAiCompat(p: 'nightshift' | 'nvidia', o: ChatOpts<unknown>, jsonSchema: unknown): Promise<RawResult> {
  const c = p === 'nightshift' ? config.nightshift : config.nvidia;
  const model = c.models[o.role];
  const thinking = o.thinking ?? THINKING[o.role];
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (p === 'nightshift') {
    headers.authorization = `Bearer ${config.nightshift.token}`;
    headers['meterless-app'] = config.nightshift.app;
    headers['meterless-scope'] = 'user';
  } else {
    headers.authorization = `Bearer ${config.nvidia.apiKey}`;
    await nvidiaRpm.take();
  }
  const system = jsonSchema
    ? `${o.system}\n\nReply with a single JSON object that matches this JSON Schema. No prose, no code fences.\n${JSON.stringify(jsonSchema)}`
    : o.system;
  const body: Record<string, unknown> = {
    model,
    messages: [{ role: 'system', content: system }, { role: 'user', content: o.user }],
    temperature: o.temperature ?? (o.role === 'crowd' || o.role === 'voice' ? 0.9 : 0.4),
    top_p: 0.95,
    max_tokens: (o.maxTokens ?? 1200) + (thinking ? 2000 : 0),
    chat_template_kwargs: { enable_thinking: thinking },
  };
  const res = await fetch(`${c.baseUrl}/chat/completions`, {
    method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) throw new Error(`${p} HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j = (await res.json()) as any;
  const text: string = j.choices?.[0]?.message?.content ?? '';
  const servedHeader = res.headers.get('x-served-by') ?? res.headers.get('meterless-served-by');
  return {
    text,
    tokens_in: j.usage?.prompt_tokens ?? Math.ceil((system.length + o.user.length) / 4),
    tokens_out: j.usage?.completion_tokens ?? Math.ceil(text.length / 4),
    served_by: servedHeader ?? `${p}:${j.model ?? model}`,
    model,
  };
}

async function ollama(o: ChatOpts<unknown>, jsonSchema: unknown): Promise<RawResult> {
  const model = config.ollama.models[o.role];
  // A laptop-sized local model is too slow to think on every call; hosted roles keep THINKING as planned.
  const thinking = config.ollama.thinking && (o.thinking ?? THINKING[o.role]);
  const body: Record<string, unknown> = {
    model,
    stream: false,
    think: thinking,
    keep_alive: '30m',
    options: {
      temperature: o.temperature ?? (o.role === 'crowd' || o.role === 'voice' ? 0.9 : 0.4),
      num_predict: (o.maxTokens ?? 1200) + (thinking ? 1500 : 0),
      num_ctx: o.role === 'reason' || o.role === 'review' ? 16384 : 8192,
    },
    messages: [{ role: 'system', content: o.system }, { role: 'user', content: o.user }],
  };
  if (jsonSchema) body.format = jsonSchema;
  const res = await fetch(`${config.ollama.baseUrl}/api/chat`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(300_000),
  });
  if (!res.ok) throw new Error(`ollama HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j = (await res.json()) as any;
  return {
    text: j.message?.content ?? '',
    tokens_in: j.prompt_eval_count ?? 0,
    tokens_out: j.eval_count ?? 0,
    served_by: `ollama-local:${model}`,
    model,
  };
}

async function callProvider(p: ProviderName, o: ChatOpts<unknown>, jsonSchema: unknown): Promise<RawResult> {
  return sems[p].run(() => (p === 'ollama' ? ollama(o, jsonSchema) : openAiCompat(p, o, jsonSchema)));
}

function isTransient(msg: string) {
  return /HTTP (429|500|502|503|504)|timeout|aborted|ECONNRESET|fetch failed/i.test(msg);
}

async function rawChat(o: ChatOpts<unknown>, jsonSchema: unknown): Promise<RawResult & { provider: ProviderName }> {
  const errors: string[] = [];
  for (const p of config.providers) {
    if (!providerConfigured(p)) continue;
    if ((downUntil[p] ?? 0) > Date.now()) continue;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await callProvider(p, o, jsonSchema);
        return { ...r, provider: p };
      } catch (e) {
        const msg = (e as Error).message;
        lastError[p] = msg;
        if (/ECONNREFUSED|HTTP 401|HTTP 403|HTTP 404/.test(msg) || (e as any)?.cause?.code === 'ECONNREFUSED') {
          downUntil[p] = Date.now() + 60_000; // provider unavailable; fall through to the next one
          errors.push(`${p}: ${msg}`);
          break;
        }
        if (isTransient(msg) && attempt < 2) { await sleep(1500 * (attempt + 1)); continue; }
        errors.push(`${p}: ${msg}`);
        break;
      }
    }
  }
  throw new Error(`No model provider answered. ${errors.join(' | ') || 'No provider configured.'}`);
}

/** Pull the first JSON object out of a model reply (fences and stray prose tolerated, no regex repair of content). */
export function extractJson(text: string): unknown {
  const t = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  try { return JSON.parse(t); } catch { /* fall through */ }
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start >= 0 && end > start) return JSON.parse(t.slice(start, end + 1));
  throw new Error('no JSON object in reply');
}

// ---------------------------------------------------------------- public API
export async function chat<T = unknown>(o: ChatOpts<T>): Promise<ChatResult<T>> {
  const tag = o.tag ?? 'misc';
  const jsonSchema = o.schema ? zodToJsonSchema(o.schema, { target: 'openApi3', $refStrategy: 'none' }) : undefined;
  const key = recordKey(o as ChatOpts<unknown>);
  const t0 = Date.now();

  const finish = (raw: { text: string; tokens_in: number; tokens_out: number; served_by: string; model: string; provider: string }, repaired: boolean): ChatResult<T> => {
    let data: T | undefined;
    let ok = true;
    if (o.schema) {
      try {
        const parsed = o.schema.safeParse(extractJson(raw.text));
        if (parsed.success) data = parsed.data; else ok = false;
      } catch { ok = false; }
    }
    return { ...raw, data, ok, repaired };
  };

  const replayRow = config.sampleMode ? (rec().prepare('SELECT * FROM llm WHERE key = ?').get(key) as any) : undefined;
  if (config.sampleMode && !replayRow && config.sampleStrict) {
    trace({ ts: new Date().toISOString(), tag, role: o.role, provider: 'replay', model: '-', served_by: 'replay-miss', ms: 0, tokens_in: 0, tokens_out: 0, ok: false, repaired: false, error: 'not recorded' });
    throw new Error(`SAMPLE_MODE: no recording for this ${o.role} call. Run once with a provider to record it.`);
  }
  if (replayRow) {
    const row = replayRow;
    if (o.role === 'crowd' && config.replayCrowdMs > 0) await sleep(config.replayCrowdMs);
    const r = finish({ text: row.text, tokens_in: row.tokens_in, tokens_out: row.tokens_out, served_by: row.served_by, model: row.model, provider: 'replay' }, Boolean(row.repaired));
    trace({ ts: new Date().toISOString(), tag, role: o.role, provider: 'replay', model: row.model, served_by: `replay(${row.served_by})`, ms: 0, tokens_in: row.tokens_in, tokens_out: row.tokens_out, ok: r.ok, repaired: false });
    return r;
  }

  let raw: RawResult & { provider: ProviderName };
  try {
    raw = await rawChat(o as ChatOpts<unknown>, jsonSchema);
  } catch (e) {
    trace({ ts: new Date().toISOString(), tag, role: o.role, provider: 'ollama', model: '-', served_by: 'none', ms: Date.now() - t0, tokens_in: 0, tokens_out: 0, ok: false, repaired: false, error: (e as Error).message.slice(0, 300) });
    throw e;
  }
  let result = finish(raw, false);
  let tokensIn = raw.tokens_in, tokensOut = raw.tokens_out;

  if (o.schema && !result.ok) {
    // one repair retry: show the model its own output and ask for valid JSON only
    const repairOpts: ChatOpts<unknown> = {
      ...o,
      user: `${o.user}\n\nYour previous reply was not valid JSON for the required schema:\n${raw.text.slice(0, 1500)}\n\nReturn only the corrected JSON object.`,
      temperature: 0.2,
    } as ChatOpts<unknown>;
    try {
      const raw2 = await rawChat(repairOpts, jsonSchema);
      tokensIn += raw2.tokens_in; tokensOut += raw2.tokens_out;
      const r2 = finish(raw2, true);
      if (r2.ok) { result = r2; raw = raw2; }
    } catch { /* keep the failed result; caller applies the documented default */ }
  }

  if (config.record) {
    try {
      rec().prepare('INSERT OR REPLACE INTO llm (key, role, provider, model, served_by, text, tokens_in, tokens_out, created, repaired) VALUES (?,?,?,?,?,?,?,?,?,?)').run(key, o.role, raw.provider, raw.model, raw.served_by, raw.text, tokensIn, tokensOut, new Date().toISOString(), result.repaired ? 1 : 0);
    } catch (e) { console.warn(`[llm] recording skipped: ${(e as Error).message}`); }
  }
  trace({ ts: new Date().toISOString(), tag, role: o.role, provider: raw.provider, model: raw.model, served_by: raw.served_by, ms: Date.now() - t0, tokens_in: tokensIn, tokens_out: tokensOut, ok: result.ok, repaired: result.repaired });
  return { ...result, tokens_in: tokensIn, tokens_out: tokensOut };
}

/** Provider status for the UI and the probe script. */
export async function providerStatus() {
  const out: { provider: ProviderName; configured: boolean; online: boolean; detail: string; models: Record<string, string> }[] = [];
  for (const p of ['nightshift', 'nvidia', 'ollama'] as ProviderName[]) {
    const configured = providerConfigured(p);
    let online = false, detail = configured ? '' : 'not configured';
    if (configured) {
      try {
        if (p === 'ollama') {
          const r = await fetch(`${config.ollama.baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
          const j = (await r.json()) as any;
          const names: string[] = (j.models ?? []).map((m: any) => m.name);
          online = names.some((n) => n.startsWith('nemotron'));
          detail = online ? `local models: ${names.filter((n) => n.includes('nemotron')).join(', ')}` : 'no nemotron model pulled';
        } else {
          const c = p === 'nightshift' ? config.nightshift : config.nvidia;
          const headers: Record<string, string> = { authorization: `Bearer ${p === 'nightshift' ? config.nightshift.token : config.nvidia.apiKey}` };
          if (p === 'nightshift') { headers['meterless-app'] = config.nightshift.app; headers['meterless-scope'] = 'user'; }
          const r = await fetch(`${c.baseUrl}/models`, { headers, signal: AbortSignal.timeout(5000) });
          online = r.ok;
          detail = `GET /models -> ${r.status}`;
        }
      } catch (e) { detail = (e as Error).message; }
    }
    const models = p === 'ollama' ? config.ollama.models : p === 'nvidia' ? config.nvidia.models : config.nightshift.models;
    out.push({ provider: p, configured, online, detail: lastError[p] && !online ? `${detail}; last error: ${lastError[p]}` : detail, models });
  }
  return { sampleMode: config.sampleMode, order: config.providers, providers: out };
}

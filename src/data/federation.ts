/**
 * One SQL layer over every source Dry Run uses (BUILD_PLAN §3.1, §6.1).
 *
 * Engine "zetaris": the Zetaris Lightning REST API (login -> open query -> page -> close), used when
 *   ZETARIS_BASE_URL and credentials are set. Sources are registered with Lightning SQL.
 * Engine "local": an in-process DuckDB that registers the same sources in place (CSV files read where
 *   they live, the Census REST response cached as JSON) and runs the same SQL. The UI labels which
 *   engine answered every query, so nothing claims Zetaris when it was DuckDB.
 *
 * Every query gets a query_id. Persona receipts and report claims cite these ids; /api/queries/:id
 * shows the SQL, the engine and the rows.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';
import { config, zetarisConfigured } from '../config.js';
import { sha } from '../util/core.js';

export type Row = Record<string, unknown>;
export interface QueryResult { query_id: string; engine: 'zetaris' | 'local-duckdb'; rows: Row[]; ms: number }
export interface QueryLogEntry { query_id: string; label: string; sql: string; engine: string; row_count: number; ms: number; ts: string; sample: Row[]; note?: string }

const queryLog = new Map<string, QueryLogEntry>();
const logPath = path.join(config.paths.runs, 'queries.jsonl');

function logQuery(e: QueryLogEntry) {
  queryLog.set(e.query_id, e);
  try { fs.appendFileSync(logPath, JSON.stringify(e) + '\n'); } catch { /* log is best effort */ }
}
export function getQuery(id: string): QueryLogEntry | undefined {
  if (queryLog.has(id)) return queryLog.get(id);
  try {
    const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const e = JSON.parse(lines[i]) as QueryLogEntry;
      if (e.query_id === id) return e;
    }
  } catch { /* no log yet */ }
  return undefined;
}

// ------------------------------------------------------------------ local DuckDB engine
let duck: DuckDBConnection | null = null;
async function local(): Promise<DuckDBConnection> {
  if (!duck) {
    const inst = await DuckDBInstance.create(':memory:');
    duck = await inst.connect();
    for (const s of ['census', 'pew', 'priors', 'biz', 'upworthy', 'sim']) await duck.run(`CREATE SCHEMA IF NOT EXISTS ${s}`);
  }
  return duck;
}

function normalise(v: unknown): unknown {
  if (typeof v === 'bigint') return Number(v);
  if (v && typeof v === 'object' && 'toString' in v && !(Array.isArray(v))) {
    const s = String(v);
    const n = Number(s);
    return Number.isFinite(n) && s.trim() !== '' ? n : s;
  }
  return v;
}

// ------------------------------------------------------------------ Zetaris engine
// Follows the published Zetaris API spec (api.saas.enterprise.zetaris.com/redoc, OpenAPI 3.1):
//   GET    /api/v1.0/auth/login                (basic auth -> idToken)
//   POST   /api/v1.0/query/sql/start           {select, pageLimit<=100} -> {records, pageNumber, totalPages, totalCount, queryToken}
//   GET    /api/v1.0/query/sql/page?queryToken&pageLimit&pageNumber -> {records, ...}
//   DELETE /api/v1.0/query/sql/close/{queryToken}
// Every call carries X-Request-ID (uuid) and X-Org-ID. Query calls want an API token as the bearer;
// with only a username and password we log in and use the idToken.
const PAGE = 100;
let zToken: string | null = null;
const zUrl = (p: string) => `${config.zetaris.baseUrl.replace(/\/+$/, '').replace(/\/api\/v1\.0$/, '')}${p}`;
function zHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { 'x-request-id': crypto.randomUUID(), 'x-org-id': config.zetaris.orgId, ...extra };
}
async function zAuth(): Promise<Record<string, string>> {
  const z = config.zetaris;
  if (!zToken) {
    if (z.apiKey) zToken = z.apiKey;
    else {
      const res = await fetch(zUrl('/api/v1.0/auth/login'), { headers: zHeaders({ authorization: `Basic ${Buffer.from(`${z.user}:${z.password}`).toString('base64')}` }) });
      if (!res.ok) throw new ZetarisDown(`login HTTP ${res.status}`);
      zToken = ((await res.json()) as { idToken: string }).idToken;
    }
  }
  return zHeaders({ authorization: `Bearer ${zToken}`, 'content-type': 'application/json' });
}

/** Auth or network failure: stop sending queries to Zetaris for the rest of the process. */
class ZetarisDown extends Error {}

async function zFetch(p: string, init: RequestInit = {}): Promise<Response> {
  let res: Response;
  try { res = await fetch(zUrl(p), { ...init, headers: await zAuth(), signal: AbortSignal.timeout(60_000) }); }
  catch (e) { throw e instanceof ZetarisDown ? e : new ZetarisDown(`network: ${(e as Error).message}`); }
  if (res.status === 401 || res.status === 403) throw new ZetarisDown(`HTTP ${res.status} on ${p}`);
  return res;
}

export async function zetarisQuery(sql: string): Promise<Row[]> {
  const z = config.zetaris;
  const open = await zFetch(z.openPath, { method: 'POST', body: JSON.stringify({ select: sql, pageLimit: PAGE }) });
  if (!open.ok) throw new Error(`Zetaris start HTTP ${open.status}: ${(await open.text()).slice(0, 200)}`);
  const first = (await open.json()) as { records?: Row[]; pageNumber: number; totalPages: number; totalCount: number; queryToken: string };
  const rows: Row[] = [...(first.records ?? [])];
  try {
    for (let n = first.pageNumber + 1; n < first.pageNumber + first.totalPages && rows.length < first.totalCount && rows.length < 200_000; n++) {
      const q = new URLSearchParams({ queryToken: first.queryToken, pageLimit: String(PAGE), pageNumber: String(n) });
      const page = await zFetch(`${z.pagePath}?${q}`);
      if (!page.ok) throw new Error(`Zetaris page ${n} HTTP ${page.status}`);
      const recs = ((await page.json()) as { records?: Row[] }).records ?? [];
      if (!recs.length) break;
      rows.push(...recs);
    }
  } finally {
    await zFetch(`${z.closePath}/${encodeURIComponent(first.queryToken)}`, { method: 'DELETE' }).catch(() => {});
  }
  return rows.map(numeric);
}

/** The REST API returns every value as text; give numbers back as numbers, the way DuckDB does. */
const NUM = /^-?(0|[1-9]\d{0,14})(\.\d+)?([eE][-+]?\d+)?$/;
function numeric(r: Row): Row {
  return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'string' && NUM.test(v) ? Number(v) : v]));
}

let zetarisDown = false;
/**
 * Tables registered on Zetaris, local name -> name on Zetaris. A query goes to Zetaris only when every table
 * it names is one of these, with the names rewritten. scripts/zetaris-register.sh writes the registry file.
 */
const zetarisTables = new Map<string, string>();
type Registry = Record<string, { zetaris: string; path: string }>;
function registry(): Registry {
  try { return JSON.parse(fs.readFileSync(process.env.ZETARIS_REGISTRY ?? path.join(config.paths.data, 'cache', 'zetaris-registered.json'), 'utf8')) as Registry; } catch { return {}; }
}
const toZetaris = (sql: string) => sql.replace(/\b(census|pew|priors|biz|upworthy|sim)\.(\w+)/gi, (m) => zetarisTables.get(m.toLowerCase()) ?? m);
export function engineName(): 'zetaris' | 'local-duckdb' {
  return zetarisConfigured() && !zetarisDown ? 'zetaris' : 'local-duckdb';
}
const tablesIn = (sql: string) => [...sql.matchAll(/\b(census|pew|priors|biz|upworthy|sim)\.(\w+)/gi)].map((m) => `${m[1]}.${m[2]}`.toLowerCase());

// ------------------------------------------------------------------ public API
let qCounter = 0;
export async function query(sql: string, label = 'query'): Promise<QueryResult> {
  const t0 = Date.now();
  const query_id = `q_${sha(sql, 8)}_${(++qCounter).toString(36)}`;
  let rows: Row[] | null = null;
  let engine: QueryResult['engine'] = 'local-duckdb';
  let note: string | undefined;
  const names = tablesIn(sql);
  if (engineName() === 'zetaris' && names.length && names.every((t) => zetarisTables.has(t))) {
    try { rows = await zetarisQuery(toZetaris(sql)); engine = 'zetaris'; } catch (e) {
      if (e instanceof ZetarisDown) zetarisDown = true;
      note = `zetaris failed (${(e as Error).message.slice(0, 160)}); answered by local DuckDB`;
      console.warn(`[federation] ${label}: ${note}`);
    }
  }
  if (!rows) rows = await localQuery(sql);
  const ms = Date.now() - t0;
  logQuery({ query_id, label, sql: sql.trim(), engine, row_count: rows.length, ms, ts: new Date().toISOString(), sample: rows.slice(0, 20), ...(note ? { note } : {}) });
  return { query_id, engine, rows, ms };
}

async function localQuery(sql: string): Promise<Row[]> {
  const c = await local();
  const r = await c.runAndReadAll(sql);
  return r.getRowObjects().map((o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, normalise(v)])));
}

/**
 * Register a CSV file in place as <schema>.<table>. Always registered in local DuckDB. Also registered on
 * Zetaris as a Lightning file-store table when ZETARIS_FILE_ROOT says where Zetaris sees this project's files
 * (a hosted instance cannot read paths on this laptop, so without it the table stays local and is labelled so).
 */
export async function registerCsv(table: string, file: string, opts: { lightningDb?: string } = {}) {
  const abs = path.resolve(file);
  if (engineName() === 'zetaris' && config.zetaris.fileRoot) {
    const [db, t] = table.split('.');
    const zdb = opts.lightningDb ?? db;
    const zpath = `${config.zetaris.fileRoot.replace(/\/+$/, '')}/${path.relative(process.cwd(), abs).split(path.sep).join('/')}`;
    const all = registry();
    const reg = all[table.toLowerCase()];
    if (reg && reg.path === zpath) zetarisTables.set(table.toLowerCase(), reg.zetaris); // registered by scripts/zetaris-register.sh
    else if (Object.keys(all).length) { /* a local bundle takes DDL only through its CLI; this table stays on DuckDB */ }
    else try {
      await zetarisQuery(`CREATE LIGHTNING DATABASE IF NOT EXISTS ${zdb} DESCRIBE BY "Dry Run ${db}" OPTIONS ()`).catch(() => [] as Row[]);
      await zetarisQuery(`CREATE LIGHTNING FILESTORE TABLE IF NOT EXISTS ${t} FROM ${zdb} FORMAT CSV OPTIONS (PATH "${zpath}", HEADER "true", INFERSCHEMA "true")`);
      zetarisTables.set(table.toLowerCase(), table.toLowerCase());
    } catch (e) {
      if (e instanceof ZetarisDown) zetarisDown = true;
      console.warn(`[federation] Zetaris register ${table} failed: ${(e as Error).message}`);
    }
  }
  const c = await local();
  await c.run(`CREATE OR REPLACE VIEW ${table} AS SELECT * FROM read_csv_auto('${abs.replace(/'/g, "''")}', header=true)`);
}

/** Which engine would answer a query over these tables (for the sources panel). */
export function tableEngine(table: string): 'zetaris' | 'local-duckdb' {
  return engineName() === 'zetaris' && zetarisTables.has(table.toLowerCase()) ? 'zetaris' : 'local-duckdb';
}

/** Register a JSON array file (e.g. a cached REST response flattened to rows) as <schema>.<table>. */
export async function registerJsonRows(table: string, file: string) {
  const abs = path.resolve(file);
  const c = await local();
  await c.run(`CREATE OR REPLACE TABLE ${table} AS SELECT * FROM read_json_auto('${abs.replace(/'/g, "''")}')`);
}

export async function tableExists(table: string): Promise<boolean> {
  try { await localQuery(`SELECT 1 FROM ${table} LIMIT 1`); return true; } catch { return false; }
}

export function recentQueries(n = 50): QueryLogEntry[] {
  return [...queryLog.values()].slice(-n);
}

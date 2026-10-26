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
export interface QueryLogEntry { query_id: string; label: string; sql: string; engine: string; row_count: number; ms: number; ts: string; sample: Row[] }

const queryLog = new Map<string, QueryLogEntry>();
const logPath = path.join(config.paths.runs, 'queries.jsonl');

function logQuery(e: QueryLogEntry) {
  queryLog.set(e.query_id, e);
  fs.appendFile(logPath, JSON.stringify(e) + '\n', () => {});
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
let zToken: string | null = null;
async function zetarisHeaders(): Promise<Record<string, string>> {
  const z = config.zetaris;
  if (!zToken) {
    if (z.apiKey) zToken = z.apiKey;
    else {
      const res = await fetch(`${z.baseUrl}/auth/login`, {
        headers: { authorization: `Basic ${Buffer.from(`${z.user}:${z.password}`).toString('base64')}` },
      });
      if (!res.ok) throw new Error(`Zetaris login HTTP ${res.status}`);
      zToken = ((await res.json()) as any).idToken;
    }
  }
  return {
    authorization: `Bearer ${zToken}`,
    'x-org-id': z.orgId,
    'x-request-id': crypto.randomUUID(),
    'content-type': 'application/json',
  };
}
async function zetarisQuery(sql: string): Promise<Row[]> {
  const z = config.zetaris;
  const open = await fetch(`${z.baseUrl}${z.openPath}`, { method: 'POST', headers: await zetarisHeaders(), body: JSON.stringify({ select: sql, pageLimit: 100 }) });
  if (!open.ok) throw new Error(`Zetaris open HTTP ${open.status}: ${(await open.text()).slice(0, 200)}`);
  const first = (await open.json()) as any;
  const rows: Row[] = [...(first.rows ?? first.data ?? [])];
  let token = first.queryToken;
  while (token && rows.length < 200_000) {
    const page = await fetch(`${z.baseUrl}${z.pagePath}`, { method: 'POST', headers: await zetarisHeaders(), body: JSON.stringify({ queryToken: token, pageLimit: 100 }) });
    if (!page.ok) break;
    const j = (await page.json()) as any;
    const batch = j.rows ?? j.data ?? [];
    rows.push(...batch);
    token = batch.length ? j.queryToken ?? token : null;
  }
  if (first.queryToken) await fetch(`${z.baseUrl}${z.closePath}`, { method: 'POST', headers: await zetarisHeaders(), body: JSON.stringify({ queryToken: first.queryToken }) }).catch(() => {});
  return rows;
}
async function zetarisExec(statement: string) {
  const z = config.zetaris;
  const res = await fetch(`${z.baseUrl}${z.openPath}`, { method: 'POST', headers: await zetarisHeaders(), body: JSON.stringify({ select: statement, pageLimit: 1 }) });
  if (!res.ok) throw new Error(`Zetaris exec HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

let zetarisDown = false;
export function engineName(): 'zetaris' | 'local-duckdb' {
  return zetarisConfigured() && !zetarisDown ? 'zetaris' : 'local-duckdb';
}

// ------------------------------------------------------------------ public API
let qCounter = 0;
export async function query(sql: string, label = 'query'): Promise<QueryResult> {
  const t0 = Date.now();
  const query_id = `q_${sha(sql, 8)}_${(++qCounter).toString(36)}`;
  let rows: Row[];
  let engine = engineName();
  if (engine === 'zetaris') {
    try { rows = await zetarisQuery(sql); } catch (e) {
      zetarisDown = true; engine = 'local-duckdb';
      console.warn(`[federation] Zetaris failed (${(e as Error).message}); using local DuckDB`);
      rows = await localQuery(sql);
    }
  } else rows = await localQuery(sql);
  const ms = Date.now() - t0;
  logQuery({ query_id, label, sql: sql.trim(), engine, row_count: rows.length, ms, ts: new Date().toISOString(), sample: rows.slice(0, 20) });
  return { query_id, engine, rows, ms };
}

async function localQuery(sql: string): Promise<Row[]> {
  const c = await local();
  const r = await c.runAndReadAll(sql);
  return r.getRowObjects().map((o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, normalise(v)])));
}

/** Register a CSV file in place as <schema>.<table>. */
export async function registerCsv(table: string, file: string, opts: { lightningDb?: string } = {}) {
  const abs = path.resolve(file);
  if (engineName() === 'zetaris') {
    const [db, t] = table.split('.');
    try {
      await zetarisExec(`CREATE LIGHTNING DATABASE IF NOT EXISTS ${opts.lightningDb ?? db.toUpperCase()} DESCRIBE BY "Dry Run ${db}" OPTIONS ()`).catch(() => {});
      await zetarisExec(`CREATE LIGHTNING FILESTORE TABLE ${t} FROM ${opts.lightningDb ?? db.toUpperCase()} FORMAT CSV OPTIONS (path "${abs}", header "true", inferSchema "true")`);
      return;
    } catch (e) { zetarisDown = true; console.warn(`[federation] Zetaris register failed: ${(e as Error).message}`); }
  }
  const c = await local();
  await c.run(`CREATE OR REPLACE VIEW ${table} AS SELECT * FROM read_csv_auto('${abs.replace(/'/g, "''")}', header=true)`);
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

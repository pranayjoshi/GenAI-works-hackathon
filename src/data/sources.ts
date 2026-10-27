/**
 * Registers every Dry Run source in the federation layer (BUILD_PLAN §3.1).
 *  census.acs        live REST: ACS 5-year tables via the Census Reporter API (keyless mirror of api.census.gov)
 *  pew.platform_use  CSV: Pew Research Center Social Media Fact Sheet, hand-entered with source URL
 *  priors.behaviour  CSV: labelled modeled priors / assumptions
 *  biz.customers     CSV: the business's customer list (demo file is SYNTHETIC)
 *  upworthy.tests    CSV: Upworthy Research Archive, exploratory split (CC BY 4.0)
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { registerCsv, registerJsonRows, query, engineName } from './federation.js';

const SRC = path.join(config.paths.data, 'sources');
const CACHE = path.join(config.paths.data, 'cache');
export const ACS_TABLES = ['B01001', 'B19037', 'B15003'] as const;

export interface CensusRow { geo_id: string; geo_name: string; release: string; table_id: string; column_id: string; column_name: string; indent: number; estimate: number; moe: number | null }

export function geoIdForZip(zip: string) { return `86000US${zip}`; }
export const US_GEO = '01000US';

/** Fetch ACS tables for a geography from the live Census Reporter REST API, cache as rows. */
export async function fetchCensus(geoId: string): Promise<{ file: string; rows: number; release: string; fetched: boolean }> {
  fs.mkdirSync(CACHE, { recursive: true });
  const file = path.join(CACHE, `census_${geoId}.json`);
  if (fs.existsSync(file)) {
    const rows = JSON.parse(fs.readFileSync(file, 'utf8')) as CensusRow[];
    return { file, rows: rows.length, release: rows[0]?.release ?? '', fetched: false };
  }
  try {
    return await fetchCensusLive(geoId, file);
  } catch (e) {
    // offline or unknown ZIP: use the national row (cached in the repo) relabelled for this geography, with a note in the geo name
    const us = path.join(CACHE, `census_${US_GEO}.json`);
    if (geoId === US_GEO || !fs.existsSync(us)) throw e;
    const note = `United States (national fallback; ${geoId} unavailable: ${(e as Error).message.slice(0, 80)})`;
    const rows = (JSON.parse(fs.readFileSync(us, 'utf8')) as CensusRow[]).map((r) => ({ ...r, geo_id: geoId, geo_name: note }));
    const fb = path.join(CACHE, `census_fallback_${geoId}.json`);
    fs.writeFileSync(fb, JSON.stringify(rows));
    console.warn(`[census] ${note}`);
    return { file: fb, rows: rows.length, release: rows[0]?.release ?? '', fetched: false };
  }
}

async function fetchCensusLive(geoId: string, file: string): Promise<{ file: string; rows: number; release: string; fetched: boolean }> {
  const url = `${config.censusReporter}/data/show/latest?table_ids=${ACS_TABLES.join(',')}&geo_ids=${geoId}`;
  const res = await fetch(url, { headers: { 'user-agent': 'DryRun/0.1 (hackathon research tool)', accept: 'application/json' }, signal: AbortSignal.timeout(8_000) });
  if (!res.ok) throw new Error(`Census Reporter HTTP ${res.status} for ${geoId}`);
  const j = (await res.json()) as any;
  const geo = j.data?.[geoId];
  if (!geo) throw new Error(`No ACS data for ${geoId}`);
  const rows: CensusRow[] = [];
  for (const tid of ACS_TABLES) {
    const cols = j.tables[tid].columns as Record<string, { name: string; indent: number }>;
    for (const [cid, meta] of Object.entries(cols)) {
      rows.push({
        geo_id: geoId,
        geo_name: j.geography?.[geoId]?.name ?? geoId,
        release: j.release?.name ?? 'ACS 5-year',
        table_id: tid,
        column_id: cid,
        column_name: meta.name,
        indent: meta.indent ?? 0,
        estimate: Number(geo[tid].estimate[cid] ?? 0),
        moe: geo[tid].error?.[cid] ?? null,
      });
    }
  }
  fs.writeFileSync(file, JSON.stringify(rows));
  return { file, rows: rows.length, release: rows[0]?.release ?? '', fetched: true };
}

let registered = false;
const censusGeos = new Set<string>();
const geoFiles = new Map<string, string>();

export async function registerSources(opts: { customers?: string | null } = {}) {
  if (!registered) {
    await registerCsv('pew.platform_use', path.join(SRC, 'pew_platform_use.csv'));
    await registerCsv('priors.behaviour', path.join(SRC, 'priors_behaviour.csv'));
    const up = path.join(config.paths.data, 'raw', 'upworthy-exploratory.csv');
    if (fs.existsSync(up)) await registerCsv('upworthy.tests', up);
    registered = true;
  }
  const customers = opts.customers === undefined ? path.join(SRC, 'biz_customers_cafe.csv') : opts.customers;
  if (customers) await registerCsv('biz.customers', customers);
}

/** Ensure census.acs holds rows for the given geographies (live fetch, then registered in place). */
export async function ensureCensus(geoIds: string[]) {
  let changed = false;
  const meta: Record<string, { release: string; fetched: boolean }> = {};
  for (const g of geoIds) {
    const r = await fetchCensus(g);
    meta[g] = { release: r.release, fetched: r.fetched };
    geoFiles.set(g, r.file);
    if (!censusGeos.has(g)) { censusGeos.add(g); changed = true; }
  }
  if (changed) {
    // one table over every cached geography response
    const all: CensusRow[] = [];
    for (const g of censusGeos) all.push(...(JSON.parse(fs.readFileSync(geoFiles.get(g) ?? path.join(CACHE, `census_${g}.json`), 'utf8')) as CensusRow[]));
    const combined = path.join(CACHE, 'census_all.json');
    fs.writeFileSync(combined, JSON.stringify(all));
    if (engineName() === 'zetaris' && config.zetaris.fileRoot && all.length) {
      // CSV copy so Zetaris can serve census.acs as a Lightning file-store table (same rows, same columns)
      const cols = Object.keys(all[0]);
      const cell = (v: unknown) => { const t = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
      const csv = path.join(CACHE, 'census_all.csv');
      fs.writeFileSync(csv, [cols.join(','), ...all.map((r) => cols.map((c) => cell((r as unknown as Record<string, unknown>)[c])).join(','))].join('\n') + '\n');
      await registerCsv('census.acs', csv); // also the local view, over the same rows
    } else await registerJsonRows('census.acs', combined);
  }
  return meta;
}

export async function sourceSummary() {
  const out: { table: string; kind: string; rows: number | string; label: string; engine?: string }[] = [];
  const probe = async (table: string, kind: string, label: string) => {
    try {
      const r = await query(`SELECT COUNT(*) AS n FROM ${table}`, `count ${table}`);
      out.push({ table, kind, rows: Number(r.rows[0]?.n ?? 0), label, engine: r.engine });
    } catch { out.push({ table, kind, rows: 'not registered', label }); }
  };
  await probe('census.acs', 'REST (Census Reporter, ACS 5-year)', 'real public data');
  await probe('pew.platform_use', 'CSV (Pew fact sheet)', 'real public data, hand-entered');
  await probe('priors.behaviour', 'CSV', 'modeled priors, labelled');
  await probe('biz.customers', 'CSV (customer upload)', 'demo file is synthetic');
  await probe('upworthy.tests', 'CSV (Upworthy archive)', 'real A/B tests, CC BY 4.0');
  return { engine: engineName(), tables: out };
}

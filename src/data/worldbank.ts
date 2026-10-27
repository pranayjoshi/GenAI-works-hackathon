/**
 * World Bank Open Data (api.worldbank.org/v2, no key, CC BY 4.0) for places outside the US.
 * One request per country returns every indicator the sampler needs; rows are cached in
 * data/cache/worldbank_<ISO3>.json (committed for GB, IN, DE, CA, AU, MX so demos work offline) and
 * registered as worldbank.country (long format: iso3, indicator, label, value, year).
 * All values are country-level: nothing here is a city or ZIP statistic.
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { registerCsv } from './federation.js';

const CACHE = path.join(config.paths.data, 'cache');
const BANDS = ['0004', '0509', '1014', '1519', '2024', '2529', '3034', '3539', '4044', '4549', '5054', '5559', '6064', '6569', '7074', '7579', '80UP'];
export const WB_INDICATORS = [
  'SP.POP.TOTL', 'SP.POP.TOTL.MA.ZS', 'SP.POP.TOTL.FE.ZS',
  ...BANDS.flatMap((b) => [`SP.POP.${b}.FE.5Y`, `SP.POP.${b}.MA.5Y`]), // % of that sex's population
  'SI.DST.FRST.20', 'SI.DST.02ND.20', 'SI.DST.03RD.20', 'SI.DST.04TH.20', 'SI.DST.05TH.20', // income share by quintile
  'NY.GNP.PCAP.CD', 'IT.NET.USER.ZS',
];

export interface WbRow { iso3: string; indicator: string; label: string; value: number; year: number }

async function fetchLive(iso3: string): Promise<WbRow[]> {
  const rows: WbRow[] = [];
  // two calls: the age indicators and the rest (the API takes many indicators per call, URLs stay short)
  const half = Math.ceil(WB_INDICATORS.length / 2);
  for (const part of [WB_INDICATORS.slice(0, half), WB_INDICATORS.slice(half)]) {
    const url = `https://api.worldbank.org/v2/country/${iso3}/indicator/${part.join(';')}?source=2&format=json&mrnev=1&per_page=500`;
    const res = await fetch(url, { headers: { 'user-agent': 'DryRun/0.1 (hackathon research tool)' }, signal: AbortSignal.timeout(8_000) });
    if (!res.ok) throw new Error(`World Bank HTTP ${res.status} for ${iso3}`);
    const j = (await res.json()) as any[];
    for (const r of j[1] ?? []) if (r.value !== null && r.value !== undefined) rows.push({ iso3, indicator: r.indicator.id, label: r.indicator.value, value: Number(r.value), year: Number(r.date) });
  }
  if (!rows.some((r) => r.indicator === 'SP.POP.TOTL')) throw new Error(`No World Bank data for ${iso3}`);
  return rows;
}

export async function fetchWorldBank(iso3: string): Promise<{ file: string; rows: number; fetched: boolean }> {
  fs.mkdirSync(CACHE, { recursive: true });
  const file = path.join(CACHE, `worldbank_${iso3}.json`);
  if (fs.existsSync(file)) return { file, rows: (JSON.parse(fs.readFileSync(file, 'utf8')) as WbRow[]).length, fetched: false };
  const rows = await fetchLive(iso3); // no cached fallback exists for an uncached country: the error reaches the caller
  fs.writeFileSync(file, JSON.stringify(rows));
  return { file, rows: rows.length, fetched: true };
}

const known = new Set<string>();
const cell = (v: unknown) => { const t = String(v); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };

/** Make sure worldbank.country holds these countries (plus every country cached on disk, so the registered file is stable). */
export async function ensureWorldBank(iso3s: string[]) {
  let changed = false;
  for (const g of iso3s) { await fetchWorldBank(g); if (!known.has(g)) { known.add(g); changed = true; } }
  if (!changed && known.size) return;
  const all: WbRow[] = [];
  for (const f of fs.readdirSync(CACHE).filter((x) => /^worldbank_[A-Z]{3}\.json$/.test(x)).sort()) all.push(...(JSON.parse(fs.readFileSync(path.join(CACHE, f), 'utf8')) as WbRow[]));
  const cols = ['iso3', 'indicator', 'label', 'value', 'year'] as const;
  const csv = path.join(CACHE, 'worldbank_all.csv');
  fs.writeFileSync(csv, [cols.join(','), ...all.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n') + '\n');
  await registerCsv('worldbank.country', csv);
}

/** Audience size for a country: adults by Pew age band x internet users % x Pew platform rate (US Pew rates, a proxy outside the US). */
export const wbJoinSql = (iso3: string, platform: string) => `
    WITH wc AS (SELECT indicator, value FROM worldbank.country WHERE iso3 = '${iso3}'),
    tot AS (SELECT value AS pop FROM wc WHERE indicator = 'SP.POP.TOTL'),
    net AS (SELECT COALESCE(MAX(value), 100) AS pct FROM wc WHERE indicator = 'IT.NET.USER.ZS'),
    ages AS (
      SELECT TRY_CAST(SUBSTR(a.indicator, 8, 2) AS INTEGER) AS lo,
        t.pop * (CASE WHEN SUBSTR(a.indicator, 13, 2) = 'MA' THEN m.value ELSE f.value END) / 100.0 * a.value / 100.0 AS persons
      FROM wc a CROSS JOIN tot t
        CROSS JOIN (SELECT value FROM wc WHERE indicator = 'SP.POP.TOTL.MA.ZS') m
        CROSS JOIN (SELECT value FROM wc WHERE indicator = 'SP.POP.TOTL.FE.ZS') f
      WHERE a.indicator LIKE 'SP.POP.%.5Y'
    ), banded AS (
      SELECT CASE WHEN lo < 15 THEN NULL WHEN lo < 30 THEN '18-29' WHEN lo < 50 THEN '30-49' WHEN lo < 65 THEN '50-64' ELSE '65+' END AS band,
        SUM(persons * CASE WHEN lo = 15 THEN 0.4 ELSE 1.0 END) AS adults
      FROM ages GROUP BY 1
    )
    SELECT b.band, ROUND(b.adults) AS adults, n.pct AS internet_pct, p.pct_us_adults_ever_use AS instagram_pct, ROUND(b.adults * n.pct / 100.0 * p.pct_us_adults_ever_use / 100.0) AS instagram_users
    FROM banded b CROSS JOIN net n JOIN pew.platform_use p ON p.platform = '${platform}' AND p.dimension = 'age' AND p.band = b.band
    WHERE b.band IS NOT NULL ORDER BY b.band`;

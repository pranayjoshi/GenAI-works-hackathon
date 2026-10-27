/**
 * Where the crowd lives. A US 5-digit ZIP uses Census ACS (neighbourhood level); anything else is a country,
 * answered by World Bank country-level data. "City, Country" keeps the city as a label only.
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { ensureCensus, geoIdForZip } from './sources.js';
import { ensureWorldBank } from './worldbank.js';

export interface Geo { kind: 'us_zip' | 'country'; geoId: string; iso2: string; iso3: string; label: string; note: string }
interface Country { iso2: string; iso3: string; name: string }

let countries: Country[] | null = null;
function list(): Country[] {
  return (countries ??= JSON.parse(fs.readFileSync(path.join(config.paths.data, 'cache', 'worldbank_countries.json'), 'utf8')) as Country[]);
}
const ALIASES: Record<string, string> = {
  uk: 'GB', 'u.k.': 'GB', britain: 'GB', 'great britain': 'GB', england: 'GB', scotland: 'GB', wales: 'GB', usa: 'US', 'u.s.': 'US', 'u.s.a.': 'US', america: 'US',
  uae: 'AE', korea: 'KR', 'south korea': 'KR', russia: 'RU', vietnam: 'VN', turkey: 'TR', turkiye: 'TR', czechia: 'CZ', 'czech republic': 'CZ', holland: 'NL',
};
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

function findCountry(s: string): Country | undefined {
  const k = norm(s);
  if (!k) return undefined;
  const code = ALIASES[k] ?? (/^[a-z]{2,3}$/.test(k) ? k.toUpperCase() : null);
  const all = list();
  if (code) { const c = all.find((x) => x.iso2 === code || x.iso3 === code); if (c) return c; }
  return all.find((x) => norm(x.name) === k) ?? all.find((x) => norm(x.name).replace(/,.*$/, '') === k);
}

export function resolveGeo(input: string): Geo {
  const raw = String(input ?? '').trim();
  const zip = raw.match(/^\s*(\d{5})(?:-\d{4})?\s*$/)?.[1];
  const us = (z: string): Geo => ({ kind: 'us_zip', geoId: geoIdForZip(z), iso2: 'US', iso3: 'USA', label: `ZIP ${z}`, note: 'US ZIP code: Census ACS 5-year data for this ZIP.' });
  if (zip) return us(zip);
  const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
  for (const cand of [raw, parts[parts.length - 1]]) {
    const c = cand ? findCountry(cand) : undefined;
    if (!c) continue;
    const city = cand === raw ? '' : parts.slice(0, -1).join(', ');
    return {
      kind: 'country', geoId: `WB:${c.iso3}`, iso2: c.iso2, iso3: c.iso3, label: city ? `${city}, ${c.name}` : c.name,
      note: `Country-level data (World Bank Open Data) for ${c.name}${city ? `; "${city}" is kept as a label only, not a city statistic` : ''}. Platform rates are US Pew rates used as a proxy.`,
    };
  }
  const embedded = raw.match(/\b(\d{5})(?:-\d{4})?\b/)?.[1]; // "Austin, TX 78704"
  if (embedded) return us(embedded);
  throw Object.assign(new Error(`Could not place "${raw}": give a US 5-digit ZIP, a country (name, ISO2 or ISO3, e.g. "India", "GB"), or "City, Country".`), { statusCode: 400 });
}

/** Load the source rows for a resolved geography (ACS for a ZIP, World Bank for a country). */
export async function ensureGeo(geoId: string) {
  return geoId.startsWith('WB:') ? ensureWorldBank([geoId.slice(3)]) : ensureCensus([geoId]);
}

import { describe, it, expect } from 'vitest';
import { resolveGeo, ensureGeo } from '../src/data/geo.js';
import { registerSources } from '../src/data/sources.js';
import { sampleCrowd } from '../src/audience/sampler.js';

describe('resolveGeo', () => {
  it('keeps US ZIPs on the Census path', () => {
    expect(resolveGeo('78704')).toMatchObject({ kind: 'us_zip', geoId: '86000US78704', iso3: 'USA' });
  });
  it('resolves countries by code and name, and keeps a city as a label', () => {
    expect(resolveGeo('GB')).toMatchObject({ kind: 'country', geoId: 'WB:GBR' });
    expect(resolveGeo('India').iso2).toBe('IN');
    expect(resolveGeo('DEU').label).toBe('Germany');
    const g = resolveGeo('London, United Kingdom');
    expect(g).toMatchObject({ kind: 'country', iso3: 'GBR', label: 'London, United Kingdom' });
    expect(g.note).toMatch(/label only/);
  });
  it('rejects an unknown place', () => { expect(() => resolveGeo('Narnia')).toThrow(/Could not place/); });
});

describe('sampler on a country (cached World Bank rows, no network)', () => {
  it('samples personas with World Bank receipts and an audience estimate', async () => {
    const g = resolveGeo('London, United Kingdom');
    await registerSources({ customers: null });
    await ensureGeo(g.geoId);
    const { personas, report } = await sampleCrowd({ geoId: g.geoId, zip: g.iso3, n: 20, seed: 'geo-test', coreAgeBands: ['25-34'], coreName: 'core', spilloverName: 'rest', useCustomers: false });
    expect(personas).toHaveLength(20);
    expect(personas.every((p) => p.age >= 18 && p.zip === 'GBR')).toBe(true);
    expect(report.queries.some((q) => /World Bank population/.test(q.label))).toBe(true);
    expect(report.instagram_users_est).toBeGreaterThan(1_000_000);
    const rc = personas[0].receipts;
    expect(rc.find((r) => r.field === 'income_band')?.ref).toMatch(/modeled from World Bank quintiles/);
    expect(rc.find((r) => r.field === 'channel')?.source).toMatch(/US Pew rates applied outside the US/);
    expect(rc.every((r) => r.query_id)).toBe(true);
  }, 60_000);
});

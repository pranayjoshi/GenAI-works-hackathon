/**
 * Contract test for the Meta launch action against a fake Graph API: the requests chain ids
 * (campaign -> ad sets -> creatives -> ads), every object is created PAUSED, targeting is the ZIP and age band.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const calls: { path: string; body: Record<string, string> }[] = [];
let server: http.Server;
let meta: typeof import('../src/actions/meta.js');
let n = 0;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = Object.fromEntries(new URLSearchParams(raw));
      calls.push({ path: req.url!, body });
      res.writeHead(body.access_token === 'tok' ? 200 : 400, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body.access_token === 'tok' ? { id: String(++n) } : { error: { message: 'bad token' } }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  Object.assign(process.env, {
    META_GRAPH_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, META_ACCESS_TOKEN: 'tok',
    META_AD_ACCOUNT_ID: 'act_123', META_PAGE_ID: '456', META_INSTAGRAM_USER_ID: '', META_API_VERSION: 'v23.0',
  });
  meta = await import('../src/actions/meta.js');
});
afterAll(() => server?.close());

describe('Meta launch action', () => {
  it('creates a paused split test with chained ids', async () => {
    const r = await meta.launchOnMeta({ run_id: 'r1', business: 'Demo Café', zip: '78704', age_bands: ['25-34'], days: 7, variants: [{ label: 'Version A', text: 'a' }, { label: 'Version C', text: 'c' }] });
    expect(r.mode).toBe('live');
    expect(r.ok).toBe(true);
    expect(calls.map((c) => c.path.split('/').pop())).toEqual(['campaigns', 'adsets', 'adcreatives', 'ads', 'adsets', 'adcreatives', 'ads']);
    expect(calls.every((c) => c.path.startsWith('/v23.0/act_123/'))).toBe(true);
    for (const c of calls) if ('status' in c.body) expect(c.body.status).toBe('PAUSED');
    const adset = calls[1].body;
    expect(adset.campaign_id).toBe('1');
    expect(JSON.parse(adset.targeting)).toMatchObject({ geo_locations: { zips: [{ key: 'US:78704' }] }, age_min: 25, age_max: 34, publisher_platforms: ['instagram'] });
    expect(JSON.parse(calls[2].body.object_story_spec).page_id).toBe('456');
    expect(calls[3].body.adset_id).toBe('2');
    expect(JSON.parse(calls[3].body.creative)).toEqual({ creative_id: '3' });
    expect(r.ad_sets).toEqual([{ label: 'Version A', ad_set_id: '2', creative_id: '3', ad_id: '4' }, { label: 'Version C', ad_set_id: '5', creative_id: '6', ad_id: '7' }]);
  });

  it('refuses to create anything that is not paused', () => {
    const p = meta.metaPayloads({ run_id: 'r', business: 'b', zip: '78704', age_bands: [], days: 7, variants: [{ label: 'A', text: 'a' }] });
    expect(p.filter((x) => 'status' in x.body).every((x) => x.body.status === 'PAUSED')).toBe(true);
  });
});

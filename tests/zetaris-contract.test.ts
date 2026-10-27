/**
 * Contract test for the Zetaris client against a fake server built from the published Zetaris OpenAPI spec
 * (api.saas.enterprise.zetaris.com/redoc/docs.yaml): login, query/sql/start, query/sql/page, query/sql/close.
 * It checks headers, auth, paging and close, and that a failing Zetaris query falls back to DuckDB with a note.
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const statements: string[] = [];
const closed: string[] = [];
const problems: string[] = [];
const ROWS = Array.from({ length: 250 }, (_, i) => ({ platform: `p${i}`, pct: i / 1000 }));
let server: http.Server;
let fed: typeof import('../src/data/federation.js');

function check(req: http.IncomingMessage, bearer: boolean) {
  if (!UUID.test(String(req.headers['x-request-id']))) problems.push(`bad X-Request-ID on ${req.url}`);
  if (req.headers['x-org-id'] !== '42') problems.push(`bad X-Org-ID on ${req.url}`);
  if (bearer && req.headers.authorization !== 'Bearer id-token-1') problems.push(`bad bearer on ${req.url}`);
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url!, 'http://x');
    const json = (code: number, body: unknown) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.method === 'GET' && url.pathname === '/api/v1.0/auth/login') {
      check(req, false);
      if (req.headers.authorization !== `Basic ${Buffer.from('ana:pw').toString('base64')}`) return json(401, { msg: 'no' });
      return json(200, { idToken: 'id-token-1', refreshToken: 'r' });
    }
    if (req.method === 'POST' && url.pathname === '/api/v1.0/query/sql/start') {
      check(req, true);
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const { select, pageLimit } = JSON.parse(body);
        statements.push(select);
        if (!(pageLimit >= 1 && pageLimit <= 100)) problems.push(`pageLimit ${pageLimit}`);
        if (/\/\*fail\*\//.test(select)) return json(500, { msg: 'unsupported function' });
        const recs = /^select/i.test(select) ? ROWS : [];
        json(200, { records: recs.slice(0, pageLimit), pageNumber: 1, pageLimit, totalCount: recs.length, totalPages: Math.max(1, Math.ceil(recs.length / pageLimit)), queryToken: `qt${statements.length}` });
      });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/v1.0/query/sql/page') {
      check(req, true);
      const n = Number(url.searchParams.get('pageNumber'));
      const lim = Number(url.searchParams.get('pageLimit'));
      if (!url.searchParams.get('queryToken')) problems.push('page without queryToken');
      return json(200, { records: ROWS.slice((n - 1) * lim, n * lim), pageNumber: n, totalCount: ROWS.length, totalPages: Math.ceil(ROWS.length / lim), queryToken: url.searchParams.get('queryToken') });
    }
    const m = url.pathname.match(/^\/api\/v1\.0\/query\/sql\/close\/(.+)$/);
    if (req.method === 'DELETE' && m) { check(req, true); closed.push(m[1]); res.writeHead(200); return res.end(); }
    problems.push(`unexpected ${req.method} ${url.pathname}`);
    json(404, { msg: 'not found' });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  Object.assign(process.env, {
    ZETARIS_BASE_URL: `http://127.0.0.1:${port}/api/v1.0`, ZETARIS_USER: 'ana', ZETARIS_PASSWORD: 'pw', ZETARIS_API_KEY: '',
    ZETARIS_ORG_ID: '42', ZETARIS_FILE_ROOT: '/zdata/dryrun',
    ZETARIS_REGISTRY: path.join(os.tmpdir(), 'dryrun-no-registry.json'), // ignore a local bundle's registry
    RUNS_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'dryrun-zetaris-')), // keep fake-server queries out of the real query log
  });
  fed = await import('../src/data/federation.js');
});

afterAll(() => server?.close());

describe('Zetaris client follows the published API', () => {
  it('registers a CSV as a Lightning file-store table at the Zetaris-side path', async () => {
    expect(fed.engineName()).toBe('zetaris');
    await fed.registerCsv('pew.platform_use', 'data/sources/pew_platform_use.csv');
    const create = statements.find((s) => /CREATE LIGHTNING FILESTORE TABLE/i.test(s));
    expect(create).toContain('PATH "/zdata/dryrun/data/sources/pew_platform_use.csv"');
    expect(create).toMatch(/FROM pew FORMAT CSV/);
    expect(fed.tableEngine('pew.platform_use')).toBe('zetaris');
  });

  it('pages through every record and closes the query', async () => {
    const r = await fed.query('SELECT * FROM pew.platform_use', 'contract');
    expect(r.engine).toBe('zetaris');
    expect(r.rows).toHaveLength(250);
    expect(r.rows[249]).toEqual({ platform: 'p249', pct: 0.249 });
    expect(closed).toContain(`qt${statements.length}`);
  });

  it('keeps unregistered tables local and falls back per query with a note', async () => {
    expect((await fed.query('SELECT 1 AS x', 'no tables')).engine).toBe('local-duckdb');
    const r = await fed.query('SELECT COUNT(*) AS n FROM pew.platform_use /*fail*/', 'fallback');
    expect(r.engine).toBe('local-duckdb');
    expect(Number(r.rows[0].n)).toBeGreaterThan(0);
    expect(fed.getQuery(r.query_id)?.note).toMatch(/zetaris failed/);
    expect(fed.engineName()).toBe('zetaris'); // a bad query does not take Zetaris down
  });

  it('sent every call with valid headers and auth', () => {
    expect(problems).toEqual([]);
  });
});

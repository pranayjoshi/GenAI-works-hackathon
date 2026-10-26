/**
 * Backtest test selection (BUILD_PLAN §7): real Upworthy A/B tests where two packages differ by headline only.
 * Queried through the federation layer (upworthy.tests). The archive's `significance` column is never used.
 */
import { query } from '../data/federation.js';
import { registerSources } from '../data/sources.js';

export const EXCLUDED_WINDOW = { from: '2013-06-25', to: '2014-01-10', reason: "archive randomization caveat (no `problem` column in the exploratory file)" };
export const FILTERS = {
  min_impressions: 1000,
  min_rel_gap: 0.3,
  min_z: 2.58, // two-proportion z-test on the real clicks: the real winner must be real (p < 0.01)
  same_eyecatcher_and_lede: true,
  headline_must_differ: true,
  one_pair_per_test: 'group with most total impressions',
  order: 'md5(clickability_test_id)',
  dev_n: 20,
};

export interface Pkg { headline: string; ctr: number; impressions: number; clicks: number }
export interface Pair { test_id: string; created_at: string; best: Pkg; worst: Pkg; rel_gap: number; z: number }
export interface Selection {
  dev: Pair[]; scored: Pair[]; qualifying: number; query_ids: string[]; excluded_window: typeof EXCLUDED_WINDOW; filters: typeof FILTERS;
}

export function stripHtml(s: string): string {
  return String(s ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&rsquo;/g, '’').replace(/&lsquo;/g, '‘')
    .replace(/\s+/g, ' ').trim();
}

const SQL = `
WITH t AS (
  SELECT clickability_test_id AS tid, created_at, eyecatcher_id AS ey, lede, headline, impressions, clicks,
         clicks * 1.0 / impressions AS ctr,
         bool_or(created_at >= TIMESTAMP '${EXCLUDED_WINDOW.from}' AND created_at < TIMESTAMP '2014-01-11') OVER (PARTITION BY clickability_test_id) AS in_window
  FROM upworthy.tests
  WHERE impressions IS NOT NULL AND clicks IS NOT NULL
), p AS (
  SELECT * FROM t WHERE NOT in_window AND impressions >= ${FILTERS.min_impressions}
), r AS (
  SELECT *,
    row_number() OVER (PARTITION BY tid, ey, lede ORDER BY ctr DESC, md5(headline)) AS rb,
    row_number() OVER (PARTITION BY tid, ey, lede ORDER BY ctr ASC, md5(headline)) AS rw,
    sum(impressions) OVER (PARTITION BY tid, ey, lede) AS grp_impr
  FROM p
), g AS (
  SELECT b.tid, b.created_at, b.grp_impr,
         b.headline AS bh, b.ctr AS bctr, b.impressions AS bi, b.clicks AS bc,
         w.headline AS wh, w.ctr AS wctr, w.impressions AS wi, w.clicks AS wc
  FROM r b JOIN r w ON b.tid = w.tid AND b.ey IS NOT DISTINCT FROM w.ey AND b.lede IS NOT DISTINCT FROM w.lede
  WHERE b.rb = 1 AND w.rw = 1 AND trim(b.headline) <> trim(w.headline) AND w.ctr > 0 AND b.ctr / w.ctr - 1 >= ${FILTERS.min_rel_gap}
), best AS (
  SELECT *, row_number() OVER (PARTITION BY tid ORDER BY grp_impr DESC, md5(bh || wh)) AS k FROM g
)
SELECT tid, strftime(created_at, '%Y-%m-%d %H:%M:%S') AS created_at, bh, bctr, bi, bc, wh, wctr, wi, wc, bctr / wctr - 1 AS rel_gap, z
FROM (
  SELECT *, (bctr - wctr) / sqrt(((bc + wc) * 1.0 / (bi + wi)) * (1 - (bc + wc) * 1.0 / (bi + wi)) * (1.0 / bi + 1.0 / wi)) AS z
  FROM best WHERE k = 1
) WHERE z >= ${FILTERS.min_z} ORDER BY md5(tid)`;

export async function selectTests(opts: { scoredN?: number; devN?: number } = {}): Promise<Selection> {
  await registerSources({ customers: null });
  const devN = opts.devN ?? FILTERS.dev_n;
  const res = await query(SQL, 'backtest: select Upworthy headline-only A/B pairs');
  const all: Pair[] = res.rows.map((r: any) => ({
    test_id: String(r.tid), created_at: String(r.created_at), rel_gap: Number(r.rel_gap), z: Number(r.z),
    best: { headline: stripHtml(r.bh), ctr: Number(r.bctr), impressions: Number(r.bi), clicks: Number(r.bc) },
    worst: { headline: stripHtml(r.wh), ctr: Number(r.wctr), impressions: Number(r.wi), clicks: Number(r.wc) },
  })).filter((p) => p.best.headline && p.worst.headline && p.best.headline !== p.worst.headline);
  const dev = all.slice(0, devN);
  const scored = all.slice(devN, devN + (opts.scoredN ?? 50));
  return { dev, scored, qualifying: all.length, query_ids: [res.query_id], excluded_window: EXCLUDED_WINDOW, filters: FILTERS };
}

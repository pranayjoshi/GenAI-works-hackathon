/**
 * Report tools (BUILD_PLAN §6.1). Every tool runs SQL through the federation layer over the run's action
 * log joined to its personas, and returns a query_id the report must cite.
 */
import { query, type Row } from '../data/federation.js';
import { tableIds, type RunState } from '../sim/run.js';

export interface ToolResult { tool: string; query_id: string; engine: string; args: Record<string, unknown>; rows: Row[] }

const SEG_COLS: Record<string, string> = { role: 'p.role', age: 'p.age_band', income: 'p.income_band', customer: "CASE WHEN p.is_customer = 1 THEN 'customer' ELSE 'not a customer' END" };

export async function segmentBreakdown(st: RunState, by: keyof typeof SEG_COLS): Promise<ToolResult> {
  const t = tableIds(st);
  const col = SEG_COLS[by];
  const sql = `
    WITH deciders AS (
      SELECT a.world_id, a.variant, a.agent_id, MAX(a.hour) AS last_hour
      FROM ${t.actions} a WHERE a.item_kind <> 'event' GROUP BY 1, 2, 3
    ), final_intent AS (
      SELECT a.world_id, a.agent_id, arg_max(a.would_visit, a.hour * 1000 + CAST(split_part(a.id, ':', 3) AS INTEGER)) AS would_visit,
             arg_max(a.stance, a.hour * 1000 + CAST(split_part(a.id, ':', 3) AS INTEGER)) AS stance
      FROM ${t.actions} a GROUP BY 1, 2
    )
    SELECT ${col} AS segment, d.variant, COUNT(*) AS deciders,
           ROUND(AVG(CASE WHEN f.would_visit THEN 1.0 ELSE 0.0 END), 4) AS intent_rate,
           ROUND(AVG(f.stance), 3) AS mean_stance
    FROM deciders d
    JOIN final_intent f ON f.world_id = d.world_id AND f.agent_id = d.agent_id
    JOIN ${t.personas} p ON p.id = d.agent_id
    GROUP BY 1, 2 ORDER BY 1, 2`;
  const r = await query(sql, `segment_breakdown(${by})`, st.spec.run_id);
  return { tool: 'segment_breakdown', query_id: r.query_id, engine: r.engine, args: { by }, rows: r.rows };
}

export async function reactionSample(st: RunState, variant: string, sentiment: 'negative' | 'positive', limit = 40): Promise<ToolResult> {
  const t = tableIds(st);
  const cond = sentiment === 'negative' ? 'a.feeling < 0' : 'a.feeling > 0';
  const sql = `
    SELECT a.id AS action_id, a.agent_id, a.world_id, a.hour, a.action, a.feeling, a.reason, a.text, a.unsaid, p.role, p.age_band, p.income_band
    FROM ${t.actions} a JOIN ${t.personas} p ON p.id = a.agent_id
    WHERE a.variant = '${variant.replace(/'/g, '')}' AND a.item_kind <> 'event' AND ${cond} AND a.reason IS NOT NULL AND a.reason <> ''
    ORDER BY hash(a.id) LIMIT ${limit}`;
  const r = await query(sql, `reactions(${variant}, ${sentiment})`, st.spec.run_id);
  return { tool: 'query_actions', query_id: r.query_id, engine: r.engine, args: { variant, sentiment }, rows: r.rows };
}

export async function reactionCounts(st: RunState): Promise<ToolResult> {
  const t = tableIds(st);
  const sql = `
    SELECT variant, action, COUNT(*) AS n,
           SUM(CASE WHEN feeling < 0 THEN 1 ELSE 0 END) AS negative, SUM(CASE WHEN feeling > 0 THEN 1 ELSE 0 END) AS positive,
           SUM(CASE WHEN unsaid IS NOT NULL AND unsaid <> '' THEN 1 ELSE 0 END) AS kept_private
    FROM ${t.actions} WHERE item_kind <> 'event' GROUP BY 1, 2 ORDER BY 1, 3 DESC, 2`;
  const r = await query(sql, 'reaction_counts', st.spec.run_id);
  return { tool: 'query_actions', query_id: r.query_id, engine: r.engine, args: {}, rows: r.rows };
}

export async function timeline(st: RunState): Promise<ToolResult> {
  const t = tableIds(st);
  const sql = `
    SELECT variant, hour, COUNT(*) AS decisions,
           SUM(CASE WHEN would_visit THEN 1 ELSE 0 END) AS visit_yes,
           SUM(CASE WHEN action IN ('comment', 'share') THEN 1 ELSE 0 END) AS vocal,
           SUM(CASE WHEN item_kind = 'share' THEN 1 ELSE 0 END) AS via_shares,
           ROUND(AVG(stance), 3) AS mean_stance
    FROM ${t.actions} WHERE item_kind <> 'event' GROUP BY 1, 2 ORDER BY 1, 2`;
  const r = await query(sql, 'timeline', st.spec.run_id);
  return { tool: 'timeline', query_id: r.query_id, engine: r.engine, args: {}, rows: r.rows };
}

/** Census context for the report: the federated join of the crowd to live ACS rows. */
export async function crowdVsCensus(st: RunState): Promise<ToolResult> {
  const t = tableIds(st);
  const geo = st.spec.geoId.replace(/'/g, '');
  const sql = `
    WITH crowd AS (SELECT age_band, COUNT(*) AS people FROM ${t.personas} GROUP BY 1),
    acs AS (
      SELECT CASE WHEN age_lo < 25 THEN '18-24' WHEN age_lo < 35 THEN '25-34' WHEN age_lo < 45 THEN '35-44' WHEN age_lo < 55 THEN '45-54' WHEN age_lo < 65 THEN '55-64' ELSE '65+' END AS age_band,
             SUM(estimate) AS residents
      FROM (SELECT CASE WHEN column_name LIKE 'Under%' THEN 0 ELSE TRY_CAST(regexp_extract(column_name, '(\\d+)', 1) AS INTEGER) END AS age_lo, estimate
            FROM census.acs WHERE geo_id = '${geo}' AND table_id = 'B01001' AND indent = 2)
      WHERE age_lo >= 18 GROUP BY 1)
    SELECT c.age_band, c.people AS crowd_people, a.residents AS acs_residents,
           ROUND(c.people * 1.0 / SUM(c.people) OVER (), 3) AS crowd_share, ROUND(a.residents * 1.0 / SUM(a.residents) OVER (), 3) AS acs_share
    FROM crowd c JOIN acs a USING (age_band) ORDER BY 1`;
  const r = await query(sql, 'crowd_vs_census', st.spec.run_id);
  return { tool: 'query_actions', query_id: r.query_id, engine: r.engine, args: {}, rows: r.rows };
}

/** Free SQL for the chat box: read-only, limited to this run's tables and the public sources. */
export async function queryActions(st: RunState, sql: string): Promise<ToolResult> {
  const s = sql.trim().replace(/;+\s*$/, '');
  if (!/^(select|with)\b/i.test(s) || /;|\b(insert|update|delete|drop|create|alter|attach|detach|copy|export|import|pragma|install|load|set|call)\b/i.test(s)) throw new Error('Only a single read-only SELECT is allowed');
  // no file or environment access from the chat box: DuckDB table functions and path literals are refused
  if (/\b(read_\w+|glob|getenv|sniff_csv|parquet_\w+|duckdb_\w+|current_setting|httpfs)\b|'[^']*[\/\\.][^']*\.\w{1,5}'|'\/|'~/i.test(s)) throw new Error('File and environment access is not allowed in this box');
  const t = tableIds(st);
  const r = await query(s.replace(/\bactions\b(?!_)/g, t.actions).replace(/\bpersonas\b(?!_)/g, t.personas) + (/\blimit\b/i.test(s) ? '' : ' LIMIT 200'), 'query_actions', st.spec.run_id);
  return { tool: 'query_actions', query_id: r.query_id, engine: r.engine, args: { sql: s }, rows: r.rows };
}

/**
 * Report agent (Super, thinking on) + Critic (Ultra, one pass) (BUILD_PLAN §6.2).
 * The agent runs its tools first, then writes a structured report in which every claim cites tool
 * query_ids and every quote cites an action id. The critic checks citations and numbers in code, then
 * asks the review model whether anything overclaims. One revision, then ship with residual notes.
 */
import { z } from 'zod';
import { chat } from '../llm.js';
import type { RunState } from '../sim/run.js';
import { allRecords } from '../sim/run.js';
import { crowdVsCensus, reactionCounts, reactionSample, segmentBreakdown, timeline, type ToolResult } from './tools.js';

const Claim = z.object({ text: z.string(), query_ids: z.array(z.string()) });
const Theme = z.object({ theme: z.string(), variant: z.string(), action_ids: z.array(z.string()).describe('2 action_id values whose reasons show this theme') });
export const ReportSchema = z.object({
  summary: z.string().describe('2-3 sentences: who wins, by how much, and the main reason'),
  claims: z.array(Claim).describe('3-6 factual claims about segments, timeline or reactions, each citing query_ids'),
  objections: z.array(Theme).max(3),
  likes: z.array(Theme).max(3),
  tipping_note: z.string(),
  recommendation: z.string().describe('one sentence on what the business should do next'),
});
export type Report = z.infer<typeof ReportSchema>;
const CriticSchema = z.object({ ok: z.boolean(), issues: z.array(z.string()) });

export interface ReportBundle {
  report: Report;
  tools: { tool: string; query_id: string; engine: string; args: Record<string, unknown>; row_count: number }[];
  quotes: Record<string, { agent_id: string; world_id: string; hour: number; action: string; reason: string; text: string; unsaid: string; variant: string }>;
  critic: { code_issues: string[]; model: { ok: boolean; issues: string[] } | null; revised: boolean };
  served_by: string[];
  fallback: boolean;
}

function compact(rows: Record<string, unknown>[], n = 40) { return JSON.stringify(rows.slice(0, n)); }

export async function buildReport(st: RunState): Promise<ReportBundle> {
  const v = st.verdict!;
  const [va, vb] = v.variants;
  const tools: ToolResult[] = [];
  for (const by of ['role', 'age', 'income', 'customer'] as const) tools.push(await segmentBreakdown(st, by));
  tools.push(await timeline(st));
  tools.push(await reactionCounts(st));
  tools.push(await crowdVsCensus(st));
  const samples: ToolResult[] = [];
  for (const variant of [va, vb]) for (const s of ['negative', 'positive'] as const) samples.push(await reactionSample(st, variant, s, 30));
  tools.push(...samples);

  const recById = new Map(allRecords(st).map((r) => [r.id, r]));
  const tippingLines = Object.entries(st.tipping ?? {}).map(([w, t]) => t ? `${w}: @${t.record.agent_id} shared at round ${t.record.hour} ("${t.record.text}") and reached ${t.reached} people` : `${w}: no shares`);

  const system = `You are the report agent in Dry Run. You turn tool results from a simulated A/B test into a one-screen verdict for a small business owner.
Rules:
- Use only numbers that appear in the tool results or the verdict. Every claim lists the query_id(s) it came from.
- Quotes are chosen by action_id from the reaction samples; pick ones whose reason clearly shows the theme.
- This is a simulation of AI personas sampled from Census and Pew data, not real customers. Do not say "customers said"; say "simulated people" or "the crowd".
- Plain, specific language. No hype.`;
  const toolText = tools.map((t) => `### ${t.tool} ${JSON.stringify(t.args)} query_id=${t.query_id}\n${compact(t.rows)}`).join('\n\n');
  const user = `Business: ${st.spec.business}. Goal: ${st.spec.goal}.
Version ${va}: "${st.spec.posts[0].text}"
Version ${vb}: "${st.spec.posts[1].text}"
Verdict (computed in code): ${v.headline}
Pooled: ${JSON.stringify(v.pooled)}; per seed: ${JSON.stringify(v.per_seed)}; secondary: ${JSON.stringify(v.secondary)}
Tipping points: ${tippingLines.join('; ')}

Tool results:
${toolText}`;

  const served: string[] = [];
  let report: Report | null = null;
  let fallback = false;
  try {
    const r = await chat({ role: 'reason', system, user, schema: ReportSchema, schemaName: 'Report', tag: st.spec.run_id, maxTokens: 1400 });
    served.push(r.served_by);
    if (r.ok && r.data) report = r.data;
  } catch { /* fallback below */ }
  if (!report) { report = fallbackReport(st, tools, samples); fallback = true; }

  // ---- critic: deterministic checks first
  const known = new Set(tools.map((t) => t.query_id));
  const codeIssues = (rep: Report) => {
    const issues: string[] = [];
    for (const c of rep.claims) {
      if (!c.query_ids.length) issues.push(`Claim without a query_id: "${c.text}"`);
      for (const q of c.query_ids) if (!known.has(q)) issues.push(`Unknown query_id ${q} in "${c.text}"`);
      const nums = (c.text.match(/\d+(\.\d+)?%/g) ?? []).map((x) => parseFloat(x));
      const pool = c.query_ids.flatMap((q) => tools.find((t) => t.query_id === q)?.rows ?? []).flatMap((row) => Object.values(row).filter((x) => typeof x === 'number') as number[]);
      const extra = [v.pooled.a, v.pooled.b, v.pooled.ci_half, v.pooled.diff, ...Object.values(v.secondary).flatMap((s) => [s.a, s.b])];
      for (const n of nums) if (![...pool, ...extra].some((x) => Math.abs(x * 100 - n) < 0.6 || Math.abs(x - n) < 0.6)) issues.push(`Number ${n}% in "${c.text}" is not in its cited results`);
    }
    for (const th of [...rep.objections, ...rep.likes]) for (const id of th.action_ids) if (!recById.has(id)) issues.push(`Quote ${id} is not an action in this run`);
    return issues;
  };
  let issues = codeIssues(report);
  let modelReview: { ok: boolean; issues: string[] } | null = null;
  let revised = false;
  if (!fallback) {
    try {
      const rv = await chat({
        role: 'review',
        system: 'You are the Report Critic. Reject claims that overstate certainty, treat simulated people as real customers, or state numbers that do not match the tool results. Be brief.',
        user: `Report:\n${JSON.stringify(report)}\n\nVerdict: ${v.headline}\nTool results:\n${toolText.slice(0, 12000)}\n\nCode checks found: ${issues.join('; ') || 'none'}`,
        schema: CriticSchema, schemaName: 'Critic', tag: st.spec.run_id, maxTokens: 500,
      });
      served.push(rv.served_by);
      if (rv.ok && rv.data) modelReview = rv.data;
    } catch { /* critic unavailable; code checks still apply */ }
    if (issues.length || (modelReview && !modelReview.ok)) {
      try {
        const r2 = await chat({ role: 'reason', system, user: `${user}\n\nYour previous report:\n${JSON.stringify(report)}\n\nThe critic rejected it:\n- ${[...issues, ...(modelReview?.issues ?? [])].join('\n- ')}\nFix every issue and return the full corrected report.`, schema: ReportSchema, schemaName: 'Report', tag: st.spec.run_id, maxTokens: 1400 });
        served.push(r2.served_by);
        if (r2.ok && r2.data) { report = r2.data; revised = true; issues = codeIssues(report); }
      } catch { /* keep first report with notes */ }
    }
  }
  // drop claims that still fail the code checks rather than show them
  report.claims = report.claims.filter((c) => !issues.some((i) => i.includes(`"${c.text}"`)));
  for (const th of [...report.objections, ...report.likes]) th.action_ids = th.action_ids.filter((id) => recById.has(id));

  const quotes: ReportBundle['quotes'] = {};
  for (const th of [...report.objections, ...report.likes]) for (const id of th.action_ids) {
    const r = recById.get(id)!;
    quotes[id] = { agent_id: r.agent_id, world_id: r.world_id, hour: r.hour, action: r.action, reason: r.reason, text: r.text, unsaid: r.unsaid, variant: r.variant };
  }
  return {
    report,
    tools: tools.map((t) => ({ tool: t.tool, query_id: t.query_id, engine: t.engine, args: t.args, row_count: t.rows.length })),
    quotes, critic: { code_issues: issues, model: modelReview, revised }, served_by: served, fallback,
  };
}

/** Deterministic report used when no reasoning model is reachable: numbers and quotes straight from the tools. */
function fallbackReport(st: RunState, tools: ToolResult[], samples: ToolResult[]): Report {
  const v = st.verdict!;
  const seg = tools.find((t) => t.tool === 'segment_breakdown' && t.args.by === 'role')!;
  const pick = (s: ToolResult | undefined) => (s?.rows ?? []).slice(0, 2).map((r) => String(r.action_id));
  const [va, vb] = v.variants;
  return {
    summary: v.headline,
    claims: seg.rows.map((r) => ({ text: `${r.segment} on ${r.variant}: intent ${(Number(r.intent_rate) * 100).toFixed(1)}% across ${r.deciders} simulated deciders.`, query_ids: [seg.query_id] })).slice(0, 4),
    objections: [va, vb].map((variant, i) => ({ theme: `Negative reactions to ${variant}`, variant, action_ids: pick(samples[i * 2]) })),
    likes: [va, vb].map((variant, i) => ({ theme: `Positive reactions to ${variant}`, variant, action_ids: pick(samples[i * 2 + 1]) })),
    tipping_note: 'See the tipping-point panel.',
    recommendation: v.winner ? `Run version ${v.winner}, and test a version C aimed at the losing segments.` : 'The versions are too close to call; test a sharper version C.',
  };
}

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
  quotes: Record<string, { agent_id: string; world_id: string; hour: number; action: string; reason: string; text: string; unsaid: string; variant: string; checks: string[] }>;
  critic: { code_issues: string[]; model: { ok: boolean; issues: string[] } | null; revised: boolean };
  served_by: string[];
  fallback: boolean;
}

/** What the model sees of each tool result: only the columns it needs, so the prompt stays a few thousand tokens. */
function compactTool(t: ToolResult): string {
  if (t.tool === 'query_actions' && t.args.sentiment) {
    return JSON.stringify(t.rows.slice(0, 14).map((r) => ({ action_id: r.action_id, reason: String(r.reason ?? '').slice(0, 90), role: r.role, age: r.age_band })));
  }
  if (t.tool === 'timeline') return JSON.stringify(t.rows.map((r) => ({ v: r.variant, round: r.hour, decisions: r.decisions, visit_yes: r.visit_yes, vocal: r.vocal })));
  return JSON.stringify(t.rows.slice(0, 16));
}

export async function buildReport(st: RunState): Promise<ReportBundle> {
  const v = st.verdict!;
  const [va, vb] = v.variants;
  const tools: ToolResult[] = [];
  for (const by of ['role', 'age', 'income', 'customer'] as const) tools.push(await segmentBreakdown(st, by));
  tools.push(await timeline(st));
  tools.push(await reactionCounts(st));
  tools.push(await crowdVsCensus(st));
  const samples: ToolResult[] = [];
  for (const variant of [va, vb]) for (const s of ['negative', 'positive'] as const) samples.push(await reactionSample(st, variant, s, 14));
  tools.push(...samples);

  const recById = new Map(allRecords(st).map((r) => [r.id, r]));
  const tippingLines = Object.entries(st.tipping ?? {}).map(([w, t]) => t ? `${w}: @${t.record.agent_id} shared at round ${t.record.hour} ("${t.record.text}") and reached ${t.reached} people` : `${w}: no shares`);

  const system = `You are the report agent in Dry Run. You turn tool results from a simulated A/B test into a one-screen verdict for a small business owner.
Rules:
- Use only numbers that appear in the tool results or the verdict. Every claim lists the query_id(s) it came from.
- Quotes are chosen by action_id from the reaction samples; pick ones whose reason clearly shows the theme.
- This is a simulation of AI personas sampled from Census and Pew data, not real customers. Do not say "customers said"; say "simulated people" or "the crowd".
- Write rates as percentages with one decimal (0.1234 -> 12.3%). Never invent prices, products or offers; only the ones in the two versions exist.
- Plain, specific language. No hype.`;
  // The model sees stable aliases (Q1..Qn), not run-specific query ids, so recorded calls replay; aliases map back below.
  const alias = new Map(tools.map((t, i) => [`Q${i + 1}`, t.query_id]));
  const toolText = tools.map((t, i) => `### ${t.tool} ${JSON.stringify(t.args)} query_id=Q${i + 1}\n${compactTool(t)}`).join('\n\n');
  const unalias = (rep: Report): Report => ({ ...rep, claims: rep.claims.map((c) => ({ ...c, query_ids: c.query_ids.map((q) => alias.get(q.trim()) ?? q) })) });
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
    if (r.ok && r.data) report = unalias(r.data);
  } catch { /* fallback below */ }
  if (!report) { report = fallbackReport(st, tools, samples); fallback = true; }

  // ---- critic: deterministic checks first
  const known = new Set(tools.map((t) => t.query_id));
  const codeIssues = (rep: Report) => {
    const issues: string[] = [];
    for (const c of rep.claims) {
      if (!c.query_ids.length) issues.push(`Claim without a query_id: "${c.text}"`);
      for (const q of c.query_ids) if (!known.has(q)) issues.push(`Unknown query_id ${q} in "${c.text}"`);
      // percentages must match a fraction column (|x| <= 1) of the cited rows or a verdict value; counts must match an integer cell
      const cells = c.query_ids.flatMap((q) => tools.find((t) => t.query_id === q)?.rows ?? []).flatMap((row) => Object.values(row).filter((x) => typeof x === 'number') as number[]);
      const fractions = [...cells.filter((x) => Math.abs(x) <= 1), v.pooled.a, v.pooled.b, v.pooled.ci_half, Math.abs(v.pooled.diff), ...Object.values(v.secondary).flatMap((s) => [s.a, s.b])];
      for (const m of c.text.match(/\d+(\.\d+)?%/g) ?? []) {
        const n = parseFloat(m);
        if (!fractions.some((x) => Math.abs(x * 100 - n) < 0.15)) issues.push(`Number ${m} in "${c.text}" is not in its cited results`);
      }
      const ints = new Set(cells.filter((x) => Number.isInteger(x)));
      // bare decimals like 0.365 are rates: they must match a fraction cell, like percentages do
      for (const m of c.text.replace(/\d+(\.\d+)?%/g, '').match(/\b0?\.\d+\b/g) ?? []) {
        const n = parseFloat(m);
        if (!fractions.some((x) => Math.abs(x - n) < 0.0015)) issues.push(`Rate ${m} in "${c.text}" is not in its cited results`);
      }
      for (const m of c.text.replace(/\d+(\.\d+)?%/g, '').replace(/\d*\.\d+/g, '').match(/\b\d{2,}\b/g) ?? []) if (!ints.has(Number(m))) issues.push(`Count ${m} in "${c.text}" is not in its cited results`);
    }
    for (const th of [...rep.objections, ...rep.likes]) for (const id of th.action_ids) if (!recById.has(id)) issues.push(`Quote ${id} is not an action in this run`);
    // direction: "A leads/has higher ... (x% vs y%)" must give x to the version it names
    const pairs = [{ a: v.pooled.a, b: v.pooled.b }, ...Object.values(v.secondary).map((m) => ({ a: m.a, b: m.b })), ...v.segments.map((m) => ({ a: m.a, b: m.b }))];
    for (const c of rep.claims) {
      const m = c.text.match(/\b(A|B)\b[^()]*?\(\s*(\d+(?:\.\d+)?)%\s*vs\.?\s*(\d+(?:\.\d+)?)%\s*\)/);
      if (!m) continue;
      const [, who, x, y] = m;
      const near = (p: number, q: number) => Math.abs(p * 100 - q) < 0.6;
      const pair = pairs.find((p) => (near(p.a, +x) && near(p.b, +y)) || (near(p.a, +y) && near(p.b, +x)));
      if (!pair) continue;
      const named = who === va ? pair.a : pair.b;
      if (!near(named, +x)) issues.push(`Claim gives ${x}% to ${who}, but ${who} is at ${(named * 100).toFixed(1)}%: "${c.text}"`);
    }
    // prices and offers must exist in the posts; headline percentages must match the verdict
    const postText = st.spec.posts.map((p) => p.text).join(' ');
    for (const field of [rep.summary, rep.recommendation, rep.tipping_note, ...rep.claims.map((c) => c.text)]) {
      for (const m of field.match(/\$\d+(\.\d+)?/g) ?? []) if (!postText.includes(m)) issues.push(`Price ${m} does not appear in either version: "${field}"`);
    }
    for (const field of [rep.summary, rep.recommendation, rep.tipping_note]) {
      for (const m of field.match(/\d+(\.\d+)?%/g) ?? []) {
        const n = parseFloat(m);
        const ok = [v.pooled.a, v.pooled.b, v.pooled.ci_half, Math.abs(v.pooled.diff), ...Object.values(v.secondary).flatMap((s) => [s.a, s.b]), ...v.segments.flatMap((s) => [s.a, s.b])].some((x) => Math.abs(x * 100 - n) < 0.6) || postText.includes(m);
        if (!ok) issues.push(`Number ${m} in the summary or recommendation is not in the results`);
      }
    }
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
        user: `Report:\n${JSON.stringify({ ...report, claims: report.claims.map((c) => ({ ...c, query_ids: c.query_ids.map((q) => [...alias.entries()].find(([, id]) => id === q)?.[0] ?? q) })) })}\n\nVerdict: ${v.headline}\nTool results:\n${toolText.slice(0, 12000)}\n\nCode checks found: ${issues.join('; ') || 'none'}`,
        schema: CriticSchema, schemaName: 'Critic', tag: st.spec.run_id, maxTokens: 500,
      });
      served.push(rv.served_by);
      if (rv.ok && rv.data) modelReview = rv.data;
    } catch { /* critic unavailable; code checks still apply */ }
    if (issues.length || (modelReview && !modelReview.ok)) {
      try {
        const r2 = await chat({ role: 'reason', system, user: `${user}\n\nYour previous report:\n${JSON.stringify(report)}\n\nThe critic rejected it:\n- ${[...issues, ...(modelReview?.issues ?? [])].join('\n- ')}\nFix every issue and return the full corrected report.`.replace(/q_[0-9a-f]{8}_[0-9a-z]+/g, (id) => [...alias.entries()].find(([, v]) => v === id)?.[0] ?? id), schema: ReportSchema, schemaName: 'Report', tag: st.spec.run_id, maxTokens: 1400 });
        served.push(r2.served_by);
        if (r2.ok && r2.data) { report = unalias(r2.data); revised = true; issues = codeIssues(report); }
      } catch { /* keep first report with notes */ }
    }
  }
  // quality floor: a summary or recommendation too thin to act on is replaced with text built from the verdict
  const segNote = v.segments.filter((x) => x.clear).slice(0, 2).map((x) => `${x.key.replace(':', ' ')} prefers ${x.prefers}`).join('; ');
  if (report.summary.trim().length < 60 || !/\b(A|B|C|version)\b/i.test(report.summary)) {
    report.summary = `${v.headline}${segNote ? ` Clear segment splits: ${segNote}.` : ''}`;
    issues.push('Summary was too thin; replaced with the computed verdict.');
  }
  if (report.recommendation.trim().length < 30) {
    report.recommendation = v.winner ? `Run version ${v.winner}, then test a version C aimed at the segments that preferred the other one.` : 'Too close to call: test a sharper version C on the same crowd before spending.';
    issues.push('Recommendation was too thin; replaced with a rule-based one.');
  }
  report.claims = report.claims.filter((c) => c.text.trim().length >= 25);
  // drop claims that still fail the code checks rather than show them
  report.claims = report.claims.filter((c) => !issues.some((i) => i.includes(`"${c.text}"`)));
  if (issues.some((i) => i.includes('summary or recommendation') || (i.startsWith('Price') && (i.includes(report!.summary) || i.includes(report!.recommendation))))) {
    report.summary = v.headline;
    report.recommendation = v.winner ? `Run version ${v.winner}, then test a version C aimed at the segments that preferred the other one.` : 'Too close to call: test a sharper version C before spending.';
  }
  for (const th of [...report.objections, ...report.likes]) th.action_ids = th.action_ids.filter((id) => recById.has(id));
  // a quote must point the same way as its theme, and three quotes are enough
  for (const th of report.objections) th.action_ids = th.action_ids.filter((id) => (recById.get(id)?.feeling ?? 0) < 0).slice(0, 3);
  for (const th of report.likes) th.action_ids = th.action_ids.filter((id) => (recById.get(id)?.feeling ?? 0) > 0).slice(0, 3);
  // a model theme must be about what its quotes say: its label's words appear in at least two quoted reasons
  const labelFits = (th: Report['objections'][number]) => {
    const words = th.theme.toLowerCase().match(/[a-z]{4,}|\d+%/g) ?? [];
    return th.action_ids.filter((id) => words.some((w) => (recById.get(id)?.reason ?? '').toLowerCase().includes(w))).length >= 2;
  };
  report.objections = report.objections.filter(labelFits);
  report.likes = report.likes.filter(labelFits);
  // a claim states a number from its query; a claim without one cannot be checked
  report.claims = report.claims.filter((c) => /\d/.test(c.text));
  // query aliases belong in query_ids, not in the prose
  const noAlias = (x: string) => x.replace(/\s*\((?:Q\d+(?:,\s*)?)+\)/g, '').replace(/\s+([.,;])/g, '$1');
  report.summary = noAlias(report.summary);
  report.recommendation = noAlias(report.recommendation);
  for (const c of report.claims) c.text = noAlias(c.text);
  // no winner: the summary must say so up front, and the recommendation must be a next test, not a pick
  if (!v.winner) {
    if (!/too close|not a clear|within the (margin|interval)|no clear/i.test(report.summary)) {
      const rest = report.summary.split(/(?<=[.!?])\s+(?=[A-Z])/).filter((x) => !/\b(leads?|wins?|winner|ahead|beats?|better)\b/i.test(x)).join(' ');
      report.summary = `${v.headline} ${rest}`.trim();
      issues.push('Summary implied a winner although the verdict is too close to call; the verdict now leads it.');
    }
    const before = report.claims.length;
    report.claims = report.claims.filter((c) => !/\b(leads?|wins?|winner|beats?|outperforms?)\b/i.test(c.text));
    if (report.claims.length < before) issues.push('Dropped claims that named a winner although the verdict is too close to call.');
    if (!/version c|test|re-?run|bigger|larger/i.test(report.recommendation)) {
      report.recommendation = 'Too close to call: test a sharper version C on the same crowd before spending.';
      issues.push('Recommendation picked a side without a winner; replaced with the next test.');
    }
  }
  // floor: at least 3 claims; extras are the widest segment gaps, built in code from the segment queries they cite
  if (report.claims.length < 3) {
    const gaps: { text: string; qid: string; gap: number }[] = [];
    for (const t of tools.filter((x) => x.tool === 'segment_breakdown')) {
      const bySeg = new Map<string, Record<string, { rate: number; n: number }>>();
      for (const r of t.rows) {
        const k = String(r.segment);
        bySeg.set(k, { ...(bySeg.get(k) ?? {}), [String(r.variant)]: { rate: Number(r.intent_rate), n: Number(r.deciders) } });
      }
      for (const [seg, m] of bySeg) {
        const a = m[va], b = m[vb];
        if (!a || !b || a.n < 40 || b.n < 40) continue; // small segments swing on a handful of people
        gaps.push({ qid: t.query_id, gap: Math.abs(a.rate - b.rate), text: `${t.args.by === 'customer' ? seg : `${t.args.by} ${seg}`}: intent ${(a.rate * 100).toFixed(1)}% on ${va} vs ${(b.rate * 100).toFixed(1)}% on ${vb} (${a.n} and ${b.n} people deciding).` });
      }
    }
    gaps.sort((x, y) => y.gap - x.gap);
    for (const g of gaps) {
      if (report.claims.length >= 3) break;
      report.claims.push({ text: g.text, query_ids: [g.qid] });
    }
  }
  // floor: every version gets at least one objection and one like theme, quoted from the real reaction samples
  const [sa, sb] = [va, vb];
  const fill = (list: Report['objections'], kind: 'negative' | 'positive') => {
    // a theme needs quotes and a real description (one-word labels like "intent" are metric names, not themes)
    const kept = list.filter((t) => t.action_ids.length && t.theme.trim().split(/\s+/).length >= 2);
    for (const [i, variant] of [sa, sb].entries()) {
      if (kept.some((t) => t.variant === variant)) continue;
      const th = themeFrom(samples[i * 2 + (kind === 'positive' ? 1 : 0)], variant, kind);
      if (th) { kept.push(th); issues.push(`No ${kind === 'negative' ? 'objection' : 'like'} theme for ${variant}; filled from the reaction sample.`); }
    }
    return kept.slice(0, 3);
  };
  report.objections = fill(report.objections, 'negative');
  report.likes = fill(report.likes, 'positive');
  // the tipping note states computed facts only
  report.tipping_note = tippingNote(st);

  const quotes: ReportBundle['quotes'] = {};
  for (const th of [...report.objections, ...report.likes]) for (const id of th.action_ids) {
    const r = recById.get(id)!;
    quotes[id] = { agent_id: r.agent_id, world_id: r.world_id, hour: r.hour, action: r.action, reason: r.reason, text: r.text, unsaid: r.unsaid, variant: r.variant, checks: r.checks ?? [] };
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
    claims: seg.rows.map((r) => ({ text: `${r.segment} on ${r.variant}: intent ${(Number(r.intent_rate) * 100).toFixed(1)}% (${r.deciders} simulated people deciding, summed over ${st.spec.seeds.length} seed${st.spec.seeds.length > 1 ? "s" : ""}).`, query_ids: [seg.query_id] })).slice(0, 4),
    objections: [va, vb].map((variant, i) => themeFrom(samples[i * 2], variant, 'negative') ?? { theme: `Negative reactions to ${variant}`, variant, action_ids: pick(samples[i * 2]) }),
    likes: [va, vb].map((variant, i) => themeFrom(samples[i * 2 + 1], variant, 'positive') ?? { theme: `Positive reactions to ${variant}`, variant, action_ids: pick(samples[i * 2 + 1]) }),
    tipping_note: tippingNote(st),
    recommendation: v.winner ? `Run version ${v.winner}, and test a version C aimed at the losing segments.` : 'The versions are too close to call; test a sharper version C.',
  };
}

/** Keyword buckets for grouping simulated reasons into a theme when the model returns none. */
const THEMES: { name: string; re: RegExp }[] = [
  { name: 'price', re: /\$|\bprice|\bpric(ey|y)|expensive|cost|budget|afford|spend|cheap/i },
  { name: 'the discount', re: /\b\d+%|discount|\boff\b|deal|sale|promo/i },
  { name: 'trust in ads', re: /\bads?\b|advert|marketing|gimmick|sponsored|salesy|pushy/i },
  { name: 'routine and habit', re: /routine|habit|ritual|usual|already have|every morning|my coffee/i },
  { name: 'taste and ingredients', re: /oat|honey|sweet|taste|flavou?r|dairy|milk|local/i },
  { name: 'distance and time', re: /far|drive|detour|commute|nearby|close to|time|busy|walk/i },
];

function themeFrom(sample: ToolResult | undefined, variant: string, kind: 'negative' | 'positive'): Report['objections'][number] | null {
  const rows = (sample?.rows ?? []).filter((r) => String(r.reason ?? '').trim());
  if (!rows.length) return null;
  let best = { name: '', ids: [] as string[] };
  for (const t of THEMES) {
    const ids = rows.filter((r) => t.re.test(String(r.reason))).map((r) => String(r.action_id));
    if (ids.length > best.ids.length) best = { name: t.name, ids };
  }
  const ids = best.ids.length >= 2 ? best.ids : rows.map((r) => String(r.action_id));
  const label = best.ids.length >= 2 ? `${kind === 'negative' ? 'Put off by' : 'Drawn by'} ${best.name}` : `${kind === 'negative' ? 'Negative' : 'Positive'} reactions`;
  return { theme: `${label} (${best.ids.length >= 2 ? best.ids.length : rows.length} of ${rows.length} sampled reasons)`, variant, action_ids: ids.slice(0, 2) };
}

function tippingNote(st: RunState): string {
  const entries = Object.entries(st.tipping ?? {});
  const hits = entries.filter(([, t]) => t);
  if (!hits.length) return 'No one shared either version, so neither spread beyond the people it was served to.';
  return hits.map(([w, t]) => `In world ${w}, @${t!.record.agent_id} shared it in round ${t!.record.hour + 1} and it reached ${t!.reached} more people.`).join(' ');
}

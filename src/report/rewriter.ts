/**
 * Version C (BUILD_PLAN §5): the Rewriter drafts a post aimed at the losing segments' objections; the
 * Honesty check (review model) rejects a rewrite that hides the price or the offer or invents claims.
 */
import { z } from 'zod';
import { chat } from '../llm.js';
import type { RunState } from '../sim/run.js';

const Draft = z.object({ text: z.string().describe('the new post, under 220 characters'), rationale: z.string(), targets: z.array(z.string()).describe('segments and objections it addresses') });
const Honesty = z.object({ ok: z.boolean(), issues: z.array(z.string()) });

export async function draftVersionC(st: RunState) {
  const v = st.verdict!;
  const rep = (st.report as any)?.report;
  const [A, B] = st.spec.posts;
  const winner = v.winner ? st.spec.posts.find((p) => p.variant === v.winner)! : (v.pooled.a >= v.pooled.b ? A : B);
  const losingSegs = v.segments.filter((s) => s.prefers && s.prefers !== winner.variant).map((s) => `${s.key} prefers ${s.prefers} (${(s.a * 100).toFixed(0)}% vs ${(s.b * 100).toFixed(0)}%)`);
  const objections = (rep?.objections ?? []).map((o: any) => `${o.variant}: ${o.theme}`);
  const quotes = Object.values((st.report as any)?.quotes ?? {}).slice(0, 6).map((q: any) => `"${q.reason}"`);
  const system = `You are the Rewriter in Dry Run. Write version C of a small business's Instagram post.
Keep everything that made the winner work, and answer the objections of the segments that preferred the other version.
Rules: keep the real price and any real offer visible; do not invent facts, awards, ingredients or claims; no fake urgency; under 220 characters.`;
  const user = `Business: ${st.spec.business} (${st.spec.place}). Goal: ${st.spec.goal}
Version A: "${A.text}"
Version B: "${B.text}"
Verdict: ${v.headline}
Segments that preferred the other version: ${losingSegs.join('; ') || 'none clear'}
Top objections: ${objections.join('; ') || 'n/a'}
Sample reasons from the crowd: ${quotes.join(' ')}`;
  let draft = await chat({ role: 'reason', system, user, schema: Draft, schemaName: 'VersionC', tag: `${st.spec.run_id}:rewriter`, maxTokens: 400 });
  let d = draft.data ?? { text: winner.text, rationale: 'Rewriter unavailable; kept the winner.', targets: [] };
  let honesty = { ok: true, issues: [] as string[] };
  for (let attempt = 0; attempt < 2; attempt++) {
    const h = await chat({
      role: 'review',
      system: 'You are the Honesty check. Compare the rewrite to the originals. Reject (ok=false) if it removes or hides the price or the offer that the originals state, invents facts not in the originals, or adds fake urgency. Be brief.',
      user: `Originals:\nA: "${A.text}"\nB: "${B.text}"\nRewrite (C): "${d.text}"`,
      schema: Honesty, schemaName: 'Honesty', tag: `${st.spec.run_id}:honesty`, maxTokens: 300,
    });
    honesty = h.data ?? honesty;
    if (honesty.ok) break;
    draft = await chat({ role: 'reason', system, user: `${user}\n\nYour draft "${d.text}" was rejected by the honesty check: ${honesty.issues.join('; ')}. Fix it.`, schema: Draft, schemaName: 'VersionC', tag: `${st.spec.run_id}:rewriter`, maxTokens: 400 });
    if (draft.data) d = draft.data;
  }
  return { winner: winner.variant, winner_text: winner.text, c: d, honesty };
}

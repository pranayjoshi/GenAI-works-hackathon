/**
 * Spend decision and launch plan: the step that turns a finished simulation into an action with money on it.
 *
 * 1. Is a real A/B test of these two posts worth paying for? The simulated gap sets the effect size; a
 *    two-proportion power calculation (5% two-sided, 80% power) gives the people needed per version; the
 *    Census x Pew join gives how many Instagram users the business can reach at all. A test that would need
 *    more than MAX_TEST_SHARE of the local audience is not worth running.
 * 2. If not, rewrite: a brief built from the memory-backed objections and likes (each quote is an action id),
 *    a draft from the Rewriter, and the Honesty check.
 * 3. A launch plan for the test that is worth running: variants, targeting, people per version, the
 *    pre-registered success metric and decision rule.
 * 4. Action policy: cheap, reversible steps run on their own; anything that spends money or publishes waits
 *    for the owner's approval. Dry Run never posts or spends; approving exports the plan.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { RunState } from '../sim/run.js';
import { draftVersionC } from './rewriter.js';

/** A real test that needs more than this share of all local Instagram users is not worth running (assumption, stated in the plan). */
export const MAX_TEST_SHARE = 0.2;
const Z_ALPHA = 1.959964; // 5% two-sided
const Z_BETA = 0.841621;  // 80% power

export type ActionStatus = 'done' | 'proposed' | 'approved' | 'rejected';
export interface DecisionAction {
  id: string;
  kind: 'cancel_test' | 'draft_variant' | 'simulate_variant' | 'launch_test' | 'publish';
  title: string;
  detail: string;
  policy: 'auto' | 'needs_approval';
  why_policy: string;
  status: ActionStatus;
  evidence: string[];
  decided_at?: string;
  /** What the action did when it ran (for the launch: the Meta campaign, ad set and ad ids, or the preview payloads). */
  result?: unknown;
}

export interface Decision {
  run_id: string;
  created: string;
  call: 'cancel_ab' | 'run_ab' | 'launch_winner';
  headline: string;
  reasons: string[];
  verdict: { headline: string; a: number; b: number; gap_pts: number; ci_half_pts: number; winner: string | null; leader: string };
  audience: { local_instagram_users: number; place: string; query_id?: string; source: string };
  sample_size: { metric: string; p_a: number; p_b: number; per_version: number | null; total: number | null; share_of_audience: number | null; alpha: number; power: number };
  affordable: { max_share: number; per_version: number; detectable_gap_pts: number };
  brief: {
    objections: { variant: string; theme: string; quotes: { action_id: string; reason: string }[] }[];
    likes: { variant: string; theme: string; quotes: { action_id: string; reason: string }[] }[];
    segments: string[];
  };
  variant: { text: string; rationale: string; targets: string[]; honesty: { ok: boolean; issues: string[] } } | null;
  plan: {
    variants: { label: string; text: string }[];
    targeting: { platform: string; place: string; zip: string; age_bands: string[]; note: string };
    per_version: number;
    total: number;
    success_metric: string;
    decision_rule: string;
    stop_rule: string;
    assumptions: string[];
  };
  actions: DecisionAction[];
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

/** People per version to detect p1 vs p2 (two-proportion z-test, pooled variance under H0). */
export function perVersion(p1: number, p2: number): number | null {
  const d = Math.abs(p1 - p2);
  if (d < 1e-9) return null;
  const pbar = (p1 + p2) / 2;
  const n = (Z_ALPHA * Math.sqrt(2 * pbar * (1 - pbar)) + Z_BETA * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2))) ** 2 / d ** 2;
  return Math.ceil(n);
}

/** Smallest gap (as a fraction) that n people per version can detect around base rate p. */
export function detectableGap(p: number, n: number): number {
  let lo = 0.0005, hi = 0.9;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const need = perVersion(p, Math.min(0.999, p + mid)) ?? Infinity;
    if (need > n) lo = mid; else hi = mid;
  }
  return hi;
}

export async function buildDecision(st: RunState, opts: { draft?: boolean; keepVariant?: boolean } = {}): Promise<Decision> {
  const v = st.verdict;
  if (!v) throw new Error('Run has no verdict yet');
  const bundle = (st.report as any) ?? {};
  const rep = bundle.report ?? {};
  const quotes: Record<string, { reason: string }> = bundle.quotes ?? {};
  const [A, B] = st.spec.posts;
  const leader = v.winner ?? (v.pooled.a >= v.pooled.b ? A.variant : B.variant);
  const leaderPost = st.spec.posts.find((p) => p.variant === leader)!;
  const other = st.spec.posts.find((p) => p.variant !== leader)!;

  const audienceN = Number(st.sampleReport?.instagram_users_est ?? 0);
  const audienceQ = st.sampleReport?.queries?.find((q) => /audience size/i.test(q.label));
  const pA = v.pooled.a, pB = v.pooled.b;
  const n = perVersion(pA, pB);
  const total = n ? n * 2 : null;
  const share = total && audienceN ? total / audienceN : null;
  const affordablePer = Math.max(1, Math.floor((audienceN * MAX_TEST_SHARE) / 2));
  const mde = detectableGap(Math.max(pA, pB), affordablePer);

  const theme = (t: any) => ({ variant: t.variant, theme: t.theme, quotes: (t.action_ids ?? []).map((id: string) => ({ action_id: id, reason: quotes[id]?.reason ?? '' })) });
  const brief = {
    objections: (rep.objections ?? []).map(theme),
    likes: (rep.likes ?? []).map(theme),
    segments: (rep.claims ?? []).map((c: any) => c.text),
  };

  const gapPts = Math.abs(pA - pB) * 100;
  const tooBig = share === null || share > MAX_TEST_SHARE;
  const call: Decision['call'] = v.winner ? 'launch_winner' : tooBig ? 'cancel_ab' : 'run_ab';

  const reasons: string[] = [];
  reasons.push(`The simulated gap is ${gapPts.toFixed(1)} points (${leader} ${pct(Math.max(pA, pB))} vs ${other.variant} ${pct(Math.min(pA, pB))}), inside a ±${(v.pooled.ci_half * 100).toFixed(1)}-point interval: ${v.winner ? `version ${v.winner} wins every seed and clears the interval` : 'no winner'}.`);
  if (n) reasons.push(`A real test needs about ${n.toLocaleString('en-US')} people per version to detect a gap that small (5% two-sided, 80% power): ${total!.toLocaleString('en-US')} in all.`);
  if (audienceN) reasons.push(`There are about ${audienceN.toLocaleString('en-US')} Instagram users in ${st.spec.place} (Census x Pew join), so that test would have to reach ${share !== null ? pct(share) : 'more than all'} of them.`);
  reasons.push(`A test using at most ${pct(MAX_TEST_SHARE)} of the local audience (${affordablePer.toLocaleString('en-US')} per version) can only detect a gap of about ${(mde * 100).toFixed(1)} points, so the next version must move intent by at least that much to be worth testing.`);

  let variant: Decision['variant'] = opts.keepVariant ? st.decision?.variant ?? null : null;
  if (opts.draft && !variant && call !== 'launch_winner') {
    const c = await draftVersionC(st);
    variant = { text: c.c.text, rationale: c.c.rationale, targets: c.c.targets ?? [], honesty: c.honesty };
  }

  const coreBands = (st.proposal?.core?.age_bands as string[] | undefined) ?? [];
  const planVariants = call === 'launch_winner'
    ? [{ label: `Version ${leader}`, text: leaderPost.text }]
    : call === 'run_ab'
      ? [{ label: 'Version A', text: A.text }, { label: 'Version B', text: B.text }]
      : [{ label: `Version ${leader} (current leader)`, text: leaderPost.text }, { label: 'Version C (rewrite)', text: variant?.text ?? '(draft pending)' }];
  const planPer = call === 'run_ab' && n ? n : affordablePer;
  const plan: Decision['plan'] = {
    variants: planVariants,
    targeting: { platform: 'Instagram', place: st.spec.place, zip: st.spec.zip, age_bands: coreBands, note: `Core segment ${st.proposal?.core?.name ?? ''} first; the crowd sampled ${pct(st.spec.coreShare ?? 0.5)} core.`.trim() },
    per_version: planPer,
    total: call === 'launch_winner' ? planPer : planPer * 2,
    success_metric: 'Taps through to the post and store visits attributed to the post (the real-world counterpart of the simulated intent to visit).',
    decision_rule: call === 'launch_winner'
      ? `Keep version ${leader} running if its tap rate is not below the simulated range; otherwise pause and re-test.`
      : `Pick the version whose tap rate is higher by at least ${(mde * 100).toFixed(1)} points with a 95% interval that excludes zero; otherwise keep ${leader} and stop testing.`,
    stop_rule: `Stop when each version has reached ${planPer.toLocaleString('en-US')} people, or after 7 days.`,
    assumptions: [
      `The real gap is no larger than the simulated one (simulated people, local Nemotron 3 Nano 4B; the backtest shows the crowd does not predict real winners).`,
      `A test is worth paying for only if it needs at most ${pct(MAX_TEST_SHARE)} of local Instagram users.`,
      `Audience size is an estimate: ACS adults in the ZIP times national Pew Instagram use by age.`,
    ],
  };

  const ev = [audienceQ?.query_id, ...brief.objections.flatMap((o: any) => o.quotes.map((q: any) => q.action_id))].filter(Boolean) as string[];
  const actions: DecisionAction[] = [];
  if (call === 'cancel_ab') {
    actions.push({ id: 'cancel_ab', kind: 'cancel_test', title: `Don't pay for an A/B test of ${A.variant} vs ${B.variant}`, detail: `It would need ${total?.toLocaleString('en-US') ?? 'more than all'} people, ${share !== null ? pct(share) : 'more than all'} of local Instagram users, to tell apart a ${gapPts.toFixed(1)}-point gap.`, policy: 'auto', why_policy: 'Not spending is free and reversible.', status: 'done', evidence: audienceQ ? [audienceQ.query_id] : [] });
    actions.push({ id: 'draft_c', kind: 'draft_variant', title: 'Draft a bolder version from what people objected to', detail: variant ? `"${variant.text}"${variant.honesty.ok ? ' (passed the honesty check)' : ` (honesty check: ${variant.honesty.issues.join('; ')})`}` : 'Rewrite brief ready; draft runs on request.', policy: 'auto', why_policy: 'A draft spends nothing and is never published on its own.', status: variant ? 'done' : 'proposed', evidence: ev.slice(1) });
    actions.push({ id: 'simulate_c', kind: 'simulate_variant', title: `Simulate version C against ${leader} on the same crowd`, detail: `Worth a real test only if C moves intent by at least ${(mde * 100).toFixed(1)} points.`, policy: 'auto', why_policy: 'Simulation spends no ad money; it runs on the local model.', status: 'proposed', evidence: [] });
    actions.push({ id: 'launch_test', kind: 'launch_test', title: `Create the real split test in Meta Ads: ${leader} vs C`, detail: `One paused campaign, one ad set per version (same targeting and budget): Instagram, ZIP ${st.spec.zip}, ages ${coreBands.join(', ') || 'core'}, ${planPer.toLocaleString('en-US')} people per version.`, policy: 'needs_approval', why_policy: 'It sets up ad spend and public posts in your ad account: you decide. Everything is created paused.', status: 'proposed', evidence: ev });
  } else if (call === 'run_ab') {
    actions.push({ id: 'launch_test', kind: 'launch_test', title: `Create the real split test in Meta Ads: ${A.variant} vs ${B.variant}`, detail: `One paused campaign, one ad set per version: ${n!.toLocaleString('en-US')} people per version (${share !== null ? pct(share) : '?'} of local Instagram users).`, policy: 'needs_approval', why_policy: 'It sets up ad spend and public posts in your ad account: you decide. Everything is created paused.', status: 'proposed', evidence: ev });
  } else {
    actions.push({ id: 'publish', kind: 'publish', title: `Create the version ${leader} ad in Meta Ads (paused)`, detail: leaderPost.text, policy: 'needs_approval', why_policy: 'Publishing is public and hard to undo: you decide. It is created paused.', status: 'proposed', evidence: ev });
  }

  const headline = call === 'cancel_ab'
    ? `Don't pay to A/B test these two posts: they are too close to tell apart with the people ${st.spec.business} can reach. Test a bolder version instead.`
    : call === 'run_ab'
      ? `A real A/B test of these two posts is affordable: ${n!.toLocaleString('en-US')} people per version.`
      : `Launch version ${leader}: it won every seed by more than the interval.`;

  return {
    run_id: st.spec.run_id, created: new Date().toISOString(), call, headline, reasons,
    verdict: { headline: v.headline, a: pA, b: pB, gap_pts: gapPts, ci_half_pts: v.pooled.ci_half * 100, winner: v.winner ?? null, leader },
    audience: { local_instagram_users: audienceN, place: st.spec.place, query_id: audienceQ?.query_id, source: 'ACS adults by age in the ZIP x Pew Instagram use by age' },
    sample_size: { metric: 'intent to visit (simulated)', p_a: pA, p_b: pB, per_version: n, total, share_of_audience: share, alpha: 0.05, power: 0.8 },
    affordable: { max_share: MAX_TEST_SHARE, per_version: affordablePer, detectable_gap_pts: mde * 100 },
    brief, variant, plan, actions,
  };
}

/**
 * Record the owner's approval or rejection of one action. Approving a launch runs it: the split test is created in
 * Meta Ads, paused (src/actions/meta.ts), or previewed when Meta is not configured. Dry Run never activates or spends.
 */
export async function decideAction(d: Decision, actionId: string, choice: 'approve' | 'reject', business: string): Promise<DecisionAction> {
  const a = d.actions.find((x) => x.id === actionId);
  if (!a) throw Object.assign(new Error(`No action ${actionId}`), { statusCode: 404 });
  if (a.policy !== 'needs_approval') throw Object.assign(new Error('This action runs on its own and needs no approval'), { statusCode: 400 });
  if (a.status === 'approved' && (a.result as any)?.ok && (a.result as any)?.mode === 'live') throw Object.assign(new Error('Already created in Meta Ads'), { statusCode: 409 });
  a.decided_at = new Date().toISOString();
  if (choice === 'reject') { a.status = 'rejected'; return a; }
  if (a.kind === 'launch_test' || a.kind === 'publish') {
    const { launchOnMeta, launchInputFromDecision } = await import('../actions/meta.js');
    const inp = launchInputFromDecision(d, business);
    if (a.kind === 'publish') inp.variants = inp.variants.slice(0, 1);
    a.result = await launchOnMeta(inp);
  }
  a.status = 'approved';
  return a;
}

/** The launch plan as a file the owner can take to their ad tool. */
export function writeLaunchPlan(dir: string, d: Decision): string {
  const file = path.join(dir, 'launch_plan.json');
  const approved = d.actions.filter((a) => a.status === 'approved').map((a) => a.id);
  fs.writeFileSync(file, JSON.stringify({ run_id: d.run_id, call: d.call, headline: d.headline, approved_actions: approved, plan: d.plan, reasons: d.reasons, exported: new Date().toISOString(), note: 'Exported by Dry Run. Nothing was posted or spent.' }, null, 2));
  return file;
}

/**
 * The agent's own check: Version C, simulated on the same crowd, against the leader. Called when the C run starts
 * and when it finishes. C is worth a real test only if it beats the leader by the gap an affordable test can detect.
 */
export function recordVerification(parent: RunState, child: RunState): void {
  const d = parent.decision;
  const act = d?.actions.find((x) => x.kind === 'simulate_variant');
  if (!d || !act) return;
  const run_id = child.spec.run_id;
  const v = child.verdict;
  if (!v) { act.result = { status: child.status === 'error' ? 'error' : 'running', run_id, error: child.error }; return; }
  const lead = v.pooled.a, c = v.pooled.b;
  const gap = (c - lead) * 100, bar = d.affordable.detectable_gap_pts;
  const passes = gap >= bar;
  const L = d.verdict.leader;
  const headline = passes
    ? `Version C moved intent by ${gap.toFixed(1)} points on the same crowd (${pct(c)} vs ${pct(lead)}), clearing the ${bar.toFixed(1)}-point bar. A real test of ${L} vs C is worth paying for.`
    : `Version C moved intent by ${gap >= 0 ? '+' : ''}${gap.toFixed(1)} points on the same crowd (${pct(c)} vs ${pct(lead)}), short of the ${bar.toFixed(1)}-point bar. Keep ${L} and don't pay for a real test of C.`;
  act.status = 'done';
  act.result = { status: 'done', run_id, leader: L, leader_rate: lead, c_rate: c, gap_pts: gap, bar_pts: bar, passes, verdict: v.headline, headline };
  const launch = d.actions.find((x) => x.kind === 'launch_test');
  if (launch && launch.status === 'proposed') {
    launch.detail = `${passes ? 'Recommended: C cleared the bar in simulation.' : 'Not recommended: C fell short in simulation.'} ${launch.detail.replace(/^(Recommended|Not recommended):[^.]*\.\s*/, '')}`;
  }
  d.reasons = [...d.reasons.filter((r) => !r.startsWith('Version C moved intent')), headline];
}

/**
 * Decision: Ripple IS the A/B test, so this turns the finished simulation into what to do with the result.
 *
 * 1. The call: launch the leader (a "winner" when the CI excludes zero and every seed agrees, else a "leader"),
 *    with the statistics: gap, 95% CI, P(better). Always a clear answer; no "too close to call".
 * 2. The value of Ripple: a two-proportion power calculation (5% two-sided, 80% power) says how many people a live
 *    split test would need, set against the Census x Pew count of local users on the platform. Ripple ran it for $0.
 * 3. When P(better) < 90%: a sharper Version C (brief from memory-backed objections, Rewriter draft, Honesty
 *    check), simulated against the leader on the same crowd.
 * 4. Action policy: cheap, reversible steps run on their own; launching the ad waits for the owner's approval.
 *    Dry Run never posts or spends; approving creates ONE paused ad (or a preview).
 */
import fs from 'node:fs';
import path from 'node:path';
import type { RunState } from '../sim/run.js';
import { draftVersionC } from './rewriter.js';
import { normCdf } from '../sim/metrics.js';
import { agentLog } from '../util/agentlog.js';

/** A live test using more than this share of the local platform users is out of reach; sets the bar a Version C must clear. */
export const MAX_TEST_SHARE = 0.2;
const Z_ALPHA = 1.959964; // 5% two-sided
const Z_BETA = 0.841621;  // 80% power

export type ActionStatus = 'done' | 'proposed' | 'approved' | 'rejected';
export interface DecisionAction {
  id: string;
  kind: 'draft_variant' | 'simulate_variant' | 'publish';
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
  call: 'winner' | 'leader' | 'cant_size' | 'verification';
  headline: string;
  reasons: string[];
  verdict: { headline: string; a: number; b: number; gap_pts: number; ci_half_pts: number; winner: string | null; leader: string; p_better: number };
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
    variants: { label: string; text: string; image_url?: string }[];
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

const PLATFORMS: Record<string, string> = { instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok', x: 'X', youtube: 'YouTube', reddit: 'Reddit' };
/** Display name of the run's platform; instagram when the spec has none. */
export const platformName = (st: RunState) => PLATFORMS[String((st.spec as any).platform ?? 'instagram')] ?? 'Instagram';

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
  if (st.spec.parent_run) return verificationDecision(st);
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
  const P = platformName(st);
  const pBetter = (v as any).p_better ?? (v.pooled.ci_half > 0 ? normCdf(Math.abs(pA - pB) / (v.pooled.ci_half / 1.96)) : 0.5);
  const pBetterPct = Math.round(pBetter * 100);
  const wantC = !v.winner && pBetter < 0.9;
  const call: Decision['call'] = v.winner ? 'winner' : !audienceN ? 'cant_size' : 'leader';

  const reasons: string[] = [];
  reasons.push(`${leader} ${v.winner ? 'wins' : 'leads'} on intent to visit: ${pct(Math.max(pA, pB))} vs ${pct(Math.min(pA, pB))}, a ${gapPts.toFixed(1)}-point gap with a 95% interval of ±${(v.pooled.ci_half * 100).toFixed(1)} points, and ${leader} is ahead in ${(v as any).seeds_agree ?? '?'} of ${v.per_seed?.length ?? '?'} seeds. ${leader} is ${pBetterPct}% likely to be the better version.`);
  if (n && audienceN) reasons.push(`A live split test would need about ${n.toLocaleString('en-US')} people per version (${share !== null ? pct(share) : 'more than all'} of the local ${P} users) and paid impressions to detect this gap. Ripple ran it on the simulated crowd for $0 of ad spend.`);
  else if (n) reasons.push(`A live split test would need about ${n.toLocaleString('en-US')} people per version and paid impressions to detect this gap. Ripple ran it on the simulated crowd for $0 of ad spend. The local ${P} audience for ${st.spec.place} is unknown, so it cannot be compared with that.`);
  else reasons.push(`The two drafts tie in the simulation, so no live test could separate them. Ripple ran it for $0 of ad spend.`);
  if (audienceN) reasons.push(`There are about ${audienceN.toLocaleString('en-US')} ${P} users in ${st.spec.place} (Census x Pew join).`);
  if (wantC) reasons.push(`A sharper rewrite (C), drafted from what people objected to, could widen the gap. It is worth acting on only if it moves intent by at least ${(mde * 100).toFixed(1)} points, the smallest gap that would be worth acting on.`);

  agentLog({ run_id: st.spec.run_id, agent_name: 'DecisionAgent', action: 'decide', status: 'success', input_summary: `gap ${gapPts.toFixed(1)} pts, ${audienceN.toLocaleString('en-US')} local ${P} users`, output_summary: `${call}: launch ${leader}, ${pBetterPct}% likely better; a live test would need ${n ? n.toLocaleString('en-US') : 'n/a'} per version (${share !== null ? pct(share) : 'n/a'} of audience); bar ${(mde * 100).toFixed(1)} pts`, refs: { call, query_id: audienceQ?.query_id } });
  let variant: Decision['variant'] = opts.keepVariant ? st.decision?.variant ?? null : null;
  if (opts.draft && !variant && wantC) {
    agentLog({ run_id: st.spec.run_id, agent_name: 'DecisionAgent', action: 'request_rewrite', target_agent: 'VersionCWriter', status: 'started', input_summary: 'objections and losing segments from the report' });
    const c = await draftVersionC(st);
    variant = c.c ? { text: c.c.text, rationale: c.c.rationale, targets: c.c.targets ?? [], honesty: c.honesty } : null;
  }

  const coreBands = (st.proposal?.core?.age_bands as string[] | undefined) ?? [];
  const planPer = affordablePer;
  const plan: Decision['plan'] = {
    variants: [{ label: `Version ${leader}`, text: leaderPost.text }],
    targeting: { platform: P, place: st.spec.place, zip: st.spec.zip, age_bands: coreBands, note: `Core segment ${st.proposal?.core?.name ?? ''} first; the crowd sampled ${pct(st.spec.coreShare ?? 0.5)} core.`.trim() },
    per_version: planPer,
    total: planPer,
    success_metric: 'Taps through to the post and store visits attributed to the post (the real-world counterpart of the simulated intent to visit).',
    decision_rule: `Keep version ${leader} running if its tap rate is not below the simulated range; otherwise pause it.`,
    stop_rule: `Stop after ${planPer.toLocaleString('en-US')} people have seen it, or after 7 days.`,
    assumptions: [
      `These are simulated people, not real customers; the backtest shows the crowd does not reliably predict real winners.`,
      `Audience size is an estimate: ACS adults in the ZIP times national Pew ${P} use by age.`,
    ],
  };

  const ev = [audienceQ?.query_id, ...brief.objections.flatMap((o: any) => o.quotes.map((q: any) => q.action_id))].filter(Boolean) as string[];
  const actions: DecisionAction[] = [];
  if (wantC) {
    actions.push({ id: 'draft_c', kind: 'draft_variant', title: 'Draft a sharper version from what people objected to', detail: variant ? `"${variant.text}"${variant.honesty.ok ? ' (passed the honesty check)' : ` (honesty check: ${variant.honesty.issues.join('; ')})`}` : opts.draft ? 'No Version C: the Rewriter returned nothing usable, so there is no C to simulate or launch. Try again from the Ask why stage.' : 'Rewrite brief ready; draft runs on request.', policy: 'auto', why_policy: 'A draft spends nothing and is never published on its own.', status: variant ? 'done' : 'proposed', evidence: ev.slice(1) });
    actions.push({ id: 'simulate_c', kind: 'simulate_variant', title: `Simulate the suggested rewrite (C) against ${leader} on the same audience`, detail: `Worth acting on only if C moves intent by at least ${(mde * 100).toFixed(1)} points.`, policy: 'auto', why_policy: 'Simulation spends no ad money; it runs on the local model.', status: 'proposed', evidence: [] });
  }
  actions.push(launchAction(leader, leaderPost.text, v.winner ? null : { p: pBetterPct, gap: gapPts }, st.spec.zip, P, ev));

  const headline = `Launch ${leader}: it ${v.winner ? 'wins' : 'leads'} by ${gapPts.toFixed(1)} points and is ${pBetterPct}% likely to be the better version.${wantC ? ' A sharper rewrite (C) could widen the gap.' : ''}${call === 'cant_size' ? ` (The local ${P} audience for ${st.spec.place} is unknown, so a live test cannot be sized.)` : ''}`;

  return {
    run_id: st.spec.run_id, created: new Date().toISOString(), call, headline, reasons,
    verdict: { headline: v.headline, a: pA, b: pB, gap_pts: gapPts, ci_half_pts: v.pooled.ci_half * 100, winner: v.winner ?? null, leader, p_better: pBetter },
    audience: { local_instagram_users: audienceN, place: st.spec.place, query_id: audienceQ?.query_id, source: 'ACS adults by age in the ZIP x Pew Instagram use by age' },
    sample_size: { metric: 'intent to visit (simulated)', p_a: pA, p_b: pB, per_version: n, total, share_of_audience: share, alpha: 0.05, power: 0.8 },
    affordable: { max_share: MAX_TEST_SHARE, per_version: affordablePer, detectable_gap_pts: mde * 100 },
    brief, variant, plan, actions,
  };
}

/** The one paid step: ONE paused ad of the version to launch (campaign, ad set, ad), after the owner approves. */
function launchAction(version: string, text: string, note: { p: number; gap: number } | null, zip: string, P: string, evidence: string[]): DecisionAction {
  return {
    id: 'launch', kind: 'publish', title: `Launch ${version === 'C' ? 'the suggested rewrite (C)' : `Draft ${version}`} in Meta Ads (paused)`,
    detail: `${note ? `Ripple puts ${version} ahead by ${note.gap.toFixed(1)} points (${note.p}% likely to be better); launch it, or launch the version you prefer. ` : ''}One paused campaign, one ad set, one ad: ${P}, ZIP ${zip}. "${text}"`,
    policy: 'needs_approval', why_policy: 'It sets up ad spend and a public post in your ad account: you decide. Everything is created paused.', status: 'proposed', evidence,
  };
}

/**
 * Record the owner's approval or rejection of one action. Approving a launch runs it: one ad is created in
 * Meta Ads, paused (src/actions/meta.ts), or previewed when Meta is not configured. Dry Run never activates or spends.
 */
export async function decideAction(d: Decision, actionId: string, choice: 'approve' | 'reject', business: string): Promise<DecisionAction> {
  const a = d.actions.find((x) => x.id === actionId);
  if (!a) throw Object.assign(new Error(`No action ${actionId}`), { statusCode: 404 });
  if (a.policy !== 'needs_approval') throw Object.assign(new Error('This action runs on its own and needs no approval'), { statusCode: 400 });
  if (a.status === 'approved' && (a.result as any)?.ok && (a.result as any)?.mode === 'live') throw Object.assign(new Error('Already created in Meta Ads'), { statusCode: 409 });
  a.decided_at = new Date().toISOString();
  if (choice === 'reject') { a.status = 'rejected'; agentLog({ run_id: d.run_id, agent_name: 'DecisionAgent', action: 'owner_decision', status: 'info', output_summary: `owner rejected ${a.id}` }); return a; }
  if (a.kind === 'publish') {
    agentLog({ run_id: d.run_id, agent_name: 'DecisionAgent', action: 'owner_approved', target_agent: 'LaunchAgent', status: 'success', output_summary: `owner approved ${a.id}; handing the plan over` });
    const { launchOnMeta, launchInputFromDecision } = await import('../actions/meta.js');
    const inp = launchInputFromDecision(d, business);
    inp.variants = inp.variants.slice(0, 1);
    a.result = await launchOnMeta(inp);
    if ((a.result as any)?.ok === false) agentLog({ run_id: d.run_id, agent_name: 'LaunchAgent', action: 'launch_failed', target_agent: 'DecisionAgent', status: 'error', output_summary: `${a.id} stays proposed so the owner can retry: ${String((a.result as any).error ?? '').slice(0, 160)}` });
  }
  const r = a.result as { ok?: boolean; error?: string } | undefined;
  if (r && r.ok === false) { a.status = 'proposed'; return a; }
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
 * and when it finishes. C is worth launching only if it beats the leader by the gap an affordable live test could detect.
 */
export function recordVerification(parent: RunState, child: RunState): void {
  const d = parent.decision;
  const act = d?.actions.find((x) => x.kind === 'simulate_variant');
  if (!d || !act) return;
  const run_id = child.spec.run_id;
  const v = child.verdict;
  if (!v) { act.result = { status: child.status === 'error' ? 'error' : 'running', run_id, error: child.error }; return; }
  const lead = v.pooled.a, c = v.pooled.b;
  const gap = (c - lead) * 100, bar = detectableGap(Math.max(lead, c), d.affordable.per_version) * 100;
  const passes = gap >= bar;
  const L = d.verdict.leader;
  const headline = `C moved intent ${gap >= 0 ? '+' : ''}${gap.toFixed(1)} pts vs ${L} on the same crowd (${pct(c)} vs ${pct(lead)}): ${passes ? 'launch C' : `keep ${L}`}. The bar is ${bar.toFixed(1)} pts, the smallest gap that would be worth acting on.`;
  act.status = 'done';
  act.result = { status: 'done', run_id, leader: L, leader_rate: lead, c_rate: c, gap_pts: gap, bar_pts: bar, passes, verdict: v.headline, headline };
  const launch = d.actions.find((x) => x.id === 'launch');
  if (launch && launch.status === 'proposed') {
    const tail = launch.detail.replace(/^(Recommended|Not recommended):[^.]*\.\s*/, '');
    if (passes && d.variant?.text) {
      const cl = launchAction('C', d.variant.text, null, d.plan.targeting.zip, d.plan.targeting.platform, launch.evidence);
      launch.title = cl.title;
      launch.detail = `Recommended: C cleared the bar in simulation. ${cl.detail}`;
      d.plan.variants = [{ label: 'Version C', text: d.variant.text }];
      d.plan.decision_rule = d.plan.decision_rule.replace(/version \w+/, 'version C');
    } else {
      launch.detail = `${passes ? 'C cleared the bar in simulation.' : `C fell short of the bar in simulation, so ${L} stays the pick.`} ${tail}`;
    }
  }
  d.reasons = [...d.reasons.filter((r) => !/^C moved intent|^Version C moved intent/.test(r)), headline];
}

/** A Version C verification run (parent_run set): nothing to spend on or launch, so no "C vs C" actions. */
function verificationDecision(st: RunState): Decision {
  const v = st.verdict!;
  const [A, B] = st.spec.posts;
  const leader = v.pooled.a >= v.pooled.b ? A.variant : B.variant;
  const headline = `Verification run: the suggested rewrite (C) against ${st.spec.parent_run}'s leader on the same audience. ${v.headline}`;
  const pb = (v as any).p_better ?? 0.5;
  return {
    run_id: st.spec.run_id, created: new Date().toISOString(), call: 'verification', headline,
    reasons: [`This run only checks whether the suggested rewrite (C) beats the leader on the same audience. The launch decision is on the parent run ${st.spec.parent_run}.`],
    verdict: { headline: v.headline, a: v.pooled.a, b: v.pooled.b, gap_pts: Math.abs(v.pooled.a - v.pooled.b) * 100, ci_half_pts: v.pooled.ci_half * 100, winner: v.winner ?? null, leader, p_better: pb },
    audience: { local_instagram_users: 0, place: st.spec.place, source: 'not computed for a verification run' },
    sample_size: { metric: 'intent to visit (simulated)', p_a: v.pooled.a, p_b: v.pooled.b, per_version: null, total: null, share_of_audience: null, alpha: 0.05, power: 0.8 },
    affordable: { max_share: MAX_TEST_SHARE, per_version: 0, detectable_gap_pts: 0 },
    brief: { objections: [], likes: [], segments: [] },
    variant: null,
    plan: { variants: [], targeting: { platform: 'Instagram', place: st.spec.place, zip: st.spec.zip, age_bands: [], note: '' }, per_version: 0, total: 0, success_metric: '', decision_rule: '', stop_rule: '', assumptions: [] },
    actions: [],
  };
}

/**
 * Launch action: create the real split test in Meta Ads, paused, when the owner approves (docs/META_SETUP.md).
 *
 * One campaign; one ad set per version with identical targeting and budget (an even split test); one creative and
 * one ad per ad set. Every object is created with status PAUSED and the code refuses anything else, so nothing
 * delivers or spends until a person switches it on in Ads Manager. Use a sandbox ad account for demos.
 * Without META_* settings this returns the exact payloads it would send (mode "preview") and sends nothing.
 */
import { config } from '../config.js';
import { agentLog } from '../util/agentlog.js';
import type { Decision } from '../report/decision.js';

export interface MetaVariant { label: string; text: string }
export interface MetaLaunchInput {
  run_id: string;
  business: string;
  zip: string;
  age_bands: string[];
  variants: MetaVariant[];
  days: number;
}
export interface MetaLaunchResult {
  mode: 'live' | 'preview';
  ok: boolean;
  campaign_id?: string;
  ad_sets: { label: string; ad_set_id?: string; creative_id?: string; ad_id?: string }[];
  ads_manager_url?: string;
  payloads: { path: string; body: Record<string, unknown> }[];
  error?: string;
  note: string;
}

export function metaConfigured() {
  const m = config.meta;
  return Boolean(m.accessToken && m.adAccountId && m.pageId);
}

function ageRange(bands: string[]): { age_min: number; age_max: number } {
  const lo: number[] = [], hi: number[] = [];
  for (const b of bands) {
    const m = b.match(/(\d+)\s*-\s*(\d+)/);
    if (m) { lo.push(+m[1]); hi.push(+m[2]); } else if (/(\d+)\+/.test(b)) { const x = +b.match(/(\d+)\+/)![1]; lo.push(x); hi.push(65); }
  }
  // Meta accepts 18..65 (65 means 65+)
  return { age_min: Math.max(18, lo.length ? Math.min(...lo) : 18), age_max: Math.min(65, hi.length ? Math.max(...hi) : 65) };
}

const PAUSED = 'PAUSED';
function assertPaused(body: Record<string, unknown>) {
  if ('status' in body && body.status !== PAUSED) throw new Error('Dry Run only creates paused Meta objects');
}

/** The Graph API requests, in order. `$campaign`, `$adset:i`, `$creative:i` are filled with ids as they are created. */
export function metaPayloads(inp: MetaLaunchInput): { path: string; body: Record<string, unknown> }[] {
  const m = config.meta;
  const act = m.adAccountId.startsWith('act_') ? m.adAccountId : `act_${m.adAccountId || '<ad account id>'}`;
  const start = new Date(Date.now() + 24 * 3600_000);
  const end = new Date(start.getTime() + inp.days * 24 * 3600_000);
  const targeting = {
    geo_locations: { zips: [{ key: `US:${inp.zip}` }] },
    ...ageRange(inp.age_bands),
    publisher_platforms: ['instagram'],
    instagram_positions: ['stream'],
    // Advantage audience off: both versions must reach exactly the same people for a fair split test
    targeting_automation: { advantage_audience: 0 },
  };
  const out: { path: string; body: Record<string, unknown> }[] = [];
  out.push({
    path: `${act}/campaigns`,
    body: { name: `Dry Run split test: ${inp.business} (${inp.run_id})`, objective: 'OUTCOME_TRAFFIC', status: PAUSED, special_ad_categories: [], buying_type: 'AUCTION', is_adset_budget_sharing_enabled: false },
  });
  inp.variants.forEach((v, i) => {
    out.push({
      path: `${act}/adsets`,
      body: {
        name: `${v.label} | Dry Run ${inp.run_id}`, campaign_id: '$campaign', status: PAUSED,
        daily_budget: m.dailyBudgetCents, billing_event: 'IMPRESSIONS', optimization_goal: 'LINK_CLICKS', destination_type: 'WEBSITE',
        bid_strategy: 'LOWEST_COST_WITHOUT_CAP', targeting, start_time: start.toISOString(), end_time: end.toISOString(),
      },
    });
    out.push({
      path: `${act}/adcreatives`,
      body: {
        name: `${v.label} creative | Dry Run ${inp.run_id}`,
        object_story_spec: {
          page_id: m.pageId || '<page id>',
          ...(m.instagramUserId ? { instagram_user_id: m.instagramUserId } : {}),
          link_data: { message: v.text, link: m.linkUrl, name: inp.business, call_to_action: { type: 'LEARN_MORE', value: { link: m.linkUrl } } },
        },
      },
    });
    out.push({ path: `${act}/ads`, body: { name: `${v.label} | Dry Run ${inp.run_id}`, adset_id: `$adset:${i}`, creative: { creative_id: `$creative:${i}` }, status: PAUSED } });
  });
  return out;
}

async function graphPost(p: string, body: Record<string, unknown>): Promise<string> {
  const m = config.meta;
  assertPaused(body);
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(body)) form.set(k, typeof v === 'string' ? v : JSON.stringify(v));
  form.set('access_token', m.accessToken);
  const res = await fetch(`${m.graphUrl}/${m.apiVersion}/${p}`, { method: 'POST', body: form, signal: AbortSignal.timeout(30_000) });
  const j = (await res.json().catch(() => ({}))) as { id?: string; error?: { message?: string; error_user_msg?: string; code?: number } };
  if (!res.ok || !j.id) {
    const msg = (j.error?.error_user_msg || j.error?.message || `HTTP ${res.status}`).replaceAll(m.accessToken, '[token]');
    throw new Error(`Meta ${p.split('/').pop()}: ${msg}`);
  }
  return j.id;
}

export async function launchOnMeta(inp: MetaLaunchInput): Promise<MetaLaunchResult> {
  const r = await launchOnMetaInner(inp);
  agentLog({ run_id: inp.run_id, agent_name: 'LaunchAgent', action: 'create_split_test', target_agent: 'Meta Ads', status: r.ok ? 'success' : 'error', input_summary: `${inp.variants.length} variants, ZIP ${inp.zip}, all created paused`, output_summary: `${r.mode}${r.campaign_id ? ` campaign ${r.campaign_id}` : ''}${r.error ? `: ${r.error.slice(0, 160)}` : ''}`, refs: { mode: r.mode } });
  return r;
}

async function launchOnMetaInner(inp: MetaLaunchInput): Promise<MetaLaunchResult> {
  const payloads = metaPayloads(inp);
  const ad_sets: MetaLaunchResult['ad_sets'] = inp.variants.map((v) => ({ label: v.label }));
  if (!metaConfigured()) {
    return { mode: 'preview', ok: true, ad_sets, payloads, note: 'Meta is not configured (docs/META_SETUP.md), so nothing was sent. These are the exact requests Dry Run would make, all paused.' };
  }
  const ids: Record<string, string> = {};
  const fill = (x: unknown): unknown => (typeof x === 'string' && ids[x] ? ids[x] : Array.isArray(x) ? x.map(fill) : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, fill(v)])) : x);
  let campaign_id: string | undefined;
  try {
    let i = -1;
    for (const p of payloads) {
      const kind = p.path.split('/').pop();
      if (kind === 'adsets') i++;
      const id = await graphPost(p.path, fill(p.body) as Record<string, unknown>);
      if (kind === 'campaigns') { campaign_id = id; ids.$campaign = id; }
      if (kind === 'adsets') { ad_sets[i].ad_set_id = id; ids[`$adset:${i}`] = id; }
      if (kind === 'adcreatives') { ad_sets[i].creative_id = id; ids[`$creative:${i}`] = id; }
      if (kind === 'ads') ad_sets[i].ad_id = id;
    }
  } catch (e) {
    return { mode: 'live', ok: false, campaign_id, ad_sets, payloads, error: (e as Error).message, ads_manager_url: campaign_id ? adsManagerUrl(campaign_id) : undefined, note: 'Stopped at the first error. Anything created so far is paused and listed here.' };
  }
  return { mode: 'live', ok: true, campaign_id, ad_sets, payloads, ads_manager_url: adsManagerUrl(campaign_id!), note: 'Created in Meta Ads, all paused. Nothing delivers or spends until someone switches it on in Ads Manager.' };
}

function adsManagerUrl(campaignId: string) {
  const act = config.meta.adAccountId.replace(/^act_/, '');
  return `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${act}&selected_campaign_ids=${campaignId}`;
}

/** Inputs for the launch from a decision's plan. */
export function launchInputFromDecision(d: Decision, business: string): MetaLaunchInput {
  const variants = d.plan.variants.filter((v) => v.text && !v.text.startsWith('('));
  if (!variants.length) throw Object.assign(new Error('The launch plan has no finished variant text yet'), { statusCode: 400 });
  return { run_id: d.run_id, business, zip: d.plan.targeting.zip, age_bands: d.plan.targeting.age_bands, variants, days: 7 };
}

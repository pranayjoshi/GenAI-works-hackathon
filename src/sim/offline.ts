/**
 * Offline crowd: a deterministic, persona-driven decision model used when no model can answer a crowd batch
 * in SAMPLE_MODE (or when no provider is configured). Every decision is scored from the persona's sampled
 * attributes (price sensitivity, skepticism, customer status, role, activity, age) and features parsed from
 * the item text (discount, price, free, new, local, urgency, quality, competitor news). Randomness is the
 * same seeded hash the engine uses (tag + persona + item + hour), so a rerun gives identical answers and
 * the twin worlds differ only through the text of the post they are shown. served_by = 'offline-model'.
 */
import { sha, clamp } from '../util/core.js';
import { traceBus } from '../llm.js';
import { agentLog } from '../util/agentlog.js';
import { config } from '../config.js';
import type { CrowdDecision } from '../schemas/action.js';
import type { Persona } from '../schemas/persona.js';
import type { AgentTurn, RenderCtx } from './crowd.js';

export const OFFLINE_SERVED_BY = 'offline-model';
const hashU = (...parts: (string | number)[]) => parseInt(sha(parts.join('|'), 8), 16) / 0x100000000;

/** Offline fallback applies in sample mode, or when no hosted provider is set (a local Ollama that answers still wins first). */
export const offlineAllowed = () => !config.sampleStrict && (config.sampleMode || !config.nightshift.token);

/** calls answered offline, per run tag (for the /run trace summary) */
export const offlineCalls = new Map<string, number>();

export interface Features {
  discount: number;   // percent off, 0 if none
  price: number;      // first dollar amount, 0 if none
  free: boolean; isNew: boolean; local: boolean; urgency: boolean; quality: boolean; positive: boolean;
}

export function parseFeatures(text: string): Features {
  const t = text.toLowerCase();
  const pct = t.match(/(\d{1,3})\s?%\s*(off|discount)?/);
  const price = t.match(/\$\s?(\d+(?:\.\d+)?)/);
  return {
    discount: pct && (pct[2] || /\boff\b|discount|deal|sale/.test(t)) ? Math.min(100, Number(pct[1])) : 0,
    price: price ? Number(price[1]) : 0,
    free: /\bfree\b|\bcomplimentary\b|on the house|no (signup|sign-up|joining) fee/.test(t),
    isNew: /\bnew\b|\bnow open|just (launched|opened|dropped)|introducing|seasonal|opens?\b/.test(t),
    local: /\blocal\b|neighbou?r|community|family[- ]owned|small[- ]batch|hometown|downtown|nearby|\bblock\b|your town/.test(t),
    urgency: /today only|this week only|limited|last chance|hurry|ends (today|soon|sunday|friday)|while (supplies|they) last|first \d+|only \d+|don'?t miss|act now/.test(t),
    quality: /hand[- ]?(made|crafted)|craft|organic|certified|expert|fresh|slow[- ]?(ferment|roast)|artisan|premium|ingredients|locally sourced|from scratch|made to order|trained|professional|guarantee|personal|quality|stone[- ]?(milled|ground)/.test(t),
    positive: /\b(award|voted|best of|featured|rated|five[- ]star|5[- ]star|wins?|winner|praised)\b/.test(t),
  };
}

/** Relative willingness to engage with a sponsored item (assumption for the offline fallback; instagram = 1 keeps the original rates). */
const PLATFORM_ENGAGE: Record<string, number> = { instagram: 1, tiktok: 1.25, facebook: 0.9, youtube: 0.7, x: 0.8, reddit: 0.6 };
const u = (tag: string, ...k: (string | number)[]) => hashU(tag, ...k);
const pick = <T>(arr: T[], x: number) => arr[Math.min(arr.length - 1, Math.floor(x * arr.length))];

interface Scored { score: number; drivers: { name: string; w: number }[] }

/** Appeal of a post to one person, with the weighted drivers kept for the reason text. */
export function scorePost(p: Persona, f: Features, seenBefore: number, noise: number): Scored {
  const ps = clamp(p.price_sensitivity, 0, 1), sk = clamp(p.skepticism, 0, 1);
  const young = p.age < 40 ? 1 : 0;
  const d: { name: string; w: number }[] = [];
  const add = (name: string, w: number) => { if (Math.abs(w) > 0.01) d.push({ name, w }); };
  if (f.discount) {
    add('discount', 1.7 * (Math.min(f.discount, 50) / 40) * (0.25 + ps));
    if (f.discount >= 40 || f.urgency) add('gimmick', -0.7 * sk * (f.discount >= 40 ? 1 : 0.6));
  }
  if (f.price && !f.discount) add('price', -0.5 * ps * clamp((f.price - 4) / 4, 0, 1.5) - 0.1 * ps);
  if (f.free) add('free', 0.9 * (0.3 + ps));
  if (f.isNew) add('new', 0.25 + 0.2 * young);
  if (f.local) add('local', 0.25 + (p.customer ? 0.2 : 0));
  if (f.quality) add('quality', 0.15 + 0.7 * (1 - ps) * (1 - 0.4 * sk));
  if (f.urgency && !f.discount) add('gimmick', -0.5 * sk);
  if (p.customer) add('customer', 0.45 + Math.min(0.4, p.customer.visits_per_month * 0.04));
  if (p.role === 'core') add('core', 0.3);
  add('skeptic', -0.7 * sk);
  if (seenBefore > 0) add('repeat', -0.3 * seenBefore);
  add('mood', noise);
  return { score: d.reduce((a, x) => a + x.w, 0), drivers: d };
}

const REASONS: Record<string, string[]> = {
  discount: ['That discount makes the trip worth it for me.', 'A cheaper price this week gets me through the door.', 'I will happily take the deal, my budget notices these.', 'Money off is exactly what moves me on a weekday.'],
  gimmick: ['Deals with a deadline feel like a sales trick to me.', 'Big promises and a ticking clock make me doubt it.', 'It reads like hype, I trust quiet places more.'],
  price: ['Too pricey for something I would do on a weekday.', 'For that money I would rather stay home.', 'I watch what I spend, and that adds up fast.'],
  free: ['Anything free gets my attention right away.', 'A freebie is a low risk reason to try the place.'],
  new: ['Something new is worth a look when I am nearby.', 'I like trying what is new on the menu.', 'A fresh thing to try breaks up my routine.'],
  local: ['Nice to see a neighbourhood spot doing its thing.', 'I like backing places close to home.', 'It feels like my part of town, that counts for me.'],
  quality: ['It sounds like they care about the craft, I would pay for that.', 'Good ingredients matter more to me than a discount.', 'I want quality, not a coupon, and this says quality.'],
  customer: ['I am in there already, so this fits my routine.', 'Already a regular, so I pay attention to what they post.'],
  core: ['This is the kind of place I actually go to.', 'It lands right in my everyday routine.'],
  skeptic: ['Another sponsored post, I mostly ignore these.', 'I scroll past ads almost by reflex.', 'Ads rarely change where I spend my time.'],
  repeat: ['Seeing this a second time does nothing new for me.', 'It was fine the first time, not more now.'],
  mood: ['Not really my kind of thing today.', 'Pleasant enough, I just have other plans.'],
};
const EVENT_NEG = ['Their offer across the street is tempting, I might switch this week.', 'That competing deal pulls me away from here.', 'A better deal nearby changes my plans.'];
const EVENT_LOYAL = ['Good for them, but I am staying loyal to this place.', 'Tempting, but my habit here is stronger than a one day deal.'];
const EVENT_NEUTRAL = ['Interesting news, but it does not change my plans.', 'Noted, nothing that changes where I go.'];
const EVENT_POS = ['That is good news for the place, makes me trust it more.', 'Nice to see recognition, I feel better about going.'];
const TEXT_POS = ['looks good, we should go this week', 'ok this is tempting honestly', 'saving this for the weekend', 'tagging you, lets go'];
const TEXT_NEG = ['meh, not for me', 'another ad, no thanks', 'way too pricey honestly', 'feels like a gimmick'];

const feelingOf = (s: number) => (s > 1.1 ? 2 : s > 0.3 ? 1 : s < -1.0 ? -2 : s < -0.4 ? -1 : 0);

function eventThreat(f: Features): number {
  return clamp((f.discount ? Math.min(f.discount, 50) / 40 : 0) + (f.free ? 0.7 : 0) + (f.isNew ? 0.2 : 0) + (f.urgency ? 0.2 : 0), 0, 1.6);
}

function visitProb(score: number, p: Persona) {
  return clamp(1 / (1 + Math.exp(-2.4 * (score - 0.9))), 0, 1) * (0.5 + 0.5 * clamp(p.activity, 0, 1)) + (p.customer ? 0.04 : 0);
}

export function decideOffline(turns: AgentTurn[], ctx: RenderCtx, runTag: string): Map<string, CrowdDecision> {
  // stable across reruns (the run id carries a random suffix) and identical in both twin worlds
  const tag = sha(`${ctx.post.business}|${ctx.place}`, 8);
  const out = new Map<string, CrowdDecision>();
  const postFs = (ctx.post.items?.length ? ctx.post.items : [{ text: ctx.post.text, image: ctx.post.image }]).map((x) => parseFeatures(`${x.text} ${x.image ?? ''}`));
  const plat = ctx.mode === 'backtest' ? 1 : PLATFORM_ENGAGE[ctx.platform ?? 'instagram'] ?? 1;
  for (const t of turns) {
    const p = t.persona;
    for (const it of t.items) {
      const key = `${p.id}/${it.item_id}`;
      const visitDraw = hashU(tag, p.id, 'visit');
      const base = scorePost(p, postFs[Math.min(it.idx ?? 0, postFs.length - 1)], t.seenBefore, (hashU(tag, p.id, 'mood') - 0.5) * 0.8);
      if (it.kind === 'event') {
        // competitor / news item: shifts feeling and intent relative to what the persona thought of the post
        const ef = parseFeatures(ctx.eventText(it.item_id));
        const loyal = p.customer ? 0.55 : 0.15 + 0.25 * (1 - clamp(p.price_sensitivity, 0, 1));
        const threat = eventThreat(ef) * (0.3 + clamp(p.price_sensitivity, 0, 1)) * (1 - loyal);
        const boost = ef.positive ? 0.5 : 0;
        const pv = clamp(visitProb(base.score, p) * (1 - clamp(threat, 0, 0.85)) + boost * 0.3, 0, 1);
        const feeling = ef.positive ? 1 : threat > 0.55 ? -1 : 0;
        const reason = ef.positive ? pick(EVENT_POS, u(tag, p.id, it.item_id, 'r'))
          : threat > 0.4 ? pick(EVENT_NEG, u(tag, p.id, it.item_id, 'r'))
          : eventThreat(ef) > 0.3 ? pick(EVENT_LOYAL, u(tag, p.id, it.item_id, 'r')) : pick(EVENT_NEUTRAL, u(tag, p.id, it.item_id, 'r'));
        out.set(key, { key, action: 'scroll_past', feeling, would_visit: visitDraw < pv, reason, text: '' });
        continue;
      }
      const s = base.score;
      const f = feelingOf(s);
      const x = u(tag, p.id, it.item_id, ctx.hourLabel, 'act');
      const y = u(tag, p.id, it.item_id, ctx.hourLabel, 'kind');
      const pEng = (s > 0 ? clamp(0.02 + 0.08 * s, 0, 0.4) : 0.01) * plat;
      let action: CrowdDecision['action'] = 'scroll_past';
      let text = '';
      if (f <= -2 && x < 0.07) action = 'hide';
      else if (f <= -1 && x < p.speak_p * 0.5) { action = 'comment'; text = pick(TEXT_NEG, y); }
      else if (x < pEng) {
        if (s > 1.0) action = y < 0.35 ? 'tap_through' : y < 0.65 ? 'like' : y < 0.82 ? 'save' : y < 0.92 && p.speak_p > 0.1 ? 'share' : 'like';
        else action = y < 0.5 ? 'like' : y < 0.8 ? 'tap_through' : 'save';
        if (action === 'share') text = pick(TEXT_POS, y);
      }
      // reason: the strongest positive driver for engagers, the strongest negative one for the rest
      const sorted = [...base.drivers].sort((a, b) => b.w - a.w);
      const named = sorted.filter((d) => REASONS[d.name]);
      const top = s > 0.3 ? named[0] : named[named.length - 1];
      const second = s > 0.3 ? named[1] : named[named.length - 2];
      let reason = pick(REASONS[top?.name ?? 'mood'], u(tag, p.id, it.item_id, 'r1'));
      if (second && second.name !== top?.name && Math.abs(second.w) > 0.3 && u(tag, p.id, 'r2') < 0.5) {
        reason = reason.replace(/[.]$/, '') + (s > 0.3 === second.w > 0 ? ', and ' : ', but ') + pick(REASONS[second.name], u(tag, p.id, it.item_id, 'r3')).replace(/^./, (c) => c.toLowerCase());
      }
      out.set(key, { key, action, feeling: f, would_visit: visitDraw < visitProb(s, p) && f >= 0, reason, text });
    }
  }
  return out;
}

/** Record that a batch was answered offline (trace bus entry for the UI, counter for /run). */
export function noteOffline(tag: string, n: number) {
  offlineCalls.set(tag, (offlineCalls.get(tag) ?? 0) + 1);
  traceBus.emit({ ts: new Date().toISOString(), tag, role: 'crowd', provider: 'replay', model: 'persona-rules', served_by: OFFLINE_SERVED_BY, ms: 0, tokens_in: 0, tokens_out: n, ok: true, repaired: false });
  // recovery line after the ModelRouter error for the same request, so the trace shows who answered in the end
  agentLog({
    run_id: tag && tag !== 'misc' ? tag.split(':')[0] : undefined, agent_name: 'ModelRouter', action: 'request:crowd', quiet: true,
    model: 'persona-rules', served_by: OFFLINE_SERVED_BY, status: 'fallback', retry_count: 1,
    input_summary: `role crowd tag ${tag}`, output_summary: `no model provider answered; offline persona model made ${n} decisions`,
  });
}

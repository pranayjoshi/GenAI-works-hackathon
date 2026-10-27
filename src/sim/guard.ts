/**
 * Fact-and-coherence guard for crowd output (applied before anything is logged or quoted).
 * Small models invent prices, claim to have seen a post they are seeing for the first time, leak words from
 * the other version, or pair a "like" with a strongly negative feeling. The guard never invents content:
 * it withholds a bad reason or comment (so it can't be quoted), resolves action/feeling contradictions toward
 * the private feeling, and records which checks fired so the validity panel can count them.
 */
import type { ActionType } from '../schemas/action.js';

export interface GuardInput {
  action: ActionType;
  feeling: number;
  would_visit: boolean;
  reason: string;
  text: string;
  itemKind: 'ad' | 'share' | 'event';
  firstExposure: boolean;          // no earlier sighting of the post (directly or via a share)
  postText: string;                // the post this person's world shows
  otherPostText: string;           // the twin world's post (for leakage checks)
  eventTexts: string[];            // injected event texts delivered so far
  voice: string;                   // the persona's voice line
  batchReasons: Set<string>;       // reasons already used in this batch (lower-cased)
}

export interface GuardOutput { action: ActionType; feeling: number; would_visit: boolean; reason: string; text: string; checks: string[] }

const POSITIVE: ReadonlySet<ActionType> = new Set(['like', 'save', 'share', 'comment', 'tap_through']);
const SEEN_CLAIM = /\b(seen (it|this)|saw (it|this)|again|same (ad|post|deal|thing)|already (saw|seen|know|knew)|old news|not new|twice|keeps? showing)\b/i;
const BRAND_VOICE = /\b(just posted|try (the|our)|come (say hi|in|by)|our new|we('re| are)|don'?t miss|order now|link in bio)\b/i;
const TROPES = /\b(old eyes|boomer|grandma|grandpa|kids? these days|student|teen|millennial|gen ?z)\b/i;
const STOP = new Set(['this', 'that', 'with', 'your', 'from', 'have', 'week', 'only', 'made', 'come', 'just', 'new:', 'what', 'will', 'here', 'there', 'they', 'them', 'their', 'about', 'latte', 'coffee', 'milk', 'morning', 'today', 'people', 'little', 'really', 'better', 'pretty', 'should', 'would', 'could', 'because', 'thing', 'things', 'something']);

const words = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9$%. ]/g, ' ').split(/\s+/).filter((w) => w.length >= 4 && !STOP.has(w)));
const money = (s: string) => s.match(/\$\s?\d+(\.\d+)?/g)?.map((m) => m.replace(/\s/g, '')) ?? [];
const pcts = (s: string) => s.match(/\d+\s?%/g)?.map((m) => m.replace(/\s/g, '')) ?? [];

export function guardDecision(g: GuardInput): GuardOutput {
  const checks: string[] = [];
  let { action, feeling, would_visit, reason, text } = g;
  const allowedText = [g.postText, ...g.eventTexts].join(' ');
  const allowedMoney = new Set(money(allowedText));
  const allowedPct = new Set(pcts(allowedText));
  // distinctive words only (6+ letters, or a price), so everyday words never count as leakage
  const leak = [...words(g.otherPostText)].filter((w) => !words(allowedText).has(w) && (w.length >= 6 || /\d/.test(w)) && !/^\d+%$/.test(w));

  const factProblem = (s: string): string | null => {
    if (!s) return null;
    if (money(s).some((m) => !allowedMoney.has(m))) return 'invented_price';
    if (pcts(s).some((p) => !allowedPct.has(p))) return 'invented_percent';
    if (g.itemKind !== 'event' && leak.some((w) => new RegExp(`\\b${w.replace(/[.$]/g, '\\$&')}\\b`, 'i').test(s))) return 'other_version_leak';
    if (g.firstExposure && g.itemKind === 'ad' && SEEN_CLAIM.test(s)) return 'false_repeat_claim';
    if (TROPES.test(s) && !TROPES.test(g.voice)) return 'identity_trope';
    return null;
  };

  // reason: withheld (not quotable) when it states something untrue or stereotyped, or copies a batch-mate
  const rp = factProblem(reason);
  if (rp) { checks.push(`reason:${rp}`); reason = ''; }
  const key = reason.toLowerCase().trim();
  if (key && g.batchReasons.has(key)) { checks.push('reason:duplicate_in_batch'); reason = ''; }
  if (key) g.batchReasons.add(key);

  // public text: must be the person's own words, not the brand's, not a copy of the reason
  if (text) {
    const tp = factProblem(text) ?? (BRAND_VOICE.test(text) ? 'brand_voice' : null);
    // a comment that repeats the person's own reason is still their words: noted, not withheld
    if (!tp && text.trim().toLowerCase() === (g.reason ?? '').trim().toLowerCase()) checks.push('text:copied_reason');
    if (tp) {
      checks.push(`text:${tp}`);
      text = '';
      if (action === 'comment' || action === 'share') action = feeling > 0 ? 'like' : 'scroll_past';
    }
  }

  // coherence: the private feeling is the truth; the public action follows it
  if (POSITIVE.has(action) && feeling <= -1) { checks.push('coherence:positive_action_negative_feeling'); action = 'scroll_past'; text = ''; }
  if (action === 'hide' && feeling > 0) { checks.push('coherence:hide_positive_feeling'); feeling = 0; }
  if (would_visit && feeling <= -2) { checks.push('coherence:visit_with_strong_dislike'); would_visit = false; }

  return { action, feeling, would_visit, reason, text, checks };
}

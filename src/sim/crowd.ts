/**
 * One model call per batch of active agents (BUILD_PLAN §4.4 step 4). The prompt holds only persona
 * records, each agent's recalled memories and its new feed items, so call size stays flat over the run.
 */
import { chat } from '../llm.js';
import { CrowdBatch, CrowdBatchV2, type CrowdDecision } from '../schemas/action.js';
import { config } from '../config.js';
import type { Persona } from '../schemas/persona.js';
import type { MemoryLine } from '../memory/hmem.js';
import type { FeedItem, Post } from './types.js';

export interface AgentTurn {
  persona: Persona;
  items: FeedItem[];
  memories: MemoryLine[];
  seenBefore: number;   // times this person already saw the post (directly or via a share)
}

export interface RenderCtx {
  post: Post;
  place: string;
  hourLabel: string;
  worldNote: string;                       // Markovian carryover summary
  topComments: (forAgent: string) => string[];
  eventText: (itemId: string) => string;
  mode: 'ab' | 'backtest';
}

function personaLine(p: Persona) {
  const cust = p.customer ? ` Already a customer: ${p.customer.visits_per_month} visits/month.` : '';
  return `${p.id} | age ${p.age} | income ${p.income_band} | ${p.education} | price sensitivity ${p.price_sensitivity} | ad skepticism ${p.skepticism} | ${p.daily_minutes} min/day on Instagram |${cust} "${p.voice}"`;
}

function renderItem(it: FeedItem, ctx: RenderCtx, agentId: string): string {
  const k = `KEY ${agentId}/${it.item_id}`;
  if (it.kind === 'event') return `  ${k} -> ${ctx.eventText(it.item_id)}`;
  const comments = ctx.topComments(agentId);
  const c = comments.length ? `\n      comments under it: ${comments.map((x) => `"${x}"`).join(' / ')}` : '';
  if (ctx.mode === 'backtest') {
    if (it.kind === 'share') return `  ${k} -> @${it.via} shared an article: "${ctx.post.text}" — their caption: "${it.caption ?? ''}"`;
    return `  ${k} -> Suggested article from ${ctx.post.handle}: "${ctx.post.text}"`;
  }
  if (it.kind === 'share') return `  ${k} -> @${it.via} shared ${ctx.post.handle}'s post: "${ctx.post.text}" — their caption: "${it.caption ?? ''}"${c}`;
  return `  ${k} -> Sponsored · ${ctx.post.handle} (${ctx.post.business}): "${ctx.post.text}"${ctx.post.image ? ` [image: ${ctx.post.image}]` : ''}${c}`;
}

const SYSTEM_AB = (place: string, business: string) => `You simulate real Instagram users in ${place} scrolling their feeds. For every person and every feed item listed under them, decide what that person does, in character.
How to decide:
- Ground every decision in the person's numbers and voice. High price sensitivity reacts to price; high ad skepticism distrusts hype, urgency and discounts; few minutes per day means little attention.
- Most people scroll past sponsored posts: in a typical crowd about 8 or 9 in 10 do. Engage only when the post genuinely fits the person.
- Memories are things this person already saw or did; stay consistent with them. Only mention seeing the post before if the person has actually seen it before (seeing the same ad again often annoys people).
- feeling: -2 strongly negative, 0 indifferent, +2 strongly positive about ${business} after seeing the item.
- would_visit: true only if this person would realistically go to or buy from ${business} this week.
- reason: the person's private thought, first person, 6 to 14 words, saying WHY the post lands that way for them in their own life (budget, routine, taste, trust in ads). Do not just repeat the post's words. Never quote the person's numbers.
- Facts: only mention prices, discounts and details that are written in the item itself. Never invent a price or a menu item.
- If the line says "first time seeing this post", the reason must not say seen, again, same, already or old.
- Never mention the person's age, gender or a role like student unless it is in their voice line.
- text: for comment or share only, what this person would actually type to friends: 3 to 12 casual words in their own voice, never the business's voice (no "Just posted", no "Try the"), never a copy of the reason; otherwise "".
- Actions, from most to least common: scroll_past is what nearly everyone does, including people who mildly dislike or are indifferent to the post. like and save are for people who genuinely like it (about 1 in 10). tap_through means they open it to learn more (about 1 in 20). comment and share are rare (about 1 in 50). hide is rare (about 1 in 50) and only for posts that truly annoy the person. A person can scroll past and still plan to visit.
- People differ: vary wording, length and tone. Do not reuse phrases across people.`;

const SYSTEM_BT = `You simulate real people browsing a social feed in the United States. For every person and every item listed under them, decide what they do, in character.
- Ground every decision in the person's numbers and voice. Most people scroll past most items; only click (tap_through) when the headline genuinely pulls this person in.
- tap_through means they clicked to read the article.
- feeling: -2 strongly negative ... +2 strongly positive about the item. would_visit: always false.
- reason: private, first person, about the headline's wording, under 20 words.
- text: for comment or share, a short real comment; otherwise "".`;

const V2_RULE = `\n- First fill "noticed": the one detail in the item this person's eye lands on (a word, the price, the offer, the tone), in their own terms. Then decide how that detail meets this person's numbers and voice; most details still lead to scroll_past.\n- Each person notices something different; do not give batch-mates the same "noticed" or reason.`;

export async function decideBatch(turns: AgentTurn[], ctx: RenderCtx, tag: string, variant: 'v1' | 'v2' = config.crowdPrompt): Promise<{ decisions: Map<string, CrowdDecision>; repaired: boolean; served_by: string }> {
  const blocks = turns.map((t) => {
    const seen = t.seenBefore === 0 ? 'first time seeing this post' : `has seen this post ${t.seenBefore} time${t.seenBefore > 1 ? 's' : ''} before`;
    const mem = t.memories.length ? `\n  memories: ${t.memories.map((m) => m.text).join(' | ')}` : '';
    return `${personaLine(t.persona)}\n  (${seen})${mem}\n  feed:\n${t.items.map((it) => renderItem(it, ctx, t.persona.id)).join('\n')}`;
  });
  const expected = turns.flatMap((t) => t.items.map((it) => `${t.persona.id}/${it.item_id}`));
  const user = `${ctx.hourLabel}. ${ctx.worldNote}\n\n${blocks.join('\n\n')}\n\nReturn exactly ${expected.length} decisions, one per KEY, using these keys: ${expected.join(', ')}.`;
  const decisions = new Map<string, CrowdDecision>();
  let repaired = false, served_by = 'none';
  try {
    const r = await chat({
      role: 'crowd',
      system: (ctx.mode === 'backtest' ? SYSTEM_BT : SYSTEM_AB(ctx.place, ctx.post.business)) + (variant === 'v2' ? V2_RULE : ''),
      user, schema: (variant === 'v2' ? CrowdBatchV2 : CrowdBatch) as typeof CrowdBatch, schemaName: variant === 'v2' ? 'CrowdBatchV2' : 'CrowdBatch', tag,
      maxTokens: (variant === 'v2' ? 110 : 90) * expected.length + 60,
    });
    served_by = r.served_by;
    repaired = r.repaired;
    if (r.ok && r.data) {
      const itemsOf = new Map(turns.map((t) => [t.persona.id, t.items.map((i) => i.item_id)]));
      for (const d of r.data.decisions) {
        const key = matchKey(d.key, itemsOf);
        if (key && !decisions.has(key)) decisions.set(key, d);
      }
    }
  } catch (e) {
    served_by = `error: ${(e as Error).message.slice(0, 120)}`;
  }
  return { decisions, repaired, served_by };
}

/** Tolerant key matching: small models sometimes drop the item part or add text around the key. */
function matchKey(raw: string, itemsOf: Map<string, string[]>): string | null {
  const m = raw.match(/p\d{3,5}/i);
  if (!m) return null;
  const agent = m[0].toLowerCase();
  const items = itemsOf.get(agent);
  if (!items) return null;
  const hit = items.find((i) => raw.includes(`/${i}`)) ?? items.find((i) => raw.includes(i));
  if (hit) return `${agent}/${hit}`;
  return items.length === 1 ? `${agent}/${items[0]}` : null;
}

/**
 * One model call per batch of active agents (BUILD_PLAN §4.4 step 4). The prompt holds only persona
 * records, each agent's recalled memories and its new feed items, so call size stays flat over the run.
 */
import { chat } from '../llm.js';
import { CrowdBatch, type CrowdDecision } from '../schemas/action.js';
import type { Persona } from '../schemas/persona.js';
import type { MemoryLine } from '../memory/hmem.js';
import type { FeedItem, Post } from './types.js';

export interface AgentTurn {
  persona: Persona;
  items: FeedItem[];
  memories: MemoryLine[];
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
- Most people scroll past sponsored posts. Engage only when the post genuinely fits the person. Hiding is for posts that annoy them.
- Memories are things this person already saw or did; stay consistent with them (seeing the same ad again often annoys people).
- feeling: -2 strongly negative, 0 indifferent, +2 strongly positive about ${business} after seeing the item.
- would_visit: true only if this person would realistically go to or buy from ${business} this week.
- reason: private, first person, about the post's actual wording, under 20 words. Never quote the person's numbers.
- text: for comment or share, a short real Instagram comment or caption in this person's own style; otherwise "".
- People differ: vary wording, length and tone. Do not reuse phrases across people.`;

const SYSTEM_BT = `You simulate real people browsing a social feed in the United States. For every person and every item listed under them, decide what they do, in character.
- Ground every decision in the person's numbers and voice. Most people scroll past most items; only click (tap_through) when the headline genuinely pulls this person in.
- tap_through means they clicked to read the article.
- feeling: -2 strongly negative ... +2 strongly positive about the item. would_visit: always false.
- reason: private, first person, about the headline's wording, under 20 words.
- text: for comment or share, a short real comment; otherwise "".`;

export async function decideBatch(turns: AgentTurn[], ctx: RenderCtx, tag: string): Promise<{ decisions: Map<string, CrowdDecision>; repaired: boolean; served_by: string }> {
  const blocks = turns.map((t) => {
    const mem = t.memories.length ? `\n  memories: ${t.memories.map((m) => m.text).join(' | ')}` : '';
    return `${personaLine(t.persona)}${mem}\n  feed:\n${t.items.map((it) => renderItem(it, ctx, t.persona.id)).join('\n')}`;
  });
  const expected = turns.flatMap((t) => t.items.map((it) => `${t.persona.id}/${it.item_id}`));
  const user = `${ctx.hourLabel}. ${ctx.worldNote}\n\n${blocks.join('\n\n')}\n\nReturn exactly ${expected.length} decisions, one per KEY, using these keys: ${expected.join(', ')}.`;
  const decisions = new Map<string, CrowdDecision>();
  let repaired = false, served_by = 'none';
  try {
    const r = await chat({
      role: 'crowd',
      system: ctx.mode === 'backtest' ? SYSTEM_BT : SYSTEM_AB(ctx.place, ctx.post.business),
      user, schema: CrowdBatch, schemaName: 'CrowdBatch', tag,
      maxTokens: 90 * expected.length + 60,
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

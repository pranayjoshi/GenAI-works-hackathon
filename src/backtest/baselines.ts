/** Single-prompt baselines (BUILD_PLAN §7): the same question the crowd answers, asked of one model call. */
import { z } from 'zod';
import { chat } from '../llm.js';
import type { Role } from '../config.js';

export const Pick = z.object({
  pick: z.enum(['A', 'B']).describe('the headline that gets more clicks'),
  reason: z.string().max(400).describe('one or two sentences'),
});
export type Pick = z.infer<typeof Pick>;

export interface BaselineResult { pick: 'A' | 'B'; reason: string; served_by: string; model: string; repaired: boolean; failed: boolean }

const SYSTEM = 'You predict how real news headlines perform in A/B tests. Reply with JSON only: {"pick":"A"|"B","reason":"..."}.';

/** role 'reason' = Super, thinking on; role 'crowd' = the crowd's model, thinking off (plan §8). */
export async function singlePrompt(role: Extract<Role, 'reason' | 'crowd'>, a: string, b: string): Promise<BaselineResult> {
  const user = `Which of these two headlines gets more clicks from a general US audience on Facebook?\n\nA: ${a}\nB: ${b}\n\nPick exactly one.`;
  const r = await chat({ role, system: SYSTEM, user, schema: Pick, schemaName: 'headline_pick', tag: 'backtest', maxTokens: role === 'reason' ? 2000 : 300, temperature: 0.2 });
  // documented default when the reply fails zod twice: scroll-past analogue = coin-free "A" is biased, so mark failed and let the scorer count it as a 0.5 tie
  if (!r.ok || !r.data) return { pick: 'A', reason: 'unparseable reply', served_by: r.served_by, model: r.model, repaired: true, failed: true };
  return { pick: r.data.pick, reason: r.data.reason, served_by: r.served_by, model: r.model, repaired: r.repaired, failed: false };
}

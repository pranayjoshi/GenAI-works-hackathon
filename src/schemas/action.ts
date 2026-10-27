import { z } from 'zod';

export const ACTIONS = ['scroll_past', 'like', 'comment', 'share', 'save', 'tap_through', 'hide'] as const;
export type ActionType = (typeof ACTIONS)[number];
export const VOCAL: ReadonlySet<ActionType> = new Set(['comment', 'share']);
export const ENGAGED: ReadonlySet<ActionType> = new Set(['like', 'comment', 'share', 'save', 'tap_through']);

/** The action record, the second shared contract (BUILD_PLAN §14). */
export interface ActionRecord {
  id: string;
  run_id: string;
  agent_id: string;
  world_id: string;     // e.g. "s1:A"
  variant: string;      // "A" | "B" | "C"
  seed: number;
  hour: number;
  item_id: string;
  item_kind: 'ad' | 'share' | 'event';
  via: string | null;   // agent id whose share delivered it
  action: ActionType;
  stance: number;       // private stance after this decision, [-1, 1]
  feeling: number;      // model's raw reaction, [-2, 2]
  would_visit: boolean;
  reason: string;
  text: string;
  unsaid: string;       // what they would have said but kept private (speak gate)
  memory_ids: string[];
  repaired: boolean;
}

/** What the crowd model returns for one batch. Kept small so a 4B model can fill it. */
export const CrowdDecision = z.object({
  key: z.string().describe('the KEY printed next to the feed item, e.g. p0042/ad'),
  action: z.enum(ACTIONS),
  feeling: z.number().int().min(-2).max(2).describe('-2 strongly negative ... +2 strongly positive'),
  would_visit: z.boolean(),
  reason: z.string().describe('private reason, under 20 words, first person'),
  text: z.string().describe('the comment or share caption if action is comment or share, else empty'),
});
export const CrowdBatch = z.object({ decisions: z.array(CrowdDecision) });

/** Prompt v2: the person first names what in the item caught (or lost) their attention, then decides. */
export const CrowdDecisionV2 = z.object({
  key: z.string(),
  noticed: z.string().describe('the specific words, price, offer or tone in the item this person reacts to, under 10 words'),
  action: z.enum(ACTIONS),
  feeling: z.number().int().min(-2).max(2),
  would_visit: z.boolean(),
  reason: z.string(),
  text: z.string(),
});
export const CrowdBatchV2 = z.object({ decisions: z.array(CrowdDecisionV2) });
export type CrowdDecision = z.infer<typeof CrowdDecision>;

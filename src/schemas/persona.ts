import { z } from 'zod';

/** One receipt = where a persona field came from (BUILD_PLAN §3.1). */
export const Receipt = z.object({
  field: z.string(),
  source: z.string(),     // e.g. "census.acs_zip B19037 (ACS 2024 5-year)"
  query_id: z.string(),   // federation query id
  ref: z.string(),        // cell / row reference
});
export type Receipt = z.infer<typeof Receipt>;

export const AGE_BANDS = ['18-24', '25-34', '35-44', '45-54', '55-64', '65+'] as const;
export const INCOME_BANDS = ['<$25k', '$25-50k', '$50-75k', '$75-100k', '$100-150k', '$150k+'] as const;
export const EDUCATION = ['No HS diploma', 'High school', 'Some college', "Bachelor's", 'Graduate'] as const;

/** Persona record (about 300 characters of content). Demographic and behaviour numbers come from the sampler, never a model. */
export const Persona = z.object({
  id: z.string(),
  age: z.number().int(),
  age_band: z.enum(AGE_BANDS),
  gender: z.enum(['woman', 'man']),
  zip: z.string(),
  income_band: z.enum(INCOME_BANDS),
  education: z.enum(EDUCATION),
  channel: z.literal('instagram'),
  daily_minutes: z.number(),
  segment: z.string(),
  role: z.enum(['core', 'spillover']),
  customer: z.object({ visits_per_month: z.number(), avg_ticket: z.number(), tenure_months: z.number() }).nullable(),
  price_sensitivity: z.number(),
  skepticism: z.number(),
  susceptibility: z.number(),
  speak_p: z.number(),
  activity: z.number(),
  influence: z.number().int(),
  voice: z.string(),
  receipts: z.array(Receipt),
});
export type Persona = z.infer<typeof Persona>;

/** What the Audience agent may return: names and definitions only, never percentages. */
export const SegmentProposal = z.object({
  core: z.object({
    name: z.string().describe('short segment name, e.g. "daily café regulars 18-34"'),
    age_bands: z.array(z.enum(AGE_BANDS)).min(1),
    why: z.string().describe('one sentence: why this post is aimed at them'),
  }),
  spillover: z.object({
    name: z.string(),
    why: z.string(),
  }),
  interests: z.array(z.string()).max(5).describe('topics the core segment cares about that relate to the post'),
});
export type SegmentProposal = z.infer<typeof SegmentProposal>;

export const VoiceBatch = z.object({
  voices: z.array(z.object({ id: z.string(), voice: z.string().max(140) })),
});

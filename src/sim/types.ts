import type { Persona } from '../schemas/persona.js';
import type { ActionRecord } from '../schemas/action.js';

export type VersionKind = 'post' | 'image' | 'ad' | 'campaign';
/** One delivered piece of a version: a post's caption, an ad's composed text, or one post of a campaign. image = VisionAgent description. */
export interface PostItem { text: string; image?: string; image_id?: string }
export interface Post {
  variant: string; text: string; business: string; handle: string;
  image?: string;             // VisionAgent description of the image (shown to the crowd as [image: ...])
  image_id?: string;          // hash of the stored image (thumbnail, ad mockup)
  kind?: VersionKind;         // default post
  ad?: { headline: string; primary: string; cta: string };
  items?: PostItem[];         // campaign: up to 3 posts delivered across the run
}

export interface InjectedEvent { id: string; round: number; text: string; target: 'all' | 'core' | 'spillover'; author: string }

export interface FeedItem {
  item_id: string;            // "ad", "sh_p0012_5", "ev_1"
  kind: 'ad' | 'share' | 'event';
  delivered_round: number;
  via: string | null;         // sharer id
  idx?: number;               // campaign: which post of the version this item is (0-based)
  caption?: string;           // sharer's caption
  text?: string;              // event text
}

export interface RunSpec {
  run_id: string;
  crowd_seed: string;         // derived from the inputs, so identical inputs rebuild the identical crowd (and replay)
  business: string;
  handle: string;
  place: string;
  zip: string;
  geoId: string;
  goal: string;
  posts: Post[];              // [A, B] (or [winner, C])
  crowdSize: number;
  rounds: number;
  startHour: number;
  hourStep: number;           // 1 = hourly; 2 = compressed day
  seeds: number[];
  batchSize: number;
  coreAgeBands?: string[];
  coreShare?: number;
  useCustomers: boolean;
  events: InjectedEvent[];
  mode: 'ab' | 'backtest';
  platform?: string;          // Pew platform for channel weighting (default instagram)
  parent_run?: string;
}

export interface WorldCounters {
  round: number;
  hour_label: string;
  exposures: number;
  deciders: number;
  intent: number;             // deciders whose latest would_visit is true
  engaged: number;
  vocal: number;
  hides: number;
  stance_sum: number;
  calls: number;
}

export type SimEvent =
  | { type: 'status'; run_id: string; phase: string; detail?: string; progress?: number }
  | { type: 'crowd'; run_id: string; personas: Persona[]; report: unknown; proposal: unknown }
  | { type: 'action'; run_id: string; world_id: string; record: ActionRecord }
  | { type: 'round'; run_id: string; world_id: string; counters: WorldCounters; carryover: string }
  | { type: 'world_done'; run_id: string; world_id: string; counters: WorldCounters }
  | { type: 'event_injected'; run_id: string; event: InjectedEvent }
  | { type: 'verdict'; run_id: string; verdict: unknown }
  | { type: 'report'; run_id: string; report: unknown }
  | { type: 'error'; run_id: string; message: string }
  | { type: 'focus'; run_id: string; turn: { speaker: string; text: string; agent_id?: string } }
  | { type: 'done'; run_id: string };

/** Platforms with Pew data (data/sources/pew_platform_use.csv). LinkedIn is not in the file, so it is not offered. */
export const PLATFORMS = ['instagram', 'facebook', 'tiktok', 'youtube', 'x', 'reddit'] as const;
export type Platform = (typeof PLATFORMS)[number];
export const PLATFORM_NAME: Record<Platform, string> = { instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok', youtube: 'YouTube', x: 'X', reddit: 'Reddit' };
export const platformName = (p?: string) => PLATFORM_NAME[(p ?? 'instagram') as Platform] ?? 'Instagram';

/** The item a post delivers at index idx (0 for everything except campaigns). */
export const itemOf = (post: Post, idx = 0): PostItem => post.items?.[idx] ?? { text: post.text, image: post.image, image_id: post.image_id };

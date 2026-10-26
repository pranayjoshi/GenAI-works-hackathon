import type { Persona } from '../schemas/persona.js';
import type { ActionRecord } from '../schemas/action.js';

export interface Post { variant: string; text: string; business: string; handle: string; image?: string }

export interface InjectedEvent { id: string; round: number; text: string; target: 'all' | 'core' | 'spillover'; author: string }

export interface FeedItem {
  item_id: string;            // "ad", "sh_p0012_5", "ev_1"
  kind: 'ad' | 'share' | 'event';
  delivered_round: number;
  via: string | null;         // sharer id
  caption?: string;           // sharer's caption
  text?: string;              // event text
}

export interface RunSpec {
  run_id: string;
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

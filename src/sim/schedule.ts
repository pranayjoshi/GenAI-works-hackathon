/**
 * Wake and serving schedules, computed from the seed before the twin worlds fork, so A and B see the
 * same people awake at the same hours and the ad served to the same people at the same hours.
 */
import type { Persona } from '../schemas/persona.js';
import { Rng, clamp } from '../util/core.js';

/** US time-of-day activity curve, local time (trough at 03:00, lunch bump, 20:00-22:00 peak). */
export const HOURLY = [0.12, 0.07, 0.05, 0.04, 0.05, 0.1, 0.25, 0.45, 0.55, 0.5, 0.48, 0.55, 0.75, 0.7, 0.55, 0.5, 0.55, 0.62, 0.7, 0.82, 0.95, 1.0, 0.85, 0.5];

export interface Schedule {
  rounds: number;
  hours: number[];                 // local hour of each round
  awake: Set<string>[];            // per round: agent ids awake
  servedAt: Map<string, number>;   // agent id -> round the ad lands in their feed
}

export function hourLabel(hour: number, round: number, hourStep: number, startHour: number) {
  const day = Math.floor((startHour + round * hourStep) / 24) + 1;
  return `Day ${day} ${String(hour).padStart(2, '0')}:00`;
}

export function buildSchedule(personas: Persona[], rng: Rng, rounds: number, startHour: number, hourStep: number, reach = { core: 0.92, spillover: 0.82 }): Schedule {
  const hours = Array.from({ length: rounds }, (_, r) => (startHour + r * hourStep) % 24);
  const awake: Set<string>[] = hours.map(() => new Set());
  const wakeRounds = new Map<string, number[]>();
  const stepBoost = hourStep > 1 ? 1.5 : 1; // a compressed round covers more clock time
  for (const p of personas) {
    const rs: number[] = [];
    hours.forEach((h, r) => {
      if (rng.chance(clamp(p.activity * HOURLY[h] * 0.9 * stepBoost, 0, 0.97))) { awake[r].add(p.id); rs.push(r); }
    });
    wakeRounds.set(p.id, rs);
  }
  // Paid reach: weighted toward the core segment, landing when people tend to scroll.
  const servedAt = new Map<string, number>();
  const lastServe = Math.max(0, rounds - 3);
  const serveWeights = hours.map((h, r) => (r <= lastServe ? HOURLY[h] : 0));
  for (const p of personas) {
    if (!rng.chance(p.role === 'core' ? reach.core : reach.spillover)) continue;
    const r = rng.weighted(hours.map((_, i) => i), serveWeights);
    servedAt.set(p.id, r);
    // guarantee at least one wake at or after the serve so every served person decides
    const later = (wakeRounds.get(p.id) ?? []).filter((x) => x >= r);
    if (!later.length) awake[Math.min(rounds - 1, r + rng.int(0, 2))].add(p.id);
  }
  return { rounds, hours, awake, servedAt };
}

import { describe, it, expect } from 'vitest';
import { Rng } from '../src/util/core.js';
import { buildGraph } from '../src/sim/graph.js';
import { buildSchedule } from '../src/sim/schedule.js';
import { buildBase, SimWorld } from '../src/sim/world.js';
import type { Persona } from '../src/schemas/persona.js';

function fakePersonas(n: number): Persona[] {
  const rng = new Rng('fake');
  const bands = ['18-24', '25-34', '35-44', '45-54', '55-64', '65+'] as const;
  return Array.from({ length: n }, (_, i) => ({
    id: `p${String(i + 1).padStart(4, '0')}`, age: 20 + i % 50, age_band: bands[i % 6], gender: i % 2 ? 'woman' : 'man', zip: '78704',
    income_band: '$50-75k', education: "Bachelor's", channel: 'instagram', daily_minutes: 30 + (i % 60), segment: 'x', role: i % 3 ? 'core' : 'spillover',
    customer: null, price_sensitivity: rng.next(), skepticism: rng.next(), susceptibility: 0.3, speak_p: 0.15, activity: 0.2 + rng.next() * 0.8,
    influence: 50 + i, voice: 'test', receipts: [],
  }));
}

describe('twin worlds (BUILD_PLAN §4.1)', () => {
  it('same seed gives the same graph and schedule', () => {
    const ps = fakePersonas(80);
    const g1 = buildGraph(ps, new Rng('s1').fork('graph')), g2 = buildGraph(ps, new Rng('s1').fork('graph'));
    expect([...g1.follows]).toEqual([...g2.follows]);
    const s1 = buildSchedule(ps, new Rng('s1').fork('schedule'), 12, 7, 2), s2 = buildSchedule(ps, new Rng('s1').fork('schedule'), 12, 7, 2);
    expect(s1.awake.map((s) => [...s])).toEqual(s2.awake.map((s) => [...s]));
    expect([...s1.servedAt]).toEqual([...s2.servedAt]);
  });

  it('forks share an identical base log and differ only by the post and its ad_served facts', async () => {
    const ps = fakePersonas(60);
    const rng = new Rng('seed-1');
    const base = buildBase(1, ps, buildGraph(ps, rng.fork('graph')), buildSchedule(ps, rng.fork('schedule'), 12, 7, 2), Date.UTC(2026, 9, 27, 12));
    const post = (v: string, text: string) => ({ variant: v, text, business: 'Cafe', handle: '@cafe' });
    const A = await SimWorld.fork('s1:A', base, post('A', 'New latte $6.50'));
    const B = await SimWorld.fork('s1:B', base, post('B', '20% off this week'));
    await A.flush(); await B.flush();
    expect(A.baseShape).toBe(B.baseShape);
    const kinds = (w: SimWorld) => w.wm.events().map((e) => e.kind);
    expect(kinds(A)).toEqual(kinds(B));
    const evA = A.wm.events(), evB = B.wm.events();
    const differing = evA.filter((e, i) => JSON.stringify(e.payload) !== JSON.stringify(evB[i].payload));
    // only the post entity and the ad_served facts that reference it may differ
    for (const e of differing) {
      const p = e.payload as any;
      expect(e.kind === 'upsertEntity' ? p.type === 'post' : p.predicate === 'ad_served').toBe(true);
    }
    expect(differing.length).toBe(1); // only the post entity: ad_served facts point at the same content-addressed post id
  });
});

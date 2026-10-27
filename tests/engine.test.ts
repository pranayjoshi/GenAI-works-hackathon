import { describe, it, expect, vi } from 'vitest';
import { sha } from '../src/util/core.js';

// Deterministic stand-in for the model: the decision depends only on the person, the item and the post text.
vi.mock('../src/sim/crowd.js', () => ({
  decideBatch: async (turns: any[], ctx: any) => {
    const decisions = new Map();
    for (const t of turns) for (const it of t.items) {
      const h = parseInt(sha(`${t.persona.id}|${it.item_id}|${ctx.post.text}`, 6), 16) / 0xffffff;
      const action = h < 0.08 ? 'share' : h < 0.2 ? 'like' : h < 0.25 ? 'comment' : 'scroll_past';
      decisions.set(`${t.persona.id}/${it.item_id}`, { key: `${t.persona.id}/${it.item_id}`, action, feeling: Math.round(h * 4 - 2), would_visit: h > 0.7, reason: `r${h.toFixed(3)}`, text: action === 'share' || action === 'comment' ? `t${h.toFixed(2)}` : '' });
    }
    return { decisions, repaired: false, served_by: 'stub' };
  },
}));

const { Rng } = await import('../src/util/core.js');
const { buildGraph } = await import('../src/sim/graph.js');
const { buildSchedule } = await import('../src/sim/schedule.js');
const { buildBase, SimWorld } = await import('../src/sim/world.js');
const { WorldRunner } = await import('../src/sim/engine.js');

function personas(n: number) {
  const rng = new Rng('engine-test');
  const bands = ['18-24', '25-34', '35-44', '45-54', '55-64', '65+'] as const;
  return Array.from({ length: n }, (_, i) => ({
    id: `p${String(i + 1).padStart(4, '0')}`, age: 20 + (i % 50), age_band: bands[i % 6], gender: i % 2 ? 'woman' : 'man', zip: '78704',
    income_band: '$50-75k', education: "Bachelor's", channel: 'instagram', daily_minutes: 40, segment: 'x', role: i % 3 ? 'core' : 'spillover',
    customer: null, price_sensitivity: rng.next(), skepticism: rng.next(), susceptibility: 0.3, speak_p: 0.4, activity: 0.5 + rng.next() * 0.5,
    influence: 100 + i, voice: 'v', receipts: [],
  })) as any[];
}

async function runPair(textA: string, textB: string, events: any[]) {
  const ps = personas(60);
  const rng = new Rng('seed');
  const spec: any = { run_id: 't', crowd_seed: 't', business: 'Cafe', handle: '@cafe', place: 'x', zip: '78704', geoId: 'x', goal: 'g', posts: [], crowdSize: 60, rounds: 8, startHour: 7, hourStep: 2, seeds: [1], batchSize: 6, useCustomers: false, events, mode: 'ab' };
  const base = buildBase(1, ps, buildGraph(ps, rng.fork('graph')), buildSchedule(ps, rng.fork('schedule'), 8, 7, 2), Date.UTC(2026, 9, 27, 12), 2);
  const post = (v: string, text: string) => ({ variant: v, text, business: 'Cafe', handle: '@cafe' });
  const [wa, wb] = await Promise.all([SimWorld.fork('s1:A', base, post('A', textA)), SimWorld.fork('s1:B', base, post('B', textB))]);
  const [ra, rb] = await Promise.all([new WorldRunner(spec, base, wa, post('A', textA), () => {}, () => events).run(), new WorldRunner(spec, base, wb, post('B', textB), () => {}, () => events).run()]);
  return { ra, rb };
}
const strip = (r: any) => ({ a: r.agent_id, h: r.hour, i: r.item_id, act: r.action, s: r.stance, v: r.would_visit, t: r.text, u: r.unsaid });

describe('engine twin worlds', () => {
  it('an A/A test produces identical action logs in both worlds', async () => {
    const { ra, rb } = await runPair('Same post', 'Same post', []);
    expect(ra.records.length).toBeGreaterThan(20);
    expect(ra.records.map(strip)).toEqual(rb.records.map(strip));
  });
  it('different posts diverge, and an injected event reaches both worlds', async () => {
    const ev = [{ id: 'ev_1', round: 4, text: 'Competitor posts 30% off', target: 'all', author: 'user' }];
    const { ra, rb } = await runPair('Post A', 'Post B', ev);
    expect(ra.records.map(strip)).not.toEqual(rb.records.map(strip));
    const evA = ra.records.filter((r: any) => r.item_kind === 'event'), evB = rb.records.filter((r: any) => r.item_kind === 'event');
    expect(evA.length).toBeGreaterThan(0);
    expect(evA.map((r: any) => r.agent_id).sort()).toEqual(evB.map((r: any) => r.agent_id).sort());
  });
});

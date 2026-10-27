import { describe, it, expect } from 'vitest';
import { decideOffline, parseFeatures } from '../src/sim/offline.js';
import { RunBody, toRunInput } from '../src/runApi.js';
import type { Persona } from '../src/schemas/persona.js';

const mk = (id: string, o: Partial<Persona> = {}): Persona => ({
  id, age: 30, age_band: '25-34', gender: 'woman', zip: '78704', income_band: '$25-50k', education: "Bachelor's", channel: 'instagram', daily_minutes: 60,
  segment: 's', role: 'core', customer: null, price_sensitivity: 0.8, skepticism: 0.3, susceptibility: 0.3, speak_p: 0.15, activity: 0.8, influence: 1, voice: 'v', receipts: [], ...o,
});
const ctx = (text: string) => ({ post: { variant: 'A', text, business: 'Cafe', handle: '@c' }, place: 'Austin', hourLabel: '8am', worldNote: '', topComments: () => [], eventText: () => '', mode: 'ab' as const });
const turns = (n: number) => Array.from({ length: n }, (_, i) => ({ persona: mk(`p${String(i).padStart(4, '0')}`, { price_sensitivity: (i % 10) / 10 }), items: [{ item_id: 'ad', kind: 'ad' as const, delivered_round: 0, via: null }], memories: [], seenBefore: 0 }));

describe('offline crowd', () => {
  it('parses post features', () => {
    expect(parseFeatures('30% off lattes, today only, free cookie').discount).toBe(30);
    expect(parseFeatures('Oat latte $6.50').price).toBe(6.5);
  });
  it('is reproducible and reacts to the discount', () => {
    const t = turns(200);
    const a1 = decideOffline(t, ctx('Oat latte $6.50, made with local honey') as any, 'x');
    const a2 = decideOffline(t, ctx('Oat latte $6.50, made with local honey') as any, 'x');
    const b = decideOffline(t, ctx('Oat latte 40% off this week only') as any, 'x');
    expect([...a1.values()]).toEqual([...a2.values()]);
    const visit = (m: Map<string, any>) => [...m.values()].filter((d) => d.would_visit).length;
    expect(visit(b)).toBeGreaterThan(visit(a1));
    expect([...b.values()].every((d) => d.reason.length > 0)).toBe(true);
  });
  it('validates /run input with clear errors', () => {
    expect(RunBody.safeParse({ business: { name: 'x' } }).success).toBe(false);
    const ok = RunBody.parse({ business: { name: 'x', address: 'Austin TX 78704' }, version_a: { text: 'aaa' }, version_b: { caption: 'bbb', offer: '10% off' } });
    const inp = toRunInput(ok);
    expect(inp.zip).toBe('78704');
    expect(inp.postB).toBe('bbb 10% off');
    expect(inp.crowdSize).toBe(60);
  });
});

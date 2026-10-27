import { describe, it, expect } from 'vitest';
import { verdict, type WorldSummary, type Metrics } from '../src/sim/metrics.js';

const m = (n: number, rate: number): Metrics => ({ n, intent: Math.round(n * rate), intent_rate: rate, tap_rate: 0, engagement_rate: 0, mean_stance: 0, stance_sd: 0, vocal_share: 0, silent_negative_share: 0, hide_rate: 0, exposures: n });
const w = (seed: number, variant: string, n: number, rate: number): WorldSummary => ({ world_id: `s${seed}:${variant}`, variant, seed, overall: m(n, rate), segments: {} });

describe('verdict rule (BUILD_PLAN §5)', () => {
  it('declares a winner only when every seed agrees and the gap beats the CI', () => {
    const v = verdict([w(1, 'A', 520, 0.098), w(1, 'B', 520, 0.142), w(2, 'A', 515, 0.1), w(2, 'B', 518, 0.15)], ['A', 'B'], 'intent_rate', 'intent');
    expect(v.winner).toBe('B');
    expect(v.call).toBe('winner');
    expect(v.headline).toMatch(/^B wins on intent: /);
  });
  it('says leads (not wins) when seeds disagree', () => {
    const v = verdict([w(1, 'A', 520, 0.12), w(1, 'B', 520, 0.14), w(2, 'A', 515, 0.15), w(2, 'B', 518, 0.13)], ['A', 'B'], 'intent_rate', 'intent');
    expect(v.winner).toBeNull();
    expect(v.call).toBe('leader');
    expect(v.headline).toMatch(/^[AB] leads on intent: .*95% CI .* to .*; [AB] ahead in 1 of 2 seeds; \d+% likely to be the better version\.$/);
    expect(v.headline).not.toMatch(/too close|significant|inconclusive/i);
  });
  it('reports P(better) from the normal approximation when the gap is inside the CI', () => {
    const v = verdict([w(1, 'A', 100, 0.1), w(1, 'B', 100, 0.13)], ['A', 'B'], 'intent_rate', 'intent');
    expect(v.winner).toBeNull();
    expect(v.leader).toBe('B');
    expect(v.p_better).toBeGreaterThan(0.5);
    expect(v.p_better).toBeLessThan(0.97);
  });
});

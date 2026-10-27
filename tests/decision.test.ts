/** The spend decision's arithmetic (src/report/decision.ts): sample size, detectable gap, and the call it leads to. */
import { describe, expect, it } from 'vitest';
import { detectableGap, perVersion, MAX_TEST_SHARE } from '../src/report/decision.js';

describe('spend decision math', () => {
  it('matches the textbook two-proportion sample size', () => {
    // 50% vs 60%, 5% two-sided, 80% power: about 388 per group (standard tables give 385-389)
    const n = perVersion(0.5, 0.6)!;
    expect(n).toBeGreaterThanOrEqual(385);
    expect(n).toBeLessThanOrEqual(390);
  });

  it('gives the demo run numbers: 3,828 per version for 29.6% vs 26.7%', () => {
    expect(perVersion(0.296, 0.2672)).toBe(3828);
  });

  it('returns null when there is no gap to detect', () => {
    expect(perVersion(0.3, 0.3)).toBeNull();
  });

  it('detectable gap is consistent with the sample size it came from', () => {
    const n = 2700;
    const gap = detectableGap(0.296, n);
    expect(perVersion(0.296, 0.296 + gap)!).toBeLessThanOrEqual(n);
    expect(perVersion(0.296, 0.296 + gap * 0.95)!).toBeGreaterThan(n);
    expect(gap * 100).toBeCloseTo(3.5, 0);
  });

  it('a test needing more than the budget share of the audience is not worth running', () => {
    const total = perVersion(0.296, 0.2672)! * 2;
    expect(total / 27006).toBeGreaterThan(MAX_TEST_SHARE);
  });
});

import { describe, it, expect } from 'vitest';
import { guardDecision, type GuardInput } from '../src/sim/guard.js';

const A = 'New: Oat Milk Honey Latte, $6.50. Made with local wildflower honey. On the menu now at South Congress Coffee.';
const B = 'Your new morning ritual: our Oat Milk Honey Latte, 20% off this week only. Come say hi on South Congress.';
const base = (o: Partial<GuardInput>): GuardInput => ({ action: 'scroll_past', feeling: 0, would_visit: false, reason: '', text: '', itemKind: 'ad', firstExposure: true, postText: B, otherPostText: A, eventTexts: [], voice: 'busy', batchReasons: new Set(), ...o });

describe('crowd guard', () => {
  it('withholds invented prices and leaked details from the other version', () => {
    expect(guardDecision(base({ reason: '$8 is way too much for a latte' })).checks).toContain('reason:invented_price');
    expect(guardDecision(base({ reason: 'the $6.50 price is steep for me' })).checks).toContain('reason:invented_price');
    expect(guardDecision(base({ reason: 'wildflower honey sounds nice actually' })).checks).toContain('reason:other_version_leak');
    expect(guardDecision(base({ reason: '20% off this week is tempting' })).checks).toEqual([]);
  });
  it('rejects repeat claims on a first exposure only', () => {
    expect(guardDecision(base({ reason: 'seen this ad again, so boring' })).reason).toBe('');
    expect(guardDecision(base({ reason: 'seen this ad again, so boring', firstExposure: false })).reason).not.toBe('');
  });
  it('resolves contradictions toward the private feeling and drops brand-voice comments', () => {
    const g = guardDecision(base({ action: 'like', feeling: -2, would_visit: true, reason: 'discount feels like bait' }));
    expect(g.action).toBe('scroll_past');
    expect(g.would_visit).toBe(false);
    const c = guardDecision(base({ action: 'comment', feeling: 1, text: 'Try the oat latte, worth the trip!' }));
    expect(c.text).toBe('');
    expect(c.action).toBe('like');
  });
});

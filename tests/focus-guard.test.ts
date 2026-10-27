import { describe, it, expect } from 'vitest';
import { focusIssue } from '../src/report/interview.js';

describe('focus group anti-repeat guard', () => {
  const a = "Honestly, the 20% off would make me stop by sooner rather than later, since I'm already a regular";
  it('rejects regular claims from non-customers only', () => {
    expect(focusIssue("I'm a regular there and it's my usual", [], false)).toBe('regular-claim');
    expect(focusIssue("I'm a regular there and it's my usual", [], true)).toBeNull();
  });
  it('rejects shared phrases and openers', () => {
    expect(focusIssue('Honestly, the 20% off would make me stop by sooner for a latte', [a], true)).toBe('same-opener');
    expect(focusIssue('Price is the dealbreaker, 20% off would make me stop by sooner rather than later', [a], true)).toBe('overlap');
    expect(focusIssue('Nothing here moves me; I scrolled past it.', [a], true)).toBeNull();
  });
});

/** Scoring for the backtest: Wilson 95% CI and an exact McNemar test (BUILD_PLAN §7). */

export interface Score { correct: number; n: number; rate: number; ci: [number, number] }

/** `correct` may be fractional (ties count 0.5). */
export function wilson(correct: number, n: number, z = 1.96): [number, number] {
  if (!n) return [0, 1];
  const p = correct / n, z2 = z * z;
  const d = 1 + z2 / n, c = p + z2 / (2 * n), h = z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return [Math.max(0, (c - h) / d), Math.min(1, (c + h) / d)];
}
export function score(outcomes: number[]): Score {
  const n = outcomes.length, correct = outcomes.reduce((s, x) => s + x, 0);
  return { correct, n, rate: n ? correct / n : 0, ci: wilson(correct, n) };
}

function logChoose(n: number, k: number) { let s = 0; for (let i = 1; i <= k; i++) s += Math.log((n - k + i) / i); return s; }
/** Two-sided exact binomial p-value for k of m at p = 0.5. */
export function binomTwoSided(k: number, m: number): number {
  if (m === 0) return 1;
  const lo = Math.min(k, m - k);
  let tail = 0;
  for (let i = 0; i <= lo; i++) tail += Math.exp(logChoose(m, i) - m * Math.LN2);
  return Math.min(1, 2 * tail);
}

/**
 * McNemar exact test on per-test outcomes (1 correct, 0 wrong, 0.5 tie). Ties are treated as half-discordant:
 * a test where one method scores x and the other y contributes |x - y| to b (first better) or c (second better),
 * so b, c may be fractional. The p-value uses the exact binomial on round(b + c) trials with round(b) successes; the
 * rounding only matters when ties occur, and the raw b, c are reported.
 */
export function mcnemar(x: number[], y: number[]): { b: number; c: number; p: number } {
  let b = 0, c = 0;
  for (let i = 0; i < Math.min(x.length, y.length); i++) { const d = x[i] - y[i]; if (d > 0) b += d; else if (d < 0) c += -d; }
  const m = Math.round(b + c);
  return { b, c, p: binomTwoSided(Math.min(m, Math.round(b)), m) };
}

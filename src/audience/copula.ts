/** Gaussian copula: keeps each column's real marginal and the rank correlations between columns. */
import { Rng } from '../util/core.js';

function normInv(p: number): number { // Acklam's approximation
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425, ph = 1 - pl;
  if (p < pl) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p > ph) { const q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  const q = p - 0.5, r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}
function normCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp(-x * x / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

export class GaussianCopula {
  readonly columns: string[];
  readonly corr: number[][];
  private sorted: number[][];
  private chol: number[][];
  readonly n: number;

  constructor(rows: Record<string, number>[], columns: string[]) {
    this.columns = columns;
    this.n = rows.length;
    this.sorted = columns.map((c) => rows.map((r) => Number(r[c])).sort((a, b) => a - b));
    // normal scores from ranks
    const z = columns.map((c) => {
      const vals = rows.map((r, i) => ({ v: Number(r[c]), i }));
      vals.sort((a, b) => a.v - b.v);
      const out = new Array(rows.length).fill(0);
      vals.forEach((x, rank) => { out[x.i] = normInv((rank + 0.5) / rows.length); });
      return out;
    });
    const k = columns.length;
    this.corr = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => {
      let s = 0; for (let t = 0; t < rows.length; t++) s += z[i][t] * z[j][t];
      return s / rows.length;
    }));
    this.chol = cholesky(this.corr);
  }

  sample(rng: Rng): Record<string, number> {
    const k = this.columns.length;
    const e = Array.from({ length: k }, () => rng.normal());
    const out: Record<string, number> = {};
    for (let i = 0; i < k; i++) {
      let zi = 0; for (let j = 0; j <= i; j++) zi += this.chol[i][j] * e[j];
      const u = normCdf(zi);
      const s = this.sorted[i];
      out[this.columns[i]] = s[Math.min(s.length - 1, Math.max(0, Math.floor(u * s.length)))];
    }
    return out;
  }
}

function cholesky(a: number[][]): number[][] {
  const n = a.length;
  const L = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) {
    let s = a[i][j];
    for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
    L[i][j] = i === j ? Math.sqrt(Math.max(s, 1e-9)) : s / L[j][j];
  }
  return L;
}

import crypto from 'node:crypto';

export const sha = (s: string, n = 16) => crypto.createHash('sha256').update(s).digest('hex').slice(0, n);
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
export const round = (x: number, d = 3) => Math.round(x * 10 ** d) / 10 ** d;

/** Counting semaphore. */
export class Semaphore {
  private queue: (() => void)[] = [];
  constructor(private n: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.n <= 0) await new Promise<void>((r) => this.queue.push(r));
    this.n--;
    try { return await fn(); } finally {
      this.n++;
      const next = this.queue.shift();
      if (next) next();
    }
  }
}

/** Sliding-window requests-per-minute limiter. */
export class RpmLimiter {
  private stamps: number[] = [];
  constructor(private rpm: number) {}
  async take() {
    for (;;) {
      const now = Date.now();
      this.stamps = this.stamps.filter((t) => now - t < 60_000);
      if (this.stamps.length < this.rpm) { this.stamps.push(now); return; }
      await sleep(60_000 - (now - this.stamps[0]) + 25);
    }
  }
}

/** Seeded PRNG (sfc32) with helpers. The only randomness allowed in src/sim and src/audience. */
export class Rng {
  private a: number; private b: number; private c: number; private d: number;
  constructor(seed: string | number) {
    const h = crypto.createHash('sha256').update(String(seed)).digest();
    this.a = h.readUInt32LE(0); this.b = h.readUInt32LE(4); this.c = h.readUInt32LE(8); this.d = h.readUInt32LE(12);
    for (let i = 0; i < 12; i++) this.next();
  }
  next(): number {
    this.a >>>= 0; this.b >>>= 0; this.c >>>= 0; this.d >>>= 0;
    let t = (this.a + this.b) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.d = (this.d + 1) | 0;
    t = (t + this.d) | 0;
    this.c = (this.c + t) | 0;
    return (t >>> 0) / 4294967296;
  }
  fork(label: string) { return new Rng(`${this.next()}:${label}`); }
  int(lo: number, hi: number) { return lo + Math.floor(this.next() * (hi - lo + 1)); }
  pick<T>(xs: readonly T[]): T { return xs[Math.floor(this.next() * xs.length)]; }
  chance(p: number) { return this.next() < p; }
  normal() { // Box-Muller
    const u = Math.max(this.next(), 1e-12), v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  logNormal(mu: number, sigma: number) { return Math.exp(mu + sigma * this.normal()); }
  gamma(k: number): number { // Marsaglia-Tsang
    if (k < 1) return this.gamma(k + 1) * Math.pow(this.next(), 1 / k);
    const d = k - 1 / 3, c = 1 / Math.sqrt(9 * d);
    for (;;) {
      let x: number, v: number;
      do { x = this.normal(); v = 1 + c * x; } while (v <= 0);
      v = v * v * v;
      const u = this.next();
      if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
    }
  }
  beta(a: number, b: number) { const x = this.gamma(a); return x / (x + this.gamma(b)); }
  weighted<T>(items: readonly T[], weights: readonly number[]): T {
    const total = weights.reduce((s, w) => s + Math.max(0, w), 0);
    let r = this.next() * total;
    for (let i = 0; i < items.length; i++) { r -= Math.max(0, weights[i]); if (r <= 0) return items[i]; }
    return items[items.length - 1];
  }
  shuffle<T>(xs: T[]): T[] {
    for (let i = xs.length - 1; i > 0; i--) { const j = Math.floor(this.next() * (i + 1)); [xs[i], xs[j]] = [xs[j], xs[i]]; }
    return xs;
  }
}

/** Tiny typed event bus for SSE fan-out. */
export class Bus<T> {
  private subs = new Set<(e: T) => void>();
  on(fn: (e: T) => void) { this.subs.add(fn); return () => this.subs.delete(fn); }
  emit(e: T) { for (const s of this.subs) { try { s(e); } catch { /* subscriber error */ } } }
}

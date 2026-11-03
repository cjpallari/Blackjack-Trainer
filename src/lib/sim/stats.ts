/**
 * Estimators with honest uncertainty. Hands within a shoe are correlated
 * (they share a count), so EV-type ratios are estimated with shoes as the
 * independent sampling unit (cluster / linearised ratio estimator). Session
 * outcomes (ruin, targets) use whole independent sessions as the unit.
 */

/** Running sums for a ratio Σx / Σn over independent clusters (shoes). */
export class RatioAccumulator {
  k = 0;
  sx = 0;
  sn = 0;
  sxx = 0;
  sxn = 0;
  snn = 0;

  add(x: number, n: number) {
    this.k++;
    this.sx += x;
    this.sn += n;
    this.sxx += x * x;
    this.sxn += x * n;
    this.snn += n * n;
  }

  merge(o: RatioAccumulator) {
    this.k += o.k;
    this.sx += o.sx;
    this.sn += o.sn;
    this.sxx += o.sxx;
    this.sxn += o.sxn;
    this.snn += o.snn;
  }

  /** Σx / Σn. */
  get ratio(): number {
    return this.sn ? this.sx / this.sn : NaN;
  }

  /** Standard error of the ratio, Var ≈ k/(k−1) · Σ(x − R·n)² / (Σn)². */
  get se(): number {
    if (this.k < 2 || !this.sn) return NaN;
    const r = this.ratio;
    const ss = this.sxx - 2 * r * this.sxn + r * r * this.snn;
    return Math.sqrt(Math.max(0, ss) * (this.k / (this.k - 1))) / this.sn;
  }

  /**
   * Per-unit variance of x accounting for within-cluster correlation:
   * Σ(x − R·n)² / Σn. With n = rounds this is the per-round variance whose
   * square root × √100 gives the SD per 100 rounds.
   */
  get clusterVariancePerUnit(): number {
    if (!this.sn) return NaN;
    const r = this.ratio;
    return Math.max(0, this.sxx - 2 * r * this.sxn + r * r * this.snn) / this.sn;
  }

  toJSON() {
    return { k: this.k, sx: this.sx, sn: this.sn, sxx: this.sxx, sxn: this.sxn, snn: this.snn };
  }

  static from(o: { k: number; sx: number; sn: number; sxx: number; sxn: number; snn: number }): RatioAccumulator {
    return Object.assign(new RatioAccumulator(), o);
  }
}

export interface Interval {
  readonly estimate: number;
  readonly low: number;
  readonly high: number;
}

export const Z95 = 1.959964;

export function normalInterval(estimate: number, se: number): Interval {
  return { estimate, low: estimate - Z95 * se, high: estimate + Z95 * se };
}

/** Wilson score interval for a proportion (well behaved near 0 and 1). */
export function wilson(successes: number, n: number): Interval {
  if (n === 0) return { estimate: NaN, low: 0, high: 1 };
  const p = successes / n;
  const z2 = Z95 * Z95;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (Z95 * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { estimate: p, low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
}

/** Mean and its standard error for independent samples. */
export function meanSe(xs: readonly number[]): { mean: number; se: number; sd: number } {
  const n = xs.length;
  if (!n) return { mean: NaN, se: NaN, sd: NaN };
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const sd = n > 1 ? Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : NaN;
  return { mean, se: sd / Math.sqrt(n), sd };
}

export function percentile(sorted: readonly number[], p: number): number {
  if (!sorted.length) return NaN;
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

/** Intervals overlap → the data do not distinguish the two estimates at 95%. */
export function distinguishable(diff: Interval): boolean {
  return diff.low > 0 || diff.high < 0;
}

/**
 * Enough of the F distribution to gate the day-of-week fit (§3.1).
 * Lanczos log-gamma, regularized incomplete beta by continued fraction.
 */

const LANCZOS = [
  676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
  12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];

export function lnGamma(z: number): number {
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z);
  const x = z - 1;
  let a = 0.99999999999980993;
  for (let i = 0; i < LANCZOS.length; i++) a += LANCZOS[i]! / (x + i + 1);
  const t = x + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Continued fraction for the incomplete beta (Lentz). */
function betacf(a: number, b: number, x: number): number {
  const MAXIT = 300;
  const EPS = 3e-16;
  const FPMIN = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/** Regularized incomplete beta I_x(a, b). */
export function incompleteBeta(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(
    lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x),
  );
  return x < (a + 1) / (a + b + 2)
    ? (front * betacf(a, b, x)) / a
    : 1 - (front * betacf(b, a, 1 - x)) / b;
}

/** Upper tail P(F > f) with d1, d2 degrees of freedom. This is the p-value. */
export function fSurvival(f: number, d1: number, d2: number): number {
  if (!Number.isFinite(f) || f <= 0) return 1;
  if (d1 <= 0 || d2 <= 0) return 1;
  return incompleteBeta(d2 / 2, d1 / 2, d2 / (d2 + d1 * f));
}

export interface OneWayAnova {
  f: number;
  p: number;
  df1: number;
  df2: number;
  groups: number; // non-empty groups actually used
}

/**
 * One-way ANOVA over integer group labels. Empty groups are dropped rather than
 * contributing zero-width cells, so a user who never records on Sundays is tested
 * on the six weekdays they do record.
 */
export function oneWayAnova(values: number[], groups: number[], groupCount: number): OneWayAnova {
  const n = values.length;
  if (n !== groups.length) throw new Error("anova: mismatched input lengths");

  const sums = new Array<number>(groupCount).fill(0);
  const counts = new Array<number>(groupCount).fill(0);
  for (let i = 0; i < n; i++) {
    sums[groups[i]!]! += values[i]!;
    counts[groups[i]!]! += 1;
  }
  const used = counts.filter((c) => c > 0).length;
  const df1 = used - 1;
  const df2 = n - used;
  if (df1 < 1 || df2 < 1) return { f: 0, p: 1, df1: Math.max(0, df1), df2: Math.max(0, df2), groups: used };

  const grand = values.reduce((s, v) => s + v, 0) / n;
  let ssb = 0;
  for (let g = 0; g < groupCount; g++) {
    if (counts[g]! === 0) continue;
    const gm = sums[g]! / counts[g]!;
    ssb += counts[g]! * (gm - grand) ** 2;
  }
  let ssw = 0;
  for (let i = 0; i < n; i++) {
    const g = groups[i]!;
    ssw += (values[i]! - sums[g]! / counts[g]!) ** 2;
  }
  if (ssw <= 0) return { f: Infinity, p: 0, df1, df2, groups: used };

  const f = ssb / df1 / (ssw / df2);
  return { f, p: fSurvival(f, df1, df2), df1, df2, groups: used };
}

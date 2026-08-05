import { dayIndex, mean, sd } from "./series";
import { detrendSeries } from "./detrend";
import type { SeriesPoint } from "./series";

/**
 * Lag-1 autocorrelation. When dayIdx is given, only pairs of consecutive
 * calendar days enter the numerator — a pair spanning a gap is not lag-1.
 * Denominator is the full centered sum of squares (standard estimator).
 */
export function lag1Autocorr(xs: number[], dayIdx?: number[]): number {
  const n = xs.length;
  if (n < 3) return 0;
  const m = mean(xs);
  let denom = 0;
  for (const x of xs) denom += (x - m) * (x - m);
  if (denom === 0) return 0;
  let num = 0;
  for (let i = 0; i < n - 1; i++) {
    if (dayIdx && dayIdx[i + 1]! - dayIdx[i]! !== 1) continue;
    num += (xs[i]! - m) * (xs[i + 1]! - m);
  }
  return num / denom;
}

/** §3.2: positive autocorrelation shrinks the information in n days. Floored at 2. */
export function nEff(n: number, r1: number): number {
  const ne = r1 > 0 ? (n * (1 - r1)) / (1 + r1) : n;
  return Math.max(2, ne);
}

export interface NoiseSummary {
  n: number;
  sigma: number; // sd of detrended residuals, n-1 denominator
  r1: number; // lag-1 autocorrelation of residuals
  neff: number;
  slope: number; // baseline drift, units/day — surfaced, never hidden
  dowOffsets: number[] | null;
}

/** Detrend a baseline series (§3.1) and summarize its noise (§3.2). */
export function baselineNoise(points: SeriesPoint[]): NoiseSummary {
  if (points.length < 3) throw new Error("need at least 3 baseline observations");
  const { residuals, slope, dowOffsets } = detrendSeries(points);
  const dayIdx = dayIndex(points.map((p) => p.date));
  const sigma = sd(residuals);
  const r1 = lag1Autocorr(residuals, dayIdx);
  return { n: points.length, sigma, r1, neff: nEff(points.length, r1), slope, dowOffsets };
}

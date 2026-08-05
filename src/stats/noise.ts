import { dayIndex, sd } from "./series";
import { detrendSeries } from "./detrend";
import type { SeriesPoint } from "./series";

/** §3.2: below this many valid pairs at a lag, the estimate is not trustworthy at that lag. */
export const MIN_PAIRS = 10;
/** Beyond this lag the geometric back-conversion r_k^(1/k) amplifies noise too much to be useful. */
export const MAX_LAG = 30;

export type AutocorrMethod = "lag1" | "lag_k" | "insufficient";

export interface AutocorrResult {
  /** Correlation at one calendar day of separation. 0 when it could not be estimated. */
  r1: number;
  method: AutocorrMethod;
  /** The lag actually estimated at. 1 for the direct case. */
  lag: number;
  /** Valid pairs at that lag. */
  pairs: number;
  /** Adjacent-day pairs available, regardless of which lag was used. */
  adjacentPairs: number;
}

/**
 * §3.2. Correlation at lag k, with numerator and denominator each normalized by
 * their own count. Normalizing the numerator by n instead of by the pair count
 * deflates the estimate by roughly the fraction of pairs that gaps removed.
 */
function corrAtLag(
  centered: number[],
  pos: Map<number, number>,
  dayIdx: number[],
  meanSquare: number,
  k: number,
): { r: number; pairs: number } {
  let sum = 0;
  let pairs = 0;
  for (let i = 0; i < dayIdx.length; i++) {
    const j = pos.get(dayIdx[i]! + k);
    if (j === undefined) continue;
    sum += centered[i]! * centered[j]!;
    pairs += 1;
  }
  if (pairs === 0) return { r: 0, pairs: 0 };
  return { r: sum / pairs / meanSquare, pairs };
}

/**
 * §3.2. Per-calendar-day autocorrelation.
 *
 * Only pairs exactly one calendar day apart count as lag-1. When fewer than
 * MIN_PAIRS of those exist — an every-other-day metric has none at all — fall
 * through to the smallest lag that does have enough pairs and convert back under
 * the AR(1) assumption the spec already makes: r1 = r_k^(1/k).
 */
export function autocorrPerDay(xs: number[], dayIdx: number[]): AutocorrResult {
  const n = xs.length;
  if (n !== dayIdx.length) throw new Error("autocorr: mismatched input lengths");
  if (n < 3) return { r1: 0, method: "insufficient", lag: 0, pairs: 0, adjacentPairs: 0 };

  const m = xs.reduce((s, x) => s + x, 0) / n;
  const centered = xs.map((x) => x - m);
  const meanSquare = centered.reduce((s, c) => s + c * c, 0) / n;
  if (meanSquare === 0) {
    return { r1: 0, method: "insufficient", lag: 0, pairs: 0, adjacentPairs: 0 };
  }

  const pos = new Map<number, number>();
  for (let i = 0; i < n; i++) pos.set(dayIdx[i]!, i);

  const lag1 = corrAtLag(centered, pos, dayIdx, meanSquare, 1);
  if (lag1.pairs >= MIN_PAIRS) {
    return {
      r1: Math.min(lag1.r, 0.999),
      method: "lag1",
      lag: 1,
      pairs: lag1.pairs,
      adjacentPairs: lag1.pairs,
    };
  }

  const span = dayIdx[n - 1]! - dayIdx[0]!;
  for (let k = 2; k <= Math.min(MAX_LAG, span); k++) {
    const at = corrAtLag(centered, pos, dayIdx, meanSquare, k);
    if (at.pairs < MIN_PAIRS) continue;
    // A non-positive r_k has no real k-th root to speak of; report no carryover.
    const r1 = at.r > 0 ? Math.min(at.r ** (1 / k), 0.999) : 0;
    return { r1, method: "lag_k", lag: k, pairs: at.pairs, adjacentPairs: lag1.pairs };
  }

  return { r1: 0, method: "insufficient", lag: 0, pairs: 0, adjacentPairs: lag1.pairs };
}

/** Convenience wrapper for complete daily series. */
export function lag1Autocorr(xs: number[], dayIdx?: number[]): number {
  return autocorrPerDay(xs, dayIdx ?? xs.map((_, i) => i)).r1;
}

export interface NEffResult {
  value: number;
  /** True when the floor of 2 bound. The MDE is not meaningful here and must not pass silently. */
  floored: boolean;
}

/** §3.2: positive autocorrelation shrinks the information in a series. Floored at 2. */
export function nEffDetail(n: number, r: number): NEffResult {
  const raw = r > 0 ? (n * (1 - r)) / (1 + r) : n;
  return raw < 2 ? { value: 2, floored: true } : { value: raw, floored: false };
}

export function nEff(n: number, r: number): number {
  return nEffDetail(n, r).value;
}

/** Median calendar days between consecutive observations. 1 for a complete daily series. */
export function medianGap(dayIdx: number[]): number {
  if (dayIdx.length < 2) return 1;
  const gaps: number[] = [];
  for (let i = 1; i < dayIdx.length; i++) gaps.push(dayIdx[i]! - dayIdx[i - 1]!);
  gaps.sort((a, b) => a - b);
  const mid = gaps.length >> 1;
  return gaps.length % 2 === 1 ? gaps[mid]! : (gaps[mid - 1]! + gaps[mid]!) / 2;
}

/**
 * Correlation between consecutive *observations* at a given spacing.
 * n_eff's formula assumes r is the correlation between neighbouring observations,
 * but r1 is per calendar day; a series observed every other day carries r1^2
 * from one reading to the next, not r1.
 */
export function rAtSpacing(r1: number, gap: number): number {
  return r1 > 0 ? r1 ** gap : 0;
}

export interface NoiseSummary {
  n: number; // observations, not calendar days
  sigma: number; // sd of detrended residuals, n-1 denominator
  r1: number; // per calendar day
  rEff: number; // between consecutive observations at the observed spacing
  medianGap: number;
  neff: number;
  neffFloored: boolean;
  method: AutocorrMethod;
  lag: number;
  pairs: number;
  adjacentPairs: number;
  slope: number; // baseline drift, units/day — surfaced, never hidden
  dowOffsets: number[] | null;
  dowP: number | null;
  dowReason: "applied" | "too_few_observations" | "no_weekly_pattern";
  /** Observations per calendar day across the baseline span. */
  observedAdherence: number;
}

/** Detrend a baseline series (§3.1) and summarize its noise (§3.2). */
export function baselineNoise(points: SeriesPoint[]): NoiseSummary {
  if (points.length < 3) throw new Error("need at least 3 baseline observations");
  const { residuals, slope, dowOffsets, dowP, dowReason } = detrendSeries(points);
  const dayIdx = dayIndex(points.map((p) => p.date));

  const sigma = sd(residuals);
  const ac = autocorrPerDay(residuals, dayIdx);
  const gap = medianGap(dayIdx);
  const rEff = rAtSpacing(ac.r1, gap);
  const ne = nEffDetail(points.length, rEff);
  const span = dayIdx[dayIdx.length - 1]! - dayIdx[0]! + 1;

  return {
    n: points.length,
    sigma,
    r1: ac.r1,
    rEff,
    medianGap: gap,
    neff: ne.value,
    neffFloored: ne.floored,
    method: ac.method,
    lag: ac.lag,
    pairs: ac.pairs,
    adjacentPairs: ac.adjacentPairs,
    slope,
    dowOffsets,
    dowP,
    dowReason,
    observedAdherence: points.length / span,
  };
}

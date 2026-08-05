import type { Observation } from "../types";

export interface SeriesPoint {
  date: string; // ISO yyyy-mm-dd
  value: number;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function utcMs(date: string): number {
  if (!ISO_DATE.test(date)) throw new Error(`not an ISO date: "${date}"`);
  const ms = Date.parse(date + "T00:00:00Z");
  if (Number.isNaN(ms)) throw new Error(`invalid date: "${date}"`);
  return ms;
}

/** Whole calendar days from a to b (positive when b is later). */
export function daysBetween(a: string, b: string): number {
  return Math.round((utcMs(b) - utcMs(a)) / 86_400_000);
}

/** 0 = Sunday .. 6 = Saturday, in UTC so local timezone never shifts a date. */
export function dayOfWeek(date: string): number {
  return new Date(utcMs(date)).getUTCDay();
}

/** Calendar-day offsets from the first point. Missing days leave gaps; rows are never invented. */
export function dayIndex(dates: string[]): number[] {
  const first = dates[0];
  if (first === undefined) return [];
  return dates.map((d) => daysBetween(first, d));
}

export function mean(xs: number[]): number {
  if (xs.length === 0) throw new Error("mean of empty series");
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/** Sample standard deviation, n-1 denominator. */
export function sd(xs: number[]): number {
  if (xs.length < 2) throw new Error("sd needs at least 2 observations");
  const m = mean(xs);
  let ss = 0;
  for (const x of xs) ss += (x - m) * (x - m);
  return Math.sqrt(ss / (xs.length - 1));
}

/**
 * Pull one metric out of the observation log as a date-sorted series.
 * Null and absent values are dropped — a missing day is an absent row, never a zero,
 * and nothing downstream interpolates.
 */
export function extractSeries(observations: Observation[], metricId: string): SeriesPoint[] {
  const points: SeriesPoint[] = [];
  for (const obs of observations) {
    const v = obs.values[metricId];
    if (v === null || v === undefined) continue;
    points.push({ date: obs.date, value: v });
  }
  points.sort((a, b) => utcMs(a.date) - utcMs(b.date));
  return points;
}

import { dayIndex, dayOfWeek, mean, type SeriesPoint } from "./series";

export interface DetrendResult {
  /** What every downstream noise estimate uses. Same order as the input series. */
  residuals: number[];
  /** OLS slope in metric units per calendar day. Surface this: a drifting baseline is the top cause of spurious n=1 results. */
  slope: number;
  intercept: number;
  /** Weekday mean minus grand mean, index 0 = Sunday. Null when n < 21 and the fit was skipped. */
  dowOffsets: number[] | null;
}

/**
 * §3.1. If ≥ 21 observations, subtract day-of-week means (centered, so the level
 * stays in the trend fit), then fit and subtract an OLS linear trend on calendar
 * day index. Day index is calendar offset, not row index, so gaps stay honest.
 */
export function detrend(values: number[], days: number[], dows: number[]): DetrendResult {
  const n = values.length;
  if (n < 2) throw new Error("detrend needs at least 2 observations");
  if (days.length !== n || dows.length !== n) throw new Error("detrend: mismatched input lengths");

  let work = values.slice();
  let dowOffsets: number[] | null = null;

  if (n >= 21) {
    const sums = new Array<number>(7).fill(0);
    const counts = new Array<number>(7).fill(0);
    for (let i = 0; i < n; i++) {
      const k = dows[i]!;
      sums[k]! += values[i]!;
      counts[k]! += 1;
    }
    const grand = mean(values);
    dowOffsets = sums.map((s, k) => (counts[k]! > 0 ? s / counts[k]! - grand : 0));
    work = work.map((v, i) => v - dowOffsets![dows[i]!]!);
  }

  const tbar = mean(days);
  const ybar = mean(work);
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    const dt = days[i]! - tbar;
    sxy += dt * (work[i]! - ybar);
    sxx += dt * dt;
  }
  const slope = sxx > 0 ? sxy / sxx : 0;
  const intercept = ybar - slope * tbar;
  const residuals = work.map((y, i) => y - (intercept + slope * days[i]!));

  return { residuals, slope, intercept, dowOffsets };
}

export function detrendSeries(points: SeriesPoint[]): DetrendResult {
  const dates = points.map((p) => p.date);
  return detrend(
    points.map((p) => p.value),
    dayIndex(dates),
    dates.map(dayOfWeek),
  );
}

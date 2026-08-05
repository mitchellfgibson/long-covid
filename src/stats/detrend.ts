import { dayIndex, dayOfWeek, mean, type SeriesPoint } from "./series";
import { oneWayAnova } from "./fdist";

/** §3.1: both gates must clear before any weekly pattern is removed. */
export const DOW_MIN_OBS = 28;
export const DOW_ALPHA = 0.1;

export interface DetrendResult {
  /** What every downstream noise estimate uses. Same order as the input series. */
  residuals: number[];
  /** OLS slope in metric units per calendar day. Surface this: a drifting baseline is the top cause of spurious n=1 results. */
  slope: number;
  intercept: number;
  /** Weekday mean minus grand mean, index 0 = Sunday. Null when no weekly pattern was removed. */
  dowOffsets: number[] | null;
  /** p-value of the weekday F test, or null when there were too few observations to run it. */
  dowP: number | null;
  /** Why the weekday fit was or was not applied — the UI states this rather than staying silent. */
  dowReason: "applied" | "too_few_observations" | "no_weekly_pattern";
}

function olsSlope(values: number[], days: number[]): { slope: number; intercept: number } {
  const tbar = mean(days);
  const ybar = mean(values);
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < values.length; i++) {
    const dt = days[i]! - tbar;
    sxy += dt * (values[i]! - ybar);
    sxx += dt * dt;
  }
  const slope = sxx > 0 ? sxy / sxx : 0;
  return { slope, intercept: ybar - slope * tbar };
}

/**
 * §3.1. Subtract day-of-week means only when there are ≥ 28 observations and a
 * one-way F test across weekdays rejects at p < 0.10; then fit and subtract an OLS
 * linear trend on calendar day index.
 *
 * The weekday test runs on preliminary trend residuals rather than raw values: a
 * drifting baseline inflates within-weekday variance and would mask a real weekly
 * pattern, and with unevenly sampled weekdays the drift leaks into the weekday means
 * themselves. Offsets are centered so step 1 removes the weekly shape and nothing else.
 */
export function detrend(values: number[], days: number[], dows: number[]): DetrendResult {
  const n = values.length;
  if (n < 2) throw new Error("detrend needs at least 2 observations");
  if (days.length !== n || dows.length !== n) throw new Error("detrend: mismatched input lengths");

  let work = values.slice();
  let dowOffsets: number[] | null = null;
  let dowP: number | null = null;
  let dowReason: DetrendResult["dowReason"] = "too_few_observations";

  if (n >= DOW_MIN_OBS) {
    const prelim = olsSlope(values, days);
    const detrended = values.map((v, i) => v - (prelim.intercept + prelim.slope * days[i]!));
    const anova = oneWayAnova(detrended, dows, 7);
    dowP = anova.p;

    if (anova.p < DOW_ALPHA) {
      const sums = new Array<number>(7).fill(0);
      const counts = new Array<number>(7).fill(0);
      for (let i = 0; i < n; i++) {
        sums[dows[i]!]! += detrended[i]!;
        counts[dows[i]!]! += 1;
      }
      const grand = mean(detrended);
      dowOffsets = sums.map((s, k) => (counts[k]! > 0 ? s / counts[k]! - grand : 0));
      work = work.map((v, i) => v - dowOffsets![dows[i]!]!);
      dowReason = "applied";
    } else {
      dowReason = "no_weekly_pattern";
    }
  }

  const { slope, intercept } = olsSlope(work, days);
  const residuals = work.map((y, i) => y - (intercept + slope * days[i]!));

  return { residuals, slope, intercept, dowOffsets, dowP, dowReason };
}

export function detrendSeries(points: SeriesPoint[]): DetrendResult {
  const dates = points.map((p) => p.date);
  return detrend(
    points.map((p) => p.value),
    dayIndex(dates),
    dates.map(dayOfWeek),
  );
}

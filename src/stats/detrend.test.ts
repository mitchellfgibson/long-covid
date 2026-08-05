import { describe, expect, it } from "vitest";
import { detrendSeries, DOW_MIN_OBS } from "./detrend";
import { mean } from "./series";
import { dayOfWeek } from "./series";
import { gaussian, isoDates, mulberry32 } from "./testutil";

describe("§8.6 detrend", () => {
  it("recovers a known slope of 0.4/day and leaves zero-mean residuals", () => {
    const g = gaussian(mulberry32(424242));
    const dates = isoDates("2026-01-05", 70); // 10 full weeks
    const points = dates.map((date, i) => ({ date, value: 50 + 0.4 * i + 0.8 * g() }));

    const { residuals, slope } = detrendSeries(points);
    expect(Math.abs(slope - 0.4)).toBeLessThan(0.05);
    expect(Math.abs(mean(residuals))).toBeLessThan(1e-9);
  });

  it("skips the day-of-week fit below 28 observations", () => {
    const dates = isoDates("2026-01-05", 27);
    const points = dates.map((date, i) => ({ date, value: 10 + 0.2 * i }));
    const { dowOffsets, dowP, dowReason } = detrendSeries(points);
    expect(dowOffsets).toBeNull();
    expect(dowP).toBeNull();
    expect(dowReason).toBe("too_few_observations");
  });

  it("uses calendar day index, not row index, when days are missing", () => {
    // Slope 1.0/day with every other day absent: row-index fitting would report 2.0/day.
    const all = isoDates("2026-03-01", 20);
    const points = all.filter((_, i) => i % 2 === 0).map((date, i) => ({ date, value: 2 * i }));
    const { slope } = detrendSeries(points);
    expect(Math.abs(slope - 1)).toBeLessThan(1e-9);
  });
});

describe("item 5: the day-of-week fit is gated on an F test", () => {
  it("removes a real weekly pattern", () => {
    const g = gaussian(mulberry32(2468));
    const dates = isoDates("2026-01-05", 84); // 12 weeks
    // Weekends run 6 units higher than weekdays — a pattern worth removing.
    const points = dates.map((date) => {
      const d = dayOfWeek(date);
      const weekend = d === 0 || d === 6 ? 6 : 0;
      return { date, value: 50 + weekend + 1.0 * g() };
    });

    const { dowOffsets, dowP, dowReason } = detrendSeries(points);
    expect(dowReason).toBe("applied");
    expect(dowP!).toBeLessThan(0.1);
    expect(dowOffsets).not.toBeNull();
    // Sunday and Saturday carry the positive offsets.
    expect(dowOffsets![0]!).toBeGreaterThan(2);
    expect(dowOffsets![6]!).toBeGreaterThan(2);
    expect(dowOffsets![3]!).toBeLessThan(0);
  });

  it("leaves a pattern-free series alone rather than shrinking sigma", () => {
    const g = gaussian(mulberry32(13579));
    const dates = isoDates("2026-01-05", 84);
    const points = dates.map((date, i) => ({ date, value: 50 + 0.1 * i + 1.0 * g() }));

    const { dowOffsets, dowP, dowReason } = detrendSeries(points);
    expect(dowReason).toBe("no_weekly_pattern");
    expect(dowOffsets).toBeNull();
    expect(dowP!).toBeGreaterThanOrEqual(0.1);
  });

  it("28 observations is the floor, giving four per weekday", () => {
    expect(DOW_MIN_OBS).toBe(28);
    expect(DOW_MIN_OBS / 7).toBe(4);
  });

  it("an unconditional fit would always remove something: sigma must not shrink for free", () => {
    const g = gaussian(mulberry32(97531));
    const dates = isoDates("2026-01-05", 35);
    const points = dates.map((date) => ({ date, value: 50 + 1.0 * g() }));

    const { residuals, dowReason } = detrendSeries(points);
    // With no weekly pattern present the gate declines, so the residual spread is
    // the honest one rather than one shrunk by fitting six free parameters to noise.
    expect(dowReason).toBe("no_weekly_pattern");
    expect(residuals.length).toBe(35);
  });
});

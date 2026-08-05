import { describe, expect, it } from "vitest";
import { detrendSeries } from "./detrend";
import { mean } from "./series";
import { gaussian, isoDates, mulberry32 } from "./testutil";

describe("§8.6 detrend", () => {
  it("recovers a known slope of 0.4/day and leaves zero-mean residuals", () => {
    const g = gaussian(mulberry32(424242));
    const dates = isoDates("2026-01-05", 70); // 10 full weeks
    const points = dates.map((date, i) => ({ date, value: 50 + 0.4 * i + 0.8 * g() }));

    const { residuals, slope, dowOffsets } = detrendSeries(points);
    expect(Math.abs(slope - 0.4)).toBeLessThan(0.05);
    expect(Math.abs(mean(residuals))).toBeLessThan(1e-9);
    expect(dowOffsets).not.toBeNull(); // n >= 21, so the day-of-week fit ran
  });

  it("skips the day-of-week fit under 21 observations", () => {
    const dates = isoDates("2026-01-05", 14);
    const points = dates.map((date, i) => ({ date, value: 10 + 0.2 * i }));
    const { slope, dowOffsets } = detrendSeries(points);
    expect(dowOffsets).toBeNull();
    expect(Math.abs(slope - 0.2)).toBeLessThan(1e-9);
  });

  it("uses calendar day index, not row index, when days are missing", () => {
    // Slope 1.0/day with every other day absent: row-index fitting would report 2.0/day.
    const all = isoDates("2026-03-01", 20);
    const points = all.filter((_, i) => i % 2 === 0).map((date, i) => ({ date, value: 2 * i }));
    const { slope } = detrendSeries(points);
    expect(Math.abs(slope - 1)).toBeLessThan(1e-9);
  });
});

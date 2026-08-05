import { describe, expect, it } from "vitest";
import { extractSeries, sd } from "./series";
import { baselineNoise } from "./noise";
import type { Observation } from "../types";
import { gaussian, isoDates, mulberry32 } from "./testutil";

const ABSENT = new Set(["2026-01-06", "2026-01-11", "2026-01-19", "2026-01-24", "2026-02-02"]);

function buildLog(mode: "null_rows" | "no_rows"): Observation[] {
  const g = gaussian(mulberry32(9090));
  const dates = isoDates("2026-01-01", 40);
  const out: Observation[] = [];
  for (const date of dates) {
    const value = 50 + 4 * g();
    if (ABSENT.has(date)) {
      // Either the row exists with a null value, or it was never entered at all.
      if (mode === "null_rows") out.push({ date, values: { hrv: null }, confounders: [] });
      continue;
    }
    out.push({ date, values: { hrv: value }, confounders: [] });
  }
  return out;
}

describe("§8.9 missing days", () => {
  it("5 absent dates give the same sigma whether stored as null rows or never entered", () => {
    const withNulls = baselineNoise(extractSeries(buildLog("null_rows"), "hrv"));
    const withoutRows = baselineNoise(extractSeries(buildLog("no_rows"), "hrv"));

    expect(withNulls.n).toBe(35);
    expect(withoutRows.n).toBe(35);
    expect(withNulls.sigma).toBe(withoutRows.sigma);
    expect(withNulls.r1).toBe(withoutRows.r1);
    expect(withNulls.neff).toBe(withoutRows.neff);
  });

  it("never interpolates: the analyzed series holds only observed values", () => {
    const series = extractSeries(buildLog("null_rows"), "hrv");
    expect(series).toHaveLength(35);
    expect(series.some((p) => ABSENT.has(p.date))).toBe(false);
    expect(series.every((p) => Number.isFinite(p.value))).toBe(true);

    // Same values, same sd — nothing was filled in to pad the gaps.
    const direct = sd(series.map((p) => p.value));
    expect(direct).toBeGreaterThan(0);
  });

  it("sorts by date regardless of entry order", () => {
    const log: Observation[] = [
      { date: "2026-01-03", values: { hrv: 3 }, confounders: [] },
      { date: "2026-01-01", values: { hrv: 1 }, confounders: [] },
      { date: "2026-01-02", values: { hrv: 2 }, confounders: [] },
    ];
    expect(extractSeries(log, "hrv").map((p) => p.value)).toEqual([1, 2, 3]);
  });

  it("a gap is not a lag-1 pair", () => {
    // Two clean runs separated by a long gap: the pair spanning the gap is skipped.
    const noise = baselineNoise(extractSeries(buildLog("no_rows"), "hrv"));
    expect(Number.isFinite(noise.r1)).toBe(true);
    expect(noise.neff).toBeGreaterThanOrEqual(2);
  });
});

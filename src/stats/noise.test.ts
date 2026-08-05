import { describe, expect, it } from "vitest";
import { autocorrPerDay, lag1Autocorr, medianGap, nEff, nEffDetail, rAtSpacing } from "./noise";
import { ar1, gaussian, mulberry32 } from "./testutil";

describe("§8.1 autocorrelation recovery", () => {
  it("recovers r1 from AR(1) r=0.5 sigma=1 n=2000, and n_eff lands near n/3", () => {
    const xs = ar1(2000, 0.5, 1, 12345);
    const r1 = lag1Autocorr(xs);
    expect(r1).toBeGreaterThan(0.5 - 0.08);
    expect(r1).toBeLessThan(0.5 + 0.08);

    const ne = nEff(xs.length, r1); // complete daily series: spacing 1, so r_eff = r1
    const expected = 2000 / 3;
    expect(ne).toBeGreaterThan(expected * 0.9);
    expect(ne).toBeLessThan(expected * 1.1);
  });
});

describe("§8.2 white noise", () => {
  it("estimates r1 near zero and n_eff near n", () => {
    const g = gaussian(mulberry32(67890));
    const xs = Array.from({ length: 2000 }, () => g());
    const r1 = lag1Autocorr(xs);
    expect(Math.abs(r1)).toBeLessThan(0.06);

    const ne = nEff(xs.length, r1);
    expect(ne).toBeGreaterThan(2000 * 0.88);
    expect(ne).toBeLessThanOrEqual(2000);
  });
});

describe("n_eff formula edges", () => {
  it("negative r does not inflate n_eff beyond n", () => {
    expect(nEff(30, -0.4)).toBe(30);
  });

  it("is floored at 2, and says when the floor bound", () => {
    expect(nEffDetail(3, 0.95)).toEqual({ value: 2, floored: true });
    expect(nEffDetail(30, 0.2).floored).toBe(false);
  });
});

describe("gap handling in the estimator", () => {
  const days = (idx: number[]) => idx;

  it("normalizes numerator and denominator by their own counts", () => {
    // Numerator over m valid pairs, denominator over all n observations, would
    // deflate r1 by roughly m/n. Here half the pairs span a gap.
    const full = ar1(600, 0.5, 1, 4242);
    const dayIdx: number[] = [];
    const values: number[] = [];
    for (let i = 0; i < full.length; i++) {
      // Keep pairs of adjacent days, then skip a day: gap pattern 1,2,1,2,...
      if (i % 3 === 2) continue;
      dayIdx.push(i);
      values.push(full[i]!);
    }
    const ac = autocorrPerDay(values, dayIdx);
    expect(ac.method).toBe("lag1");
    // The old n-normalized form landed near 0.5 * (adjacent pairs / n) ~ 0.25.
    expect(ac.r1).toBeGreaterThan(0.40);
    expect(ac.r1).toBeLessThan(0.60);
  });

  it("refuses lag-1 below 10 valid adjacent pairs and falls through to a longer lag", () => {
    const xs = ar1(400, 0.5, 1, 55);
    const dayIdx = xs.map((_, i) => i * 2); // every other day: no adjacent pairs at all
    const ac = autocorrPerDay(xs, dayIdx);
    expect(ac.adjacentPairs).toBe(0);
    expect(ac.method).toBe("lag_k");
    expect(ac.lag).toBe(2);
  });

  it("reports insufficient rather than a confident zero when no lag has enough pairs", () => {
    const ac = autocorrPerDay([1, 5, 2, 8, 3], days([0, 40, 90, 150, 220]));
    expect(ac.method).toBe("insufficient");
    expect(ac.r1).toBe(0);
  });
});

describe("spacing", () => {
  it("median gap is 1 for a daily series and 2 for every-other-day", () => {
    expect(medianGap([0, 1, 2, 3, 4])).toBe(1);
    expect(medianGap([0, 2, 4, 6, 8])).toBe(2);
  });

  it("r between consecutive observations is r1^gap", () => {
    expect(rAtSpacing(0.5, 1)).toBeCloseTo(0.5, 12);
    expect(rAtSpacing(0.5, 2)).toBeCloseTo(0.25, 12);
    expect(rAtSpacing(-0.3, 2)).toBe(0);
  });
});

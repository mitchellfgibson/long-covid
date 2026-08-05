import { describe, expect, it } from "vitest";
import { fSurvival, lnGamma, oneWayAnova } from "./fdist";

describe("F distribution", () => {
  it("matches known log-gamma values", () => {
    expect(lnGamma(1)).toBeCloseTo(0, 10);
    expect(lnGamma(5)).toBeCloseTo(Math.log(24), 10);
    expect(lnGamma(0.5)).toBeCloseTo(Math.log(Math.sqrt(Math.PI)), 10);
  });

  it("matches the closed form available at d1 = 2", () => {
    // For d1 = 2, P(F > f) = (1 + 2f/d2)^(-d2/2) exactly.
    const closed = (f: number, d2: number) => (1 + (2 * f) / d2) ** (-d2 / 2);
    for (const [f, d2] of [
      [3, 10],
      [1, 4],
      [0.5, 30],
      [7.5, 6],
    ] as const) {
      expect(fSurvival(f, 2, d2)).toBeCloseTo(closed(f, d2), 10);
    }
  });

  it("matches the analytic value for F(1, 1)", () => {
    // I_{1/2}(1/2, 1/2) = 1/2.
    expect(fSurvival(1, 1, 1)).toBeCloseTo(0.5, 9);
  });

  it("matches values from independent numerical integration of the beta density", () => {
    expect(fSurvival(2.047, 6, 21)).toBeCloseTo(0.10405626039155, 10);
    expect(fSurvival(1.847, 6, 77)).toBeCloseTo(0.10094998307390, 10);
  });

  it("is monotone and bounded", () => {
    expect(fSurvival(0, 6, 20)).toBe(1);
    expect(fSurvival(1e6, 6, 20)).toBeLessThan(1e-6);
    expect(fSurvival(2, 6, 20)).toBeLessThan(fSurvival(1, 6, 20));
  });
});

describe("one-way ANOVA", () => {
  it("finds no effect when groups share a mean", () => {
    // Every group averages exactly 10, so the between-group sum of squares is zero.
    const values = [9, 11, 10, 10, 9, 11, 11, 10, 9, 10, 10, 10];
    const groups = values.map((_, i) => i % 3);
    const a = oneWayAnova(values, groups, 3);
    expect(a.f).toBeLessThan(1e-12);
    expect(a.p).toBeGreaterThan(0.99);
  });

  it("finds a strong effect when one group is shifted", () => {
    const values = [1, 1.1, 0.9, 1, 9, 9.1, 8.9, 9, 1, 1.1, 0.9, 1];
    const groups = [0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2];
    const a = oneWayAnova(values, groups, 3);
    expect(a.p).toBeLessThan(1e-6);
    expect(a.df1).toBe(2);
    expect(a.df2).toBe(9);
  });

  it("drops empty groups rather than counting them", () => {
    // Seven weekday slots but only three ever recorded.
    const values = [1, 2, 3, 4, 5, 6];
    const groups = [0, 0, 3, 3, 5, 5];
    const a = oneWayAnova(values, groups, 7);
    expect(a.groups).toBe(3);
    expect(a.df1).toBe(2);
    expect(a.df2).toBe(3);
  });
});

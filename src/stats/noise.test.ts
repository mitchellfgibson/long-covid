import { describe, expect, it } from "vitest";
import { lag1Autocorr, nEff } from "./noise";
import { ar1, gaussian, mulberry32 } from "./testutil";

describe("§8.1 autocorrelation recovery", () => {
  it("recovers r1 from AR(1) r=0.5 sigma=1 n=2000, and n_eff lands near n/3", () => {
    const xs = ar1(2000, 0.5, 1, 12345);
    const r1 = lag1Autocorr(xs);
    expect(r1).toBeGreaterThan(0.5 - 0.08);
    expect(r1).toBeLessThan(0.5 + 0.08);

    const ne = nEff(xs.length, r1);
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
  it("negative r1 does not inflate n_eff beyond n", () => {
    expect(nEff(30, -0.4)).toBe(30);
  });
  it("is floored at 2", () => {
    expect(nEff(3, 0.95)).toBe(2);
  });
});

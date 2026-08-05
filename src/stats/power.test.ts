import { describe, expect, it } from "vitest";
import { mde, powerVerdict, requiredDuration } from "./power";

describe("§8.3 MDE hand-check", () => {
  it("sigma=10, n1_eff=n2_eff=20 gives 2.80158 * 10 * sqrt(0.1) = 8.859", () => {
    expect(mde(10, 20, 20)).toBeCloseTo(2.80158 * 10 * Math.sqrt(0.1), 3);
    expect(Math.abs(mde(10, 20, 20) - 8.859)).toBeLessThan(1e-3);
  });
});

describe("§8.4 duration inversion", () => {
  it("feeding §3.4 output back into §3.3 returns the MCID within 1e-6", () => {
    const cases = [
      { mcid: 6, sigma: 8, n1Eff: 25, r1: 0.3 },
      { mcid: 4.5, sigma: 5, n1Eff: 18.2, r1: 0.45 },
      { mcid: 12, sigma: 10, n1Eff: 40, r1: 0 },
    ];
    for (const c of cases) {
      const dur = requiredDuration(c.mcid, c.sigma, c.n1Eff, c.r1);
      expect(dur.feasible).toBe(true);
      if (dur.feasible) {
        expect(Math.abs(mde(c.sigma, c.n1Eff, dur.n2Eff) - c.mcid)).toBeLessThan(1e-6);
      }
    }
  });
});

describe("§8.5 infeasibility", () => {
  it("mcid=1, sigma=10, n1_eff=20 reports infeasible with no negative or NaN duration", () => {
    const dur = requiredDuration(1, 10, 20, 0.3);
    expect(dur.feasible).toBe(false);
    if (!dur.feasible) {
      expect(Number.isFinite(dur.extraBaselineDays)).toBe(true);
      expect(dur.extraBaselineDays).toBeGreaterThan(0);
      expect(Number.isInteger(dur.extraBaselineDays)).toBe(true);
    }
  });

  it("the verdict surfaces the same infeasibility", () => {
    const v = powerVerdict({ sigma: 10, r1: 0.3, n1Eff: 20, plannedInterventionDays: 30, mcid: 1 });
    expect(v.state).toBe("infeasible");
    expect(Number.isFinite(v.mde)).toBe(true);
  });
});

describe("§3.5 verdict states", () => {
  it("adequate when MDE is at or under the MCID", () => {
    const v = powerVerdict({ sigma: 5, r1: 0, n1Eff: 30, plannedInterventionDays: 30, mcid: 10 });
    expect(v.state).toBe("adequate");
  });

  it("underpowered reports additional days that actually close the gap", () => {
    const v = powerVerdict({ sigma: 10, r1: 0.3, n1Eff: 25, plannedInterventionDays: 14, mcid: 9 });
    expect(v.state).toBe("underpowered");
    if (v.state === "underpowered") {
      expect(v.additionalDays).toBeGreaterThan(0);
      const again = powerVerdict({
        sigma: 10,
        r1: 0.3,
        n1Eff: 25,
        plannedInterventionDays: 14 + v.additionalDays,
        mcid: 9,
      });
      expect(again.state).toBe("adequate");
    }
  });
});

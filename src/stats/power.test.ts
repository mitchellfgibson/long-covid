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
      { mcid: 6, sigma: 8, n1Eff: 25, r1: 0.3, adherence: 1 },
      { mcid: 4.5, sigma: 5, n1Eff: 18.2, r1: 0.45, adherence: 1 },
      { mcid: 12, sigma: 10, n1Eff: 40, r1: 0, adherence: 1 },
      { mcid: 6, sigma: 8, n1Eff: 25, r1: 0.3, adherence: 3 / 7 }, // three days a week
      { mcid: 7, sigma: 9, n1Eff: 30, r1: 0.6, adherence: 0.5 },
    ];
    for (const c of cases) {
      const dur = requiredDuration(c);
      expect(dur.feasible).toBe(true);
      if (dur.feasible) {
        expect(Math.abs(mde(c.sigma, c.n1Eff, dur.n2Eff) - c.mcid)).toBeLessThan(1e-6);
      }
    }
  });
});

describe("item 3: duration is reported in the user's own calendar", () => {
  it("a three-day-a-week user is told weeks, not the observation count", () => {
    const daily = requiredDuration({ mcid: 6, sigma: 8, n1Eff: 25, r1: 0.3, adherence: 1 });
    const thrice = requiredDuration({ mcid: 6, sigma: 8, n1Eff: 25, r1: 0.3, adherence: 3 / 7 });
    expect(daily.feasible && thrice.feasible).toBe(true);
    if (!daily.feasible || !thrice.feasible) return;

    // Sparser sampling means each observation carries more independent information,
    // so fewer observations are needed — but they span far more calendar days.
    expect(thrice.n2Obs).toBeLessThan(daily.n2Obs);
    expect(thrice.n2Days).toBeGreaterThan(daily.n2Days);
    expect(thrice.n2Days).toBeCloseTo(thrice.n2Obs / (3 / 7), 6);
  });

  it("rejects an adherence rate outside (0, 1]", () => {
    const base = { mcid: 6, sigma: 8, n1Eff: 25, r1: 0.3 };
    expect(() => requiredDuration({ ...base, adherence: 0 })).toThrow();
    expect(() => requiredDuration({ ...base, adherence: 1.5 })).toThrow();
  });
});

describe("§8.5 infeasibility", () => {
  it("mcid=1, sigma=10, n1_eff=20 reports infeasible with no negative or NaN duration", () => {
    const dur = requiredDuration({ mcid: 1, sigma: 10, n1Eff: 20, r1: 0.3, adherence: 1 });
    expect(dur.feasible).toBe(false);
    if (!dur.feasible) {
      expect(Number.isFinite(dur.extraBaselineDays)).toBe(true);
      expect(dur.extraBaselineDays).toBeGreaterThan(0);
      expect(Number.isInteger(dur.extraBaselineDays)).toBe(true);
    }
  });

  it("the verdict surfaces the same infeasibility, and the MCID that would rescue it", () => {
    const v = powerVerdict({
      sigma: 10,
      r1: 0.3,
      n1Eff: 20,
      plannedInterventionDays: 30,
      mcid: 1,
      adherence: 1,
    });
    expect(v.state).toBe("infeasible");
    expect(Number.isFinite(v.mde)).toBe(true);
    if (v.state === "infeasible") {
      // item 9: users have two levers, and the second one is the MCID.
      expect(v.feasibleMcid).toBeCloseTo(v.mde, 12);
      const rescued = powerVerdict({
        sigma: 10,
        r1: 0.3,
        n1Eff: 20,
        plannedInterventionDays: 30,
        mcid: v.feasibleMcid,
        adherence: 1,
      });
      expect(rescued.state).toBe("adequate");
    }
  });
});

describe("§3.5 verdict states", () => {
  it("adequate when MDE is at or under the MCID", () => {
    const v = powerVerdict({
      sigma: 5,
      r1: 0,
      n1Eff: 30,
      plannedInterventionDays: 30,
      mcid: 10,
      adherence: 1,
    });
    expect(v.state).toBe("adequate");
  });

  it("underpowered reports additional days that actually close the gap", () => {
    const base = { sigma: 10, r1: 0.3, n1Eff: 25, mcid: 9, adherence: 1 };
    const v = powerVerdict({ ...base, plannedInterventionDays: 14 });
    expect(v.state).toBe("underpowered");
    if (v.state === "underpowered") {
      expect(v.additionalDays).toBeGreaterThan(0);
      const again = powerVerdict({
        ...base,
        plannedInterventionDays: 14 + v.additionalDays,
      });
      expect(again.state).toBe("adequate");
    }
  });

  it("item 9: flags when the n_eff floor bound instead of clamping silently", () => {
    const v = powerVerdict({
      sigma: 10,
      r1: 0.95,
      n1Eff: 20,
      plannedInterventionDays: 3,
      mcid: 5,
      adherence: 1,
    });
    expect(v.n2Floored).toBe(true);
    expect(v.plannedN2Eff).toBe(2);
  });
});

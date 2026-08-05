import { describe, expect, it } from "vitest";
import { runAnalysis, runSensitivity, lookStatus } from "./analysis";
import { tCritical, tTwoSided } from "./fdist";
import { makeProtocol } from "./fixtures";
import type { DoseRecord, Observation } from "../types";
import { gaussian, isoDates, mulberry32 } from "./testutil";

const protocol = makeProtocol({
  intervention: {
    name: "Test",
    dose: "1",
    schedule: "daily",
    onsetLagDays: 0,
    washoutDays: 0,
  },
  design: "AB",
  mcid: 3,
  phases: [
    { phase: "baseline", startDate: "2026-01-01", endDate: "2026-01-30" },
    { phase: "intervention", startDate: "2026-01-31", endDate: "2026-03-01" },
  ],
});

function build(shiftB: number, seed = 4242, noise = 2): Observation[] {
  const g = gaussian(mulberry32(seed));
  const dates = isoDates("2026-01-01", 60);
  return dates.map((date, i) => ({
    date,
    values: { hrv: 50 + (i >= 30 ? shiftB : 0) + noise * g() },
    confounders: [],
  }));
}

describe("t distribution", () => {
  it("matches known critical values", () => {
    // Two-sided 95% critical values: t(10) = 2.228, t(30) = 2.042, t(inf) -> 1.960.
    expect(tCritical(0.95, 10)).toBeCloseTo(2.228, 3);
    expect(tCritical(0.95, 30)).toBeCloseTo(2.042, 3);
    expect(tCritical(0.95, 100000)).toBeCloseTo(1.95996, 4);
  });

  it("round-trips against the two-sided p-value", () => {
    for (const df of [3, 12, 47.3]) {
      expect(tTwoSided(tCritical(0.95, df), df)).toBeCloseTo(0.05, 9);
    }
  });
});

describe("§5.2 phase-means test", () => {
  it("recovers a known shift inside its confidence interval", () => {
    const r = runAnalysis({ protocol, observations: build(6), metricId: "hrv" });
    expect(r.diff).toBeGreaterThan(4.5);
    expect(r.diff).toBeLessThan(7.5);
    expect(r.ciLow).toBeLessThan(6);
    expect(r.ciHigh).toBeGreaterThan(6);
  });

  it("uses effective counts, not raw n, in the standard error", () => {
    const r = runAnalysis({ protocol, observations: build(6), metricId: "hrv" });
    expect(r.a.neff).toBeLessThanOrEqual(r.a.n);
    expect(r.b.neff).toBeLessThanOrEqual(r.b.n);
    // A Welch SE on raw n would be smaller; the effective-count SE must exceed it.
    const naive = Math.sqrt(r.a.sigma ** 2 / r.a.n + r.b.sigma ** 2 / r.b.n);
    expect(r.se).toBeGreaterThanOrEqual(naive);
  });

  it("states the verdict against the MCID, not against zero", () => {
    // A 6-unit shift against a 3-unit threshold, with tight noise: clears it.
    const clears = runAnalysis({ protocol, observations: build(6, 11, 1), metricId: "hrv" });
    expect(clears.verdict).toBe("clears_threshold");
    expect(clears.ciLow).toBeGreaterThanOrEqual(protocol.mcid);

    // A real but small effect: distinguishable from zero, still under the threshold.
    const small = runAnalysis({ protocol, observations: build(0.5, 11, 1), metricId: "hrv" });
    expect(small.verdict).toBe("below_threshold");

    // Noisy: the interval spans the threshold, so neither claim is supported.
    const unclear = runAnalysis({ protocol, observations: build(3, 11, 6), metricId: "hrv" });
    expect(unclear.verdict).toBe("inconclusive");
  });

  it("reads the direction of benefit from the metric", () => {
    const obs = build(-6, 11, 1); // a fall of 6 units
    const higher = runAnalysis({
      protocol,
      observations: obs,
      metricId: "hrv",
      direction: "higher_is_better",
    });
    const lower = runAnalysis({
      protocol,
      observations: obs,
      metricId: "hrv",
      direction: "lower_is_better",
    });
    expect(higher.favourable).toBe(false);
    expect(lower.favourable).toBe(true);
    expect(lower.verdict).toBe("clears_threshold");
    expect(higher.verdict).toBe("below_threshold");
  });

  it("pools the A phases for an ABA design", () => {
    const aba = makeProtocol({
      intervention: { name: "T", dose: "1", schedule: "daily", onsetLagDays: 0, washoutDays: 0 },
      design: "ABA",
      mcid: 3,
      phases: [
        { phase: "baseline", startDate: "2026-01-01", endDate: "2026-01-20" },
        { phase: "intervention", startDate: "2026-01-21", endDate: "2026-02-09" },
        { phase: "withdrawal", startDate: "2026-02-10", endDate: "2026-03-01" },
      ],
    });
    const g = gaussian(mulberry32(99));
    const obs = isoDates("2026-01-01", 60).map((date, i) => ({
      date,
      values: { hrv: 50 + (i >= 20 && i < 40 ? 5 : 0) + g() },
      confounders: [],
    }));
    const r = runAnalysis({ protocol: aba, observations: obs, metricId: "hrv" });
    expect(r.a.n).toBe(40); // both off-treatment phases
    expect(r.b.n).toBe(20);
  });
});

describe("§5 exploratory labelling", () => {
  it("is not exploratory once the final phase has ended", () => {
    expect(lookStatus(protocol, "2026-03-01").exploratory).toBe(false);
    expect(lookStatus(protocol, "2026-04-01").exploratory).toBe(false);
  });

  it("labels a mid-experiment look exploratory, with a reason", () => {
    const s = lookStatus(protocol, "2026-02-10");
    expect(s.exploratory).toBe(true);
    expect(s.reason).toContain("2026-03-01");
  });

  it("permits a look on the pre-registered gate date", () => {
    const gated = makeProtocol({
      ...protocol,
      stoppingRule: { kind: "futility", date: "2026-02-10", condition: "generated" },
    });
    expect(lookStatus(gated, "2026-02-10").exploratory).toBe(false);
    expect(lookStatus(gated, "2026-02-11").exploratory).toBe(true);
  });

  it("carries the flag into the result", () => {
    const r = runAnalysis({
      protocol,
      observations: build(6),
      metricId: "hrv",
      today: "2026-02-10",
    });
    expect(r.exploratory).toBe(true);
    expect(r.exploratoryReason).toBeTruthy();
  });
});

describe("§5.3 sensitivity", () => {
  it("drops confounder-flagged days and reports whether the verdict moved", () => {
    const obs = build(6, 11, 1).map((o, i) =>
      i % 10 === 0 ? { ...o, confounders: ["illness"] } : o,
    );
    const s = runSensitivity({ protocol, observations: obs, metricId: "hrv" });
    expect(s.droppedDates).toHaveLength(6);
    expect(s.clean.a.n + s.clean.b.n).toBe(54);
    expect(s.all.a.n + s.all.b.n).toBe(60);
    expect(s.disagrees).toBe(false);
  });

  it("says so when the two runs disagree", () => {
    // Confounded days carry the entire apparent effect.
    const g = gaussian(mulberry32(7));
    const obs: Observation[] = isoDates("2026-01-01", 60).map((date, i) => {
      const spike = i >= 30 && i % 2 === 0;
      return {
        date,
        values: { hrv: 50 + (spike ? 12 : 0) + 0.5 * g() },
        confounders: spike ? ["alcohol"] : [],
      };
    });
    const s = runSensitivity({ protocol, observations: obs, metricId: "hrv" });
    expect(s.all.verdict).toBe("clears_threshold");
    expect(s.clean.verdict).toBe("below_threshold");
    expect(s.disagrees).toBe(true);
  });
});

describe("item 8: onset lag anchors to first dose", () => {
  const lagged = makeProtocol({
    intervention: { name: "T", dose: "1", schedule: "daily", onsetLagDays: 3, washoutDays: 0 },
    design: "AB",
    mcid: 3,
    phases: [
      { phase: "baseline", startDate: "2026-01-01", endDate: "2026-01-30" },
      { phase: "intervention", startDate: "2026-01-31", endDate: "2026-03-01" },
    ],
  });

  it("counts the window from the phase start when there is no dose log", () => {
    const r = runAnalysis({ protocol: lagged, observations: build(6), metricId: "hrv" });
    expect(r.excludedDates).toEqual(["2026-01-31", "2026-02-01", "2026-02-02"]);
  });

  it("counts from the first dose taken, and excludes the pre-dose days too", () => {
    // The first two doses were missed; the drug starts on 2026-02-02.
    const doses: DoseRecord[] = [
      { date: "2026-01-31", taken: false },
      { date: "2026-02-01", taken: false },
      { date: "2026-02-02", taken: true },
    ];
    const r = runAnalysis({ protocol: lagged, observations: build(6), doses, metricId: "hrv" });
    expect(r.excludedDates).toEqual([
      "2026-01-31",
      "2026-02-01",
      "2026-02-02",
      "2026-02-03",
      "2026-02-04",
    ]);
    // The pre-fix behaviour kept 2026-02-03 and 2026-02-04 in the B mean despite
    // the drug having been on board for under a day.
    expect(r.excludedDates).toContain("2026-02-04");
  });
});

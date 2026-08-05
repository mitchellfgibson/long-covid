import { describe, expect, it } from "vitest";
import { analysisDates, assignPhases, onsetLagWarnings } from "./phases";
import { MISSED_DOSE } from "../confounders";
import type { Observation, ProtocolPhase } from "../types";
import { isoDates } from "./testutil";

const phases: ProtocolPhase[] = [
  { phase: "baseline", startDate: "2026-01-01", endDate: "2026-01-28" },
  { phase: "intervention", startDate: "2026-01-29", endDate: "2026-02-27" }, // 30 days
];

describe("§8.8 phase exclusion", () => {
  it("onsetLag=3 on a 30-day intervention phase leaves 27 analyzed and 3 flagged", () => {
    const dates = isoDates("2026-01-29", 30);
    const assigned = assignPhases(dates, phases, 3, 0);

    const excluded = assigned.filter((d) => d.excluded);
    const kept = assigned.filter((d) => d.phase === "intervention" && !d.excluded);

    expect(excluded).toHaveLength(3);
    expect(kept).toHaveLength(27);
    expect(excluded.map((d) => d.date)).toEqual(["2026-01-29", "2026-01-30", "2026-01-31"]);
    expect(excluded.every((d) => d.exclusionReason === "onset_lag")).toBe(true);
  });

  it("keeps excluded days in the assignment rather than deleting them", () => {
    const dates = isoDates("2026-01-29", 30);
    const assigned = assignPhases(dates, phases, 3, 0);
    expect(assigned).toHaveLength(30);
    expect(assigned.every((d) => d.phase === "intervention")).toBe(true);
  });

  it("counts the exclusion window in calendar days, so absent rows do not shift it", () => {
    // Days 1 and 2 of the intervention phase were never entered.
    const dates = isoDates("2026-01-29", 30).filter(
      (d) => d !== "2026-01-30" && d !== "2026-01-31",
    );
    const assigned = assignPhases(dates, phases, 3, 0);
    const kept = analysisDates(assigned).intervention;

    expect(assigned.filter((d) => d.excluded)).toHaveLength(1); // only 2026-01-29 was observed
    expect(kept).toHaveLength(27);
    expect(kept[0]).toBe("2026-02-01"); // not 2026-02-03
  });

  it("flags washout days at the start of a withdrawal phase", () => {
    const withWithdrawal: ProtocolPhase[] = [
      ...phases,
      { phase: "withdrawal", startDate: "2026-02-28", endDate: "2026-03-20" },
    ];
    const dates = isoDates("2026-02-28", 21);
    const assigned = assignPhases(dates, withWithdrawal, 3, 5);
    expect(assigned.filter((d) => d.excluded)).toHaveLength(5);
    expect(assigned.filter((d) => d.excluded).every((d) => d.exclusionReason === "washout")).toBe(
      true,
    );
    expect(analysisDates(assigned).withdrawal).toHaveLength(16);
  });

  it("leaves dates outside every declared phase unassigned", () => {
    const assigned = assignPhases(["2025-12-31", "2026-01-01"], phases, 0, 0);
    expect(assigned[0]!.phase).toBeNull();
    expect(assigned[1]!.phase).toBe("baseline");
  });
});

describe("item 8: onset lag versus first dose", () => {
  const obs = (date: string, confounders: string[] = []): Observation => ({
    date,
    values: { hrv: 50 },
    confounders,
  });

  it("warns when a missed dose falls inside the onset window", () => {
    const log = [
      obs("2026-01-29", [MISSED_DOSE]),
      obs("2026-01-30", [MISSED_DOSE]),
      obs("2026-01-31"),
      obs("2026-02-01"),
    ];
    const warnings = onsetLagWarnings(log, phases, 3);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toEqual({
      date: "2026-01-29",
      phaseIndex: 1,
      dayOfPhase: 1,
      onsetLagDays: 3,
    });
    expect(warnings[1]!.dayOfPhase).toBe(2);
  });

  it("stays quiet when doses inside the window were taken", () => {
    const log = [obs("2026-01-29"), obs("2026-01-30"), obs("2026-01-31")];
    expect(onsetLagWarnings(log, phases, 3)).toEqual([]);
  });

  it("ignores missed doses after the onset window has closed", () => {
    // Day 4 of the phase: the drug was already on board, so this is a sensitivity
    // concern (§5.3), not an onset-anchoring problem.
    const log = [obs("2026-02-01", [MISSED_DOSE])];
    expect(onsetLagWarnings(log, phases, 3)).toEqual([]);
  });

  it("ignores missed doses outside the intervention phase", () => {
    const log = [obs("2026-01-02", [MISSED_DOSE])];
    expect(onsetLagWarnings(log, phases, 3)).toEqual([]);
  });

  it("has nothing to warn about when there is no onset lag", () => {
    const log = [obs("2026-01-29", [MISSED_DOSE])];
    expect(onsetLagWarnings(log, phases, 0)).toEqual([]);
  });
});

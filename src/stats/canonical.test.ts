import { describe, expect, it } from "vitest";
import { canonicalJson, hashProtocol } from "./canonical";
import type { Protocol } from "../types";

function makeProtocol(mcid: number): Protocol {
  return {
    title: "Magnesium and sleep",
    intervention: {
      name: "Magnesium glycinate",
      dose: "200 mg",
      schedule: "nightly",
      onsetLagDays: 3,
      washoutDays: 5,
    },
    design: "ABA",
    primaryMetricId: "hrv",
    secondaryMetricIds: ["rhr"],
    mcid,
    mcidRationale: "Half of my observed seasonal swing in HRV.",
    phases: [
      { phase: "baseline", startDate: "2026-01-01", endDate: "2026-01-28" },
      { phase: "intervention", startDate: "2026-01-29", endDate: "2026-02-25" },
      { phase: "withdrawal", startDate: "2026-02-26", endDate: "2026-03-25" },
    ],
    stoppingRule: { kind: "none" },
    analysisPlan: "phase_means_neff",
  };
}

/** Same values as makeProtocol, keys inserted in a scrambled order. */
function scrambledProtocol(mcid: number): Protocol {
  const p = {
    analysisPlan: "phase_means_neff",
    stoppingRule: { kind: "none" },
    phases: [
      { endDate: "2026-01-28", startDate: "2026-01-01", phase: "baseline" },
      { endDate: "2026-02-25", startDate: "2026-01-29", phase: "intervention" },
      { endDate: "2026-03-25", startDate: "2026-02-26", phase: "withdrawal" },
    ],
    mcidRationale: "Half of my observed seasonal swing in HRV.",
    mcid,
    secondaryMetricIds: ["rhr"],
    primaryMetricId: "hrv",
    design: "ABA",
    intervention: {
      washoutDays: 5,
      onsetLagDays: 3,
      schedule: "nightly",
      dose: "200 mg",
      name: "Magnesium glycinate",
    },
    title: "Magnesium and sleep",
  };
  return p as unknown as Protocol;
}

describe("§8.7 hash canonicalization", () => {
  it("identical values with different key insertion order hash the same", async () => {
    const a = await hashProtocol(makeProtocol(5));
    const b = await hashProtocol(scrambledProtocol(5));
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changing one MCID digit changes the hash", async () => {
    const a = await hashProtocol(makeProtocol(5));
    const b = await hashProtocol(makeProtocol(5.1));
    expect(a).not.toBe(b);
  });

  it("canonical form has sorted keys and no whitespace", () => {
    const json = canonicalJson({ b: 1, a: [1, 2], c: { z: true, y: "s" } });
    expect(json).toBe('{"a":[1,2],"b":1,"c":{"y":"s","z":true}}');
  });

  it("refuses non-finite numbers instead of hashing null", () => {
    expect(() => canonicalJson({ mcid: NaN })).toThrow();
    expect(() => canonicalJson({ mcid: Infinity })).toThrow();
  });
});

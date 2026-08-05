import type { Protocol } from "../types";
import { SPEC_VERSION } from "./version";

/** A complete, valid protocol. Tests vary one field at a time from here. */
export function makeProtocol(overrides: Partial<Protocol> = {}): Protocol {
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
    mcid: 5,
    mcidRationale: "Half of my observed seasonal swing in HRV.",
    phases: [
      { phase: "baseline", startDate: "2026-01-01", endDate: "2026-01-28" },
      { phase: "intervention", startDate: "2026-01-29", endDate: "2026-02-25" },
      { phase: "withdrawal", startDate: "2026-02-26", endDate: "2026-03-25" },
    ],
    stoppingRule: { kind: "none" },
    analysisPlan: "phase_means_neff",
    specVersion: SPEC_VERSION,
    acknowledgments: { underpowered: false, efficacyGate: false },
    ...overrides,
  };
}

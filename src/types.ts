export type Phase = "baseline" | "intervention" | "withdrawal";

export interface Observation {
  date: string; // ISO yyyy-mm-dd
  values: Record<string, number | null>; // metricId -> value
  confounders: string[]; // ids from the confounder list
  note?: string;
}

/**
 * §5.1. One record per day the user says something about dosing. An absent date
 * means "unknown", never "not taken" — the same rule observations follow. Recorded
 * separately from Observation because a missed dose and a missed reading are
 * different events with different consequences.
 */
export interface DoseRecord {
  date: string; // ISO yyyy-mm-dd
  taken: boolean;
}

export interface Metric {
  id: string;
  label: string; // "HRV"
  unit: string; // "ms"
  direction: "higher_is_better" | "lower_is_better";
}

export interface ProtocolPhase {
  phase: Phase;
  startDate: string;
  endDate: string;
}

export interface Protocol {
  title: string;
  intervention: {
    name: string;
    dose: string; // free text, never validated or suggested
    schedule: string; // free text, e.g. "Mon/Wed/Fri"
    onsetLagDays: number; // days after start of B excluded from analysis
    washoutDays: number; // days after end of B excluded from analysis
  };
  design: "AB" | "ABA" | "ABAB";
  primaryMetricId: string;
  secondaryMetricIds: string[];
  mcid: number; // minimum clinically important difference, in metric units
  mcidRationale: string; // required, min 20 chars
  phases: ProtocolPhase[];
  stoppingRule: StoppingRule;
  analysisPlan: "phase_means_neff"; // only option in v1; exists so the hash covers it
  specVersion: string; // §5.5. Inside the hashed object, so the lock covers it.
  /**
   * §3.5 and §4.4 both require the user's acknowledgment to be recorded *in the
   * protocol*, so both live inside the hash. Always present, never optional, so
   * the canonical form is deterministic.
   */
  acknowledgments: {
    underpowered: boolean; // proceeded knowing the design is underpowered (§3.5)
    efficacyGate: boolean; // accepted the type I error cost of an efficacy gate (§4.4)
  };
}

export type StoppingRule =
  | { kind: "none" }
  | { kind: "futility"; date: string; condition: string }
  | { kind: "efficacy"; date: string; condition: string };

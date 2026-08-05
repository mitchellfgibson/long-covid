export type Phase = "baseline" | "intervention" | "withdrawal";

export interface Observation {
  date: string; // ISO yyyy-mm-dd
  values: Record<string, number | null>; // metricId -> value
  confounders: string[]; // ids from the confounder list
  note?: string;
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
}

export type StoppingRule =
  | { kind: "none" }
  | { kind: "futility"; date: string; condition: string }
  | { kind: "efficacy"; date: string; condition: string };

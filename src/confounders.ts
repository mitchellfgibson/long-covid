/** §2. The fixed starting list. Users extend it; these ids are stable. */
export const DEFAULT_CONFOUNDERS = [
  { id: "illness", label: "illness" },
  { id: "travel", label: "travel" },
  { id: "alcohol", label: "alcohol" },
  { id: "poor_sleep", label: "poor sleep" },
  { id: "hard_workout", label: "hard workout" },
  { id: "unusual_stress", label: "unusual stress" },
  { id: "missed_dose", label: "missed dose" },
  { id: "other", label: "other" },
] as const;

/** Distinguished because it bears on the onset-lag window, not just sensitivity (§5.1). */
export const MISSED_DOSE = "missed_dose";

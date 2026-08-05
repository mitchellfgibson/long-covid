import type { StoppingRule } from "../types";

/**
 * §4.4. The condition text is generated from structured input, never typed by the
 * user. Keeping it generated means the locked sentence and the rule the analysis
 * enforces cannot drift apart.
 */
export function futilityCondition(date: string, threshold: number, unit: string): string {
  const u = unit ? ` ${unit}` : "";
  return `On ${date}, stop for futility if the observed difference between phases is smaller than ${threshold}${u}.`;
}

export function efficacyCondition(date: string, threshold: number, unit: string): string {
  const u = unit ? ` ${unit}` : "";
  return `On ${date}, stop early and declare success if the observed difference between phases exceeds ${threshold}${u}.`;
}

export function buildStoppingRule(
  kind: StoppingRule["kind"],
  date: string,
  threshold: number,
  unit: string,
): StoppingRule {
  if (kind === "none") return { kind: "none" };
  if (kind === "futility") return { kind, date, condition: futilityCondition(date, threshold, unit) };
  return { kind, date, condition: efficacyCondition(date, threshold, unit) };
}

/** §4.4: futility gates pre-fill at half the MCID. */
export const defaultFutilityThreshold = (mcid: number) => Number((mcid / 2).toFixed(4));

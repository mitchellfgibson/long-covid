import type { Phase, ProtocolPhase } from "../types";
import { daysBetween } from "./series";

export type ExclusionReason = "onset_lag" | "washout";

export interface PhaseDay {
  date: string;
  phase: Phase | null; // null: outside every declared phase
  phaseIndex: number | null; // index into the protocol's phases array
  excluded: boolean; // excluded days are flagged, never deleted (§5.1)
  exclusionReason?: ExclusionReason;
}

/**
 * §5.1. Assign each observed date to its protocol phase and flag exclusions:
 * the first onsetLagDays calendar days of each intervention phase, and the first
 * washoutDays calendar days of each withdrawal phase. Offsets are calendar days
 * from the phase start, so missing rows never shift the exclusion window.
 */
export function assignPhases(
  dates: string[],
  phases: ProtocolPhase[],
  onsetLagDays: number,
  washoutDays: number,
): PhaseDay[] {
  if (onsetLagDays < 0 || washoutDays < 0) throw new Error("exclusion windows cannot be negative");
  return dates.map((date) => {
    for (let i = 0; i < phases.length; i++) {
      const p = phases[i]!;
      const fromStart = daysBetween(p.startDate, date);
      const toEnd = daysBetween(date, p.endDate);
      if (fromStart < 0 || toEnd < 0) continue; // outside [start, end]
      if (p.phase === "intervention" && fromStart < onsetLagDays) {
        return { date, phase: p.phase, phaseIndex: i, excluded: true, exclusionReason: "onset_lag" as const };
      }
      if (p.phase === "withdrawal" && fromStart < washoutDays) {
        return { date, phase: p.phase, phaseIndex: i, excluded: true, exclusionReason: "washout" as const };
      }
      return { date, phase: p.phase, phaseIndex: i, excluded: false };
    }
    return { date, phase: null, phaseIndex: null, excluded: false };
  });
}

/** Dates that survive exclusion, per phase kind. A phases (baseline + withdrawal) pool downstream (§5.1). */
export function analysisDates(assignment: PhaseDay[]): Record<Phase, string[]> {
  const out: Record<Phase, string[]> = { baseline: [], intervention: [], withdrawal: [] };
  for (const day of assignment) {
    if (day.phase !== null && !day.excluded) out[day.phase].push(day.date);
  }
  return out;
}

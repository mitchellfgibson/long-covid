import type { DoseRecord, Observation, Phase, ProtocolPhase } from "../types";
import { MISSED_DOSE } from "../confounders";
import { daysBetween, utcMs } from "./series";

export type ExclusionReason = "onset_lag" | "washout";

export interface PhaseDay {
  date: string;
  phase: Phase | null; // null: outside every declared phase
  phaseIndex: number | null; // index into the protocol's phases array
  excluded: boolean; // excluded days are flagged, never deleted (§5.1)
  exclusionReason?: ExclusionReason;
}

/**
 * §5.1. The date the onset window starts counting from: the first dose actually
 * taken inside the phase, not the phase start date. Returns null when no dose was
 * recorded as taken, in which case the caller falls back to the phase start and
 * `onsetLagWarnings` flags the assumption.
 */
export function firstDoseDate(doses: DoseRecord[], phase: ProtocolPhase): string | null {
  let earliest: string | null = null;
  for (const d of doses) {
    if (!d.taken) continue;
    if (daysBetween(phase.startDate, d.date) < 0) continue;
    if (daysBetween(d.date, phase.endDate) < 0) continue;
    if (earliest === null || utcMs(d.date) < utcMs(earliest)) earliest = d.date;
  }
  return earliest;
}

/**
 * §5.1. Assign each observed date to its protocol phase and flag exclusions:
 * the onset window at the start of each intervention phase, and the first
 * washoutDays calendar days of each withdrawal phase. Offsets are calendar days,
 * so missing rows never shift a window.
 *
 * The onset window is anchored to the first dose taken, because the
 * pharmacological clock starts when the drug does. With no dose log it falls back
 * to the phase start date, which is the old behaviour.
 */
export function assignPhases(
  dates: string[],
  phases: ProtocolPhase[],
  onsetLagDays: number,
  washoutDays: number,
  doses: DoseRecord[] = [],
): PhaseDay[] {
  if (onsetLagDays < 0 || washoutDays < 0) throw new Error("exclusion windows cannot be negative");

  const onsetAnchor = phases.map((p) =>
    p.phase === "intervention" ? (firstDoseDate(doses, p) ?? p.startDate) : p.startDate,
  );

  return dates.map((date) => {
    for (let i = 0; i < phases.length; i++) {
      const p = phases[i]!;
      const fromStart = daysBetween(p.startDate, date);
      const toEnd = daysBetween(date, p.endDate);
      if (fromStart < 0 || toEnd < 0) continue; // outside [start, end]

      if (p.phase === "intervention") {
        const fromDose = daysBetween(onsetAnchor[i]!, date);
        // Days before the first dose are pre-treatment and excluded too: the
        // intervention was not on board, so they cannot inform the B mean.
        if (fromDose < onsetLagDays) {
          return {
            date,
            phase: p.phase,
            phaseIndex: i,
            excluded: true,
            exclusionReason: "onset_lag" as const,
          };
        }
      }
      if (p.phase === "withdrawal" && fromStart < washoutDays) {
        return {
          date,
          phase: p.phase,
          phaseIndex: i,
          excluded: true,
          exclusionReason: "washout" as const,
        };
      }
      return { date, phase: p.phase, phaseIndex: i, excluded: false };
    }
    return { date, phase: null, phaseIndex: null, excluded: false };
  });
}

export interface OnsetLagWarning {
  date: string;
  phaseIndex: number;
  /** 1-based calendar day within the intervention phase. */
  dayOfPhase: number;
  onsetLagDays: number;
}

/**
 * The onset window is anchored to the phase start date, but the pharmacological
 * clock starts at the first dose. A missed-dose flag inside that window means the
 * window expired before the intervention was actually on board, so the days it was
 * meant to protect are still in the analysis set.
 *
 * Anchoring properly requires a dose log, which the domain model does not yet carry;
 * until it does, this reports the days where the assumption is known to be violated
 * rather than letting them pass silently.
 */
export function onsetLagWarnings(
  observations: Observation[],
  phases: ProtocolPhase[],
  onsetLagDays: number,
): OnsetLagWarning[] {
  if (onsetLagDays <= 0) return [];
  const warnings: OnsetLagWarning[] = [];

  for (const obs of observations) {
    if (!obs.confounders.includes(MISSED_DOSE)) continue;
    for (let i = 0; i < phases.length; i++) {
      const p = phases[i]!;
      if (p.phase !== "intervention") continue;
      const fromStart = daysBetween(p.startDate, obs.date);
      if (fromStart < 0 || fromStart >= onsetLagDays) continue;
      warnings.push({
        date: obs.date,
        phaseIndex: i,
        dayOfPhase: fromStart + 1,
        onsetLagDays,
      });
    }
  }
  return warnings;
}

/** Dates that survive exclusion, per phase kind. A phases (baseline + withdrawal) pool downstream (§5.1). */
export function analysisDates(assignment: PhaseDay[]): Record<Phase, string[]> {
  const out: Record<Phase, string[]> = { baseline: [], intervention: [], withdrawal: [] };
  for (const day of assignment) {
    if (day.phase !== null && !day.excluded) out[day.phase].push(day.date);
  }
  return out;
}

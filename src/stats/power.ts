import { nEffDetail, rAtSpacing } from "./noise";

// Two-sided alpha 0.05, power 0.80 (§3.3).
export const Z_ALPHA = 1.95996;
export const Z_BETA = 0.84162;
export const Z_TOTAL = 2.80158;

/** §3.3. Minimum detectable effect, in metric units. Effective counts only, never raw n. */
export function mde(sigma: number, n1Eff: number, n2Eff: number): number {
  if (sigma <= 0) throw new Error("mde: sigma must be positive");
  if (n1Eff <= 0 || n2Eff <= 0) throw new Error("mde: effective counts must be positive");
  return Z_TOTAL * sigma * Math.sqrt(1 / n1Eff + 1 / n2Eff);
}

function checkAdherence(adherence: number): void {
  if (!Number.isFinite(adherence) || adherence <= 0 || adherence > 1) {
    throw new Error("adherence must be observations per calendar day in (0, 1]");
  }
}

/** Planned calendar days -> effective observations, via the adherence rate and the per-day r1. */
export function effFromCalendarDays(days: number, r1: number, adherence: number): number {
  checkAdherence(adherence);
  const rEff = rAtSpacing(r1, 1 / adherence);
  return nEffDetail(days * adherence, rEff).value;
}

export interface DurationInput {
  mcid: number;
  sigma: number;
  n1Eff: number;
  r1: number; // per calendar day
  adherence: number; // planned observations per calendar day
}

export type DurationResult =
  | { feasible: true; n2Eff: number; n2Obs: number; n2Days: number }
  | { feasible: false; extraBaselineObs: number; extraBaselineDays: number };

/**
 * §3.4. Intervention length at which MDE equals the declared MCID.
 *
 * Solves for effective count, converts that to *observations* at the planned
 * spacing, and only then to calendar days via the declared adherence rate. A
 * three-day-a-week user needs to hear fourteen weeks, not forty-two days.
 *
 * When infeasible (the baseline alone caps precision below the MCID), reports the
 * fewest extra whole baseline days that make a finite intervention length exist —
 * never a negative or NaN duration.
 */
export function requiredDuration(input: DurationInput): DurationResult {
  const { mcid, sigma, n1Eff, r1, adherence } = input;
  if (mcid <= 0) throw new Error("requiredDuration: mcid must be positive");
  if (sigma <= 0) throw new Error("requiredDuration: sigma must be positive");
  if (n1Eff <= 0) throw new Error("requiredDuration: n1Eff must be positive");
  checkAdherence(adherence);

  const rEff = rAtSpacing(r1, 1 / adherence);
  const effPerObs = (1 - rEff) / (1 + rEff);
  const k = (mcid / (Z_TOTAL * sigma)) ** 2;
  const denom = k - 1 / n1Eff;

  if (denom <= 0) {
    // Feasibility needs n1Eff strictly above 1/k, so round up past the boundary.
    const extraObs = Math.floor((1 / k - n1Eff) / effPerObs) + 1;
    return {
      feasible: false,
      extraBaselineObs: Math.max(1, extraObs),
      extraBaselineDays: Math.max(1, Math.ceil(extraObs / adherence)),
    };
  }

  const n2Eff = 1 / denom;
  const n2Obs = n2Eff / effPerObs;
  return { feasible: true, n2Eff, n2Obs, n2Days: n2Obs / adherence };
}

export interface PowerInput {
  sigma: number;
  r1: number; // per calendar day
  n1Eff: number;
  plannedInterventionDays: number;
  mcid: number;
  adherence: number; // observations per calendar day
}

interface VerdictBase {
  mde: number;
  plannedN2Eff: number;
  plannedN2Obs: number;
  /** True when the n_eff floor of 2 bound. The MDE is not meaningful and must be flagged, not clamped silently. */
  n2Floored: boolean;
}

export type PowerVerdict =
  | ({ state: "adequate" } & VerdictBase)
  | ({ state: "underpowered"; requiredDays: number; requiredObs: number; additionalDays: number } & VerdictBase)
  | ({ state: "infeasible"; extraBaselineDays: number; feasibleMcid: number } & VerdictBase);

/**
 * §3.5. The three-state verdict. "Infeasible" is a useful answer and is not softened.
 */
export function powerVerdict(input: PowerInput): PowerVerdict {
  const { sigma, r1, n1Eff, plannedInterventionDays, mcid, adherence } = input;
  if (plannedInterventionDays <= 0) {
    throw new Error("powerVerdict: planned intervention days must be positive");
  }
  if (mcid <= 0) throw new Error("powerVerdict: mcid must be positive");
  checkAdherence(adherence);

  const rEff = rAtSpacing(r1, 1 / adherence);
  const plannedN2Obs = plannedInterventionDays * adherence;
  const n2 = nEffDetail(plannedN2Obs, rEff);
  const base: VerdictBase = {
    mde: mde(sigma, n1Eff, n2.value),
    plannedN2Eff: n2.value,
    plannedN2Obs,
    n2Floored: n2.floored,
  };

  if (base.mde <= mcid) return { state: "adequate", ...base };

  const dur = requiredDuration({ mcid, sigma, n1Eff, r1, adherence });
  if (!dur.feasible) {
    return {
      state: "infeasible",
      ...base,
      extraBaselineDays: dur.extraBaselineDays,
      // Declaring an MCID at or above the current MDE makes this same design adequate.
      feasibleMcid: base.mde,
    };
  }

  const requiredDays = Math.ceil(dur.n2Days);
  return {
    state: "underpowered",
    ...base,
    requiredDays,
    requiredObs: Math.ceil(dur.n2Obs),
    additionalDays: Math.max(1, requiredDays - Math.floor(plannedInterventionDays)),
  };
}

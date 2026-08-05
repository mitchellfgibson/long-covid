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

/** Planned calendar days -> effective days at the baseline autocorrelation. */
export function effDaysFromCalendar(days: number, r1: number): number {
  return r1 > 0 ? (days * (1 - r1)) / (1 + r1) : days;
}

/** Effective days -> calendar days at the baseline autocorrelation. */
export function calendarDaysFromEff(neff: number, r1: number): number {
  return r1 > 0 ? (neff * (1 + r1)) / (1 - r1) : neff;
}

export type DurationResult =
  | { feasible: true; n2Eff: number; n2Days: number }
  | { feasible: false; extraBaselineDays: number };

/**
 * §3.4. Intervention length at which MDE equals the declared MCID.
 * When infeasible (the baseline alone caps precision below the MCID), reports the
 * fewest extra whole baseline days that make a finite intervention length exist —
 * never a negative or NaN duration.
 */
export function requiredDuration(
  mcid: number,
  sigma: number,
  n1Eff: number,
  r1: number,
): DurationResult {
  if (mcid <= 0) throw new Error("requiredDuration: mcid must be positive");
  if (sigma <= 0) throw new Error("requiredDuration: sigma must be positive");
  if (n1Eff <= 0) throw new Error("requiredDuration: n1Eff must be positive");

  const k = (mcid / (Z_TOTAL * sigma)) ** 2;
  const denom = k - 1 / n1Eff;
  if (denom <= 0) {
    // Need n1Eff strictly above 1/k for any finite intervention phase.
    const perDayEff = r1 > 0 ? (1 - r1) / (1 + r1) : 1;
    const extra = Math.floor((1 / k - n1Eff) / perDayEff) + 1;
    return { feasible: false, extraBaselineDays: Math.max(1, extra) };
  }
  const n2Eff = 1 / denom;
  return { feasible: true, n2Eff, n2Days: calendarDaysFromEff(n2Eff, r1) };
}

export type PowerVerdict =
  | { state: "adequate"; mde: number; plannedN2Eff: number }
  | {
      state: "underpowered";
      mde: number;
      plannedN2Eff: number;
      requiredDays: number;
      additionalDays: number;
    }
  | { state: "infeasible"; mde: number; plannedN2Eff: number; extraBaselineDays: number };

/**
 * §3.5. The three-state verdict. "Infeasible" is a useful answer and is not softened.
 */
export function powerVerdict(args: {
  sigma: number;
  r1: number;
  n1Eff: number;
  plannedInterventionDays: number;
  mcid: number;
}): PowerVerdict {
  const { sigma, r1, n1Eff, plannedInterventionDays, mcid } = args;
  if (plannedInterventionDays <= 0) {
    throw new Error("powerVerdict: planned intervention days must be positive");
  }
  if (mcid <= 0) throw new Error("powerVerdict: mcid must be positive");

  const plannedN2Eff = Math.max(2, effDaysFromCalendar(plannedInterventionDays, r1));
  const m = mde(sigma, n1Eff, plannedN2Eff);
  if (m <= mcid) return { state: "adequate", mde: m, plannedN2Eff };

  const dur = requiredDuration(mcid, sigma, n1Eff, r1);
  if (!dur.feasible) {
    return { state: "infeasible", mde: m, plannedN2Eff, extraBaselineDays: dur.extraBaselineDays };
  }
  const requiredDays = Math.ceil(dur.n2Days);
  return {
    state: "underpowered",
    mde: m,
    plannedN2Eff,
    requiredDays,
    additionalDays: Math.max(1, requiredDays - Math.floor(plannedInterventionDays)),
  };
}

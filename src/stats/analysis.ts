import type { DoseRecord, Observation, Protocol } from "../types";
import { assignPhases, analysisDates, type PhaseDay } from "./phases";
import { autocorrPerDay, medianGap, nEffDetail, rAtSpacing } from "./noise";
import { detrendSeries } from "./detrend";
import { dayIndex, extractSeries, mean, sd, utcMs } from "./series";
import { tCritical, tTwoSided } from "./fdist";

/** Which side of the MCID the interval fell on. Stated against the threshold, never against zero (§5.2). */
export type EffectVerdict = "clears_threshold" | "below_threshold" | "inconclusive";

export interface PhaseSummary {
  label: "A" | "B";
  n: number; // readings in the analysis set
  mean: number;
  sigma: number;
  r1: number;
  rEff: number;
  neff: number;
  neffFloored: boolean;
  dates: string[];
}

export interface AnalysisResult {
  a: PhaseSummary;
  b: PhaseSummary;
  /** B minus A, in metric units. */
  diff: number;
  se: number;
  df: number;
  ciLow: number;
  ciHigh: number;
  /** Small, below the CI. Not the headline (§5.2). */
  p: number;
  verdict: EffectVerdict;
  /** Direction-corrected: true when the change moved the way the user wants. */
  favourable: boolean;
  excludedDates: string[];
  /** Set whenever this look was not the pre-registered one (§5). */
  exploratory: boolean;
  exploratoryReason?: string;
}

/**
 * Noise summary for one phase's analysis set. Detrends first, because a phase that
 * drifts internally would otherwise inflate its own sigma.
 */
function summarize(
  label: "A" | "B",
  observations: Observation[],
  metricId: string,
  dates: Set<string>,
): PhaseSummary {
  const points = extractSeries(observations, metricId).filter((p) => dates.has(p.date));
  if (points.length < 2) {
    throw new Error(`phase ${label} has ${points.length} readings; need at least 2`);
  }
  const values = points.map((p) => p.value);
  const idx = dayIndex(points.map((p) => p.date));

  // Under 3 points there is nothing to detrend against; use raw deviations.
  const residuals = points.length >= 3 ? detrendSeries(points).residuals : values;
  const r1 = points.length >= 3 ? autocorrPerDay(residuals, idx).r1 : 0;
  const gap = medianGap(idx);
  const rEff = rAtSpacing(r1, gap);
  const ne = nEffDetail(points.length, rEff);

  return {
    label,
    n: points.length,
    mean: mean(values),
    sigma: sd(residuals),
    r1,
    rEff,
    neff: ne.value,
    neffFloored: ne.floored,
    dates: points.map((p) => p.date),
  };
}

export interface AnalysisInput {
  protocol: Protocol;
  observations: Observation[];
  doses?: DoseRecord[];
  /** Metric to analyze. Defaults to the protocol's primary. */
  metricId?: string;
  /** Higher/lower is better, for phrasing the verdict. */
  direction?: "higher_is_better" | "lower_is_better";
  /** Today, for deciding whether this look is pre-registered (§5). */
  today?: string;
}

/**
 * §5.2. Difference in phase means with a Welch-style standard error built on
 * effective counts. A phases are pooled for ABA and ABAB (§5.1).
 */
export function runAnalysis(input: AnalysisInput): AnalysisResult {
  const { protocol, observations, doses = [], today } = input;
  const metricId = input.metricId ?? protocol.primaryMetricId;
  const direction = input.direction ?? "higher_is_better";

  const dates = extractSeries(observations, metricId).map((p) => p.date);
  const assigned = assignPhases(
    dates,
    protocol.phases,
    protocol.intervention.onsetLagDays,
    protocol.intervention.washoutDays,
    doses,
  );
  const kept = analysisDates(assigned);

  // Pool the A phases: baseline and withdrawal are both off-treatment.
  const aDates = new Set([...kept.baseline, ...kept.withdrawal]);
  const bDates = new Set(kept.intervention);

  const a = summarize("A", observations, metricId, aDates);
  const b = summarize("B", observations, metricId, bDates);

  const diff = b.mean - a.mean;
  const vA = (a.sigma * a.sigma) / a.neff;
  const vB = (b.sigma * b.sigma) / b.neff;
  const se = Math.sqrt(vA + vB);

  // Welch-Satterthwaite on effective counts.
  const df =
    se > 0
      ? (vA + vB) ** 2 / (vA ** 2 / Math.max(1, a.neff - 1) + vB ** 2 / Math.max(1, b.neff - 1))
      : 1;

  const t = se > 0 ? tCritical(0.95, df) : 0;
  const ciLow = diff - t * se;
  const ciHigh = diff + t * se;
  const p = se > 0 ? tTwoSided(diff / se, df) : 1;

  // §5.2: state the verdict against the MCID, not against zero. The comparison runs
  // on the magnitude in the direction the user considers an improvement.
  const signed = direction === "higher_is_better" ? 1 : -1;
  const lo = signed === 1 ? ciLow : -ciHigh;
  const hi = signed === 1 ? ciHigh : -ciLow;
  const mcid = protocol.mcid;

  let verdict: EffectVerdict;
  if (lo >= mcid) verdict = "clears_threshold";
  else if (hi < mcid) verdict = "below_threshold";
  else verdict = "inconclusive";

  const excludedDates = assigned.filter((d) => d.excluded).map((d) => d.date);
  const look = lookStatus(protocol, today);

  return {
    a,
    b,
    diff,
    se,
    df,
    ciLow,
    ciHigh,
    p,
    verdict,
    favourable: signed * diff > 0,
    excludedDates,
    exploratory: look.exploratory,
    ...(look.reason ? { exploratoryReason: look.reason } : {}),
  };
}

/**
 * §5. Analysis unlocks when the final phase end date has passed, or at a
 * pre-registered gate date. Any other look is exploratory, permanently and
 * unmissably.
 */
export function lookStatus(
  protocol: Protocol,
  today?: string,
): { exploratory: boolean; reason?: string } {
  if (!today) return { exploratory: false };

  const lastEnd = protocol.phases.reduce(
    (latest, p) => (utcMs(p.endDate) > utcMs(latest) ? p.endDate : latest),
    protocol.phases[0]?.endDate ?? today,
  );
  if (utcMs(today) >= utcMs(lastEnd)) return { exploratory: false };

  const rule = protocol.stoppingRule;
  if (rule.kind !== "none" && rule.date === today) return { exploratory: false };
  if (rule.kind !== "none") {
    return {
      exploratory: true,
      reason: `The experiment runs to ${lastEnd} and your pre-registered gate is ${rule.date}. This look is neither.`,
    };
  }
  return {
    exploratory: true,
    reason: `The experiment runs to ${lastEnd}. You declared no interim gate, so this look was not pre-registered.`,
  };
}

export interface SensitivityResult {
  all: AnalysisResult;
  clean: AnalysisResult;
  droppedDates: string[];
  /** True when the two runs land on different verdicts — said out loud (§5.3). */
  disagrees: boolean;
}

/**
 * §5.3. Re-run with confounder-flagged days dropped and show both side by side.
 * If they disagree, say so.
 */
export function runSensitivity(input: AnalysisInput): SensitivityResult {
  const all = runAnalysis(input);
  const flagged = input.observations.filter((o) => o.confounders.length > 0).map((o) => o.date);
  const droppedSet = new Set(flagged);
  const clean = runAnalysis({
    ...input,
    observations: input.observations.filter((o) => !droppedSet.has(o.date)),
  });
  return {
    all,
    clean,
    droppedDates: flagged,
    disagrees: all.verdict !== clean.verdict,
  };
}

export { type PhaseDay };

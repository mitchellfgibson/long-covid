/**
 * Milestone 1 CLI. No UI, no framework: read a CSV, print the power report.
 *
 *   npm run power -- data.csv --date "Cycle start time" --metric "HRV (ms)" \
 *     --mcid 5 --plan 30 [--unit ms] [--date-format iso|mdy] [--adherence 0.43]
 */
import { readFileSync } from "node:fs";
import { extractSeries } from "../stats/series";
import { baselineNoise } from "../stats/noise";
import { mde, powerVerdict } from "../stats/power";
import {
  DuplicateValueError,
  detectDateFormat,
  parseCsv,
  rowsToObservations,
  type DateFormat,
} from "../stats/csv";

interface Args {
  file: string;
  date?: string;
  metric?: string;
  mcid?: number;
  plan?: number;
  unit: string;
  dateFormat?: DateFormat;
  adherence?: number;
}

function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      flags.set(a.slice(2), argv[++i] ?? "");
    } else {
      positional.push(a);
    }
  }
  const num = (k: string) => (flags.has(k) ? Number(flags.get(k)) : undefined);
  const fmt = flags.get("date-format");
  return {
    file: positional[0] ?? "",
    date: flags.get("date"),
    metric: flags.get("metric"),
    mcid: num("mcid"),
    plan: num("plan"),
    unit: flags.get("unit") ?? "",
    dateFormat: fmt === "iso" || fmt === "mdy" ? fmt : undefined,
    adherence: num("adherence"),
  };
}

const n = (x: number, digits = 2) => x.toFixed(digits);

function die(message: string): never {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (!args.file) {
    die(
      "usage: npm run power -- <file.csv> --date <col> --metric <col> --mcid <number> --plan <days>\n" +
        "  optional: --unit <string> --date-format iso|mdy --adherence <0-1>",
    );
  }

  const rows = parseCsv(readFileSync(args.file, "utf8"));
  const header = rows[0] ?? die(`${args.file} is empty`);

  if (!args.date || !args.metric) {
    console.log(`\n  Columns in ${args.file}:`);
    for (const col of header) console.log(`    ${col}`);
    die("pick one with --date and one with --metric");
  }
  if (!header.includes(args.date)) die(`no column named "${args.date}"`);
  if (!header.includes(args.metric)) die(`no column named "${args.metric}"`);
  if (args.mcid === undefined || !Number.isFinite(args.mcid) || args.mcid <= 0) {
    die("--mcid must be a positive number, in the metric's own units");
  }
  if (args.plan === undefined || !Number.isFinite(args.plan) || args.plan <= 0) {
    die("--plan must be the planned number of intervention days");
  }
  if (
    args.adherence !== undefined &&
    (!Number.isFinite(args.adherence) || args.adherence <= 0 || args.adherence > 1)
  ) {
    die("--adherence must be observations per calendar day, between 0 and 1 (3 days a week = 0.43)");
  }

  // Resolve the date format rather than guessing an ambiguous column (§2).
  const dateIdx = header.indexOf(args.date);
  const samples = rows.slice(1, 40).map((r) => r[dateIdx] ?? "");
  let dateFormat = args.dateFormat;
  if (!dateFormat) {
    const detected = detectDateFormat(samples);
    if (detected.kind === "ambiguous") {
      die(
        `dates in "${args.date}" could be MM/DD/YYYY or DD/MM/YYYY. Re-run with --date-format mdy if the first number is the month.`,
      );
    }
    if (detected.kind === "unparseable") {
      die(`could not read dates in "${args.date}". Supported: YYYY-MM-DD and MM/DD/YYYY.`);
    }
    dateFormat = detected.kind;
  }

  let observations;
  try {
    observations = rowsToObservations(rows, {
      dateColumn: args.date,
      dateFormat,
      metricColumns: { [args.metric]: "primary" },
    });
  } catch (err) {
    if (err instanceof DuplicateValueError) {
      const lines = err.conflicts
        .slice(0, 8)
        .map((c) => `    ${c.date}   ${c.values.join("  vs  ")}`)
        .join("\n");
      const more = err.conflicts.length > 8 ? `\n    ...and ${err.conflicts.length - 8} more` : "";
      die(
        `"${args.metric}" has more than one value on the same date:\n\n${lines}${more}\n\n` +
          `  These are not averaged — averaging invents a number you never recorded.\n` +
          `  Decide which reading to keep and correct the file.`,
      );
    }
    throw err;
  }

  const series = extractSeries(observations, "primary");
  if (series.length < 3) {
    die(`only ${series.length} usable rows in "${args.metric}"; need at least 3`);
  }

  const noise = baselineNoise(series);
  const adherence = Math.min(1, args.adherence ?? noise.observedAdherence);
  const unit = args.unit ? ` ${args.unit}` : "";
  const span = `${series[0]!.date} to ${series[series.length - 1]!.date}`;

  console.log(`
  PIPELINE — power report
  ${"-".repeat(58)}
  file        ${args.file}
  metric      ${args.metric}
  baseline    ${series.length} observations over ${span}`);

  console.log(`
  BASELINE
    sigma           ${n(noise.sigma, 3)}${unit}   (after detrending)
    drift           ${n(noise.slope, 4)}${unit}/day`);
  if (Math.abs(noise.slope) * 30 > noise.sigma) {
    console.log(
      `                    your baseline is already moving — that alone can look like an effect`,
    );
  }

  if (noise.method === "insufficient") {
    console.log(`    r1              could not be estimated`);
    console.log(`
    WARNING: too few usable pairs at any lag to measure carryover. n_eff below
    assumes your days are independent, which almost certainly overstates how
    much this baseline tells you. Treat the MDE as a best case, not a estimate.`);
  } else {
    const at = noise.method === "lag_k" ? ` (estimated at lag ${noise.lag}, ${noise.pairs} pairs)` : "";
    console.log(`    r1              ${n(noise.r1, 3)} per day${at}`);
    if (noise.medianGap !== 1) {
      console.log(
        `    r between       ${n(noise.rEff, 3)}   (readings sit ${n(noise.medianGap, 1)} days apart)`,
      );
    }
  }

  console.log(`    n_eff           ${n(noise.neff, 1)} of ${series.length} observations`);
  if (noise.neffFloored) {
    console.log(`
    WARNING: n_eff hit its floor of 2. There is not enough independent
    information in this baseline for the numbers below to mean anything.`);
  } else if (noise.rEff > 0) {
    console.log(
      `                    your readings carry over: ${series.length} observations are worth about ${Math.round(noise.neff)} independent ones`,
    );
  }

  if (noise.dowReason === "applied") {
    const swing = Math.max(...noise.dowOffsets!) - Math.min(...noise.dowOffsets!);
    console.log(
      `    day-of-week     ${n(swing, 2)}${unit} spread removed (F test p = ${n(noise.dowP!, 3)})`,
    );
  } else if (noise.dowReason === "no_weekly_pattern") {
    console.log(
      `    day-of-week     no weekly pattern removed (F test p = ${n(noise.dowP!, 3)}, not below 0.10)`,
    );
  } else {
    console.log(`    day-of-week     not tested — fewer than 28 observations`);
  }

  const verdict = powerVerdict({
    sigma: noise.sigma,
    r1: noise.r1,
    n1Eff: noise.neff,
    plannedInterventionDays: args.plan,
    mcid: args.mcid,
    adherence,
  });

  const adherenceNote =
    args.adherence === undefined
      ? `inferred from your baseline`
      : `as declared`;
  console.log(`
  PLAN
    MCID            ${n(args.mcid, 3)}${unit}
    adherence       ${n(adherence, 2)} readings/day, ${adherenceNote}
    intervention    ${args.plan} days -> ${n(verdict.plannedN2Obs, 1)} readings (${n(verdict.plannedN2Eff, 1)} effective)
    MDE             ${n(verdict.mde, 3)}${unit}`);

  if (verdict.n2Floored) {
    console.log(`
    WARNING: the planned intervention phase hit the n_eff floor of 2. The MDE
    above is not a meaningful number — the phase is too short, too sparse, or
    too autocorrelated to carry two independent readings.`);
  }

  console.log(`
  VERDICT`);

  if (verdict.state === "adequate") {
    console.log(`    ADEQUATE
    This design can detect ${n(verdict.mde, 2)}${unit}, at or below your ${n(args.mcid, 2)}${unit} threshold.`);
  } else if (verdict.state === "underpowered") {
    console.log(`    UNDERPOWERED
    This design can only detect ${n(verdict.mde, 2)}${unit}. Your threshold is ${n(args.mcid, 2)}${unit}.
    An effect the size you care about would likely be missed.

    Three ways out:
      1. Run the intervention phase ${verdict.requiredDays} days instead of ${args.plan} — ${verdict.additionalDays} more.
         That is ${verdict.requiredObs} readings at your ${n(adherence, 2)}/day rate.
      2. Pick a lower-noise metric.
      3. Declare a larger MCID (at least ${n(verdict.mde, 2)}${unit}) and accept you can only detect a bigger effect.`);
  } else {
    console.log(`    INFEASIBLE
    At this noise level, no intervention phase of any length reaches ${n(args.mcid, 2)}${unit}.
    The baseline alone caps your precision: even an infinitely long B phase
    could not resolve a difference that small.

    This experiment cannot answer the question as posed.

    You have two levers, not one:
      1. Collect about ${verdict.extraBaselineDays} more baseline days before starting.
      2. Declare an MCID of at least ${n(verdict.feasibleMcid, 2)}${unit}, which this design
         can already detect as it stands.`);
  }

  const floor = mde(noise.sigma, noise.neff, Number.MAX_SAFE_INTEGER);
  console.log(`
    (Floor: with an unlimited intervention phase this baseline could at best
     detect ${n(floor, 2)}${unit}.)

    Planning sigma is your baseline's noise. It assumes the intervention phase is
    equally noisy, and treatments often make day-to-day variation worse rather
    than better — a reason to declare your MCID conservatively.

  This tool does not give medical advice and does not recommend treatments.
  Talk to your clinician before starting or stopping anything.
`);
}

main();

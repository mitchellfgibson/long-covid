/**
 * Milestone 1 CLI. No UI, no framework: read a CSV, print the power report.
 *
 *   npm run power -- data.csv --date "Cycle start time" --metric "HRV (ms)" \
 *     --mcid 5 --plan 30 [--unit ms] [--date-format iso|mdy]
 */
import { readFileSync } from "node:fs";
import { extractSeries } from "../stats/series";
import { baselineNoise } from "../stats/noise";
import { mde, powerVerdict, requiredDuration } from "../stats/power";
import { detectDateFormat, parseCsv, rowsToObservations, type DateFormat } from "../stats/csv";

interface Args {
  file: string;
  date?: string;
  metric?: string;
  mcid?: number;
  plan?: number;
  unit: string;
  dateFormat?: DateFormat;
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
      'usage: npm run power -- <file.csv> --date <col> --metric <col> --mcid <number> --plan <days>\n  optional: --unit <string> --date-format iso|mdy',
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

  const observations = rowsToObservations(rows, {
    dateColumn: args.date,
    dateFormat,
    metricColumns: { [args.metric]: "primary" },
  });
  const series = extractSeries(observations, "primary");
  if (series.length < 3) die(`only ${series.length} usable rows in "${args.metric}"; need at least 3`);

  const noise = baselineNoise(series);
  const unit = args.unit ? ` ${args.unit}` : "";
  const span = `${series[0]!.date} to ${series[series.length - 1]!.date}`;
  const calendarDays = observations.length;

  console.log(`
  RUNSHEET — power report
  ${"-".repeat(58)}
  file        ${args.file}
  metric      ${args.metric}
  baseline    ${series.length} observations over ${span}`);
  if (calendarDays > series.length) {
    console.log(`              ${calendarDays - series.length} day(s) missing, never interpolated`);
  }

  console.log(`
  BASELINE
    sigma           ${n(noise.sigma, 3)}${unit}   (after detrending)
    drift           ${n(noise.slope, 4)}${unit}/day`);
  if (Math.abs(noise.slope) * 30 > noise.sigma) {
    console.log(`                    your baseline is already moving — that alone can look like an effect`);
  }
  console.log(`    r1              ${n(noise.r1, 3)}
    n_eff           ${n(noise.neff, 1)} of ${series.length} days`);
  if (noise.r1 > 0) {
    console.log(
      `                    your day-to-day values carry over: ${series.length} days of data is worth about ${Math.round(noise.neff)} independent days`,
    );
  }
  if (noise.dowOffsets) {
    const swing = Math.max(...noise.dowOffsets) - Math.min(...noise.dowOffsets);
    console.log(`    day-of-week     ${n(swing, 2)}${unit} spread, removed before analysis`);
  }

  const verdict = powerVerdict({
    sigma: noise.sigma,
    r1: noise.r1,
    n1Eff: noise.neff,
    plannedInterventionDays: args.plan,
    mcid: args.mcid,
  });

  console.log(`
  PLAN
    MCID            ${n(args.mcid, 3)}${unit}
    intervention    ${args.plan} days (${n(verdict.plannedN2Eff, 1)} effective)
    MDE             ${n(verdict.mde, 3)}${unit}

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
      2. Pick a lower-noise metric.
      3. Declare a larger MCID (at least ${n(verdict.mde, 2)}${unit}) and accept you can only detect a bigger effect.`);
  } else {
    const extraNeeded = requiredDuration(args.mcid, noise.sigma, noise.neff, noise.r1);
    console.log(`    INFEASIBLE
    At this noise level, no intervention phase of any length reaches ${n(args.mcid, 2)}${unit}.
    The baseline alone caps your precision: even an infinitely long B phase
    could not resolve a difference that small.

    This experiment cannot answer the question as posed.`);
    if (!extraNeeded.feasible) {
      console.log(
        `    About ${extraNeeded.extraBaselineDays} more baseline days would make it merely difficult rather than impossible.`,
      );
    }
  }

  const floor = mde(noise.sigma, noise.neff, Number.MAX_SAFE_INTEGER);
  console.log(`
    (Floor: with an unlimited intervention phase this baseline could at best
     detect ${n(floor, 2)}${unit}.)

  This tool does not give medical advice and does not recommend treatments.
  Talk to your clinician before starting or stopping anything.
`);
}

main();

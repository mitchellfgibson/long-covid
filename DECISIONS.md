# Decisions

Ambiguities in SPEC.md, resolved toward whichever option keeps the statistics honest.
Milestone 1 only; each entry names the section it interprets.

## Time is measured in calendar days, never in row counts

**§3.1, §5.1.** Missing days are allowed and are absent rows, so "day index" and
"row index" diverge the moment a user skips a day. Everywhere the spec says *day*,
this build means calendar day:

- The OLS trend fits value against calendar offset from the first observation. Fitting
  against row index would report a 1.0/day drift as 2.0/day on an every-other-day series
  — an invented trend that would then be subtracted out of the residuals.
- The onset-lag and washout windows are counted forward from the phase start date. If a
  user misses the first two days of the intervention phase, the exclusion window still
  ends on calendar day 3, rather than sliding forward to consume three *observed* days
  that are past the drug's onset.

There is a test for each of these (`detrend.test.ts`, `phases.test.ts`).

## Lag-1 autocorrelation skips pairs that span a gap

**§3.2.** The estimator's numerator only accepts consecutive observations that are
also consecutive calendar days. Treating Monday and Friday as a lag-1 pair because
they happen to be adjacent rows understates carryover, which inflates `n_eff`, which
inflates confidence — the exact failure §3.2 exists to prevent. The denominator stays
the full centered sum of squares (the standard biased-but-stable form), so `r1` cannot
blow up when few adjacent pairs survive.

## Day-of-week offsets are centered before subtraction

**§3.1.** "Fit day-of-week means and subtract them" would remove the series level along
with the weekday pattern if taken literally. This build subtracts each weekday's
deviation from the grand mean, so step 1 removes only the weekly shape and leaves the
level and slope for the OLS fit in step 2. Reported `dowOffsets` are those deviations.

## `n_eff`'s floor of 2 also applies to planned phases

**§3.2, §3.3.** The floor is written for observed series. It applies equally to the
planned intervention phase converted through `n_eff = n_days * (1 - r1) / (1 + r1)`;
otherwise a short plan at high autocorrelation yields an effective count below 1 and an
MDE that is optimistically small precisely where the design is weakest.

## Infeasibility reports whole extra baseline days, minimum 1

**§3.4.** The spec requires reporting "how many extra baseline days would fix it" and
§8.5 requires no negative or NaN duration. Feasibility needs `n1_eff` strictly greater
than `1/k`, so the reported figure is `floor((1/k - n1_eff) / eff_per_day) + 1` — the
fewest whole days that actually cross the boundary rather than land on it. Extra
baseline days are converted at the same `(1 - r1) / (1 + r1)` rate, since new baseline
days are as autocorrelated as the old ones.

## Canonical JSON: number format and absent keys

**§4.1.** "Numbers in a fixed format" is satisfied by `JSON.stringify`'s shortest
round-trip representation, which is deterministic per IEEE-754 value across engines —
`5.10` and `5.1` are the same number and must hash the same, while `5.1` and `5.10000001`
must not. Two guards:

- Non-finite numbers throw rather than serialize. `JSON.stringify` turns `NaN` into
  `null`, which would let a broken MCID produce a valid-looking hash.
- Keys with `undefined` values are omitted, so an explicitly-undefined optional field
  hashes identically to an absent one.

## Washout is excluded from the start of the withdrawal phase

**§1 vs §5.1.** §1 defines `washoutDays` as "days after end of B excluded"; §5.1 says to
exclude it "from the start of each withdrawal phase." These describe the same days when
a withdrawal phase immediately follows the intervention, which is the only arrangement
the `ABA`/`ABAB` designs produce. §5.1 is implemented, because it is the analysis-time
rule and it stays well-defined if a gap ever appears between phases.

## CSV: blanks are absent, ambiguity is a question

**§2.** Blank and non-numeric cells produce no entry at all rather than a `null` or a
`0` — §2's "never interpolate" read strictly. A date column whose slash-dates could be
either `MM/DD` or `DD/MM` (every sample has both fields ≤ 12), or that mixes ISO and
slash formats, is reported as ambiguous and the CLI stops and asks. Duplicate dates
merge into one observation rather than becoming two rows for the same day.

All dates are parsed and compared in UTC so that a local timezone can never shift an
observation onto the adjacent calendar day.

## `sigma` for planning comes from baseline residuals

**§3.3.** The MDE formula takes a single `sigma`. Before the intervention runs, the only
honest estimate is the detrended baseline residual SD, so that is what the power report
uses. The §5.2 analysis is a separate path and keeps the per-phase sigmas the spec
specifies there.

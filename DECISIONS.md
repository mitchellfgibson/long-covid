# Decisions

Ambiguities in SPEC.md, resolved toward whichever option keeps the statistics honest.
Milestone 1 only; each entry names the section it interprets.

---

# Round 3 — milestones 2 through 5

The spec debts from round 2 are cleared, §5.2 is built, and the app exists.
Spec version moved to **1.2.0**: the domain model changed and phase exclusion
now produces different day sets, so it is not a wording-only bump.

## SPEC.md now lives in the repo

Round 2 left the spec in `~/Downloads` while `specVersion` inside the protocol
hash pointed at it. A fingerprint whose referent is untracked proves less than it
appears to, so the document is now committed alongside the code that implements it.

## §3.2 and §3.4 amended for `r_eff`

The open item from round 2. `n_eff`'s formula in the spec still read in terms of
the per-day `r1`; it now reads in terms of `r_eff = r1^g` over the observation
count, and §3.4 solves for readings before converting to calendar days through the
declared adherence rate. Spec and code agree again.

## Onset lag anchors to the first dose (item 8, completed)

Round 2 left this partial because the domain model had nowhere to record a dose.
`DoseRecord { date, taken }` is now a separate log rather than a field on
`Observation`, for the same reason the spec keeps missing readings absent: an
absent dose record means *unknown*, and folding it into the observation row would
make "no reading that day" and "no dose that day" indistinguishable.

Two consequences worth stating. The window counts forward from the earliest
`taken: true` inside the phase, and days *before* that first dose are excluded as
pre-treatment — they cannot inform the B mean, because the intervention was not on
board. With no dose log the behaviour is unchanged from round 2, falling back to
the phase start with a warning, so nothing already locked shifts underneath its
hash without the version check catching it.

## Acknowledgments moved inside the protocol

§3.5 requires the underpowered acknowledgment to be "recorded in the protocol" and
§4.4 says the same for efficacy gates, but the §1 interface had no field for
either. Both now sit in `Protocol.acknowledgments`, inside the hash, and are
non-optional so the canonical form stays deterministic. Without this the
acknowledgment lived only in UI state and would not have survived export, which
would have made the requirement decorative.

## §5.2: Welch on effective counts

The t distribution comes from the same regularized incomplete beta already written
for the §3.1 F gate; `tCritical` bisects on the two-sided p-value rather than
approximating with z, because `n_eff` is routinely small enough for the difference
to matter. Welch-Satterthwaite runs on effective counts throughout, never raw n.

Each phase is detrended before its sigma is taken, since a phase that drifts
internally would otherwise inflate its own noise estimate and widen the interval
for a reason that has nothing to do with the treatment.

The verdict is stated against the MCID in the direction the user considers an
improvement, so a `lower_is_better` metric that falls by more than the threshold
reads as clearing it rather than failing it. The p-value is reported small, below
the interval, and is never the headline.

## The exploratory rule is time-based and unmissable

`lookStatus` treats a look as pre-registered only when the final phase has ended or
the date matches a declared gate exactly. Everything else is labelled exploratory
with a reason naming both dates. The flag rides on the result object rather than
being computed in the view, so it cannot be rendered without it.

## Fonts are bundled, not fetched

§6 asks for Spectral and IBM Plex; §0 permits exactly one outbound call, the
optional LLM layer. A CDN font link would violate that on every page load, before
the user has consented to anything. The families are installed as packages and
bundled into `dist/`, so the built app makes no network request at all until a key
is entered and a button pressed.

## The LLM layer is structurally incapable of touching a number

§7's rules are in the system prompt, but a prompt is a request, not a guarantee.
The stronger constraint is the call surface: `clinicianSummary` is passed protocol
fields only, and `suggestConfounders` is passed an intervention name and a metric
label. Neither is given a mean, an interval, a p-value, or a verdict, so there is
no statistic in scope for it to comment on even if the prompt were ignored
entirely. The key is component state, never persisted, gone on reload.

## Imports never silently overwrite typed values

Not in the spec, decided here. When a CSV import lands on a date that already has
a hand-entered reading, the existing value wins per metric and new metrics merge
in alongside. A re-import that quietly replaced a corrected value with the original
device export would undo deliberate work with no trace, which is the same class of
harm as averaging duplicate readings.

## A note on the test environment

This Node exposes its own method-less `localStorage` global that shadows the one
jsdom installs, so the UI tests install a real `Storage` before rendering. The app
itself is unaffected — both storage accesses in the store are already guarded, and
the app degrades to in-memory state with export still working if storage is blocked
or full.

---

# Review round 2

Nine items from review. Items 1, 2, 5 and 6 were amended in SPEC.md itself so the
spec and the code agree; the spec version went to **1.1.0** because several of these
change numbers the code produces.

## 1. The autocorrelation denominator was wrong (bug)

**§3.2, amended in spec.** The numerator summed over the m pairs that were exactly one
calendar day apart, but the denominator kept the full centered sum of squares over all
n observations. That is the textbook form only when a single end-of-series pair is
missing. Here the shortfall scales with the fraction of pairs the gaps eat, so the
estimate was deflated by roughly m/n.

Both sides are now normalized by their own counts. Measured on AR(1) with r=0.5,
n=2000, over 60 deletion seeds: at 40 percent of days deleted the mean deviation from
the full-series estimate is −0.0002 (sd 0.029), and at 60 percent it is +0.008
(sd 0.053). The old form landed near −0.20 and −0.30 respectively. `decimation.test.ts`
asserts the single-seed case at a 3-sd tolerance and, separately, that the mean
deviation across 40 seeds stays under 0.02 — the single-seed check alone would pass or
fail on the draw, so the bias assertion is the real regression guard.

The consequence was the one the gap rule exists to prevent: understated carryover,
overstated `n_eff`, an MDE about 35 percent too small, and a design that looks
adequately powered when it is not.

## 2. Sparse series get an estimate instead of nothing

**§3.2, amended in spec.** A strictly every-other-day metric has no adjacent-day pairs
at all, so the lag-1 estimator returned zero — indistinguishable in the output from a
genuinely uncorrelated series, and anti-conservative in exactly the same way.

Below 10 valid pairs the lag-1 estimator is now declined explicitly rather than being
allowed to run on a thin numerator. The estimator falls through to the smallest lag k
that does have 10 pairs and converts back under the AR(1) assumption the spec already
makes, `r1 = r_k^(1/k)`. A non-positive `r_k` reports r1 = 0, since it has no
meaningful k-th root.

When no lag has enough pairs the result is reported as `insufficient`, not as zero. The
CLI warns that `n_eff` assumes independence and therefore overstates precision. That
case is honest about being uninformative rather than quietly optimistic.

Verified end to end on a Mon/Wed/Fri series with zero adjacent-day pairs: true r = 0.5,
recovered r1 = 0.526 at lag 2.

## 3. `n_eff` uses the correlation at the observed spacing

**Code only — see the open item at the end of this section.** `n * (1-r)/(1+r)` assumes
r is the correlation between consecutive *observations*, but r1 is now per calendar day.
For a series with median gap g, the correlation from one reading to the next is `r1^g`,
not `r1`. `n_eff` is computed from `r_eff = r1^g` over the observation count.

The same correction runs through §3.4. The inversion solves for the number of
*observations* needed, then converts to calendar days using an adherence rate the user
declares (`--adherence`, defaulting to the rate observed in the baseline). A
three-day-a-week user is told 91 days and 39 readings, where the old code would have
said 39 days — a figure that silently assumed daily adherence and was wrong by a factor
of the adherence rate.

Sparser sampling means each reading carries more independent information, so fewer are
needed, but they span far more calendar time. Both numbers are reported because the
user schedules in days and the statistics run in readings.

**Open item:** §3.2's `n_eff` line and §3.4's `n2_days` conversion in SPEC.md still read
in terms of `r1` rather than `r_eff`, so the spec and code now disagree there. Amending
for item 3 was outside the instruction to amend items 1, 2, 5 and 6, so the spec was
left alone. It should probably be amended too.

## 4. Decimation tests

**Tests only.** `decimation.test.ts` covers both new cases: recovery of the full-series
r1 after deleting a random 40 percent of days at a fixed seed, and a daily series and an
every-other-day series drawn from the same process reporting the same per-day r1 but
different `n_eff` — 2000 readings at r_eff 0.5 giving about n/3, against 1000 readings at
r_eff 0.25 giving about 0.6n. Half the readings, each worth more.

## 5. The day-of-week fit is gated, and the threshold is 28

**§3.1, amended in spec.** Threshold raised from 21 to 28, so a weekday mean rests on
four observations rather than three, and the subtraction now requires a one-way F test
across weekdays to reject at p < 0.10. On failure `dowOffsets` is null and the reason is
reported rather than left silent — the result distinguishes "not tested, too few
observations" from "tested, no weekly pattern."

An unconditional fit always removes something. Whatever it removes leaves the residuals
and is credited to signal, shrinking sigma and inflating power. Under-correcting is
conservative; over-correcting is not.

Two implementation choices worth recording. The F test runs on preliminary linear-trend
residuals rather than raw values, because a drifting baseline inflates within-weekday
variance and would mask a real weekly pattern, and because with unevenly sampled
weekdays the drift leaks into the weekday means themselves. Empty weekday groups are
dropped from the test rather than contributing zero-width cells, so a user who never
records on Sundays is tested on the six weekdays they do record.

The F distribution is computed from a Lanczos log-gamma and a continued-fraction
regularized incomplete beta. Both are verified in `fdist.test.ts` against the closed
form available at d1 = 2, the analytic value of F(1,1), and independent Simpson
integration of the beta density, which agreed to 13 significant figures.

The effect is visible on the sample data: sigma rose from 6.162 to 6.298 and the MDE
from 5.835 to 6.336 once the gate declined to fit weekday noise at p = 0.957. The old
number was better-looking and wrong.

## 6. `specVersion` is inside the hashed object

**§1 and new §5.5, amended in spec.** The field was missing entirely. It now sits inside
`Protocol`, so `canonicalJson` covers it and changing it changes the hash — a protocol
cannot be quietly re-attributed to a different set of statistical rules after locking.

`requireSpecVersion` refuses by default and names both versions; `allowMismatch` returns
the warning text rather than a boolean, so a caller cannot take the escape hatch without
having something to display. A missing or empty version is treated as unverifiable
rather than as current, since protocols predating version tracking cannot be checked.

## 7. Duplicate dates stop rather than average

**Code only.** Rows sharing a date still merge across *different* metrics. The same
metric twice with the same value is accepted as a harmless repeat. The same metric with
two different values now throws `DuplicateValueError` carrying every conflict, sorted,
so the user resolves them in one pass instead of one per run.

Averaging would invent a number the user never recorded and would then feed it to sigma,
r1 and every downstream count as though it had been observed. This is the same posture
§2 already takes toward an ambiguous date column: stop and ask.

## 8. Onset lag versus first dose

**Code only, partial.** `onsetLagDays` anchors to the phase start date, but the
pharmacological clock starts at the first dose. A user who misses the first two doses has
an exclusion window that expires before the intervention is on board, leaving days in the
analysis set that the window existed to remove.

Anchoring properly needs a dose log, which the domain model does not carry — §1 has no
dose-event type, and adding one is a model change beyond this round. `onsetLagWarnings`
reports every missed-dose confounder falling inside an onset window, with the day of the
phase it landed on, so the violated assumption is visible rather than silent. Missed
doses after the window closes are left to the §5.3 sensitivity re-run, which is where
they belong.

## 9. Verdict-report additions

**CLI only.** Three changes.

The `n_eff` floor of 2 now reports itself. When it binds, the MDE is built on a count
that was clamped rather than measured, so the number is not meaningful; the CLI says so
for both the baseline and the planned intervention phase instead of printing a
confident figure.

The infeasible verdict reports both levers, not one. Alongside the extra baseline days,
it now states the MCID at which the current design becomes feasible — which is the
current MDE, since declaring an MCID at or above it makes the same design adequate. A
user staring at "646 more baseline days" deserves to know that accepting a 6.34 ms
threshold instead of 1 ms is the other way through.

Every report closes with the caveat that planning sigma is the baseline's noise and
assumes the intervention phase is equally noisy. Treatments often make day-to-day
variation worse rather than better, which biases the MDE optimistic in the one direction
that matters, and is a reason to declare the MCID conservatively.

---

# Round 1

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

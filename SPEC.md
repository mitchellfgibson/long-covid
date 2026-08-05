# Pipeline — build spec

**Spec version: 1.2.0.** Protocols carry the version they were locked under (§1), and the analysis path checks it (§5.5). Bump the minor version whenever a change here alters a number the code produces; bump the patch version for wording.

An n=1 experiment designer and analyzer for people running self-experiments on chronic conditions. The product's thesis: **the value is in locking the decision rule before you see the data.** Everything else is bookkeeping.

This document is the contract. Build against it. When something here is ambiguous, choose the option that keeps the statistics honest, and note the choice in `DECISIONS.md`.

---

## 0. Constraints

- **No backend.** Single-page app, static hosting (GitHub Pages). All data in `localStorage`, with JSON export/import.
- **No PII leaves the device.** The only outbound network call is the optional LLM layer in §7, and it is off by default.
- **TypeScript, strict mode.** Vite + React 18. No state library; `useReducer` plus context is enough.
- **The statistics are deterministic local code.** No LLM touches a number. This is a hard architectural rule, not a preference.
- Charts are hand-rolled SVG. Data is under ~200 points; a charting library costs more in control than it saves.
- Tests with Vitest. The stats module ships with known-answer tests (§8) and does not merge without them.

---

## 1. Domain model

```ts
type Phase = "baseline" | "intervention" | "withdrawal";

interface Observation {
  date: string;          // ISO yyyy-mm-dd
  values: Record<string, number | null>;  // metricId -> value
  confounders: string[]; // ids from the confounder list
  note?: string;
}

interface Metric {
  id: string;
  label: string;         // "HRV"
  unit: string;          // "ms"
  direction: "higher_is_better" | "lower_is_better";
}

// One record per day the user says something about dosing. An absent date means
// "unknown", never "not taken". Kept separate from Observation because a missed
// dose and a missed reading are different events (§5.1).
interface DoseRecord {
  date: string;          // ISO yyyy-mm-dd
  taken: boolean;
}

interface Protocol {
  title: string;
  intervention: {
    name: string;
    dose: string;          // free text, never validated or suggested
    schedule: string;      // free text, e.g. "Mon/Wed/Fri"
    onsetLagDays: number;  // days after start of B excluded from analysis
    washoutDays: number;   // days after end of B excluded from analysis
  };
  design: "AB" | "ABA" | "ABAB";
  primaryMetricId: string;
  secondaryMetricIds: string[];
  mcid: number;            // minimum clinically important difference, in metric units
  mcidRationale: string;   // required, min 20 chars. Forces the user to justify it.
  phases: { phase: Phase; startDate: string; endDate: string }[];
  stoppingRule: StoppingRule;
  analysisPlan: "phase_means_neff";  // only option in v1; the field exists so the hash covers it
  specVersion: string;     // the spec version this protocol was locked under, e.g. "1.2.0"
  // §3.5 and §4.4 both require the acknowledgment to be recorded in the protocol,
  // so both sit inside the hash. Always present, so the canonical form is stable.
  acknowledgments: {
    underpowered: boolean; // proceeded knowing the design is underpowered
    efficacyGate: boolean; // accepted the type I error cost of an efficacy gate
  };
}

type StoppingRule =
  | { kind: "none" }
  | { kind: "futility"; date: string; condition: string }   // condition is generated, not free text
  | { kind: "efficacy"; date: string; condition: string };  // shows a warning, see §4.4
```

---

## 2. Data import

Two paths, both landing in `Observation[]`.

**CSV import.** Do not hardcode any device's column names. Parse the header, show a column-mapping step: user picks the date column and maps each metric column to a `Metric`. Persist the mapping so re-import of the same export format is one click. Support ISO dates and `MM/DD/YYYY`; if a date column parses ambiguously, ask rather than guess.

**Manual daily entry.** One screen, today's date pre-filled, one field per metric plus a confounder multi-select and a note field. Should be usable in under fifteen seconds.

**Confounders** are a fixed starting list the user can extend: illness, travel, alcohol, poor sleep, hard workout, unusual stress, missed dose, other. They are not used in the primary analysis. They power a sensitivity re-run (§5.3).

Missing days are allowed and represented as absent rows, not zeros. Never interpolate.

---

## 3. Statistics core

This is the part that has to be right. Put it in `src/stats/`, pure functions, no React imports.

### 3.1 Detrend

Given a metric series over the baseline phase:

1. Day-of-week means are subtracted **only if both** of these hold:
   - there are ≥ 28 observations, and
   - a one-way F test across weekdays rejects at p < 0.10.

   Offsets are centered (weekday mean minus grand mean) so step 1 removes the weekly shape and nothing else. Four observations per weekday is the floor at which a weekday mean carries any information; three is noise, and subtracting noise shrinks sigma and inflates power. The F gate exists for the same reason: an unconditional fit always removes *something*, and whatever it removes is credited to signal. If either condition fails, report `dowOffsets` as null and state plainly that no weekly pattern was removed. Under-correcting here is conservative. Over-correcting is not.
2. Fit an OLS linear trend on day index, subtract it.
3. Residuals are what all downstream noise estimates use.

Return the residual series, the fitted slope (units/day), the day-of-week offsets, and the F test's p-value. Surface the slope in the UI: a baseline that is already drifting is the single most common reason an n=1 result is spurious, and the user should see it before they lock anything.

### 3.2 Noise and effective sample size

```
sigma  = sd(residuals)                  // with n-1 denominator
r1     = lag-1 autocorrelation of residuals, per calendar day (see below)
g      = median calendar days between consecutive observations
r_eff  = r1 > 0 ? r1 ^ g : 0            // correlation between neighbouring readings
n_eff  = r_eff > 0 ? n_obs * (1 - r_eff) / (1 + r_eff) : n_obs
```

Floor `n_eff` at 2. Daily physiological metrics are autocorrelated, typically r1 in 0.2 to 0.5, and ignoring it inflates confidence by 20 to 50 percent. Every count that feeds a test statistic is `n_eff`, never raw `n`.

**`n_eff` counts observations, not calendar days, and uses the correlation at the spacing they were actually taken.** The `(1-r)/(1+r)` factor assumes `r` is the correlation between *consecutive observations*. Since r1 is defined per calendar day, a metric recorded every other day carries `r1^2` from one reading to the next, not `r1`. Using the per-day figure directly would understate how independent sparse readings are, which is conservative in the wrong place — it discards real information the user paid for by collecting data over a longer span.

Display r1 to the user in plain language: "Your day-to-day HRV carries over. 30 days of data is worth about 16 independent days."

**Estimating r1 when days are missing.** A pair of rows that are adjacent in the table but a week apart on the calendar is not a lag-1 pair, and counting it as one understates carryover. Only pairs exactly one calendar day apart contribute. That exclusion has to be paid for on both sides of the ratio:

```
r1 = [ Σ over the m valid pairs of (x_t - xbar)(x_{t+1} - xbar) / m ]
   / [ Σ over the n observations of (x_t - xbar)^2 / n ]
```

Normalizing the numerator by the full `n` — the textbook form, which assumes only the single end-of-series pair is missing — deflates `r1` by roughly the fraction of pairs the gaps eat. At a true r1 of 0.5 with half the pairs spanning gaps, that reports r1 ≈ 0.25 and `n_eff` ≈ 0.6n instead of n/3, making the MDE about 35 percent too small. That is the same inflated confidence the gap rule exists to prevent, arriving by a quieter route.

**Below 10 valid adjacent-day pairs, do not use this estimator.** Say so explicitly rather than letting a thin denominator hide it, and fall through to the sparse case.

**Sparse series.** A metric recorded every other day has no adjacent-day pairs at all, and must not therefore be treated as uncorrelated. Under the AR(1) assumption this section already makes, correlation decays geometrically with lag, so estimate at whichever lag k does have pairs and convert back to a per-day figure:

```
r1 = r_k ^ (1/k)
```

Use the smallest k with at least 10 valid pairs. If r_k ≤ 0, report r1 = 0. If no lag has enough pairs, report that r1 could not be estimated and warn that the resulting `n_eff` assumes independence and therefore overstates precision — never present that case as a clean result.

### 3.3 Minimum detectable effect

Two-sided alpha 0.05, power 0.80, so `z_a + z_b = 1.95996 + 0.84162 = 2.80158`.

```
MDE = 2.80158 * sigma * sqrt(1/n1_eff + 1/n2_eff)
```

where `n1_eff` is the baseline phase and `n2_eff` the planned intervention phase. Convert the planned schedule to effective counts the same way §3.2 does: the user declares an **adherence rate** (readings per calendar day — three days a week is 3/7), planned readings are `n_days * adherence`, the spacing between them is `1/adherence`, and `r_eff = r1 ^ (1/adherence)`.

### 3.4 Required duration

Solve for the intervention phase length that makes MDE equal the user's declared MCID:

```
k = (mcid / (2.80158 * sigma))^2
denom = k - 1/n1_eff
if denom <= 0  -> infeasible at this baseline length; report how many extra baseline days
                  would fix it, AND the MCID this design could already detect
n2_eff  = 1 / denom
n2_obs  = n2_eff * (1 + r_eff) / (1 - r_eff)   // readings, at the planned spacing
n2_days = n2_obs / adherence                   // calendar days the user actually schedules
```

Solve for **readings** first, then convert to calendar days through the adherence rate. These differ by exactly that rate, and reporting only the reading count tells a three-day-a-week user "42 days" when they mean fourteen weeks. Report both: the user schedules in days, the statistics run in readings.

### 3.5 The power verdict

This is the screen the whole product exists for. After the user declares an MCID and a planned schedule, show one of three states:

- **Adequate.** MDE ≤ MCID. State the MDE and move on.
- **Underpowered.** MDE > MCID. Say so directly, give the number of additional days needed, and offer three ways out: extend the phases, pick a lower-noise metric, or declare a larger MCID and accept that you can only detect a bigger effect. Do not let the user proceed to lock without acknowledging this on a checkbox that records their acknowledgment in the protocol.
- **Infeasible.** Even a long phase cannot reach the MCID at this noise level. Say the experiment cannot answer the question as posed. This is a useful answer and should not be softened.

---

## 4. Pre-registration

### 4.1 The lock

The user fills the protocol, sees the power verdict, and locks. On lock:

1. Serialize the `Protocol` to canonical JSON: keys sorted recursively, no whitespace, numbers in a fixed format.
2. SHA-256 it via `crypto.subtle.digest`.
3. Store `{ protocol, hash, lockedAt: ISO timestamp }`.
4. The protocol becomes read-only. Amendments are possible but create a new versioned record with its own hash, and the analysis screen shows an amendment count. Amendments after the intervention phase begins are marked as such, permanently.

### 4.2 Why the hash matters

Surface this in the UI in one sentence: post the hash somewhere public and dated, and you can later prove you did not move the goalposts. That is the difference between a self-experiment and a story about a self-experiment.

### 4.3 The protocol sheet

Generate a one-page printable document: what is being tested, the primary outcome and why it was chosen, the MCID and its rationale, phase dates, the stopping rule, the analysis method, and the hash. Plain enough to hand to a clinician. This is the export a user actually shows another human, so it gets real typographic attention.

### 4.4 Stopping rules

The stopping-rule builder generates the condition text from structured input; it is not a free-text box.

**Futility gates are safe.** "Stop at day N if the observed difference is smaller than X" costs almost nothing in false-positive rate. Offer this as the default and pre-fill X at half the MCID.

**Efficacy gates are not.** "Stop early and declare success if the difference exceeds X" inflates the type I error rate. If the user picks one, show a plain-language warning and record their acknowledgment in the protocol. Do not silently apply an alpha correction; explain the tradeoff and let them choose.

---

## 5. Analysis

Unlocks only when the protocol's final phase end date has passed, or when the user explicitly runs an interim look at a pre-registered gate date. Any other look is labeled **exploratory** in the output, permanently and unmissably.

### 5.1 Phase assembly

Exclude the onset window from the start of each intervention phase and `washoutDays` from the start of each withdrawal phase. Excluded days are shown on the chart, greyed, never deleted. For `ABA` and `ABAB`, pool the A phases.

**The onset window is anchored to the first dose taken, not to the phase start date.** A missed observation and a missed dose are different events. If the user misses their first two doses, the pharmacological clock has not started, but a window counted from the phase start has already burned two of its days — so days the window existed to exclude end up in the analysis set. Count `onsetLagDays` forward from the earliest `DoseRecord` with `taken: true` inside the phase, and exclude everything before it as pre-treatment.

With no dose log, fall back to the phase start date and warn wherever a `missed dose` confounder falls inside the window, so the violated assumption is visible rather than silent.

### 5.2 The test

Difference in phase means, with a Welch-style standard error built on effective counts:

```
se = sqrt(sigmaA^2/nA_eff + sigmaB^2/nB_eff)
df = Welch-Satterthwaite on (sigmaA, nA_eff, sigmaB, nB_eff)
ci = diff +/- t(0.975, df) * se
```

Report the difference in metric units, the CI, and the pre-registered verdict. State the verdict against the MCID, not against zero: "the effect is at least as large as your declared threshold," "the effect is smaller than your threshold," or "inconclusive, the interval spans your threshold." A p-value may appear, small, below the CI. It is not the headline.

### 5.3 Sensitivity

One button, re-runs the same analysis with confounder-flagged days dropped. Show both results side by side. If they disagree, say so.

### 5.4 The run chart

The primary output. Time on x, metric on y, one point per day. Phase boundaries as vertical rules with labels. Phase means as horizontal segments spanning each phase. Excluded days greyed. Confounder days marked with a small tick below the axis. The MCID drawn as a shaded band around the baseline mean, so the reader can see whether the intervention phase cleared it without reading a single number.

### 5.5 Spec version check

`specVersion` is a field inside the hashed protocol object (§1), so it is covered by the lock and cannot be revised after the fact.

Before running any analysis, compare the locked protocol's `specVersion` against the build's. On a mismatch the analysis either refuses to run or runs behind a warning that is visible in the output and in every export, naming both versions. A protocol locked under one set of statistical rules and analyzed under another is not pre-registered in any meaningful sense — the goalposts moved, just not by the user's hand. Refusing is the default; the warning path exists so that old protocols stay readable rather than becoming inert.

---

## 6. Design direction

Keep it disciplined. The subject's world is the lab notebook and the run chart, not the wellness app.

- **Palette:** ink `#16202B`, paper `#EDF0F2`, rule `#C9D4DC`, baseline phase `#3F6E7A`, intervention phase `#A32E6E`, exclusion grey `#9AA7B0`. Two phase colors, used only for phases, nowhere else.
- **Type:** Spectral for headings and the protocol sheet, IBM Plex Sans for interface, IBM Plex Mono for every number, hash, and axis label. Numbers are tabular-figure and never in the body face.
- **Signature element:** the lock. When the protocol locks, the form visibly becomes a document: fields flatten into typeset lines, the hash types out in mono, and a dated stamp lands in the corner. One animation, orchestrated, respecting `prefers-reduced-motion`. Everything else in the app is still.
- **Copy:** name things by what the user controls. "Lock this protocol," not "Submit." Errors say what happened and what to do. Empty states say what to add first.

Quality floor without announcing it: responsive to mobile, visible keyboard focus, reduced motion respected.

---

## 7. Optional LLM layer

Off by default. User supplies their own Anthropic API key, held in memory only, never written to `localStorage`, cleared on reload. Two functions and no others:

1. **Clinician summary.** Turn the locked protocol into three paragraphs of plain prose.
2. **Confounder suggestions.** Given the intervention name and metric, suggest confounders worth tracking. Suggestions only; the user accepts or rejects each.

Hard rules, enforced in the system prompt and in the UI:

- It never computes, checks, or comments on a statistic.
- It never suggests an intervention, a dose, a schedule, or a substitute.
- It never interprets a symptom or a result as evidence of any diagnosis.
- If asked to do any of the above, it declines in one sentence and points back to the tool.

If the key is absent, every feature in this app except these two works normally.

---

## 8. Tests

`src/stats/` does not merge without these passing.

1. **Autocorrelation recovery.** Generate AR(1), r=0.5, sigma=1, n=2000, fixed seed. Estimator returns r1 within ±0.08. `n_eff` lands within 10% of n/3.
2. **White noise.** r1 ≈ 0 within ±0.06; `n_eff` ≈ n.
3. **MDE hand-check.** sigma=10, nA_eff=nB_eff=20 → MDE = 2.80158 × 10 × sqrt(0.1) = 8.859, within 1e-3.
4. **Duration inversion.** Feed the output of §3.4 back into §3.3 and confirm MDE returns the MCID within 1e-6.
5. **Infeasibility.** mcid=1, sigma=10, n1_eff=20 → `denom <= 0`, reports infeasible, does not return a negative or NaN duration.
6. **Detrend.** Series with a known slope of 0.4/day plus noise → recovered slope within ±0.05; residual mean ≈ 0.
7. **Hash canonicalization.** Two `Protocol` objects with identical values and different key insertion order produce the same SHA-256. Changing one MCID digit changes it.
8. **Phase exclusion.** onsetLag=3 on a 30-day intervention phase leaves 27 days in the analysis set and 3 flagged excluded.
9. **Missing days.** A series with 5 absent dates produces the same sigma as the same series with those dates never entered. No interpolation anywhere.

---

## 9. Milestones

Ship 1 through 4. Five is optional.

1. **Stats core + tests.** No UI. A CLI that takes a CSV and prints the power report. This is the whole product's credibility; get it right before anything is rendered.
2. **Import and power verdict.** CSV mapping, baseline chart, the three-state verdict screen.
3. **Lock.** Protocol builder, stopping-rule builder, hash, printable protocol sheet, the lock animation.
4. **Analysis.** Daily entry, run chart, phase-means test, sensitivity re-run, exploratory labeling.
5. **LLM layer.** Clinician summary and confounder suggestions.

Acceptance for shipping: a user can go from a WHOOP CSV to a locked, hashed protocol in under ten minutes without reading documentation, and the app tells at least one user their planned experiment is underpowered before they start it.

---

## 10. Non-goals

Not a tracker. Not a symptom diary. Not a community. Not a recommender. It designs and adjudicates one experiment that the user has already decided to run. Every feature request that starts with "it could also" gets measured against that sentence.

**Safety:** a persistent, quiet line in the footer, not a modal. This tool does not give medical advice and does not recommend treatments. Talk to your clinician before starting or stopping anything.

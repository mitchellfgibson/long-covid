# Pipeline

An n=1 experiment designer and analyzer for people running self-experiments on chronic
conditions. The thesis: **the value is in locking the decision rule before you see the data.**

It designs and adjudicates one experiment you have already decided to run. It is not a
tracker, not a symptom diary, and not a recommender — it never suggests what to try.

The screen it exists for is the one that tells you, *before* you start, whether the change
you care about is even visible through your own day-to-day noise. Three answers: adequate,
underpowered by this many days, or infeasible at any length.

```bash
npm install
npm run dev        # the app
npm test           # 95 tests, including the nine from SPEC §8
npm run typecheck
npm run build      # static bundle in dist/
```

Everything lives in `localStorage`, with JSON export and import. Nothing leaves the device
except the optional writing help in §7, which is off until you paste your own API key.

## Command line

The stats core runs without any of the UI:

```bash
npm run power -- data.csv --date "Cycle start time" --metric "HRV (ms)" \
  --mcid 5 --plan 30 --unit ms [--adherence 0.43] [--date-format iso|mdy]
```

Run it with just a filename to list the file's columns.

## Layout

| Path | What |
| --- | --- |
| `src/stats/series.ts` | Date handling, series extraction, mean/SD |
| `src/stats/detrend.ts` | §3.1 F-gated day-of-week fit and linear detrend |
| `src/stats/noise.ts` | §3.2 sigma, per-day autocorrelation, `n_eff` at observed spacing |
| `src/stats/fdist.ts` | F and t distributions, one-way ANOVA |
| `src/stats/power.ts` | §3.3–3.5 MDE, required duration, three-state verdict |
| `src/stats/phases.ts` | §5.1 phase assignment, first-dose onset anchoring |
| `src/stats/analysis.ts` | §5.2–5.3 Welch phase-means test, sensitivity, exploratory rule |
| `src/stats/canonical.ts` | §4.1 canonical JSON and SHA-256 |
| `src/stats/version.ts` | §5.5 `specVersion` check |
| `src/stats/csv.ts` | §2 CSV parse, date-format detection, column mapping |
| `src/state/store.tsx` | `useReducer` + context, localStorage persistence |
| `src/ui/` | Screens and hand-rolled SVG charts |
| `src/llm/client.ts` | §7 optional layer — two functions, no statistics in scope |
| `src/cli/power-report.ts` | The command-line power report |

`src/stats/` is pure functions with no React import and no network call. The §0 rule that no
LLM touches a number is structural: nothing in that directory can reach one, and the two LLM
functions are never passed a computed value.

## Reading the code

[SPEC.md](SPEC.md) is the contract, currently version 1.2.0. Protocols record the version they
were locked under, and the analysis refuses to run against a mismatch.

[DECISIONS.md](DECISIONS.md) records every ambiguity in the spec and how it was resolved,
newest round first — including the ones where the spec itself turned out to be wrong.

---

Pipeline does not give medical advice and does not recommend treatments. Talk to your
clinician before starting or stopping anything.

# Runsheet — milestone 1

Stats core plus a CLI. No UI; nothing is rendered yet, by design (§9.1: "get it right
before anything is rendered").

```bash
npm install
npm test          # the §8 known-answer tests
npm run typecheck
```

## Power report

```bash
npm run power -- data.csv --date "Cycle start time" --metric "HRV (ms)" \
  --mcid 5 --plan 30 --unit ms
```

Run it with just the filename to list the file's columns. Add `--date-format mdy` if
the dates are `MM/DD/YYYY` and ambiguous enough that the parser stops to ask.

Output: baseline sigma after detrending, the drift slope, the lag-1 autocorrelation and
what it costs you in effective days, then the three-state verdict from §3.5.

## Layout

| Path | What |
| --- | --- |
| `src/stats/series.ts` | Date handling, series extraction, mean/SD |
| `src/stats/detrend.ts` | §3.1 day-of-week and linear detrend |
| `src/stats/noise.ts` | §3.2 sigma, lag-1 autocorrelation, `n_eff` |
| `src/stats/power.ts` | §3.3–3.5 MDE, required duration, verdict |
| `src/stats/phases.ts` | §5.1 phase assignment and exclusion flagging |
| `src/stats/canonical.ts` | §4.1 canonical JSON and SHA-256 |
| `src/stats/csv.ts` | §2 CSV parse, date-format detection, column mapping |
| `src/cli/power-report.ts` | The CLI |

`src/stats/` is pure functions with no React import and no network call — the §0 rule
that no LLM touches a number is structural here, since nothing in this directory can
reach one.

Ambiguities in the spec and how they were resolved: [DECISIONS.md](DECISIONS.md).

---

This tool does not give medical advice and does not recommend treatments. Talk to your
clinician before starting or stopping anything.

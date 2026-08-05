import { useMemo, useState } from "react";
import {
  DuplicateValueError,
  detectDateFormat,
  normalizeDate,
  parseCsv,
  rowsToObservations,
  type DateFormat,
  type ValueConflict,
} from "../stats/csv";
import type { Metric } from "../types";
import { useDispatch, useStore } from "../state/store";

type Stage =
  | { kind: "idle" }
  | { kind: "mapping"; rows: string[][] }
  | { kind: "conflicts"; conflicts: ValueConflict[] };

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "") || "metric";

/**
 * A first guess at units from the column name, since exports encode them there.
 * Always editable — a wrong guess is cosmetic, and the user sees it before locking.
 * Direction is deliberately *not* guessed: it decides which way the §5.2 verdict
 * reads, and inferring "lower is better" from a name would silently invert a result.
 */
function guessUnit(column: string): string {
  const c = column.toLowerCase();
  const bracket = /[([]([^)\]]{1,12})[)\]]/.exec(column);
  if (bracket) return bracket[1]!.trim();
  if (/_ms$|\bms\b/.test(c)) return "ms";
  if (/_pct$|_percent$|%/.test(c)) return "%";
  if (/_min$|_mins$|_minutes$/.test(c)) return "min";
  if (/_hours$|_hrs$/.test(c)) return "h";
  if (/_bpm$|_hr$|heart_rate/.test(c)) return "bpm";
  if (/_c$|_celsius$/.test(c)) return "°C";
  return "";
}

export function Import() {
  const state = useStore();
  const dispatch = useDispatch();
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [dateColumn, setDateColumn] = useState("");
  const [dateFormat, setDateFormat] = useState<DateFormat | "">("");
  const [chosen, setChosen] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  const header = stage.kind === "mapping" ? (stage.rows[0] ?? []) : [];

  // §2: never guess an ambiguous date column — ask.
  const detected = useMemo(() => {
    if (stage.kind !== "mapping" || !dateColumn) return null;
    const idx = header.indexOf(dateColumn);
    if (idx < 0) return null;
    return detectDateFormat(stage.rows.slice(1, 60).map((r) => r[idx] ?? ""));
  }, [stage, dateColumn, header]);

  const resolvedFormat: DateFormat | "" =
    dateFormat ||
    (detected?.kind === "iso" || detected?.kind === "mdy" || detected?.kind === "dmy"
      ? detected.kind
      : "");

  /** How many days actually carry a number, per column. A column of blanks is not a metric. */
  const counts = useMemo(() => {
    if (stage.kind !== "mapping") return {};
    const out: Record<string, number> = {};
    header.forEach((col, i) => {
      if (col === dateColumn) return;
      out[col] = stage.rows.slice(1).filter((r) => {
        const cell = r[i]?.trim() ?? "";
        return cell !== "" && Number.isFinite(Number(cell));
      }).length;
    });
    return out;
  }, [stage, header, dateColumn]);

  /** Show one real value and what it will become, so a wrong reading is visible before import. */
  const sampleDate = useMemo(() => {
    if (stage.kind !== "mapping" || !dateColumn || !resolvedFormat) return null;
    const idx = header.indexOf(dateColumn);
    const raw = stage.rows.slice(1).map((r) => r[idx] ?? "").find((v) => v.trim() !== "");
    if (!raw) return null;
    try {
      return { raw: raw.trim(), parsed: normalizeDate(raw, resolvedFormat) };
    } catch {
      return null;
    }
  }, [stage, dateColumn, header, resolvedFormat]);

  async function onFile(file: File) {
    setError(null);
    const rows = parseCsv(await file.text());
    if (rows.length < 2) {
      setError("That file has no data rows.");
      return;
    }
    setStage({ kind: "mapping", rows });

    // Pre-fill from the saved mapping when the columns match (§2: one click).
    const saved = state.savedMapping;
    const cols = rows[0] ?? [];
    if (saved && cols.includes(saved.dateColumn)) {
      setDateColumn(saved.dateColumn);
      setDateFormat(saved.dateFormat);
      setChosen(Object.fromEntries(Object.keys(saved.metricColumns).map((c) => [c, cols.includes(c)])));
    } else {
      setDateColumn("");
      setDateFormat("");
      setChosen({});
    }
  }

  function commit() {
    if (stage.kind !== "mapping") return;
    const fmt = resolvedFormat;
    if (!dateColumn || !fmt) return;

    const metricColumns: Record<string, string> = {};
    for (const [col, on] of Object.entries(chosen)) if (on) metricColumns[col] = slug(col);
    if (Object.keys(metricColumns).length === 0) {
      setError("Pick at least one column to bring in as a metric.");
      return;
    }

    const mapping = { dateColumn, dateFormat: fmt as DateFormat, metricColumns };
    try {
      const observations = rowsToObservations(stage.rows, mapping);
      const metrics: Metric[] = Object.entries(metricColumns).map(([col, id]) => ({
        id,
        label: col,
        unit: guessUnit(col),
        direction: "higher_is_better",
      }));
      dispatch({ type: "import", observations, metrics, mapping });
      setStage({ kind: "idle" });
      setError(null);
    } catch (err) {
      if (err instanceof DuplicateValueError) {
        setStage({ kind: "conflicts", conflicts: err.conflicts });
        return;
      }
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (stage.kind === "conflicts") {
    return (
      <section>
        <h2>Two readings, one day</h2>
        <p>
          These days have two different values for the same metric. They won't be averaged — the
          average is a number you never recorded. Pick the right one, fix the file, import again.
        </p>
        <div className="card scroll-x">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Metric</th>
                <th>Values found</th>
              </tr>
            </thead>
            <tbody>
              {stage.conflicts.map((c) => (
                <tr key={`${c.date}-${c.metricId}`}>
                  <td className="n">{c.date}</td>
                  <td>{c.metricId}</td>
                  <td className="n">{c.values.join("   vs   ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button className="secondary" onClick={() => setStage({ kind: "idle" })}>
          Start over
        </button>
      </section>
    );
  }

  if (stage.kind === "mapping") {
    const ambiguous = detected?.kind === "ambiguous";
    const unparseable = detected?.kind === "unparseable";
    const ready = Boolean(dateColumn) && Boolean(resolvedFormat);

    return (
      <section className="stack">
        <h2>Map the columns</h2>
        <p>
          Tell it which column is the date and which ones you want to track. It remembers this for
          next time.
        </p>

        <div className="card">
          <div className="field">
            <label htmlFor="datecol">Date column</label>
            <select id="datecol" value={dateColumn} onChange={(e) => setDateColumn(e.target.value)}>
              <option value="">Choose a column…</option>
              {header.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
          </div>

          {ambiguous && (
            <div className="warn">
              <strong>Which comes first, the month or the day?</strong>
              Every value here has both numbers at 12 or below, so it reads either way. Guessing
              would move your readings by up to eleven months. Which is it?
              <div className="row" style={{ marginTop: "0.6rem" }}>
                <button
                  className={dateFormat === "mdy" ? "" : "secondary"}
                  onClick={() => setDateFormat("mdy")}
                >
                  Month first — 03/04 is 4 March
                </button>
                <button
                  className={dateFormat === "dmy" ? "" : "secondary"}
                  onClick={() => setDateFormat("dmy")}
                >
                  Day first — 03/04 is 3 April
                </button>
              </div>
            </div>
          )}

          {unparseable && (
            <div className="warn">
              <strong>Those dates aren't readable.</strong>
              {detected?.kind === "unparseable" && detected.samples.length > 0 && (
                <div style={{ margin: "0.4rem 0" }}>
                  Pipeline saw{" "}
                  {detected.samples.map((s, i) => (
                    <span key={i}>
                      {i > 0 && ", "}
                      <span className="mono">"{s}"</span>
                    </span>
                  ))}
                  .
                </div>
              )}
              It reads year-first dates (<span className="mono">2026-01-05</span>), day/month/year
              with slashes, dots or dashes, and month names (
              <span className="mono">5 Jan 2026</span>). A trailing time is fine and gets ignored.
              Two-digit years are not accepted, because the century would be a guess.
            </div>
          )}

          {detected && !ambiguous && !unparseable && (
            <p className="hint">
              Dates read as{" "}
              <span className="mono">
                {detected.kind === "iso"
                  ? "year first"
                  : detected.kind === "dmy"
                    ? "day/month/year"
                    : "month/day/year"}
              </span>
              {sampleDate && (
                <>
                  {" "}
                  — <span className="mono">{sampleDate.raw}</span> reads as{" "}
                  <span className="mono">{sampleDate.parsed}</span>.
                </>
              )}
            </p>
          )}
        </div>

        <div className="card">
          <h3>Metrics to bring in</h3>
          <p className="hint" style={{ marginBottom: "0.8rem" }}>
            The count is how many days actually have a value. Empty columns can't be analyzed, so
            they're greyed out.
          </p>
          {header
            .filter((h) => h !== dateColumn)
            .map((h) => {
              const n = counts[h] ?? 0;
              return (
                <label
                  key={h}
                  style={{ fontWeight: 400, marginBottom: "0.4rem", opacity: n === 0 ? 0.45 : 1 }}
                >
                  <input
                    type="checkbox"
                    checked={Boolean(chosen[h]) && n > 0}
                    disabled={n === 0}
                    onChange={(e) => setChosen({ ...chosen, [h]: e.target.checked })}
                    style={{ width: "auto", marginRight: "0.5em" }}
                  />
                  {h}{" "}
                  <span className="mono" style={{ fontSize: "0.8rem", color: "var(--ink-60)" }}>
                    {n === 0 ? "empty" : `${n} reading${n === 1 ? "" : "s"}`}
                  </span>
                </label>
              );
            })}
        </div>

        {error && <div className="warn">{error}</div>}

        <div className="row">
          <button onClick={commit} disabled={!ready}>
            Bring in {stage.rows.length - 1} rows
          </button>
          <button className="secondary" onClick={() => setStage({ kind: "idle" })}>
            Cancel
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="stack">
      <h2>Bring in your data</h2>
      <p>
        A CSV from whatever you already use — WHOOP, Oura, a spreadsheet — one row per day. Nothing
        leaves your device.
      </p>

      <div className="card">
        <label htmlFor="csv">CSV file</label>
        <input
          id="csv"
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onFile(f);
          }}
        />
        {state.savedMapping && (
          <p className="hint">
            You have a saved mapping for <span className="mono">{state.savedMapping.dateColumn}</span>.
            Re-importing the same export format will be one click.
          </p>
        )}
      </div>

      {error && <div className="warn">{error}</div>}

      {state.observations.length > 0 ? (
        <>
          <div className="card">
            <h3>Already loaded</h3>
            <div className="stat">
              <span>Days with at least one reading</span>
              <span className="v">{state.observations.length}</span>
            </div>
            <div className="stat">
              <span>Span</span>
              <span className="v">
                {state.observations[0]?.date} to{" "}
                {state.observations[state.observations.length - 1]?.date}
              </span>
            </div>
          </div>

          <div className="card">
            <h3>Your metrics</h3>
            <p className="hint" style={{ marginBottom: "0.8rem" }}>
              Which way is better decides how your result reads. A drop in resting heart rate is
              good; a drop in HRV isn't. This isn't guessed for you.
            </p>
            <div className="scroll-x">
              <table>
                <thead>
                  <tr>
                    <th>Metric</th>
                    <th>Readings</th>
                    <th>Unit</th>
                    <th>Which way is better?</th>
                  </tr>
                </thead>
                <tbody>
                  {state.metrics.map((m) => {
                    const n = state.observations.filter(
                      (o) => o.values[m.id] !== undefined && o.values[m.id] !== null,
                    ).length;
                    return (
                      <tr key={m.id}>
                        <td>{m.label}</td>
                        <td className="n">{n}</td>
                        <td>
                          <input
                            type="text"
                            aria-label={`Unit for ${m.label}`}
                            value={m.unit}
                            placeholder="—"
                            style={{ maxWidth: "6rem" }}
                            onChange={(e) =>
                              dispatch({
                                type: "updateMetric",
                                id: m.id,
                                patch: { unit: e.target.value },
                              })
                            }
                          />
                        </td>
                        <td>
                          <select
                            aria-label={`Direction for ${m.label}`}
                            value={m.direction}
                            style={{ maxWidth: "12rem" }}
                            onChange={(e) =>
                              dispatch({
                                type: "updateMetric",
                                id: m.id,
                                patch: { direction: e.target.value as Metric["direction"] },
                              })
                            }
                          >
                            <option value="higher_is_better">Higher is better</option>
                            <option value="lower_is_better">Lower is better</option>
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        <div className="empty">
          <p style={{ margin: 0 }}>No data yet. Start with a CSV export, or enter days by hand.</p>
        </div>
      )}
    </section>
  );
}

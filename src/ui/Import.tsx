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
        unit: "",
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
          These dates carry more than one value for the same metric. Pipeline will not average them,
          because the average is a number you never recorded. Decide which reading is right, correct
          the file, and import it again.
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
          Pipeline does not assume any device's column names. Tell it which column is the date and
          which columns are metrics worth tracking. It remembers this for next time.
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
              Every value in this column has both numbers at 12 or below, so it reads either way.
              Guessing would silently move readings by up to eleven months. Tell Pipeline which is
              right.
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
            Pick the numbers you want to analyze. You can add more later.
          </p>
          {header
            .filter((h) => h !== dateColumn)
            .map((h) => (
              <label key={h} style={{ fontWeight: 400, marginBottom: "0.4rem" }}>
                <input
                  type="checkbox"
                  checked={Boolean(chosen[h])}
                  onChange={(e) => setChosen({ ...chosen, [h]: e.target.checked })}
                  style={{ width: "auto", marginRight: "0.5em" }}
                />
                {h}
              </label>
            ))}
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
        Export a CSV from whatever you already use — a WHOOP or Oura export, a spreadsheet, anything
        with one row per day. Nothing leaves your device.
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
        <div className="card">
          <h3>Already loaded</h3>
          <div className="stat">
            <span>Readings</span>
            <span className="v">{state.observations.length}</span>
          </div>
          <div className="stat">
            <span>Metrics</span>
            <span className="v">{state.metrics.map((m) => m.label).join(", ") || "—"}</span>
          </div>
          <div className="stat">
            <span>Span</span>
            <span className="v">
              {state.observations[0]?.date} to {state.observations[state.observations.length - 1]?.date}
            </span>
          </div>
        </div>
      ) : (
        <div className="empty">
          <p style={{ margin: 0 }}>No data yet. Start with a CSV export, or enter days by hand.</p>
        </div>
      )}
    </section>
  );
}

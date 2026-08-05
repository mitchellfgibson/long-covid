import { useState } from "react";
import { useDispatch, useStore } from "../state/store";
import type { Observation } from "../types";

const today = () => new Date().toISOString().slice(0, 10);

export function DailyEntry() {
  const state = useStore();
  const dispatch = useDispatch();

  const [date, setDate] = useState(today());
  const [values, setValues] = useState<Record<string, string>>({});
  const [confounders, setConfounders] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [dose, setDose] = useState<"" | "taken" | "missed">("");
  const [saved, setSaved] = useState(false);
  const [newConfounder, setNewConfounder] = useState("");

  const existing = state.observations.find((o) => o.date === date);

  function save() {
    const parsed: Record<string, number | null> = {};
    for (const m of state.metrics) {
      const raw = values[m.id]?.trim();
      // Blank stays absent. A day you didn't measure is not a zero.
      if (raw) {
        const v = Number(raw);
        if (Number.isFinite(v)) parsed[m.id] = v;
      }
    }

    const observation: Observation = {
      date,
      values: { ...(existing?.values ?? {}), ...parsed },
      confounders,
      ...(note.trim() ? { note: note.trim() } : {}),
    };
    dispatch({ type: "upsertObservation", observation });
    if (dose) dispatch({ type: "setDose", dose: { date, taken: dose === "taken" } });

    setSaved(true);
    setValues({});
    setConfounders([]);
    setNote("");
    setDose("");
    window.setTimeout(() => setSaved(false), 2200);
  }

  function addConfounder() {
    const label = newConfounder.trim();
    if (!label) return;
    const id = label.toLowerCase().replace(/[^a-z0-9]+/g, "_");
    dispatch({ type: "addConfounder", id, label });
    setConfounders([...confounders, id]);
    setNewConfounder("");
  }

  return (
    <section className="stack">
      <h2>Today</h2>
      <p>Leave anything you didn't measure blank. A missing day stays missing and never gets filled in.</p>

      <div className="card">
        <div className="field">
          <label htmlFor="date">Date</label>
          <input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          {existing && (
            <p className="hint">
              You already have a reading for this day. Saving updates only the fields you fill in.
            </p>
          )}
        </div>

        {state.metrics.length === 0 ? (
          <p className="hint">No metrics yet. Import a CSV first.</p>
        ) : (
          state.metrics.map((m) => (
            <div className="field" key={m.id}>
              <label htmlFor={`v-${m.id}`}>
                {m.label}
                {m.unit ? ` (${m.unit})` : ""}
              </label>
              <input
                id={`v-${m.id}`}
                type="number"
                step="any"
                inputMode="decimal"
                value={values[m.id] ?? ""}
                onChange={(e) => setValues({ ...values, [m.id]: e.target.value })}
                placeholder={
                  existing?.values[m.id] !== undefined && existing.values[m.id] !== null
                    ? String(existing.values[m.id])
                    : ""
                }
              />
            </div>
          ))
        )}

        <div className="field">
          <label>Dose</label>
          <div className="row">
            {(["taken", "missed"] as const).map((k) => (
              <button
                key={k}
                type="button"
                className={dose === k ? "" : "secondary"}
                onClick={() => setDose(dose === k ? "" : k)}
              >
                {k === "taken" ? "Took it" : "Missed it"}
              </button>
            ))}
          </div>
          <p className="hint">
            A missed dose isn't the same as a missed reading. Your onset window counts from the
            first dose you actually take.
          </p>
        </div>

        <div className="field">
          <label>Anything unusual today?</label>
          <div className="row">
            {state.confounders.map((c) => (
              <button
                key={c.id}
                type="button"
                className={confounders.includes(c.id) ? "" : "secondary"}
                onClick={() =>
                  setConfounders(
                    confounders.includes(c.id)
                      ? confounders.filter((x) => x !== c.id)
                      : [...confounders, c.id],
                  )
                }
              >
                {c.label}
              </button>
            ))}
          </div>
          <p className="hint">
            These don't touch the main analysis. You can re-run without these days later and see if
            it changes anything.
          </p>
          <div className="row" style={{ marginTop: "0.5rem" }}>
            <input
              type="text"
              value={newConfounder}
              onChange={(e) => setNewConfounder(e.target.value)}
              placeholder="Add your own"
              style={{ maxWidth: "14rem" }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addConfounder();
                }
              }}
            />
            <button type="button" className="secondary" onClick={addConfounder}>
              Add
            </button>
          </div>
        </div>

        <div className="field">
          <label htmlFor="note">Note</label>
          <textarea id="note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>

        <div className="row">
          <button onClick={save} disabled={state.metrics.length === 0}>
            Save {date === today() ? "today" : date}
          </button>
          {saved && <span className="hint" style={{ marginTop: 0 }}>Saved.</span>}
        </div>
      </div>
    </section>
  );
}

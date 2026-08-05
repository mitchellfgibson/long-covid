import { useState } from "react";
import { useDispatch, useLocked, useStore } from "../state/store";
import { clinicianSummary, suggestConfounders, type ConfounderSuggestion } from "../llm/client";

/**
 * §7. Off by default. The key lives in this component's state — memory only,
 * never localStorage, gone on reload. Every other feature in the app works
 * whether or not a key is present.
 */
export function Assist() {
  const state = useStore();
  const dispatch = useDispatch();
  const locked = useLocked();

  const [apiKey, setApiKey] = useState("");
  const [summary, setSummary] = useState("");
  const [suggestions, setSuggestions] = useState<ConfounderSuggestion[] | null>(null);
  const [rejected, setRejected] = useState<string[]>([]);
  const [busy, setBusy] = useState<"" | "summary" | "confounders">("");
  const [error, setError] = useState<string | null>(null);

  const metric = state.metrics.find((m) => m.id === locked?.protocol.primaryMetricId);
  const draftMetric = state.metrics.find((m) => m.id === state.draft.primaryMetricId);

  async function doSummary() {
    if (!locked) return;
    setBusy("summary");
    setError(null);
    try {
      setSummary(await clinicianSummary(apiKey, locked.protocol, metric?.label ?? "the metric"));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy("");
    }
  }

  async function doConfounders() {
    setBusy("confounders");
    setError(null);
    try {
      setSuggestions(
        await suggestConfounders(
          apiKey,
          state.draft.intervention?.name ?? locked?.protocol.intervention.name ?? "an intervention",
          draftMetric?.label ?? metric?.label ?? "a daily measurement",
          state.confounders.map((c) => c.label),
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="stack">
      <h2>Optional writing help</h2>
      <p>
        Off unless you turn it on. It does two things: writes your locked protocol up as prose, and
        suggests confounders to track. It never sees a single one of your numbers and can't touch
        your statistics.
      </p>

      <div className="card">
        <div className="field">
          <label htmlFor="key">Your Anthropic API key</label>
          <input
            id="key"
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-ant-…"
          />
          <p className="hint">
            Held in this tab only, never saved, gone when you reload. Your data stays on the device
            — only the protocol text goes out, and only when you press a button.
          </p>
        </div>
      </div>

      {error && <div className="warn">{error}</div>}

      <div className="card">
        <h3>Summary for a clinician</h3>
        <p className="hint" style={{ marginBottom: "0.8rem" }}>
          Three paragraphs on what you're testing and how you'll judge it. Design only, no results.
        </p>
        <button onClick={() => void doSummary()} disabled={!apiKey || !locked || busy !== ""}>
          {busy === "summary" ? "Writing…" : "Write the summary"}
        </button>
        {!locked && <p className="hint">Available once you have locked a protocol.</p>}
        {summary && (
          <div style={{ marginTop: "1rem", whiteSpace: "pre-wrap", maxWidth: "34rem" }}>{summary}</div>
        )}
      </div>

      <div className="card">
        <h3>Confounders worth tracking</h3>
        <p className="hint" style={{ marginBottom: "0.8rem" }}>
          Suggestions only. Nothing gets added unless you say so.
        </p>
        <button onClick={() => void doConfounders()} disabled={!apiKey || busy !== ""}>
          {busy === "confounders" ? "Thinking…" : "Suggest confounders"}
        </button>

        {suggestions?.length === 0 && <p className="hint">Nothing usable came back. Try again.</p>}

        {suggestions && suggestions.length > 0 && (
          <div style={{ marginTop: "1rem" }}>
            {suggestions
              .filter((s) => !rejected.includes(s.label))
              .filter((s) => !state.confounders.some((c) => c.label.toLowerCase() === s.label.toLowerCase()))
              .map((s) => (
                <div key={s.label} className="stat" style={{ alignItems: "center" }}>
                  <span>
                    <strong>{s.label}</strong>
                    {s.why && <span className="hint" style={{ display: "block", marginTop: 0 }}>{s.why}</span>}
                  </span>
                  <span className="row" style={{ flexWrap: "nowrap" }}>
                    <button
                      onClick={() =>
                        dispatch({
                          type: "addConfounder",
                          id: s.label.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
                          label: s.label,
                        })
                      }
                    >
                      Add
                    </button>
                    <button className="secondary" onClick={() => setRejected([...rejected, s.label])}>
                      No
                    </button>
                  </span>
                </div>
              ))}
          </div>
        )}
      </div>
    </section>
  );
}

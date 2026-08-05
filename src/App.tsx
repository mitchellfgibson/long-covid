import { useMemo, useState } from "react";
import { StoreProvider, useDispatch, useLocked, useStore, type AppState } from "./state/store";
import { Import } from "./ui/Import";
import { Verdict } from "./ui/Verdict";
import { Builder } from "./ui/Builder";
import { Sheet } from "./ui/Sheet";
import { DailyEntry } from "./ui/DailyEntry";
import { Analysis } from "./ui/Analysis";
import { Assist } from "./ui/Assist";

type Tab = "data" | "power" | "protocol" | "sheet" | "today" | "analysis" | "assist";

/** `cta` describes arriving at that stage, so a skipped stage never mislabels the button. */
const TABS: { id: Tab; label: string; cta: string }[] = [
  { id: "data", label: "1 · Data", cta: "Back to your data" },
  { id: "power", label: "2 · Can it work?", cta: "Check the power" },
  { id: "protocol", label: "3 · Protocol", cta: "Write the protocol" },
  { id: "sheet", label: "4 · Locked sheet", cta: "See the locked sheet" },
  { id: "today", label: "5 · Today", cta: "Log a day" },
  { id: "analysis", label: "6 · Result", cta: "See the result" },
  { id: "assist", label: "Writing help", cta: "Writing help" },
];

function Shell() {
  const [tab, setTab] = useState<Tab>("data");
  const [justLocked, setJustLocked] = useState(false);
  /** Which locked version the sheet shows. null means the current one. */
  const [viewLock, setViewLock] = useState<number | null>(null);
  const state = useStore();
  const dispatch = useDispatch();
  const locked = useLocked();

  const disabled = (id: Tab) =>
    (id === "sheet" && !locked) ||
    (id === "analysis" && !locked) ||
    (id === "power" && state.observations.length === 0);

  const index = TABS.findIndex((t) => t.id === tab);
  const nextTab = TABS.slice(index + 1).find((t) => !disabled(t.id));
  const prevTab = [...TABS.slice(0, index)].reverse().find((t) => !disabled(t.id));

  function go(id: Tab) {
    setTab(id);
    if (id !== "sheet") {
      setJustLocked(false);
      setViewLock(null);
    }
  }

  /** Newest first, so the one in play is at the top. */
  const history = useMemo(
    () => state.locks.map((l, i) => ({ ...l, index: i })).reverse(),
    [state.locks],
  );

  function exportJson() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `pipeline-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function importJson(file: File) {
    try {
      const parsed = JSON.parse(await file.text()) as AppState;
      dispatch({ type: "replaceAll", state: parsed });
    } catch {
      window.alert("That file could not be read as a Pipeline export.");
    }
  }

  return (
    <div className="shell">
      <header className="masthead">
        <h1>PIPELINE</h1>
        <span className="tagline">data backed exploration</span>

        <span style={{ marginLeft: "auto" }} className="row no-print">
          {state.locks.length > 0 && (
            <select
              aria-label="Your protocols"
              className="protocol-picker"
              value={viewLock === null ? "current" : String(viewLock)}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "new") {
                  dispatch({ type: "startNewProtocol" });
                  setViewLock(null);
                  go("protocol");
                  return;
                }
                setViewLock(v === "current" ? null : Number(v));
                setJustLocked(false);
                setTab("sheet");
              }}
            >
              <optgroup label="Your protocols">
                {history.map((l) => (
                  <option key={l.index} value={l.index === state.locks.length - 1 ? "current" : l.index}>
                    {l.index === state.locks.length - 1 ? "▸ " : "  "}
                    {l.protocol.title || "Untitled"} · {l.lockedAt.slice(0, 10)}
                    {l.index === state.locks.length - 1 ? " (active)" : ""}
                  </option>
                ))}
              </optgroup>
              <optgroup label="—">
                <option value="new">Start a new protocol…</option>
              </optgroup>
            </select>
          )}
          <button className="quiet" onClick={exportJson}>
            Export
          </button>
          <label className="quiet" style={{ marginBottom: 0, cursor: "pointer" }}>
            Import
            <input
              type="file"
              accept="application/json"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void importJson(f);
              }}
            />
          </label>
        </span>
      </header>

      <nav className="steps no-print" aria-label="Stages">
        {TABS.map((t) => (
          <button key={t.id} aria-current={tab === t.id} onClick={() => go(t.id)} disabled={disabled(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>

      <main>
        {tab === "data" && <Import />}
        {tab === "power" && <Verdict />}
        {tab === "protocol" &&
          (locked && Object.keys(state.draft).length === 0 ? (
            <section className="stack">
              <h2>This protocol is locked</h2>
              <p>
                Locked protocols are read-only. You can amend it, but that creates a new version with
                its own fingerprint, and the amendment count shows on every analysis from then on.
              </p>
              <div className="card">
                <p className="hint" style={{ marginTop: 0 }}>
                  Amend after the treatment starts and that goes on the record permanently.
                </p>
                <div className="row">
                  <button className="secondary" onClick={() => go("sheet")}>
                    See the locked sheet
                  </button>
                  <button
                    className="secondary"
                    onClick={() => dispatch({ type: "startNewProtocol" })}
                  >
                    Start a new protocol
                  </button>
                </div>
              </div>
            </section>
          ) : (
            <Builder
              onLocked={() => {
                setJustLocked(true);
                setViewLock(null);
                setTab("sheet");
              }}
            />
          ))}
        {tab === "sheet" && <Sheet justLocked={justLocked} lockIndex={viewLock ?? undefined} />}
        {tab === "today" && <DailyEntry />}
        {tab === "analysis" && <Analysis />}
        {tab === "assist" && <Assist />}

        <nav className="pager no-print" aria-label="Move between stages">
          {prevTab ? (
            <button className="secondary" onClick={() => go(prevTab.id)}>
              ← {prevTab.label.replace(/^\d+ · /, "")}
            </button>
          ) : (
            <span />
          )}
          {nextTab && <button onClick={() => go(nextTab.id)}>{nextTab.cta} →</button>}
        </nav>
      </main>

      <footer className="safety">just a test</footer>
    </div>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}

import { useState } from "react";
import { StoreProvider, useDispatch, useLocked, useStore, type AppState } from "./state/store";
import { Import } from "./ui/Import";
import { Verdict } from "./ui/Verdict";
import { Builder } from "./ui/Builder";
import { Sheet } from "./ui/Sheet";
import { DailyEntry } from "./ui/DailyEntry";
import { Analysis } from "./ui/Analysis";
import { Assist } from "./ui/Assist";

type Tab = "data" | "power" | "protocol" | "sheet" | "today" | "analysis" | "assist";

const TABS: { id: Tab; label: string }[] = [
  { id: "data", label: "1 · Data" },
  { id: "power", label: "2 · Can it work?" },
  { id: "protocol", label: "3 · Protocol" },
  { id: "sheet", label: "4 · Locked sheet" },
  { id: "today", label: "5 · Today" },
  { id: "analysis", label: "6 · Result" },
  { id: "assist", label: "Writing help" },
];

function Shell() {
  const [tab, setTab] = useState<Tab>("data");
  const [justLocked, setJustLocked] = useState(false);
  const state = useStore();
  const dispatch = useDispatch();
  const locked = useLocked();

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
        <span className="tagline">
          Lock the decision rule before you see the data.
        </span>
        <span style={{ marginLeft: "auto" }} className="row no-print">
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
          <button
            key={t.id}
            aria-current={tab === t.id}
            onClick={() => {
              setTab(t.id);
              if (t.id !== "sheet") setJustLocked(false);
            }}
            disabled={
              (t.id === "sheet" && !locked) ||
              (t.id === "analysis" && !locked) ||
              (t.id === "power" && state.observations.length === 0)
            }
          >
            {t.label}
          </button>
        ))}
      </nav>

      <main>
        {tab === "data" && <Import />}
        {tab === "power" && <Verdict />}
        {tab === "protocol" &&
          (locked ? (
            <section className="stack">
              <h2>This protocol is locked</h2>
              <p>
                Locked protocols are read-only — that is the entire point of locking one. You can
                amend it, but an amendment creates a new version with its own fingerprint, and the
                amendment count appears on every analysis from then on.
              </p>
              <div className="card">
                <p className="hint" style={{ marginTop: 0 }}>
                  Amending after the intervention has begun is recorded permanently and visibly.
                </p>
                <button className="secondary" onClick={() => setJustLocked(false)}>
                  View the locked sheet instead
                </button>
              </div>
            </section>
          ) : (
            <Builder
              onLocked={() => {
                setJustLocked(true);
                setTab("sheet");
              }}
            />
          ))}
        {tab === "sheet" && <Sheet justLocked={justLocked} />}
        {tab === "today" && <DailyEntry />}
        {tab === "analysis" && <Analysis />}
        {tab === "assist" && <Assist />}
      </main>

      <footer className="safety">
        Pipeline does not give medical advice and does not recommend treatments. Talk to your
        clinician before starting or stopping anything. Everything you enter stays on this device.
      </footer>
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

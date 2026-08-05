import { useMemo, useState } from "react";
import { useDispatch, useStore } from "../state/store";
import type { Phase, Protocol, ProtocolPhase, StoppingRule } from "../types";
import { SPEC_VERSION } from "../stats/version";
import { hashProtocol } from "../stats/canonical";
import { baselineNoise } from "../stats/noise";
import { powerVerdict } from "../stats/power";
import { extractSeries, utcMs } from "../stats/series";
import { buildStoppingRule, defaultFutilityThreshold } from "./stopping";

const addDays = (iso: string, days: number) =>
  new Date(utcMs(iso) + days * 86_400_000).toISOString().slice(0, 10);

/** Phase sequence implied by the design, laid end to end from the start date. */
export function derivePhases(
  design: Protocol["design"],
  start: string,
  baselineDays: number,
  interventionDays: number,
): ProtocolPhase[] {
  const order: Phase[] =
    design === "AB"
      ? ["baseline", "intervention"]
      : design === "ABA"
        ? ["baseline", "intervention", "withdrawal"]
        : ["baseline", "intervention", "withdrawal", "intervention"];

  const out: ProtocolPhase[] = [];
  let cursor = start;
  for (const phase of order) {
    const len = phase === "baseline" ? baselineDays : interventionDays;
    const endDate = addDays(cursor, Math.max(1, len) - 1);
    out.push({ phase, startDate: cursor, endDate });
    cursor = addDays(endDate, 1);
  }
  return out;
}

export function Builder({ onLocked }: { onLocked: () => void }) {
  const state = useStore();
  const dispatch = useDispatch();
  const d = state.draft;

  const metric = state.metrics.find((m) => m.id === (d.primaryMetricId ?? state.metrics[0]?.id));
  const unit = metric?.unit ?? "";

  const firstDate = state.observations[0]?.date ?? new Date().toISOString().slice(0, 10);
  const [start, setStart] = useState(firstDate);
  const [baselineDays, setBaselineDays] = useState(
    Math.max(14, state.observations.length || 28),
  );
  const [ruleKind, setRuleKind] = useState<StoppingRule["kind"]>("futility");
  const [ruleDate, setRuleDate] = useState("");
  const [ruleThreshold, setRuleThreshold] = useState<number>(
    defaultFutilityThreshold(d.mcid ?? 0),
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const phases = useMemo(
    () => derivePhases(d.design ?? "AB", start, baselineDays, state.plannedInterventionDays),
    [d.design, start, baselineDays, state.plannedInterventionDays],
  );

  const verdict = useMemo(() => {
    const series = extractSeries(state.observations, d.primaryMetricId ?? "");
    if (series.length < 3 || !d.mcid) return null;
    const noise = baselineNoise(series);
    return powerVerdict({
      sigma: noise.sigma,
      r1: noise.r1,
      n1Eff: noise.neff,
      plannedInterventionDays: state.plannedInterventionDays,
      mcid: d.mcid,
      adherence: state.adherence,
    });
  }, [state.observations, d.primaryMetricId, d.mcid, state.plannedInterventionDays, state.adherence]);

  const rationaleOk = (d.mcidRationale ?? "").trim().length >= 20;
  const needsUnderpoweredAck = verdict?.state === "underpowered" && !state.underpoweredAck;
  const needsEfficacyAck = ruleKind === "efficacy" && !state.efficacyAck;

  const blockers: string[] = [];
  if (!d.title?.trim()) blockers.push("a title");
  if (!d.intervention?.name?.trim()) blockers.push("what you are testing");
  if (!d.primaryMetricId) blockers.push("a primary metric");
  if (!d.mcid || d.mcid <= 0) blockers.push("a threshold that matters");
  if (!rationaleOk) blockers.push("a rationale of at least 20 characters");
  if (ruleKind !== "none" && !ruleDate) blockers.push("a date for your stopping rule");
  if (needsUnderpoweredAck) blockers.push("your acknowledgment that this design is underpowered");
  if (needsEfficacyAck) blockers.push("your acknowledgment of the efficacy gate's cost");

  async function lock() {
    setBusy(true);
    setError(null);
    try {
      const protocol: Protocol = {
        title: d.title!.trim(),
        intervention: {
          name: d.intervention!.name.trim(),
          dose: d.intervention?.dose ?? "",
          schedule: d.intervention?.schedule ?? "",
          onsetLagDays: d.intervention?.onsetLagDays ?? 0,
          washoutDays: d.intervention?.washoutDays ?? 0,
        },
        design: d.design ?? "AB",
        primaryMetricId: d.primaryMetricId!,
        secondaryMetricIds: d.secondaryMetricIds ?? [],
        mcid: d.mcid!,
        mcidRationale: d.mcidRationale!.trim(),
        phases,
        stoppingRule: buildStoppingRule(ruleKind, ruleDate, ruleThreshold, unit),
        analysisPlan: "phase_means_neff",
        specVersion: SPEC_VERSION,
        acknowledgments: {
          underpowered: state.underpoweredAck,
          efficacyGate: state.efficacyAck,
        },
      };

      const hash = await hashProtocol(protocol);
      const interventionStart = phases.find((p) => p.phase === "intervention")?.startDate;
      const afterStart = Boolean(
        state.locks.length > 0 &&
          interventionStart &&
          utcMs(new Date().toISOString().slice(0, 10)) >= utcMs(interventionStart),
      );

      dispatch({
        type: "lock",
        lock: { protocol, hash, lockedAt: new Date().toISOString(), afterStart },
      });
      onLocked();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const patch = (p: Partial<Protocol>) => dispatch({ type: "patchDraft", patch: p });

  return (
    <section className="stack">
      <h2>Write the protocol</h2>
      <p>
        Everything here gets frozen when you lock. That is the point: a decision rule written down
        before the data arrives is worth something, and one written after is worth nothing.
      </p>

      <div className="card">
        <div className="field">
          <label htmlFor="title">What is this experiment called?</label>
          <input
            id="title"
            type="text"
            value={d.title ?? ""}
            onChange={(e) => patch({ title: e.target.value })}
            placeholder="Magnesium and overnight HRV"
          />
        </div>

        <div className="field">
          <label htmlFor="iname">What are you testing?</label>
          <input
            id="iname"
            type="text"
            value={d.intervention?.name ?? ""}
            onChange={(e) =>
              patch({
                intervention: {
                  name: e.target.value,
                  dose: d.intervention?.dose ?? "",
                  schedule: d.intervention?.schedule ?? "",
                  onsetLagDays: d.intervention?.onsetLagDays ?? 0,
                  washoutDays: d.intervention?.washoutDays ?? 0,
                },
              })
            }
          />
        </div>

        <div className="row">
          <div className="field" style={{ flex: "1 1 10rem" }}>
            <label htmlFor="dose">Dose</label>
            <input
              id="dose"
              type="text"
              value={d.intervention?.dose ?? ""}
              onChange={(e) =>
                patch({
                  intervention: { ...d.intervention!, dose: e.target.value },
                })
              }
            />
            <p className="hint">Your words. Runsheet never suggests or checks a dose.</p>
          </div>
          <div className="field" style={{ flex: "1 1 10rem" }}>
            <label htmlFor="sched">Schedule</label>
            <input
              id="sched"
              type="text"
              value={d.intervention?.schedule ?? ""}
              onChange={(e) =>
                patch({ intervention: { ...d.intervention!, schedule: e.target.value } })
              }
              placeholder="Mon/Wed/Fri"
            />
          </div>
        </div>

        <div className="row">
          <div className="field" style={{ flex: "1 1 10rem" }}>
            <label htmlFor="onset">Onset lag, in days</label>
            <input
              id="onset"
              type="number"
              min={0}
              value={d.intervention?.onsetLagDays ?? 0}
              onChange={(e) =>
                patch({
                  intervention: { ...d.intervention!, onsetLagDays: Number(e.target.value) },
                })
              }
            />
            <p className="hint">
              Days after the first dose before you would expect any effect. These are excluded from
              the analysis.
            </p>
          </div>
          <div className="field" style={{ flex: "1 1 10rem" }}>
            <label htmlFor="washout">Washout, in days</label>
            <input
              id="washout"
              type="number"
              min={0}
              value={d.intervention?.washoutDays ?? 0}
              onChange={(e) =>
                patch({
                  intervention: { ...d.intervention!, washoutDays: Number(e.target.value) },
                })
              }
            />
          </div>
        </div>
      </div>

      <div className="card">
        <h3>Outcome</h3>
        <div className="field">
          <label htmlFor="primary">Primary metric</label>
          <select
            id="primary"
            value={d.primaryMetricId ?? ""}
            onChange={(e) => patch({ primaryMetricId: e.target.value })}
          >
            <option value="">Choose…</option>
            {state.metrics.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
          <p className="hint">One primary outcome. Everything else is secondary, and secondary means it cannot decide the experiment.</p>
        </div>

        <div className="field">
          <label htmlFor="rationale">
            Why is {d.mcid ? `${d.mcid}${unit ? ` ${unit}` : ""}` : "your threshold"} the right threshold?
          </label>
          <textarea
            id="rationale"
            rows={3}
            value={d.mcidRationale ?? ""}
            onChange={(e) => patch({ mcidRationale: e.target.value })}
            placeholder="Half the seasonal swing I already see, and the smallest change I'd notice in how I feel."
          />
          <p className="hint">
            {(d.mcidRationale ?? "").trim().length}/20 characters minimum. This is the field that
            stops you quietly moving the goalposts later.
          </p>
        </div>
      </div>

      <div className="card">
        <h3>Design and dates</h3>
        <div className="row">
          <div className="field" style={{ flex: "1 1 8rem" }}>
            <label htmlFor="design">Design</label>
            <select
              id="design"
              value={d.design ?? "AB"}
              onChange={(e) => patch({ design: e.target.value as Protocol["design"] })}
            >
              <option value="AB">AB — baseline, then treatment</option>
              <option value="ABA">ABA — and then withdraw it</option>
              <option value="ABAB">ABAB — and then repeat</option>
            </select>
          </div>
          <div className="field" style={{ flex: "1 1 8rem" }}>
            <label htmlFor="start">Baseline starts</label>
            <input id="start" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div className="field" style={{ flex: "1 1 8rem" }}>
            <label htmlFor="blen">Baseline days</label>
            <input
              id="blen"
              type="number"
              min={1}
              value={baselineDays}
              onChange={(e) => setBaselineDays(Number(e.target.value))}
            />
          </div>
        </div>

        <div className="scroll-x">
          <table>
            <thead>
              <tr>
                <th>Phase</th>
                <th>From</th>
                <th>To</th>
                <th>Days</th>
              </tr>
            </thead>
            <tbody>
              {phases.map((p, i) => (
                <tr key={i}>
                  <td>
                    <span
                      className="swatch"
                      style={{
                        background:
                          p.phase === "intervention" ? "var(--phase-b)" : "var(--phase-a)",
                      }}
                    />
                    {p.phase}
                  </td>
                  <td className="n">{p.startDate}</td>
                  <td className="n">{p.endDate}</td>
                  <td className="n">
                    {Math.round((utcMs(p.endDate) - utcMs(p.startDate)) / 86_400_000) + 1}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h3>Stopping rule</h3>
        <p className="hint" style={{ marginBottom: "0.8rem" }}>
          Runsheet writes the sentence, not you. A generated rule cannot drift away from the rule the
          analysis actually enforces.
        </p>

        <div className="field">
          <label htmlFor="rk">Kind</label>
          <select
            id="rk"
            value={ruleKind}
            onChange={(e) => {
              const k = e.target.value as StoppingRule["kind"];
              setRuleKind(k);
              if (k === "futility") setRuleThreshold(defaultFutilityThreshold(d.mcid ?? 0));
            }}
          >
            <option value="futility">Futility — stop if it clearly isn't working</option>
            <option value="none">None — run to the end</option>
            <option value="efficacy">Efficacy — stop early if it is working</option>
          </select>
        </div>

        {ruleKind !== "none" && (
          <div className="row">
            <div className="field" style={{ flex: "1 1 10rem" }}>
              <label htmlFor="rd">Gate date</label>
              <input id="rd" type="date" value={ruleDate} onChange={(e) => setRuleDate(e.target.value)} />
            </div>
            <div className="field" style={{ flex: "1 1 10rem" }}>
              <label htmlFor="rt">Threshold{unit ? `, in ${unit}` : ""}</label>
              <input
                id="rt"
                type="number"
                step="any"
                value={ruleThreshold}
                onChange={(e) => setRuleThreshold(Number(e.target.value))}
              />
            </div>
          </div>
        )}

        {ruleKind === "efficacy" && (
          <div className="warn">
            <strong>Stopping early when it looks good inflates your false-positive rate.</strong>
            Every extra peek is another chance for noise to cross your line, so a rule that lets you
            stop at the first good-looking moment finds "effects" more often than it should. Runsheet
            will not quietly shrink your alpha to compensate — that trade is yours to make knowingly.
            A futility gate costs you almost nothing by comparison.
            <label style={{ fontWeight: 400, marginTop: "0.7rem" }}>
              <input
                type="checkbox"
                checked={state.efficacyAck}
                onChange={(e) => dispatch({ type: "ackEfficacy", value: e.target.checked })}
                style={{ width: "auto", marginRight: "0.5em" }}
              />
              I understand an efficacy gate raises my false-positive rate, and I want it anyway.
            </label>
          </div>
        )}

        {ruleKind !== "none" && ruleDate && (
          <p className="hint">
            Will be locked as: <em>{buildStoppingRule(ruleKind, ruleDate, ruleThreshold, unit).kind !== "none" && (buildStoppingRule(ruleKind, ruleDate, ruleThreshold, unit) as Exclude<StoppingRule, { kind: "none" }>).condition}</em>
          </p>
        )}
      </div>

      {error && <div className="warn">{error}</div>}

      <div className="card">
        <h3>Lock this protocol</h3>
        <p>
          Locking freezes every field above and fingerprints it with SHA-256. Post that fingerprint
          somewhere public and dated, and you can prove afterwards that you did not move the
          goalposts. That is the difference between a self-experiment and a story about one.
        </p>
        {blockers.length > 0 && (
          <p className="hint">Still needs {blockers.join(", ")}.</p>
        )}
        <button onClick={() => void lock()} disabled={blockers.length > 0 || busy}>
          {busy ? "Locking…" : "Lock this protocol"}
        </button>
      </div>
    </section>
  );
}

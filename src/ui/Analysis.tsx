import { useMemo, useState } from "react";
import { useLocked, useStore } from "../state/store";
import { runAnalysis, runSensitivity, type AnalysisResult } from "../stats/analysis";
import { onsetLagWarnings } from "../stats/phases";
import { checkSpecVersion, versionWarning } from "../stats/version";
import { RunChart } from "./RunChart";

const n = (x: number, d = 2) => x.toFixed(d);
const today = () => new Date().toISOString().slice(0, 10);

export function Analysis() {
  const state = useStore();
  const locked = useLocked();
  const [showSensitivity, setShowSensitivity] = useState(false);

  const metric = useMemo(
    () => state.metrics.find((m) => m.id === locked?.protocol.primaryMetricId),
    [state.metrics, locked],
  );
  const unit = metric?.unit ?? "";

  const result = useMemo(() => {
    if (!locked) return null;
    try {
      return runAnalysis({
        protocol: locked.protocol,
        observations: state.observations,
        doses: state.doses,
        direction: metric?.direction,
        today: today(),
      });
    } catch (err) {
      return err instanceof Error ? err : new Error(String(err));
    }
  }, [locked, state.observations, state.doses, metric]);

  const sensitivity = useMemo(() => {
    if (!locked || !showSensitivity) return null;
    try {
      return runSensitivity({
        protocol: locked.protocol,
        observations: state.observations,
        doses: state.doses,
        direction: metric?.direction,
        today: today(),
      });
    } catch {
      return null;
    }
  }, [locked, state.observations, state.doses, metric, showSensitivity]);

  const doseWarnings = useMemo(() => {
    if (!locked) return [];
    return onsetLagWarnings(
      state.observations,
      locked.protocol.phases,
      locked.protocol.intervention.onsetLagDays,
    );
  }, [locked, state.observations]);

  if (!locked) {
    return (
      <section>
        <h2>Analysis</h2>
        <div className="empty">
          <p style={{ margin: 0 }}>
            Nothing to analyze yet. Lock a protocol first — that is what makes the result mean
            something.
          </p>
        </div>
      </section>
    );
  }

  const versionCheck = checkSpecVersion(locked.protocol);
  const amendments = state.locks.length - 1;
  const amendedAfterStart = state.locks.some((l) => l.afterStart);

  return (
    <section className="stack">
      <h2>Analysis</h2>

      {!versionCheck.ok && (
        <div className="warn">
          <strong>This protocol was locked under a different version of the rules.</strong>
          {versionWarning(versionCheck)}
        </div>
      )}

      {result instanceof Error ? (
        <div className="empty">
          <p style={{ margin: 0 }}>{result.message}</p>
        </div>
      ) : (
        result && (
          <>
            {result.exploratory && (
              <div className="exploratory">
                <div className="label">Exploratory</div>
                <p style={{ margin: "0.3rem 0 0" }}>
                  {result.exploratoryReason} Anything below is a look you did not pre-register.
                  Treat it as a hypothesis, not a result, and say so if you report it.
                </p>
              </div>
            )}

            {amendments > 0 && (
              <div className="warn">
                <strong>
                  {amendments} amendment{amendments > 1 ? "s" : ""} to this protocol.
                </strong>
                {amendedAfterStart
                  ? "At least one was made after the intervention began. That is permanent, and it weakens the pre-registration."
                  : "All were made before the intervention began."}
              </div>
            )}

            {doseWarnings.length > 0 && (
              <div className="warn">
                <strong>Missed doses inside the onset window.</strong>
                {doseWarnings.length} day(s) flagged as a missed dose fall within the{" "}
                {locked.protocol.intervention.onsetLagDays}-day onset window. The window counts from
                the first dose you actually took, so if that log is incomplete the exclusion may be
                starting from the wrong day.
              </div>
            )}

            <Result result={result} unit={unit} mcid={locked.protocol.mcid} />

            <div className="card">
              <h3>The run chart</h3>
              <RunChart
                protocol={locked.protocol}
                observations={state.observations}
                doses={state.doses}
                metricId={locked.protocol.primaryMetricId}
                unit={unit}
                mcid={locked.protocol.mcid}
              />
            </div>

            <div className="card">
              <h3>Does this depend on your bad days?</h3>
              <p className="hint" style={{ marginBottom: "0.8rem" }}>
                Re-runs the same analysis with every confounder-flagged day dropped. If the answer
                changes, the result was resting on those days.
              </p>
              {!showSensitivity ? (
                <button className="secondary" onClick={() => setShowSensitivity(true)}>
                  Run sensitivity check
                </button>
              ) : sensitivity ? (
                <>
                  {sensitivity.disagrees ? (
                    <div className="warn">
                      <strong>These two runs disagree.</strong>
                      With every day included the verdict is{" "}
                      <em>{phrase(sensitivity.all.verdict)}</em>; with {sensitivity.droppedDates.length}{" "}
                      flagged day(s) dropped it becomes <em>{phrase(sensitivity.clean.verdict)}</em>.
                      The result depends on days you marked unusual, which is worth understanding
                      before you believe either one.
                    </div>
                  ) : (
                    <p className="hint">
                      Both runs agree ({phrase(sensitivity.all.verdict)}), so the result does not
                      hinge on the {sensitivity.droppedDates.length} flagged day(s).
                    </p>
                  )}
                  <div className="scroll-x">
                    <table>
                      <thead>
                        <tr>
                          <th>Run</th>
                          <th>Readings</th>
                          <th>Difference</th>
                          <th>95% interval</th>
                          <th>Verdict</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          ["All days", sensitivity.all] as const,
                          ["Flagged days dropped", sensitivity.clean] as const,
                        ].map(([label, r]) => (
                          <tr key={label}>
                            <td>{label}</td>
                            <td className="n">{r.a.n + r.b.n}</td>
                            <td className="n">
                              {n(r.diff)} {unit}
                            </td>
                            <td className="n">
                              {n(r.ciLow)} to {n(r.ciHigh)}
                            </td>
                            <td>{phrase(r.verdict)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <p className="hint">Not enough data in one of the phases to re-run.</p>
              )}
            </div>
          </>
        )
      )}
    </section>
  );
}

function phrase(v: AnalysisResult["verdict"]): string {
  if (v === "clears_threshold") return "clears your threshold";
  if (v === "below_threshold") return "smaller than your threshold";
  return "inconclusive";
}

function Result({ result, unit, mcid }: { result: AnalysisResult; unit: string; mcid: number }) {
  const headline =
    result.verdict === "clears_threshold"
      ? "The effect is at least as large as your declared threshold."
      : result.verdict === "below_threshold"
        ? "The effect is smaller than your declared threshold."
        : "Inconclusive — the interval spans your threshold.";

  return (
    <div className="card">
      <div className={`verdict ${result.verdict === "clears_threshold" ? "adequate" : result.verdict === "below_threshold" ? "infeasible" : "underpowered"}`}>
        <h2>Result</h2>
        <p style={{ fontSize: "1.05rem", marginBottom: "0.6rem" }}>{headline}</p>
        <p style={{ marginBottom: 0 }}>
          Treatment minus baseline:{" "}
          <span className="mono">
            {result.diff > 0 ? "+" : ""}
            {n(result.diff)} {unit}
          </span>
          , 95% interval{" "}
          <span className="mono">
            {n(result.ciLow)} to {n(result.ciHigh)} {unit}
          </span>
          . Your threshold was{" "}
          <span className="mono">
            {mcid} {unit}
          </span>
          .
        </p>
      </div>

      <div className="scroll-x">
        <table>
          <thead>
            <tr>
              <th>Phase</th>
              <th>Readings</th>
              <th>Independent</th>
              <th>Mean</th>
              <th>Spread</th>
            </tr>
          </thead>
          <tbody>
            {[result.a, result.b].map((p) => (
              <tr key={p.label}>
                <td>
                  <span
                    className="swatch"
                    style={{ background: p.label === "B" ? "var(--phase-b)" : "var(--phase-a)" }}
                  />
                  {p.label === "A" ? "A · off treatment" : "B · on treatment"}
                </td>
                <td className="n">{p.n}</td>
                <td className="n">{n(p.neff, 1)}</td>
                <td className="n">
                  {n(p.mean)} {unit}
                </td>
                <td className="n">{n(p.sigma)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(result.a.neffFloored || result.b.neffFloored) && (
        <div className="warn">
          <strong>One phase has too little independent information.</strong>
          Its effective count hit the floor of two, so the interval above is not a meaningful
          estimate.
        </div>
      )}

      {result.excludedDates.length > 0 && (
        <p className="hint">
          {result.excludedDates.length} day(s) excluded by the onset lag or washout you declared.
          They are drawn in grey on the chart and were never deleted.
        </p>
      )}

      <p className="hint" style={{ fontSize: "0.75rem" }}>
        p = <span className="mono">{result.p < 0.001 ? "<0.001" : n(result.p, 3)}</span>, Welch df ={" "}
        <span className="mono">{n(result.df, 1)}</span>. The p-value is not the headline; the
        comparison against your threshold is.
      </p>
    </div>
  );
}

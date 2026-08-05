import { useMemo } from "react";
import { useDispatch, useStore } from "../state/store";
import { extractSeries } from "../stats/series";
import { baselineNoise } from "../stats/noise";
import { mde, powerVerdict } from "../stats/power";
import { detrendSeries } from "../stats/detrend";
import { BaselineChart } from "./BaselineChart";

const n = (x: number, d = 2) => x.toFixed(d);

export function Verdict() {
  const state = useStore();
  const dispatch = useDispatch();

  const metricId = state.draft.primaryMetricId ?? state.metrics[0]?.id ?? "";
  const metric = state.metrics.find((m) => m.id === metricId);
  const unit = metric?.unit ?? "";
  const mcid = state.draft.mcid ?? 0;

  const series = useMemo(
    () => (metricId ? extractSeries(state.observations, metricId) : []),
    [state.observations, metricId],
  );

  const noise = useMemo(() => (series.length >= 3 ? baselineNoise(series) : null), [series]);
  const fit = useMemo(() => (series.length >= 2 ? detrendSeries(series) : null), [series]);

  const verdict = useMemo(() => {
    if (!noise || mcid <= 0) return null;
    return powerVerdict({
      sigma: noise.sigma,
      r1: noise.r1,
      n1Eff: noise.neff,
      plannedInterventionDays: state.plannedInterventionDays,
      mcid,
      adherence: state.adherence,
    });
  }, [noise, mcid, state.plannedInterventionDays, state.adherence]);

  if (!metricId) {
    return (
      <section>
        <h2>Can this experiment answer your question?</h2>
        <div className="empty">
          <p style={{ margin: 0 }}>Bring in some data first, then pick a primary metric.</p>
        </div>
      </section>
    );
  }

  if (!noise) {
    return (
      <section>
        <h2>Can this experiment answer your question?</h2>
        <div className="empty">
          <p style={{ margin: 0 }}>
            Only {series.length} readings for {metric?.label ?? metricId}. Three is the minimum, and
            three weeks is more useful.
          </p>
        </div>
      </section>
    );
  }

  const driftMatters = Math.abs(noise.slope) * 30 > noise.sigma;
  const floor = mde(noise.sigma, noise.neff, Number.MAX_SAFE_INTEGER);

  return (
    <section className="stack">
      <h2>Can this experiment answer your question?</h2>
      <p>
        Check whether the change you care about is big enough to see through your own noise. Do this
        before you start, not after.
      </p>

      <div className="card">
        <h3>
          {metric?.label ?? metricId} baseline
          <span className="hint" style={{ display: "inline", marginLeft: "0.6em" }}>
            {series.length} readings
          </span>
        </h3>
        <BaselineChart
          points={series}
          unit={unit}
          slope={fit?.slope}
          intercept={fit?.intercept}
          label={`${metric?.label ?? metricId} baseline`}
        />

        <div style={{ marginTop: "1rem" }}>
          <div className="stat">
            <span>Day-to-day spread (sigma)</span>
            <span className="v">
              {n(noise.sigma, 2)} {unit}
            </span>
          </div>
          <div className="stat">
            <span>Drift</span>
            <span className="v">
              {n(noise.slope, 3)} {unit}/day
            </span>
          </div>
          <div className="stat">
            <span>Carryover (r₁, per day)</span>
            <span className="v">
              {noise.method === "insufficient" ? "not estimable" : n(noise.r1, 2)}
            </span>
          </div>
          <div className="stat">
            <span>Independent readings</span>
            <span className="v">
              {n(noise.neff, 1)} of {series.length}
            </span>
          </div>
        </div>

        {driftMatters && (
          <div className="warn">
            <strong>Your baseline is already moving.</strong>
            It drifts about {n(Math.abs(noise.slope) * 30, 1)} {unit} a month on its own. Start the
            treatment now and you won't be able to tell the drift from the effect. Collect more
            baseline first.
          </div>
        )}

        {noise.method === "insufficient" && (
          <div className="warn">
            <strong>Can't measure carryover.</strong>
            Too few readings close enough together to tell whether one day predicts the next. The
            numbers below assume they don't, which makes this baseline look better than it is.
          </div>
        )}

        {noise.rEff > 0 && noise.method !== "insufficient" && (
          <p className="hint">
            Your readings carry over, so {series.length} of them are worth about{" "}
            <span className="mono">{Math.round(noise.neff)}</span> independent ones. Everything below
            uses the smaller number.
          </p>
        )}

        {noise.dowReason === "applied" && (
          <p className="hint">
            A weekly pattern was detected and removed (p = {n(noise.dowP!, 3)}).
          </p>
        )}
        {noise.dowReason === "no_weekly_pattern" && (
          <p className="hint">
            No weekly pattern was removed — the test did not find one (p = {n(noise.dowP!, 2)}).
          </p>
        )}
      </div>

      <div className="card">
        <h3>What would count as working?</h3>
        <div className="field">
          <label htmlFor="mcid">
            Smallest change that would matter to you{unit ? `, in ${unit}` : ""}
          </label>
          <input
            id="mcid"
            type="number"
            step="any"
            value={state.draft.mcid ?? ""}
            onChange={(e) =>
              dispatch({ type: "patchDraft", patch: { mcid: Number(e.target.value) } })
            }
          />
          <p className="hint">
            Not what you're hoping for. The smallest change that would actually make you keep doing
            this. Pick it now, while you can't see the answer.
          </p>
        </div>

        <div className="row">
          <div className="field" style={{ flex: "1 1 12rem" }}>
            <label htmlFor="plan">Planned intervention length, in days</label>
            <input
              id="plan"
              type="number"
              min={1}
              value={state.plannedInterventionDays}
              onChange={(e) => dispatch({ type: "setPlan", days: Number(e.target.value) })}
            />
          </div>
          <div className="field" style={{ flex: "1 1 12rem" }}>
            <label htmlFor="adherence">Readings per day you'll realistically take</label>
            <select
              id="adherence"
              value={state.adherence}
              onChange={(e) => dispatch({ type: "setPlan", adherence: Number(e.target.value) })}
            >
              <option value={1}>Every day</option>
              <option value={5 / 7}>Five days a week</option>
              <option value={3 / 7}>Three days a week</option>
              <option value={2 / 7}>Twice a week</option>
              <option value={1 / 7}>Once a week</option>
            </select>
          </div>
        </div>
      </div>

      {mcid <= 0 ? (
        <div className="empty">
          <p style={{ margin: 0 }}>Enter a threshold above to see whether this design can detect it.</p>
        </div>
      ) : (
        verdict && (
          <VerdictPanel
            verdict={verdict}
            mcid={mcid}
            unit={unit}
            floor={floor}
            plannedDays={state.plannedInterventionDays}
            adherence={state.adherence}
            ack={state.underpoweredAck}
            onAck={(v) => dispatch({ type: "ackUnderpowered", value: v })}
          />
        )
      )}
    </section>
  );
}

interface PanelProps {
  verdict: NonNullable<ReturnType<typeof powerVerdict>>;
  mcid: number;
  unit: string;
  floor: number;
  plannedDays: number;
  adherence: number;
  ack: boolean;
  onAck: (v: boolean) => void;
}

function VerdictPanel({ verdict, mcid, unit, floor, plannedDays, ack, onAck }: PanelProps) {
  return (
    <>
      {verdict.n2Floored && (
        <div className="warn">
          <strong>This phase is too short to mean anything.</strong>
          Fewer than two independent readings, so the number below isn't real. Make the phase longer
          or take readings more often.
        </div>
      )}

      <div className={`verdict ${verdict.state}`}>
        {verdict.state === "adequate" && (
          <>
            <h2>Adequate</h2>
            <p>
              You can detect{" "}
              <span className="mono">
                {n(verdict.mde)} {unit}
              </span>
              , and you said {n(mcid)} {unit} matters. This will work. Lock it.
            </p>
          </>
        )}

        {verdict.state === "underpowered" && (
          <>
            <h2>Underpowered</h2>
            <p>
              You can only detect{" "}
              <span className="mono">
                {n(verdict.mde)} {unit}
              </span>
              , and you said {n(mcid)} {unit} matters. Run this as planned and you'll probably finish
              with a null result whether or not it worked. You won't learn anything.
            </p>
            <p style={{ marginBottom: "0.4rem" }}>
              <strong>Three ways out.</strong>
            </p>
            <ol style={{ marginTop: 0, paddingLeft: "1.2rem", maxWidth: "34rem" }}>
              <li>
                Run the intervention for <span className="mono">{verdict.requiredDays}</span> days
                instead of {plannedDays} — {verdict.additionalDays} more, about{" "}
                <span className="mono">{verdict.requiredObs}</span> readings.
              </li>
              <li>Use a less noisy metric.</li>
              <li>
                Raise your threshold to at least{" "}
                <span className="mono">
                  {n(verdict.mde)} {unit}
                </span>{" "}
                and accept you'll only catch a bigger effect.
              </li>
            </ol>

            <label style={{ fontWeight: 400, marginTop: "0.8rem" }}>
              <input
                type="checkbox"
                checked={ack}
                onChange={(e) => onAck(e.target.checked)}
                style={{ width: "auto", marginRight: "0.5em" }}
              />
              I understand this experiment is underpowered and I am choosing to run it anyway.
            </label>
            <p className="hint">This goes in the protocol and into the fingerprint.</p>
          </>
        )}

        {verdict.state === "infeasible" && (
          <>
            <h2>Infeasible</h2>
            <p>
              <strong>No treatment phase of any length</strong> gets you to {n(mcid)} {unit}. Your
              baseline is too noisy — running the treatment forever wouldn't be enough.
            </p>
            <p>You can't answer this question with this metric. Better to know now.</p>
            <p style={{ marginBottom: "0.4rem" }}>
              <strong>Two ways out.</strong>
            </p>
            <ol style={{ marginTop: 0, paddingLeft: "1.2rem", maxWidth: "34rem" }}>
              <li>
                Collect <span className="mono">{verdict.extraBaselineDays}</span> more baseline days
                before you start.
              </li>
              <li>
                Accept {" "}
                <span className="mono">
                  {n(verdict.feasibleMcid)} {unit}
                </span>{" "}
                as your threshold, which you can already detect.
              </li>
            </ol>
          </>
        )}
      </div>

      <p className="hint">
        Best case, with a treatment phase of any length, this baseline detects{" "}
        <span className="mono">
          {n(floor)} {unit}
        </span>
        . All of this assumes the treatment phase is no noisier than baseline. Treatments often make
        things bumpier, so set your threshold on the high side.
      </p>
    </>
  );
}

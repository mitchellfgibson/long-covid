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
        Before you start, Runsheet checks whether the change you care about is even visible through
        your own day-to-day noise. This is the screen the whole tool exists for.
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
            It drifts about {n(Math.abs(noise.slope) * 30, 1)} {unit} a month on its own. A trend
            that size can look exactly like a treatment effect, and it is the most common reason an
            n=1 result turns out to be nothing. Consider a longer baseline before you start.
          </div>
        )}

        {noise.method === "insufficient" && (
          <div className="warn">
            <strong>Carryover could not be measured.</strong>
            Your readings are too sparse or too irregular to tell whether one day predicts the next.
            The numbers below assume they are independent, which almost certainly overstates how much
            this baseline tells you.
          </div>
        )}

        {noise.rEff > 0 && noise.method !== "insufficient" && (
          <p className="hint">
            Your readings carry over from one to the next, so {series.length} of them are worth about{" "}
            <span className="mono">{Math.round(noise.neff)}</span> independent ones. Every calculation
            here uses the smaller number.
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
            Not the change you hope for — the smallest one that would actually change what you do.
            Decide it now, while you still can't see the answer.
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
          The planned intervention phase carries fewer than two independent readings, so the number
          below is not a real estimate. Lengthen the phase or take readings more often.
        </div>
      )}

      <div className={`verdict ${verdict.state}`}>
        {verdict.state === "adequate" && (
          <>
            <h2>Adequate</h2>
            <p>
              This design can detect a change of{" "}
              <span className="mono">
                {n(verdict.mde)} {unit}
              </span>
              , which is at or below the {n(mcid)} {unit} you said would matter. Go ahead and lock it.
            </p>
          </>
        )}

        {verdict.state === "underpowered" && (
          <>
            <h2>Underpowered</h2>
            <p>
              This design can only detect{" "}
              <span className="mono">
                {n(verdict.mde)} {unit}
              </span>
              . You said {n(mcid)} {unit} is what matters. An effect the size you care about would
              most likely be missed — you would finish the experiment and conclude nothing happened,
              whether or not something did.
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
              <li>Pick a metric that bounces around less.</li>
              <li>
                Declare a larger threshold — at least{" "}
                <span className="mono">
                  {n(verdict.mde)} {unit}
                </span>{" "}
                — and accept you can only detect a bigger effect.
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
            <p className="hint">
              This acknowledgment is recorded in the protocol and covered by the hash.
            </p>
          </>
        )}

        {verdict.state === "infeasible" && (
          <>
            <h2>Infeasible</h2>
            <p>
              At this noise level, <strong>no intervention phase of any length</strong> reaches{" "}
              {n(mcid)} {unit}. Your baseline alone caps the precision: even running the treatment
              forever could not resolve a difference that small.
            </p>
            <p>This experiment cannot answer the question as posed. That is a real answer, and a useful one.</p>
            <p style={{ marginBottom: "0.4rem" }}>
              <strong>You have two levers, not one.</strong>
            </p>
            <ol style={{ marginTop: 0, paddingLeft: "1.2rem", maxWidth: "34rem" }}>
              <li>
                Collect about <span className="mono">{verdict.extraBaselineDays}</span> more baseline
                days before starting.
              </li>
              <li>
                Accept a threshold of at least{" "}
                <span className="mono">
                  {n(verdict.feasibleMcid)} {unit}
                </span>
                , which this design can already detect.
              </li>
            </ol>
          </>
        )}
      </div>

      <p className="hint">
        With an unlimited intervention phase, this baseline could at best detect{" "}
        <span className="mono">
          {n(floor)} {unit}
        </span>
        . Planning uses your baseline's noise and assumes the treatment phase is no noisier —
        treatments often make day-to-day variation worse, which is a reason to set your threshold
        conservatively.
      </p>
    </>
  );
}

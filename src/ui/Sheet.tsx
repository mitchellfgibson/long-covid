import { useEffect, useState } from "react";
import { useLocked, useStore } from "../state/store";

/** Types the hash out in mono. Respects reduced motion by arriving whole. */
function useTypedHash(hash: string, animate: boolean): string {
  const [shown, setShown] = useState(animate ? "" : hash);

  useEffect(() => {
    if (!animate) {
      setShown(hash);
      return;
    }
    let i = 0;
    const id = window.setInterval(() => {
      i += 2;
      setShown(hash.slice(0, i));
      if (i >= hash.length) window.clearInterval(id);
    }, 14);
    return () => window.clearInterval(id);
  }, [hash, animate]);

  return shown;
}

export function Sheet({
  justLocked = false,
  lockIndex,
}: {
  justLocked?: boolean;
  /** Which version to show. Omitted means the current one. */
  lockIndex?: number;
}) {
  const latest = useLocked();
  const state = useStore();
  const locked = lockIndex === undefined ? latest : (state.locks[lockIndex] ?? latest);
  const isCurrent = lockIndex === undefined || lockIndex === state.locks.length - 1;

  const reduced =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const animate = justLocked && !reduced;

  const hash = useTypedHash(locked?.hash ?? "", animate);

  if (!locked) {
    return (
      <section>
        <h2>The protocol sheet</h2>
        <div className="empty">
          <p style={{ margin: 0 }}>Nothing locked yet. Write the protocol first.</p>
        </div>
      </section>
    );
  }

  const { protocol: p, lockedAt } = locked;
  const metric = state.metrics.find((m) => m.id === p.primaryMetricId);
  const amendments = state.locks.length - 1;
  const unit = metric?.unit ? ` ${metric.unit}` : "";

  return (
    <section className={animate ? "locking" : undefined}>
      <div className="row no-print" style={{ marginBottom: "1rem", justifyContent: "space-between" }}>
        <h2 style={{ margin: 0 }}>The protocol sheet</h2>
        <button className="secondary" onClick={() => window.print()}>
          Print or save as PDF
        </button>
      </div>

      {!isCurrent && (
        <div className="warn no-print">
          <strong>This is an earlier version.</strong>
          You're looking at version {(lockIndex ?? 0) + 1} of {state.locks.length}. The current one is
          what gets analyzed.
        </div>
      )}

      <p className="hint no-print" style={{ marginBottom: "1rem" }}>
        Print this or hand it to a clinician. Post the fingerprint somewhere public and dated — a
        gist, a tweet, an email to yourself — so you can prove the plan came before the data.
      </p>

      <article className="doc">
        <div className="stamp">
          Locked
          <br />
          {lockedAt.slice(0, 10)}
        </div>

        <h2 style={{ fontSize: "1.5rem", marginBottom: "0.2rem" }}>{p.title}</h2>
        <p style={{ fontFamily: "var(--sans)", fontSize: "0.85rem", color: "var(--ink-60)" }}>
          Pre-registered n=1 protocol · spec {p.specVersion} · analysis {p.analysisPlan}
          {amendments > 0 && ` · amendment ${amendments}`}
        </p>

        <dl>
          <dt>What is being tested</dt>
          <dd>
            {p.intervention.name}
            {p.intervention.dose && `, ${p.intervention.dose}`}
            {p.intervention.schedule && `, ${p.intervention.schedule}`}
          </dd>

          <dt>Primary outcome</dt>
          <dd>{metric?.label ?? p.primaryMetricId}</dd>

          <dt>Smallest change that would matter</dt>
          <dd>
            <span className="mono">
              {p.mcid}
              {unit}
            </span>
            <div style={{ fontSize: "0.92rem", marginTop: "0.3rem", color: "var(--ink-60)" }}>
              {p.mcidRationale}
            </div>
          </dd>

          <dt>Design</dt>
          <dd>{p.design}</dd>

          <dt>Phases</dt>
          <dd>
            {p.phases.map((ph, i) => (
              <div key={i} className="mono" style={{ fontSize: "0.9rem" }}>
                {ph.phase.padEnd(13, " ")} {ph.startDate} → {ph.endDate}
              </div>
            ))}
            {(p.intervention.onsetLagDays > 0 || p.intervention.washoutDays > 0) && (
              <div style={{ fontSize: "0.88rem", marginTop: "0.4rem", color: "var(--ink-60)" }}>
                Excluding {p.intervention.onsetLagDays} day(s) after the first dose
                {p.intervention.washoutDays > 0 &&
                  ` and ${p.intervention.washoutDays} day(s) of washout`}
                .
              </div>
            )}
          </dd>

          <dt>Stopping rule</dt>
          <dd>
            {p.stoppingRule.kind === "none"
              ? "None. The experiment runs to its final date."
              : p.stoppingRule.condition}
            {p.stoppingRule.kind === "efficacy" && (
              <div style={{ fontSize: "0.88rem", marginTop: "0.3rem", color: "var(--phase-b)" }}>
                Efficacy gate. Raises the false-positive rate. Acknowledged at lock time, no alpha
                correction applied.
              </div>
            )}
          </dd>

          <dt>Analysis</dt>
          <dd>
            Difference in phase means, Welch standard error on effective sample sizes corrected for
            day-to-day carryover. Judged against the threshold above, not against zero.
          </dd>

          {(p.acknowledgments.underpowered || p.acknowledgments.efficacyGate) && (
            <>
              <dt>Acknowledged at lock time</dt>
              <dd style={{ fontSize: "0.92rem" }}>
                {p.acknowledgments.underpowered &&
                  "Known to be underpowered for the threshold above, and run anyway. "}
                {p.acknowledgments.efficacyGate &&
                  "Efficacy gate accepted, with its cost to the false-positive rate."}
              </dd>
            </>
          )}

          <dt>Fingerprint (SHA-256)</dt>
          <dd className="hash">{hash}</dd>

          <dt>Locked at</dt>
          <dd className="mono" style={{ fontSize: "0.85rem" }}>
            {lockedAt}
          </dd>
        </dl>

        <p
          style={{
            fontFamily: "var(--sans)",
            fontSize: "0.72rem",
            color: "var(--ink-60)",
            marginTop: "2rem",
            borderTop: "1px solid var(--rule)",
            paddingTop: "0.7rem",
          }}
        >
          Pipeline does not give medical advice and does not recommend treatments. Talk to your
          clinician before starting or stopping anything.
        </p>
      </article>

      {amendments > 0 && (
        <div className="warn no-print" style={{ marginTop: "1rem" }}>
          <strong>
            {amendments} amendment{amendments > 1 ? "s" : ""} to this protocol.
          </strong>
          {state.locks.some((l) => l.afterStart)
            ? "At least one came after the treatment started. That stays on the record and shows on every analysis."
            : "All before the treatment started."}
        </div>
      )}
    </section>
  );
}

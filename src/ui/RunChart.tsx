import { useMemo } from "react";
import type { Observation, Protocol } from "../types";
import { assignPhases } from "../stats/phases";
import type { DoseRecord } from "../types";
import { daysBetween, extractSeries, mean, utcMs } from "../stats/series";
import { linear, pad, shortDate, ticks } from "./charts";

interface Props {
  protocol: Protocol;
  observations: Observation[];
  doses?: DoseRecord[];
  metricId: string;
  unit?: string;
  mcid: number;
}

const W = 760;
const H = 320;
const M = { top: 22, right: 16, bottom: 46, left: 50 };

/**
 * §5.4. The primary output. Phase boundaries as vertical rules, phase means as
 * horizontal segments, excluded days greyed but present, confounder days ticked
 * below the axis, and the MCID as a band around the baseline mean — so the reader
 * can see whether the intervention cleared it without reading a number.
 */
export function RunChart({ protocol, observations, doses = [], metricId, unit = "", mcid }: Props) {
  const series = useMemo(() => extractSeries(observations, metricId), [observations, metricId]);

  const model = useMemo(() => {
    if (series.length < 2) return null;

    const assigned = assignPhases(
      series.map((p) => p.date),
      protocol.phases,
      protocol.intervention.onsetLagDays,
      protocol.intervention.washoutDays,
      doses,
    );
    const byDate = new Map(assigned.map((a) => [a.date, a]));

    const origin = protocol.phases[0]?.startDate ?? series[0]!.date;
    const lastEnd = protocol.phases.reduce(
      (l, p) => (utcMs(p.endDate) > utcMs(l) ? p.endDate : l),
      protocol.phases[0]?.endDate ?? series[series.length - 1]!.date,
    );
    const spanDays = Math.max(daysBetween(origin, lastEnd), 1);

    const values = series.map((p) => p.value);
    const [y0, y1] = pad(Math.min(...values, 0 + Math.min(...values)), Math.max(...values));

    const baselineVals = series
      .filter((p) => byDate.get(p.date)?.phase === "baseline" && !byDate.get(p.date)!.excluded)
      .map((p) => p.value);
    const baselineMean = baselineVals.length ? mean(baselineVals) : null;

    // Phase mean segments, one per declared phase.
    const segments = protocol.phases.map((ph, i) => {
      const vals = series
        .filter((p) => {
          const a = byDate.get(p.date);
          return a?.phaseIndex === i && !a.excluded;
        })
        .map((p) => p.value);
      return {
        phase: ph,
        index: i,
        mean: vals.length ? mean(vals) : null,
        n: vals.length,
      };
    });

    return { assigned, byDate, origin, spanDays, y0, y1, baselineMean, segments };
  }, [series, protocol, doses]);

  if (!model) {
    return (
      <div className="empty">
        <p style={{ margin: 0 }}>Not enough readings yet to draw the run chart.</p>
      </div>
    );
  }

  const { byDate, origin, spanDays, y0, y1, baselineMean, segments } = model;
  const x = linear([0, spanDays], [M.left, W - M.right]);
  const y = linear([y0, y1], [H - M.bottom, M.top]);
  const yTicks = ticks(y0, y1, 4);

  const colourFor = (phase: string | null | undefined) =>
    phase === "intervention" ? "var(--phase-b)" : "var(--phase-a)";

  return (
    <svg
      className="chart"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Run chart of ${metricId} across ${protocol.phases.length} phases`}
    >
      {/* The MCID band around the baseline mean: cleared or not, without a number. */}
      {baselineMean !== null && mcid > 0 && (
        <>
          <rect
            x={M.left}
            y={y(baselineMean + mcid)}
            width={W - M.right - M.left}
            height={Math.abs(y(baselineMean - mcid) - y(baselineMean + mcid))}
            fill="var(--ink)"
            opacity={0.055}
          />
          <line
            className="grid"
            x1={M.left}
            x2={W - M.right}
            y1={y(baselineMean)}
            y2={y(baselineMean)}
            strokeDasharray="2 3"
          />
        </>
      )}

      {yTicks.map((t) => (
        <g key={t}>
          <line className="grid" x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} opacity={0.35} />
          <text x={M.left - 6} y={y(t)} textAnchor="end" dominantBaseline="middle">
            {t}
          </text>
        </g>
      ))}

      <line className="axis" x1={M.left} x2={M.left} y1={M.top} y2={H - M.bottom} />
      <line className="axis" x1={M.left} x2={W - M.right} y1={H - M.bottom} y2={H - M.bottom} />

      {/* Phase boundaries and labels */}
      {protocol.phases.map((ph, i) => {
        const px = x(daysBetween(origin, ph.startDate));
        return (
          <g key={i}>
            {i > 0 && (
              <line
                x1={px}
                x2={px}
                y1={M.top - 6}
                y2={H - M.bottom}
                stroke="var(--ink-40)"
                strokeWidth={1}
              />
            )}
            <text className="phase-label" x={px + 4} y={M.top - 8} fill={colourFor(ph.phase)}>
              {ph.phase === "intervention" ? "B" : "A"} · {ph.phase}
            </text>
          </g>
        );
      })}

      {/* Phase means as horizontal segments spanning each phase */}
      {segments.map(
        (s) =>
          s.mean !== null && (
            <line
              key={s.index}
              x1={x(daysBetween(origin, s.phase.startDate))}
              x2={x(daysBetween(origin, s.phase.endDate))}
              y1={y(s.mean)}
              y2={y(s.mean)}
              stroke={colourFor(s.phase.phase)}
              strokeWidth={2.5}
            />
          ),
      )}

      {/* One point per day. Excluded days greyed, never deleted. */}
      {series.map((p) => {
        const a = byDate.get(p.date);
        const cx = x(daysBetween(origin, p.date));
        const excluded = a?.excluded ?? false;
        return (
          <circle
            key={p.date}
            cx={cx}
            cy={y(p.value)}
            r={excluded ? 2 : 2.6}
            fill={excluded ? "var(--excluded)" : colourFor(a?.phase)}
            opacity={excluded ? 0.75 : 1}
          >
            <title>
              {p.date}: {p.value}
              {unit ? ` ${unit}` : ""}
              {excluded ? ` — excluded (${a?.exclusionReason?.replace("_", " ")})` : ""}
            </title>
          </circle>
        );
      })}

      {/* Confounder days: a small tick below the axis */}
      {observations
        .filter((o) => o.confounders.length > 0)
        .map((o) => {
          const cx = x(daysBetween(origin, o.date));
          if (cx < M.left || cx > W - M.right) return null;
          return (
            <line
              key={o.date}
              x1={cx}
              x2={cx}
              y1={H - M.bottom + 2}
              y2={H - M.bottom + 8}
              stroke="var(--ink-40)"
              strokeWidth={1.5}
            >
              <title>
                {o.date}: {o.confounders.join(", ")}
              </title>
            </line>
          );
        })}

      {[0, Math.floor(spanDays / 2), spanDays].map((dd) => {
        const iso = new Date(utcMs(origin) + dd * 86_400_000).toISOString().slice(0, 10);
        return (
          <text key={dd} x={x(dd)} y={H - M.bottom + 22} textAnchor="middle">
            {shortDate(iso)}
          </text>
        );
      })}

      <text x={M.left} y={H - 6} className="phase-label" fill="var(--ink-60)">
        ▪ grey = excluded · ticks below axis = confounder days · band = your threshold
      </text>
    </svg>
  );
}

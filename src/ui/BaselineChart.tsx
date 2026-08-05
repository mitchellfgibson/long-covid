import { dayOffsets, linear, pad, shortDate, ticks } from "./charts";
import type { SeriesPoint } from "../stats/series";

interface Props {
  points: SeriesPoint[];
  unit?: string;
  /** Fitted drift, drawn so the user sees a moving baseline before locking (§3.1). */
  slope?: number;
  intercept?: number;
  label?: string;
}

const W = 720;
const H = 240;
const M = { top: 14, right: 14, bottom: 30, left: 46 };

export function BaselineChart({ points, unit = "", slope, intercept, label = "Baseline" }: Props) {
  if (points.length < 2) {
    return (
      <div className="empty">
        <p style={{ margin: 0 }}>Not enough readings yet to draw a baseline.</p>
      </div>
    );
  }

  const origin = points[0]!.date;
  const xs = dayOffsets(
    points.map((p) => p.date),
    origin,
  );
  const ys = points.map((p) => p.value);

  const [y0, y1] = pad(Math.min(...ys), Math.max(...ys));
  const x = linear([0, Math.max(...xs)], [M.left, W - M.right]);
  const y = linear([y0, y1], [H - M.bottom, M.top]);

  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(xs[i]!)},${y(p.value)}`).join(" ");
  const yTicks = ticks(y0, y1, 4);
  const xTickIdx = [0, Math.floor(points.length / 2), points.length - 1];

  const showTrend = slope !== undefined && intercept !== undefined;

  return (
    <svg
      className="chart"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`${label}: ${points.length} readings from ${points[0]!.date} to ${points[points.length - 1]!.date}`}
    >
      {yTicks.map((t) => (
        <g key={t}>
          <line className="grid" x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} opacity={0.5} />
          <text x={M.left - 6} y={y(t)} textAnchor="end" dominantBaseline="middle">
            {t}
          </text>
        </g>
      ))}

      <line className="axis" x1={M.left} x2={M.left} y1={M.top} y2={H - M.bottom} />
      <line className="axis" x1={M.left} x2={W - M.right} y1={H - M.bottom} y2={H - M.bottom} />

      {xTickIdx.map((i) => (
        <text key={i} x={x(xs[i]!)} y={H - M.bottom + 14} textAnchor="middle">
          {shortDate(points[i]!.date)}
        </text>
      ))}

      {showTrend && (
        <line
          x1={x(0)}
          y1={y(intercept!)}
          x2={x(Math.max(...xs))}
          y2={y(intercept! + slope! * Math.max(...xs))}
          stroke="var(--phase-b)"
          strokeWidth={1.5}
          strokeDasharray="4 3"
        />
      )}

      <path d={path} fill="none" stroke="var(--phase-a)" strokeWidth={1.25} opacity={0.55} />
      {points.map((p, i) => (
        <circle key={p.date} cx={x(xs[i]!)} cy={y(p.value)} r={2.4} fill="var(--phase-a)">
          <title>
            {p.date}: {p.value}
            {unit ? ` ${unit}` : ""}
          </title>
        </circle>
      ))}
    </svg>
  );
}

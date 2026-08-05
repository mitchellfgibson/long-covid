import { daysBetween } from "../stats/series";

export interface Scale {
  (v: number): number;
}

export function linear(domain: [number, number], range: [number, number]): Scale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0 || 1;
  return (v: number) => r0 + ((v - d0) / span) * (r1 - r0);
}

/** Nice-ish round tick values across a domain. */
export function ticks(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return [min];
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? mag * 10;
  const out: number[] = [];
  for (let t = Math.ceil(min / step) * step; t <= max + 1e-9; t += step) out.push(Number(t.toFixed(10)));
  return out;
}

export function pad(min: number, max: number, frac = 0.08): [number, number] {
  if (min === max) return [min - 1, max + 1];
  const p = (max - min) * frac;
  return [min - p, max + p];
}

/** x position helper: calendar days from the first date. */
export function dayOffsets(dates: string[], origin: string): number[] {
  return dates.map((d) => daysBetween(origin, d));
}

export function shortDate(iso: string): string {
  return iso.slice(5).replace("-", "/");
}

import type { Observation } from "../types";

/** RFC4180-ish: quoted fields, doubled quotes, CRLF or LF. */
export function parseCsv(input: string): string[][] {
  // Excel and many exporters prepend a byte-order mark, which would otherwise
  // become part of the first column's name and break header matching.
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    if (row.length > 1 || row[0] !== "") rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"' && field === "") {
      quoted = true;
      i++;
      continue;
    }
    if (c === ",") {
      endField();
      i++;
      continue;
    }
    if (c === "\r") {
      i++;
      continue;
    }
    if (c === "\n") {
      endRow();
      i++;
      continue;
    }
    field += c;
    i++;
  }
  if (field !== "" || row.length > 0) endRow();
  return rows;
}

/** Which way round an all-numeric date reads. Year-first and month-name forms need no choice. */
export type DateFormat = "iso" | "mdy" | "dmy";

/**
 * A trailing time is stripped, not parsed. Device exports carry timestamps
 * ("2026-01-05T06:23:11-08:00"), and the day the reading belongs to is the date
 * as the device wrote it. Converting through UTC would silently move a late-evening
 * reading onto the next day for anyone west of Greenwich.
 */
const TIME_TAIL = String.raw`(?:[T ][\d:.]+(?:\s?[A-Za-z]{1,4})?(?:\s?[+-]\d{2}:?\d{2}|Z)?)?`;

const YEAR_FIRST = new RegExp(String.raw`^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})${TIME_TAIL}$`);
const NUMERIC = new RegExp(String.raw`^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})${TIME_TAIL}$`);
const DAY_MONTH_NAME = new RegExp(
  String.raw`^(\d{1,2})[ -]([A-Za-z]{3,9})\.?[ -,]+(\d{4})${TIME_TAIL}$`,
);
const MONTH_NAME_DAY = new RegExp(
  String.raw`^([A-Za-z]{3,9})\.?[ -]+(\d{1,2})(?:st|nd|rd|th)?,?[ -]+(\d{4})${TIME_TAIL}$`,
);

const MONTHS = [
  "jan", "feb", "mar", "apr", "may", "jun",
  "jul", "aug", "sep", "oct", "nov", "dec",
];

function monthFromName(name: string): number | null {
  const i = MONTHS.indexOf(name.slice(0, 3).toLowerCase());
  return i < 0 ? null : i + 1;
}

/** Rejects impossible dates like 2026-02-30 rather than letting Date roll them over. */
function iso(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const s = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const t = Date.parse(`${s}T00:00:00Z`);
  if (Number.isNaN(t)) return null;
  return new Date(t).toISOString().slice(0, 10) === s ? s : null;
}

type Shape =
  | { kind: "unambiguous"; date: string }
  | { kind: "numeric"; a: number; b: number; year: number }
  | { kind: "unreadable" };

/** Classify one cell without deciding the day/month order. */
function shapeOf(raw: string): Shape {
  const s = raw.trim();
  if (s === "") return { kind: "unreadable" };

  const y = YEAR_FIRST.exec(s);
  if (y) {
    const date = iso(Number(y[1]), Number(y[2]), Number(y[3]));
    return date ? { kind: "unambiguous", date } : { kind: "unreadable" };
  }

  for (const [re, order] of [
    [DAY_MONTH_NAME, "dm"],
    [MONTH_NAME_DAY, "md"],
  ] as const) {
    const m = re.exec(s);
    if (!m) continue;
    const month = monthFromName(order === "dm" ? m[2]! : m[1]!);
    const day = Number(order === "dm" ? m[1] : m[2]);
    if (month === null) return { kind: "unreadable" };
    const date = iso(Number(m[3]), month, day);
    return date ? { kind: "unambiguous", date } : { kind: "unreadable" };
  }

  const n = NUMERIC.exec(s);
  if (n) return { kind: "numeric", a: Number(n[1]), b: Number(n[2]), year: Number(n[3]) };

  return { kind: "unreadable" };
}

export type DateDetection =
  | { kind: "iso" } // year-first or month-name: no choice needed
  | { kind: "mdy" }
  | { kind: "dmy" }
  | { kind: "ambiguous" }
  | { kind: "unparseable"; samples: string[] };

/**
 * §2: never guess. A column whose numeric dates could read either way is reported
 * ambiguous so the UI can ask. Unreadable values are reported *with examples* — a
 * bare "reformat the column" leaves the user with nothing to act on.
 *
 * A minority of unreadable rows no longer condemns the column: real exports carry
 * blank rows, footers and summary lines, and one of them should not make an
 * otherwise valid date column unusable.
 */
export function detectDateFormat(samples: string[]): DateDetection {
  const bad: string[] = [];
  let unambiguous = 0;
  let numeric = 0;
  let firstOver12 = false; // first field > 12, so it can only be a day
  let secondOver12 = false; // second field > 12, so it can only be a day

  for (const raw of samples) {
    if (raw.trim() === "") continue;
    const shape = shapeOf(raw);
    if (shape.kind === "unreadable") {
      if (bad.length < 5) bad.push(raw.trim());
      continue;
    }
    if (shape.kind === "unambiguous") {
      unambiguous++;
      continue;
    }
    numeric++;
    if (shape.a > 12) firstOver12 = true;
    if (shape.b > 12) secondOver12 = true;
  }

  const good = unambiguous + numeric;
  // Tolerate a minority of junk rows, but not a column that is mostly unreadable.
  if (good === 0 || bad.length > good) return { kind: "unparseable", samples: bad };

  if (firstOver12 && secondOver12) return { kind: "unparseable", samples: bad };
  if (numeric === 0) return { kind: "iso" };
  if (firstOver12) return { kind: "dmy" };
  if (secondOver12) return { kind: "mdy" };
  return { kind: "ambiguous" }; // every numeric field <= 12: genuinely undecidable
}

export function normalizeDate(raw: string, format: DateFormat): string {
  const shape = shapeOf(raw);
  if (shape.kind === "unambiguous") return shape.date;
  if (shape.kind === "unreadable") throw new Error(`could not read "${raw}" as a date`);

  const month = format === "dmy" ? shape.b : shape.a;
  const day = format === "dmy" ? shape.a : shape.b;
  const date = iso(shape.year, month, day);
  if (!date) throw new Error(`"${raw}" is not a real date read as ${format === "dmy" ? "D/M/Y" : "M/D/Y"}`);
  return date;
}

export interface ColumnMapping {
  dateColumn: string;
  dateFormat: DateFormat;
  /** CSV column header -> metricId. Columns absent from this map are ignored. */
  metricColumns: Record<string, string>;
}

export interface ValueConflict {
  date: string;
  metricId: string;
  values: number[];
}

/**
 * §2-adjacent: two different readings for one metric on one day. Averaging them
 * would invent a number the user never recorded, so this stops and asks, exactly
 * as an ambiguous date column does.
 */
export class DuplicateValueError extends Error {
  readonly conflicts: ValueConflict[];
  constructor(conflicts: ValueConflict[]) {
    const first = conflicts[0]!;
    super(
      `${conflicts.length} date(s) carry more than one value for the same metric, ` +
        `starting with ${first.date} (${first.metricId}: ${first.values.join(", ")}). ` +
        `Pick which reading to keep — these are not averaged.`,
    );
    this.name = "DuplicateValueError";
    this.conflicts = conflicts;
  }
}

/**
 * Apply a saved column mapping to parsed CSV rows. Blank and non-numeric cells
 * become absent values, never zeros. Rows sharing a date merge across *different*
 * metrics; the same metric twice with different values is a conflict, not a merge.
 */
export function rowsToObservations(rows: string[][], mapping: ColumnMapping): Observation[] {
  const header = rows[0];
  if (!header) return [];
  const dateIdx = header.indexOf(mapping.dateColumn);
  if (dateIdx < 0) throw new Error(`date column "${mapping.dateColumn}" is not in this file`);

  const metricIdxs: [number, string][] = [];
  for (const [col, metricId] of Object.entries(mapping.metricColumns)) {
    const idx = header.indexOf(col);
    if (idx < 0) throw new Error(`metric column "${col}" is not in this file`);
    metricIdxs.push([idx, metricId]);
  }

  const byDate = new Map<string, Observation>();
  const seen = new Map<string, ValueConflict>();

  for (const row of rows.slice(1)) {
    const rawDate = row[dateIdx];
    if (rawDate === undefined || rawDate.trim() === "") continue;
    const date = normalizeDate(rawDate, mapping.dateFormat);
    const obs: Observation = byDate.get(date) ?? { date, values: {}, confounders: [] };
    for (const [idx, metricId] of metricIdxs) {
      const cell = row[idx]?.trim() ?? "";
      if (cell === "") continue;
      const v = Number(cell);
      if (!Number.isFinite(v)) continue;

      const key = `${date} ${metricId}`;
      const prior = seen.get(key);
      if (prior === undefined) {
        seen.set(key, { date, metricId, values: [v] });
      } else if (!prior.values.includes(v)) {
        prior.values.push(v); // a repeat of the same reading is harmless; a different one is not
      }
      obs.values[metricId] = v;
    }
    byDate.set(date, obs);
  }

  const conflicts = [...seen.values()].filter((c) => c.values.length > 1);
  if (conflicts.length > 0) {
    conflicts.sort((a, b) => a.date.localeCompare(b.date) || a.metricId.localeCompare(b.metricId));
    throw new DuplicateValueError(conflicts);
  }

  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

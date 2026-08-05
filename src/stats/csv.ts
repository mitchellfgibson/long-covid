import type { Observation } from "../types";

/** RFC4180-ish: quoted fields, doubled quotes, CRLF or LF. */
export function parseCsv(text: string): string[][] {
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

export type DateFormat = "iso" | "mdy";

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const MDY = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

/**
 * §2: support ISO and MM/DD/YYYY. Ambiguity is never guessed — a column whose
 * slash-dates could be either MM/DD or DD/MM is reported so the UI can ask.
 */
export function detectDateFormat(
  samples: string[],
): { kind: "iso" } | { kind: "mdy" } | { kind: "ambiguous" } | { kind: "unparseable" } {
  let iso = 0;
  let slash = 0;
  let ambiguous = false;
  let mdyOnly = false;

  for (const raw of samples) {
    const s = raw.trim();
    if (s === "") continue;
    if (ISO.test(s)) {
      iso++;
      continue;
    }
    const m = MDY.exec(s);
    if (!m) return { kind: "unparseable" };
    slash++;
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a > 12) return { kind: "unparseable" }; // not MM/DD/YYYY at all
    if (b > 12) mdyOnly = true; // second field can only be a day
    else ambiguous = true; // both fields <= 12: could be DD/MM
  }

  if (slash === 0 && iso > 0) return { kind: "iso" };
  if (slash > 0 && iso > 0) return { kind: "ambiguous" }; // mixed formats in one column
  if (mdyOnly) return { kind: "mdy" };
  if (ambiguous) return { kind: "ambiguous" };
  return { kind: "unparseable" };
}

export function normalizeDate(raw: string, format: DateFormat): string {
  const s = raw.trim();
  if (format === "iso") {
    const m = ISO.exec(s);
    if (!m) throw new Error(`not an ISO date: "${raw}"`);
    return s;
  }
  const m = MDY.exec(s);
  if (!m) throw new Error(`not MM/DD/YYYY: "${raw}"`);
  const [, mm, dd, yyyy] = m;
  return `${yyyy}-${mm!.padStart(2, "0")}-${dd!.padStart(2, "0")}`;
}

export interface ColumnMapping {
  dateColumn: string;
  dateFormat: DateFormat;
  /** CSV column header -> metricId. Columns absent from this map are ignored. */
  metricColumns: Record<string, string>;
}

/**
 * Apply a saved column mapping to parsed CSV rows. Blank and non-numeric cells
 * become absent values, never zeros.
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
      obs.values[metricId] = v;
    }
    byDate.set(date, obs);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

import { describe, expect, it } from "vitest";
import { detectDateFormat, normalizeDate, parseCsv, rowsToObservations } from "./csv";

describe("csv parsing", () => {
  it("handles quoted fields, doubled quotes, and CRLF", () => {
    const rows = parseCsv('date,note,hrv\r\n2026-01-01,"a ""quoted"", comma",55\r\n');
    expect(rows).toEqual([
      ["date", "note", "hrv"],
      ["2026-01-01", 'a "quoted", comma', "55"],
    ]);
  });

  it("does not hardcode any device's column names", () => {
    const rows = parseCsv("Cycle start time,Heart rate variability (ms)\n2026-01-01,55\n");
    const obs = rowsToObservations(rows, {
      dateColumn: "Cycle start time",
      dateFormat: "iso",
      metricColumns: { "Heart rate variability (ms)": "hrv" },
    });
    expect(obs).toEqual([{ date: "2026-01-01", values: { hrv: 55 }, confounders: [] }]);
  });
});

describe("date handling", () => {
  it("detects ISO and MM/DD/YYYY", () => {
    expect(detectDateFormat(["2026-01-01", "2026-01-02"])).toEqual({ kind: "iso" });
    expect(detectDateFormat(["1/13/2026", "2/28/2026"])).toEqual({ kind: "mdy" });
  });

  it("asks rather than guesses when slash dates are ambiguous", () => {
    expect(detectDateFormat(["01/02/2026", "03/04/2026"])).toEqual({ kind: "ambiguous" });
  });

  it("normalizes MM/DD/YYYY to ISO", () => {
    expect(normalizeDate("1/5/2026", "mdy")).toBe("2026-01-05");
  });
});

describe("blank cells", () => {
  it("become absent values, never zeros", () => {
    const rows = parseCsv("date,hrv\n2026-01-01,55\n2026-01-02,\n2026-01-03,61\n");
    const obs = rowsToObservations(rows, {
      dateColumn: "date",
      dateFormat: "iso",
      metricColumns: { hrv: "hrv" },
    });
    expect(obs).toHaveLength(3);
    expect(obs[1]!.values.hrv).toBeUndefined();
    expect(obs[1]!.values.hrv).not.toBe(0);
  });
});

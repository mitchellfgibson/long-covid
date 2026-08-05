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

  it("detects day-first when the first field exceeds 12", () => {
    expect(detectDateFormat(["13/01/2026", "28/02/2026"])).toEqual({ kind: "dmy" });
    expect(normalizeDate("13/01/2026", "dmy")).toBe("2026-01-13");
  });

  it("asks rather than guesses when slash dates are ambiguous", () => {
    expect(detectDateFormat(["01/02/2026", "03/04/2026"])).toEqual({ kind: "ambiguous" });
  });

  it("normalizes MM/DD/YYYY to ISO", () => {
    expect(normalizeDate("1/5/2026", "mdy")).toBe("2026-01-05");
  });
});

describe("timestamps from real device exports", () => {
  // The original detector accepted only bare dates, so every export carrying a
  // time of day was rejected as unreadable.
  const stamps = [
    "2026-01-05T00:00:00.000Z",
    "2026-01-05T06:23:11",
    "2026-01-05 06:23:11",
    "2026-01-05T23:30:00-08:00",
  ];

  it("reads a date out of an ISO timestamp", () => {
    for (const s of stamps) {
      expect(detectDateFormat([s, s])).toEqual({ kind: "iso" });
      expect(normalizeDate(s, "iso")).toBe("2026-01-05");
    }
  });

  it("keeps the date the device wrote rather than shifting it through UTC", () => {
    // 23:30 on the 5th at -08:00 is the 6th in UTC. The reading belongs to the
    // 5th, which is the day the user lived through.
    expect(normalizeDate("2026-01-05T23:30:00-08:00", "iso")).toBe("2026-01-05");
  });

  it("reads timestamps on slash dates too", () => {
    expect(normalizeDate("01/05/2026 06:23", "mdy")).toBe("2026-01-05");
  });
});

describe("other formats exports produce", () => {
  it("accepts single-digit ISO parts, dots and slashes", () => {
    expect(normalizeDate("2026-1-5", "iso")).toBe("2026-01-05");
    expect(normalizeDate("2026.01.05", "iso")).toBe("2026-01-05");
    expect(normalizeDate("2026/01/05", "iso")).toBe("2026-01-05");
  });

  it("accepts month names in either order without needing to be told", () => {
    expect(detectDateFormat(["5 Jan 2026"])).toEqual({ kind: "iso" });
    expect(normalizeDate("5 Jan 2026", "iso")).toBe("2026-01-05");
    expect(normalizeDate("Jan 5, 2026", "mdy")).toBe("2026-01-05");
    expect(normalizeDate("5 January 2026", "dmy")).toBe("2026-01-05");
  });

  it("rejects impossible dates instead of rolling them over", () => {
    expect(() => normalizeDate("2026-02-30", "iso")).toThrow();
    expect(() => normalizeDate("13/13/2026", "mdy")).toThrow();
  });

  it("refuses two-digit years rather than guessing the century", () => {
    const d = detectDateFormat(["01/05/26", "02/06/26"]);
    expect(d.kind).toBe("unparseable");
  });
});

describe("unreadable columns report what they saw", () => {
  it("names the offending values so the user can act", () => {
    const d = detectDateFormat(["not a date", "also not"]);
    expect(d.kind).toBe("unparseable");
    if (d.kind === "unparseable") expect(d.samples).toContain("not a date");
  });

  it("tolerates a minority of junk rows in an otherwise good column", () => {
    // Real exports carry footers and summary lines.
    const rows = [...Array.from({ length: 20 }, (_, i) => `2026-01-${String(i + 1).padStart(2, "0")}`), "Total", ""];
    expect(detectDateFormat(rows)).toEqual({ kind: "iso" });
  });

  it("still fails a column that is mostly unreadable", () => {
    expect(detectDateFormat(["2026-01-01", "x", "y", "z"]).kind).toBe("unparseable");
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

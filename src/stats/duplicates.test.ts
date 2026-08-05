import { describe, expect, it } from "vitest";
import { DuplicateValueError, parseCsv, rowsToObservations } from "./csv";

const mapping = {
  dateColumn: "date",
  dateFormat: "iso" as const,
  metricColumns: { hrv: "hrv", rhr: "rhr" },
};

describe("item 7: duplicate dates", () => {
  it("merges rows that carry different metrics for the same date", () => {
    const rows = parseCsv("date,hrv,rhr\n2026-01-01,55,\n2026-01-01,,48\n");
    const obs = rowsToObservations(rows, mapping);
    expect(obs).toHaveLength(1);
    expect(obs[0]!.values).toEqual({ hrv: 55, rhr: 48 });
  });

  it("accepts the same value repeated for the same metric", () => {
    const rows = parseCsv("date,hrv,rhr\n2026-01-01,55,\n2026-01-01,55,48\n");
    const obs = rowsToObservations(rows, mapping);
    expect(obs).toHaveLength(1);
    expect(obs[0]!.values.hrv).toBe(55);
  });

  it("stops and asks when one metric has two different values on one date", () => {
    const rows = parseCsv("date,hrv,rhr\n2026-01-01,55,\n2026-01-01,61,48\n");
    expect(() => rowsToObservations(rows, mapping)).toThrow(DuplicateValueError);
  });

  it("never averages: 55 and 61 do not become 58", () => {
    const rows = parseCsv("date,hrv,rhr\n2026-01-01,55,\n2026-01-01,61,48\n");
    try {
      rowsToObservations(rows, mapping);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(DuplicateValueError);
      const conflict = (err as DuplicateValueError).conflicts[0]!;
      expect(conflict.date).toBe("2026-01-01");
      expect(conflict.metricId).toBe("hrv");
      expect(conflict.values).toEqual([55, 61]);
      expect(conflict.values).not.toContain(58);
    }
  });

  it("reports every conflict at once, sorted, so the user resolves them in one pass", () => {
    const rows = parseCsv(
      "date,hrv,rhr\n2026-01-03,70,\n2026-01-03,71,\n2026-01-01,55,\n2026-01-01,,48\n2026-01-01,,49\n",
    );
    try {
      rowsToObservations(rows, mapping);
      expect.unreachable("should have thrown");
    } catch (err) {
      const conflicts = (err as DuplicateValueError).conflicts;
      expect(conflicts).toHaveLength(2);
      expect(conflicts[0]).toEqual({ date: "2026-01-01", metricId: "rhr", values: [48, 49] });
      expect(conflicts[1]).toEqual({ date: "2026-01-03", metricId: "hrv", values: [70, 71] });
    }
  });

  it("handles metric ids containing spaces without mis-grouping", () => {
    const rows = parseCsv("date,a b,c\n2026-01-01,5,7\n2026-01-01,6,7\n");
    try {
      rowsToObservations(rows, {
        dateColumn: "date",
        dateFormat: "iso",
        metricColumns: { "a b": "a b", c: "c" },
      });
      expect.unreachable("should have thrown");
    } catch (err) {
      const conflicts = (err as DuplicateValueError).conflicts;
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0]!.metricId).toBe("a b");
    }
  });
});

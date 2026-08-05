// @vitest-environment jsdom
import { describe, expect, it, afterEach, beforeEach } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import App from "../App";
import { reducer, initialState, loadState, type AppState } from "../state/store";
import { derivePhases } from "./Builder";
import type { Observation } from "../types";
import { gaussian, isoDates, mulberry32 } from "../stats/testutil";

/**
 * This Node exposes its own method-less `localStorage` global, which shadows the
 * one jsdom installs. The app itself is unaffected — both accesses in the store
 * are guarded — but the tests need real storage to seed state through.
 */
function installStorage() {
  const map = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, String(v)),
  };
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
  Object.defineProperty(window, "localStorage", { value: storage, configurable: true });
}

beforeEach(() => {
  installStorage();
  localStorage.clear();
});

// Auto-cleanup only registers when vitest globals are on, and they are not.
afterEach(cleanup);

describe("the app renders", () => {
  it("boots to the data step with the safety line always present", () => {
    render(<App />);
    expect(screen.getByText("PIPELINE")).toBeDefined();
    expect(screen.getByText(/does not give medical advice/i)).toBeDefined();
    expect(screen.getByRole("heading", { name: /bring in your data/i })).toBeDefined();
  });

  it("gates steps that cannot work yet, rather than failing later", () => {
    render(<App />);
    expect(screen.getByRole("button", { name: /Can it work\?/ })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: /Locked sheet/ })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: /Result/ })).toHaveProperty("disabled", true);
  });

  it("reaches the power verdict once data exists", () => {
    const g = gaussian(mulberry32(5));
    const observations: Observation[] = isoDates("2026-01-01", 40).map((date) => ({
      date,
      values: { hrv: 50 + 6 * g() },
      confounders: [],
    }));
    const seeded: AppState = {
      ...initialState,
      observations,
      metrics: [{ id: "hrv", label: "HRV", unit: "ms", direction: "higher_is_better" }],
      draft: { primaryMetricId: "hrv", mcid: 3 },
    };
    localStorage.setItem("pipeline.v1", JSON.stringify(seeded));

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Can it work\?/ }));

    expect(screen.getByRole("heading", { name: /Can this experiment answer/i })).toBeDefined();
    // A 3 ms threshold against ~6 ms of noise over 30 days cannot be adequate.
    expect(screen.getByText(/Underpowered|Infeasible/)).toBeDefined();
  });
});

describe("persistence", () => {
  it("loads state from the pipeline key", () => {
    localStorage.setItem(
      "pipeline.v1",
      JSON.stringify({ ...initialState, plannedInterventionDays: 44 }),
    );
    expect(loadState().plannedInterventionDays).toBe(44);
  });

  it("falls back to defaults rather than throwing on unreadable storage", () => {
    localStorage.setItem("pipeline.v1", "{ not json");
    expect(loadState()).toEqual(initialState);
  });
});

describe("state reducer", () => {
  it("never lets an import silently overwrite a hand-entered value", () => {
    const typed: Observation = { date: "2026-01-01", values: { hrv: 99 }, confounders: ["illness"] };
    const withTyped = reducer(initialState, { type: "upsertObservation", observation: typed });

    const imported = reducer(withTyped, {
      type: "import",
      observations: [{ date: "2026-01-01", values: { hrv: 55, rhr: 48 }, confounders: [] }],
      metrics: [],
      mapping: { dateColumn: "date", dateFormat: "iso", metricColumns: {} },
    });

    const row = imported.observations.find((o) => o.date === "2026-01-01")!;
    expect(row.values.hrv).toBe(99); // the hand-entered value wins
    expect(row.values.rhr).toBe(48); // the new metric still arrives
    expect(row.confounders).toContain("illness");
  });

  it("keeps observations sorted by date regardless of entry order", () => {
    let s = initialState;
    for (const date of ["2026-03-01", "2026-01-01", "2026-02-01"]) {
      s = reducer(s, { type: "upsertObservation", observation: { date, values: {}, confounders: [] } });
    }
    expect(s.observations.map((o) => o.date)).toEqual(["2026-01-01", "2026-02-01", "2026-03-01"]);
  });
});

describe("phase derivation", () => {
  it("lays phases end to end without overlapping a day", () => {
    const phases = derivePhases("ABA", "2026-01-01", 28, 30);
    expect(phases).toHaveLength(3);
    expect(phases[0]).toEqual({
      phase: "baseline",
      startDate: "2026-01-01",
      endDate: "2026-01-28",
    });
    expect(phases[1]!.startDate).toBe("2026-01-29");
    expect(phases[1]!.endDate).toBe("2026-02-27");
    expect(phases[2]!.startDate).toBe("2026-02-28");
  });

  it("gives ABAB four phases", () => {
    expect(derivePhases("ABAB", "2026-01-01", 14, 14)).toHaveLength(4);
  });
});

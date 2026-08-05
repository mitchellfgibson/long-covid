import { describe, expect, it } from "vitest";
import { autocorrPerDay, medianGap, nEff, rAtSpacing } from "./noise";
import { ar1, mulberry32 } from "./testutil";

/** Delete a fixed fraction of days with a fixed seed, keeping calendar positions. */
function decimate(
  xs: number[],
  fraction: number,
  seed: number,
): { values: number[]; dayIdx: number[] } {
  const rand = mulberry32(seed);
  const values: number[] = [];
  const dayIdx: number[] = [];
  for (let i = 0; i < xs.length; i++) {
    if (rand() < fraction) continue;
    values.push(xs[i]!);
    dayIdx.push(i);
  }
  return { values, dayIdx };
}

describe("item 4: decimation", () => {
  const full = ar1(2000, 0.5, 1, 12345);
  const fullR1 = autocorrPerDay(
    full,
    full.map((_, i) => i),
  ).r1;

  it("recovers the full-series r1 after deleting a random 40% of days", () => {
    const { values, dayIdx } = decimate(full, 0.4, 777);

    // Sanity: the deletion actually happened and left a real gap structure.
    expect(values.length).toBeGreaterThan(1000);
    expect(values.length).toBeLessThan(1400);

    const ac = autocorrPerDay(values, dayIdx);
    expect(ac.method).toBe("lag1");

    // Tolerance is 3x the measured across-seed spread (sd 0.029 over 60 seeds),
    // so this fails on bias rather than on an unlucky draw.
    expect(Math.abs(ac.r1 - fullR1)).toBeLessThan(0.09);

    // The pre-fix estimator divided the surviving-pair numerator by the full n,
    // landing near fullR1 * 0.6 — a deviation of about -0.20.
    expect(ac.r1).toBeGreaterThan(fullR1 * 0.85);
  });

  it("is unbiased under decimation, not merely close on one lucky seed", () => {
    // Averaging over seeds shrinks the sampling noise and isolates the bias the
    // old n-normalized denominator introduced. That bias scaled with the deletion
    // fraction: roughly -0.20 at 40% and -0.30 at 60%.
    for (const [fraction, limit] of [
      [0.4, 0.02],
      [0.6, 0.03],
    ] as const) {
      const devs: number[] = [];
      for (let seed = 1; seed <= 40; seed++) {
        const { values, dayIdx } = decimate(full, fraction, seed);
        devs.push(autocorrPerDay(values, dayIdx).r1 - fullR1);
      }
      const meanDev = devs.reduce((s, d) => s + d, 0) / devs.length;
      expect(Math.abs(meanDev)).toBeLessThan(limit);
    }
  });
});

describe("item 4: same process, different sampling", () => {
  const full = ar1(2000, 0.5, 1, 20260804);

  const daily = { values: full, dayIdx: full.map((_, i) => i) };
  const everyOther = {
    values: full.filter((_, i) => i % 2 === 0),
    dayIdx: full.map((_, i) => i).filter((i) => i % 2 === 0),
  };

  it("reports the same per-day r1 from a daily and an every-other-day series", () => {
    const a = autocorrPerDay(daily.values, daily.dayIdx);
    const b = autocorrPerDay(everyOther.values, everyOther.dayIdx);

    expect(a.method).toBe("lag1");
    expect(b.method).toBe("lag_k");
    expect(b.lag).toBe(2);

    // b estimates r_2 ~ 0.25 and takes the square root to get back to per-day.
    expect(Math.abs(a.r1 - b.r1)).toBeLessThan(0.06);
  });

  it("but reports different n_eff, because information is per observation", () => {
    const a = autocorrPerDay(daily.values, daily.dayIdx);
    const b = autocorrPerDay(everyOther.values, everyOther.dayIdx);

    const aEff = nEff(daily.values.length, rAtSpacing(a.r1, medianGap(daily.dayIdx)));
    const bEff = nEff(everyOther.values.length, rAtSpacing(b.r1, medianGap(everyOther.dayIdx)));

    expect(medianGap(daily.dayIdx)).toBe(1);
    expect(medianGap(everyOther.dayIdx)).toBe(2);

    // Daily: 2000 obs at r_eff ~ 0.5 -> ~n/3. Every-other-day: 1000 obs at
    // r_eff ~ 0.25 -> ~0.6n. Half the observations, but each worth more.
    expect(aEff).toBeGreaterThan(bEff);
    expect(aEff / daily.values.length).toBeLessThan(bEff / everyOther.values.length);
    expect(bEff / everyOther.values.length).toBeGreaterThan(0.5);
  });
});

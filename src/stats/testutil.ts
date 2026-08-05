/** Deterministic PRNG (mulberry32) + Box-Muller normals, for known-answer tests only. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gaussian(rand: () => number): () => number {
  return () => {
    let u = 0;
    while (u === 0) u = rand();
    const v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
}

/** AR(1): x_t = r * x_(t-1) + e_t, innovations N(0, sigma^2). Burns in 100 steps. */
export function ar1(n: number, r: number, sigma: number, seed: number): number[] {
  const g = gaussian(mulberry32(seed));
  let x = 0;
  for (let i = 0; i < 100; i++) x = r * x + sigma * g();
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    x = r * x + sigma * g();
    out[i] = x;
  }
  return out;
}

/** Consecutive ISO dates starting at `start`, one per day. */
export function isoDates(start: string, n: number): string[] {
  const t0 = Date.parse(start + "T00:00:00Z");
  return Array.from({ length: n }, (_, i) =>
    new Date(t0 + i * 86_400_000).toISOString().slice(0, 10),
  );
}

/** Celé číslo generátoru. Stejné semeno a stejné kroky dají stejnou hru. */
export function rngSeed(seed: number): number {
  const value = seed >>> 0;
  return value === 0 ? 1 : value;
}

/** Mulberry32. `value` je v intervalu [0, 1). */
export function rngNext(state: number): { state: number; value: number } {
  let next = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(next ^ (next >>> 15), 1 | next);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { state: next >>> 0, value };
}

export function rngRange(state: number, min: number, max: number): { state: number; value: number } {
  const next = rngNext(state);
  return { state: next.state, value: min + (max - min) * next.value };
}

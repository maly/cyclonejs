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

/** Celé číslo v rozsahu `min` až `max` včetně. */
export function rngInt(state: number, min: number, max: number): { state: number; value: number } {
  const next = rngNext(state);
  const span = max - min + 1;
  return { state: next.state, value: min + Math.floor(next.value * span) };
}

/** Bedny, lidé, cyklon a letadla. Každý proud má vlastní podřízený seed. */
export const STREAM_CRATES = 1;
export const STREAM_PEOPLE = 2;
export const STREAM_CYCLONE = 3;
export const STREAM_PLANES = 4;

/**
 * Podřízený seed. `attempt` je další pokus téhož proudu.
 * Změna jednoho proudu neposune ostatní.
 */
export function deriveSeed(seed: number, stream: number, attempt = 0): number {
  let mixed = Math.imul(seed >>> 0, 0x9e3779b1) ^ Math.imul(stream >>> 0, 0x85ebca6b) ^ Math.imul((attempt + 1) >>> 0, 0xc2b2ae35);
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x7feb352d);
  mixed = Math.imul(mixed ^ (mixed >>> 15), 0x846ca68b);
  const value = (mixed ^ (mixed >>> 16)) >>> 0;
  return value === 0 ? 1 : value;
}

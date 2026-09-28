/** Verze výstupu. Zvednout při každé změně, která pro stejné číslo dá jiný svět. */
export const GENERATOR_VERSION = 5;

export const MAX_ATTEMPTS = 20;

export interface RngState {
  s0: number;
  s1: number;
  s2: number;
  s3: number;
}

/**
 * Nezáporné číslo mapy na stav xoshiro128**.
 * Slova jdou od nejnižšího 32bitového a na konec se přidá jejich počet.
 * Nula je jedno slovo 0, takže se liší od jedničky.
 */
export function generatorState(seed: bigint): RngState {
  if (seed < 0n) throw new Error("The map number must not be negative.");
  const words: number[] = [];
  let rest = seed;
  do {
    words.push(Number(rest & 0xffffffffn) >>> 0);
    rest >>= 32n;
  } while (rest > 0n);
  words.push(words.length >>> 0);
  return mix128(words);
}

/** Podřízený generátor fáze. Stejný kořen a stejný název dají stejný stav. */
export function derivePhase(state: RngState, phase: string): RngState {
  const words = [state.s0, state.s1, state.s2, state.s3, phase.length >>> 0];
  for (let index = 0; index < phase.length; index++) words.push(phase.charCodeAt(index));
  return mix128(words);
}

/** Další pokus celé mapy. Nemění význam ostatních čísel. */
export function deriveAttempt(state: RngState, attempt: number): RngState {
  return mix128([state.s0, state.s1, state.s2, state.s3, attempt >>> 0, 0xa5a5a5a5]);
}

export function nextUint(state: RngState): { state: RngState; value: number } {
  const result = Math.imul(rotl(Math.imul(state.s1, 5) >>> 0, 7), 9) >>> 0;
  const mixed = (state.s1 << 9) >>> 0;
  const s2 = (state.s2 ^ state.s0 ^ mixed) >>> 0;
  const s3 = rotl((state.s3 ^ state.s1) >>> 0, 11);
  const s1 = (state.s1 ^ (state.s2 ^ state.s0)) >>> 0;
  const s0 = (state.s0 ^ (state.s3 ^ state.s1)) >>> 0;
  return { state: { s0, s1, s2, s3 }, value: result };
}

/** Celé číslo od `min` do `max` včetně. */
export function nextInt(state: RngState, min: number, max: number): { state: RngState; value: number } {
  const span = max - min + 1;
  const next = nextUint(state);
  return { state: next.state, value: min + (next.value % span) };
}

function mix128(words: readonly number[]): RngState {
  let a = 0x243f6a88;
  let b = 0x85a308d3;
  let c = 0x13198a2e;
  let d = 0x03707344;
  for (let index = 0; index < words.length; index++) {
    const word = words[index] ?? 0;
    a = fmix(a ^ word);
    b = fmix(b ^ rotl(word, 8) ^ Math.imul(index + 1, 0x9e3779b1));
    c = fmix(c ^ rotl(word, 16));
    d = fmix(d ^ rotl(word, 24));
    const carry = a;
    a = (b + rotl(c, 7)) >>> 0;
    b = (c + rotl(d, 11)) >>> 0;
    c = (d + rotl(carry, 13)) >>> 0;
    d = (carry + rotl(a, 17)) >>> 0;
  }
  a = fmix(a);
  b = fmix(b);
  c = fmix(c);
  d = fmix(d);
  if ((a | b | c | d) === 0) a = 1;
  return { s0: a, s1: b, s2: c, s3: d };
}

function fmix(value: number): number {
  let mixed = Math.imul(value ^ (value >>> 16), 0x85ebca6b);
  mixed = Math.imul(mixed ^ (mixed >>> 13), 0xc2b2ae35);
  return (mixed ^ (mixed >>> 16)) >>> 0;
}

function rotl(value: number, shift: number): number {
  return ((value << shift) | (value >>> (32 - shift))) >>> 0;
}

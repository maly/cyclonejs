export const PURE_SEA_KEY = "0".repeat(64);

export function tileKey(pixels: ArrayLike<number>): string {
  if (pixels.length !== 64) {
    throw new Error(`Dlaždice musí mít 64 pixelů, má ${pixels.length}`);
  }
  let out = "";
  for (let i = 0; i < 64; i++) {
    const value = pixels[i];
    if (!Number.isInteger(value) || value < 0 || value > 8) {
      throw new Error(`Index palety mimo rozsah: ${value}`);
    }
    out += value;
  }
  return out;
}

export function isSeaKey(key: string): boolean {
  for (let i = 0; i < key.length; i++) {
    const ch = key[i];
    if (ch !== "0" && ch !== "4") return false;
  }
  return key.length === 64;
}

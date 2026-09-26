import { PNG } from "pngjs";

export function countRgbDiff(width: number, height: number, actual: Uint8Array, expected: Uint8Array): number {
  const pixels = width * height;
  let diff = 0;
  for (let i = 0; i < pixels; i++) {
    const offset = i * 4;
    if (
      actual[offset] !== expected[offset] ||
      actual[offset + 1] !== expected[offset + 1] ||
      actual[offset + 2] !== expected[offset + 2]
    ) {
      diff++;
    }
  }
  return diff;
}

/** Vstup ve stupních šedi, rozdílné pixely červeně. */
export function diffImage(width: number, height: number, actual: Uint8Array, expected: Uint8Array): PNG {
  const png = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) {
    const offset = i * 4;
    const different =
      actual[offset] !== expected[offset] ||
      actual[offset + 1] !== expected[offset + 1] ||
      actual[offset + 2] !== expected[offset + 2];
    if (different) {
      png.data[offset] = 255;
      png.data[offset + 1] = 0;
      png.data[offset + 2] = 0;
    } else {
      const gray = Math.round(expected[offset] * 0.299 + expected[offset + 1] * 0.587 + expected[offset + 2] * 0.114);
      png.data[offset] = gray;
      png.data[offset + 1] = gray;
      png.data[offset + 2] = gray;
    }
    png.data[offset + 3] = 255;
  }
  return png;
}

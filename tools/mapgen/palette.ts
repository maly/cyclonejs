import { SPECTRUM_PALETTE } from "../../src/world/mapFormat.ts";

export interface IndexedImage {
  width: number;
  height: number;
  indices: Uint8Array;
}

export const PALETTE_RGB: ReadonlyArray<readonly [number, number, number]> = SPECTRUM_PALETTE.map((hex) => {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255] as const;
});

const LOOKUP = new Int16Array(256 * 256 * 256);
LOOKUP.fill(-1);
for (let index = 0; index < PALETTE_RGB.length; index++) {
  const [red, green, blue] = PALETTE_RGB[index];
  LOOKUP[(red << 16) | (green << 8) | blue] = index;
}

export class PaletteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaletteError";
  }
}

function hexByte(value: number): string {
  return value.toString(16).padStart(2, "0").toUpperCase();
}

export function rgbaToIndexed(width: number, height: number, data: Uint8Array): IndexedImage {
  const expected = width * height * 4;
  if (data.length < expected) {
    throw new Error(`RGBA buffer má ${data.length} bajtů, obraz ${width}×${height} jich potřebuje ${expected}`);
  }

  const indices = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixel = (y * width + x) * 4;
      const red = data[pixel];
      const green = data[pixel + 1];
      const blue = data[pixel + 2];
      const index = LOOKUP[(red << 16) | (green << 8) | blue];
      if (index < 0) {
        throw new PaletteError(
          `Pixel [${x}, ${y}] má barvu #${hexByte(red)}${hexByte(green)}${hexByte(blue)} mimo paletu Spectra`,
        );
      }
      indices[y * width + x] = index;
    }
  }
  return { width, height, indices };
}

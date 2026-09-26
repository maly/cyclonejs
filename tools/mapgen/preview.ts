import { PNG } from "pngjs";
import type { AtlasFile, IslandRecord } from "../../src/world/mapFormat.ts";
import { PALETTE_RGB, type IndexedImage } from "./palette.ts";
import { writePng } from "./pngio.ts";

const FONT: Record<string, string[]> = {
  "0": ["111", "101", "101", "101", "111"],
  "1": ["010", "110", "010", "010", "111"],
  "2": ["111", "001", "111", "100", "111"],
  "3": ["111", "001", "111", "001", "111"],
  "4": ["101", "101", "111", "001", "001"],
  "5": ["111", "100", "111", "001", "111"],
  "6": ["111", "100", "111", "101", "111"],
  "7": ["111", "001", "001", "001", "001"],
  "8": ["111", "101", "111", "101", "111"],
  "9": ["111", "101", "111", "001", "111"],
};

function setPixel(png: PNG, x: number, y: number, color: readonly [number, number, number]): void {
  if (x < 0 || y < 0 || x >= png.width || y >= png.height) return;
  const offset = (y * png.width + x) * 4;
  png.data[offset] = color[0];
  png.data[offset + 1] = color[1];
  png.data[offset + 2] = color[2];
  png.data[offset + 3] = 255;
}

function drawText(
  png: PNG,
  text: string,
  x: number,
  y: number,
  scale: number,
  color: readonly [number, number, number],
): void {
  let cursor = x;
  for (const char of text) {
    const glyph = FONT[char];
    if (!glyph) {
      cursor += 4 * scale;
      continue;
    }
    for (let gy = 0; gy < glyph.length; gy++) {
      for (let gx = 0; gx < 3; gx++) {
        if (glyph[gy][gx] !== "1") continue;
        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) {
            setPixel(png, cursor + gx * scale + sx, y + gy * scale + sy, color);
          }
        }
      }
    }
    cursor += 4 * scale;
  }
}

function strokeRect(
  png: PNG,
  x: number,
  y: number,
  w: number,
  h: number,
  color: readonly [number, number, number],
  thickness: number,
): void {
  for (let t = 0; t < thickness; t++) {
    for (let px = x; px < x + w; px++) {
      setPixel(png, px, y + t, color);
      setPixel(png, px, y + h - 1 - t, color);
    }
    for (let py = y; py < y + h; py++) {
      setPixel(png, x + t, py, color);
      setPixel(png, x + w - 1 - t, py, color);
    }
  }
}

export function writeAtlasPreview(atlas: AtlasFile, file: string): void {
  const scale = 6;
  const columns = 10;
  const tileSize = 8 * scale;
  const gap = 8;
  const labelScale = 2;
  const lineHeight = 5 * labelScale + 2;
  const labelHeight = lineHeight * 2;
  const rows = Math.max(1, Math.ceil(atlas.tiles.length / columns));
  const width = columns * tileSize + (columns + 1) * gap;
  const height = rows * (labelHeight + tileSize) + (rows + 1) * gap;
  const png = new PNG({ width, height });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = 18;
    png.data[i + 1] = 18;
    png.data[i + 2] = 32;
    png.data[i + 3] = 255;
  }

  const label: readonly [number, number, number] = [255, 255, 255];
  for (const tile of atlas.tiles) {
    const column = tile.index % columns;
    const row = Math.floor(tile.index / columns);
    const originX = gap + column * (tileSize + gap);
    const originY = gap + row * (labelHeight + tileSize + gap);
    drawText(png, String(tile.index), originX, originY, labelScale, label);
    drawText(png, String(tile.count), originX, originY + lineHeight, labelScale, label);
    const pixelY = originY + labelHeight;
    for (let ly = 0; ly < 8; ly++) {
      for (let lx = 0; lx < 8; lx++) {
        const value = tile.pixels.charCodeAt(ly * 8 + lx) - 48;
        const color = PALETTE_RGB[value] ?? [255, 0, 255];
        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) {
            setPixel(png, originX + lx * scale + sx, pixelY + ly * scale + sy, color);
          }
        }
      }
    }
  }

  writePng(file, png);
}

export function writeIslandsPreview(image: IndexedImage, islands: IslandRecord[], file: string): void {
  const width = Math.floor(image.width / 2);
  const height = Math.floor(image.height / 2);
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    const sourceY = y * 2;
    for (let x = 0; x < width; x++) {
      const value = image.indices[sourceY * image.width + x * 2];
      const color = PALETTE_RGB[value];
      const offset = (y * width + x) * 4;
      png.data[offset] = color[0];
      png.data[offset + 1] = color[1];
      png.data[offset + 2] = color[2];
      png.data[offset + 3] = 255;
    }
  }

  const stroke: readonly [number, number, number] = [255, 0, 255];
  const ink: readonly [number, number, number] = [255, 255, 255];
  const shadow: readonly [number, number, number] = [0, 0, 0];
  for (const island of islands) {
    strokeRect(png, island.x * 4, island.y * 4, island.w * 4, island.h * 4, stroke, 2);
    const text = String(island.id);
    const x = island.x * 4 + 3;
    const y = island.y * 4 + 3;
    drawText(png, text, x + 1, y, 2, shadow);
    drawText(png, text, x, y + 1, 2, shadow);
    drawText(png, text, x, y, 2, ink);
  }

  writePng(file, png);
}

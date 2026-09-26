import {
  SPECTRUM_PALETTE,
  type AtlasFile,
  type SeaFile,
  type WorldFile,
} from "../../src/world/mapFormat.ts";
import { PALETTE_RGB, type IndexedImage } from "./palette.ts";
import { decodeRleInto } from "./rle.ts";
import { PURE_SEA_KEY } from "./tiles.ts";

function parseTile(pixels: string, index: number): Uint8Array {
  if (pixels.length !== 64) {
    throw new Error(`Dlaždice ${index} má ${pixels.length} znaků místo 64`);
  }
  const out = new Uint8Array(64);
  for (let i = 0; i < 64; i++) {
    const value = pixels.charCodeAt(i) - 48;
    if (value < 0 || value > 8) {
      throw new Error(`Dlaždice ${index} obsahuje znak mimo paletu na pozici ${i}`);
    }
    out[i] = value;
  }
  return out;
}

export function validateMap(atlas: AtlasFile, world: WorldFile, sea: SeaFile): void {
  if (atlas.version !== 1 || world.version !== 1 || sea.version !== 1) {
    throw new Error("Nepodporovaná verze mapových dat");
  }
  if (atlas.palette.length !== SPECTRUM_PALETTE.length || atlas.palette.some((hex, i) => hex !== SPECTRUM_PALETTE[i])) {
    throw new Error("Paleta v atlasu neodpovídá paletě Spectra");
  }
  if (atlas.tiles.length === 0 || atlas.tiles[0].pixels !== PURE_SEA_KEY) {
    throw new Error("Index 0 atlasu musí být čistě mořská dlaždice");
  }
  for (let i = 0; i < atlas.tiles.length; i++) {
    if (atlas.tiles[i].index !== i) {
      throw new Error(`Dlaždice na pozici ${i} má index ${atlas.tiles[i].index}`);
    }
    parseTile(atlas.tiles[i].pixels, i);
  }
  if (world.cellsWide !== Math.ceil(world.pixelWidth / 8) || world.cellsHigh !== Math.ceil(world.pixelHeight / 8)) {
    throw new Error("Rozměr mřížky neodpovídá rozměru v pixelech");
  }
  const cellCount = world.cellsWide * world.cellsHigh;
  for (const island of world.islands) {
    if (island.tiles.length !== island.w * island.h) {
      throw new Error(`Ostrov ${island.id} má ${island.tiles.length} dlaždic místo ${island.w * island.h}`);
    }
    if (island.x < 0 || island.y < 0 || island.x + island.w > world.cellsWide || island.y + island.h > world.cellsHigh) {
      throw new Error(`Ostrov ${island.id} leží mimo mřížku`);
    }
    for (const tile of island.tiles) {
      if (!Number.isInteger(tile) || tile < 0 || tile >= atlas.tiles.length) {
        throw new Error(`Ostrov ${island.id} odkazuje na dlaždici ${tile} mimo atlas`);
      }
    }
  }
  const decoded = new Uint16Array(cellCount);
  decodeRleInto(sea.rle, decoded);
  for (let i = 0; i < decoded.length; i++) {
    if (decoded[i] >= atlas.tiles.length) {
      throw new Error(`Vrstva moře odkazuje na dlaždici ${decoded[i]} mimo atlas`);
    }
  }
}

export function renderIndexed(atlas: AtlasFile, world: WorldFile, sea: SeaFile): IndexedImage {
  validateMap(atlas, world, sea);
  const tilePixels = atlas.tiles.map((tile) => parseTile(tile.pixels, tile.index));
  const indices = new Uint8Array(world.pixelWidth * world.pixelHeight);
  const seaCells = new Uint16Array(world.cellsWide * world.cellsHigh);
  decodeRleInto(sea.rle, seaCells);

  const paint = (cx: number, cy: number, tileIndex: number) => {
    const pixels = tilePixels[tileIndex];
    const originX = cx * 8;
    const originY = cy * 8;
    for (let ly = 0; ly < 8; ly++) {
      const py = originY + ly;
      if (py >= world.pixelHeight) continue;
      for (let lx = 0; lx < 8; lx++) {
        const px = originX + lx;
        if (px >= world.pixelWidth) continue;
        indices[py * world.pixelWidth + px] = pixels[ly * 8 + lx];
      }
    }
  };

  for (let cell = 0; cell < seaCells.length; cell++) {
    paint(cell % world.cellsWide, Math.floor(cell / world.cellsWide), seaCells[cell]);
  }
  for (const island of world.islands) {
    let cursor = 0;
    for (let ly = 0; ly < island.h; ly++) {
      for (let lx = 0; lx < island.w; lx++) {
        paint(island.x + lx, island.y + ly, island.tiles[cursor++]);
      }
    }
  }

  return { width: world.pixelWidth, height: world.pixelHeight, indices };
}

export function renderRgba(atlas: AtlasFile, world: WorldFile, sea: SeaFile): {
  width: number;
  height: number;
  data: Buffer;
} {
  const indexed = renderIndexed(atlas, world, sea);
  const data = Buffer.alloc(indexed.width * indexed.height * 4);
  for (let i = 0; i < indexed.indices.length; i++) {
    const [red, green, blue] = PALETTE_RGB[indexed.indices[i]];
    const offset = i * 4;
    data[offset] = red;
    data[offset + 1] = green;
    data[offset + 2] = blue;
    data[offset + 3] = 255;
  }
  return { width: indexed.width, height: indexed.height, data };
}

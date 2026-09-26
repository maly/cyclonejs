import {
  MAP_VERSION,
  SPECTRUM_PALETTE,
  type AtlasFile,
  type AtlasTile,
  type IslandRecord,
  type SeaFile,
  type WorldFile,
} from "../../src/world/mapFormat.ts";
import { expandRect, landComponentRects, mergeCloseRects, rectsOverlap, type CellRect } from "./islands.ts";
import type { IndexedImage } from "./palette.ts";
import { encodeRle } from "./rle.ts";
import { PURE_SEA_KEY, isSeaKey } from "./tiles.ts";

const WHITE = 4;

export interface MapSummary {
  pixelWidth: number;
  pixelHeight: number;
  cellsWide: number;
  cellsHigh: number;
  landCells: number;
  islands: Array<Pick<IslandRecord, "id" | "x" | "y" | "w" | "h">>;
  atlasTiles: number;
  islandTiles: number;
  seaTiles: number;
  singletonIslandTiles: number;
  topTiles: Array<Pick<AtlasTile, "index" | "count" | "first" | "inIslands">>;
}

export interface ConvertedMap {
  atlas: AtlasFile;
  world: WorldFile;
  sea: SeaFile;
  summary: MapSummary;
}

interface TileRecord {
  key: string;
  count: number;
  firstX: number;
  firstY: number;
  inIslands: boolean;
}

function buildCells(image: IndexedImage): {
  cellsWide: number;
  cellsHigh: number;
  cellPixels: Uint8Array;
  land: Uint8Array;
  landCells: number;
} {
  const cellsWide = Math.ceil(image.width / 8);
  const cellsHigh = Math.ceil(image.height / 8);
  const cellCount = cellsWide * cellsHigh;
  const cellPixels = new Uint8Array(cellCount * 64);
  const land = new Uint8Array(cellCount);
  let landCells = 0;

  for (let cy = 0; cy < cellsHigh; cy++) {
    for (let cx = 0; cx < cellsWide; cx++) {
      const cell = cy * cellsWide + cx;
      const base = cell * 64;
      let isLand = false;
      for (let ly = 0; ly < 8; ly++) {
        const py = cy * 8 + ly;
        const rowInImage = py < image.height;
        for (let lx = 0; lx < 8; lx++) {
          const px = cx * 8 + lx;
          let value = 0;
          if (rowInImage && px < image.width) {
            value = image.indices[py * image.width + px];
          }
          cellPixels[base + ly * 8 + lx] = value;
          if (value !== 0 && value !== WHITE) isLand = true;
        }
      }
      if (isLand) {
        land[cell] = 1;
        landCells++;
      }
    }
  }

  return { cellsWide, cellsHigh, cellPixels, land, landCells };
}

function cellKey(cellPixels: Uint8Array, cell: number): string {
  const base = cell * 64;
  for (let i = 0; i < 64; i++) {
    if (cellPixels[base + i] !== 0) {
      let key = "";
      for (let j = 0; j < 64; j++) key += cellPixels[base + j];
      return key;
    }
  }
  return PURE_SEA_KEY;
}

function assertSeparated(rects: CellRect[]): void {
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      if (rectsOverlap(rects[i], rects[j])) {
        throw new Error(
          `Obdélníky ostrovů se překrývají: [${rects[i].x}, ${rects[i].y}, ${rects[i].w}×${rects[i].h}] a [${rects[j].x}, ${rects[j].y}, ${rects[j].w}×${rects[j].h}]`,
        );
      }
      if (rectsOverlap(expandRect(rects[i]), expandRect(rects[j]))) {
        throw new Error(
          `Obdélníky ostrovů zůstaly ve vzdálenosti jedné buňky: [${rects[i].x}, ${rects[i].y}] a [${rects[j].x}, ${rects[j].y}]`,
        );
      }
    }
  }
}

export function convertIndexed(image: IndexedImage): ConvertedMap {
  const { cellsWide, cellsHigh, cellPixels, land, landCells } = buildCells(image);
  const cellCount = cellsWide * cellsHigh;
  const rects = mergeCloseRects(landComponentRects(land, cellsWide, cellsHigh));
  assertSeparated(rects);

  const inside = new Uint8Array(cellCount);
  for (const rect of rects) {
    for (let cy = rect.y; cy < rect.y + rect.h; cy++) {
      for (let cx = rect.x; cx < rect.x + rect.w; cx++) {
        inside[cy * cellsWide + cx] = 1;
      }
    }
  }

  const records: TileRecord[] = [
    { key: PURE_SEA_KEY, count: 0, firstX: 0, firstY: 0, inIslands: false },
  ];
  const keyToIndex = new Map<string, number>([[PURE_SEA_KEY, 0]]);
  const cellTile = new Uint16Array(cellCount);

  for (let cy = 0; cy < cellsHigh; cy++) {
    for (let cx = 0; cx < cellsWide; cx++) {
      const cell = cy * cellsWide + cx;
      const key = cellKey(cellPixels, cell);
      let index = keyToIndex.get(key);
      if (index === undefined) {
        index = records.length;
        keyToIndex.set(key, index);
        records.push({ key, count: 0, firstX: cx, firstY: cy, inIslands: false });
      }
      const record = records[index];
      if (record.count === 0) {
        record.firstX = cx;
        record.firstY = cy;
      }
      record.count++;
      if (inside[cell]) record.inIslands = true;
      cellTile[cell] = index;
    }
  }

  const tiles: AtlasTile[] = records.map((record, index) => ({
    index,
    pixels: record.key,
    count: record.count,
    first: [record.firstX, record.firstY],
    inIslands: record.inIslands,
  }));

  const islands: IslandRecord[] = rects.map((rect, id) => {
    const islandTiles: number[] = new Array(rect.w * rect.h);
    let cursor = 0;
    for (let cy = rect.y; cy < rect.y + rect.h; cy++) {
      for (let cx = rect.x; cx < rect.x + rect.w; cx++) {
        islandTiles[cursor++] = cellTile[cy * cellsWide + cx];
      }
    }
    return { id, x: rect.x, y: rect.y, w: rect.w, h: rect.h, tiles: islandTiles };
  });

  const seaCells = new Uint16Array(cellCount);
  for (let cell = 0; cell < cellCount; cell++) {
    seaCells[cell] = inside[cell] ? 0 : cellTile[cell];
  }

  const atlas: AtlasFile = {
    version: MAP_VERSION,
    palette: [...SPECTRUM_PALETTE],
    tiles,
  };
  const world: WorldFile = {
    version: MAP_VERSION,
    pixelWidth: image.width,
    pixelHeight: image.height,
    cellsWide,
    cellsHigh,
    islands,
  };
  const sea: SeaFile = {
    version: MAP_VERSION,
    rle: encodeRle(seaCells),
  };

  const ranked = [...tiles].sort((a, b) => b.count - a.count || a.index - b.index);
  const summary: MapSummary = {
    pixelWidth: image.width,
    pixelHeight: image.height,
    cellsWide,
    cellsHigh,
    landCells,
    islands: islands.map(({ id, x, y, w, h }) => ({ id, x, y, w, h })),
    atlasTiles: tiles.length,
    islandTiles: tiles.filter((tile) => tile.inIslands).length,
    seaTiles: tiles.filter((tile) => isSeaKey(tile.pixels)).length,
    singletonIslandTiles: tiles.filter((tile) => tile.inIslands && tile.count === 1).length,
    topTiles: ranked.slice(0, 10).map((tile) => ({
      index: tile.index,
      count: tile.count,
      first: tile.first,
      inIslands: tile.inIslands,
    })),
  };

  return { atlas, world, sea, summary };
}

export function formatSummary(summary: MapSummary): string {
  const lines = [
    `Mřížka: ${summary.cellsWide} × ${summary.cellsHigh} buněk (${summary.pixelWidth} × ${summary.pixelHeight} px)`,
    `Pevninské buňky: ${summary.landCells}`,
    `Ostrovy: ${summary.islands.length}`,
  ];
  for (const island of summary.islands) {
    lines.push(`  #${island.id}  x=${island.x} y=${island.y} w=${island.w} h=${island.h}`);
  }
  lines.push(
    `Atlas: ${summary.atlasTiles} dlaždic, z toho ${summary.islandTiles} v ostrovech`,
    `Mořské dlaždice: ${summary.seaTiles}, dlaždice ostrovů s jedním výskytem: ${summary.singletonIslandTiles}`,
    "Nejčastější dlaždice:",
  );
  for (const tile of summary.topTiles) {
    const place = tile.inIslands ? "v ostrovech" : "jen moře";
    lines.push(`  #${tile.index}  ${tile.count}×  první=[${tile.first[0]}, ${tile.first[1]}]  ${place}`);
  }
  return lines.join("\n");
}

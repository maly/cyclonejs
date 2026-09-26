import { existsSync } from "node:fs";
import { PNG } from "pngjs";
import type { AtlasFile, SeaFile, WorldFile } from "../../src/world/mapFormat.ts";
import { countRgbDiff, diffImage } from "./compare.ts";
import { PALETTE_RGB } from "./palette.ts";
import {
  ATLAS_JSON,
  HEIGHTS_PNG,
  INPUT_PNG,
  REGIONS_PNG,
  SEA_JSON,
  SEMANTICS_JSON,
  TERRAIN_DIFF_PNG,
  TERRAIN_ISSUES_JSON,
  TERRAIN_JSON,
  TERRAIN_PATCHES_JSON,
  WORLD_JSON,
} from "./paths.ts";
import { readJson, readPng, writeJson, writePng } from "./pngio.ts";
import { loadSemantics, type SemanticsFile } from "./semantics.ts";
import {
  applyTerrainPatches,
  buildTerrain,
  formatTerrainReport,
  patchedViewCells,
  planIssues,
  projectTerrain,
  sourceView,
  type TerrainPatch,
} from "./terrain.ts";
import { writeHeightsPreview, writeRegionsPreview } from "./terrainPreview.ts";

const atlas = readJson<AtlasFile>(ATLAS_JSON);
const world = readJson<WorldFile>(WORLD_JSON);
const sea = readJson<SeaFile>(SEA_JSON);
const semantics = loadSemantics(readJson<SemanticsFile>(SEMANTICS_JSON));
const built = buildTerrain(world, semantics);
const patches = existsSync(TERRAIN_PATCHES_JSON) ? readJson<TerrainPatch[]>(TERRAIN_PATCHES_JSON) : [];
const applied = applyTerrainPatches(built.terrain, patches);
console.log(`Opravy: ${applied}`);
writeJson(TERRAIN_JSON, built.terrain);
writeJson(TERRAIN_ISSUES_JSON, { version: 1, issues: planIssues(built.report.issues) });
writeHeightsPreview(built.terrain, HEIGHTS_PNG);
writeRegionsPreview(world, built.regions, built.report.issues, REGIONS_PNG);
console.log(formatTerrainReport(built.report));

const projected = projectTerrain(built.terrain, world, sea.rle, semantics);
const original = sourceView(world, sea.rle);
const skip = patchedViewCells(patches);
let tileDiff = 0;
for (let i = 0; i < original.length; i++) {
  if (original[i] === projected[i]) continue;
  const x = i % world.cellsWide;
  const row = (i - x) / world.cellsWide;
  if (skip.has(`${x},${row}`)) continue;
  tileDiff++;
}

const input = readPng(INPUT_PNG);
const rendered = tilesToRgba(projected, world, atlas);
const pixelDiff = countRgbDiffSkipping(input.width, input.height, rendered.data, input.data, skip);
console.log(`Rozdílné pixely: ${pixelDiff}`);
if (pixelDiff > 0 || tileDiff > 0) {
  writePng(TERRAIN_DIFF_PNG, diffImage(input.width, input.height, rendered.data, input.data));
  console.error(`Rozdíly dlaždic: ${tileDiff}. Obrázek: ${TERRAIN_DIFF_PNG}`);
  const shown = firstMismatches(original, projected, world.cellsWide, 12);
  for (const line of shown) console.error(line);
  process.exit(1);
}

function tilesToRgba(
  tiles: Uint16Array,
  map: WorldFile,
  atlasFile: AtlasFile,
): { width: number; height: number; data: Buffer } {
  const png = new PNG({ width: map.pixelWidth, height: map.pixelHeight });
  const pixels = atlasFile.tiles.map((tile) => tile.pixels);
  for (let row = 0; row < map.cellsHigh; row++) {
    for (let col = 0; col < map.cellsWide; col++) {
      const key = pixels[tiles[row * map.cellsWide + col]] ?? "0".repeat(64);
      for (let ly = 0; ly < 8; ly++) {
        const py = row * 8 + ly;
        if (py >= map.pixelHeight) continue;
        for (let lx = 0; lx < 8; lx++) {
          const px = col * 8 + lx;
          if (px >= map.pixelWidth) continue;
          const value = key.charCodeAt(ly * 8 + lx) - 48;
          const [red, green, blue] = PALETTE_RGB[value] ?? [255, 0, 255];
          const offset = (py * map.pixelWidth + px) * 4;
          png.data[offset] = red;
          png.data[offset + 1] = green;
          png.data[offset + 2] = blue;
          png.data[offset + 3] = 255;
        }
      }
    }
  }
  return { width: png.width, height: png.height, data: png.data };
}

function countRgbDiffSkipping(
  width: number,
  height: number,
  actual: Uint8Array,
  expected: Uint8Array,
  skip: Set<string>,
): number {
  if (skip.size === 0) return countRgbDiff(width, height, actual, expected);
  let diff = 0;
  for (let py = 0; py < height; py++) {
    const cellRow = Math.floor(py / 8);
    for (let px = 0; px < width; px++) {
      if (skip.has(`${Math.floor(px / 8)},${cellRow}`)) continue;
      const offset = (py * width + px) * 4;
      if (
        actual[offset] !== expected[offset] ||
        actual[offset + 1] !== expected[offset + 1] ||
        actual[offset + 2] !== expected[offset + 2]
      ) {
        diff++;
      }
    }
  }
  return diff;
}

function firstMismatches(original: Uint16Array, projected: Uint16Array, width: number, limit: number): string[] {
  const lines: string[] = [];
  for (let i = 0; i < original.length && lines.length < limit; i++) {
    if (original[i] === projected[i]) continue;
    const x = i % width;
    const r = (i - x) / width;
    lines.push(`  [${x}, ${r}] zdroj #${original[i]} model #${projected[i]}`);
  }
  return lines;
}

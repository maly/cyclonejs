import type { AtlasFile, SeaFile, WorldFile } from "../../src/world/mapFormat.ts";
import { countRgbDiff, diffImage } from "./compare.ts";
import { ATLAS_JSON, DIFF_PNG, INPUT_PNG, SEA_JSON, WORLD_JSON } from "./paths.ts";
import { readJson, readPng, writePng } from "./pngio.ts";
import { renderRgba } from "./renderImage.ts";

const input = readPng(INPUT_PNG);
const atlas = readJson<AtlasFile>(ATLAS_JSON);
const world = readJson<WorldFile>(WORLD_JSON);
const sea = readJson<SeaFile>(SEA_JSON);
const rendered = renderRgba(atlas, world, sea);

if (input.width !== rendered.width || input.height !== rendered.height) {
  console.error(
    `Rozměr se liší: vstup ${input.width}×${input.height}, render ${rendered.width}×${rendered.height}`,
  );
  process.exit(1);
}

const diff = countRgbDiff(input.width, input.height, rendered.data, input.data);
console.log(`Rozdílné pixely: ${diff}`);
if (diff > 0) {
  writePng(DIFF_PNG, diffImage(input.width, input.height, rendered.data, input.data));
  console.error(`Rozdíly zapsány do ${DIFF_PNG}`);
  process.exit(1);
}

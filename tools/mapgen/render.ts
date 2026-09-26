import type { AtlasFile, SeaFile, WorldFile } from "../../src/world/mapFormat.ts";
import { ATLAS_JSON, RENDER_PNG, SEA_JSON, WORLD_JSON } from "./paths.ts";
import { readJson, writeRgbaPng } from "./pngio.ts";
import { renderRgba } from "./renderImage.ts";

const atlas = readJson<AtlasFile>(ATLAS_JSON);
const world = readJson<WorldFile>(WORLD_JSON);
const sea = readJson<SeaFile>(SEA_JSON);
const rendered = renderRgba(atlas, world, sea);
writeRgbaPng(RENDER_PNG, rendered.width, rendered.height, rendered.data);
console.log(`Vykresleno ${rendered.width} × ${rendered.height} px do ${RENDER_PNG}`);

import { convertIndexed, formatSummary } from "./convert.ts";
import { ATLAS_JSON, ATLAS_PREVIEW_PNG, INPUT_PNG, ISLANDS_PNG, SEA_JSON, WORLD_JSON } from "./paths.ts";
import { writeAtlasPreview, writeIslandsPreview } from "./preview.ts";
import { readIndexedPng, writeJson } from "./pngio.ts";

const image = readIndexedPng(INPUT_PNG);
const converted = convertIndexed(image);
writeJson(ATLAS_JSON, converted.atlas);
writeJson(WORLD_JSON, converted.world);
writeJson(SEA_JSON, converted.sea);
writeAtlasPreview(converted.atlas, ATLAS_PREVIEW_PNG);
writeIslandsPreview(image, converted.world.islands, ISLANDS_PNG);
console.log(formatSummary(converted.summary));

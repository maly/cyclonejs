import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { PNG } from "pngjs";
import { rgbaToIndexed, type IndexedImage } from "./palette.ts";

export function readIndexedPng(file: string): IndexedImage {
  const png = PNG.sync.read(readFileSync(file));
  return rgbaToIndexed(png.width, png.height, png.data);
}

export function readPng(file: string): PNG {
  return PNG.sync.read(readFileSync(file));
}

export function writePng(file: string, png: PNG): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, PNG.sync.write(png));
}

export function writeRgbaPng(file: string, width: number, height: number, data: Buffer): void {
  const png = new PNG({ width, height });
  if (data.length !== png.data.length) {
    throw new Error(`RGBA buffer má ${data.length} bajtů, PNG ${width}×${height} jich čeká ${png.data.length}`);
  }
  data.copy(png.data);
  writePng(file, png);
}

export function writeJson(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

export function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

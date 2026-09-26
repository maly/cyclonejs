import { PNG } from "pngjs";
import type { TerrainFile, WorldFile } from "../../src/world/mapFormat.ts";
import type { TerrainIssue } from "./terrain.ts";
import { writePng } from "./pngio.ts";

const HEIGHT_COLOR: Array<[number, number, number]> = [
  [24, 90, 70],
  [60, 180, 75],
  [160, 224, 96],
  [255, 225, 25],
  [245, 130, 49],
  [230, 25, 75],
  [67, 99, 216],
  [145, 30, 180],
  [240, 240, 240],
];

export function writeHeightsPreview(terrain: TerrainFile, file: string): void {
  let maxX = 1;
  let maxY = 1;
  for (const island of terrain.islands) {
    maxX = Math.max(maxX, island.x + island.w);
    maxY = Math.max(maxY, island.y + island.h);
  }
  const scale = 4;
  const png = new PNG({ width: maxX * scale, height: maxY * scale });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = 0;
    png.data[i + 1] = 180;
    png.data[i + 2] = 190;
    png.data[i + 3] = 255;
  }
  const fill = (x: number, y: number, color: [number, number, number]) => {
    for (let py = 0; py < scale; py++) {
      for (let px = 0; px < scale; px++) {
        const offset = ((y * scale + py) * png.width + (x * scale + px)) * 4;
        png.data[offset] = color[0];
        png.data[offset + 1] = color[1];
        png.data[offset + 2] = color[2];
      }
    }
  };
  for (const island of terrain.islands) {
    for (let row = 0; row < island.h; row++) {
      for (let col = 0; col < island.w; col++) {
        const offset = row * island.w + col;
        if (island.surface[offset] === 0) continue;
        const color = HEIGHT_COLOR[Math.min(island.height[offset], HEIGHT_COLOR.length - 1)];
        fill(island.x + col, island.y + row, color);
        if (island.estimated[offset]) {
          for (let step = 0; step < scale; step++) {
            const px = (island.x + col) * scale + step;
            const py = (island.y + row) * scale + (scale - 1 - step);
            const pixel = (py * png.width + px) * 4;
            png.data[pixel] = 0;
            png.data[pixel + 1] = 0;
            png.data[pixel + 2] = 0;
          }
        }
      }
    }
  }
  const mark = (x: number, y: number, color: [number, number, number]) => {
    if (x < 0 || y < 0 || x >= maxX || y >= maxY) return;
    const px = x * scale + 1;
    const py = y * scale + 1;
    const pixel = (py * png.width + px) * 4;
    png.data[pixel] = color[0];
    png.data[pixel + 1] = color[1];
    png.data[pixel + 2] = color[2];
    png.data[pixel + 4] = color[0];
    png.data[pixel + 5] = color[1];
    png.data[pixel + 6] = color[2];
  };
  for (const object of terrain.objects) mark(object.x, object.y, [0, 40, 0]);
  for (const person of terrain.people) mark(person.x, person.y, [255, 255, 255]);
  for (const crate of terrain.crates) mark(crate.x, crate.y, [80, 40, 0]);
  writePng(file, png);
}

export function writeRegionsPreview(
  world: WorldFile,
  regionPaint: Uint16Array,
  issues: TerrainIssue[],
  file: string,
): void {
  const scale = 4;
  const png = new PNG({ width: world.cellsWide * scale, height: world.cellsHigh * scale });
  for (let row = 0; row < world.cellsHigh; row++) {
    for (let col = 0; col < world.cellsWide; col++) {
      const region = regionPaint[row * world.cellsWide + col];
      const color = regionColor(region);
      for (let py = 0; py < scale; py++) {
        for (let px = 0; px < scale; px++) {
          const offset = ((row * scale + py) * png.width + (col * scale + px)) * 4;
          png.data[offset] = color[0];
          png.data[offset + 1] = color[1];
          png.data[offset + 2] = color[2];
          png.data[offset + 3] = 255;
        }
      }
    }
  }
  for (const issue of issues) {
    const color: [number, number, number] = issue.message.startsWith("konflikt") ? [255, 0, 0] : [255, 220, 0];
    const x = issue.viewX * scale;
    const y = issue.viewR * scale;
    for (let edge = 0; edge < scale; edge++) {
      const top = (y * png.width + (x + edge)) * 4;
      const left = ((y + edge) * png.width + x) * 4;
      png.data[top] = color[0];
      png.data[top + 1] = color[1];
      png.data[top + 2] = color[2];
      png.data[left] = color[0];
      png.data[left + 1] = color[1];
      png.data[left + 2] = color[2];
    }
  }
  writePng(file, png);
}

function regionColor(region: number): [number, number, number] {
  if (region === 0) return [0, 200, 210];
  if (region === 1) return [70, 70, 70];
  const hue = (region * 47) % 360;
  return hsl(hue, 65, 48);
}

function hsl(h: number, s: number, l: number): [number, number, number] {
  const sat = s / 100;
  const light = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sat * Math.min(light, 1 - light);
  const f = (n: number) => light - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(255 * f(0)), Math.round(255 * f(8)), Math.round(255 * f(4))];
}


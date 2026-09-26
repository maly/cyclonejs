import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { SeaFile, WorldFile } from "../../src/world/mapFormat.ts";
import { loadSemantics, type SemanticsFile } from "./semantics.ts";
import { buildTerrain, projectTerrain, sourceView } from "./terrain.ts";

const semantics = loadSemantics(JSON.parse(readFileSync("data/map/semantics.json", "utf8")) as SemanticsFile);

function worldFrom(rows: number[][]): WorldFile {
  const height = rows.length;
  const width = rows[0].length;
  return {
    version: 1,
    pixelWidth: width * 8,
    pixelHeight: height * 8,
    cellsWide: width,
    cellsHigh: height,
    islands: [{ id: 0, x: 0, y: 0, w: width, h: height, tiles: rows.flat() }],
  };
}

function sea(world: WorldFile): SeaFile {
  return { version: 1, rle: [[0, world.cellsWide * world.cellsHigh]] };
}

function expectRoundtrip(rows: number[][]) {
  const map = worldFrom(rows);
  const built = buildTerrain(map, semantics);
  const projected = projectTerrain(built.terrain, map, sea(map).rle, semantics);
  const original = sourceView(map, sea(map).rle);
  expect(Array.from(projected)).toEqual(Array.from(original));
  return built;
}

const seaTile = 0;
const northWest = 9;
const north = 13;
const northEast = 14;
const west = 15;
const grass = 17;
const east = 20;
const wall = 23;
const roof = 34;
const houseWall = 39;
const houseWall2 = 42;

describe("terrain", () => {
  it("postaví terasu výšky 2 na moři a promítne ji zpět", () => {
    const built = expectRoundtrip([
      [seaTile, seaTile, seaTile, seaTile, seaTile],
      [seaTile, northWest, north, northEast, seaTile],
      [seaTile, west, grass, east, seaTile],
      [seaTile, wall, wall, wall, seaTile],
      [seaTile, wall, wall, wall, seaTile],
      [seaTile, seaTile, seaTile, seaTile, seaTile],
    ]);
    const island = built.terrain.islands[0];
    expect(island).toMatchObject({ x: 1, y: 3, w: 3, h: 2 });
    expect(island.height).toEqual([2, 2, 2, 2, 2, 2]);
    expect(island.surface.every((value) => value === 1)).toBe(true);
    expect(island.estimated.every((value) => value === 0)).toBe(true);
    expect(built.report.islands[0].conflicts).toBe(0);
    expect(built.report.islands[0].violations).toBe(0);
  });

  it("rozliší dvě terasy nad sebou", () => {
    const built = expectRoundtrip([
      [seaTile, northWest, northEast, seaTile],
      [seaTile, west, east, seaTile],
      [seaTile, wall, wall, seaTile],
      [seaTile, west, east, seaTile],
      [seaTile, wall, wall, seaTile],
      [seaTile, seaTile, seaTile, seaTile, seaTile].slice(0, 4),
    ]);
    const island = built.terrain.islands[0];
    expect(island.height).toEqual([2, 2, 2, 2, 1, 1]);
    expect(built.report.islands[0].conflicts).toBe(0);
    expect(built.report.islands[0].violations).toBe(0);
  });

  it("nechá za tečkovanou severní hranou odhadnutý zakrytý pás", () => {
    const built = expectRoundtrip([
      [seaTile, grass, grass, seaTile],
      [seaTile, north, north, seaTile],
      [seaTile, grass, grass, seaTile],
      [seaTile, wall, wall, seaTile],
      [seaTile, wall, wall, seaTile],
    ]);
    const island = built.terrain.islands[0];
    expect(island.height).toEqual([1, 1, 1, 1, 2, 2, 2, 2]);
    expect(island.estimated).toEqual([1, 1, 1, 1, 0, 0, 0, 0]);
    expect(built.report.islands[0].conflicts).toBe(0);
    expect(built.report.islands[0].violations).toBe(0);
  });

  it("nepočítá stěnu terasy nad střechou do výšky domu", () => {
    const built = expectRoundtrip([
      [seaTile, grass, grass, seaTile],
      [seaTile, wall, wall, seaTile],
      [seaTile, roof, roof, seaTile],
      [seaTile, houseWall, houseWall, seaTile],
      [seaTile, houseWall2, houseWall2, seaTile],
      [seaTile, grass, grass, seaTile],
      [seaTile, wall, wall, seaTile],
      [seaTile, seaTile, seaTile, seaTile],
    ]);
    const island = built.terrain.islands[0];
    const roofs = island.surface
      .map((surface, index) => (surface === 5 ? island.height[index] : null))
      .filter((height) => height !== null);
    expect(roofs.length).toBeGreaterThan(0);
    expect(roofs.every((height) => height === 3)).toBe(true);
    expect(built.report.islands[0].conflicts).toBe(0);
  });

  it("posadí dům na terasu", () => {
    const built = expectRoundtrip([
      [seaTile, roof, roof, seaTile],
      [seaTile, houseWall, houseWall, seaTile],
      [seaTile, houseWall2, houseWall2, seaTile],
      [seaTile, grass, grass, seaTile],
      [seaTile, wall, wall, seaTile],
    ]);
    const island = built.terrain.islands[0];
    expect(island.surface).toContain(5);
    expect(island.surface).toContain(1);
    expect(island.height[0]).toBeGreaterThan(island.height[island.surface.indexOf(1)]);
    const face = built.terrain.faces.find((item) => item.tiles.includes(houseWall));
    expect(face?.tiles).toEqual([houseWall, houseWall2]);
    expect(built.report.islands[0].conflicts).toBe(0);
  });

  it("severní pobřeží končí útesem do moře", () => {
    const built = expectRoundtrip([
      [seaTile, seaTile, seaTile, seaTile, seaTile],
      [seaTile, north, north, seaTile, seaTile],
      [seaTile, grass, grass, seaTile, seaTile],
      [seaTile, wall, wall, seaTile, seaTile],
      [seaTile, wall, wall, seaTile, seaTile],
    ]);
    const island = built.terrain.islands[0];
    expect(island.surface.every((value) => value === 1)).toBe(true);
    expect(island.estimated.every((value) => value === 0)).toBe(true);
    expect(island.y).toBe(3);
  });

  it("zátoka otevřená k severu zůstane mořem", () => {
    const built = expectRoundtrip([
      [seaTile, north, north, seaTile, seaTile, seaTile],
      [seaTile, grass, grass, seaTile, seaTile, seaTile],
      [seaTile, wall, wall, seaTile, seaTile, seaTile],
      [seaTile, seaTile, seaTile, seaTile, seaTile, seaTile],
      [seaTile, seaTile, seaTile, seaTile, seaTile, seaTile],
      [seaTile, north, north, north, north, seaTile],
      [seaTile, grass, grass, grass, grass, seaTile],
      [seaTile, wall, wall, wall, wall, seaTile],
    ]);
    const island = built.terrain.islands[0];
    const at = (x: number, y: number) => {
      const offset = (y - island.y) * island.w + (x - island.x);
      return island.surface[offset] ?? 0;
    };
    expect(at(1, 3)).toBe(0);
    expect(at(1, 4)).toBe(0);
    expect(at(1, 5)).toBe(0);
    expect(at(2, 4)).toBe(0);
    expect(island.estimated.filter((value) => value === 1)).toHaveLength(0);
    const land = island.surface.filter((value) => value !== 0).length;
    expect(land).toBe(12);
  });

  it("postaví strom pod stěnu vyšší terasy", () => {
    const built = expectRoundtrip([
      [seaTile, grass, grass, grass, seaTile],
      [seaTile, wall, 61, wall, seaTile],
      [seaTile, grass, 10, grass, seaTile],
      [seaTile, grass, 16, grass, seaTile],
      [seaTile, wall, wall, wall, seaTile],
      [seaTile, seaTile, seaTile, seaTile, seaTile],
    ]);
    expect(built.terrain.objects).toEqual([{ type: "smrk_c", x: 2, y: 4, levels: 3 }]);
    expect(built.report.islands[0].conflicts).toBe(0);
    expect(built.report.islands[0].violations).toBe(0);
  });
});

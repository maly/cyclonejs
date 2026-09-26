import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { FUEL_BURN, FUEL_MAX, FUEL_THRUST, MAX_SPEED } from "./config.ts";
import { createStorm } from "./cyclone.ts";
import { createGame } from "./game.ts";
import { findHeliports } from "./heliports.ts";
import {
  coveredFromNorth,
  coveredFromSouth,
  fullThrottleRange,
  indexPlacement,
  placeFromSeed,
  type PlacementIndex,
  type PlacementResult,
} from "./placement.ts";
import { deriveSeed, rngNext, rngSeed, STREAM_CYCLONE, STREAM_PLANES } from "./rng.ts";
import { randomPlaneGap } from "./planes.ts";
import type { TerrainFile } from "./terrainTypes.ts";
import { islandIdAt, worldFromTerrain, type World } from "./world.ts";

const terrain = JSON.parse(readFileSync("data/map/terrain.json", "utf8")) as TerrainFile;
const world = worldFromTerrain(terrain);
const index = indexPlacement(world);
const FUEL_LIMIT = (FUEL_MAX / (FUEL_BURN + FUEL_THRUST)) * MAX_SPEED * 0.4;

describe("zákryt", () => {
  it("bedna za zdí vysokou 3 je z jihu zakrytá do vzdálenosti 2 a ze severu viditelná", () => {
    const map = flat(5, 8, 1);
    map.height[5 * map.width + 2] = 3;
    expect(coveredFromSouth(map, 2, 4)).toBe(true);
    expect(coveredFromSouth(map, 2, 3)).toBe(true);
    expect(coveredFromSouth(map, 2, 2)).toBe(false);
    expect(coveredFromNorth(map, 2, 4)).toBe(false);
    expect(coveredFromNorth(map, 2, 3)).toBe(false);
  });
});

describe("rozmístění", () => {
  it("stejný seed dá stejné bedny, lidi i start cyklonu", () => {
    const once = placeFromSeed(world, index, 42, "random");
    expect(placeFromSeed(world, index, 42, "random")).toEqual(once);
    const storm = (seed: number) => createGame(world, { seed }).storm;
    expect(storm(42)).toEqual(storm(42));
    const home = createGame(world, { seed: 42 });
    const started = createStorm(world, home.homeX, home.homeZ, deriveSeed(42, STREAM_CYCLONE));
    expect(home.storm).toEqual(started.storm);
    expect(home.rng).toBe(started.rng);
    const gap = randomPlaneGap(deriveSeed(42, STREAM_PLANES));
    expect(home.planeCooldown).toBe(gap.seconds);
    expect(home.planeRng).toBe(gap.rng);
    expect(deriveSeed(42, STREAM_CYCLONE)).not.toBe(deriveSeed(42, STREAM_PLANES));
  });

  it("dva seedy nespustí cyklon ze stejného místa a oba jsou aspoň 150 buněk od základny", () => {
    const first = createGame(world, { seed: 1 });
    const second = createGame(world, { seed: 2 });
    expect(Math.hypot(first.storm.x - first.homeX, first.storm.z - first.homeZ)).toBeGreaterThanOrEqual(150);
    expect(Math.hypot(second.storm.x - second.homeX, second.storm.z - second.homeZ)).toBeGreaterThanOrEqual(150);
    expect(first.storm.x !== second.storm.x || first.storm.z !== second.storm.z).toBe(true);
  });

  it("originální režim vrátí dnešních 5 beden a 43 lidí", () => {
    const placed = placeFromSeed(world, index, 99, "original");
    expect(placed.fallback).toBe(false);
    expect(placed.crates).toEqual([
      { x: 124, z: 149 },
      { x: 380, z: 249 },
      { x: 607, z: 345 },
      { x: 617, z: 352 },
      { x: 90, z: 467 },
    ]);
    expect(placed.people).toHaveLength(43);
    expect(placed.people.filter((person) => person.type === "muz")).toHaveLength(22);
    expect(placed.people.filter((person) => person.type === "zena")).toHaveLength(21);
    expect(placed.people).toEqual(world.people);
  });

  it("palivo vyloučí buňku dál než 40 % doletu a u domu zvedne váhu", () => {
    const map = flat(900, 16, 0);
    paintIsland(map, 1, 0, 0, 30, 8);
    paintIsland(map, 2, 790, 0, 20, 8);
    for (let z = 2; z <= 3; z++) {
      for (let x = 2; x <= 3; x++) map.surface[z * map.width + x] = 4;
    }
    map.surface[6 * map.width + 8] = 5;
    map.height[6 * map.width + 8] = 2;
    const near = indexPlacement(map);
    expect(near.crateCells.some((cell) => cell.x === 10 && cell.z === 2)).toBe(true);
    expect(near.crateCells.some((cell) => cell.x === 800)).toBe(false);
    expect(near.peopleCells.find((cell) => cell.x === 10 && cell.z === 6)?.weight).toBe(3);
    expect(near.peopleCells.find((cell) => cell.x === 24 && cell.z === 2)?.weight).toBe(1);
    expect(fullThrottleRange() * 0.4).toBeCloseTo(FUEL_LIMIT);
  });

  it("když podmínky nevyjdou, použije originál a zapíše to do ladění", () => {
    const map = flat(8, 8, 1);
    paintIsland(map, 1, 0, 0, 8, 8);
    map.crates = [{ x: 1, z: 1 }];
    map.people = [{ type: "zena", x: 3, z: 3 }];
    const tiny = indexPlacement(map);
    const spy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const placed = placeFromSeed(map, tiny, 5, "random");
    expect(placed.fallback).toBe(true);
    expect(placed.crates).toEqual([{ x: 1, z: 1 }]);
    expect(placed.people).toEqual([{ type: "zena", x: 3, z: 3 }]);
    expect(spy.mock.calls.some((call) => String(call[0]).includes("originál"))).toBe(true);
    spy.mockRestore();
  });

  it("tisíc seedů splní podmínky, vejde se do 50 ms a záloha zůstane výjimkou", () => {
    const trees = new Set(world.trees.map((tree) => tree.z * world.width + tree.x));
    const pads = heliportCells(world);
    let extraCrates = 0;
    let extraPeople = 0;
    let repeated = 0;
    let fallbacks = 0;
    let slowest = 0;
    let state = rngSeed(0xc0ffee);
    for (let n = 0; n < 1000; n++) {
      const roll = rngNext(state);
      state = roll.state;
      const seed = Math.floor(roll.value * 0x100000000);
      const started = performance.now();
      const placed = placeFromSeed(world, index, seed, "random");
      slowest = Math.max(slowest, performance.now() - started);
      if (placed.fallback) fallbacks += 1;
      if (placed.crateAttempts > 1 || placed.peopleAttempts > 1) repeated += 1;
      extraCrates += Math.max(0, placed.crateAttempts - 1);
      extraPeople += Math.max(0, placed.peopleAttempts - 1);
      expect(holds(world, index, placed, trees, pads)).toBe(true);
    }
    console.info(
      `1000 seedů: opakování u ${repeated}, bedny navíc ${extraCrates}, lidé navíc ${extraPeople}, záloha ${fallbacks}, nejpomalejší ${slowest.toFixed(2)} ms`,
    );
    expect(fallbacks).toBe(0);
    expect(slowest).toBeLessThan(50);
  }, 30000);
});

describe("simulace bez cizí náhody", () => {
  it("ve src/sim nevolá Math.random, Date ani performance.now", () => {
    const banned = /\b(?:Math\.random|Date|performance\.now)\b/;
    const files = readdirSync("src/sim").filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"));
    expect(files.length).toBeGreaterThan(5);
    for (const name of files) {
      const source = readFileSync(join("src/sim", name), "utf8");
      expect(source, name).not.toMatch(banned);
    }
  });
});

function holds(
  map: World,
  prepared: PlacementIndex,
  placed: PlacementResult,
  trees: Set<number>,
  pads: { x: number; z: number }[],
): boolean {
  if (placed.fallback || placed.crates.length !== 5) return false;
  const islands = new Set<number>();
  let covered = 0;
  for (const crate of placed.crates) {
    if (!walkable(map, crate.x, crate.z, trees)) return false;
    const island = islandIdAt(map, crate.x, crate.z);
    if (island === null || islands.has(island)) return false;
    islands.add(island);
    if (!reachable(map, trees, crate.x, crate.z)) return false;
    if (nearest(crate.x, crate.z, pads) > FUEL_LIMIT) return false;
    const south = coveredFromSouth(map, crate.x, crate.z);
    const north = coveredFromNorth(map, crate.x, crate.z);
    if (south && north) return false;
    if (south || north) covered += 1;
    for (const other of placed.crates) {
      if (other === crate) continue;
      if (Math.hypot(crate.x - other.x, crate.z - other.z) < 60) return false;
    }
  }
  if (covered < 2) return false;
  if (placed.people.length < 30 || placed.people.length > 50) return false;
  const men = placed.people.filter((person) => person.type === "muz").length;
  const women = placed.people.length - men;
  if (Math.abs(men - women) > 1) return false;
  if (placed.people.some((person) => person.type !== "muz" && person.type !== "zena")) return false;
  const perIsland = new Map<number, number>();
  for (const person of placed.people) {
    if (!walkable(map, person.x, person.z, trees)) return false;
    if (!reachable(map, trees, person.x, person.z)) return false;
    const island = islandIdAt(map, person.x, person.z);
    if (island === null) return false;
    perIsland.set(island, (perIsland.get(island) ?? 0) + 1);
    if ((perIsland.get(island) ?? 0) > 8) return false;
    for (const crate of placed.crates) {
      if (Math.hypot(person.x - crate.x, person.z - crate.z) < 5) return false;
    }
    for (const other of placed.people) {
      if (other === person) continue;
      if (Math.hypot(person.x - other.x, person.z - other.z) < 3) return false;
    }
  }
  void prepared;
  return true;
}

function walkable(map: World, x: number, z: number, trees: Set<number>): boolean {
  const surface = map.surface[z * map.width + x] ?? 0;
  if (surface !== 1 && surface !== 2 && surface !== 3) return false;
  if (islandIdAt(map, x, z) === 7) return false;
  if (trees.has(z * map.width + x)) return false;
  return true;
}

function reachable(map: World, trees: Set<number>, x: number, z: number): boolean {
  const height = ground(map, x, z);
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx;
      const nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= map.width || nz >= map.depth) continue;
      if (ground(map, nx, nz) > height + 1) return false;
      if (trees.has(nz * map.width + nx)) return false;
    }
  }
  return true;
}

function ground(map: World, x: number, z: number): number {
  const index = z * map.width + x;
  return map.surface[index] === 0 ? 0 : (map.height[index] ?? 0);
}

function nearest(x: number, z: number, pads: readonly { x: number; z: number }[]): number {
  let best = Infinity;
  for (const pad of pads) {
    const distance = Math.hypot(x - pad.x, z - pad.z);
    if (distance < best) best = distance;
  }
  return best;
}

function heliportCells(map: World): { x: number; z: number }[] {
  const found = findHeliports(map);
  const cells: { x: number; z: number }[] = [];
  for (let index = 0; index < found.mask.length; index++) {
    if (!found.mask[index]) continue;
    cells.push({ x: index % map.width, z: Math.floor(index / map.width) });
  }
  return cells;
}

function flat(width: number, depth: number, height: number): World {
  const surface = new Uint8Array(width * depth);
  const heights = new Uint8Array(width * depth);
  surface.fill(1);
  heights.fill(height);
  return {
    width,
    depth,
    height: heights,
    surface,
    estimated: new Uint8Array(width * depth),
    island: new Uint8Array(width * depth),
    trees: [],
    people: [],
    crates: [],
  };
}

function paintIsland(map: World, id: number, x0: number, z0: number, w: number, h: number): void {
  const island = map.island;
  if (!island) return;
  for (let z = z0; z < z0 + h; z++) {
    for (let x = x0; x < x0 + w; x++) {
      map.surface[z * map.width + x] = 1;
      map.height[z * map.width + x] = 1;
      island[z * map.width + x] = id + 1;
    }
  }
}

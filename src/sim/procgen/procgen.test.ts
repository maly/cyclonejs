import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findHeliports } from "../heliports.ts";
import { GENERATOR_VERSION, generateWorld, serializeWorld } from "./generate.ts";
import type { World } from "../world.ts";

const FINGERPRINTS = {
  version: 5,
  hashes: {
    "0": "ca791df8245024934b52c57f75d8d234ad1bf7840c0930cb0696238eadf36ff2",
    "1": "63c3de3a77ea45da22b75b9dd729031977b14a7351df4f24eed38a491cfb4b55",
    "42": "836b4a9879f855a6bbc704b4d4196ead0a81db9a3776946ca422754733ae83f8",
    "18446744073709551623": "9ad92322cff0897b6dd91316ab49848a548f3cf9af5bdd6c0620b5d92954cd34",
    "10000000000000000000000000000000000000000": "599fd24e821d7168e1f3045253c41b916a3ea5c281911f504658c559637a4c9d",
  },
} as const;

describe("procedurální souostroví", () => {
  it("stejné číslo dá dvakrát stejný JSON a nula se liší od jedničky", () => {
    const first = serializeWorld(generateWorld(0n));
    const second = serializeWorld(generateWorld(0n));
    expect(second).toBe(first);
    expect(serializeWorld(generateWorld(1n))).not.toBe(first);
  });

  it("záporné číslo odmítne", () => {
    expect(() => generateWorld(-1n)).toThrow(/must not be negative/);
  });

  it("drží kontrolní otisky pěti čísel pro tuto verzi generátoru", () => {
    expect(GENERATOR_VERSION).toBe(FINGERPRINTS.version);
    const seeds = [0n, 1n, 42n, (1n << 64n) + 7n, 10n ** 40n];
    for (const seed of seeds) {
      const hash = createHash("sha256").update(serializeWorld(generateWorld(seed))).digest("hex");
      expect(hash, seed.toString()).toBe(FINGERPRINTS.hashes[seed.toString() as keyof typeof FINGERPRINTS.hashes]);
    }
  }, 20000);

  it("u tisíce čísel projde kontrola a vejde se do půl sekundy", () => {
    let slowest = 0;
    const suffixCount = new Map<string, number>();
    let nameTotal = 0;
    const sample: string[] = [];
    const islands = { min: Infinity, max: 0 };
    const heliports = { min: Infinity, max: 0 };
    const houses = { min: Infinity, max: 0 };
    const trees = { min: Infinity, max: 0 };
    for (let index = 0; index < 1000; index++) {
      const seed = BigInt(index);
      let started = performance.now();
      let world = generateWorld(seed);
      let elapsed = performance.now() - started;
      if (elapsed > 500) {
        started = performance.now();
        world = generateWorld(seed);
        elapsed = Math.min(elapsed, performance.now() - started);
      }
      if (elapsed > slowest) slowest = elapsed;
      const stats = measure(world);
      islands.min = Math.min(islands.min, stats.islands);
      islands.max = Math.max(islands.max, stats.islands);
      heliports.min = Math.min(heliports.min, stats.heliports);
      heliports.max = Math.max(heliports.max, stats.heliports);
      houses.min = Math.min(houses.min, stats.houses);
      houses.max = Math.max(houses.max, stats.houses);
      trees.min = Math.min(trees.min, stats.trees);
      trees.max = Math.max(trees.max, stats.trees);
      const labels = (world.islandNames ?? []).filter((name): name is string => Boolean(name));
      expect(labels, String(index)).toContain("Base Island");
      const words = new Map<string, string>();
      for (const name of labels) {
        nameTotal += 1;
        const suffix = name.split(" ").pop() ?? "";
        suffixCount.set(suffix, (suffixCount.get(suffix) ?? 0) + 1);
        const word = name.slice(0, name.length - suffix.length).trim().toLowerCase();
        const previous = words.get(word);
        expect(previous === undefined || previous === name, name).toBe(true);
        words.set(word, name);
        if (sample.length < 50 && index % 20 === 0) sample.push(name);
      }
    }
    console.info(
      `1000 čísel: ostrovy ${islands.min}–${islands.max}, heliporty ${heliports.min}–${heliports.max}, domy ${houses.min}–${houses.max}, stromy ${trees.min}–${trees.max}, nejpomalejší ${slowest.toFixed(1)} ms`,
    );
    console.info(sample.join(" | "));
    const shares = [...suffixCount.entries()].map(([suffix, count]) => `${suffix} ${count} (${((100 * count) / nameTotal).toFixed(1)} %)`);
    console.info(shares.join(", "));
    for (const [suffix, count] of suffixCount) {
      if (suffix === "Island") continue;
      expect(count / nameTotal, suffix).toBeLessThanOrEqual(0.25);
    }
    expect(slowest).toBeLessThan(500);
  }, 1200000);

  it("skupina má jedno jméno a na mapách jsou zálivy, háky i písek", () => {
    const seen = { open: 0, bay: 0, sandy: 0, shared: 0 };
    for (let index = 0; index < 12; index++) {
      const world = generateWorld(BigInt(index));
      const labels = world.islandNames ?? [];
      const tally = new Map<string, number>();
      for (const name of labels) {
        if (!name || (!name.endsWith(" Isles") && !name.endsWith(" Rocks"))) continue;
        tally.set(name, (tally.get(name) ?? 0) + 1);
      }
      for (const [name, count] of tally) {
        expect(count, `${index} ${name}`).toBeGreaterThanOrEqual(2);
        seen.shared += 1;
      }
      const forms = readForms(world);
      seen.open += forms.open;
      seen.bay += forms.bay;
      seen.sandy += forms.sandy;
    }
    expect(seen.shared).toBeGreaterThan(4);
    expect(seen.open).toBeGreaterThan(8);
    expect(seen.bay).toBeGreaterThan(4);
    expect(seen.sandy).toBeGreaterThan(4);
  }, 40000);

  it("ve zdrojích procgen nevolá zakázané funkce", () => {
    const banned = /\bMath\.(?:sin|cos|exp|pow|log|atan2|random)\b/;
    const files = sources("src/sim/procgen");
    expect(files.length).toBeGreaterThan(3);
    for (const file of files) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(banned);
    }
  });
});

function readForms(world: World): { open: number; bay: number; sandy: number } {
  const island = world.island ?? new Uint8Array();
  const area = new Map<number, number>();
  const sand = new Map<number, number>();
  const maxH = new Map<number, number>();
  const box = new Map<number, { minX: number; maxX: number; minZ: number; maxZ: number }>();
  const bays = new Map<number, number>();
  for (let z = 0; z < world.depth; z++) {
    for (let x = 0; x < world.width; x++) {
      const index = z * world.width + x;
      const code = island[index] ?? 0;
      if (code !== 0) {
        area.set(code, (area.get(code) ?? 0) + 1);
        if ((world.surface[index] ?? 0) === 2) sand.set(code, (sand.get(code) ?? 0) + 1);
        const height = world.height[index] ?? 0;
        if (height > (maxH.get(code) ?? 0)) maxH.set(code, height);
        const frame = box.get(code);
        if (!frame) box.set(code, { minX: x, maxX: x, minZ: z, maxZ: z });
        else {
          if (x < frame.minX) frame.minX = x;
          if (x > frame.maxX) frame.maxX = x;
          if (z < frame.minZ) frame.minZ = z;
          if (z > frame.maxZ) frame.maxZ = z;
        }
        continue;
      }
      const tally = new Map<number, number>();
      const neighbors = [
        [x, z - 1],
        [x, z + 1],
        [x - 1, z],
        [x + 1, z],
      ];
      for (const [nx, nz] of neighbors) {
        if (nx < 0 || nz < 0 || nx >= world.width || nz >= world.depth) continue;
        const next = island[nz * world.width + nx] ?? 0;
        if (!next) continue;
        tally.set(next, (tally.get(next) ?? 0) + 1);
      }
      for (const [next, count] of tally) {
        if (count >= 3) bays.set(next, (bays.get(next) ?? 0) + 1);
      }
    }
  }
  let open = 0;
  let sandy = 0;
  for (const [code, cells] of area) {
    const frame = box.get(code);
    if (!frame) continue;
    const fill = cells / ((frame.maxX - frame.minX + 1) * (frame.maxZ - frame.minZ + 1));
    if (fill < 0.55) open += 1;
    const ratio = (sand.get(code) ?? 0) / cells;
    if (ratio >= 0.4 && (maxH.get(code) ?? 0) <= 2) sandy += 1;
  }
  return { open, bay: bays.size, sandy };
}

function measure(world: World): { islands: number; heliports: number; houses: number; trees: number } {
  const islands = new Set<number>();
  world.island?.forEach((code) => {
    if (code !== 0) islands.add(code);
  });
  const seen = new Uint8Array(world.surface.length);
  let houses = 0;
  for (let index = 0; index < world.surface.length; index++) {
    if (world.surface[index] !== 5 || seen[index]) continue;
    houses += 1;
    const stack = [index];
    seen[index] = 1;
    while (stack.length > 0) {
      const current = stack.pop() ?? 0;
      const x = current % world.width;
      const z = (current - x) / world.width;
      if (x > 0) markRoof(world, seen, stack, current - 1);
      if (x + 1 < world.width) markRoof(world, seen, stack, current + 1);
      if (z > 0) markRoof(world, seen, stack, current - world.width);
      if (z + 1 < world.depth) markRoof(world, seen, stack, current + world.width);
    }
  }
  return {
    islands: islands.size,
    heliports: findHeliports(world, world.baseX, world.baseZ).list.length,
    houses,
    trees: world.trees.length,
  };
}

function markRoof(world: World, seen: Uint8Array, stack: number[], index: number): void {
  if (seen[index] || world.surface[index] !== 5) return;
  seen[index] = 1;
  stack.push(index);
}

function sources(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...sources(path));
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) found.push(path);
  }
  return found;
}

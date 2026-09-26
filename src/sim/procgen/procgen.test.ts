import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findHeliports } from "../heliports.ts";
import { GENERATOR_VERSION, generateWorld, serializeWorld } from "./generate.ts";
import type { World } from "../world.ts";

const FINGERPRINTS = {
  version: 4,
  hashes: {
    "0": "ef730f9feb0ea874073610d88ea86bd0f7dce1525b487040538224ba1e66539b",
    "1": "ead6ef913ba1298515e0433c5218eb81179f4e9be9f331a4338b6fc0540feddc",
    "42": "9e78817d5e277675e7883378d1c4bbcb3addd696c85264a5866705e83d1370e3",
    "18446744073709551623": "ec6b610b51183f11493cc6ae1824a9e8088e78f66ed120a34844fd0f319a9015",
    "10000000000000000000000000000000000000000": "aadd4c6e2281fcddda5200250e6bbe9922056e105a67502007a15800123655e8",
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
    expect(() => generateWorld(-1n)).toThrow(/nezáporné/);
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
      const words = new Set<string>();
      for (const name of labels) {
        nameTotal += 1;
        const suffix = name.split(" ").pop() ?? "";
        suffixCount.set(suffix, (suffixCount.get(suffix) ?? 0) + 1);
        const word = name.slice(0, name.length - suffix.length).trim().toLowerCase();
        expect(words.has(word), name).toBe(false);
        words.add(word);
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

  it("ve zdrojích procgen nevolá zakázané funkce", () => {
    const banned = /\bMath\.(?:sin|cos|exp|pow|log|atan2|random)\b/;
    const files = sources("src/sim/procgen");
    expect(files.length).toBeGreaterThan(3);
    for (const file of files) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(banned);
    }
  });
});

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

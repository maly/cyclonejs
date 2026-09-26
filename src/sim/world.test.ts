import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { TerrainFile } from "./terrainTypes.ts";
import { heightAt, islandIdAt, surfaceAt, worldFromTerrain } from "./world.ts";

const terrain = JSON.parse(readFileSync("data/map/terrain.json", "utf8")) as TerrainFile;

describe("svět", () => {
  const world = worldFromTerrain(terrain);

  it("mimo ostrovy je moře ve výšce 0", () => {
    expect(heightAt(world, 1.2, 1.2)).toBe(0);
    expect(surfaceAt(world, 1.2, 1.2)).toBe(0);
    expect(heightAt(world, -1, 10)).toBe(0);
    expect(heightAt(world, 700, 10)).toBe(0);
  });

  it("výška souše souhlasí s mřížkou a heliport existuje", () => {
    const index = world.surface.findIndex((surface) => surface === 1);
    const x = index % world.width;
    const z = Math.floor(index / world.width);
    expect(heightAt(world, x + 0.5, z + 0.5)).toBe(world.height[index]);
    expect(heightAt(world, 270.5, 309.5)).toBe(1);
    expect(surfaceAt(world, 270.5, 309.5)).toBe(4);
    expect(islandIdAt(world, 270.5, 309.5)).toBe(7);
  });

  it("strom sahá o svou výšku nad terén paty", () => {
    expect(world.trees.length).toBe(118);
    expect(world.people.length).toBe(43);
    expect(world.people.filter((person) => person.type === "muz")).toHaveLength(22);
    expect(world.people.filter((person) => person.type === "zena")).toHaveLength(21);
    expect(world.crates.length).toBe(5);
    for (const tree of world.trees) {
      expect(tree.top).toBeGreaterThan(tree.base);
      expect(tree.base).toBe(heightAt(world, tree.x + 0.5, tree.z + 0.5));
    }
  });
});

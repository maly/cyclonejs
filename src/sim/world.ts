import type { TerrainFile } from "./terrainTypes.ts";

export const WORLD_WIDTH = 638;
export const WORLD_DEPTH = 588;

export interface TreeObstacle {
  type: string;
  x: number;
  z: number;
  base: number;
  top: number;
}

export interface ActorMark {
  type: string;
  x: number;
  z: number;
}

export interface CrateMark {
  x: number;
  z: number;
}

export interface World {
  width: number;
  depth: number;
  height: Uint8Array;
  surface: Uint8Array;
  estimated: Uint8Array;
  /**
   * 0 je moře nebo buňka mimo ostrov. Jinak je to číslo ostrova z `terrain.json` plus jedna,
   * protože ostrov 0 je platná skupina.
   */
  island?: Uint8Array;
  trees: TreeObstacle[];
  people: ActorMark[];
  crates: CrateMark[];
  /** Buňka heliportu základny. Originální mapa ji neukládá a platí výchozí základna. */
  baseX?: number;
  baseZ?: number;
  /** Jména ostrovů podle čísla z mapy. */
  islandNames?: string[];
}

const TREE_TYPES = new Set(["topol", "smrk_a", "smrk_b", "smrk_c"]);

export function worldFromTerrain(terrain: TerrainFile): World {
  const width = WORLD_WIDTH;
  const depth = WORLD_DEPTH;
  const height = new Uint8Array(width * depth);
  const surface = new Uint8Array(width * depth);
  const estimated = new Uint8Array(width * depth);
  const islandMap = new Uint8Array(width * depth);

  for (const island of terrain.islands) {
    for (let row = 0; row < island.h; row++) {
      for (let col = 0; col < island.w; col++) {
        const x = island.x + col;
        const z = island.y + row;
        if (x < 0 || z < 0 || x >= width || z >= depth) continue;
        const offset = row * island.w + col;
        const index = z * width + x;
        surface[index] = island.surface[offset];
        height[index] = surface[index] === 0 ? 0 : island.height[offset];
        estimated[index] = island.estimated[offset] ? 1 : 0;
        if (surface[index] !== 0) islandMap[index] = island.id + 1;
      }
    }
  }

  const trees: TreeObstacle[] = [];
  for (const object of terrain.objects) {
    if (!TREE_TYPES.has(object.type)) continue;
    const base = heightAtCell(height, surface, width, depth, object.x, object.y);
    trees.push({ type: object.type, x: object.x, z: object.y, base, top: base + object.levels });
  }

  return {
    width,
    depth,
    height,
    surface,
    estimated,
    island: islandMap,
    trees,
    people: terrain.people.map((person) => ({ type: person.type, x: person.x, z: person.y })),
    crates: terrain.crates.map((crate) => ({ x: crate.x, z: crate.y })),
  };
}

function heightAtCell(
  height: Uint8Array,
  surface: Uint8Array,
  width: number,
  depth: number,
  x: number,
  z: number,
): number {
  if (x < 0 || z < 0 || x >= width || z >= depth) return 0;
  const index = z * width + x;
  return surface[index] === 0 ? 0 : height[index];
}

export function cellIndex(world: World, x: number, z: number): number | null {
  const cx = Math.floor(x);
  const cz = Math.floor(z);
  if (cx < 0 || cz < 0 || cx >= world.width || cz >= world.depth) return null;
  return cz * world.width + cx;
}

export function heightAt(world: World, x: number, z: number): number {
  const index = cellIndex(world, x, z);
  if (index === null || world.surface[index] === 0) return 0;
  return world.height[index];
}

export function surfaceAt(world: World, x: number, z: number): number {
  const index = cellIndex(world, x, z);
  if (index === null) return 0;
  return world.surface[index];
}

export function estimatedAt(world: World, x: number, z: number): boolean {
  const index = cellIndex(world, x, z);
  return index !== null && world.estimated[index] === 1;
}

/** Číslo ostrova z mapy. Moře a buňka bez skupiny vrací null. */
export function islandIdAt(world: World, x: number, z: number): number | null {
  if (!world.island) return null;
  const index = cellIndex(world, x, z);
  if (index === null) return null;
  const code = world.island[index];
  return code === 0 ? null : code - 1;
}

export const SURFACE_NAME = ["sea", "grass", "sand", "road", "white", "roof", "concrete"] as const;

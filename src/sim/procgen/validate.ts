import { fullThrottleRange, coveredFromNorth, coveredFromSouth, BASE_ISLAND, CRATE_COUNT, CRATE_MIN_DISTANCE, PERSON_CRATE_DISTANCE, PERSON_MAX, PERSON_MIN, PERSON_MIN_DISTANCE, PERSON_PER_ISLAND } from "../placement.ts";
import { findHeliports } from "../heliports.ts";
import { BASE_CELL_X, BASE_CELL_Z } from "../config.ts";
import { islandIdAt, type World } from "../world.ts";

const WALK = new Set([1, 2, 3]);
const NEAR_SQ = 600 * 600;

export interface ProcgenReport {
  ok: boolean;
  reasons: string[];
  islands: number;
  heliports: number;
  houses: number;
  trees: number;
}

/** Kontrola pravidel souostroví. Bedny a lidé se berou tak, jak leží ve světě. */
export function assessWorld(world: World): ProcgenReport {
  const reasons: string[] = [];
  const islands = countIslands(world);
  const pads = findHeliports(world, world.baseX ?? BASE_CELL_X, world.baseZ ?? BASE_CELL_Z);
  const houses = countHouses(world);
  if (islands < 12 || islands > 18) reasons.push(`ostrovů je ${islands}, má jich být 12 až 18`);
  if (!pads.list.some((pad) => pad.base)) reasons.push("chybí základna");
  if (pads.list.length < 5 || pads.list.length > 7) reasons.push(`heliportů je ${pads.list.length}, má jich být 5 až 7`);
  for (const pad of pads.list) {
    const wide = (pad.w === 4 && pad.h === 3) || (pad.w === 3 && pad.h === 4);
    if (!wide) reasons.push(`heliport ${pad.x},${pad.z} nemá půdorys 4×3`);
    if (!padFlat(world, pad.x, pad.z, pad.w, pad.h)) reasons.push(`heliport ${pad.x},${pad.z} není rovný`);
  }
  const heightReason = heightFault(world);
  if (heightReason) reasons.push(heightReason);
  if (!beachesOk(world)) reasons.push("chybí písečná pláž bez útesu");
  if (!fuelOk(world, pads.list)) reasons.push("ostrov je dál než 35 % doletu od heliportu");
  if (!padsConnected(pads.list)) reasons.push("ze základny se nedá po heliportech doletět všude");
  if (!namesOk(world, islands)) reasons.push("ostrovu chybí jméno");
  const placed = placementFault(world, pads.list);
  if (placed) reasons.push(placed);
  return {
    ok: reasons.length === 0,
    reasons,
    islands,
    heliports: pads.list.length,
    houses,
    trees: world.trees.length,
  };
}

function countIslands(world: World): number {
  if (!world.island) return 0;
  const seen = new Set<number>();
  for (const code of world.island) {
    if (code !== 0) seen.add(code);
  }
  return seen.size;
}

function countHouses(world: World): number {
  const seen = new Uint8Array(world.surface.length);
  let houses = 0;
  for (let index = 0; index < world.surface.length; index++) {
    if (world.surface[index] !== 5 || seen[index]) continue;
    houses += 1;
    const stack = [index];
    seen[index] = 1;
    while (stack.length > 0) {
      const current = stack.pop() as number;
      const x = current % world.width;
      const z = (current - x) / world.width;
      if (x > 0) pushRoof(world, seen, stack, current - 1);
      if (x + 1 < world.width) pushRoof(world, seen, stack, current + 1);
      if (z > 0) pushRoof(world, seen, stack, current - world.width);
      if (z + 1 < world.depth) pushRoof(world, seen, stack, current + world.width);
    }
  }
  return houses;
}

function pushRoof(world: World, seen: Uint8Array, stack: number[], index: number): void {
  if (seen[index] || world.surface[index] !== 5) return;
  seen[index] = 1;
  stack.push(index);
}

function padFlat(world: World, x: number, z: number, w: number, h: number): boolean {
  let height = -1;
  for (let dz = 0; dz < h; dz++) {
    for (let dx = 0; dx < w; dx++) {
      const index = (z + dz) * world.width + (x + dx);
      if (world.surface[index] !== 4) return false;
      if (height < 0) height = world.height[index] ?? 0;
      else if (world.height[index] !== height) return false;
    }
  }
  return height >= 0;
}

function heightFault(world: World): string | null {
  for (let z = 0; z < world.depth; z++) {
    for (let x = 0; x < world.width; x++) {
      const index = z * world.width + x;
      if (world.surface[index] === 0) continue;
      const height = world.height[index] ?? 0;
      const pillar = isPillarCell(world, x, z);
      if (pillar) {
        if (height < 6 || height > 7) return `sloup ${x},${z} má výšku ${height}`;
      } else if (height > 6) {
        return `buňka ${x},${z} má výšku ${height}`;
      }
      if (slope(world, x, z, height)) return `buňka ${x},${z} má příliš vysoký schod`;
      if (!pillar && thin(world, x, z, height)) return `terasa na ${x},${z} je užší než dvě buňky`;
    }
  }
  return null;
}

function isPillarCell(world: World, x: number, z: number): boolean {
  const index = z * world.width + x;
  const height = world.height[index] ?? 0;
  if (world.surface[index] !== 4 || (height !== 6 && height !== 7)) return false;
  return side(world, x + 1, z) !== 4 && side(world, x - 1, z) !== 4 && side(world, x, z + 1) !== 4 && side(world, x, z - 1) !== 4;
}

function side(world: World, x: number, z: number): number {
  if (x < 0 || z < 0 || x >= world.width || z >= world.depth) return 0;
  return world.surface[z * world.width + x] ?? 0;
}

function landHeight(world: World, x: number, z: number): { land: boolean; height: number } {
  if (x < 0 || z < 0 || x >= world.width || z >= world.depth) return { land: false, height: 0 };
  const index = z * world.width + x;
  if (world.surface[index] === 0) return { land: false, height: 0 };
  return { land: true, height: world.height[index] ?? 0 };
}

function thin(world: World, x: number, z: number, height: number): boolean {
  const north = landHeight(world, x, z - 1);
  const south = landHeight(world, x, z + 1);
  const east = landHeight(world, x + 1, z);
  const west = landHeight(world, x - 1, z);
  const different = (cell: { land: boolean; height: number }) => !cell.land || cell.height !== height;
  if (different(north) && different(south)) return true;
  if (different(east) && different(west)) return true;
  return false;
}

function slope(world: World, x: number, z: number, height: number): boolean {
  const neighbors = [landHeight(world, x, z - 1), landHeight(world, x, z + 1), landHeight(world, x + 1, z), landHeight(world, x - 1, z)];
  for (const neighbor of neighbors) {
    const other = neighbor.land ? neighbor.height : 0;
    if (height - other > 3 || other - height > 3) return true;
  }
  return false;
}

function beachesOk(world: World): boolean {
  let sand = 0;
  for (let z = 0; z < world.depth; z++) {
    for (let x = 0; x < world.width; x++) {
      const index = z * world.width + x;
      if (world.surface[index] !== 2) continue;
      const height = world.height[index] ?? 0;
      if (height > 1) continue;
      const neighbors = [landHeight(world, x, z - 1), landHeight(world, x, z + 1), landHeight(world, x + 1, z), landHeight(world, x - 1, z)];
      if (neighbors.some((cell) => cell.land && cell.height > height + 1)) continue;
      sand += 1;
      if (sand >= 8) return true;
    }
  }
  return false;
}

function fuelOk(world: World, pads: readonly { x: number; z: number; w: number; h: number }[]): boolean {
  if (!world.island || pads.length === 0) return false;
  for (let z = 0; z < world.depth; z++) {
    for (let x = 0; x < world.width; x++) {
      if (world.island[z * world.width + x] === 0) continue;
      let near = false;
      for (const pad of pads) {
        if (distSqToRect(x, z, pad) <= NEAR_SQ) {
          near = true;
          break;
        }
      }
      if (!near) return false;
    }
  }
  return true;
}

function padsConnected(pads: readonly { x: number; z: number; w: number; h: number; base: boolean }[]): boolean {
  if (!pads.some((pad) => pad.base)) return false;
  const hop = fullThrottleRange();
  const hopSq = hop * hop;
  const seen = new Array<boolean>(pads.length).fill(false);
  const stack: number[] = [];
  for (let index = 0; index < pads.length; index++) {
    if (!pads[index]?.base) continue;
    stack.push(index);
    seen[index] = true;
  }
  while (stack.length > 0) {
    const current = stack.pop() as number;
    const from = pads[current];
    if (!from) continue;
    for (let index = 0; index < pads.length; index++) {
      if (seen[index]) continue;
      const pad = pads[index];
      if (!pad) continue;
      if (distSqToRect(from.x, from.z, pad) <= hopSq) {
        seen[index] = true;
        stack.push(index);
      }
    }
  }
  return seen.every(Boolean);
}

function distSqToRect(x: number, z: number, pad: { x: number; z: number; w: number; h: number }): number {
  const nx = x < pad.x ? pad.x : x > pad.x + pad.w - 1 ? pad.x + pad.w - 1 : x;
  const nz = z < pad.z ? pad.z : z > pad.z + pad.h - 1 ? pad.z + pad.h - 1 : z;
  const dx = x - nx;
  const dz = z - nz;
  return dx * dx + dz * dz;
}

function namesOk(world: World, islands: number): boolean {
  const names = world.islandNames;
  if (!names || !world.island) return false;
  const used = new Set<number>();
  for (const code of world.island) {
    if (code !== 0) used.add(code - 1);
  }
  if (used.size !== islands) return false;
  for (const id of used) {
    const name = names[id];
    if (!name) return false;
  }
  return true;
}

function placementFault(world: World, pads: readonly { x: number; z: number; w: number; h: number }[]): string | null {
  if (world.crates.length !== CRATE_COUNT) return "rozmístění beden se nepovedlo";
  const islands = new Set<number>();
  let covers = 0;
  const trees = new Set(world.trees.map((tree) => tree.z * world.width + tree.x));
  for (let index = 0; index < world.crates.length; index++) {
    const crate = world.crates[index];
    if (!crate) return "rozmístění beden se nepovedlo";
    const island = islandIdAt(world, crate.x, crate.z);
    if (island === null || island === BASE_ISLAND || islands.has(island)) return "bedna neleží na volném ostrově";
    islands.add(island);
    if (!walkable(world, crate.x, crate.z, trees)) return "bedna nestojí na volné zemi";
    for (let other = 0; other < index; other++) {
      const previous = world.crates[other];
      if (!previous) continue;
      const dx = crate.x - previous.x;
      const dz = crate.z - previous.z;
      if (dx * dx + dz * dz < CRATE_MIN_DISTANCE * CRATE_MIN_DISTANCE) return "bedny jsou příliš blízko";
    }
    let best = Infinity;
    for (const pad of pads) {
      const distance = distSqToRect(crate.x, crate.z, pad);
      if (distance < best) best = distance;
    }
    const limit = fullThrottleRange() * 0.4;
    if (best > limit * limit) return "bedna je dál než 40 % doletu";
    const south = coveredFromSouth(world, crate.x, crate.z);
    const north = coveredFromNorth(world, crate.x, crate.z);
    if (south && north) return "bedna je zakrytá z obou stran";
    if (south !== north) covers += 1;
  }
  if (covers < 2) return "chybí bedny zakryté z jednoho pohledu";
  if (world.people.length < PERSON_MIN || world.people.length > PERSON_MAX) return "rozmístění lidí se nepovedlo";
  const perIsland = new Map<number, number>();
  for (let index = 0; index < world.people.length; index++) {
    const person = world.people[index];
    if (!person) return "rozmístění lidí se nepovedlo";
    const island = islandIdAt(world, person.x, person.z);
    if (island === null || island === BASE_ISLAND) return "člověk je na základně nebo v moři";
    if (!walkable(world, person.x, person.z, trees)) return "člověk nestojí na volné zemi";
    const used = (perIsland.get(island) ?? 0) + 1;
    if (used > PERSON_PER_ISLAND) return "na ostrově je příliš lidí";
    perIsland.set(island, used);
    for (const crate of world.crates) {
      const dx = person.x - crate.x;
      const dz = person.z - crate.z;
      if (dx * dx + dz * dz < PERSON_CRATE_DISTANCE * PERSON_CRATE_DISTANCE) return "člověk je příliš blízko bedny";
    }
    for (let other = 0; other < index; other++) {
      const previous = world.people[other];
      if (!previous) continue;
      const dx = person.x - previous.x;
      const dz = person.z - previous.z;
      if (dx * dx + dz * dz < PERSON_MIN_DISTANCE * PERSON_MIN_DISTANCE) return "lidé stojí příliš blízko";
    }
  }
  return null;
}

function walkable(world: World, x: number, z: number, trees: Set<number>): boolean {
  if (x < 0 || z < 0 || x >= world.width || z >= world.depth) return false;
  const index = z * world.width + x;
  if (!WALK.has(world.surface[index] ?? 0)) return false;
  if (trees.has(index)) return false;
  return true;
}

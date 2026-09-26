import { FUEL_BURN, FUEL_MAX, FUEL_THRUST, MAX_SPEED } from "./config.ts";
import { findHeliports } from "./heliports.ts";
import { deriveSeed, rngInt, STREAM_CRATES, STREAM_PEOPLE } from "./rng.ts";
import { islandIdAt, type ActorMark, type CrateMark, type World } from "./world.ts";

export type LayoutMode = "random" | "original";

export const CRATE_COUNT = 5;
export const CRATE_MIN_DISTANCE = 60;
export const PLACEMENT_ATTEMPTS = 50;
export const PERSON_MIN = 30;
export const PERSON_MAX = 50;
export const PERSON_MIN_DISTANCE = 3;
export const PERSON_CRATE_DISTANCE = 5;
export const PERSON_PER_ISLAND = 8;
export const HOUSE_NEAR = 4;
export const HOUSE_WEIGHT = 3;
/** Ostrov se základnou. Z rozmístění vypadává. */
export const BASE_ISLAND = 7;
const WALK_SURFACES = new Set([1, 2, 3]);
const COVER_LIMIT = 32;

export interface PlacedCrate {
  x: number;
  z: number;
  south: boolean;
  north: boolean;
}

export interface PlacementIndex {
  crateCells: CrateCell[];
  peopleCells: PeopleCell[];
  originalCrates: CrateMark[];
  originalPeople: ActorMark[];
}

export interface PlacementResult {
  crates: CrateMark[];
  people: ActorMark[];
  /** Kolik podřízených seedů beden bylo potřeba. Při záloze je to strop pokusů. */
  crateAttempts: number;
  peopleAttempts: number;
  fallback: boolean;
  cratesMarked: PlacedCrate[];
}

interface CrateCell {
  x: number;
  z: number;
  island: number;
  south: boolean;
  north: boolean;
  cover: boolean;
}

interface PeopleCell {
  x: number;
  z: number;
  island: number;
  weight: number;
}

/** Dolet plným plynem, v buňkách. 40 % z toho je limit bedny od heliportu. */
export function fullThrottleRange(): number {
  return (FUEL_MAX / (FUEL_BURN + FUEL_THRUST)) * MAX_SPEED;
}

export function coveredFromSouth(world: World, x: number, z: number): boolean {
  return covered(world, x, z, 1);
}

export function coveredFromNorth(world: World, x: number, z: number): boolean {
  return covered(world, x, z, -1);
}

/**
 * Jednorázový index kandidátů. Samotné losování ze seedu už terén znovu neprochází.
 */
export function indexPlacement(world: World): PlacementIndex {
  const pads = findHeliports(world);
  const padCells = heliportCells(world, pads.mask);
  const fuel = fullThrottleRange() * 0.4;
  const trees = treeMask(world);
  const houses = houseNear(world);
  const crateCells: CrateCell[] = [];
  const peopleCells: PeopleCell[] = [];

  for (let z = 0; z < world.depth; z++) {
    for (let x = 0; x < world.width; x++) {
      const island = islandIdAt(world, x, z);
      if (island === null || island === BASE_ISLAND) continue;
      if (!WALK_SURFACES.has(surfaceOf(world, x, z))) continue;
      if (trees[z * world.width + x]) continue;
      if (!winchClear(world, trees, x, z)) continue;
      const south = coveredFromSouth(world, x, z);
      const north = coveredFromNorth(world, x, z);
      if (!south || !north) {
        if (nearestPad(x, z, padCells) <= fuel) {
          crateCells.push({ x, z, island, south, north, cover: south !== north });
        }
      }
      const index = z * world.width + x;
      peopleCells.push({ x, z, island, weight: houses[index] ? HOUSE_WEIGHT : 1 });
    }
  }

  return {
    crateCells,
    peopleCells,
    originalCrates: world.crates.map((crate) => ({ x: crate.x, z: crate.z })),
    originalPeople: world.people.map((person) => ({ type: person.type, x: person.x, z: person.z })),
  };
}

export function placeFromSeed(world: World, index: PlacementIndex, seed: number, mode: LayoutMode): PlacementResult {
  if (mode === "original") {
    return {
      crates: index.originalCrates.map((crate) => ({ ...crate })),
      people: index.originalPeople.map((person) => ({ ...person })),
      crateAttempts: 0,
      peopleAttempts: 0,
      fallback: false,
      cratesMarked: markCrates(world, index.originalCrates),
    };
  }

  const crates = placeCrates(index, seed);
  const people = crates ? placePeople(index, seed, crates.cells) : null;
  if (!crates || !people) {
    const crateAttempts = crates?.attempts ?? PLACEMENT_ATTEMPTS;
    const peopleAttempts = people?.attempts ?? (crates ? PLACEMENT_ATTEMPTS : 0);
    console.debug(
      `Rozmístění: po ${crateAttempts} pokusech beden a ${peopleAttempts} pokusech lidí používám originál (seed ${seed >>> 0}).`,
    );
    return {
      crates: index.originalCrates.map((crate) => ({ ...crate })),
      people: index.originalPeople.map((person) => ({ ...person })),
      crateAttempts,
      peopleAttempts,
      fallback: true,
      cratesMarked: markCrates(world, index.originalCrates),
    };
  }

  return {
    crates: crates.cells.map((cell) => ({ x: cell.x, z: cell.z })),
    people: people.people,
    crateAttempts: crates.attempts,
    peopleAttempts: people.attempts,
    fallback: false,
    cratesMarked: crates.cells.map((cell) => ({ x: cell.x, z: cell.z, south: cell.south, north: cell.north })),
  };
}

export function applyPlacement(world: World, placed: PlacementResult): void {
  world.crates = placed.crates.map((crate) => ({ x: crate.x, z: crate.z }));
  world.people = placed.people.map((person) => ({ type: person.type, x: person.x, z: person.z }));
}

function placeCrates(index: PlacementIndex, seed: number): { cells: CrateCell[]; attempts: number } | null {
  const groups = new Map<number, CrateCell[]>();
  for (const cell of index.crateCells) {
    const list = groups.get(cell.island);
    if (list) list.push(cell);
    else groups.set(cell.island, [cell]);
  }
  const islandIds = [...groups.keys()];
  for (let attempt = 0; attempt < PLACEMENT_ATTEMPTS; attempt++) {
    let state = deriveSeed(seed, STREAM_CRATES, attempt);
    for (let trial = 0; trial < 40; trial++) {
      const picked = pickCrates(groups, islandIds, state);
      state = picked.state;
      if (picked.cells) return { cells: picked.cells, attempts: attempt + 1 };
    }
  }
  return null;
}

function pickCrates(
  groups: Map<number, CrateCell[]>,
  islandIds: number[],
  state: number,
): { state: number; cells: CrateCell[] | null } {
  const order = islandIds.slice();
  state = shuffle(order, state);
  const used = new Set<number>();
  const picked: CrateCell[] = [];

  const take = (island: number, coverOnly: boolean): boolean => {
    const cells = groups.get(island);
    if (!cells || used.has(island)) return false;
    const fitting: CrateCell[] = [];
    for (const cell of cells) {
      if (coverOnly && !cell.cover) continue;
      if (picked.some((other) => distance2(other.x, other.z, cell.x, cell.z) < CRATE_MIN_DISTANCE * CRATE_MIN_DISTANCE)) continue;
      fitting.push(cell);
    }
    if (fitting.length === 0) return false;
    const roll = rngInt(state, 0, fitting.length - 1);
    state = roll.state;
    picked.push(fitting[roll.value]);
    used.add(island);
    return true;
  };

  for (const island of order) {
    if (picked.filter((cell) => cell.cover).length >= 2) break;
    take(island, true);
  }
  if (picked.filter((cell) => cell.cover).length < 2) return { state, cells: null };

  for (const island of order) {
    if (picked.length >= CRATE_COUNT) break;
    take(island, false);
  }
  if (picked.length < CRATE_COUNT) return { state, cells: null };
  return { state, cells: picked };
}

function placePeople(
  index: PlacementIndex,
  seed: number,
  crates: readonly { x: number; z: number }[],
): { people: ActorMark[]; attempts: number } | null {
  const crateLimit = PERSON_CRATE_DISTANCE * PERSON_CRATE_DISTANCE;
  const pool = index.peopleCells.filter((cell) => crates.every((crate) => distance2(cell.x, cell.z, crate.x, crate.z) >= crateLimit));
  for (let attempt = 0; attempt < PLACEMENT_ATTEMPTS; attempt++) {
    const people = pickPeople(pool, deriveSeed(seed, STREAM_PEOPLE, attempt));
    if (people) return { people, attempts: attempt + 1 };
  }
  return null;
}

function pickPeople(pool: readonly PeopleCell[], state: number): ActorMark[] | null {
  if (pool.length < PERSON_MIN) return null;
  const countRoll = rngInt(state, PERSON_MIN, PERSON_MAX);
  state = countRoll.state;
  const count = countRoll.value;
  if (pool.length < count) return null;

  const weights = pool.map((cell) => cell.weight);
  const fenwick = createFenwick(weights);
  const alive = new Uint8Array(pool.length);
  alive.fill(1);
  const picked: PeopleCell[] = [];
  const perIsland = new Map<number, number>();
  const spacing = PERSON_MIN_DISTANCE * PERSON_MIN_DISTANCE;
  let guard = 0;
  while (picked.length < count && fenwick.total > 0 && guard < pool.length) {
    guard += 1;
    const roll = rngInt(state, 0, fenwick.total - 1);
    state = roll.state;
    const index = fenwick.find(roll.value + 1);
    const cell = pool[index];
    if (!cell || !alive[index]) continue;
    alive[index] = 0;
    fenwick.add(index, -cell.weight);
    const used = perIsland.get(cell.island) ?? 0;
    if (used >= PERSON_PER_ISLAND) continue;
    if (picked.some((other) => distance2(other.x, other.z, cell.x, cell.z) < spacing)) continue;
    picked.push(cell);
    perIsland.set(cell.island, used + 1);
    if (used + 1 >= PERSON_PER_ISLAND) {
      for (let other = 0; other < pool.length; other++) {
        if (!alive[other] || pool[other].island !== cell.island) continue;
        alive[other] = 0;
        fenwick.add(other, -pool[other].weight);
      }
    }
  }
  if (picked.length < count) return null;

  const gender = rngInt(state, 0, 1);
  state = gender.state;
  const men = Math.floor(count / 2) + (count % 2 === 1 && gender.value === 1 ? 1 : 0);
  const types = Array.from({ length: count }, (_, index) => (index < men ? "muz" : "zena"));
  state = shuffle(types, state);
  return picked.map((cell, index) => ({ type: types[index] ?? "muz", x: cell.x, z: cell.z }));
}

function markCrates(world: World, crates: readonly { x: number; z: number }[]): PlacedCrate[] {
  return crates.map((crate) => ({
    x: crate.x,
    z: crate.z,
    south: coveredFromSouth(world, crate.x, crate.z),
    north: coveredFromNorth(world, crate.x, crate.z),
  }));
}

function covered(world: World, x: number, z: number, step: 1 | -1): boolean {
  const height = ground(world, x, z);
  for (let k = 1; k <= COVER_LIMIT; k++) {
    const nz = z + step * k;
    if (nz < 0 || nz >= world.depth) break;
    if (ground(world, x, nz) >= height + k) return true;
  }
  return false;
}

function winchClear(world: World, trees: Uint8Array, x: number, z: number): boolean {
  const height = ground(world, x, z);
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx;
      const nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= world.width || nz >= world.depth) continue;
      if (ground(world, nx, nz) > height + 1) return false;
      if (trees[nz * world.width + nx]) return false;
    }
  }
  return true;
}

function houseNear(world: World): Uint8Array {
  const near = new Uint8Array(world.width * world.depth);
  for (let z = 0; z < world.depth; z++) {
    for (let x = 0; x < world.width; x++) {
      if (surfaceOf(world, x, z) !== 5) continue;
      for (let dz = -HOUSE_NEAR; dz <= HOUSE_NEAR; dz++) {
        for (let dx = -HOUSE_NEAR; dx <= HOUSE_NEAR; dx++) {
          const nx = x + dx;
          const nz = z + dz;
          if (nx < 0 || nz < 0 || nx >= world.width || nz >= world.depth) continue;
          near[nz * world.width + nx] = 1;
        }
      }
    }
  }
  return near;
}

function treeMask(world: World): Uint8Array {
  const mask = new Uint8Array(world.width * world.depth);
  for (const tree of world.trees) {
    if (tree.x < 0 || tree.z < 0 || tree.x >= world.width || tree.z >= world.depth) continue;
    mask[tree.z * world.width + tree.x] = 1;
  }
  return mask;
}

function heliportCells(world: World, mask: Uint16Array): { x: number; z: number }[] {
  const cells: { x: number; z: number }[] = [];
  for (let index = 0; index < mask.length; index++) {
    if (!mask[index]) continue;
    cells.push({ x: index % world.width, z: Math.floor(index / world.width) });
  }
  return cells;
}

function nearestPad(x: number, z: number, cells: readonly { x: number; z: number }[]): number {
  let best = Infinity;
  for (const cell of cells) {
    const distance = Math.hypot(x - cell.x, z - cell.z);
    if (distance < best) best = distance;
  }
  return best;
}

function ground(world: World, x: number, z: number): number {
  if (x < 0 || z < 0 || x >= world.width || z >= world.depth) return 0;
  const index = z * world.width + x;
  return world.surface[index] === 0 ? 0 : world.height[index];
}

function surfaceOf(world: World, x: number, z: number): number {
  if (x < 0 || z < 0 || x >= world.width || z >= world.depth) return 0;
  return world.surface[z * world.width + x];
}

function distance2(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
}

function shuffle<T>(items: T[], state: number): number {
  for (let index = items.length - 1; index > 0; index--) {
    const roll = rngInt(state, 0, index);
    state = roll.state;
    const swap = items[index];
    items[index] = items[roll.value] as T;
    items[roll.value] = swap as T;
  }
  return state;
}

function createFenwick(weights: readonly number[]): { total: number; add(index: number, delta: number): void; find(order: number): number } {
  const size = weights.length;
  const tree = new Int32Array(size + 1);
  const fenwick = {
    total: 0,
    add(index: number, delta: number) {
      fenwick.total += delta;
      for (let cursor = index + 1; cursor <= size; cursor += cursor & -cursor) tree[cursor] += delta;
    },
    find(order: number) {
      let index = 0;
      let bit = 1;
      while (bit << 1 <= size) bit <<= 1;
      let rest = order;
      for (let step = bit; step > 0; step >>= 1) {
        const next = index + step;
        if (next <= size && tree[next] < rest) {
          index = next;
          rest -= tree[next];
        }
      }
      return index;
    },
  };
  for (let index = 0; index < size; index++) {
    if (weights[index]) fenwick.add(index, weights[index] ?? 0);
  }
  return fenwick;
}

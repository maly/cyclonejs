import { applyPlacement, BASE_ISLAND, indexPlacement, placeFromSeed } from "../placement.ts";
import type { TreeObstacle, World } from "../world.ts";
import { WORLD_DEPTH, WORLD_WIDTH } from "../world.ts";
import { nameIslands, type IslandProfile } from "./names.ts";
import { valueNoise } from "./noise.ts";
import { assessWorld } from "./validate.ts";
import {
  deriveAttempt,
  derivePhase,
  GENERATOR_VERSION,
  generatorState,
  MAX_ATTEMPTS,
  nextInt,
  type RngState,
} from "./rng.ts";

export { GENERATOR_VERSION, MAX_ATTEMPTS };

const MARGIN = 4;
const SEA_GAP = 45;
const CLUSTER_GAP = 8;
const GRASS = 1;
const SAND = 2;
const ROAD = 3;
const WHITE = 4;
const ROOF = 5;

type IslandForm = "blob" | "crescent" | "bay" | "sand";

interface Draft {
  id: number;
  cluster: number;
  base: boolean;
  x: number;
  z: number;
  rx: number;
  ry: number;
  /** Tvar vybraný ve fázi obrysu. Výšky a písek se podle něj větví. */
  form: IslandForm;
}

interface Grid {
  height: Uint8Array;
  surface: Uint8Array;
  island: Uint8Array;
}

interface Rect {
  x: number;
  z: number;
  w: number;
  h: number;
  height: number;
}

/**
 * Celý svět pro dané číslo mapy. Stejné číslo dává stejné bajty, záporné číslo je chyba.
 * Když kontrola neprojde, zkusí se další podseed, nejvýš dvacetkrát.
 */
export function generateWorld(mapSeed: bigint): World {
  const root = generatorState(mapSeed);
  let last = "failed to assemble an archipelago";
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const built = tryBuild(deriveAttempt(root, attempt), mapSeed);
    if (!built.world) {
      last = built.reason;
      continue;
    }
    const report = assessWorld(built.world);
    if (report.ok) return built.world;
    last = report.reasons.join("; ");
  }
  throw new Error(`Generator version ${GENERATOR_VERSION} found no valid archipelago for number ${mapSeed}: ${last}`);
}

/** Seed rozmístění beden a lidí. Závisí na čísle mapy a na seedu hry, ne na ostatních fázích. */
export function layoutSeed(mapSeed: bigint, gameSeed: number): number {
  const root = generatorState(mapSeed);
  const crates = derivePhase(root, "crates");
  const people = derivePhase(root, "people");
  const joined = derivePhase(
    {
      s0: (crates.s0 ^ people.s0) >>> 0,
      s1: (crates.s1 ^ people.s1) >>> 0,
      s2: (crates.s2 ^ people.s2) >>> 0,
      s3: (crates.s3 ^ (gameSeed >>> 0)) >>> 0,
    },
    "layout",
  );
  return joined.s0 === 0 ? 1 : joined.s0;
}

/** Desítkový zápis z adresy. Prázdný a cizí text není číslo mapy. */
export function parseMapParam(value: string): bigint | null {
  if (!/^\d+$/.test(value)) return null;
  return BigInt(value);
}

/** Stabilní JSON světa. Dva stejné světy mají stejný řetězec. */
export function serializeWorld(world: World): string {
  return JSON.stringify({
    width: world.width,
    depth: world.depth,
    height: Array.from(world.height),
    surface: Array.from(world.surface),
    estimated: Array.from(world.estimated),
    island: Array.from(world.island ?? []),
    trees: world.trees.map((tree) => ({ type: tree.type, x: tree.x, z: tree.z, base: tree.base, top: tree.top })),
    people: world.people.map((person) => ({ type: person.type, x: person.x, z: person.z })),
    crates: world.crates.map((crate) => ({ x: crate.x, z: crate.z })),
    baseX: world.baseX ?? null,
    baseZ: world.baseZ ?? null,
    islandNames: world.islandNames ?? [],
  });
}

function tryBuild(root: RngState, mapSeed: bigint): { world: World | null; reason: string } {
  let islands = derivePhase(root, "islands");
  let shape = derivePhase(root, "shape");
  let heights = derivePhase(root, "heights");
  let houses = derivePhase(root, "houses");
  let trees = derivePhase(root, "trees");
  let heliports = derivePhase(root, "heliports");
  let pillars = derivePhase(root, "pillars");
  let names = derivePhase(root, "names");

  const planned = planIslands(islands);
  if (!planned.drafts) return { world: null, reason: planned.reason };
  islands = planned.state;

  const grid: Grid = {
    height: new Uint8Array(WORLD_WIDTH * WORLD_DEPTH),
    surface: new Uint8Array(WORLD_WIDTH * WORLD_DEPTH),
    island: new Uint8Array(WORLD_WIDTH * WORLD_DEPTH),
  };
  const shaped = rasterIslands(grid, planned.drafts, shape);
  if (!shaped.ok) return { world: null, reason: shaped.reason };
  shape = shaped.state;

  const raised = raiseIslands(grid, planned.drafts, heights);
  if (!raised.ok) return { world: null, reason: raised.reason };
  heights = raised.state;

  const paved = placePads(grid, planned.drafts, heliports);
  if (!paved.ok || paved.baseX === undefined || paved.baseZ === undefined) return { world: null, reason: paved.reason };
  heliports = paved.state;

  const built = placeHouses(grid, planned.drafts, houses);
  if (!built.ok) return { world: null, reason: built.reason };
  houses = built.state;

  const towers = placePillars(grid, pillars);
  pillars = towers.state;
  const planted = placeTrees(grid, planned.drafts, trees);
  trees = planted.state;
  const titled = placeNames(grid, planned.drafts, planted.trees, names);
  names = titled.state;

  const world: World = {
    width: WORLD_WIDTH,
    depth: WORLD_DEPTH,
    height: grid.height,
    surface: grid.surface,
    estimated: new Uint8Array(WORLD_WIDTH * WORLD_DEPTH),
    island: grid.island,
    trees: planted.trees,
    people: [],
    crates: [],
    baseX: paved.baseX,
    baseZ: paved.baseZ,
    islandNames: titled.names,
  };
  const placed = placeFromSeed(world, indexPlacement(world), layoutSeed(mapSeed, 0), "random");
  if (placed.fallback) return { world: null, reason: "crate placement failed" };
  applyPlacement(world, placed);
  return { world, reason: "" };
}

function planIslands(state: RngState): { state: RngState; drafts: Draft[] | null; reason: string } {
  const totalRoll = nextInt(state, 12, 18);
  state = totalRoll.state;
  const total = totalRoll.value;
  const drafts: Draft[] = [];
  let cursor = 0;
  const alloc = (base: boolean) => {
    if (base) return BASE_ISLAND;
    if (cursor === BASE_ISLAND) cursor += 1;
    const id = cursor;
    cursor += 1;
    return id;
  };

  const baseRx = nextInt(state, 34, 39);
  state = baseRx.state;
  const baseRy = nextInt(state, 28, 36);
  state = baseRy.state;
  const baseX = nextInt(state, Math.floor(WORLD_WIDTH / 3) + 24, Math.floor((2 * WORLD_WIDTH) / 3) - 24);
  state = baseX.state;
  const baseZ = nextInt(state, Math.floor(WORLD_DEPTH / 3) + 24, Math.floor((2 * WORLD_DEPTH) / 3) - 24);
  state = baseZ.state;
  const base: Draft = { id: alloc(true), cluster: 0, base: true, x: baseX.value, z: baseZ.value, rx: baseRx.value, ry: baseRy.value, form: "blob" };
  drafts.push(base);

  let left = total - 1;
  const groups: number[] = [];
  while (left > 0) {
    const grouped = groups.some((size) => size >= 2);
    const roll = nextInt(state, 0, 99);
    state = roll.state;
    let size = 1;
    if (left >= 2 && (!grouped || roll.value < 55)) size = nextInt(state, 2, Math.min(4, left)).value;
    if (size > 1) state = nextInt(state, 2, Math.min(4, left)).state;
    if (!grouped && left < 2) size = 1;
    if (size > left) size = left;
    groups.push(size);
    left -= size;
  }
  if (!groups.some((size) => size >= 2) && groups.length >= 2) {
    const last = groups.pop() ?? 1;
    groups[groups.length - 1] = Math.min(4, (groups[groups.length - 1] ?? 1) + last);
  }

  let cluster = 1;
  for (const size of groups) {
    const members: Draft[] = [];
    for (let index = 0; index < size; index++) {
      const long = nextInt(state, 14, 22);
      state = long.state;
      const short = nextInt(state, 8, long.value);
      state = short.state;
      members.push({ id: alloc(false), cluster, base: false, x: 0, z: 0, rx: long.value, ry: short.value, form: "blob" });
    }
    const anchor = members[0];
    if (!anchor) return { state, drafts: null, reason: "the group is missing an island" };
    const placed = placeApart(state, anchor, drafts, 160);
    state = placed.state;
    if (!placed.ok) return { state, drafts: null, reason: "the islands do not fit in the sea" };
    drafts.push(anchor);
    for (let index = 1; index < members.length; index++) {
      const member = members[index];
      if (!member) continue;
      const near = placeNear(state, member, anchor, drafts, 80);
      state = near.state;
      if (!near.ok) return { state, drafts: null, reason: "the island group did not fit" };
      drafts.push(member);
    }
    cluster += 1;
  }
  return { state, drafts, reason: "" };
}

function placeApart(state: RngState, draft: Draft, existing: readonly Draft[], tries: number): { state: RngState; ok: boolean } {
  const reach = reachOf(draft);
  for (let attempt = 0; attempt < tries; attempt++) {
    const x = nextInt(state, MARGIN + reach, WORLD_WIDTH - MARGIN - reach - 1);
    state = x.state;
    const z = nextInt(state, MARGIN + reach, WORLD_DEPTH - MARGIN - reach - 1);
    state = z.state;
    draft.x = x.value;
    draft.z = z.value;
    if (existing.every((other) => separated(draft, other))) return { state, ok: true };
  }
  return { state, ok: false };
}

function placeNear(state: RngState, draft: Draft, anchor: Draft, existing: readonly Draft[], tries: number): { state: RngState; ok: boolean } {
  const inner = reachOf(draft) + reachOf(anchor) + CLUSTER_GAP;
  const outer = inner + 16;
  for (let attempt = 0; attempt < tries; attempt++) {
    const dx = nextInt(state, -outer, outer);
    state = dx.state;
    const dz = nextInt(state, -outer, outer);
    state = dz.state;
    const dist = dx.value * dx.value + dz.value * dz.value;
    if (dist < inner * inner || dist > outer * outer) continue;
    draft.x = anchor.x + dx.value;
    draft.z = anchor.z + dz.value;
    if (draft.x < MARGIN + reachOf(draft) || draft.z < MARGIN + reachOf(draft)) continue;
    if (draft.x >= WORLD_WIDTH - MARGIN - reachOf(draft) || draft.z >= WORLD_DEPTH - MARGIN - reachOf(draft)) continue;
    if (existing.every((other) => separated(draft, other))) return { state, ok: true };
  }
  return { state, ok: false };
}

function separated(a: Draft, b: Draft): boolean {
  const gap = a.cluster === b.cluster ? CLUSTER_GAP : SEA_GAP;
  const need = reachOf(a) + reachOf(b) + gap;
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz >= need * need;
}

function reachOf(draft: Draft): number {
  return draft.rx > draft.ry ? draft.rx : draft.ry;
}

function rasterIslands(grid: Grid, drafts: readonly Draft[], state: RngState): { state: RngState; ok: boolean; reason: string } {
  for (const draft of drafts) {
    const formRoll = nextInt(state, 0, 99);
    state = formRoll.state;
    draft.form = "blob";
    if (!draft.base) {
      if (formRoll.value < 30) draft.form = "crescent";
      else if (formRoll.value < 55) draft.form = "bay";
      else if (formRoll.value < 78) draft.form = "sand";
    }
    if (draft.form === "crescent") {
      state = stampHook(grid, draft, state);
      continue;
    }
    const saltRoll = nextInt(state, 1, 0x7ffffffe);
    state = saltRoll.state;
    const salt = saltRoll.value;
    const reach = reachOf(draft);
    const lobes: number[] = [];
    const lobeMin = draft.base ? 78 : 64;
    for (let index = 0; index < 8; index++) {
      const lobe = nextInt(state, lobeMin, 100);
      state = lobe.state;
      lobes.push(lobe.value);
    }
    const bites: { x: number; z: number; radius: number }[] = [];
    const biteCount = nextInt(state, 1, draft.base ? 3 : 2);
    state = biteCount.state;
    for (let index = 0; index < biteCount.value; index++) {
      const fx = nextInt(state, -100, 100);
      state = fx.state;
      const fz = nextInt(state, -100, 100);
      state = fz.state;
      const span = Math.sqrt(fx.value * fx.value + fz.value * fz.value);
      const radius = nextInt(state, Math.max(4, Math.floor(reach * 0.22)), Math.max(6, Math.floor(reach * 0.46)));
      state = radius.state;
      if (span < 1) continue;
      const along = (reach * 78) / 100;
      bites.push({
        x: Math.floor(draft.x + (fx.value / span) * along),
        z: Math.floor(draft.z + (fz.value / span) * along),
        radius: radius.value,
      });
    }
    const waist = reach >= 16 ? nextInt(state, 0, 99) : { state, value: 100 };
    state = waist.state;
    const ox = nextInt(state, -Math.floor(reach * 0.42), Math.floor(reach * 0.42));
    state = ox.state;
    const oz = nextInt(state, -Math.floor(reach * 0.42), Math.floor(reach * 0.42));
    state = oz.state;
    const second = waist.value < 75;
    for (let z = draft.z - reach; z <= draft.z + reach; z++) {
      for (let x = draft.x - reach; x <= draft.x + reach; x++) {
        if (x < 0 || z < 0 || x >= WORLD_WIDTH || z >= WORLD_DEPTH) continue;
        const dx = x - draft.x;
        const dz = z - draft.z;
        const lobeX = Math.floor(draft.rx * 0.5);
        const lobeZ = Math.floor(draft.ry * 0.5);
        if (!insideOutline(dx, dz, draft.rx, draft.ry, lobes, salt) && !(second && lobeX >= 6 && lobeZ >= 6 && insideOutline(x - (draft.x + ox.value), z - (draft.z + oz.value), lobeX, lobeZ, lobes, salt + 19))) continue;
        if (inBite(x, z, draft, bites)) continue;
        const index = z * WORLD_WIDTH + x;
        if (grid.island[index] !== 0) continue;
        grid.island[index] = draft.id + 1;
        grid.surface[index] = GRASS;
        grid.height[index] = 1;
      }
    }
    if (draft.form === "bay") state = carveLagoon(grid, draft, state);
  }
  fillSmallHoles(grid, 1);
  removeIsolated(grid);
  for (const draft of drafts) {
    if (!keepLargest(grid, draft.id)) return { state, ok: false, reason: "an island broke apart" };
    const box = measure(grid, draft.id);
    if (!box) return { state, ok: false, reason: "an island disappeared" };
    const long = box.w > box.h ? box.w : box.h;
    if (long < 15 || long > 84 || box.area < 60) return { state, ok: false, reason: "an island has the wrong size" };
  }
  const areas = drafts.map((draft) => measure(grid, draft.id)?.area ?? 0);
  const baseArea = areas[drafts.findIndex((draft) => draft.base)] ?? 0;
  let largest = 0;
  for (const area of areas) if (area > largest) largest = area;
  if (baseArea < largest) return { state, ok: false, reason: "the base is not among the largest islands" };
  return { state, ok: true, reason: "" };
}

function insideOutline(dx: number, dz: number, rx: number, ry: number, lobes: readonly number[], salt: number): boolean {
  if (rx < 1 || ry < 1) return false;
  const lobe = (lobes[sector(dx, dz)] ?? 80) / 100;
  const radial = Math.sqrt((dx * dx) / (rx * rx * lobe * lobe) + (dz * dz) / (ry * ry * lobe * lobe));
  if (radial > 1) return false;
  const coarse = valueNoise(dx * 0.07, dz * 0.07, salt);
  const fine = valueNoise(dx * 0.18, dz * 0.18, salt + 97);
  const grit = valueNoise(dx * 0.38, dz * 0.38, salt + 211);
  const limit = 0.7 + (coarse - 0.5) * 0.46 + (fine - 0.5) * 0.36 + (grit - 0.5) * 0.42;
  return radial <= limit;
}

function sector(dx: number, dz: number): number {
  const ax = dx < 0 ? -dx : dx;
  const az = dz < 0 ? -dz : dz;
  if (ax >= az * 2) return dx >= 0 ? 0 : 4;
  if (az >= ax * 2) return dz >= 0 ? 2 : 6;
  if (dx >= 0 && dz < 0) return 7;
  if (dx < 0 && dz < 0) return 5;
  if (dx < 0) return 3;
  return 1;
}

/** Tlustý oblouk otevřený na jednu stranu. Střednice je kvadratická, tělo má poloměr 3. */
function stampHook(grid: Grid, draft: Draft, state: RngState): RngState {
  const facing = nextInt(state, 0, 3);
  state = facing.state;
  const radius = 3;
  const startX = Math.floor(draft.rx * 0.35);
  const startZ = -draft.ry + radius;
  const bendX = -draft.rx + radius;
  const endZ = draft.ry - radius;
  const steps = (draft.rx + draft.ry) * 2;
  for (let step = 0; step <= steps; step++) {
    const t = step / steps;
    const u = 1 - t;
    const x = u * u * startX + 2 * u * t * bendX + t * t * startX;
    const z = u * u * startZ + t * t * endZ;
    const turned = turnOffset(Math.round(x), Math.round(z), facing.value);
    stampDisk(grid, draft, draft.x + turned.x, draft.z + turned.z, radius, false);
  }
  return state;
}

function turnOffset(dx: number, dz: number, facing: number): { x: number; z: number } {
  if (facing === 1) return { x: -dz, z: dx };
  if (facing === 2) return { x: -dx, z: -dz };
  if (facing === 3) return { x: dz, z: -dx };
  return { x: dx, z: dz };
}

function stampDisk(grid: Grid, draft: Draft, cx: number, cz: number, radius: number, sea: boolean): void {
  const limit = radius * radius;
  for (let z = cz - radius; z <= cz + radius; z++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      if (x < 0 || z < 0 || x >= WORLD_WIDTH || z >= WORLD_DEPTH) continue;
      const dx = x - cx;
      const dz = z - cz;
      if (dx * dx + dz * dz > limit) continue;
      const index = z * WORLD_WIDTH + x;
      if (sea) {
        if (grid.island[index] !== draft.id + 1) continue;
        grid.island[index] = 0;
        grid.surface[index] = 0;
        grid.height[index] = 0;
        continue;
      }
      if (grid.island[index] !== 0) continue;
      grid.island[index] = draft.id + 1;
      grid.surface[index] = GRASS;
      grid.height[index] = 1;
    }
  }
}

/** Vnitřní záliv s ústím a dva krátké zářezy od okraje, které ostrov neroztnou. */
function carveLagoon(grid: Grid, draft: Draft, state: RngState): RngState {
  const facing = nextInt(state, 0, 3);
  state = facing.state;
  const ox = facing.value === 0 ? 1 : facing.value === 2 ? -1 : 0;
  const oz = facing.value === 1 ? 1 : facing.value === 3 ? -1 : 0;
  const inset = Math.floor(Math.min(draft.rx, draft.ry) * 0.18);
  const px = draft.x + ox * inset;
  const pz = draft.z + oz * inset;
  const pool = Math.min(draft.rx, draft.ry) >= 12 ? 4 : 3;
  stampDisk(grid, draft, px, pz, pool, true);
  carveChannel(grid, draft, px, pz, ox, oz, pool, 3);
  carveNotch(grid, draft, (facing.value + 1) % 4, 4);
  carveNotch(grid, draft, (facing.value + 3) % 4, 4);
  return state;
}

function carveNotch(grid: Grid, draft: Draft, facing: number, length: number): void {
  const ox = facing === 0 ? 1 : facing === 2 ? -1 : 0;
  const oz = facing === 1 ? 1 : facing === 3 ? -1 : 0;
  let x = draft.x + ox * draft.rx;
  let z = draft.z + oz * draft.ry;
  for (let step = 0; step < length; step++) {
    x -= ox;
    z -= oz;
    clearLand(grid, draft.id, x, z);
  }
}

function carveChannel(grid: Grid, draft: Draft, x: number, z: number, ox: number, oz: number, skip: number, width: number): void {
  const sideX = oz;
  const sideZ = ox === 0 && oz === 0 ? 1 : -ox;
  const limit = Math.max(draft.rx, draft.ry) + 8;
  for (let step = 0; step < limit; step++) {
    if (step >= skip) {
      for (let extra = 0; extra < width; extra++) {
        clearLand(grid, draft.id, x + sideX * extra, z + sideZ * extra);
      }
    }
    x += ox;
    z += oz;
    if (x < 1 || z < 1 || x >= WORLD_WIDTH - 1 || z >= WORLD_DEPTH - 1) return;
    if (step > skip + 2 && !channelOnLand(grid, draft.id, x, z, sideX, sideZ, width)) return;
  }
}

function channelOnLand(grid: Grid, id: number, x: number, z: number, sideX: number, sideZ: number, width: number): boolean {
  for (let extra = 0; extra < width; extra++) {
    const nx = x + sideX * extra;
    const nz = z + sideZ * extra;
    if (nx < 0 || nz < 0 || nx >= WORLD_WIDTH || nz >= WORLD_DEPTH) continue;
    if (grid.island[nz * WORLD_WIDTH + nx] === id + 1) return true;
  }
  return false;
}

function clearLand(grid: Grid, id: number, x: number, z: number): void {
  if (x < 0 || z < 0 || x >= WORLD_WIDTH || z >= WORLD_DEPTH) return;
  const index = z * WORLD_WIDTH + x;
  if (grid.island[index] !== id + 1) return;
  grid.island[index] = 0;
  grid.surface[index] = 0;
  grid.height[index] = 0;
}

function inBite(x: number, z: number, draft: Draft, bites: readonly { x: number; z: number; radius: number }[]): boolean {
  const dx = x - draft.x;
  const dz = z - draft.z;
  const fromCenter = dx * dx + dz * dz;
  const keep = reachOf(draft) * 0.34;
  if (fromCenter < keep * keep) return false;
  for (const bite of bites) {
    const bx = x - bite.x;
    const bz = z - bite.z;
    if (bx * bx + bz * bz <= bite.radius * bite.radius) return true;
  }
  return false;
}

function raiseIslands(grid: Grid, drafts: readonly Draft[], state: RngState): { state: RngState; ok: boolean; reason: string } {
  const coast = distances(grid);
  for (const draft of drafts) {
    const relieved = stampRelief(grid, draft, state, coast);
    state = relieved;
  }
  if (!repairHeights(grid)) return { state, ok: false, reason: "the terraces break the height rules" };
  fillSmallHoles(grid, 1);
  removeIsolated(grid);
  if (!repairHeights(grid)) return { state, ok: false, reason: "the terraces break the height rules" };
  const painted = paintBeaches(grid, drafts, state);
  state = painted.state;
  if (!painted.ok) return { state, ok: false, reason: "the beach failed" };
  for (const draft of drafts) {
    const box = measure(grid, draft.id);
    if (!box) return { state, ok: false, reason: "an island disappeared while terracing" };
    const long = box.w > box.h ? box.w : box.h;
    if (long < 15 || box.area < 60) return { state, ok: false, reason: "an island shrank while terracing" };
  }
  return { state, ok: true, reason: "" };
}

function paintBeaches(grid: Grid, drafts: readonly Draft[], state: RngState): { state: RngState; ok: boolean } {
  let sand = 0;
  for (const draft of drafts) {
    if (draft.form !== "sand") continue;
    for (let z = 0; z < WORLD_DEPTH; z++) {
      for (let x = 0; x < WORLD_WIDTH; x++) {
        const cell = z * WORLD_WIDTH + x;
        if (grid.island[cell] !== draft.id + 1 || grid.surface[cell] === 0) continue;
        if ((grid.height[cell] ?? 0) > 1) continue;
        grid.surface[cell] = SAND;
        sand += 1;
      }
    }
  }
  const count = nextInt(state, 3, Math.min(8, drafts.length));
  state = count.state;
  const order = drafts.map((draft) => draft.id);
  state = shuffle(order, state);
  for (let index = 0; index < count.value; index++) {
    const id = order[index];
    if (id === undefined) continue;
    for (let z = 0; z < WORLD_DEPTH; z++) {
      for (let x = 0; x < WORLD_WIDTH; x++) {
        const cell = z * WORLD_WIDTH + x;
        if (grid.island[cell] !== id + 1 || grid.surface[cell] === 0) continue;
        if ((grid.height[cell] ?? 0) > 1) continue;
        if (!touchesSea(grid, x, z)) continue;
        if (!gentle(grid, x, z, grid.height[cell] ?? 0)) continue;
        if (grid.surface[cell] === SAND) continue;
        grid.surface[cell] = SAND;
        sand += 1;
      }
    }
  }
  return { state, ok: sand >= 8 };
}

function placePads(grid: Grid, drafts: readonly Draft[], state: RngState): { state: RngState; ok: boolean; reason: string; baseX?: number; baseZ?: number } {
  const extra = nextInt(state, 4, 6);
  state = extra.state;
  const coast = distances(grid);
  const base = drafts.find((draft) => draft.base);
  if (!base) return { state, ok: false, reason: "the base is missing" };
  const baseRect = takeRect(grid, base.id, state, coast);
  state = baseRect.state;
  if (!baseRect.rect) return { state, ok: false, reason: "the base has no room for a heliport" };
  let placed = 0;
  const others = drafts.filter((draft) => !draft.base);
  others.sort((a, b) => dist2(b.x, b.z, base.x, base.z) - dist2(a.x, a.z, base.x, base.z));
  for (const draft of others) {
    if (placed >= extra.value) break;
    const found = takeRect(grid, draft.id, state, coast);
    state = found.state;
    if (!found.rect) continue;
    placed += 1;
  }
  if (placed < 4) return { state, ok: false, reason: "not enough heliports fit" };
  return { state, ok: true, reason: "", baseX: baseRect.rect.x, baseZ: baseRect.rect.z };
}

function takeRect(grid: Grid, id: number, state: RngState, coast: Int16Array): { state: RngState; rect: Rect | null } {
  const box = measure(grid, id);
  if (!box) return { state, rect: null };
  const orientations = [
    [4, 3],
    [3, 4],
  ] as const;
  let best: Rect[] = [];
  let bestScore = 0;
  for (const minGap of [4, 3, 2]) {
    best = [];
    bestScore = 0;
    for (const [w, h] of orientations) {
      for (let z = box.minZ; z <= box.maxZ - h + 1; z++) {
        for (let x = box.minX; x <= box.maxX - w + 1; x++) {
          const height = flatHeight(grid, id, x, z, w, h);
          if (height === null) continue;
          const gap = coastGap(coast, x, z, w, h);
          if (gap < minGap) continue;
          const score = gap * 8 + height;
          if (score > bestScore) {
            bestScore = score;
            best = [{ x, z, w, h, height }];
          } else if (score === bestScore && best.length < 12) {
            best.push({ x, z, w, h, height });
          }
        }
      }
    }
    if (best.length > 0) break;
  }
  if (best.length > 0) {
    const roll = nextInt(state, 0, best.length - 1);
    state = roll.state;
    const order = best.slice(roll.value).concat(best.slice(0, roll.value));
    for (const rect of order) {
      if (stampPad(grid, rect)) return { state, rect };
    }
  }
  return { state, rect: null };
}

function coastGap(coast: Int16Array, x: number, z: number, w: number, h: number): number {
  let gap = 99;
  for (let dz = 0; dz < h; dz++) {
    for (let dx = 0; dx < w; dx++) {
      const distance = coast[(z + dz) * WORLD_WIDTH + (x + dx)] ?? 0;
      if (distance < gap) gap = distance;
    }
  }
  return gap;
}

function flatHeight(grid: Grid, id: number, x: number, z: number, w: number, h: number): number | null {
  let height = -1;
  for (let dz = 0; dz < h; dz++) {
    for (let dx = 0; dx < w; dx++) {
      const index = (z + dz) * WORLD_WIDTH + (x + dx);
      if (grid.island[index] !== id + 1) return null;
      if (grid.surface[index] !== GRASS && grid.surface[index] !== SAND) return null;
      const cell = grid.height[index] ?? 0;
      if (height < 0) height = cell;
      else if (cell !== height) return null;
    }
  }
  return height;
}

function stampPad(grid: Grid, rect: Rect): boolean {
  return stampBlock(grid, rect, WHITE);
}

function stampBlock(grid: Grid, rect: Rect, surface: number): boolean {
  const saved = snapshot(grid, rect.x - 1, rect.z - 1, rect.w + 2, rect.h + 2);
  for (let dz = 0; dz < rect.h; dz++) {
    for (let dx = 0; dx < rect.w; dx++) {
      const index = (rect.z + dz) * WORLD_WIDTH + (rect.x + dx);
      grid.surface[index] = surface;
      grid.height[index] = rect.height;
    }
  }
  if (regionSound(grid, rect.x - 1, rect.z - 1, rect.w + 2, rect.h + 2)) return true;
  restore(grid, saved);
  return false;
}

function snapshot(grid: Grid, x: number, z: number, w: number, h: number): { index: number; surface: number; height: number; island: number }[] {
  const saved: { index: number; surface: number; height: number; island: number }[] = [];
  for (let dz = 0; dz < h; dz++) {
    for (let dx = 0; dx < w; dx++) {
      const nx = x + dx;
      const nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= WORLD_WIDTH || nz >= WORLD_DEPTH) continue;
      const index = nz * WORLD_WIDTH + nx;
      saved.push({ index, surface: grid.surface[index] ?? 0, height: grid.height[index] ?? 0, island: grid.island[index] ?? 0 });
    }
  }
  return saved;
}

function restore(grid: Grid, saved: readonly { index: number; surface: number; height: number; island: number }[]): void {
  for (const cell of saved) {
    grid.surface[cell.index] = cell.surface;
    grid.height[cell.index] = cell.height;
    grid.island[cell.index] = cell.island;
  }
}

function regionSound(grid: Grid, x: number, z: number, w: number, h: number): boolean {
  for (let dz = 0; dz < h; dz++) {
    for (let dx = 0; dx < w; dx++) {
      const nx = x + dx;
      const nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= WORLD_WIDTH || nz >= WORLD_DEPTH) continue;
      const index = nz * WORLD_WIDTH + nx;
      if (grid.surface[index] === 0) continue;
      const height = grid.height[index] ?? 0;
      if (cellSlope(grid, nx, nz, height)) return false;
      if (!isTower(grid, nx, nz) && cellThin(grid, nx, nz, height)) return false;
    }
  }
  return true;
}

function placeHouses(grid: Grid, drafts: readonly Draft[], state: RngState): { state: RngState; ok: boolean; reason: string } {
  const footprints = [
    [2, 2],
    [2, 3],
    [3, 2],
    [3, 3],
    [4, 2],
    [4, 3],
    [2, 4],
    [3, 4],
  ] as const;
  for (const draft of drafts) {
    const box = measure(grid, draft.id);
    if (!box) return { state, ok: false, reason: "an island disappeared before the houses" };
    let max = 1;
    if (box.area > 280) max = 2;
    if (box.area > 700) max = 3;
    if (box.area > 1400) max = 4;
    if (draft.base && max < 2) max = 2;
    const count = nextInt(state, draft.base ? 1 : 0, max);
    state = count.state;
    let placed = 0;
    const riseRoll = nextInt(state, 2, 3);
    state = riseRoll.state;
    const zShift = nextInt(state, 0, Math.max(0, box.h - 1));
    state = zShift.state;
    const xShift = nextInt(state, 0, Math.max(0, box.w - 1));
    state = xShift.state;
    for (const [w, h] of footprints) {
      if (placed >= count.value) break;
      if (box.w < w || box.h < h) continue;
      for (let zStep = 0; zStep <= box.maxZ - box.minZ - h + 1 && placed < count.value; zStep++) {
        const z = box.minZ + ((zStep + zShift.value) % (box.maxZ - box.minZ - h + 2));
        for (let xStep = 0; xStep <= box.maxX - box.minX - w + 1 && placed < count.value; xStep++) {
          const x = box.minX + ((xStep + xShift.value) % (box.maxX - box.minX - w + 2));
          const ground = flatHeight(grid, draft.id, x, z, w, h);
          if (ground === null) continue;
          const top = ground + riseRoll.value;
          if (top > 6) continue;
          if (!stampBlock(grid, { x, z, w, h, height: top }, ROOF)) continue;
          paveToward(grid, draft.id, x, z, w, h);
          placed += 1;
        }
      }
    }
    if (draft.base && placed === 0) return { state, ok: false, reason: "the base has no house" };
  }
  return { state, ok: true, reason: "" };
}

function paveToward(grid: Grid, id: number, x: number, z: number, w: number, h: number): void {
  const target = findTarget(grid, id, x, z, w, h);
  if (!target) return;
  let cx = x + Math.floor(w / 2);
  let cz = z + h;
  if (cz >= WORLD_DEPTH || grid.island[cz * WORLD_WIDTH + cx] !== id + 1) {
    cx = x + w;
    cz = z + Math.floor(h / 2);
  }
  let guard = 0;
  while ((cx !== target.x || cz !== target.z) && guard < 240) {
    guard += 1;
    const stepX = cx === target.x ? 0 : target.x > cx ? 1 : -1;
    const stepZ = cz === target.z ? 0 : target.z > cz ? 1 : -1;
    const horizontal = Math.abs(target.x - cx) >= Math.abs(target.z - cz);
    const nx = horizontal ? cx + stepX : cx;
    const nz = horizontal ? cz : cz + stepZ;
    if (!roadCell(grid, id, nx, nz, grid.height[cz * WORLD_WIDTH + cx] ?? 0)) break;
    const index = nz * WORLD_WIDTH + nx;
    if (grid.surface[index] === GRASS || grid.surface[index] === SAND) grid.surface[index] = ROAD;
    cx = nx;
    cz = nz;
  }
}

function findTarget(grid: Grid, id: number, x: number, z: number, w: number, h: number): { x: number; z: number } | null {
  let best: { x: number; z: number } | null = null;
  let bestDist = Infinity;
  const originX = x + Math.floor(w / 2);
  const originZ = z + Math.floor(h / 2);
  for (let cz = 0; cz < WORLD_DEPTH; cz++) {
    for (let cx = 0; cx < WORLD_WIDTH; cx++) {
      const index = cz * WORLD_WIDTH + cx;
      if (grid.island[index] !== id + 1) continue;
      if (grid.surface[index] !== WHITE && grid.surface[index] !== ROOF) continue;
      if (cx >= x && cx < x + w && cz >= z && cz < z + h) continue;
      const distance = dist2(cx, cz, originX, originZ);
      if (distance < bestDist) {
        bestDist = distance;
        best = { x: cx, z: cz };
      }
    }
  }
  return best;
}

function roadCell(grid: Grid, id: number, x: number, z: number, fromHeight: number): boolean {
  if (x < 0 || z < 0 || x >= WORLD_WIDTH || z >= WORLD_DEPTH) return false;
  const index = z * WORLD_WIDTH + x;
  if (grid.island[index] !== id + 1) return false;
  const surface = grid.surface[index] ?? 0;
  if (surface === ROOF || surface === WHITE) return true;
  if (surface !== GRASS && surface !== SAND && surface !== ROAD) return false;
  const height = grid.height[index] ?? 0;
  const delta = height > fromHeight ? height - fromHeight : fromHeight - height;
  return delta <= 1;
}

function placeTrees(grid: Grid, drafts: readonly Draft[], state: RngState): { state: RngState; trees: TreeObstacle[] } {
  const trees: TreeObstacle[] = [];
  const kinds = ["smrk_a", "smrk_b", "smrk_c"] as const;
  for (const draft of drafts) {
    const box = measure(grid, draft.id);
    if (!box) continue;
    const goal = Math.floor(box.area / 55);
    let planted = 0;
    let guard = 0;
    while (planted < goal && guard < goal * 6 + 10) {
      guard += 1;
      const x = nextInt(state, box.minX, box.maxX);
      state = x.state;
      const z = nextInt(state, box.minZ, box.maxZ);
      state = z.state;
      const spread = nextInt(state, 2, 4);
      state = spread.state;
      for (let dz = -spread.value; dz <= spread.value; dz++) {
        for (let dx = -spread.value; dx <= spread.value; dx++) {
          if (dx * dx + dz * dz > spread.value * spread.value) continue;
          const tx = x.value + dx;
          const tz = z.value + dz;
          if (!treeCell(grid, tx, tz)) continue;
          const index = tz * WORLD_WIDTH + tx;
          const ground = grid.height[index] ?? 0;
          let type = "topol";
          if (ground > 2) {
            const kind = nextInt(state, 0, kinds.length - 1);
            state = kind.state;
            type = kinds[kind.value] ?? "smrk_a";
          }
          trees.push({ type, x: tx, z: tz, base: ground, top: ground + 3 });
          grid.surface[index] = grid.surface[index] === SAND ? SAND : GRASS;
          planted += 1;
          if (planted >= goal) break;
        }
        if (planted >= goal) break;
      }
    }
  }
  trees.sort((a, b) => a.z - b.z || a.x - b.x || (a.type < b.type ? -1 : 1));
  return { state, trees };
}

function treeCell(grid: Grid, x: number, z: number): boolean {
  if (x < 0 || z < 0 || x >= WORLD_WIDTH || z >= WORLD_DEPTH) return false;
  const index = z * WORLD_WIDTH + x;
  const surface = grid.surface[index] ?? 0;
  if (surface !== GRASS && surface !== SAND) return false;
  if (shelf(grid, x, z)) return false;
  return true;
}

function shelf(grid: Grid, x: number, z: number): boolean {
  const height = grid.height[z * WORLD_WIDTH + x] ?? 0;
  const neighbors = [
    [x, z - 1],
    [x, z + 1],
    [x + 1, z],
    [x - 1, z],
  ] as const;
  for (const [nx, nz] of neighbors) {
    const other = readLand(grid, nx, nz);
    if (other.land && other.height === height + 1) return true;
  }
  return false;
}

function placePillars(grid: Grid, state: RngState): { state: RngState } {
  const count = nextInt(state, 0, 3);
  state = count.state;
  let placed = 0;
  let guard = 0;
  while (placed < count.value && guard < 200) {
    guard += 1;
    const x = nextInt(state, 2, WORLD_WIDTH - 3);
    state = x.state;
    const z = nextInt(state, 2, WORLD_DEPTH - 3);
    state = z.state;
    const index = z.value * WORLD_WIDTH + x.value;
    if (grid.surface[index] !== GRASS) continue;
    const ground = grid.height[index] ?? 0;
    if (ground < 4) continue;
    const roll = nextInt(state, 6, 7);
    state = roll.state;
    const top = roll.value;
    if (top - ground > 3) continue;
    if (!pillarFits(grid, x.value, z.value, top)) continue;
    grid.surface[index] = WHITE;
    grid.height[index] = top;
    placed += 1;
  }
  return { state };
}

function pillarFits(grid: Grid, x: number, z: number, top: number): boolean {
  const around = [
    [x, z - 1],
    [x, z + 1],
    [x + 1, z],
    [x - 1, z],
    [x + 1, z - 1],
    [x - 1, z - 1],
    [x + 1, z + 1],
    [x - 1, z + 1],
  ] as const;
  for (const [nx, nz] of around) {
    const other = readLand(grid, nx, nz);
    if (!other.land || other.height < top - 3) return false;
    if (grid.surface[nz * WORLD_WIDTH + nx] === WHITE) return false;
  }
  const savedSurface = grid.surface[z * WORLD_WIDTH + x] ?? 0;
  const savedHeight = grid.height[z * WORLD_WIDTH + x] ?? 0;
  grid.surface[z * WORLD_WIDTH + x] = WHITE;
  grid.height[z * WORLD_WIDTH + x] = top;
  let ok = true;
  for (const [nx, nz] of around) {
    const height = grid.height[nz * WORLD_WIDTH + nx] ?? 0;
    if (cellThin(grid, nx, nz, height) || cellSlope(grid, nx, nz, height)) ok = false;
  }
  grid.surface[z * WORLD_WIDTH + x] = savedSurface;
  grid.height[z * WORLD_WIDTH + x] = savedHeight;
  return ok;
}

function placeNames(grid: Grid, drafts: readonly Draft[], trees: readonly TreeObstacle[], state: RngState): { state: RngState; names: string[] } {
  return nameIslands(state, islandProfiles(grid, drafts, trees));
}

function islandProfiles(grid: Grid, drafts: readonly Draft[], trees: readonly TreeObstacle[]): IslandProfile[] {
  const points = new Map<number, { x: number; z: number }[]>();
  const area = new Map<number, number>();
  const sand = new Map<number, number>();
  const maxHeight = new Map<number, number>();
  const box = new Map<number, { minX: number; maxX: number; minZ: number; maxZ: number }>();
  for (let z = 0; z < WORLD_DEPTH; z++) {
    for (let x = 0; x < WORLD_WIDTH; x++) {
      const index = z * WORLD_WIDTH + x;
      const code = grid.island[index] ?? 0;
      if (code === 0) continue;
      const id = code - 1;
      const list = points.get(id);
      if (list) list.push({ x, z });
      else points.set(id, [{ x, z }]);
      area.set(id, (area.get(id) ?? 0) + 1);
      if ((grid.surface[index] ?? 0) === SAND) sand.set(id, (sand.get(id) ?? 0) + 1);
      const height = grid.height[index] ?? 0;
      if (height > (maxHeight.get(id) ?? 0)) maxHeight.set(id, height);
      const frame = box.get(id);
      if (!frame) box.set(id, { minX: x, maxX: x, minZ: z, maxZ: z });
      else {
        if (x < frame.minX) frame.minX = x;
        if (x > frame.maxX) frame.maxX = x;
        if (z < frame.minZ) frame.minZ = z;
        if (z > frame.maxZ) frame.maxZ = z;
      }
    }
  }
  const bays = countBays(grid);
  const houses = countHouses(grid);
  const treeCount = new Map<number, number>();
  for (const tree of trees) {
    const index = tree.z * WORLD_WIDTH + tree.x;
    const code = grid.island[index] ?? 0;
    if (code === 0) continue;
    const id = code - 1;
    treeCount.set(id, (treeCount.get(id) ?? 0) + 1);
  }
  return drafts.map((draft) => {
    const cells = area.get(draft.id) ?? 0;
    const frame = box.get(draft.id);
    const width = frame ? frame.maxX - frame.minX + 1 : 1;
    const depth = frame ? frame.maxZ - frame.minZ + 1 : 1;
    const long = width > depth ? width : depth;
    const short = width > depth ? depth : width;
    const hull = polygonArea(convexHull(points.get(draft.id) ?? []));
    const grown = treeCount.get(draft.id) ?? 0;
    return {
      id: draft.id,
      cluster: draft.cluster,
      base: draft.base,
      area: cells,
      aspect: long / Math.max(1, short),
      hullRatio: hull > 1 ? cells / hull : 1,
      bays: bays.get(draft.id) ?? 0,
      maxHeight: maxHeight.get(draft.id) ?? 1,
      sandRatio: cells > 0 ? (sand.get(draft.id) ?? 0) / cells : 0,
      treeDensity: cells > 0 ? grown / cells : 0,
      houses: houses.get(draft.id) ?? 0,
    };
  });
}

function countBays(grid: Grid): Map<number, number> {
  const bays = new Map<number, number>();
  for (let z = 0; z < WORLD_DEPTH; z++) {
    for (let x = 0; x < WORLD_WIDTH; x++) {
      const index = z * WORLD_WIDTH + x;
      if ((grid.island[index] ?? 0) !== 0) continue;
      const ortho = new Map<number, number>();
      const around = new Map<number, number>();
      const sides = [
        [0, -1, true],
        [0, 1, true],
        [-1, 0, true],
        [1, 0, true],
        [-1, -1, false],
        [1, -1, false],
        [-1, 1, false],
        [1, 1, false],
      ] as const;
      for (const [dx, dz, orthogonal] of sides) {
        const nx = x + dx;
        const nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= WORLD_WIDTH || nz >= WORLD_DEPTH) continue;
        const code = grid.island[nz * WORLD_WIDTH + nx] ?? 0;
        if (code === 0) continue;
        around.set(code, (around.get(code) ?? 0) + 1);
        if (orthogonal) ortho.set(code, (ortho.get(code) ?? 0) + 1);
      }
      for (const [code, count] of around) {
        const enclosed = (ortho.get(code) ?? 0) >= 3 || (count >= 6 && (ortho.get(code) ?? 0) >= 2);
        if (!enclosed) continue;
        const id = code - 1;
        bays.set(id, (bays.get(id) ?? 0) + 1);
      }
    }
  }
  return bays;
}

function countHouses(grid: Grid): Map<number, number> {
  const houses = new Map<number, number>();
  const seen = new Uint8Array(grid.surface.length);
  for (let index = 0; index < grid.surface.length; index++) {
    if ((grid.surface[index] ?? 0) !== ROOF || seen[index]) continue;
    const code = grid.island[index] ?? 0;
    if (code === 0) continue;
    const id = code - 1;
    houses.set(id, (houses.get(id) ?? 0) + 1);
    const stack = [index];
    seen[index] = 1;
    while (stack.length > 0) {
      const current = stack.pop() ?? 0;
      const x = current % WORLD_WIDTH;
      const z = (current - x) / WORLD_WIDTH;
      const neighbors = [x > 0 ? current - 1 : -1, x + 1 < WORLD_WIDTH ? current + 1 : -1, z > 0 ? current - WORLD_WIDTH : -1, z + 1 < WORLD_DEPTH ? current + WORLD_WIDTH : -1];
      for (const neighbor of neighbors) {
        if (neighbor < 0 || seen[neighbor] || (grid.surface[neighbor] ?? 0) !== ROOF) continue;
        seen[neighbor] = 1;
        stack.push(neighbor);
      }
    }
  }
  return houses;
}

function convexHull(points: readonly { x: number; z: number }[]): { x: number; z: number }[] {
  const sorted = points.slice().sort((a, b) => a.x - b.x || a.z - b.z);
  if (sorted.length <= 1) return sorted.slice();
  const lower: { x: number; z: number }[] = [];
  for (const point of sorted) {
    while (lower.length >= 2 && hullCross(lower[lower.length - 2]!, lower[lower.length - 1]!, point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper: { x: number; z: number }[] = [];
  for (let index = sorted.length - 1; index >= 0; index--) {
    const point = sorted[index]!;
    while (upper.length >= 2 && hullCross(upper[upper.length - 2]!, upper[upper.length - 1]!, point) <= 0) upper.pop();
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function hullCross(origin: { x: number; z: number }, a: { x: number; z: number }, b: { x: number; z: number }): number {
  return (a.x - origin.x) * (b.z - origin.z) - (a.z - origin.z) * (b.x - origin.x);
}

function polygonArea(points: readonly { x: number; z: number }[]): number {
  let sum = 0;
  for (let index = 0; index < points.length; index++) {
    const next = points[(index + 1) % points.length];
    const point = points[index];
    if (!point || !next) continue;
    sum += point.x * next.z - next.x * point.z;
  }
  return sum < 0 ? -sum / 2 : sum / 2;
}

function distances(grid: Grid): Int16Array {
  const dist = new Int16Array(grid.height.length);
  dist.fill(-1);
  const queue: number[] = [];
  for (let z = 0; z < WORLD_DEPTH; z++) {
    for (let x = 0; x < WORLD_WIDTH; x++) {
      const index = z * WORLD_WIDTH + x;
      if (grid.surface[index] === 0) continue;
      if (edgeOfIsland(grid, x, z)) {
        dist[index] = 1;
        queue.push(index);
      }
    }
  }
  let head = 0;
  while (head < queue.length) {
    const index = queue[head++] ?? 0;
    const id = grid.island[index] ?? 0;
    const next = (dist[index] ?? 0) + 1;
    const x = index % WORLD_WIDTH;
    const z = (index - x) / WORLD_WIDTH;
    const neighbors = [index - 1, index + 1, index - WORLD_WIDTH, index + WORLD_WIDTH];
    const open = [x > 0, x + 1 < WORLD_WIDTH, z > 0, z + 1 < WORLD_DEPTH];
    for (let side = 0; side < neighbors.length; side++) {
      if (!open[side]) continue;
      const neighbor = neighbors[side] ?? 0;
      if (grid.island[neighbor] !== id || dist[neighbor] !== -1) continue;
      dist[neighbor] = next;
      queue.push(neighbor);
    }
  }
  return dist;
}

function edgeOfIsland(grid: Grid, x: number, z: number): boolean {
  const id = grid.island[z * WORLD_WIDTH + x] ?? 0;
  if (x === 0 || (grid.island[z * WORLD_WIDTH + x - 1] ?? 0) !== id) return true;
  if (x + 1 >= WORLD_WIDTH || (grid.island[z * WORLD_WIDTH + x + 1] ?? 0) !== id) return true;
  if (z === 0 || (grid.island[(z - 1) * WORLD_WIDTH + x] ?? 0) !== id) return true;
  if (z + 1 >= WORLD_DEPTH || (grid.island[(z + 1) * WORLD_WIDTH + x] ?? 0) !== id) return true;
  return false;
}

function stampRelief(grid: Grid, draft: Draft, state: RngState, coast: Int16Array): RngState {
  const box = measure(grid, draft.id);
  if (!box) return state;
  if (draft.form === "crescent") return state;
  if (draft.form === "sand") {
    for (let z = box.minZ; z <= box.maxZ; z++) {
      for (let x = box.minX; x <= box.maxX; x++) {
        const index = z * WORLD_WIDTH + x;
        if (grid.island[index] !== draft.id + 1) continue;
        grid.height[index] = 1;
      }
    }
    const knob = nextInt(state, 0, 1);
    state = knob.state;
    if (knob.value === 1) {
      const radius = 3;
      for (let z = draft.z - radius; z <= draft.z + radius; z++) {
        for (let x = draft.x - radius; x <= draft.x + radius; x++) {
          if (x < 0 || z < 0 || x >= WORLD_WIDTH || z >= WORLD_DEPTH) continue;
          const index = z * WORLD_WIDTH + x;
          if (grid.island[index] !== draft.id + 1) continue;
          if ((coast[index] ?? 0) < 3) continue;
          const dx = x - draft.x;
          const dz = z - draft.z;
          const chebyshev = (dx < 0 ? -dx : dx) > (dz < 0 ? -dz : dz) ? (dx < 0 ? -dx : dx) : (dz < 0 ? -dz : dz);
          if (chebyshev <= radius) grid.height[index] = 2;
        }
      }
    }
    return state;
  }
  const facing = nextInt(state, 0, 7);
  state = facing.state;
  const crown = nextInt(state, 3, draft.base ? 5 : 4);
  state = crown.state;
  // Klín planiny k moři po blocích 2×2, ať terasa není jednobuňková.
  for (let z = box.minZ; z <= box.maxZ; z += 2) {
    for (let x = box.minX; x <= box.maxX; x += 2) {
      const dx = x - draft.x;
      const dz = z - draft.z;
      const turn = sectorDistance(sector(dx, dz), facing.value);
      let height = 1;
      if (turn === 0) height = crown.value;
      else if (turn === 1) height = crown.value > 3 ? crown.value - 1 : 2;
      let shore = false;
      for (let dzBlock = 0; dzBlock < 2 && !shore; dzBlock++) {
        for (let dxBlock = 0; dxBlock < 2; dxBlock++) {
          const nx = x + dxBlock;
          const nz = z + dzBlock;
          if (nx >= WORLD_WIDTH || nz >= WORLD_DEPTH) continue;
          if ((coast[nz * WORLD_WIDTH + nx] ?? 0) <= 1) shore = true;
        }
      }
      if (shore && height > 3) height = 3;
      for (let dzBlock = 0; dzBlock < 2; dzBlock++) {
        for (let dxBlock = 0; dxBlock < 2; dxBlock++) {
          const nx = x + dxBlock;
          const nz = z + dzBlock;
          if (nx >= WORLD_WIDTH || nz >= WORLD_DEPTH) continue;
          const index = nz * WORLD_WIDTH + nx;
          if (grid.island[index] !== draft.id + 1) continue;
          if (height > (grid.height[index] ?? 0)) grid.height[index] = height;
        }
      }
    }
  }
  const spot = inlandSpot(grid, draft.id, box, coast, state, [], draft.x, draft.z, facing.value);
  state = spot.state;
  if (spot.cell) {
    const top = nextInt(state, 3, draft.base ? 5 : 4);
    state = top.state;
    const clearance = (coast[spot.cell.z * WORLD_WIDTH + spot.cell.x] ?? 0) - 1;
    const maxInner = clearance - (top.value - 1) * 2;
    const wanted = nextInt(state, 3, 6);
    state = wanted.state;
    const inner = wanted.value < maxInner ? wanted.value : maxInner;
    if (inner >= 3) stampMesa(grid, draft.id, spot.cell.x, spot.cell.z, inner, top.value);
  }
  return state;
}

function sectorDistance(face: number, facing: number): number {
  let delta = face - facing;
  if (delta < 0) delta += 8;
  if (delta > 4) delta = 8 - delta;
  return delta;
}

function inlandSpot(
  grid: Grid,
  id: number,
  box: { minX: number; maxX: number; minZ: number; maxZ: number },
  coast: Int16Array,
  state: RngState,
  used: readonly { x: number; z: number }[],
  originX = 0,
  originZ = 0,
  lowFacing = -1,
): { state: RngState; cell: { x: number; z: number } | null } {
  const found: { x: number; z: number }[] = [];
  for (let z = box.minZ; z <= box.maxZ && found.length < 24; z += 2) {
    for (let x = box.minX; x <= box.maxX && found.length < 24; x += 2) {
      const index = z * WORLD_WIDTH + x;
      if (grid.island[index] !== id + 1) continue;
      if ((coast[index] ?? 0) < 6) continue;
      if (lowFacing >= 0 && sectorDistance(sector(x - originX, z - originZ), lowFacing) < 3) continue;
      if (used.some((other) => dist2(other.x, other.z, x, z) < 36)) continue;
      found.push({ x, z });
    }
  }
  if (found.length === 0) return { state, cell: null };
  const roll = nextInt(state, 0, found.length - 1);
  return { state: roll.state, cell: found[roll.value] ?? null };
}

function stampMesa(grid: Grid, id: number, cx: number, cz: number, inner: number, top: number): void {
  const reach = inner + (top - 1) * 2;
  for (let z = cz - reach; z <= cz + reach; z++) {
    for (let x = cx - reach; x <= cx + reach; x++) {
      if (x < 0 || z < 0 || x >= WORLD_WIDTH || z >= WORLD_DEPTH) continue;
      const index = z * WORLD_WIDTH + x;
      if (grid.island[index] !== id + 1) continue;
      const dx = x - cx;
      const dz = z - cz;
      const chebyshev = (dx < 0 ? -dx : dx) > (dz < 0 ? -dz : dz) ? (dx < 0 ? -dx : dx) : (dz < 0 ? -dz : dz);
      const drop = Math.floor(chebyshev / 2);
      const height = top - drop;
      if (height < 2) continue;
      if (height > (grid.height[index] ?? 0)) grid.height[index] = height;
    }
  }
}

function repairHeights(grid: Grid): boolean {
  const cells: number[] = [];
  for (let index = 0; index < grid.surface.length; index++) {
    if (grid.surface[index] !== 0) cells.push(index);
  }
  let settled = false;
  for (let pass = 0; pass < 28; pass++) {
    if (!relaxHeights(grid, cells, true)) {
      settled = true;
      break;
    }
  }
  if (!settled) return false;
  for (const index of cells) {
    if (grid.surface[index] === 0) continue;
    const x = index % WORLD_WIDTH;
    const z = (index - x) / WORLD_WIDTH;
    const height = grid.height[index] ?? 0;
    if (!isTower(grid, x, z) && (height < 1 || height > 6)) return false;
    if (cellSlope(grid, x, z, height)) return false;
    if (!isTower(grid, x, z) && cellThin(grid, x, z, height)) return false;
  }
  return true;
}

function relaxHeights(grid: Grid, cells: readonly number[], deleteSpits: boolean): boolean {
  const previous = grid.height.slice();
  const clear: number[] = [];
  let changed = false;
  for (const index of cells) {
    if (grid.surface[index] === 0) continue;
    const x = index % WORLD_WIDTH;
    const z = (index - x) / WORLD_WIDTH;
    let height = previous[index] ?? 1;
    const neighbors = fourPrevious(previous, grid, x, z);
    for (const neighbor of neighbors) {
      const value = neighbor.land ? neighbor.height : 0;
      if (height > value + 3) height = value + 3;
    }
    if (height < 1) height = 1;
    if (height > 6) height = 6;
    if (pairThin(neighbors, height)) {
      let lower = 0;
      let found = false;
      for (const neighbor of neighbors) {
        if (!neighbor.land || neighbor.height >= height) continue;
        found = true;
        if (neighbor.height > lower) lower = neighbor.height;
      }
      if (found) height = lower < 1 ? 1 : lower;
      else if (deleteSpits) clear.push(index);
    }
    if (height !== (previous[index] ?? 0)) {
      grid.height[index] = height;
      changed = true;
    }
  }
  for (const index of clear) {
    if (grid.surface[index] === 0) continue;
    grid.surface[index] = 0;
    grid.island[index] = 0;
    grid.height[index] = 0;
    changed = true;
  }
  return changed;
}

function fourPrevious(previous: Uint8Array, grid: Grid, x: number, z: number): { land: boolean; height: number }[] {
  return [
    previousLand(previous, grid, x, z - 1),
    previousLand(previous, grid, x, z + 1),
    previousLand(previous, grid, x + 1, z),
    previousLand(previous, grid, x - 1, z),
  ];
}

function previousLand(previous: Uint8Array, grid: Grid, x: number, z: number): { land: boolean; height: number } {
  if (x < 0 || z < 0 || x >= WORLD_WIDTH || z >= WORLD_DEPTH) return { land: false, height: 0 };
  const index = z * WORLD_WIDTH + x;
  if (grid.surface[index] === 0 || grid.island[index] === 0) return { land: false, height: 0 };
  return { land: true, height: previous[index] ?? 0 };
}

function pairThin(neighbors: readonly { land: boolean; height: number }[], height: number): boolean {
  const different = (cell: { land: boolean; height: number } | undefined) => !cell?.land || cell.height !== height;
  return (different(neighbors[0]) && different(neighbors[1])) || (different(neighbors[2]) && different(neighbors[3]));
}

function isTower(grid: Grid, x: number, z: number): boolean {
  const index = z * WORLD_WIDTH + x;
  const height = grid.height[index] ?? 0;
  if (grid.surface[index] !== WHITE || (height !== 6 && height !== 7)) return false;
  return !orthogonalWhite(grid, x, z);
}

function orthogonalWhite(grid: Grid, x: number, z: number): boolean {
  const cells = [
    [x, z - 1],
    [x, z + 1],
    [x + 1, z],
    [x - 1, z],
  ] as const;
  for (const [nx, nz] of cells) {
    if (nx < 0 || nz < 0 || nx >= WORLD_WIDTH || nz >= WORLD_DEPTH) continue;
    if (grid.surface[nz * WORLD_WIDTH + nx] === WHITE) return true;
  }
  return false;
}

function fillSmallHoles(grid: Grid, maxSize: number): void {
  const seen = new Uint8Array(grid.height.length);
  const queue: number[] = [];
  for (let x = 0; x < WORLD_WIDTH; x++) {
    pushSea(grid, seen, queue, x);
    pushSea(grid, seen, queue, (WORLD_DEPTH - 1) * WORLD_WIDTH + x);
  }
  for (let z = 0; z < WORLD_DEPTH; z++) {
    pushSea(grid, seen, queue, z * WORLD_WIDTH);
    pushSea(grid, seen, queue, z * WORLD_WIDTH + WORLD_WIDTH - 1);
  }
  let head = 0;
  while (head < queue.length) {
    const index = queue[head++] ?? 0;
    const x = index % WORLD_WIDTH;
    const z = (index - x) / WORLD_WIDTH;
    if (x > 0) pushSea(grid, seen, queue, index - 1);
    if (x + 1 < WORLD_WIDTH) pushSea(grid, seen, queue, index + 1);
    if (z > 0) pushSea(grid, seen, queue, index - WORLD_WIDTH);
    if (z + 1 < WORLD_DEPTH) pushSea(grid, seen, queue, index + WORLD_WIDTH);
  }
  for (let index = 0; index < grid.island.length; index++) {
    if (grid.island[index] !== 0 || seen[index]) continue;
    const hole: number[] = [];
    const stack = [index];
    seen[index] = 1;
    while (stack.length > 0) {
      const current = stack.pop() ?? 0;
      hole.push(current);
      const x = current % WORLD_WIDTH;
      const z = (current - x) / WORLD_WIDTH;
      const neighbors = [x > 0 ? current - 1 : -1, x + 1 < WORLD_WIDTH ? current + 1 : -1, z > 0 ? current - WORLD_WIDTH : -1, z + 1 < WORLD_DEPTH ? current + WORLD_WIDTH : -1];
      for (const neighbor of neighbors) {
        if (neighbor < 0 || seen[neighbor] || grid.island[neighbor] !== 0) continue;
        seen[neighbor] = 1;
        stack.push(neighbor);
      }
    }
    if (hole.length > maxSize) continue;
    for (const current of hole) {
      const x = current % WORLD_WIDTH;
      const z = (current - x) / WORLD_WIDTH;
      const neighbors = fourLands(grid, x, z).filter((cell) => cell.land);
      if (neighbors.length === 0) continue;
      const donor = neighbors[0];
      if (!donor) continue;
      grid.island[current] = donor.id;
      grid.surface[current] = GRASS;
      grid.height[current] = donor.height;
    }
  }
}

function pushSea(grid: Grid, seen: Uint8Array, queue: number[], index: number): void {
  if (seen[index] || grid.island[index] !== 0) return;
  seen[index] = 1;
  queue.push(index);
}

function removeIsolated(grid: Grid): void {
  let changed = true;
  while (changed) {
    changed = false;
    for (let z = 0; z < WORLD_DEPTH; z++) {
      for (let x = 0; x < WORLD_WIDTH; x++) {
        const index = z * WORLD_WIDTH + x;
        const id = grid.island[index] ?? 0;
        if (id === 0) continue;
        const neighbors = fourIds(grid, x, z);
        if (neighbors.some((value) => value === id)) continue;
        grid.island[index] = 0;
        grid.surface[index] = 0;
        grid.height[index] = 0;
        changed = true;
      }
    }
  }
}

function keepLargest(grid: Grid, id: number): boolean {
  const code = id + 1;
  const seen = new Uint8Array(grid.island.length);
  let largest: number[] = [];
  for (let index = 0; index < grid.island.length; index++) {
    if (grid.island[index] !== code || seen[index]) continue;
    const component: number[] = [];
    const stack = [index];
    seen[index] = 1;
    while (stack.length > 0) {
      const current = stack.pop() ?? 0;
      component.push(current);
      const x = current % WORLD_WIDTH;
      const z = (current - x) / WORLD_WIDTH;
      const neighbors = [x > 0 ? current - 1 : -1, x + 1 < WORLD_WIDTH ? current + 1 : -1, z > 0 ? current - WORLD_WIDTH : -1, z + 1 < WORLD_DEPTH ? current + WORLD_WIDTH : -1];
      for (const neighbor of neighbors) {
        if (neighbor < 0 || seen[neighbor] || grid.island[neighbor] !== code) continue;
        seen[neighbor] = 1;
        stack.push(neighbor);
      }
    }
    if (component.length > largest.length) largest = component;
  }
  if (largest.length === 0) return false;
  const keep = new Uint8Array(grid.island.length);
  for (const index of largest) keep[index] = 1;
  for (let index = 0; index < grid.island.length; index++) {
    if (grid.island[index] === code && !keep[index]) {
      grid.island[index] = 0;
      grid.surface[index] = 0;
      grid.height[index] = 0;
    }
  }
  return true;
}

function measure(grid: Grid, id: number): { area: number; minX: number; maxX: number; minZ: number; maxZ: number; w: number; h: number } | null {
  const code = id + 1;
  let area = 0;
  let minX = WORLD_WIDTH;
  let maxX = -1;
  let minZ = WORLD_DEPTH;
  let maxZ = -1;
  for (let z = 0; z < WORLD_DEPTH; z++) {
    for (let x = 0; x < WORLD_WIDTH; x++) {
      if (grid.island[z * WORLD_WIDTH + x] !== code) continue;
      area += 1;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
  }
  if (area === 0) return null;
  return { area, minX, maxX, minZ, maxZ, w: maxX - minX + 1, h: maxZ - minZ + 1 };
}

function cellThin(grid: Grid, x: number, z: number, height: number): boolean {
  return cellThinRead(fourLands(grid, x, z), height);
}

function cellThinRead(neighbors: readonly { land: boolean; height: number }[], height: number): boolean {
  const different = (cell: { land: boolean; height: number } | undefined) => !cell?.land || cell.height !== height;
  return (different(neighbors[0]) && different(neighbors[1])) || (different(neighbors[2]) && different(neighbors[3]));
}

function cellSlope(grid: Grid, x: number, z: number, height: number): boolean {
  for (const neighbor of fourLands(grid, x, z)) {
    const other = neighbor.land ? neighbor.height : 0;
    if (height - other > 3 || other - height > 3) return true;
  }
  return false;
}

function fourLands(grid: Grid, x: number, z: number): { land: boolean; height: number; id: number }[] {
  return [
    readLand(grid, x, z - 1),
    readLand(grid, x, z + 1),
    readLand(grid, x + 1, z),
    readLand(grid, x - 1, z),
  ];
}

function fourIds(grid: Grid, x: number, z: number): number[] {
  return [x, z - 1, x, z + 1, x + 1, z, x - 1, z].filter((_, index) => index % 2 === 1).length
    ? [
        z > 0 ? grid.island[(z - 1) * WORLD_WIDTH + x] ?? 0 : 0,
        z + 1 < WORLD_DEPTH ? grid.island[(z + 1) * WORLD_WIDTH + x] ?? 0 : 0,
        x + 1 < WORLD_WIDTH ? grid.island[z * WORLD_WIDTH + x + 1] ?? 0 : 0,
        x > 0 ? grid.island[z * WORLD_WIDTH + x - 1] ?? 0 : 0,
      ]
    : [];
}

function readLand(grid: Grid, x: number, z: number): { land: boolean; height: number; id: number } {
  if (x < 0 || z < 0 || x >= WORLD_WIDTH || z >= WORLD_DEPTH) return { land: false, height: 0, id: 0 };
  const index = z * WORLD_WIDTH + x;
  if (grid.surface[index] === 0 || grid.island[index] === 0) return { land: false, height: 0, id: 0 };
  return { land: true, height: grid.height[index] ?? 0, id: grid.island[index] ?? 0 };
}

function touchesSea(grid: Grid, x: number, z: number): boolean {
  return !readLand(grid, x, z - 1).land || !readLand(grid, x, z + 1).land || !readLand(grid, x + 1, z).land || !readLand(grid, x - 1, z).land;
}

function gentle(grid: Grid, x: number, z: number, height: number): boolean {
  for (const neighbor of fourLands(grid, x, z)) {
    if (neighbor.land && neighbor.height > height + 1) return false;
  }
  return true;
}

function shuffle(items: number[], state: RngState): RngState {
  for (let index = items.length - 1; index > 0; index--) {
    const roll = nextInt(state, 0, index);
    state = roll.state;
    const swap = items[index] ?? 0;
    items[index] = items[roll.value] ?? 0;
    items[roll.value] = swap;
  }
  return state;
}

function dist2(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
}

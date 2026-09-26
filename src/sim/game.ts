import type { GameCommand } from "./command.ts";
import {
  BASE_CELL_X,
  BASE_CELL_Z,
  CRASH_RESPAWN,
  FUEL_BURN,
  FUEL_MAX,
  FUEL_REFUEL,
  FUEL_THRUST,
  FUEL_WARN,
  GAME_SEED,
  ROUND_SECONDS,
  SCORE_CRATE,
  SCORE_PERSON,
  SCORE_SECOND,
  SIM_STEP,
  SPAWN_X,
  SPAWN_Z,
  START_LIVES,
  CRATE_GRAB,
  PERSON_GRAB,
  WINCH_HEIGHT,
  WINCH_RANGE,
  WINCH_SPEED,
  WINCH_TIME,
} from "./config.ts";
import { createStorm, inCycloneEye, stepStorm, stormDistance, stormPush, windStrength, type Storm } from "./cyclone.ts";
import { heliportIdAt, findHeliports, type Heliport, type HeliportMap } from "./heliports.ts";
import { horizontalSpeed, interpolateHeli, spawnHeli, stepHeli, type HeliState } from "./helicopter.ts";
import { advancePlane, launchPlane, overOpenWater, planeHits, planeWarning, randomPlaneGap, type Plane } from "./planes.ts";
import { deriveSeed, STREAM_CYCLONE, STREAM_PLANES } from "./rng.ts";
import type { LayoutMode } from "./placement.ts";
import { heightAt, type World } from "./world.ts";

export type GamePhase = "intro" | "play" | "end";
export type GameOutcome = "success" | "failure";
export type FailReason = "time" | "lives";

export type GameEvent =
  | { type: "pickup"; kind: "crate" | "person" }
  | { type: "crash" }
  | { type: "fuel-warning" }
  | { type: "refuel" }
  | { type: "win"; bonus: number }
  | { type: "lose"; reason: FailReason }
  | { type: "plane-warning" };

export interface WinchState {
  kind: "crate" | "person";
  index: number;
  /** Sekundy souvislého splnění podmínek. */
  elapsed: number;
}

export interface GameState {
  phase: GamePhase;
  paused: boolean;
  outcome: GameOutcome | null;
  failReason: FailReason | null;
  heli: HeliState;
  fuel: number;
  lives: number;
  timeLeft: number;
  score: number;
  crateScore: number;
  peopleScore: number;
  timeBonus: number;
  collectedCrates: boolean[];
  collectedPeople: boolean[];
  winch: WinchState | null;
  /** Události právě proběhlého kroku. Další krok frontu nahradí. */
  events: GameEvent[];
  heliports: Heliport[];
  heliportMask: Uint16Array;
  homeX: number;
  homeZ: number;
  baseX: number;
  baseZ: number;
  seed: number;
  /** Desítkové číslo mapy. Null je originál. */
  mapSeed: string | null;
  /** Verze generátoru. U originálu null. */
  generator: number | null;
  /** Proud cyklonu. Letadla mají vlastní. */
  rng: number;
  planeRng: number;
  layout: LayoutMode;
  storm: Storm;
  plane: Plane | null;
  planeCooldown: number;
  debug: boolean;
  god: boolean;
}

export interface GameView {
  phase: GamePhase;
  paused: boolean;
  outcome: GameOutcome | null;
  failReason: FailReason | null;
  heli: HeliState;
  fuel: number;
  timeLeft: number;
  crates: number;
  crateTotal: number;
  people: number;
  score: number;
  crateScore: number;
  peopleScore: number;
  timeBonus: number;
  lives: number;
  fuelWarning: boolean;
  /** 0 daleko od cyklonu, 1 v jeho jádru. */
  wind: number;
  storm: { x: number; z: number };
  plane: { x: number; y: number; z: number; dirX: number; dirZ: number; warning: boolean } | null;
  /** Text výstrahy letadla. */
  planeAlert: string | null;
  refueling: boolean;
  winch: (WinchState & { x: number; y: number; z: number; progress: number }) | null;
  collectedCrates: readonly boolean[];
  collectedPeople: readonly boolean[];
  heliports: readonly Heliport[];
  events: readonly GameEvent[];
  homeX: number;
  homeZ: number;
  seed: number;
  layout: LayoutMode;
  mapSeed: string | null;
  generator: number | null;
}

export interface CreateGameOptions {
  spawnX?: number;
  spawnZ?: number;
  baseX?: number;
  baseZ?: number;
  seed?: number;
  debug?: boolean;
  layout?: LayoutMode;
  mapSeed?: string | null;
  generator?: number | null;
}

export function createGame(world: World, options: CreateGameOptions = {}): GameState {
  const pads = findHeliports(world, options.baseX, options.baseZ);
  const home = homePosition(world, pads, options);
  const seed = options.seed ?? GAME_SEED;
  const spawned = createStorm(world, home.x, home.z, deriveSeed(seed, STREAM_CYCLONE));
  const gap = randomPlaneGap(deriveSeed(seed, STREAM_PLANES));
  return {
    phase: "intro",
    paused: false,
    outcome: null,
    failReason: null,
    heli: placeHome(spawnHeli(world), world, home.x, home.z),
    fuel: FUEL_MAX,
    lives: START_LIVES,
    timeLeft: ROUND_SECONDS,
    score: 0,
    crateScore: 0,
    peopleScore: 0,
    timeBonus: 0,
    collectedCrates: world.crates.map(() => false),
    collectedPeople: world.people.map(() => false),
    winch: null,
    events: [],
    heliports: pads.list,
    heliportMask: pads.mask,
    homeX: home.x,
    homeZ: home.z,
    baseX: options.baseX ?? BASE_CELL_X,
    baseZ: options.baseZ ?? BASE_CELL_Z,
    seed,
    mapSeed: options.mapSeed ?? null,
    generator: options.generator ?? null,
    rng: spawned.rng,
    planeRng: gap.rng,
    layout: options.layout ?? "original",
    storm: spawned.storm,
    plane: null,
    planeCooldown: gap.seconds,
    debug: options.debug === true,
    god: false,
  };
}

/** Celé sekundy, které hráč vidí na odpočtu. 600 je 10:00, těsně nad 599 pořád 10:00. */
export function wholeSecondsLeft(timeLeft: number): number {
  if (timeLeft <= 0) return 0;
  return Math.ceil(timeLeft - 1e-9);
}

export function formatClock(timeLeft: number): string {
  const whole = wholeSecondsLeft(timeLeft);
  const minutes = Math.floor(whole / 60);
  const seconds = whole % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function stepGame(state: GameState, command: GameCommand, world: World, dt = SIM_STEP): GameState {
  if (state.phase === "intro") {
    if (!command.confirm) return { ...state, events: [] };
    return { ...state, phase: "play", paused: false, events: [] };
  }
  if (state.phase === "end") {
    if (!command.confirm) return { ...state, events: [] };
    return createGame(world, {
      spawnX: state.homeX,
      spawnZ: state.homeZ,
      baseX: state.baseX,
      baseZ: state.baseZ,
      seed: state.seed,
      debug: state.debug,
      layout: state.layout,
      mapSeed: state.mapSeed,
      generator: state.generator,
    });
  }
  if (command.pause) return { ...state, paused: !state.paused, events: [] };
  if (state.paused) return { ...state, events: [] };
  if (state.debug && command.god) return { ...state, god: !state.god, events: [] };
  if (state.debug && command.fillFuel) return { ...state, fuel: FUEL_MAX, events: [] };
  if (state.debug && command.skipMinute) {
    const timeLeft = Math.max(0, state.timeLeft - 60);
    if (timeLeft <= 0) return finishFailure({ ...state, timeLeft, events: [] }, "time");
    return { ...state, timeLeft, events: [] };
  }
  if (state.debug && command.teleport) {
    const spot = nearestCrate(state, world);
    if (spot) {
      return {
        ...state,
        events: [],
        heli: {
          ...state.heli,
          x: spot.x,
          z: spot.z,
          y: heightAt(world, spot.x, spot.z) + 2,
          mode: "air",
          speed: 0,
          vy: 0,
          driftX: 0,
          driftZ: 0,
        },
      };
    }
  }

  const events: GameEvent[] = [];
  const onHeliport = (x: number, z: number) => heliportIdAt(world, state.heliportMask, x, z) > 0;
  const movedStorm = stepStorm(state.storm, world, state.rng, dt);
  const rng = movedStorm.rng;
  let planeRng = state.planeRng;
  const storm = movedStorm.storm;
  const push = stormPush(storm, state.heli.x, state.heli.z);
  const grounded = state.heli.mode !== "air";
  let heli = stepHeli(state.heli, command.flight, world, grounded ? { x: 0, z: 0 } : { x: push.x, z: push.z }, dt, {
    respawn: false,
    emptyTank: state.fuel <= 0,
    onHeliport,
    yawRate: grounded ? 0 : push.yaw,
  });
  if (heli.mode === "air" && inCycloneEye(stormDistance(storm, heli.x, heli.z))) {
    heli = { ...heli, mode: "crash", crashAge: 0, speed: 0, vy: 0, driftX: 0, driftZ: 0 };
  }
  let plane = state.plane;
  let planeCooldown = state.planeCooldown;
  const openWater = heli.mode === "air" && overOpenWater(world, heli.x, heli.z);
  if (openWater) planeCooldown -= dt;
  if (plane) {
    const next = advancePlane(plane, dt);
    if (next && planeHits(next, heli)) {
      heli = { ...heli, mode: "crash", crashAge: 0, speed: 0, vy: 0, driftX: 0, driftZ: 0 };
    }
    plane = next;
  } else if (openWater && planeCooldown <= 0) {
    const born = launchPlane(heli, storm, planeRng);
    const gap = randomPlaneGap(born.rng);
    planeRng = gap.rng;
    plane = advancePlane(born.plane, dt);
    planeCooldown = gap.seconds;
    events.push({ type: "plane-warning" });
  }
  let lives = state.lives;
  let winch = state.winch;
  if (state.heli.mode !== "crash" && heli.mode === "crash") {
    if (state.god) {
      heli = { ...state.heli, heading: heli.heading, view: heli.view, mode: "air", vy: 0, speed: 0 };
    } else {
      lives -= 1;
      winch = null;
      events.push({ type: "crash" });
    }
  }

  let fuel = state.fuel;
  let refueling = false;
  if (heli.mode === "air") {
    fuel -= FUEL_BURN * dt;
    if (command.flight.forward) fuel -= FUEL_THRUST * dt;
  } else if (heli.mode === "ground" && onHeliport(heli.x, heli.z)) {
    if (fuel < FUEL_MAX) {
      refueling = true;
      fuel = Math.min(FUEL_MAX, fuel + FUEL_REFUEL * dt);
    }
  }
  if (fuel < 0) fuel = 0;
  if (state.fuel >= FUEL_MAX * FUEL_WARN && fuel < FUEL_MAX * FUEL_WARN) events.push({ type: "fuel-warning" });
  if (refueling && !wasRefueling(state, world)) events.push({ type: "refuel" });

  let collectedCrates = state.collectedCrates;
  let collectedPeople = state.collectedPeople;
  let crateScore = state.crateScore;
  let peopleScore = state.peopleScore;
  let score = state.score;
  if (heli.mode !== "air") {
    winch = null;
  } else {
    const picked = updateWinch(state, heli, world, winch, dt);
    winch = picked.winch;
    if (picked.collected) {
      if (picked.collected.kind === "crate") {
        collectedCrates = state.collectedCrates.slice();
        collectedCrates[picked.collected.index] = true;
        crateScore += SCORE_CRATE;
        score += SCORE_CRATE;
      } else {
        collectedPeople = state.collectedPeople.slice();
        collectedPeople[picked.collected.index] = true;
        peopleScore += SCORE_PERSON;
        score += SCORE_PERSON;
      }
      events.push({ type: "pickup", kind: picked.collected.kind });
    }
  }

  const played: GameState = {
    ...state,
    heli,
    fuel,
    lives,
    winch,
    collectedCrates,
    collectedPeople,
    crateScore,
    peopleScore,
    score,
    events,
    rng,
    planeRng,
    storm,
    plane,
    planeCooldown,
  };

  if (landedWithCrates(played, world)) return finishSuccess(played);

  const timeLeft = Math.max(0, state.timeLeft - dt);
  if (timeLeft <= 0) return finishFailure({ ...played, timeLeft }, "time");

  if (heli.mode === "crash" && heli.crashAge >= CRASH_RESPAWN) {
    if (lives <= 0) return finishFailure({ ...played, timeLeft }, "lives");
    return {
      ...played,
      timeLeft,
      fuel: FUEL_MAX,
      winch: null,
      heli: placeHome(spawnHeli(world, heli.view), world, state.homeX, state.homeZ),
    };
  }

  return { ...played, timeLeft };
}

export function toView(state: GameState, world: World, events: readonly GameEvent[] = state.events): GameView {
  const winch = state.winch;
  let winchView: GameView["winch"] = null;
  if (winch) {
    const item = itemPosition(world, winch.kind, winch.index);
    if (item) {
      const base = heightAt(world, item.x, item.z);
      winchView = {
        ...winch,
        x: item.x,
        z: item.z,
        y: base + (state.heli.y - base) * Math.min(1, winch.elapsed / WINCH_TIME),
        progress: Math.min(1, winch.elapsed / WINCH_TIME),
      };
    }
  }
  return {
    phase: state.phase,
    paused: state.paused,
    outcome: state.outcome,
    failReason: state.failReason,
    heli: state.heli,
    fuel: state.fuel,
    timeLeft: state.timeLeft,
    crates: state.collectedCrates.filter(Boolean).length,
    crateTotal: state.collectedCrates.length,
    people: state.collectedPeople.filter(Boolean).length,
    score: state.score,
    crateScore: state.crateScore,
    peopleScore: state.peopleScore,
    timeBonus: state.timeBonus,
    lives: state.lives,
    fuelWarning: state.fuel < FUEL_MAX * FUEL_WARN,
    wind: windStrength(stormDistance(state.storm, state.heli.x, state.heli.z)),
    storm: { x: state.storm.x, z: state.storm.z },
    plane: state.plane
      ? {
          x: state.plane.x,
          y: state.plane.y,
          z: state.plane.z,
          dirX: state.plane.dirX,
          dirZ: state.plane.dirZ,
          warning: planeWarning(state.plane),
        }
      : null,
    planeAlert: state.plane && planeWarning(state.plane) ? "LETADLO" : null,
    refueling:
      state.phase === "play" &&
      state.heli.mode === "ground" &&
      heliportIdAt(world, state.heliportMask, state.heli.x, state.heli.z) > 0 &&
      state.fuel < FUEL_MAX,
    winch: winchView,
    collectedCrates: state.collectedCrates,
    collectedPeople: state.collectedPeople,
    heliports: state.heliports,
    events,
    homeX: state.homeX,
    homeZ: state.homeZ,
    seed: state.seed,
    layout: state.layout,
    mapSeed: state.mapSeed,
    generator: state.generator,
  };
}

export function interpolateGame(from: GameState, to: GameState, t: number): GameState {
  if (from.phase !== to.phase) return to;
  let winch = to.winch;
  if (from.winch && to.winch && from.winch.kind === to.winch.kind && from.winch.index === to.winch.index) {
    winch = { ...to.winch, elapsed: from.winch.elapsed + (to.winch.elapsed - from.winch.elapsed) * t };
  }
  const storm = {
    ...to.storm,
    x: from.storm.x + (to.storm.x - from.storm.x) * t,
    z: from.storm.z + (to.storm.z - from.storm.z) * t,
  };
  const plane = from.plane && to.plane
    ? {
        ...to.plane,
        x: from.plane.x + (to.plane.x - from.plane.x) * t,
        y: from.plane.y + (to.plane.y - from.plane.y) * t,
        z: from.plane.z + (to.plane.z - from.plane.z) * t,
      }
    : to.plane;
  return { ...to, winch, storm, plane, heli: interpolateHeli(from.heli, to.heli, t) };
}

function finishSuccess(state: GameState): GameState {
  const seconds = wholeSecondsLeft(state.timeLeft);
  const timeBonus = seconds * SCORE_SECOND;
  return {
    ...state,
    phase: "end",
    paused: false,
    outcome: "success",
    failReason: null,
    winch: null,
    timeBonus,
    score: state.score + timeBonus,
    events: [...state.events, { type: "win", bonus: timeBonus }],
  };
}

function finishFailure(state: GameState, reason: FailReason): GameState {
  return {
    ...state,
    phase: "end",
    paused: false,
    outcome: "failure",
    failReason: reason,
    winch: null,
    events: [...state.events, { type: "lose", reason }],
  };
}

function landedWithCrates(state: GameState, world: World): boolean {
  if (state.collectedCrates.length === 0 || state.collectedCrates.some((taken) => !taken)) return false;
  if (state.heli.mode !== "ground") return false;
  const id = heliportIdAt(world, state.heliportMask, state.heli.x, state.heli.z);
  const pad = id > 0 ? state.heliports[id - 1] : undefined;
  return pad?.base === true;
}

function wasRefueling(state: GameState, world: World): boolean {
  return (
    state.heli.mode === "ground" &&
    heliportIdAt(world, state.heliportMask, state.heli.x, state.heli.z) > 0 &&
    state.fuel < FUEL_MAX
  );
}

function updateWinch(
  state: GameState,
  heli: HeliState,
  world: World,
  winch: WinchState | null,
  dt: number,
): { winch: WinchState | null; collected: { kind: "crate" | "person"; index: number } | null } {
  const currentOk = winch !== null && winchOk(state, heli, world, winch.kind, winch.index);
  let kind: "crate" | "person";
  let index: number;
  let elapsed: number;
  if (currentOk && winch) {
    kind = winch.kind;
    index = winch.index;
    elapsed = winch.elapsed + dt;
  } else {
    const next = nearestTarget(state, heli, world);
    if (!next) return { winch: null, collected: null };
    kind = next.kind;
    index = next.index;
    elapsed = dt;
  }
  if (elapsed >= WINCH_TIME - 1e-8) return { winch: null, collected: { kind, index } };
  return { winch: { kind, index, elapsed }, collected: null };
}

function nearestCrate(state: GameState, world: World): { x: number; z: number } | null {
  let bestX = 0;
  let bestZ = 0;
  let bestDist = Infinity;
  let found = false;
  for (let index = 0; index < state.collectedCrates.length; index++) {
    if (state.collectedCrates[index]) continue;
    const crate = world.crates[index];
    if (!crate) continue;
    const x = crate.x + 0.5;
    const z = crate.z + 0.5;
    const dist = Math.hypot(state.heli.x - x, state.heli.z - z);
    if (dist < bestDist) {
      bestDist = dist;
      bestX = x;
      bestZ = z;
      found = true;
    }
  }
  return found ? { x: bestX, z: bestZ } : null;
}

function nearestTarget(
  state: GameState,
  heli: HeliState,
  world: World,
): { kind: "crate" | "person"; index: number } | null {
  let bestKind: "crate" | "person" | null = null;
  let bestIndex = -1;
  let bestDist = Infinity;
  const ranks: Array<{ kind: "crate" | "person"; taken: boolean[] }> = [
    { kind: "crate", taken: state.collectedCrates },
    { kind: "person", taken: state.collectedPeople },
  ];
  for (const rank of ranks) {
    for (let index = 0; index < rank.taken.length; index++) {
      if (rank.taken[index] || !winchOk(state, heli, world, rank.kind, index)) continue;
      const item = itemPosition(world, rank.kind, index);
      if (!item) continue;
      const dist = Math.hypot(heli.x - item.x, heli.z - item.z);
      if (dist < bestDist) {
        bestDist = dist;
        bestKind = rank.kind;
        bestIndex = index;
      }
    }
  }
  if (bestKind === null) return null;
  return { kind: bestKind, index: bestIndex };
}

function winchOk(state: GameState, heli: HeliState, world: World, kind: "crate" | "person", index: number): boolean {
  const taken = kind === "crate" ? state.collectedCrates[index] : state.collectedPeople[index];
  if (taken) return false;
  const item = itemPosition(world, kind, index);
  if (!item || heli.mode !== "air") return false;
  const base = heightAt(world, item.x, item.z);
  const grab = kind === "crate" ? CRATE_GRAB : PERSON_GRAB;
  const aboveGrab = heli.y - base - grab;
  const dist = Math.hypot(heli.x - item.x, heli.z - item.z);
  return dist <= WINCH_RANGE && aboveGrab >= -grab - 0.05 && aboveGrab <= WINCH_HEIGHT && horizontalSpeed(heli) <= WINCH_SPEED;
}

function itemPosition(world: World, kind: "crate" | "person", index: number): { x: number; z: number } | null {
  const item = kind === "crate" ? world.crates[index] : world.people[index];
  if (!item) return null;
  return { x: item.x + 0.5, z: item.z + 0.5 };
}

function homePosition(world: World, pads: HeliportMap, options: CreateGameOptions): { x: number; z: number } {
  if (options.spawnX !== undefined && options.spawnZ !== undefined) return { x: options.spawnX, z: options.spawnZ };
  const base = pads.list.find((pad) => pad.base);
  if (!base) return { x: SPAWN_X, z: SPAWN_Z };
  const spawnOnBase = heliportIdAt(world, pads.mask, SPAWN_X, SPAWN_Z) > 0 && pads.list[heliportIdAt(world, pads.mask, SPAWN_X, SPAWN_Z) - 1]?.base;
  if (spawnOnBase && options.baseX === undefined) return { x: SPAWN_X, z: SPAWN_Z };
  return { x: base.x + base.w / 2, z: base.z + base.h / 2 };
}

function placeHome(heli: HeliState, world: World, x: number, z: number): HeliState {
  return { ...heli, x, z, y: heightAt(world, x, z), speed: 0, vy: 0, mode: "ground", crashAge: 0 };
}

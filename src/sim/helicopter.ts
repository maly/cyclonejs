import type { FlightCommand, ExternalForce } from "./command.ts";
import {
  CEILING,
  CLIMB_MAX,
  CRASH_RESPAWN,
  DESCEND_MAX,
  CYCLONE_DRAG,
  DRAG,
  FUEL_SINK,
  HELI_RADIUS,
  LAND_SPEED,
  LAND_VERTICAL,
  MAX_SPEED,
  SIM_STEP,
  SPAWN_X,
  SPAWN_Z,
  THRUST_ACCEL,
  TURN_RATE,
  VERTICAL_ACCEL,
} from "./config.ts";
import { heightAt, surfaceAt, type World } from "./world.ts";

export type FlightMode = "ground" | "air" | "crash";
export type ViewSide = "south" | "north";

export interface HeliState {
  x: number;
  y: number;
  z: number;
  /** 0 je sever, roste po směru hodin. */
  heading: number;
  speed: number;
  vy: number;
  mode: FlightMode;
  crashAge: number;
  view: ViewSide;
  driftX: number;
  driftZ: number;
}

interface GroundSample {
  cells: Array<{ height: number; surface: number }>;
  min: number;
  max: number;
  land: boolean;
  flat: boolean;
}

export function spawnHeli(world: World, view: ViewSide = "south"): HeliState {
  return {
    x: SPAWN_X,
    y: heightAt(world, SPAWN_X, SPAWN_Z),
    z: SPAWN_Z,
    heading: 0,
    speed: 0,
    vy: 0,
    mode: "ground",
    crashAge: 0,
    view,
    driftX: 0,
    driftZ: 0,
  };
}

export interface HeliStepOptions {
  /** Při false pád po dvou sekundách sám nerespawnuje. Řídí ho hra. */
  respawn?: boolean;
  /** Prázdná nádrž: klesání bez možnosti stoupat. */
  emptyTank?: boolean;
  /** Dosednutí s prázdnou nádrží přežije jen tam, kde predikát vrátí true. */
  onHeliport?: (x: number, z: number) => boolean;
  /** Přidané stáčení v radiánech za sekundu. Na zemi se nepoužije. */
  yawRate?: number;
}

export function horizontalSpeed(state: HeliState): number {
  const vx = Math.sin(state.heading) * state.speed + state.driftX;
  const vz = -Math.cos(state.heading) * state.speed + state.driftZ;
  return Math.hypot(vx, vz);
}

export function stepHeli(
  state: HeliState,
  command: FlightCommand,
  world: World,
  force: ExternalForce = { x: 0, z: 0 },
  dt = SIM_STEP,
  options: HeliStepOptions = {},
): HeliState {
  const view = command.toggleView ? (state.view === "south" ? "north" : "south") : state.view;
  if (state.mode === "crash") {
    const crashAge = state.crashAge + dt;
    if (options.respawn !== false && crashAge >= CRASH_RESPAWN) return spawnHeli(world, view);
    return { ...state, view, crashAge };
  }

  const yaw = state.mode === "air" ? (options.yawRate ?? 0) : 0;
  let heading = wrapAngle(
    state.heading + ((command.turnLeft ? -1 : 0) + (command.turnRight ? 1 : 0)) * TURN_RATE * dt + yaw * dt,
  );
  let speed = state.speed;
  if (state.mode === "air" && command.forward) speed = approach(speed, MAX_SPEED, THRUST_ACCEL * dt);
  else speed = approach(speed, 0, DRAG * dt);

  let mode = state.mode;
  let vy = state.vy;
  const canClimb = command.climb && !options.emptyTank;
  if (mode === "ground" && canClimb) mode = "air";
  if (mode === "air") {
    if (options.emptyTank) vy = -FUEL_SINK;
    else if (command.climb && !command.descend) vy = approach(vy, CLIMB_MAX, VERTICAL_ACCEL * dt);
    else if (command.descend && !command.climb) vy = approach(vy, -DESCEND_MAX, VERTICAL_ACCEL * dt);
    else vy = approach(vy, 0, VERTICAL_ACCEL * dt);
  }

  const damp = Math.exp(-CYCLONE_DRAG * dt);
  let driftX = (state.driftX + force.x * dt) * damp;
  let driftZ = (state.driftZ + force.z * dt) * damp;
  let x = state.x + Math.sin(heading) * speed * dt + driftX * dt;
  let z = state.z - Math.cos(heading) * speed * dt + driftZ * dt;
  let y = state.y + vy * dt;
  x = clamp(x, HELI_RADIUS, world.width - HELI_RADIUS);
  z = clamp(z, HELI_RADIUS, world.depth - HELI_RADIUS);
  if (y > CEILING) {
    y = CEILING;
    vy = 0;
  }

  if (state.mode === "ground" && !canClimb) {
    return { ...state, heading, speed: 0, vy: 0, view, driftX: 0, driftZ: 0 };
  }

  if (hitsTree(world, x, z, y) || blocksSide(world, x, z, state.y)) {
    return crash({ ...state, x, y: state.y, z, heading, speed: 0, vy: 0, view, driftX, driftZ });
  }

  const ground = sampleGround(world, x, z);
  if (y <= ground.max) {
    const gentle =
      mode === "air" &&
      state.y >= ground.max - 0.05 &&
      ground.flat &&
      ground.land &&
      Math.hypot(Math.sin(heading) * speed + driftX, -Math.cos(heading) * speed + driftZ) <= LAND_SPEED &&
      Math.abs(vy) <= LAND_VERTICAL;
    const pad = options.onHeliport?.(x, z) ?? false;
    if (gentle && (!options.emptyTank || pad)) {
      return {
        ...state,
        x,
        y: ground.max,
        z,
        heading,
        speed: 0,
        vy: 0,
        mode: "ground",
        view,
        driftX,
        driftZ,
      };
    }
    return crash({ ...state, x, y: state.y, z, heading, speed: 0, vy: 0, view, driftX, driftZ });
  }

  return { ...state, x, y, z, heading, speed, vy, mode, view, driftX, driftZ };
}

function crash(state: HeliState): HeliState {
  return { ...state, mode: "crash", crashAge: 0, speed: 0, vy: 0 };
}

function blocksSide(world: World, x: number, z: number, altitude: number): boolean {
  return sampleGround(world, x, z).cells.some((cell) => cell.height > altitude + 0.08);
}

function hitsTree(world: World, x: number, z: number, altitude: number): boolean {
  for (const tree of world.trees) {
    const dx = x - (tree.x + 0.5);
    const dz = z - (tree.z + 0.5);
    if (dx * dx + dz * dz <= HELI_RADIUS * HELI_RADIUS && altitude < tree.top) return true;
  }
  return false;
}

function sampleGround(world: World, x: number, z: number): GroundSample {
  const radius = HELI_RADIUS;
  const cells: GroundSample["cells"] = [];
  const x0 = Math.floor(x - radius);
  const x1 = Math.floor(x + radius);
  const z0 = Math.floor(z - radius);
  const z1 = Math.floor(z + radius);
  for (let cz = z0; cz <= z1; cz++) {
    for (let cx = x0; cx <= x1; cx++) {
      const nearestX = clamp(x, cx, cx + 1);
      const nearestZ = clamp(z, cz, cz + 1);
      const dx = x - nearestX;
      const dz = z - nearestZ;
      if (dx * dx + dz * dz > radius * radius) continue;
      cells.push({
        height: heightAt(world, cx + 0.5, cz + 0.5),
        surface: surfaceAt(world, cx + 0.5, cz + 0.5),
      });
    }
  }
  if (cells.length === 0) return { cells, min: 0, max: 0, land: false, flat: false };
  const min = Math.min(...cells.map((cell) => cell.height));
  const max = Math.max(...cells.map((cell) => cell.height));
  const land = cells.every((cell) => cell.surface !== 0);
  return { cells, min, max, land, flat: land && min === max };
}

function approach(value: number, target: number, step: number): number {
  if (value < target) return Math.min(target, value + step);
  return Math.max(target, value - step);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function wrapAngle(angle: number): number {
  const turn = Math.PI * 2;
  return ((angle % turn) + turn) % turn;
}

export function lerpAngle(from: number, to: number, t: number): number {
  let delta = wrapAngle(to - from);
  if (delta > Math.PI) delta -= Math.PI * 2;
  return from + delta * t;
}

/** Spojitá pole mezi dvěma kroky. Režim a pohled bere z novějšího stavu, skok po respawnu nespojuje. */
export function interpolateHeli(from: HeliState, to: HeliState, t: number): HeliState {
  const jump = from.mode !== to.mode || Math.hypot(from.x - to.x, from.z - to.z) > 8;
  if (jump) return { ...to };
  return {
    ...to,
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t,
    z: from.z + (to.z - from.z) * t,
    heading: lerpAngle(from.heading, to.heading, t),
    speed: from.speed + (to.speed - from.speed) * t,
    vy: from.vy + (to.vy - from.vy) * t,
    crashAge: from.crashAge + (to.crashAge - from.crashAge) * t,
    driftX: from.driftX + (to.driftX - from.driftX) * t,
    driftZ: from.driftZ + (to.driftZ - from.driftZ) * t,
  };
}

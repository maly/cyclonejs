import {
  CYCLONE_DANGER,
  CYCLONE_DRAG,
  CYCLONE_DRIFT,
  CYCLONE_INNER,
  CYCLONE_INWARD,
  CYCLONE_MARGIN,
  CYCLONE_SPAWN_CLEAR,
  CYCLONE_SPAWN_FAR,
  CYCLONE_SPEED,
  CYCLONE_TURN,
  CYCLONE_WIND,
  CYCLONE_YAW,
  SIM_STEP,
} from "./config.ts";
import { rngNext } from "./rng.ts";
import { wrapAngle } from "./helicopter.ts";
import type { World } from "./world.ts";

export interface Storm {
  x: number;
  z: number;
  /** 0 je sever, stejně jako kurz vrtulníku. */
  heading: number;
  /** Směr nárazu větru. */
  gust: number;
  /** Nahromaděné stáčení, v radiánech za sekundu, před zeslabením vzdáleností. */
  yaw: number;
}

export function createStorm(world: World, homeX: number, homeZ: number, rng: number): { storm: Storm; rng: number } {
  let best = { x: homeX, z: homeZ, distance: -1 };
  let state = rng;
  for (let attempt = 0; attempt < 24; attempt++) {
    const angleRoll = rngNext(state);
    const radiusRoll = rngNext(angleRoll.state);
    state = radiusRoll.state;
    const angle = angleRoll.value * Math.PI * 2;
    const radius = CYCLONE_SPAWN_CLEAR + radiusRoll.value * (CYCLONE_SPAWN_FAR - CYCLONE_SPAWN_CLEAR);
    // Stejný směr jako kurz: 0 je sever, tedy −Z.
    const x = clamp(homeX + Math.sin(angle) * radius, CYCLONE_MARGIN, world.width - CYCLONE_MARGIN);
    const z = clamp(homeZ - Math.cos(angle) * radius, CYCLONE_MARGIN, world.depth - CYCLONE_MARGIN);
    const distance = Math.hypot(x - homeX, z - homeZ);
    if (distance > best.distance) best = { x, z, distance };
    if (distance >= CYCLONE_SPAWN_CLEAR) break;
  }
  const headingRoll = rngNext(state);
  const gustRoll = rngNext(headingRoll.state);
  return {
    rng: gustRoll.state,
    storm: {
      x: clamp(best.x, 1, world.width - 1),
      z: clamp(best.z, 1, world.depth - 1),
      heading: headingRoll.value * Math.PI * 2,
      gust: gustRoll.value * Math.PI * 2,
      yaw: 0,
    },
  };
}

export function stepStorm(storm: Storm, world: World, rng: number, dt: number): { storm: Storm; rng: number } {
  const nearEdge =
    storm.x < CYCLONE_MARGIN ||
    storm.z < CYCLONE_MARGIN ||
    storm.x > world.width - CYCLONE_MARGIN ||
    storm.z > world.depth - CYCLONE_MARGIN;
  const maxStep = CYCLONE_TURN * dt;
  let heading = storm.heading;
  let state = rng;
  if (nearEdge) {
    const desired = Math.atan2(world.width / 2 - storm.x, -(world.depth / 2 - storm.z));
    heading = wrapAngle(heading + clampAngle(desired - heading, maxStep));
  } else {
    const roll = rngNext(state);
    state = roll.state;
    heading = wrapAngle(heading + (roll.value * 2 - 1) * maxStep);
  }
  const gustRoll = rngNext(state);
  const yawRoll = rngNext(gustRoll.state);
  state = yawRoll.state;
  const gust = wrapAngle(storm.gust + (gustRoll.value * 2 - 1) * Math.PI * dt);
  let yaw = storm.yaw + (yawRoll.value * 2 - 1) * CYCLONE_YAW * dt;
  yaw = clamp(yaw, -CYCLONE_YAW, CYCLONE_YAW);
  let x = storm.x + Math.sin(heading) * CYCLONE_SPEED * dt;
  let z = storm.z - Math.cos(heading) * CYCLONE_SPEED * dt;
  x = clamp(x, 1, world.width - 1);
  z = clamp(z, 1, world.depth - 1);
  return { rng: state, storm: { x, z, heading, gust, yaw } };
}

export function stormDistance(storm: Storm, x: number, z: number): number {
  return Math.hypot(storm.x - x, storm.z - z);
}

/** 0 mimo dosah, 1 ve středu. Roste plynule po celém poloměru větru. */
export function windStrength(distance: number): number {
  return Math.max(0, 1 - distance / CYCLONE_WIND);
}

export function inDangerWind(wind: number): boolean {
  return wind >= CYCLONE_DANGER;
}

/**
 * Zrychlení snosu. Ustálená rychlost po kroku SIM_STEP je CYCLONE_DRIFT · w².
 * Směr: tečna proti směru hodin při pohledu shora (bod východně od oka jde na sever)
 * a CYCLONE_INWARD směrem do středu.
 */
export function stormPush(storm: Storm, x: number, z: number): { x: number; z: number; yaw: number; distance: number; wind: number } {
  const distance = stormDistance(storm, x, z);
  const wind = windStrength(distance);
  const yaw = storm.yaw * wind * wind;
  const speed = CYCLONE_DRIFT * wind * wind;
  if (distance < 1e-6 || speed === 0) return { x: 0, z: 0, yaw, distance, wind };
  const accel = (speed * (Math.exp(CYCLONE_DRAG * SIM_STEP) - 1)) / SIM_STEP;
  const rx = x - storm.x;
  const rz = z - storm.z;
  const tx = rz / distance;
  const tz = -rx / distance;
  const ix = -rx / distance;
  const iz = -rz / distance;
  const outward = 1 - CYCLONE_INWARD;
  let dx = tx * outward + ix * CYCLONE_INWARD;
  let dz = tz * outward + iz * CYCLONE_INWARD;
  const length = Math.hypot(dx, dz);
  dx = (dx / length) * accel;
  dz = (dz / length) * accel;
  return { x: dx, z: dz, yaw, distance, wind };
}

export function inCycloneEye(distance: number): boolean {
  return distance < CYCLONE_INNER;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clampAngle(delta: number, maxStep: number): number {
  const turn = Math.PI * 2;
  let wrapped = ((delta % turn) + turn) % turn;
  if (wrapped > Math.PI) wrapped -= turn;
  return clamp(wrapped, -maxStep, maxStep);
}

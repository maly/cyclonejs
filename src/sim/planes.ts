import {
  PLANE_HIT,
  PLANE_INTERVAL_MAX,
  PLANE_INTERVAL_MIN,
  PLANE_SPEED,
  PLANE_SPREAD,
  PLANE_WARN,
  PLANE_WATER,
} from "./config.ts";
import type { Storm } from "./cyclone.ts";
import type { HeliState } from "./helicopter.ts";
import { rngRange } from "./rng.ts";
import { surfaceAt, type World } from "./world.ts";

export interface Plane {
  x: number;
  y: number;
  z: number;
  dirX: number;
  dirZ: number;
  age: number;
  aimX: number;
  aimY: number;
  aimZ: number;
}

export function randomPlaneGap(rng: number): { rng: number; seconds: number } {
  const next = rngRange(rng, PLANE_INTERVAL_MIN, PLANE_INTERVAL_MAX);
  return { rng: next.state, seconds: next.value };
}

/** V okruhu 3 buněk pod vrtulníkem není souš. */
export function overOpenWater(world: World, x: number, z: number): boolean {
  const radius = PLANE_WATER;
  const x0 = Math.floor(x - radius);
  const x1 = Math.floor(x + radius);
  const z0 = Math.floor(z - radius);
  const z1 = Math.floor(z + radius);
  for (let cz = z0; cz <= z1; cz++) {
    for (let cx = x0; cx <= x1; cx++) {
      const dx = cx + 0.5 - x;
      const dz = cz + 0.5 - z;
      if (dx * dx + dz * dz > radius * radius) continue;
      if (surfaceAt(world, cx + 0.5, cz + 0.5) !== 0) return false;
    }
  }
  return true;
}

/** Směr letu je od cyklonu k vrtulníku, s odchylkou nejvýš ±30°. */
export function launchPlane(heli: HeliState, storm: Storm, rng: number): { plane: Plane; rng: number } {
  let dx = heli.x - storm.x;
  let dz = heli.z - storm.z;
  const length = Math.hypot(dx, dz);
  if (length < 1e-6) {
    dx = 1;
    dz = 0;
  } else {
    dx /= length;
    dz /= length;
  }
  const spread = rngRange(rng, -PLANE_SPREAD, PLANE_SPREAD);
  const cos = Math.cos(spread.value);
  const sin = Math.sin(spread.value);
  const dirX = cos * dx - sin * dz;
  const dirZ = sin * dx + cos * dz;
  const lead = PLANE_SPEED * PLANE_WARN;
  return {
    rng: spread.state,
    plane: {
      x: heli.x - dirX * lead,
      y: heli.y,
      z: heli.z - dirZ * lead,
      dirX,
      dirZ,
      age: 0,
      aimX: heli.x,
      aimY: heli.y,
      aimZ: heli.z,
    },
  };
}

export function advancePlane(plane: Plane, dt: number): Plane | null {
  const age = plane.age + dt;
  if (age > PLANE_WARN * 2) return null;
  const along = PLANE_SPEED * (age - PLANE_WARN);
  return {
    ...plane,
    age,
    x: plane.aimX + plane.dirX * along,
    y: plane.aimY,
    z: plane.aimZ + plane.dirZ * along,
  };
}

export function planeWarning(plane: Plane): boolean {
  return plane.age < PLANE_WARN;
}

export function planeHits(plane: Plane, heli: HeliState): boolean {
  if (heli.mode === "crash") return false;
  const dx = plane.x - heli.x;
  const dy = plane.y - heli.y;
  const dz = plane.z - heli.z;
  return dx * dx + dy * dy + dz * dz < PLANE_HIT * PLANE_HIT;
}

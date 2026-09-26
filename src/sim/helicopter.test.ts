import { describe, expect, it } from "vitest";
import { IDLE_COMMAND, type FlightCommand } from "./command.ts";
import { CLIMB_MAX, DESCEND_MAX, FUEL_SINK, HELI_RADIUS, LAND_SPEED, LAND_VERTICAL, SIM_STEP, VERTICAL_DAMP } from "./config.ts";
import { interpolateHeli, spawnHeli, stepHeli, type HeliState } from "./helicopter.ts";
import { heightAt, type World } from "./world.ts";

function world(paint: (x: number, z: number) => { height: number; surface: number } | null, trees: World["trees"] = []): World {
  const width = 40;
  const depth = 40;
  const height = new Uint8Array(width * depth);
  const surface = new Uint8Array(width * depth);
  for (let z = 0; z < depth; z++) {
    for (let x = 0; x < width; x++) {
      const cell = paint(x, z);
      if (!cell) continue;
      height[z * width + x] = cell.height;
      surface[z * width + x] = cell.surface;
    }
  }
  return { width, depth, height, surface, estimated: new Uint8Array(width * depth), trees, people: [], crates: [] };
}

const pad = (x: number, z: number) => (x >= 10 && x < 20 && z >= 10 && z < 20 ? { height: 2, surface: 4 } : null);

function fly(state: HeliState, map: World, command: FlightCommand, steps: number): HeliState {
  let current = state;
  for (let i = 0; i < steps; i++) current = stepHeli(current, command, map);
  return current;
}

function airborne(map: World, x: number, z: number, y: number, extra: Partial<HeliState> = {}): HeliState {
  return { ...spawnHeli(map), x, y, z, mode: "air", ...extra };
}

/** Klesá jen tak rychle, aby dosednutí zůstalo pod limitem svislé rychlosti. */
function alight(state: HeliState, map: World, groundY: number): HeliState {
  let current = state;
  for (let i = 0; i < 900 && current.mode === "air"; i++) {
    const gap = current.y - groundY;
    const limit = gap > 0.8 ? -1.15 : -0.55;
    const descend = gap > 0.02 && current.vy > limit;
    current = stepHeli(current, { ...IDLE_COMMAND, descend }, map);
  }
  return current;
}

describe("vrtulník", () => {
  it("přistane na rovném heliportu a na zemi nepoletí vpřed", () => {
    const map = world(pad);
    let state = alight(airborne(map, 15, 15, 4), map, 2);
    expect(state.y).toBe(2);
    expect(Math.abs(state.vy)).toBeLessThanOrEqual(LAND_VERTICAL);
    state = fly(state, map, { ...IDLE_COMMAND, forward: true }, 60);
    expect(state.speed).toBe(0);
    expect(state.x).toBeCloseTo(15);
  });

  it("přistane na rovné trávě", () => {
    const grass = world((x, z) => (x >= 10 && x < 20 && z >= 10 && z < 20 ? { height: 1, surface: 1 } : null));
    const state = alight(airborne(grass, 15, 15, 3), grass, 1);
    expect(state.mode).toBe("ground");
    expect(state.y).toBe(1);
    expect(state.speed).toBe(0);
  });

  it("havaruje na hraně, na vodě a při velké rychlosti", () => {
    const split = world((x, z) => {
      if (z < 10 || z >= 20) return null;
      if (x >= 10 && x < 15) return { height: 3, surface: 1 };
      if (x >= 15 && x < 20) return { height: 1, surface: 1 };
      return null;
    });
    const edge = fly(airborne(split, 15, 15, 4), split, { ...IDLE_COMMAND, descend: true }, 80);
    expect(edge.mode).toBe("crash");

    const water = world(() => null);
    const wet = fly(airborne(water, 15, 15, 3), water, { ...IDLE_COMMAND, descend: true }, 80);
    expect(wet.mode).toBe("crash");

    const fastMap = world(pad);
    const fast = stepHeli(
      airborne(fastMap, 15, 15, 2.01, { speed: LAND_SPEED + 1.5, vy: -1 }),
      IDLE_COMMAND,
      fastMap,
    );
    expect(fast.mode).toBe("crash");
    const hard = stepHeli(airborne(fastMap, 15, 15, 2.03, { vy: -(LAND_VERTICAL + 1.2) }), IDLE_COMMAND, fastMap);
    expect(hard.mode).toBe("crash");
  });

  it("svislá rychlost má setrvačnost a po puštění dozní", () => {
    const map = world(pad);
    let climbing = airborne(map, 15, 15, 6, { vy: 0 });
    climbing = fly(climbing, map, { ...IDLE_COMMAND, climb: true }, 90);
    expect(climbing.vy).toBeCloseTo(CLIMB_MAX, 1);
    let dropping = airborne(map, 15, 15, 9, { vy: 0 });
    dropping = fly(dropping, map, { ...IDLE_COMMAND, descend: true }, 90);
    expect(dropping.vy).toBeCloseTo(-DESCEND_MAX, 1);
    let coast = airborne(map, 15, 15, 9, { vy: -DESCEND_MAX });
    coast = fly(coast, map, IDLE_COMMAND, Math.round(VERTICAL_DAMP / SIM_STEP));
    expect(Math.abs(coast.vy)).toBeLessThan(0.2);
  });

  it("narazí do útesu z boku a do stromu, nad stromem proletí", () => {
    const cliff = world((x, z) => {
      if (z < 10 || z >= 16) return null;
      if (x >= 8 && x < 14) return { height: 1, surface: 1 };
      if (x >= 14 && x < 22) return { height: 6, surface: 5 };
      return null;
    });
    const intoCliff = fly(
      airborne(cliff, 13.2, 13, 1, { heading: Math.PI / 2, speed: 4 }),
      cliff,
      { ...IDLE_COMMAND, forward: true },
      40,
    );
    expect(intoCliff.mode).toBe("crash");

    const trees = world((x, z) => (x >= 5 && x < 30 && z >= 5 && z < 30 ? { height: 1, surface: 1 } : null), [
      { type: "topol", x: 18, z: 15, base: 1, top: 4 },
    ]);
    const hit = fly(airborne(trees, 16.5, 15.5, 1.2, { heading: Math.PI / 2, speed: 4 }), trees, { ...IDLE_COMMAND, forward: true }, 40);
    expect(hit.mode).toBe("crash");
    const over = fly(airborne(trees, 16.5, 15.5, 5, { heading: Math.PI / 2, speed: 4 }), trees, { ...IDLE_COMMAND, forward: true }, 40);
    expect(over.mode).toBe("air");
    expect(over.x).toBeGreaterThan(18);
  });

  it("okraj světa nepustí dál a stejné příkazy dají stejný stav", () => {
    const map = world((x, z) => ({ height: 1, surface: 1 }));
    const boxed = fly(airborne(map, HELI_RADIUS + 0.2, 20, 3, { heading: -Math.PI / 2, speed: 6 }), map, { ...IDLE_COMMAND, forward: true }, 90);
    expect(boxed.mode).toBe("air");
    expect(boxed.x).toBeGreaterThanOrEqual(HELI_RADIUS);

    const commands: FlightCommand[] = [
      { ...IDLE_COMMAND, climb: true },
      { ...IDLE_COMMAND, forward: true, turnRight: true },
      { ...IDLE_COMMAND, descend: true },
    ];
    const run = () => {
      let state = spawnHeli(map);
      for (let i = 0; i < 90; i++) state = stepHeli(state, commands[i % commands.length], map);
      return state;
    };
    expect(run()).toEqual(run());
    expect(SIM_STEP).toBeCloseTo(1 / 60);
  });

  it("prázdná nádrž klesá bez stoupání a mimo heliport havaruje", () => {
    const map = world(pad);
    let sinking = airborne(map, 15, 15, 5);
    for (let i = 0; i < 60; i++) {
      sinking = stepHeli(sinking, { ...IDLE_COMMAND, climb: true }, map, { x: 0, z: 0 }, SIM_STEP, {
        emptyTank: true,
        respawn: false,
        onHeliport: () => true,
      });
    }
    expect(sinking.mode).toBe("air");
    expect(sinking.y).toBeCloseTo(5 - FUEL_SINK);

    const grounded = { ...airborne(map, 15, 15, 2), mode: "ground" as const, y: 2 };
    const stayed = stepHeli(grounded, { ...IDLE_COMMAND, climb: true }, map, { x: 0, z: 0 }, SIM_STEP, {
      emptyTank: true,
      respawn: false,
    });
    expect(stayed.mode).toBe("ground");
    expect(stayed.y).toBe(2);

    let dropped = airborne(map, 15, 15, 3);
    for (let i = 0; i < 80; i++) {
      dropped = stepHeli(dropped, IDLE_COMMAND, map, { x: 0, z: 0 }, SIM_STEP, {
        emptyTank: true,
        respawn: false,
        onHeliport: () => false,
      });
    }
    expect(dropped.mode).toBe("crash");
  });

  it("spojuje polohu mezi kroky a skok po změně režimu nespojuje", () => {
    const map = world(pad);
    const from = airborne(map, 15, 15, 4, { heading: 0.2, speed: 1 });
    const to = { ...from, x: 16, z: 14, y: 4.5, heading: 0.4, speed: 2 };
    const mid = interpolateHeli(from, to, 0.5);
    expect(mid.x).toBeCloseTo(15.5);
    expect(mid.z).toBeCloseTo(14.5);
    expect(mid.heading).toBeCloseTo(0.3);
    const crashed = interpolateHeli(from, { ...to, mode: "crash" }, 0.5);
    expect(crashed).toMatchObject({ x: 16, mode: "crash" });
  });
});

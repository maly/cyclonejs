import { describe, expect, it } from "vitest";
import { IDLE_GAME } from "./command.ts";
import {
  CYCLONE_DANGER,
  CYCLONE_DANGER_RADIUS,
  CYCLONE_DRIFT,
  CYCLONE_INNER,
  CYCLONE_INWARD,
  CYCLONE_WIND,
  CYCLONE_YAW,
  FUEL_BURN,
  FUEL_MAX,
  FUEL_THRUST,
  MAX_SPEED,
  PLANE_WARN,
  SIM_STEP,
} from "./config.ts";
import { createStorm, inDangerWind, stepStorm, stormDistance, stormPush, windStrength } from "./cyclone.ts";
import { horizontalSpeed, stepHeli } from "./helicopter.ts";
import { createGame, stepGame, type GameState } from "./game.ts";
import { advancePlane, launchPlane, overOpenWater, planeHits } from "./planes.ts";
import { rngSeed } from "./rng.ts";
import type { World } from "./world.ts";

function sea(width = 80, depth = 80): World {
  return {
    width,
    depth,
    height: new Uint8Array(width * depth),
    surface: new Uint8Array(width * depth),
    estimated: new Uint8Array(width * depth),
    trees: [],
    people: [],
    crates: [{ x: 10, z: 10 }],
    };
}

function playOn(world: World): GameState {
  const created = createGame(world, { spawnX: 40, spawnZ: 40, baseX: 0, baseZ: 0 });
  return stepGame(created, { ...IDLE_GAME, confirm: true }, world);
}

describe("cyklon", () => {
  it("zůstává ve světě a začíná daleko od základny", () => {
    const world = sea(400, 400);
    const started = createStorm(world, 200, 200, rngSeed(3));
    expect(stormDistance(started.storm, 200, 200)).toBeGreaterThanOrEqual(150);
    let storm = started.storm;
    let rng = started.rng;
    for (let i = 0; i < 60 * 30; i++) {
      const stepped = stepStorm(storm, world, rng, 1 / 60);
      storm = stepped.storm;
      rng = stepped.rng;
      expect(storm.x).toBeGreaterThan(0);
      expect(storm.z).toBeGreaterThan(0);
      expect(storm.x).toBeLessThan(world.width);
      expect(storm.z).toBeLessThan(world.depth);
    }
  });

  it("oko shodí vrtulník ve vzduchu a přistání nechá být", () => {
    const world = sea();
    let state = playOn(world);
    state = {
      ...state,
      storm: { ...state.storm, x: 40, z: 40 },
      heli: { ...state.heli, x: 40, y: 6, z: 40, mode: "air", speed: 0 },
    };
    const crashed = stepGame(state, IDLE_GAME, world);
    expect(stormDistance(state.storm, 40, 40)).toBeLessThan(CYCLONE_INNER);
    expect(crashed.heli.mode).toBe("crash");
    expect(crashed.lives).toBe(state.lives - 1);

    const parked = stepGame(
      { ...state, heli: { ...state.heli, mode: "ground", y: 0 } },
      IDLE_GAME,
      world,
    );
    expect(parked.heli.mode).toBe("ground");
    expect(parked.lives).toBe(state.lives);
  });

  it("síla větru roste plynule až do 200 buněk a od 0,8 je DANGER", () => {
    expect(windStrength(0)).toBe(1);
    expect(windStrength(CYCLONE_WIND / 2)).toBeCloseTo(0.5);
    expect(windStrength(CYCLONE_DANGER_RADIUS)).toBeCloseTo(CYCLONE_DANGER);
    expect(windStrength(CYCLONE_WIND)).toBe(0);
    expect(windStrength(CYCLONE_WIND + 30)).toBe(0);
    expect(inDangerWind(CYCLONE_DANGER)).toBe(true);
    expect(inDangerWind(CYCLONE_DANGER - 0.01)).toBe(false);
    expect(CYCLONE_DRIFT * 0.5 * 0.5).toBeCloseTo(0.75);
    expect(CYCLONE_DRIFT * CYCLONE_DANGER * CYCLONE_DANGER).toBeCloseTo(1.92);
  });

  it("snos je tečný proti směru hodin, v dálce slabý a u DANGER skoro dvě buňky za sekundu", () => {
    const world = sea(400, 400);
    const storm = { x: 40, z: 80, heading: 0, gust: 0, yaw: 0 };
    const east = stormPush(storm, 40 + 100, 80);
    expect(east.wind).toBeCloseTo(0.5);
    expect(east.x).toBeLessThan(0);
    expect(east.z).toBeLessThan(0);
    const share = Math.hypot(east.x, east.z);
    const inward = CYCLONE_INWARD / Math.hypot(1 - CYCLONE_INWARD, CYCLONE_INWARD);
    expect(-east.x / share).toBeCloseTo(inward, 5);
    expect(-east.z / share).toBeCloseTo((1 - CYCLONE_INWARD) / Math.hypot(1 - CYCLONE_INWARD, CYCLONE_INWARD), 5);
    const north = stormPush(storm, 40, 80 - 100);
    expect(north.x).toBeLessThan(0);
    expect(north.z).toBeGreaterThan(0);

    const spinning = stormPush({ ...storm, yaw: CYCLONE_YAW }, 40 + 100, 80);
    expect(spinning.yaw).toBeCloseTo(CYCLONE_YAW * 0.25);
    expect(Math.abs(stormPush({ ...storm, yaw: -CYCLONE_YAW }, 40, 80).yaw)).toBeCloseTo(CYCLONE_YAW);

    let heli = playOn(world).heli;
    const settle = (distance: number) => {
      heli = { ...heli, x: 40 + distance, y: 8, z: 80, mode: "air" as const, speed: 0, vy: 0, heading: 0, driftX: 0, driftZ: 0 };
      for (let i = 0; i < 360; i++) {
        const push = stormPush(storm, heli.x, heli.z);
        heli = stepHeli(heli, IDLE_GAME.flight, world, { x: push.x, z: push.z });
      }
      const wind = windStrength(stormDistance(storm, heli.x, heli.z));
      expect(horizontalSpeed(heli)).toBeCloseTo(CYCLONE_DRIFT * wind * wind, 1);
    };
    settle(100);
    expect(windStrength(stormDistance(storm, heli.x, heli.z))).toBeGreaterThan(0.45);
    settle(CYCLONE_DANGER_RADIUS);
    expect(horizontalSpeed(heli)).toBeGreaterThan(1.7);
    expect(horizontalSpeed(heli)).toBeLessThan(2.15);
    expect(horizontalSpeed(heli)).toBeLessThan(MAX_SPEED);
  });

  it("plný tah uteče ještě dvacet buněk od oka", () => {
    const world = sea(400, 400);
    const storm = { x: 80, z: 80, heading: 0, gust: 0, yaw: 0 };
    let heli = playOn(world).heli;
    heli = { ...heli, x: 100, y: 8, z: 80, heading: Math.PI / 2, mode: "air", speed: 0, vy: 0, driftX: 0, driftZ: 0 };
    const start = stormDistance(storm, heli.x, heli.z);
    expect(start).toBeCloseTo(20);
    expect(CYCLONE_DRIFT * windStrength(start) ** 2).toBeLessThan(MAX_SPEED);
    for (let i = 0; i < 4 / SIM_STEP; i++) {
      const push = stormPush(storm, heli.x, heli.z);
      heli = stepHeli(heli, { ...IDLE_GAME.flight, forward: true }, world, { x: push.x, z: push.z }, SIM_STEP, { yawRate: 0 });
    }
    expect(stormDistance(storm, heli.x, heli.z)).toBeGreaterThan(start + 8);
    expect(heli.mode).toBe("air");
  });
});

describe("letadlo", () => {
  it("nad pevninou se neobjeví a nad mořem letí ve výšce z výstrahy", () => {
    const land = sea();
    land.surface[40 * land.width + 40] = 1;
    expect(overOpenWater(land, 40.5, 40.5)).toBe(false);
    const water = sea(500, 500);
    expect(overOpenWater(water, 40.5, 40.5)).toBe(true);

    let state = playOn(water);
    state = {
      ...state,
      planeCooldown: 0,
      storm: { ...state.storm, x: 360, z: 40 },
      heli: { ...state.heli, x: 40, y: 7, z: 40, mode: "air", speed: 0, vy: 0, driftX: 0, driftZ: 0 },
    };
    const warned = stepGame(state, IDLE_GAME, water);
    expect(warned.events.some((event) => event.type === "plane-warning")).toBe(true);
    expect(warned.plane?.aimY).toBeCloseTo(7);
    expect(warned.plane?.y).toBeCloseTo(7);

    const dodged = {
      ...warned,
      heli: { ...warned.heli, y: warned.heli.y + 4 },
    };
    let missed = dodged;
    for (let i = 0; i < Math.ceil((PLANE_WARN + 0.2) * 60); i++) missed = stepGame(missed, IDLE_GAME, water);
    expect(missed.heli.mode).toBe("air");

    let hit = warned;
    for (let i = 0; i < Math.ceil(PLANE_WARN * 60) + 2 && hit.heli.mode !== "crash"; i++) hit = stepGame(hit, IDLE_GAME, water);
    expect(hit.heli.mode).toBe("crash");
  });

  it("srážku a minutí počítá ze vzdálenosti středů", () => {
    const world = sea();
    const state = playOn(world);
    const launched = launchPlane({ ...state.heli, x: 10, y: 4, z: 10 }, { ...state.storm, x: 10, z: 80 }, rngSeed(1));
    let plane = launched.plane;
    expect(plane.aimY).toBe(4);
    let passed = false;
    for (let i = 0; i < 300 && plane; i++) {
      const next = advancePlane(plane, 1 / 60);
      if (!next) break;
      plane = next;
      if (Math.hypot(plane.x - 10, plane.z - 10) < 0.2) {
        passed = true;
        expect(planeHits(plane, { ...state.heli, x: 10, y: 4, z: 10, mode: "air" })).toBe(true);
        expect(planeHits(plane, { ...state.heli, x: 10, y: 8, z: 10, mode: "air" })).toBe(false);
      }
    }
    expect(passed).toBe(true);
  });
});

describe("dohromady", () => {
  it("stejné semeno a příkazy dají stejný stav a plný plyn vystačí na stovky sekund", () => {
    const world = sea(400, 400);
    const once = () => {
      let state = createGame(world, { spawnX: 80, spawnZ: 80, seed: 9 });
      state = stepGame(state, { ...IDLE_GAME, confirm: true }, world);
      for (let i = 0; i < 90; i++) {
        state = stepGame(state, { ...IDLE_GAME, flight: { ...IDLE_GAME.flight, forward: i % 2 === 0, turnRight: true } }, world);
      }
      return state;
    };
    expect(once()).toEqual(once());
    const fullThrottle = FUEL_MAX / (FUEL_BURN + FUEL_THRUST);
    expect(fullThrottle).toBeGreaterThan(280);
    expect(fullThrottle).toBeLessThan(290);
    expect(fullThrottle * MAX_SPEED).toBeGreaterThan(CYCLONE_WIND * 8);
  });
});

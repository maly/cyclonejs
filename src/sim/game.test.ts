import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { IDLE_GAME, type GameCommand } from "./command.ts";
import { FUEL_BURN, FUEL_MAX, FUEL_THRUST, ROUND_SECONDS, SCORE_CRATE, SCORE_PERSON, SCORE_SECOND, SIM_STEP, SPAWN_X, SPAWN_Z, START_LIVES } from "./config.ts";
import { createGame, formatClock, stepGame, wholeSecondsLeft, type GameState } from "./game.ts";
import { findHeliports, formatHeliport } from "./heliports.ts";
import type { TerrainFile } from "./terrainTypes.ts";
import { worldFromTerrain, type World } from "./world.ts";

function field(): World {
  const width = 220;
  const depth = 220;
  const height = new Uint8Array(width * depth);
  const surface = new Uint8Array(width * depth);
  for (let z = 0; z < depth; z++) {
    for (let x = 0; x < width; x++) {
      if (x < 4 || z < 4 || x >= 36 || z >= 36) continue;
      height[z * width + x] = 1;
      surface[z * width + x] = 1;
    }
  }
  for (let z = 10; z <= 12; z++) {
    for (let x = 10; x <= 13; x++) surface[z * width + x] = 4;
  }
  height[24 * width + 24] = 3;
  surface[24 * width + 24] = 4;
  return {
    width,
    depth,
    height,
    surface,
    estimated: new Uint8Array(width * depth),
    trees: [],
    people: [{ type: "muz", x: 18, z: 20 }],
    crates: [
      { x: 20, z: 16 },
      { x: 22, z: 16 },
      { x: 24, z: 18 },
      { x: 26, z: 18 },
      { x: 28, z: 20 },
    ],
  };
}

function play(world: World = field()): GameState {
  return stepGame(createGame(world, { baseX: 10, baseZ: 10 }), { ...IDLE_GAME, confirm: true }, world);
}

function run(state: GameState, world: World, command: GameCommand, steps: number): GameState {
  let current = state;
  for (let i = 0; i < steps; i++) current = stepGame(current, command, world);
  return current;
}

function hover(state: GameState, x: number, z: number, y = 2): GameState {
  return {
    ...state,
    heli: { ...state.heli, x, y, z, mode: "air", speed: 0, vy: 0, driftX: 0, driftZ: 0 },
  };
}

describe("heliporty", () => {
  it("na ostrůvku nechá jen plochu 2×2 a základnu pozná", () => {
    const world = field();
    const pads = findHeliports(world, 10, 10);
    expect(pads.list).toHaveLength(1);
    expect(pads.list[0]).toMatchObject({ x: 10, z: 10, w: 4, h: 3, base: true });
    expect(pads.mask[24 * world.width + 24]).toBe(0);
    expect(formatHeliport(pads.list[0])).toBe("10,10 4×3 base");
  });

  it("na mapě je základna kolem buňky 270, 309 a vrtulník na ní stojí", () => {
    const terrain = JSON.parse(readFileSync("data/map/terrain.json", "utf8")) as TerrainFile;
    const world = worldFromTerrain(terrain);
    const pads = findHeliports(world);
    const base = pads.list.find((pad) => pad.base);
    expect(base).toBeTruthy();
    expect(base!.x).toBeLessThanOrEqual(270);
    expect(base!.x + base!.w).toBeGreaterThan(270);
    expect(base!.z).toBeLessThanOrEqual(309);
    expect(base!.z + base!.h).toBeGreaterThan(309);
    expect(pads.list.every((pad) => pad.w >= 2 && pad.h >= 2)).toBe(true);
    const game = createGame(world);
    expect(game.heli.x).toBeCloseTo(SPAWN_X);
    expect(game.heli.z).toBeCloseTo(SPAWN_Z);
    expect(game.heli.mode).toBe("ground");
    expect(game.phase).toBe("intro");
    expect(pads.list.map(formatHeliport).length).toBe(pads.list.length);
  });
});

describe("hra", () => {
  it("naviják vytáhne bednu a pohyb ho přeruší", () => {
    const world = field();
    let state = hover(play(world), 20.5, 16.5);
    const lifted = run(state, world, IDLE_GAME, 90);
    expect(lifted.collectedCrates[0]).toBe(true);
    expect(lifted.crateScore).toBe(SCORE_CRATE);
    expect(lifted.score).toBe(SCORE_CRATE);
    expect(lifted.events.at(-1)).toEqual({ type: "pickup", kind: "crate" });
    expect(lifted.winch).toBeNull();

    state = hover(play(world), 20.5, 16.5);
    state = run(state, world, IDLE_GAME, 40);
    expect(state.winch?.elapsed).toBeGreaterThan(0.5);
    state = stepGame(hover({ ...state, winch: state.winch }, 24, 16.5), IDLE_GAME, world);
    expect(state.collectedCrates[0]).toBe(false);
    expect(state.score).toBe(0);
    expect(state.winch).toBeNull();
    const almost = run(hover(state, 20.5, 16.5), world, IDLE_GAME, 89);
    expect(almost.collectedCrates[0]).toBe(false);
    expect(run(almost, world, IDLE_GAME, 1).collectedCrates[0]).toBe(true);
  });

  it("hák chytá u horní hrany bedny, ne až u země", () => {
    const world = field();
    const atLid = run(hover(play(world), 20.5, 16.5, 3.3), world, IDLE_GAME, 90);
    expect(atLid.collectedCrates[0]).toBe(true);
    const above = run(hover(play(world), 20.5, 16.5, 4.2), world, IDLE_GAME, 90);
    expect(above.collectedCrates[0]).toBe(false);
    expect(above.winch).toBeNull();
  });

  it("člověk dá 100 bodů", () => {
    const world = field();
    const state = run(hover(play(world), 18.5, 20.5), world, IDLE_GAME, 90);
    expect(state.peopleScore).toBe(SCORE_PERSON);
    expect(state.collectedPeople[0]).toBe(true);
    expect(state.events.at(-1)).toEqual({ type: "pickup", kind: "person" });
  });

  it("palivo ve vzduchu ubývá, na heliportu se doplní a na trávě stojí", () => {
    const world = field();
    const air = run(hover(play(world), 20.5, 22.5, 4), world, IDLE_GAME, 60);
    expect(air.fuel).toBeCloseTo(FUEL_MAX - FUEL_BURN);
    const thrust = run(hover(play(world), 20.5, 22.5, 4), world, { ...IDLE_GAME, flight: { ...IDLE_GAME.flight, forward: true } }, 60);
    expect(thrust.fuel).toBeCloseTo(FUEL_MAX - FUEL_BURN - FUEL_THRUST, 5);

    let grounded = play(world);
    grounded = { ...grounded, fuel: 80, heli: { ...grounded.heli, x: 20.5, z: 22.5, y: 1, mode: "ground" } };
    expect(run(grounded, world, IDLE_GAME, 60).fuel).toBeCloseTo(80);

    const home = play(world);
    const touching = { ...hover(home, home.homeX, home.homeZ, 1), fuel: 40 };
    const refueled = stepGame(touching, IDLE_GAME, world);
    expect(refueled.heli.mode).toBe("ground");
    expect(refueled.events).toContainEqual({ type: "refuel" });
    expect(run(touching, world, IDLE_GAME, 60).fuel).toBeCloseTo(60);
    expect(stepGame(refueled, IDLE_GAME, world).events.some((event) => event.type === "refuel")).toBe(false);
  });

  it("prázdná nádrž na heliportu přistane a mimo něj stojí vrtulník", () => {
    const world = field();
    const home = play(world);
    const onPad = run(hover({ ...home, fuel: 0 }, home.homeX, home.homeZ, 4), world, IDLE_GAME, 220);
    expect(onPad.heli.mode).toBe("ground");
    expect(onPad.lives).toBe(START_LIVES);
    expect(onPad.fuel).toBeGreaterThan(0);

    let lost = run(hover({ ...home, fuel: 0 }, 20.5, 22.5, 4), world, IDLE_GAME, 220);
    expect(lost.heli.mode).toBe("crash");
    expect(lost.lives).toBe(START_LIVES - 1);
    lost = run(lost, world, IDLE_GAME, 120);
    expect(lost.phase).toBe("play");
    expect(lost.heli.mode).toBe("ground");
    expect(lost.heli.x).toBeCloseTo(home.homeX);
    expect(lost.heli.z).toBeCloseTo(home.homeZ);
    expect(lost.fuel).toBe(FUEL_MAX);
  });

  it("po ztrátě bedny zůstávají a poslední vrtulník hru ukončí", () => {
    const world = field();
    let state = run(hover(play(world), 20.5, 16.5), world, IDLE_GAME, 90);
    state = { ...state, lives: 1, fuel: 0 };
    state = run(hover(state, 20.5, 22.5, 4), world, IDLE_GAME, 220);
    expect(state.lives).toBe(0);
    expect(state.phase).toBe("play");
    expect(state.collectedCrates[0]).toBe(true);
    state = run(state, world, IDLE_GAME, 130);
    expect(state.phase).toBe("end");
    expect(state.outcome).toBe("failure");
    expect(state.failReason).toBe("lives");
    expect(state.score).toBe(SCORE_CRATE);
  });

  it("úspěch po pěti bednách na základně, čas a životy hru ukončí a mezerník vrací úvod", () => {
    const world = field();
    let state = play(world);
    const centers = world.crates.map((crate) => ({ x: crate.x + 0.5, z: crate.z + 0.5 }));
    for (const center of centers) state = run(hover(state, center.x, center.z), world, IDLE_GAME, 90);
    expect(state.collectedCrates.every(Boolean)).toBe(true);
    const before = state.timeLeft;
    state = {
      ...state,
      heli: { ...state.heli, x: state.homeX, y: 1, z: state.homeZ, mode: "ground", speed: 0, vy: 0 },
    };
    state = stepGame(state, IDLE_GAME, world);
    expect(state.outcome).toBe("success");
    expect(state.timeBonus).toBe(wholeSecondsLeft(before) * SCORE_SECOND);
    expect(state.score).toBe(SCORE_CRATE * 5 + state.timeBonus);
    expect(formatClock(600)).toBe("10:00");
    expect(formatClock(ROUND_SECONDS)).toBe("15:00");
    expect(before).toBeGreaterThan(ROUND_SECONDS - 30);

    let failed = play(world);
    failed = { ...failed, timeLeft: SIM_STEP };
    failed = stepGame(failed, IDLE_GAME, world);
    expect(failed.failReason).toBe("time");
    const intro = stepGame(failed, { ...IDLE_GAME, confirm: true }, world);
    expect(intro.phase).toBe("intro");
    expect(intro.collectedCrates.every((taken) => !taken)).toBe(true);
    expect(stepGame(intro, { ...IDLE_GAME, confirm: true }, world).phase).toBe("play");
  });

  it("ladicí zkratky poslouchají jen při ?debug", () => {
    const world = field();
    let plain = play(world);
    plain = { ...plain, fuel: 40, heli: { ...plain.heli, mode: "air", y: 5 } };
    plain = stepGame(plain, { ...IDLE_GAME, fillFuel: true, god: true, skipMinute: true }, world);
    expect(plain.god).toBe(false);
    expect(plain.fuel).toBeLessThan(40);
    expect(plain.timeLeft).toBeGreaterThan(500);

    let debug = stepGame(createGame(world, { baseX: 10, baseZ: 10, debug: true }), { ...IDLE_GAME, confirm: true }, world);
    debug = stepGame({ ...debug, fuel: 12 }, { ...IDLE_GAME, fillFuel: true }, world);
    expect(debug.fuel).toBe(100);
    debug = stepGame(debug, { ...IDLE_GAME, god: true }, world);
    expect(debug.god).toBe(true);
    const timeLeft = debug.timeLeft;
    debug = stepGame(debug, { ...IDLE_GAME, skipMinute: true }, world);
    expect(debug.timeLeft).toBeCloseTo(timeLeft - 60);
    debug = stepGame(debug, { ...IDLE_GAME, teleport: true }, world);
    expect(debug.heli.mode).toBe("air");
    expect(Math.hypot(debug.heli.x - 20.5, debug.heli.z - 16.5)).toBeLessThan(1);
  });

  it("escape zastaví čas a stejný seed příkazů dá stejný stav", () => {
    const world = field();
    let state = play(world);
    const timeLeft = state.timeLeft;
    state = stepGame(state, { ...IDLE_GAME, pause: true }, world);
    expect(state.paused).toBe(true);
    expect(run(state, world, IDLE_GAME, 30).timeLeft).toBe(timeLeft);
    expect(stepGame(state, { ...IDLE_GAME, pause: true }, world).paused).toBe(false);

    const commands: GameCommand[] = [
      { ...IDLE_GAME, confirm: true },
      { ...IDLE_GAME, flight: { ...IDLE_GAME.flight, climb: true } },
      { ...IDLE_GAME, flight: { ...IDLE_GAME.flight, forward: true, turnLeft: true } },
      IDLE_GAME,
    ];
    const once = () => {
      let current = createGame(world, { baseX: 10, baseZ: 10 });
      for (let i = 0; i < 40; i++) current = stepGame(current, commands[i % commands.length], world);
      return current;
    };
    expect(once()).toEqual(once());
  });
});

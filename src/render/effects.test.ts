import { describe, expect, it } from "vitest";
import type { GameEvent } from "../sim/game.ts";
import type { HeliState } from "../sim/helicopter.ts";
import type { World } from "../sim/world.ts";
import { createCrashVisual } from "./crash.ts";
import { createStormVisual } from "./storm.ts";

function heli(patch: Partial<HeliState> = {}): HeliState {
  return {
    x: 1.2,
    y: 2,
    z: 1.2,
    heading: 0,
    speed: 0,
    vy: 0,
    mode: "air",
    crashAge: 0,
    view: "south",
    driftX: 0,
    driftZ: 0,
    ...patch,
  };
}

function world(surface: number): World {
  return {
    width: 4,
    depth: 4,
    height: new Uint8Array(16),
    surface: new Uint8Array(16).fill(surface),
    estimated: new Uint8Array(16),
    trees: [],
    people: [],
    crates: [],
  };
}

describe("cyklón a havárie", () => {
  it("hustota deště roste s větrem", () => {
    const storm = createStormVisual();
    storm.update(0, 0, 1, 0, 0, 0);
    expect(storm.rain.geometry.drawRange.count).toBe(0);
    storm.update(0, 0, 1, 1, 0, 0);
    expect(storm.rain.geometry.drawRange.count).toBeGreaterThan(400);
  });

  it("nad vodou pustí gejzír a na zemi ho nechá schovaný", () => {
    const crash = createCrashVisual();
    const events: GameEvent[] = [];
    crash.sync(heli({ mode: "crash", crashAge: 0.4 }), world(1), events, 1);
    const geyser = crash.group.getObjectByName("geyser");
    expect(geyser?.visible).toBe(false);
    crash.sync(heli({ mode: "air" }), world(0), events, 1);
    crash.sync(heli({ x: 8, z: 8, mode: "crash", crashAge: 0.4 }), world(0), events, 2);
    expect(crash.group.getObjectByName("geyser")?.visible).toBe(true);
  });
});

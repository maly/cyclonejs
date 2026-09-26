import { describe, expect, it } from "vitest";
import { createInput } from "./input.ts";

function keyboard(debug = false) {
  const listeners = new Map<string, (event: KeyboardEvent) => void>();
  const target = {
    addEventListener(type: string, fn: (event: KeyboardEvent) => void) {
      listeners.set(type, fn);
    },
  };
  const input = createInput(target as unknown as Window, debug);
  const press = (code: string, type: "keydown" | "keyup") => listeners.get(type)?.({ code, repeat: false, preventDefault() {} } as KeyboardEvent);
  return { input, press };
}

function keyboardDebug() {
  return keyboard(true);
}

describe("klávesy", () => {
  it("stoupá na Q a šipku nahoru, klesá na A a šipku dolů", () => {
    const { input, press } = keyboard();
    press("KeyQ", "keydown");
    expect(input.sample().flight.climb).toBe(true);
    press("KeyQ", "keyup");
    press("ArrowUp", "keydown");
    expect(input.sample().flight.climb).toBe(true);
    press("ArrowUp", "keyup");
    press("KeyA", "keydown");
    expect(input.sample().flight.descend).toBe(true);
    press("KeyA", "keyup");
    press("ArrowDown", "keydown");
    expect(input.sample().flight.descend).toBe(true);
  });

  it("R přepne rozmístění a L v ladění vezme další seed", () => {
    const { input, press } = keyboard();
    press("KeyR", "keydown");
    expect(input.sample().toggleLayout).toBe(true);
    expect(input.sample().reseed).toBe(false);
    const debug = keyboardDebug();
    debug.press("KeyL", "keydown");
    expect(debug.input.sample().reseed).toBe(true);
  });

  it("zatáčí na O, P a šipky a zrychluje mezerníkem", () => {
    const { input, press } = keyboard();
    press("KeyO", "keydown");
    expect(input.sample().flight.turnLeft).toBe(true);
    press("KeyO", "keyup");
    press("ArrowLeft", "keydown");
    expect(input.sample().flight.turnLeft).toBe(true);
    press("ArrowLeft", "keyup");
    press("KeyP", "keydown");
    expect(input.sample().flight.turnRight).toBe(true);
    press("KeyP", "keyup");
    press("ArrowRight", "keydown");
    expect(input.sample().flight.turnRight).toBe(true);
    press("ArrowRight", "keyup");
    press("Space", "keydown");
    const command = input.sample();
    expect(command.flight.forward).toBe(true);
    expect(command.confirm).toBe(true);
  });
});

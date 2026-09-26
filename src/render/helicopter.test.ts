import { describe, expect, it } from "vitest";
import { createHeliVisual } from "./helicopter.ts";
import { ROPE_DIAMETER } from "./style.ts";

describe("vrtulník", () => {
  it("má nos na lokálním −Z a ocas na +Z", () => {
    const heli = createHeliVisual();
    expect(heli.nose.position.z).toBeLessThan(0);
    expect(heli.tail.position.z).toBeGreaterThan(0);
    expect(heli.shadow).toBeTruthy();
  });

  it("lano má průměr 0,04 buňky", () => {
    expect(ROPE_DIAMETER).toBeCloseTo(0.04);
  });
});

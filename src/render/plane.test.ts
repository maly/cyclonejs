import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { createPlaneVisual } from "./plane.ts";

describe("letadlo", () => {
  it("má nos na lokálním −Z ve směru letu na sever", () => {
    const plane = createPlaneVisual();
    plane.update({ x: 10, y: 4, z: 20, dirX: 0, dirZ: -1, warning: false });
    const nose = plane.group.getObjectByName("nose");
    expect(nose).toBeTruthy();
    const point = new Vector3();
    nose!.getWorldPosition(point);
    expect(point.z).toBeLessThan(20);
    expect(point.x).toBeCloseTo(10, 1);
  });

  it("při letu na východ míří nos na +X", () => {
    const plane = createPlaneVisual();
    plane.update({ x: 0, y: 0, z: 0, dirX: 1, dirZ: 0, warning: false });
    const point = new Vector3();
    plane.group.getObjectByName("nose")!.getWorldPosition(point);
    expect(point.x).toBeGreaterThan(0.5);
    expect(point.z).toBeCloseTo(0, 1);
  });
});

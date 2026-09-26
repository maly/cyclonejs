import { OrthographicCamera, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { approachAngle, cameraOffset, heliYaw, isoEuler, noseDirection, viewAzimuth } from "./cameraMath.ts";

function viewDirection(azimuth: number): Vector3 {
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  camera.rotation.order = "YXZ";
  const rotation = isoEuler(azimuth);
  camera.rotation.set(rotation.x, rotation.y, rotation.z);
  const offset = cameraOffset(azimuth, 22);
  camera.position.set(offset.x, offset.y, offset.z);
  camera.updateMatrixWorld();
  return camera.getWorldDirection(new Vector3());
}

describe("kamera a kurz", () => {
  it("dává jih na +Z a sever na −Z", () => {
    expect(viewAzimuth("south")).toBe(0);
    expect(viewAzimuth("north")).toBe(Math.PI);
    const south = cameraOffset(0, 22);
    const north = cameraOffset(Math.PI, 22);
    expect(south.x).toBeCloseTo(0);
    expect(south.z).toBeCloseTo(22);
    expect(south.y).toBe(22);
    expect(north.z).toBeCloseTo(-22);
    expect(north.x).toBeCloseTo(0, 5);
    const southView = viewDirection(0);
    const northView = viewDirection(Math.PI);
    expect(southView.x).toBeCloseTo(0, 5);
    expect(southView.z).toBeLessThan(0);
    expect(Math.abs(southView.y)).toBeCloseTo(Math.abs(southView.z), 5);
    expect(northView.x).toBeCloseTo(0, 5);
    expect(northView.z).toBeGreaterThan(0);
    expect(Math.abs(northView.y)).toBeCloseTo(Math.abs(northView.z), 5);
  });

  it("otáčí nos na sever a na východ", () => {
    expect(heliYaw(0)).toBeCloseTo(0);
    expect(noseDirection(0).x).toBeCloseTo(0);
    expect(noseDirection(0).z).toBeCloseTo(-1);
    const east = noseDirection(Math.PI / 2);
    expect(east.x).toBeCloseTo(1);
    expect(east.z).toBeCloseTo(0);
    expect(heliYaw(Math.PI / 2)).toBeCloseTo(-Math.PI / 2);
  });

  it("přejede z jihu na sever za daný krok a zastaví se", () => {
    let azimuth = 0;
    for (let i = 0; i < 30; i++) azimuth = approachAngle(azimuth, Math.PI, Math.PI / 8);
    expect(Math.cos(azimuth)).toBeCloseTo(-1);
    expect(approachAngle(azimuth, Math.PI, 0.01)).toBe(Math.PI);
  });
});

import {
  BoxGeometry,
  CircleGeometry,
  CylinderGeometry,
  SphereGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
} from "three";
import { MAX_SPEED } from "../sim/config.ts";
import type { HeliState } from "../sim/helicopter.ts";
import { heliYaw } from "./cameraMath.ts";
import { HELI_DARK, HELI_GLASS, HELI_PAINT, HELI_ROTOR } from "./style.ts";

export interface HeliVisual {
  root: Group;
  shadow: Mesh;
  nose: Object3D;
  tail: Object3D;
  update(state: HeliState, dt: number, groundY: number): void;
}

export function createHeliVisual(): HeliVisual {
  const paint = lambert(HELI_PAINT);
  const dark = lambert(HELI_DARK);
  const glass = lambert(HELI_GLASS);
  glass.transparent = true;
  glass.opacity = 0.88;
  glass.depthWrite = false;
  const bladeMat = lambert(HELI_ROTOR);
  bladeMat.transparent = true;
  bladeMat.opacity = 0.55;
  bladeMat.depthWrite = false;
  const diskMat = new MeshBasicMaterial({
    color: 0x141416,
    transparent: true,
    opacity: 0.18,
    depthWrite: false,
    side: DoubleSide,
  });
  const root = new Group();
  root.name = "helicopter";
  const attitude = new Group();
  root.add(attitude);

  // Trup sedí ve stejném rozmezí jako dřív: nos na lokálním −Z, ocas na +Z, rotor o průměru 2,2.
  tube(attitude, paint, 0.22, 0.22, 0.52, 16, 0, 0.36, -0.06);
  tube(attitude, paint, 0.22, 0.11, 0.24, 16, 0, 0.34, -0.4);
  windowPane(attitude, glass, dark, 0.4, 0.15, 0.03, 0, 0.42, -0.46, 0.45, 0);
  windowPane(attitude, glass, dark, 0.26, 0.12, 0.03, -0.22, 0.4, -0.08, 0, Math.PI / 2);
  windowPane(attitude, glass, dark, 0.26, 0.12, 0.03, 0.22, 0.4, -0.08, 0, -Math.PI / 2);
  windowPane(attitude, glass, dark, 0.26, 0.12, 0.03, 0, 0.42, 0.2, 0, 0);
  tube(attitude, paint, 0.038, 0.055, 0.78, 8, 0, 0.4, 0.52);
  const fin = orb(attitude, paint, 0.18, 8, 6, 0, 0.52, 0.98);
  fin.scale.set(0.16, 1.2, 0.42);
  tube(attitude, paint, 0.018, 0.018, 0.34, 6, 0, 0.4, 0.86, 0, 0, Math.PI / 2);
  tube(attitude, dark, 0.018, 0.018, 0.82, 6, -0.24, 0.07, -0.08);
  tube(attitude, dark, 0.018, 0.018, 0.82, 6, 0.24, 0.07, -0.08);
  for (const [x, z] of [[-0.24, -0.36], [0.24, -0.36], [-0.24, 0.18], [0.24, 0.18]] as const) {
    tube(attitude, dark, 0.012, 0.012, 0.24, 5, x, 0.18, z, 0);
  }

  const mast = new Mesh(new CylinderGeometry(0.03, 0.03, 0.16, 6), dark);
  mast.position.set(0, 0.58, -0.12);
  attitude.add(mast);

  const mainRotor = new Group();
  mainRotor.position.set(0, 0.68, -0.12);
  const disk = new Mesh(new CircleGeometry(1.1, 28), diskMat);
  disk.rotation.x = -Math.PI / 2;
  disk.renderOrder = 2;
  mainRotor.add(disk);
  box(mainRotor, bladeMat, 2.05, 0.012, 0.07, 0, 0.01, 0);
  box(mainRotor, bladeMat, 0.07, 0.012, 2.05, 0, 0.01, 0);

  const tailRotor = new Group();
  tailRotor.position.set(0.08, 0.52, 0.96);
  const tailDisk = new Mesh(new CircleGeometry(0.2, 16), diskMat);
  tailDisk.rotation.y = Math.PI / 2;
  tailRotor.add(tailDisk);
  box(tailRotor, bladeMat, 0.02, 0.38, 0.035, 0, 0, 0);
  box(tailRotor, bladeMat, 0.02, 0.035, 0.38, 0, 0, 0);
  attitude.add(mainRotor, tailRotor);

  // Nos je lokální −Z. Stejné místo používá ladicí sonda v main.ts.
  const nose = new Object3D();
  nose.name = "nose";
  nose.position.set(0, 0.4, -0.9);
  const tail = new Object3D();
  tail.name = "tail";
  tail.position.set(0, 0.4, 1.05);
  attitude.add(nose, tail);

  const shadow = new Mesh(
    new CircleGeometry(0.9, 28),
    new MeshBasicMaterial({ color: 0x102018, transparent: true, opacity: 0.38, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.renderOrder = 1;
  shadow.castShadow = false;
  shadow.receiveShadow = false;

  let spin = 0;
  let smoothedPitch = 0;
  let smoothedBank = 0;
  let previousHeading = 0;
  let previousSpeed = 0;
  let ready = false;

  return {
    root,
    shadow,
    nose,
    tail,
    update(state, dt, groundY) {
      root.position.set(state.x, state.y, state.z);
      const step = dt > 0 ? dt : 1 / 60;
      if (!ready) {
        previousHeading = state.heading;
        previousSpeed = state.speed;
        ready = true;
      }
      let headingDelta = state.heading - previousHeading;
      if (headingDelta > Math.PI) headingDelta -= Math.PI * 2;
      if (headingDelta < -Math.PI) headingDelta += Math.PI * 2;
      const yawRate = headingDelta / step;
      const accel = (state.speed - previousSpeed) / step;
      previousHeading = state.heading;
      previousSpeed = state.speed;

      if (state.mode === "crash") {
        root.rotation.y = heliYaw(state.heading) + state.crashAge * 3;
        attitude.rotation.x = state.crashAge * 2.4;
        attitude.rotation.z = Math.sin(state.crashAge * 8) * 0.7;
      } else {
        root.rotation.y = heliYaw(state.heading);
        const bank = clamp(-yawRate * 0.12, -0.4, 0.4);
        const pitch = clamp((state.speed / MAX_SPEED) * 0.12 + accel * 0.04, -0.28, 0.32);
        const blend = 1 - Math.exp(-8 * step);
        smoothedBank += (bank - smoothedBank) * blend;
        smoothedPitch += (pitch - smoothedPitch) * blend;
        attitude.rotation.z = smoothedBank;
        attitude.rotation.x = smoothedPitch;
      }

      const spinning = state.mode !== "crash";
      const fast = state.mode === "air";
      const rotorRate = state.mode === "ground" ? 10 : 22;
      if (spinning) spin += rotorRate * step;
      mainRotor.rotation.y = spin;
      tailRotor.rotation.x = spin * 1.7;
      bladeMat.opacity = fast ? 0.22 : 0.4;
      diskMat.opacity = fast ? 0.22 : 0.28;
      disk.visible = spinning;
      shadow.position.set(state.x, groundY + 0.06, state.z);
      const lift = clamp((state.y - groundY) / 8, 0, 1);
      (shadow.material as MeshBasicMaterial).opacity = 0.4 * (1 - lift * 0.65);
    },
  };
}

function lambert(color: readonly [number, number, number]): MeshLambertMaterial {
  const material = new MeshLambertMaterial();
  material.color.setRGB(color[0], color[1], color[2]);
  return material;
}

function place(mesh: Mesh, x: number, y: number, z: number): Mesh {
  mesh.position.set(x, y, z);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}

function windowPane(
  parent: Group,
  glass: MeshLambertMaterial,
  frame: MeshLambertMaterial,
  width: number,
  height: number,
  depth: number,
  x: number,
  y: number,
  z: number,
  rotX: number,
  rotY: number,
): void {
  const group = new Group();
  group.position.set(x, y, z);
  group.rotation.set(rotX, rotY, 0);
  const lens = new Mesh(new BoxGeometry(width, height, depth), glass);
  group.add(lens);
  const bar = 0.03;
  const lip = depth + 0.012;
  const mullion = (w: number, h: number, d: number, px: number, py: number, pz: number) => {
    const mesh = new Mesh(new BoxGeometry(w, h, d), frame);
    mesh.position.set(px, py, pz);
    return mesh;
  };
  group.add(mullion(width + bar, bar, lip, 0, height / 2, 0));
  group.add(mullion(width + bar, bar, lip, 0, -height / 2, 0));
  group.add(mullion(bar, height, lip, -width / 2, 0, 0));
  group.add(mullion(bar, height, lip, width / 2, 0, 0));
  group.add(mullion(bar * 0.7, height, lip + 0.008, 0, 0, 0));
  parent.add(group);
}

function orb(parent: Group, material: MeshLambertMaterial, radius: number, width: number, height: number, x: number, y: number, z: number): Mesh {
  const mesh = place(new Mesh(new SphereGeometry(radius, width, height), material), x, y, z);
  parent.add(mesh);
  return mesh;
}

function tube(
  parent: Group,
  material: MeshLambertMaterial,
  radiusTop: number,
  radiusBottom: number,
  length: number,
  segments: number,
  x: number,
  y: number,
  z: number,
  rotX = Math.PI / 2,
  rotY = 0,
  rotZ = 0,
): Mesh {
  const mesh = place(new Mesh(new CylinderGeometry(radiusTop, radiusBottom, length, segments), material), x, y, z);
  mesh.rotation.set(rotX, rotY, rotZ);
  parent.add(mesh);
  return mesh;
}

function box(parent: Group, material: MeshLambertMaterial, width: number, height: number, depth: number, x: number, y: number, z: number): void {
  const mesh = new Mesh(new BoxGeometry(width, height, depth), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  parent.add(mesh);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

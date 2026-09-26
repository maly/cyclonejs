import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshLambertMaterial,
  Object3D,
  ShaderMaterial,
  Vector3,
} from "three";
import type { GameView } from "../sim/game.ts";
import { PLANE_BODY, PLANE_DARK, PLANE_GLASS, PLANE_TRAIL } from "./style.ts";

export interface PlaneVisual {
  group: Group;
  update(plane: GameView["plane"]): void;
}

const TRAIL_LIFE = 0.85;
/** Šíp křídel. Kladné otočení kolem Y posune levý konec dozadu, na lokální +Z. */
const SWEEP = 0.62;

/** Proudové letadlo. Nos je lokální −Z a míří ve směru dir, stejně jako u vrtulníku. */
export function createPlaneVisual(): PlaneVisual {
  const body = tint(PLANE_BODY);
  const dark = tint(PLANE_DARK);
  const glass = tint(PLANE_GLASS);
  glass.transparent = true;
  glass.opacity = 0.55;
  glass.depthWrite = false;

  const root = new Group();
  root.name = "plane";
  const airframe = new Group();
  root.add(airframe);

  const fuselage = new Mesh(new CylinderGeometry(0.11, 0.13, 1.35, 6), body);
  fuselage.rotation.x = Math.PI / 2;
  fuselage.position.z = -0.05;
  const noseCone = new Mesh(new CylinderGeometry(0.02, 0.11, 0.42, 6), dark);
  noseCone.rotation.x = Math.PI / 2;
  noseCone.position.z = -0.9;
  const cockpit = new Mesh(new BoxGeometry(0.16, 0.08, 0.28), glass);
  cockpit.position.set(0, 0.12, -0.45);
  airframe.add(fuselage, noseCone, cockpit);

  const wingGeom = new BoxGeometry(0.92, 0.035, 0.2);
  const wingL = new Mesh(wingGeom, body);
  wingL.position.set(-0.52, 0, 0.02);
  wingL.rotation.y = SWEEP;
  const wingR = new Mesh(wingGeom, body);
  wingR.position.set(0.52, 0, 0.02);
  wingR.rotation.y = -SWEEP;
  airframe.add(wingL, wingR);

  const engineGeom = new CylinderGeometry(0.055, 0.07, 0.32, 6);
  const engineL = engine(engineGeom, dark, -0.38);
  const engineR = engine(engineGeom, dark, 0.38);
  airframe.add(engineL, engineR);

  const stabGeom = new BoxGeometry(0.38, 0.03, 0.12);
  const stabL = new Mesh(stabGeom, body);
  stabL.position.set(-0.22, 0.04, 0.62);
  stabL.rotation.y = 0.4;
  const stabR = new Mesh(stabGeom, body);
  stabR.position.set(0.22, 0.04, 0.62);
  stabR.rotation.y = -0.4;
  const fin = new Mesh(new BoxGeometry(0.045, 0.32, 0.28), dark);
  fin.position.set(0, 0.22, 0.68);
  fin.rotation.x = -0.35;
  airframe.add(stabL, stabR, fin);

  const nose = new Object3D();
  nose.name = "nose";
  nose.position.z = -1.05;
  airframe.add(nose);

  const trail = trailMesh();
  root.add(trail.mesh);

  const left: Puff[] = [];
  const right: Puff[] = [];
  const leftPoint = new Vector3();
  const rightPoint = new Vector3();
  let clock = 0;

  return {
    group: root,
    update(plane) {
      clock += 1 / 60;
      if (!plane) {
        root.visible = false;
        left.length = 0;
        right.length = 0;
        trail.clear();
        return;
      }
      root.visible = true;
      airframe.position.set(plane.x, plane.y, plane.z);
      const heading = Math.atan2(plane.dirX, -plane.dirZ);
      airframe.rotation.y = -heading;
      airframe.updateWorldMatrix(true, true);
      engineL.getWorldPosition(leftPoint);
      engineR.getWorldPosition(rightPoint);
      remember(left, leftPoint, clock);
      remember(right, rightPoint, clock);
      trail.write(left, right, clock);
    },
  };
}

function engine(geometry: CylinderGeometry, material: MeshLambertMaterial, x: number): Mesh {
  const mesh = new Mesh(geometry, material);
  mesh.rotation.x = Math.PI / 2;
  mesh.position.set(x, -0.04, 0.12);
  return mesh;
}

function tint(color: readonly [number, number, number]): MeshLambertMaterial {
  const material = new MeshLambertMaterial();
  material.color.setRGB(color[0], color[1], color[2]);
  return material;
}

type Puff = { x: number; y: number; z: number; born: number };

function remember(list: Puff[], point: Vector3, time: number): void {
  const last = list[list.length - 1];
  if (!last || Math.hypot(point.x - last.x, point.y - last.y, point.z - last.z) > 0.28) {
    list.push({ x: point.x, y: point.y, z: point.z, born: time });
  }
  while (list.length > 0 && time - list[0].born > TRAIL_LIFE) list.shift();
}

function trailMesh(): { mesh: Mesh; clear(): void; write(left: Puff[], right: Puff[], time: number): void } {
  const geometry = new BufferGeometry();
  const positions = new Float32Array(2 * 48 * 6 * 3);
  const fade = new Float32Array(2 * 48 * 6);
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("aFade", new Float32BufferAttribute(fade, 1));
  const material = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    vertexShader: `
      attribute float aFade;
      varying float vFade;
      void main() {
        vFade = aFade;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying float vFade;
      void main() {
        gl_FragColor = vec4(${PLANE_TRAIL[0].toFixed(3)}, ${PLANE_TRAIL[1].toFixed(3)}, ${PLANE_TRAIL[2].toFixed(3)}, vFade * 0.55);
      }
    `,
  });
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  return {
    mesh,
    clear() {
      geometry.setDrawRange(0, 0);
    },
    write(left, right, time) {
      let vertex = 0;
      vertex = ribbon(left, time, positions, fade, vertex);
      vertex = ribbon(right, time, positions, fade, vertex);
      geometry.getAttribute("position").needsUpdate = true;
      geometry.getAttribute("aFade").needsUpdate = true;
      geometry.setDrawRange(0, vertex);
    },
  };
}

function ribbon(list: Puff[], time: number, positions: Float32Array, fade: Float32Array, vertex: number): number {
  for (let index = 0; index < list.length - 1 && vertex < positions.length / 3 - 6; index++) {
    const a = list[index];
    const b = list[index + 1];
    let dx = b.x - a.x;
    let dz = b.z - a.z;
    const span = Math.hypot(dx, dz) || 1;
    dx /= span;
    dz /= span;
    const ageA = Math.min(1, (time - a.born) / TRAIL_LIFE);
    const ageB = Math.min(1, (time - b.born) / TRAIL_LIFE);
    const widthA = 0.04 + ageA * 0.22;
    const widthB = 0.04 + ageB * 0.22;
    const quad = [
      [a.x - dz * widthA, a.y, a.z + dx * widthA, 1 - ageA],
      [a.x + dz * widthA, a.y, a.z - dx * widthA, 1 - ageA],
      [b.x + dz * widthB, b.y, b.z - dx * widthB, 1 - ageB],
      [b.x - dz * widthB, b.y, b.z + dx * widthB, 1 - ageB],
    ] as const;
    for (const corner of [0, 1, 2, 0, 2, 3]) {
      const point = quad[corner];
      positions[vertex * 3] = point[0];
      positions[vertex * 3 + 1] = point[1];
      positions[vertex * 3 + 2] = point[2];
      fade[vertex] = point[3];
      vertex += 1;
    }
  }
  return vertex;
}

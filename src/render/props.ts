import {
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { GameView } from "../sim/game.ts";
import type { TreeObstacle, World } from "../sim/world.ts";
import { CRATE_GRAB, PERSON_GRAB, WINCH_EXTEND, WINCH_HEIGHT, WINCH_RANGE } from "../sim/config.ts";
import { createBuildings } from "./buildings.ts";
import { CRATE_CROSS, CRATE_SLAT, CRATE_WHITE, CRATE_WOOD, HAIR, HOOK_COLOR, MAN_PANTS, MAN_SHIRT, POPLAR_BARK, POPLAR_LEAF, ROPE_COLOR, ROPE_DIAMETER, SKIN, SPRUCE_BARK, SPRUCE_LEAF, WOMAN_DRESS } from "./style.ts";
import { heightAt } from "../sim/world.ts";
const skinMat = tint(SKIN);
const hairMat = tint(HAIR);
const manShirt = tint(MAN_SHIRT);
const manPants = tint(MAN_PANTS);
const womanDress = tint(WOMAN_DRESS);

export interface PropActors {
  group: Group;
  sync(view: GameView, time: number): void;
  relayout(): void;
}

export function createProps(world: World): PropActors {
  const group = new Group();
  group.name = "props";
  const trees = createTrees(world.trees);
  group.add(trees.group, createBuildings(world));

  let people: { group: Group; arms: Group[]; x: number; z: number; base: number; seed: number }[] = [];
  let crates: { group: Group; x: number; z: number; base: number }[] = [];
  const mountActors = () => {
    for (const person of people) person.group.removeFromParent();
    for (const crate of crates) crate.group.removeFromParent();
    people = [];
    crates = [];
    for (const person of world.people) {
      const model = personModel(person.type);
      const base = groundAt(world, person.x, person.z);
      model.group.position.set(person.x + 0.5, base, person.z + 0.5);
      group.add(model.group);
      people.push({ group: model.group, arms: model.arms, x: person.x + 0.5, z: person.z + 0.5, base, seed: hash(person.x, person.z) });
    }
    for (const crate of world.crates) {
      const holder = crateModel();
      const base = groundAt(world, crate.x, crate.z);
      holder.position.set(crate.x + 0.5, base, crate.z + 0.5);
      group.add(holder);
      crates.push({ group: holder, x: crate.x + 0.5, z: crate.z + 0.5, base });
    }
  };
  mountActors();

  const winch = createWinch();
  group.add(winch.group);
  let ropeLength = 0;
  let previousTime = 0;
  let hooked: string | null = null;
  const extendSpeed = WINCH_HEIGHT / WINCH_EXTEND;

  return {
    group,
    relayout() {
      mountActors();
    },
    sync(view, time) {
      trees.sway(time, view.wind);
      const dt = previousTime > 0 ? Math.min(0.05, Math.max(0, time - previousTime)) : 1 / 60;
      previousTime = time;
      const phase = Math.floor(time * 3) % 2 === 1;
      const topY = view.heli.y + 0.1;
      const winchKey = view.winch ? `${view.winch.kind}:${view.winch.index}` : null;
      if (winchKey === null) hooked = null;
      const anchor = grabOf(view.winch?.kind);
      const reach = view.winch ? hookGap(view, topY) : deployedReach(world, view, people, crates, topY);
      if (view.heli.mode === "air" && view.winch && hooked === winchKey) {
        const live = Math.max(0.08, topY - (view.winch.y + anchor));
        ropeLength = ropeLength > live ? Math.max(live, ropeLength - extendSpeed * dt) : live;
      } else if (view.heli.mode === "air" && (view.winch || overTarget(view, people, crates))) {
        ropeLength = approach(ropeLength, reach, extendSpeed * dt);
        if (view.winch && ropeLength >= reach - 0.04) hooked = winchKey;
      } else {
        ropeLength = approach(ropeLength, 0, extendSpeed * dt);
      }
      const carried = view.winch !== null && hooked === winchKey;
      for (let i = 0; i < people.length; i++) {
        const person = people[i];
        person.group.visible = !view.collectedPeople[i];
        if (carried && view.winch?.kind === "person" && view.winch.index === i) {
          person.group.position.set(view.heli.x, topY - ropeLength - anchor, view.heli.z);
        } else person.group.position.set(person.x, person.base, person.z);
        const wave = Math.sin(time * 5 + person.seed * 6);
        person.arms[0].rotation.z = 2.15 + wave * 0.4;
        person.arms[1].rotation.z = -(2.15 + Math.sin(time * 5 + person.seed * 6 + 1.1) * 0.4);
      }
      for (let i = 0; i < crates.length; i++) {
        const crate = crates[i];
        crate.group.visible = !view.collectedCrates[i];
        if (carried && view.winch?.kind === "crate" && view.winch.index === i) {
          crate.group.position.set(view.heli.x, topY - ropeLength - anchor, view.heli.z);
        } else crate.group.position.set(crate.x, crate.base, crate.z);
      }
      if (ropeLength <= 0.03) {
        winch.hide();
        return;
      }
      winch.hang(view.heli.x, view.heli.z, topY, ropeLength);
    },
  };
}

function approach(current: number, goal: number, step: number): number {
  const delta = goal - current;
  return current + Math.sign(delta) * Math.min(Math.abs(delta), step);
}

function grabOf(kind: "crate" | "person" | undefined): number {
  return kind === "person" ? PERSON_GRAB : CRATE_GRAB;
}

function deployedReach(
  world: World,
  view: GameView,
  people: readonly { x: number; z: number }[],
  crates: readonly { x: number; z: number }[],
  topY: number,
): number {
  const ground = heightAt(world, view.heli.x, view.heli.z);
  const grab = grabBelow(view, people, crates) ?? 0;
  return Math.min(WINCH_HEIGHT, Math.max(0.05, topY - ground - grab));
}

function grabBelow(
  view: GameView,
  people: readonly { x: number; z: number }[],
  crates: readonly { x: number; z: number }[],
): number | null {
  const near = (x: number, z: number) => Math.hypot(view.heli.x - x, view.heli.z - z) <= WINCH_RANGE;
  for (let i = 0; i < crates.length; i++) {
    if (!view.collectedCrates[i] && near(crates[i].x, crates[i].z)) return CRATE_GRAB;
  }
  for (let i = 0; i < people.length; i++) {
    if (!view.collectedPeople[i] && near(people[i].x, people[i].z)) return PERSON_GRAB;
  }
  return null;
}

function hookGap(view: GameView, topY: number): number {
  if (!view.winch) return WINCH_HEIGHT;
  const progress = view.winch.progress;
  const anchor = grabOf(view.winch.kind);
  const base = progress < 0.999 ? (view.winch.y - view.heli.y * progress) / (1 - progress) : view.winch.y;
  return Math.max(0.08, topY - (base + anchor));
}

function overTarget(
  view: GameView,
  people: readonly { x: number; z: number }[],
  crates: readonly { x: number; z: number }[],
): boolean {
  const near = (x: number, z: number) => Math.hypot(view.heli.x - x, view.heli.z - z) <= WINCH_RANGE;
  for (let i = 0; i < crates.length; i++) {
    if (!view.collectedCrates[i] && near(crates[i].x, crates[i].z)) return true;
  }
  for (let i = 0; i < people.length; i++) {
    if (!view.collectedPeople[i] && near(people[i].x, people[i].z)) return true;
  }
  return false;
}

function createWinch(): { group: Group; hide(): void; hang(x: number, z: number, topY: number, length: number): void } {
  const group = new Group();
  group.name = "winch";
  const ropeMat = new MeshLambertMaterial();
  ropeMat.color.setRGB(ROPE_COLOR[0], ROPE_COLOR[1], ROPE_COLOR[2]);
  const rope = new Mesh(new CylinderGeometry(ROPE_DIAMETER / 2, ROPE_DIAMETER / 2, 1, 5), ropeMat);
  rope.castShadow = false;
  const hookMat = new MeshLambertMaterial();
  hookMat.color.setRGB(HOOK_COLOR[0], HOOK_COLOR[1], HOOK_COLOR[2]);
  const hook = new Group();
  const shank = new Mesh(new BoxGeometry(0.025, 0.1, 0.025), hookMat);
  shank.position.y = -0.04;
  const bend = new Mesh(new TorusGeometry(0.045, 0.012, 6, 10, Math.PI), hookMat);
  bend.position.y = -0.09;
  bend.rotation.x = Math.PI / 2;
  hook.add(shank, bend);
  group.add(rope, hook);
  group.visible = false;

  return {
    group,
    hide() {
      group.visible = false;
    },
    hang(x, z, topY, length) {
      const drop = Math.max(0.05, length);
      group.visible = true;
      rope.scale.set(1, drop, 1);
      rope.position.set(x, topY - drop / 2, z);
      rope.quaternion.identity();
      hook.position.set(x, topY - drop, z);
      hook.quaternion.identity();
    },
  };
}

function crateModel(): Group {
  const wood = tint(CRATE_WOOD);
  const slat = tint(CRATE_SLAT);
  const white = tint(CRATE_WHITE);
  const cross = tint(CRATE_CROSS);
  const group = new Group();
  const body = new Mesh(new BoxGeometry(0.46, 0.4, 0.46), wood);
  body.position.y = 0.22;
  group.add(body);
  for (const y of [0.08, 0.22, 0.36]) {
    const board = new Mesh(new BoxGeometry(0.52, 0.055, 0.52), slat);
    board.position.y = y;
    group.add(board);
  }
  const panel = new Mesh(new BoxGeometry(0.38, 0.32, 0.02), white);
  panel.position.set(0, 0.24, 0.24);
  const upright = new Mesh(new BoxGeometry(0.08, 0.26, 0.03), cross);
  upright.name = "cross";
  upright.position.set(0, 0.24, 0.255);
  const bar = new Mesh(new BoxGeometry(0.3, 0.08, 0.03), cross);
  bar.position.set(0, 0.24, 0.255);
  const topPanel = new Mesh(new BoxGeometry(0.34, 0.02, 0.34), white);
  topPanel.position.set(0, 0.43, 0);
  const topUpright = new Mesh(new BoxGeometry(0.08, 0.03, 0.26), cross);
  topUpright.position.set(0, 0.45, 0);
  const topBar = new Mesh(new BoxGeometry(0.26, 0.03, 0.08), cross);
  topBar.position.set(0, 0.445, 0);
  group.add(panel, upright, bar, topPanel, topUpright, topBar);
  return group;
}

function tint(color: readonly [number, number, number]): MeshLambertMaterial {
  const material = new MeshLambertMaterial();
  material.color.setRGB(color[0], color[1], color[2]);
  return material;
}

function createTrees(trees: readonly TreeObstacle[]): { group: Group; sway(time: number, wind: number): void } {
  const group = new Group();
  group.name = "trees";
  const wind = { uTime: { value: 0 }, uWind: { value: 0 } };
  const kinds = [
    { type: "topol", crown: poplarCrown(), bark: POPLAR_BARK, leaf: POPLAR_LEAF },
    { type: "smrk_a", crown: spruceCrown("a"), bark: SPRUCE_BARK, leaf: SPRUCE_LEAF[0] },
    { type: "smrk_b", crown: spruceCrown("b"), bark: SPRUCE_BARK, leaf: SPRUCE_LEAF[1] },
    { type: "smrk_c", crown: spruceCrown("c"), bark: SPRUCE_BARK, leaf: SPRUCE_LEAF[2] },
  ] as const;
  const poplarStem = trunkGeometry(1.15, 0.055);
  const spruceStem = trunkGeometry(2.35, 0.03);
  for (const kind of kinds) {
    const subset = trees.filter((tree) => tree.type === kind.type);
    if (subset.length === 0) continue;
    group.add(plant(subset, kind.type === "topol" ? poplarStem : spruceStem, kind.bark, wind, 0.35));
    group.add(plant(subset, kind.crown, kind.leaf, wind, 1));
  }
  return {
    group,
    sway(time, strength) {
      wind.uTime.value = time;
      wind.uWind.value = strength;
    },
  };
}

function plant(
  trees: readonly TreeObstacle[],
  source: BufferGeometry,
  color: readonly [number, number, number],
  wind: { uTime: { value: number }; uWind: { value: number } },
  sway: number,
): InstancedMesh {
  const geometry = source.clone();
  const material = foliageMaterial(wind, sway);
  const mesh = new InstancedMesh(geometry, material, trees.length);
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  const seeds = new Float32Array(trees.length);
  const matrix = new Matrix4();
  const rotation = new Quaternion();
  const position = new Vector3();
  const scale = new Vector3();
  const tint = new Color();
  const up = new Vector3(0, 1, 0);
  for (let index = 0; index < trees.length; index++) {
    const tree = trees[index];
    const spin = hash(tree.x, tree.z);
    const plump = hash(tree.x + 19, tree.z + 3);
    const tall = hash(tree.z, tree.x + 7);
    seeds[index] = spin;
    rotation.setFromAxisAngle(up, spin * Math.PI * 2);
    scale.set(0.86 + plump * 0.28, 0.9 + tall * 0.18, 0.86 + plump * 0.28);
    position.set(tree.x + 0.5, tree.base, tree.z + 0.5);
    matrix.compose(position, rotation, scale);
    mesh.setMatrixAt(index, matrix);
    tint.setRGB(
      color[0] * (0.86 + plump * 0.28),
      color[1] * (0.88 + tall * 0.22),
      color[2] * (0.9 + spin * 0.16),
    );
    mesh.setColorAt(index, tint);
  }
  geometry.setAttribute("aSeed", new InstancedBufferAttribute(seeds, 1));
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  return mesh;
}

function foliageMaterial(
  wind: { uTime: { value: number }; uWind: { value: number } },
  sway: number,
): MeshLambertMaterial {
  const material = new MeshLambertMaterial({ color: 0xffffff });
  material.customProgramCacheKey = () => `cyclone-tree-${sway}`;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = wind.uTime;
    shader.uniforms.uWind = wind.uWind;
    shader.uniforms.uSway = { value: sway };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float aSeed;\nuniform float uTime;\nuniform float uWind;\nuniform float uSway;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        float gust = sin(uTime * (0.85 + aSeed * 0.35) + aSeed * 12.0);
        float bend = gust * (0.012 + uWind * 0.08) * uSway;
        transformed.x += bend * position.y;
        transformed.z += cos(uTime * 0.55 + aSeed * 9.0) * bend * position.y * 0.7;`,
      );
  };
  return material;
}

function trunkGeometry(height: number, radius: number): BufferGeometry {
  const geometry = new CylinderGeometry(radius * 0.75, radius, height, 5);
  geometry.translate(0, height * 0.5, 0);
  return geometry;
}

function poplarCrown(): BufferGeometry {
  const rand = mulberry(19);
  const clumps = [
    [0.1, 0.85, 0.26, 0.22],
    [-0.12, 1.15, 0.3, 0.24],
    [0.08, 1.48, 0.28, 0.26],
    [-0.1, 1.82, 0.32, 0.24],
    [0.11, 2.14, 0.27, 0.22],
    [-0.05, 2.46, 0.24, 0.2],
  ];
  return mergeGeometries(clumps.map(([x, y, rx, ry]) => place(lump(rand, rx, ry, rx * 0.8), x, y, (rand() - 0.5) * 0.1))) ?? new BufferGeometry();
}

function spruceCrown(kind: "a" | "b" | "c"): BufferGeometry {
  const rand = mulberry(kind === "a" ? 4 : kind === "b" ? 8 : 12);
  const tiers = kind === "a" ? 4 : kind === "b" ? 3 : 5;
  const wide = kind === "a" ? 0.62 : kind === "b" ? 0.46 : 0.3;
  const gap = kind === "c" ? 0.42 : 0.55;
  const parts: BufferGeometry[] = [];
  for (let tier = 0; tier < tiers; tier++) {
    const y = 0.78 + tier * gap;
    const reach = wide * (1 - tier / (tiers + 0.8));
    const count = kind === "b" ? 5 : 7;
    for (let arm = 0; arm < count; arm++) {
      const angle = (arm / count) * Math.PI * 2 + rand() * 0.35;
      const radius = reach * (0.85 + rand() * 0.3);
      parts.push(
        place(
          lump(rand, 0.16 + rand() * 0.08, 0.05 + rand() * 0.03, 0.12 + rand() * 0.05),
          Math.cos(angle) * radius,
          y + (rand() - 0.5) * 0.04,
          Math.sin(angle) * radius,
        ),
      );
    }
  }
  parts.push(place(lump(rand, 0.08, 0.1, 0.08), 0, 0.78 + tiers * gap, 0));
  return mergeGeometries(parts) ?? new BufferGeometry();
}

function lump(rand: () => number, rx: number, ry: number, rz: number): BufferGeometry {
  const geometry = new SphereGeometry(1, 6, 4);
  const position = geometry.getAttribute("position");
  for (let index = 0; index < position.count; index++) {
    const jitter = 0.7 + rand() * 0.55;
    position.setXYZ(index, position.getX(index) * rx * jitter, position.getY(index) * ry * (0.75 + rand() * 0.5), position.getZ(index) * rz * jitter);
  }
  geometry.computeVertexNormals();
  return geometry;
}

function place(geometry: BufferGeometry, x: number, y: number, z: number): BufferGeometry {
  geometry.translate(x, y, z);
  return geometry;
}

function mulberry(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function hash(x: number, z: number): number {
  const value = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return value - Math.floor(value);
}

function groundAt(world: World, x: number, z: number): number {
  return heightAt(world, x + 0.5, z + 0.5);
}

function personModel(type: string): { group: Group; arms: Group[] } {
  const woman = type === "zena";
  const group = new Group();
  if (woman) {
    const skirt = new Mesh(new CylinderGeometry(0.11, 0.24, 0.42, 7), womanDress);
    skirt.position.y = 0.22;
    const bodice = new Mesh(new BoxGeometry(0.2, 0.26, 0.14), womanDress);
    bodice.position.y = 0.52;
    group.add(skirt, bodice);
  } else {
    const legL = new Mesh(new BoxGeometry(0.09, 0.34, 0.09), manPants);
    const legR = new Mesh(new BoxGeometry(0.09, 0.34, 0.09), manPants);
    legL.position.set(-0.07, 0.17, 0);
    legR.position.set(0.07, 0.17, 0);
    const torso = new Mesh(new BoxGeometry(0.28, 0.32, 0.16), manShirt);
    torso.position.y = 0.48;
    group.add(legL, legR, torso);
  }
  const face = new Mesh(new SphereGeometry(0.11, 6, 5), skinMat);
  face.position.y = woman ? 0.78 : 0.76;
  const hair = new Mesh(new SphereGeometry(0.1, 6, 4), hairMat);
  hair.scale.set(1.05, 0.55, 1.05);
  hair.position.y = face.position.y + 0.07;
  const shoulder = woman ? 0.14 : 0.18;
  const arms = [0, 1].map((side) => {
    const pivot = new Group();
    pivot.position.set(side === 0 ? -shoulder : shoulder, woman ? 0.6 : 0.6, 0);
    const arm = new Mesh(new BoxGeometry(woman ? 0.06 : 0.07, 0.32, 0.07), skinMat);
    arm.position.y = -0.14;
    pivot.add(arm);
    group.add(pivot);
    return pivot;
  });
  group.add(face, hair);
  return { group, arms };
}

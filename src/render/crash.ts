import {
  BoxGeometry,
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
  CircleGeometry,
  RingGeometry,
  Vector3,
} from "three";
import type { GameEvent } from "../sim/game.ts";
import type { HeliState } from "../sim/helicopter.ts";
import { surfaceAt, type World } from "../sim/world.ts";

const SMOKE = 48;
const DEBRIS = 10;
const GEYSER = 36;

/** Záblesk, kouř, úlomky, a nad vodou gejzír s kruhy. */
export function createCrashVisual(): { group: Group; sync(state: HeliState, world: World, events: readonly GameEvent[], time: number): void } {
  const group = new Group();
  group.name = "crash";
  const flashMat = new MeshBasicMaterial({ color: 0xfff1c9, transparent: true, opacity: 0, depthWrite: false });
  const flash = new Mesh(new CircleGeometry(1.35, 20), flashMat);
  flash.rotation.x = -Math.PI / 2;
  const smokeGeometry = new BufferGeometry();
  const smokePositions = new Float32Array(SMOKE * 3);
  smokeGeometry.setAttribute("position", new Float32BufferAttribute(smokePositions, 3));
  const smoke = new Points(
    smokeGeometry,
    new PointsMaterial({ color: 0x2a3034, size: 22, transparent: true, opacity: 0.8, depthWrite: false, sizeAttenuation: false }),
  );
  const debris: Mesh[] = [];
  const debrisMat = new MeshBasicMaterial({ color: 0xc4a24a });
  for (let i = 0; i < DEBRIS; i++) {
    const chip = new Mesh(new BoxGeometry(0.32, 0.14, 0.4), debrisMat);
    chip.visible = false;
    debris.push(chip);
  }
  const geyserGeometry = new BufferGeometry();
  geyserGeometry.setAttribute("position", new Float32BufferAttribute(new Float32Array(GEYSER * 3), 3));
  const geyser = new Points(
    geyserGeometry,
    new PointsMaterial({ color: 0xd5f2f6, size: 16, transparent: true, opacity: 0.95, depthWrite: false, sizeAttenuation: false }),
  );
  geyser.name = "geyser";
  const rings = [0, 1].map(() => {
    const mesh = new Mesh(
      new RingGeometry(0.8, 1.05, 28),
      new MeshBasicMaterial({ color: 0xe7f7f8, transparent: true, opacity: 0, depthWrite: false, side: DoubleSide }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.visible = false;
    return mesh;
  });
  const pickupMat = new MeshBasicMaterial({ color: 0xfff6c8, transparent: true, opacity: 0, depthWrite: false });
  const pickup = new Mesh(new RingGeometry(0.15, 0.55, 16), pickupMat);
  pickup.rotation.x = -Math.PI / 2;
  pickup.visible = false;
  group.add(flash, smoke, geyser, pickup, ...debris, ...rings);

  let wasCrash = false;
  let water = false;
  let origin = new Vector3();
  let pickupAt = -10;
  const pickupPos = new Vector3();

  return {
    group,
    sync(state, world, events, time) {
      if (events.some((event) => event.type === "pickup")) {
        pickupAt = time;
        pickupPos.set(state.x, state.y, state.z);
      }
      const pickupAge = time - pickupAt;
      pickup.visible = pickupAge >= 0 && pickupAge < 0.4;
      if (pickup.visible) {
        pickup.position.copy(pickupPos);
        pickup.scale.setScalar(0.4 + pickupAge * 4);
        pickupMat.opacity = 1 - pickupAge / 0.4;
      }

      const crashing = state.mode === "crash";
      const jumped = Math.hypot(state.x - origin.x, state.z - origin.z) > 1.5;
      if (crashing && (!wasCrash || jumped)) {
        water = surfaceAt(world, state.x, state.z) === 0;
        origin.set(state.x, Math.max(0.2, state.y), state.z);
      }
      wasCrash = crashing;
      const age = crashing ? state.crashAge : 0;
      flash.visible = crashing && age < 0.7;
      smoke.visible = crashing;
      geyser.visible = crashing && water;
      if (!crashing) {
        for (const chip of debris) chip.visible = false;
        for (const ring of rings) ring.visible = false;
        return;
      }
      flash.position.set(origin.x, origin.y + 0.4, origin.z);
      flash.scale.setScalar(1 + age * 8);
      flashMat.opacity = Math.max(0, 1 - age / 0.55);

      const smokeAttr = smokeGeometry.getAttribute("position") as Float32BufferAttribute;
      for (let i = 0; i < SMOKE; i++) {
        const seed = i * 1.7;
        const column = (i / SMOKE) * (1.4 + age * 5);
        smokeAttr.setXYZ(
          i,
          origin.x + Math.sin(seed) * (0.2 + column * 0.22),
          origin.y + 0.3 + column,
          origin.z + Math.cos(seed * 1.3) * (0.2 + column * 0.22),
        );
      }
      smokeAttr.needsUpdate = true;
      (smoke.material as PointsMaterial).opacity = Math.max(0.2, 0.9 - age * 0.28);

      debris.forEach((chip, i) => {
        const angle = (i / DEBRIS) * Math.PI * 2;
        const speed = 2.2 + (i % 3);
        const vx = Math.cos(angle) * speed;
        const vz = Math.sin(angle) * speed;
        const vy = 3.5 + (i % 4) * 0.4;
        chip.visible = age < 1.8;
        chip.position.set(origin.x + vx * age, origin.y + vy * age - 6 * age * age, origin.z + vz * age);
        chip.rotation.x = age * (3 + i);
        chip.rotation.z = age * 2;
      });

      if (!water) {
        geyser.visible = false;
        for (const ring of rings) ring.visible = false;
        return;
      }
      const spray = geyserGeometry.getAttribute("position") as Float32BufferAttribute;
      for (let i = 0; i < GEYSER; i++) {
        const delay = (i % 6) * 0.04;
        const t = Math.max(0, age - delay);
        const angle = i * 0.7;
        spray.setXYZ(i, origin.x + Math.cos(angle) * t * 0.8, 0.2 + t * 6 - t * t * 4.5, origin.z + Math.sin(angle) * t * 0.8);
      }
      spray.needsUpdate = true;
      rings.forEach((ring, i) => {
        const t = Math.max(0, age - i * 0.18);
        ring.visible = t > 0 && t < 1.6;
        ring.position.set(origin.x, 0.08, origin.z);
        ring.scale.setScalar(0.6 + t * 7);
        (ring.material as MeshBasicMaterial).opacity = Math.max(0, 0.75 * (1 - t / 1.6));
      });
    },
  };
}

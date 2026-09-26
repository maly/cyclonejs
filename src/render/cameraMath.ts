import type { ViewSide } from "../sim/helicopter.ts";

/** Azimut kamery: 0 je jih od cíle, π je sever. Otáčení jde kratší stranou. */
export function viewAzimuth(view: ViewSide): number {
  return view === "south" ? 0 : Math.PI;
}

/**
 * Natočení ortografické kamery bez lookAt. Sklon je 45°, azimut 0 hledí na sever.
 * `rotation.order` musí být YXZ.
 */
export function isoEuler(azimuth: number): { x: number; y: number; z: number } {
  return { x: -Math.PI / 4, y: azimuth, z: 0 };
}

/** Kamera vpravo nahoře od cíle. Jih (0) leží na +Z, sever (π) na −Z. */
export function cameraOffset(azimuth: number, distance: number): { x: number; y: number; z: number } {
  return {
    x: Math.sin(azimuth) * distance,
    y: distance,
    z: Math.cos(azimuth) * distance,
  };
}

/** Nos je lokální −Z, kurz 0 míří na sever (−Z ve světě). Kladné `rotation.y` by nos točilo na západ, proto je znaménko obrácené. */
export function heliYaw(heading: number): number {
  return -heading;
}

/**
 * Světový směr nosu pro daný kurz.
 * Kontrola: kurz 0 → (0, −1), kurz π/2 (východ) → (1, 0).
 * Stejný vektor dává rotace Y o `heliYaw` aplikovaná na lokální (0, 0, −1).
 */
export function noseDirection(heading: number): { x: number; z: number } {
  const yaw = heliYaw(heading);
  // Three.js rotace Y: x' = cos θ·x + sin θ·z, z' = −sin θ·x + cos θ·z. Lokální nos je (0, −1).
  return { x: -Math.sin(yaw), z: -Math.cos(yaw) };
}

export function approachAngle(current: number, target: number, maxStep: number): number {
  const turn = Math.PI * 2;
  let delta = ((target - current + Math.PI) % turn + turn) % turn - Math.PI;
  if (Math.abs(delta) <= maxStep) return target;
  return current + Math.sign(delta) * maxStep;
}

/**
 * Vzhled světa. Jediné místo pro barvy, šířky a světlo.
 * Poměr jasu jižní stěny k horní ploše se počítá až po ACES a převodu do sRGB,
 * tedy tak, jak ho hráč vidí na neutrální šedé ploše.
 */

export const EDGE_WIDTH = 0.08;
export const EDGE_DASHES_PER_CELL = 6.5;
export const EDGE_DASH_DUTY = 0.4;
export const EDGE_DARK = 0.16;
export const EDGE_GAP = 0.46;

export const FOOT_WIDTH = 0.3;
export const FOOT_STRENGTH = 0.42;

export const GRASS_LOW: readonly [number, number, number] = [0.14, 0.36, 0.12];
export const GRASS_HIGH: readonly [number, number, number] = [0.48, 0.54, 0.26];
export const SAND: readonly [number, number, number] = [0.78, 0.69, 0.42];
export const ROAD: readonly [number, number, number] = [0.74, 0.62, 0.28];
export const ROAD_EDGE: readonly [number, number, number] = [0.38, 0.3, 0.14];
export const CONCRETE: readonly [number, number, number] = [0.7, 0.7, 0.67];
export const CONCRETE_WALL: readonly [number, number, number] = [0.46, 0.46, 0.44];
export const ROOF: readonly [number, number, number] = [0.62, 0.2, 0.13];
export const PLASTER: readonly [number, number, number] = [0.78, 0.66, 0.48];
export const WINDOW_FRAME: readonly [number, number, number] = [0.94, 0.9, 0.78];
export const WINDOW_GLASS: readonly [number, number, number] = [0.07, 0.13, 0.18];
export const DOOR: readonly [number, number, number] = [0.4, 0.22, 0.12];
export const POPLAR_BARK: readonly [number, number, number] = [0.52, 0.24, 0.16];
export const POPLAR_LEAF: readonly [number, number, number] = [0.55, 0.69, 0.24];
export const SPRUCE_BARK: readonly [number, number, number] = [0.34, 0.24, 0.16];
export const HELI_PAINT: readonly [number, number, number] = [0.9, 0.74, 0.16];
export const HELI_GLASS: readonly [number, number, number] = [0.22, 0.4, 0.48];
export const HELI_DARK: readonly [number, number, number] = [0.14, 0.14, 0.15];
export const HELI_ROTOR: readonly [number, number, number] = [0.08, 0.08, 0.09];
/** Průměr lana v buňkách. */
export const ROPE_DIAMETER = 0.04;
export const ROPE_COLOR: readonly [number, number, number] = [0.28, 0.2, 0.12];
export const HOOK_COLOR: readonly [number, number, number] = [0.42, 0.43, 0.46];
export const CRATE_WOOD: readonly [number, number, number] = [0.62, 0.4, 0.2];
export const CRATE_SLAT: readonly [number, number, number] = [0.45, 0.28, 0.13];
export const CRATE_WHITE: readonly [number, number, number] = [0.94, 0.93, 0.9];
export const CRATE_CROSS: readonly [number, number, number] = [0.78, 0.1, 0.1];
export const SKIN: readonly [number, number, number] = [0.86, 0.66, 0.5];
export const MAN_SHIRT: readonly [number, number, number] = [0.18, 0.32, 0.55];
export const MAN_PANTS: readonly [number, number, number] = [0.16, 0.18, 0.22];
export const WOMAN_DRESS: readonly [number, number, number] = [0.62, 0.16, 0.28];
export const HAIR: readonly [number, number, number] = [0.22, 0.14, 0.1];
export const PILLAR_SHAFT: readonly [number, number, number] = [0.55, 0.55, 0.53];
export const PILLAR_CAP: readonly [number, number, number] = [0.93, 0.93, 0.9];
export const CHIMNEY: readonly [number, number, number] = [0.42, 0.4, 0.38];
export const PLANE_BODY: readonly [number, number, number] = [0.82, 0.8, 0.74];
export const PLANE_DARK: readonly [number, number, number] = [0.18, 0.2, 0.22];
export const PLANE_GLASS: readonly [number, number, number] = [0.45, 0.62, 0.72];
export const PLANE_TRAIL: readonly [number, number, number] = [0.9, 0.93, 0.95];

export const SPRUCE_LEAF: readonly [readonly [number, number, number], readonly [number, number, number], readonly [number, number, number]] = [
  [0.16, 0.38, 0.18],
  [0.22, 0.46, 0.2],
  [0.1, 0.28, 0.14],
];
export const ROCK_LIGHT: readonly [number, number, number] = [0.62, 0.52, 0.38];
export const ROCK_DARK: readonly [number, number, number] = [0.4, 0.33, 0.24];

export const SEA_SHALLOW: readonly [number, number, number] = [0.28, 0.74, 0.78];
export const SEA_DEEP: readonly [number, number, number] = [0.02, 0.24, 0.42];
export const SEA_FOAM: readonly [number, number, number] = [0.86, 0.95, 0.94];
export const SEA_DASH: readonly [number, number, number] = [0.92, 0.98, 0.97];

/** Od cíle ke slunci. Jižní stěna (normála +Z) dostane méně než horní plocha. */
export const SUN_DIR: readonly [number, number, number] = [0.1, 1, 0.3];
export const SUN_COLOR: readonly [number, number, number] = [1, 0.957, 0.84];
export const SUN_INTENSITY = 1.5;
export const HEMI_SKY: readonly [number, number, number] = [0.93, 0.97, 1];
export const HEMI_GROUND: readonly [number, number, number] = [0.36, 0.46, 0.44];
export const HEMI_INTENSITY = 0.32;

export const ESTIMATE_COLOR: readonly [number, number, number] = [0.95, 0.75, 0.15];

export const ISSUE_COLOR = {
  conflict: [1, 0.08, 0.05],
  violation: [1, 0.55, 0.05],
  collision: [0.75, 0.15, 1],
} as const;

const ACES_IN = [0.59719, 0.35458, 0.04823, 0.076, 0.90834, 0.01566, 0.0284, 0.13383, 0.83777];
const ACES_OUT = [1.60475, -0.53108, -0.07367, -0.10208, 1.10813, -0.00605, -0.00327, -0.07276, 1.07602];

/** Jas jižní stěny vůči horní ploše po ACES a sRGB, pro neutrální šedou. */
export function southWallBrightnessRatio(): number {
  const length = Math.hypot(SUN_DIR[0], SUN_DIR[1], SUN_DIR[2]);
  const up = SUN_DIR[1] / length;
  const south = Math.max(0, SUN_DIR[2] / length);
  const top = shade(up, 1);
  const wall = shade(south, 0.5);
  return perceived(wall) / perceived(top);
}

function shade(ndl: number, skyWeight: number): [number, number, number] {
  const albedo = 0.5;
  return [0, 1, 2].map((channel) => {
    const sky = HEMI_SKY[channel];
    const ground = HEMI_GROUND[channel];
    const hemi = (skyWeight * sky + (1 - skyWeight) * ground) * HEMI_INTENSITY;
    const sun = ndl * SUN_COLOR[channel] * SUN_INTENSITY;
    return ((hemi + sun) * albedo) / Math.PI;
  }) as [number, number, number];
}

function perceived(color: [number, number, number]): number {
  const mapped = srgb(aces(color));
  return 0.2126 * mapped[0] + 0.7152 * mapped[1] + 0.0722 * mapped[2];
}

function aces(color: [number, number, number]): [number, number, number] {
  const exposed = color.map((channel) => channel / 0.6) as [number, number, number];
  const fitted = multiply(ACES_IN, exposed).map((channel) => {
    const a = channel * (channel + 0.0245786) - 0.000090537;
    const b = channel * (0.983729 * channel + 0.432951) + 0.238081;
    return a / b;
  }) as [number, number, number];
  return multiply(ACES_OUT, fitted).map((channel) => Math.min(1, Math.max(0, channel))) as [number, number, number];
}

function srgb(color: [number, number, number]): [number, number, number] {
  return color.map((channel) => (channel <= 0.0031308 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - 0.055)) as [
    number,
    number,
    number,
  ];
}

function multiply(matrix: number[], vector: [number, number, number]): [number, number, number] {
  return [0, 1, 2].map(
    (row) => matrix[row * 3] * vector[0] + matrix[row * 3 + 1] * vector[1] + matrix[row * 3 + 2] * vector[2],
  ) as [number, number, number];
}

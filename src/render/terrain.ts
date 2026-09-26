import {
  BufferAttribute,
  BufferGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
} from "three";
import { isPillar } from "./buildings.ts";
import { findHeliports, type Heliport } from "../sim/heliports.ts";
import { heightAt, type World } from "../sim/world.ts";
import {
  CONCRETE,
  CONCRETE_WALL,
  DOOR,
  PLASTER,
  WINDOW_FRAME,
  WINDOW_GLASS,
  EDGE_DARK,
  EDGE_DASH_DUTY,
  EDGE_DASHES_PER_CELL,
  EDGE_GAP,
  EDGE_WIDTH,
  ESTIMATE_COLOR,
  FOOT_STRENGTH,
  FOOT_WIDTH,
  GRASS_HIGH,
  GRASS_LOW,
  ROAD,
  ROAD_EDGE,
  ROCK_DARK,
  ROCK_LIGHT,
  ROOF,
  SAND,
} from "./style.ts";

const TILE = 32;

const TERRAIN_VERTEX_DECL = /* glsl */ `
attribute vec4 aData;
attribute vec4 aEdge;
attribute vec4 aFoot;
attribute vec4 aSame;
attribute vec2 aPad;
varying vec3 vWorld;
varying vec3 vNormalW;
varying vec2 vCellUv;
varying vec4 vData;
varying vec4 vEdge;
varying vec4 vFoot;
varying vec4 vSame;
varying vec2 vPad;
`;

const TERRAIN_FRAGMENT_DECL = /* glsl */ `
varying vec3 vWorld;
varying vec3 vNormalW;
varying vec2 vCellUv;
varying vec4 vData;
varying vec4 vEdge;
varying vec4 vFoot;
varying vec4 vSame;
varying vec2 vPad;
`;

const TERRAIN_COLOR = /* glsl */ `
uniform vec3 uGrassLow;
uniform vec3 uGrassHigh;
uniform vec3 uSand;
uniform vec3 uRoad;
uniform vec3 uRoadEdge;
uniform vec3 uConcrete;
uniform vec3 uConcreteWall;
uniform vec3 uRoof;
uniform vec3 uPlaster;
uniform vec3 uWindowFrame;
uniform vec3 uWindowGlass;
uniform vec3 uDoor;
uniform vec3 uRockLight;
uniform vec3 uRockDark;
uniform float uEdgeWidth;
uniform float uEdgeDashes;
uniform float uEdgeDuty;
uniform float uEdgeDark;
uniform float uEdgeGap;
uniform float uFootWidth;
uniform float uFootStrength;

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  return valueNoise(p) * 0.6 + valueNoise(p * 2.13) * 0.3 + valueNoise(p * 4.27) * 0.1;
}

float band(float distanceToEdge, float width) {
  float px = max(width, fwidth(distanceToEdge) * 1.15);
  return 1.0 - smoothstep(px * 0.55, px, distanceToEdge);
}

float dashes(float along) {
  return step(fract(along * uEdgeDashes), uEdgeDuty);
}

vec3 grassColor(vec3 p, float height) {
  float t = clamp(height / 7.0, 0.0, 1.0);
  vec3 color = mix(uGrassLow, uGrassHigh, t);
  color *= 0.9 + 0.16 * fbm(p.xz * vec2(0.37, 0.41));
  float spot = smoothstep(0.78, 0.9, valueNoise(p.xz * 2.7 + 11.0));
  color = mix(color, color * vec3(0.62, 0.7, 0.5), spot * 0.85);
  return color;
}

vec3 sandColor(vec3 p) {
  vec3 color = uSand;
  color *= 0.94 + 0.1 * valueNoise(p.xz * 8.0);
  color += (valueNoise(p.xz * 18.0) - 0.5) * 0.04;
  return color;
}

vec3 roadColor(vec3 p, vec2 uv, vec4 same) {
  vec3 color = uRoad * (0.94 + 0.08 * valueNoise(p.xz * 6.0));
  float curb = 0.0;
  if (same.x < 0.5) curb = max(curb, band(uv.y, 0.12));
  if (same.y < 0.5) curb = max(curb, band(1.0 - uv.x, 0.12));
  if (same.z < 0.5) curb = max(curb, band(1.0 - uv.y, 0.12));
  if (same.w < 0.5) curb = max(curb, band(uv.x, 0.12));
  return mix(color, uRoadEdge, curb);
}

vec3 concreteColor(vec3 p, vec3 base) {
  vec3 color = base * (0.94 + 0.08 * valueNoise(p.xz * 5.0));
  float seam = step(0.97, fract(p.x)) + step(0.97, fract(p.z));
  return color * (1.0 - seam * 0.12);
}

vec3 helipadColor(vec3 p, vec2 pad, float padW, float padH) {
  vec3 color = concreteColor(p, uConcrete);
  vec2 centered = vec2(pad.x, pad.y) - vec2(padW, padH) * 0.5;
  float radius = min(padW, padH) * 0.36;
  float ring = 1.0 - smoothstep(0.045, 0.09, abs(length(centered) - radius));
  float halfW = radius * 0.42;
  float halfH = radius * 0.62;
  float stemL = 1.0 - smoothstep(0.055, 0.09, abs(centered.x + halfW));
  float stemR = 1.0 - smoothstep(0.055, 0.09, abs(centered.x - halfW));
  float bar = 1.0 - smoothstep(0.05, 0.085, abs(centered.y));
  float letter = max(max(stemL, stemR) * step(abs(centered.y), halfH), bar * step(abs(centered.x), halfW));
  color = mix(color, vec3(0.96, 0.96, 0.94), clamp(max(ring, letter), 0.0, 1.0));
  float border = 0.0;
  border = max(border, band(pad.x, 0.1));
  border = max(border, band(padW - pad.x, 0.1));
  border = max(border, band(pad.y, 0.1));
  border = max(border, band(padH - pad.y, 0.1));
  return mix(color, color * 0.32, border);
}

vec3 roofColor(vec3 p) {
  float row = floor(p.x * 3.0);
  float brick = fract(p.z * 3.0 + mod(row, 2.0) * 0.5);
  float mortar = step(0.86, brick) + step(0.9, fract(p.x * 3.0));
  vec3 tile = mix(uRoof, uRoof * 0.72, valueNoise(p.xz * 2.0));
  return mix(tile, tile * 0.35, clamp(mortar, 0.0, 1.0));
}

vec3 houseWall(vec3 p, vec2 uv, float doorFlag) {
  vec3 plaster = uPlaster * (0.93 + 0.1 * valueNoise(vec2(p.x * 3.4, p.y * 2.2)));
  float across = uv.x;
  float rise = uv.y;
  float storey = fract(rise);
  float col = fract(across * 2.0);
  float pane = step(0.28, col) * step(col, 0.74);
  pane *= step(0.42, storey) * step(storey, 0.82);
  float frame = step(0.16, col) * step(col, 0.86);
  frame *= step(0.32, storey) * step(storey, 0.9);
  float door = 0.0;
  if (doorFlag > 0.5) door = step(0.32, across) * step(across, 0.68) * step(0.02, rise) * step(rise, 1.08);
  pane *= 1.0 - door;
  frame *= 1.0 - door;
  vec3 color = mix(plaster, uWindowFrame, frame);
  color = mix(color, uWindowGlass, pane);
  return mix(color, uDoor, door);
}

vec3 wallColor(vec3 p, vec2 uv, vec3 n, float surface, float door, float span) {
  vec3 color;
  if ((surface > 3.5 && surface < 4.5) || surface > 5.5) {
    color = uConcreteWall * (0.94 + 0.08 * valueNoise(p.xz * 3.0 + p.y));
    float course = smoothstep(0.12, 0.0, abs(fract(p.y * 1.6) - 0.08));
    color *= 1.0 - course * 0.12;
  } else if (surface > 4.5 && surface < 5.5) {
    color = houseWall(p, uv, door);
  } else {
    float side = smoothstep(0.35, 0.85, abs(n.x));
    float strata = p.y + valueNoise(vec2(p.x * 0.37, p.z * 0.37)) * 0.16;
    float layer = fract(strata * 1.25);
    color = mix(uRockLight, uRockDark, smoothstep(0.08, 0.2, layer) * (1.0 - smoothstep(0.62, 0.82, layer)));
    if (surface > 1.5 && surface < 2.5) color = mix(color, uSand * 0.72, 0.55);
    if (surface > 2.5 && surface < 3.5) color = mix(color, uRoadEdge, 0.4);
    float hatchAlong = abs(n.x) > 0.5 ? p.z : p.x;
    float hatch = step(0.72, fract(hatchAlong * 4.2 + p.y * 2.6));
    hatch *= step(0.72, hash21(floor(vec2(hatchAlong * 2.2, p.y * 2.2))));
    float south = smoothstep(0.2, 0.8, n.z);
    color *= mix(1.0, 0.62, hatch * (0.35 + south * 0.65));
    color *= mix(1.0, 1.65, side);
  }
  if (span > 0.05) {
    float fromTop = span - uv.y;
    float lip = 1.0 - smoothstep(0.0, uEdgeWidth + 0.04, fromTop);
    float along = abs(n.x) > 0.5 ? p.z : p.x;
    color *= mix(1.0, uEdgeGap, lip);
    color *= mix(1.0, uEdgeDark / max(uEdgeGap, 0.001), lip * dashes(along));
  }
  return color;
}

vec3 applyEdge(vec3 color, vec3 p, vec2 uv, vec4 edge) {
  float cover = 0.0;
  float dot = 0.0;
  if (edge.x > 0.5) {
    float here = band(uv.y, uEdgeWidth);
    cover = max(cover, here);
    dot = max(dot, here * dashes(p.x));
  }
  if (edge.z > 0.5) {
    float here = band(1.0 - uv.y, uEdgeWidth);
    cover = max(cover, here);
    dot = max(dot, here * dashes(p.x));
  }
  if (edge.y > 0.5) {
    float here = band(1.0 - uv.x, uEdgeWidth);
    cover = max(cover, here);
    dot = max(dot, here * dashes(p.z));
  }
  if (edge.w > 0.5) {
    float here = band(uv.x, uEdgeWidth);
    cover = max(cover, here);
    dot = max(dot, here * dashes(p.z));
  }
  color *= mix(1.0, uEdgeGap, cover);
  color *= mix(1.0, uEdgeDark / max(uEdgeGap, 0.001), dot);
  return color;
}

vec3 applyFoot(vec3 color, vec2 uv, vec4 foot) {
  float shade = 0.0;
  if (foot.x > 0.5) shade = max(shade, 1.0 - smoothstep(0.0, uFootWidth, uv.y));
  if (foot.z > 0.5) shade = max(shade, 1.0 - smoothstep(0.0, uFootWidth, 1.0 - uv.y));
  if (foot.y > 0.5) shade = max(shade, 1.0 - smoothstep(0.0, uFootWidth, 1.0 - uv.x));
  if (foot.w > 0.5) shade = max(shade, 1.0 - smoothstep(0.0, uFootWidth, uv.x));
  return color * mix(1.0, 1.0 - uFootStrength, shade);
}

vec3 terrainAlbedo(vec3 p, vec2 uv, vec3 n, vec4 edge, vec4 foot, vec4 same, vec2 pad, vec4 data) {
  float surface = data.x;
  vec3 color;
  if (n.y < 0.5) {
    color = wallColor(p, uv, n, surface, same.x, data.z);
  } else if (surface < 1.5) {
    color = grassColor(p, data.y);
  } else if (surface < 2.5) {
    color = sandColor(p);
  } else if (surface < 3.5) {
    color = roadColor(p, uv, same);
  } else if (surface < 4.5) {
    color = data.z > 1.5 ? helipadColor(p, pad, data.z, data.w) : concreteColor(p, uConcrete);
  } else if (surface < 5.5) {
    color = roofColor(p);
  } else {
    color = concreteColor(p, uConcrete);
  }
  if (n.y > 0.5) {
    color = applyEdge(color, p, uv, edge);
    color = applyFoot(color, uv, foot);
  }
  return color;
}
`;

export function buildTerrainMeshes(world: World, options?: { eastWestWalls?: boolean }): Mesh[] {
  const eastWestWalls = options?.eastWestWalls !== false;
  const material = createTerrainMaterial();
  const pads = findHeliports(world);
  const meshes: Mesh[] = [];
  for (let tz = 0; tz < world.depth; tz += TILE) {
    for (let tx = 0; tx < world.width; tx += TILE) {
      const geometry = tileGeometry(
        world,
        pads.mask,
        pads.list,
        tx,
        tz,
        Math.min(tx + TILE, world.width),
        Math.min(tz + TILE, world.depth),
        eastWestWalls,
      );
      if (!geometry) continue;
      const mesh = new Mesh(geometry, material);
      mesh.name = "terrain";
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      meshes.push(mesh);
    }
  }
  return meshes;
}

export function buildEstimateMesh(world: World): Mesh {
  const positions: number[] = [];
  const colors: number[] = [];
  for (let z = 0; z < world.depth; z++) {
    for (let x = 0; x < world.width; x++) {
      const index = z * world.width + x;
      if (!world.estimated[index] || world.surface[index] === 0) continue;
      const y = world.height[index] + 0.08;
      pushColorQuad(positions, colors, [x, y, z], [x, y, z + 1], [x + 1, y, z + 1], [x + 1, y, z], ESTIMATE_COLOR);
    }
  }
  return coloredMesh(positions, colors, true);
}

function createTerrainMaterial(): MeshLambertMaterial {
  const material = new MeshLambertMaterial({ color: 0xffffff });
  material.name = "terrain";
  material.customProgramCacheKey = () => "cyclone-terrain-sides";
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uGrassLow = { value: rgb(GRASS_LOW) };
    shader.uniforms.uGrassHigh = { value: rgb(GRASS_HIGH) };
    shader.uniforms.uSand = { value: rgb(SAND) };
    shader.uniforms.uRoad = { value: rgb(ROAD) };
    shader.uniforms.uRoadEdge = { value: rgb(ROAD_EDGE) };
    shader.uniforms.uConcrete = { value: rgb(CONCRETE) };
    shader.uniforms.uConcreteWall = { value: rgb(CONCRETE_WALL) };
    shader.uniforms.uRoof = { value: rgb(ROOF) };
    shader.uniforms.uPlaster = { value: rgb(PLASTER) };
    shader.uniforms.uWindowFrame = { value: rgb(WINDOW_FRAME) };
    shader.uniforms.uWindowGlass = { value: rgb(WINDOW_GLASS) };
    shader.uniforms.uDoor = { value: rgb(DOOR) };
    shader.uniforms.uRockLight = { value: rgb(ROCK_LIGHT) };
    shader.uniforms.uRockDark = { value: rgb(ROCK_DARK) };
    shader.uniforms.uEdgeWidth = { value: EDGE_WIDTH };
    shader.uniforms.uEdgeDashes = { value: EDGE_DASHES_PER_CELL };
    shader.uniforms.uEdgeDuty = { value: EDGE_DASH_DUTY };
    shader.uniforms.uEdgeDark = { value: EDGE_DARK };
    shader.uniforms.uEdgeGap = { value: EDGE_GAP };
    shader.uniforms.uFootWidth = { value: FOOT_WIDTH };
    shader.uniforms.uFootStrength = { value: FOOT_STRENGTH };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${TERRAIN_VERTEX_DECL}`)
      .replace(
        "#include <uv_vertex>",
        `#include <uv_vertex>
        vWorld = position;
        vNormalW = normal;
        vCellUv = uv;
        vData = aData;
        vEdge = aEdge;
        vFoot = aFoot;
        vSame = aSame;
        vPad = aPad;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${TERRAIN_FRAGMENT_DECL}\n${TERRAIN_COLOR}`)
      .replace("#include <color_fragment>", `#include <color_fragment>\n diffuseColor.rgb = terrainAlbedo(vWorld, vCellUv, vNormalW, vEdge, vFoot, vSame, vPad, vData);`);
  };
  return material;
}

function rgb(color: readonly [number, number, number]): { x: number; y: number; z: number } {
  return { x: color[0], y: color[1], z: color[2] };
}

interface Scratch {
  position: number[];
  normal: number[];
  uv: number[];
  data: number[];
  edge: number[];
  foot: number[];
  same: number[];
  pad: number[];
}

function tileGeometry(
  world: World,
  mask: Uint16Array,
  pads: readonly Heliport[],
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  eastWestWalls: boolean,
): BufferGeometry | null {
  const scratch: Scratch = { position: [], normal: [], uv: [], data: [], edge: [], foot: [], same: [], pad: [] };
  for (let z = z0; z < z1; z++) {
    for (let x = x0; x < x1; x++) {
      const index = z * world.width + x;
      const surface = world.surface[index];
      if (surface === 0 || isPillar(world, x, z)) continue;
      const height = world.height[index];
      const north = heightAt(world, x + 0.5, z - 0.5);
      const east = heightAt(world, x + 1.5, z + 0.5);
      const south = heightAt(world, x + 0.5, z + 1.5);
      const west = heightAt(world, x - 0.5, z + 0.5);
      const edge: Vec4 = [flag(north < height), flag(east < height), flag(south < height), flag(west < height)];
      const foot: Vec4 = [flag(north > height), flag(east > height), flag(south > height), flag(west > height)];
      const same: Vec4 = [sameSurface(world, x, z - 1, surface), sameSurface(world, x + 1, z, surface), sameSurface(world, x, z + 1, surface), sameSurface(world, x - 1, z, surface)];
      const padId = mask[index];
      const pad = padId ? pads[padId - 1] : undefined;
      const padW = pad ? pad.w : 0;
      const padH = pad ? pad.h : 0;
      const originX = pad ? x - pad.x : 0;
      const originZ = pad ? z - pad.z : 0;
      if (surface !== 5) {
        pushQuad(scratch, [
          corner([x, height, z], [0, 0], originX, originZ),
          corner([x, height, z + 1], [0, 1], originX, originZ + 1),
          corner([x + 1, height, z + 1], [1, 1], originX + 1, originZ + 1),
          corner([x + 1, height, z], [1, 0], originX + 1, originZ),
        ], [0, 1, 0], surface, height, edge, foot, same, padW, padH);
      }
      addWall(scratch, world, x, z, height, north, surface, "N");
      addWall(scratch, world, x, z, height, south, surface, "S");
      if (eastWestWalls) {
        addWall(scratch, world, x, z, height, west, surface, "W");
        addWall(scratch, world, x, z, height, east, surface, "E");
      }
    }
  }
  if (scratch.position.length === 0) return null;
  return geometryFrom(scratch);
}

type Vec4 = [number, number, number, number];
type Vec3 = [number, number, number];
type Vec2 = [number, number];

function flag(value: boolean): number {
  return value ? 1 : 0;
}

function sameSurface(world: World, x: number, z: number, surface: number): number {
  if (x < 0 || z < 0 || x >= world.width || z >= world.depth) return 0;
  return world.surface[z * world.width + x] === surface ? 1 : 0;
}

function corner(position: Vec3, uv: Vec2, padX: number, padZ: number) {
  return { position, uv, padX, padZ };
}

function addWall(scratch: Scratch, world: World, x: number, z: number, height: number, neighbor: number, surface: number, side: "N" | "S" | "E" | "W") {
  if (neighbor >= height) return;
  const low = neighbor;
  const span = height - low;
  const zero: Vec4 = [0, 0, 0, 0];
  const mark: Vec4 = [facadeDoor(world, x, z, side) ? 1 : 0, 0, 0, 0];
  if (side === "S") {
    pushQuad(scratch, wallFace([x + 1, low, z + 1], [x + 1, height, z + 1], [x, height, z + 1], [x, low, z + 1], span), [0, 0, 1], surface, height, zero, zero, mark, span, 0);
  } else if (side === "N") {
    pushQuad(scratch, wallFace([x, low, z], [x, height, z], [x + 1, height, z], [x + 1, low, z], span), [0, 0, -1], surface, height, zero, zero, mark, span, 0);
  } else if (side === "E") {
    pushQuad(scratch, wallFace([x + 1, low, z], [x + 1, height, z], [x + 1, height, z + 1], [x + 1, low, z + 1], span), [1, 0, 0], surface, height, zero, zero, mark, span, 0);
  } else {
    pushQuad(scratch, wallFace([x, low, z + 1], [x, height, z + 1], [x, height, z], [x, low, z], span), [-1, 0, 0], surface, height, zero, zero, mark, span, 0);
  }
}

function wallFace(a: Vec3, b: Vec3, c: Vec3, d: Vec3, span: number) {
  return [corner(a, [1, 0], 0, 0), corner(b, [1, span], 0, 0), corner(c, [0, span], 0, 0), corner(d, [0, 0], 0, 0)];
}

function facadeDoor(world: World, x: number, z: number, side: "N" | "S" | "E" | "W"): boolean {
  if (surfaceOf(world, x, z) !== 5 || !facade(world, x, z, side)) return false;
  const stepX = side === "N" || side === "S" ? 1 : 0;
  const stepZ = side === "E" || side === "W" ? 1 : 0;
  let startX = x;
  let startZ = z;
  while (facade(world, startX - stepX, startZ - stepZ, side)) {
    startX -= stepX;
    startZ -= stepZ;
  }
  const run: { x: number; z: number }[] = [];
  let cursorX = startX;
  let cursorZ = startZ;
  while (facade(world, cursorX, cursorZ, side)) {
    run.push({ x: cursorX, z: cursorZ });
    cursorX += stepX;
    cursorZ += stepZ;
  }
  const mid = run[Math.floor((run.length - 1) / 2)];
  return mid.x === x && mid.z === z;
}

function facade(world: World, x: number, z: number, side: "N" | "S" | "E" | "W"): boolean {
  if (surfaceOf(world, x, z) !== 5) return false;
  const neighbor = side === "N" ? [x, z - 1] : side === "S" ? [x, z + 1] : side === "E" ? [x + 1, z] : [x - 1, z];
  return heightAt(world, neighbor[0] + 0.5, neighbor[1] + 0.5) < world.height[z * world.width + x];
}

function surfaceOf(world: World, x: number, z: number): number {
  if (x < 0 || z < 0 || x >= world.width || z >= world.depth) return 0;
  return world.surface[z * world.width + x];
}

function pushQuad(
  scratch: Scratch,
  corners: ReturnType<typeof corner>[],
  normal: Vec3,
  surface: number,
  height: number,
  edge: Vec4,
  foot: Vec4,
  same: Vec4,
  padW: number,
  padH: number,
) {
  for (const index of [0, 1, 2, 0, 2, 3]) {
    const point = corners[index];
    scratch.position.push(point.position[0], point.position[1], point.position[2]);
    scratch.normal.push(normal[0], normal[1], normal[2]);
    scratch.uv.push(point.uv[0], point.uv[1]);
    scratch.data.push(surface, height, padW, padH);
    scratch.edge.push(edge[0], edge[1], edge[2], edge[3]);
    scratch.foot.push(foot[0], foot[1], foot[2], foot[3]);
    scratch.same.push(same[0], same[1], same[2], same[3]);
    scratch.pad.push(point.padX, point.padZ);
  }
}

function geometryFrom(scratch: Scratch): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(scratch.position), 3));
  geometry.setAttribute("normal", new BufferAttribute(new Float32Array(scratch.normal), 3));
  geometry.setAttribute("uv", new BufferAttribute(new Float32Array(scratch.uv), 2));
  geometry.setAttribute("aData", new BufferAttribute(new Float32Array(scratch.data), 4));
  geometry.setAttribute("aEdge", new BufferAttribute(new Float32Array(scratch.edge), 4));
  geometry.setAttribute("aFoot", new BufferAttribute(new Float32Array(scratch.foot), 4));
  geometry.setAttribute("aSame", new BufferAttribute(new Float32Array(scratch.same), 4));
  geometry.setAttribute("aPad", new BufferAttribute(new Float32Array(scratch.pad), 2));
  return geometry;
}

function pushColorQuad(
  positions: number[],
  colors: number[],
  a: Vec3,
  b: Vec3,
  c: Vec3,
  d: Vec3,
  color: readonly [number, number, number],
) {
  for (const point of [a, b, c, a, c, d]) {
    positions.push(point[0], point[1], point[2]);
    colors.push(color[0], color[1], color[2]);
  }
}

function coloredMesh(positions: number[], colors: number[], transparent: boolean): Mesh {
  const geometry = new BufferGeometry();
  if (positions.length) {
    geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
    geometry.setAttribute("color", new BufferAttribute(new Float32Array(colors), 3));
    geometry.computeVertexNormals();
  }
  const material = new MeshBasicMaterial({
    vertexColors: true,
    transparent,
    opacity: transparent ? 0.85 : 1,
    depthWrite: !transparent,
  });
  const mesh = new Mesh(geometry, material);
  mesh.name = transparent ? "estimate" : "marker";
  return mesh;
}

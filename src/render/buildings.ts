import { BoxGeometry, BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshLambertMaterial } from "three";
import type { World } from "../sim/world.ts";
import { CHIMNEY, PILLAR_CAP, PILLAR_SHAFT, ROOF } from "./style.ts";

const OVERHANG = 0.16;
const RISE = 0.42;

/** Osamělá bílá buňka ve výšce 6 nebo 7. Není to heliport. */
export function isPillar(world: World, x: number, z: number): boolean {
  const index = z * world.width + x;
  const height = world.height[index] ?? 0;
  if (world.surface[index] !== 4 || (height !== 6 && height !== 7)) return false;
  return neighborSurface(world, x + 1, z) !== 4
    && neighborSurface(world, x - 1, z) !== 4
    && neighborSurface(world, x, z + 1) !== 4
    && neighborSurface(world, x, z - 1) !== 4;
}

export function createBuildings(world: World): Group {
  const group = new Group();
  group.name = "buildings";
  group.add(createPillars(world), roofMesh(world));
  return group;
}

function createPillars(world: World): Group {
  const group = new Group();
  group.name = "pillars";
  const shaft = tint(PILLAR_SHAFT);
  const cap = tint(PILLAR_CAP);
  const lamp = tint([0.95, 0.9, 0.55]);
  for (let z = 0; z < world.depth; z++) {
    for (let x = 0; x < world.width; x++) {
      if (!isPillar(world, x, z)) continue;
      const scale = (world.height[z * world.width + x] ?? 7) / 7;
      const body = new Mesh(new BoxGeometry(0.28, 6.35, 0.28), shaft);
      body.scale.set(1, scale, 1);
      body.position.set(x + 0.5, 3.18 * scale, z + 0.5);
      const head = new Mesh(new BoxGeometry(0.42, 0.5, 0.42), cap);
      head.position.set(x + 0.5, 6.5 * scale, z + 0.5);
      const light = new Mesh(new BoxGeometry(0.2, 0.16, 0.2), lamp);
      light.position.set(x + 0.5, 6.82 * scale, z + 0.5);
      group.add(body, head, light);
    }
  }
  return group;
}

function roofMesh(world: World): Mesh {
  const positions: number[] = [];
  const colors: number[] = [];
  const seen = new Uint8Array(world.surface.length);
  for (let z = 0; z < world.depth; z++) {
    for (let x = 0; x < world.width; x++) {
      const index = z * world.width + x;
      if (world.surface[index] !== 5 || seen[index]) continue;
      const cells = floodRoof(world, seen, x, z);
      addRoof(positions, colors, world, cells);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const material = new MeshLambertMaterial({ vertexColors: true });
  const mesh = new Mesh(geometry, material);
  mesh.name = "roofs";
  return mesh;
}

function floodRoof(world: World, seen: Uint8Array, x: number, z: number): { x: number; z: number }[] {
  const cells: { x: number; z: number }[] = [];
  const queue = [{ x, z }];
  seen[z * world.width + x] = 1;
  while (queue.length > 0) {
    const cell = queue.pop()!;
    cells.push(cell);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = cell.x + dx;
      const nz = cell.z + dz;
      if (nx < 0 || nz < 0 || nx >= world.width || nz >= world.depth) continue;
      const index = nz * world.width + nx;
      if (world.surface[index] !== 5 || seen[index]) continue;
      seen[index] = 1;
      queue.push({ x: nx, z: nz });
    }
  }
  return cells;
}

function addRoof(positions: number[], colors: number[], world: World, cells: { x: number; z: number }[]): void {
  const has = new Set(cells.map((cell) => `${cell.x},${cell.z}`));
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const cell of cells) {
    minX = Math.min(minX, cell.x);
    maxX = Math.max(maxX, cell.x);
    minZ = Math.min(minZ, cell.z);
    maxZ = Math.max(maxZ, cell.z);
  }
  const alongX = maxX - minX >= maxZ - minZ;
  const height = world.height[cells[0].z * world.width + cells[0].x];
  const ridge = height + RISE;
  let chimney = cells[0];
  let best = Infinity;
  const midX = (minX + maxX) / 2;
  const midZ = (minZ + maxZ) / 2;
  for (const cell of cells) {
    const dist = Math.hypot(cell.x - midX, cell.z - midZ);
    if (dist < best) {
      best = dist;
      chimney = cell;
    }
  }
  for (const cell of cells) {
    const x0 = cell.x - (has.has(`${cell.x - 1},${cell.z}`) ? 0 : OVERHANG);
    const x1 = cell.x + 1 + (has.has(`${cell.x + 1},${cell.z}`) ? 0 : OVERHANG);
    const z0 = cell.z - (has.has(`${cell.x},${cell.z - 1}`) ? 0 : OVERHANG);
    const z1 = cell.z + 1 + (has.has(`${cell.x},${cell.z + 1}`) ? 0 : OVERHANG);
    if (alongX) {
      slope(positions, colors, [x0, height, z0], [x1, height, z0], [x1, ridge, cell.z + 0.5], [x0, ridge, cell.z + 0.5]);
      slope(positions, colors, [x0, height, z1], [x0, ridge, cell.z + 0.5], [x1, ridge, cell.z + 0.5], [x1, height, z1]);
    } else {
      slope(positions, colors, [x0, height, z0], [x0, height, z1], [cell.x + 0.5, ridge, z1], [cell.x + 0.5, ridge, z0]);
      slope(positions, colors, [x1, height, z0], [cell.x + 0.5, ridge, z0], [cell.x + 0.5, ridge, z1], [x1, height, z1]);
    }
  }
  const chimneyMesh = new BoxGeometry(0.18, 0.45, 0.18);
  const chimneyPos = chimneyMesh.getAttribute("position");
  for (let i = 0; i < chimneyPos.count; i++) {
    positions.push(chimney.x + 0.62 + chimneyPos.getX(i), ridge + 0.12 + chimneyPos.getY(i), chimney.z + 0.38 + chimneyPos.getZ(i));
    colors.push(CHIMNEY[0], CHIMNEY[1], CHIMNEY[2]);
  }
}

function slope(
  positions: number[],
  colors: number[],
  a: [number, number, number],
  b: [number, number, number],
  c: [number, number, number],
  d: [number, number, number],
): void {
  const strips = 4;
  for (let i = 0; i < strips; i++) {
    const t0 = i / strips;
    const t1 = (i + 1) / strips;
    const p0 = mix(a, d, t0);
    const p1 = mix(b, c, t0);
    const p2 = mix(b, c, t1);
    const p3 = mix(a, d, t1);
    const shade = i % 2 === 0 ? 1 : 0.78;
    const color: [number, number, number] = [ROOF[0] * shade, ROOF[1] * shade, ROOF[2] * shade];
    tri(positions, colors, p0, p1, p2, color);
    tri(positions, colors, p0, p2, p3, color);
  }
}

function tri(
  positions: number[],
  colors: number[],
  a: [number, number, number],
  b: [number, number, number],
  c: [number, number, number],
  color: [number, number, number],
): void {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const ny = ab[2] * ac[0] - ab[0] * ac[2];
  const order = ny >= 0 ? [a, b, c] : [a, c, b];
  for (const point of order) {
    positions.push(point[0], point[1], point[2]);
    colors.push(color[0], color[1], color[2]);
  }
}

function mix(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function neighborSurface(world: World, x: number, z: number): number {
  if (x < 0 || z < 0 || x >= world.width || z >= world.depth) return 0;
  return world.surface[z * world.width + x];
}

function tint(color: readonly [number, number, number]): MeshLambertMaterial {
  const material = new MeshLambertMaterial();
  material.color.setRGB(color[0], color[1], color[2]);
  return material;
}

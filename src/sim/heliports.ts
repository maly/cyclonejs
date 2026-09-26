import { BASE_CELL_X, BASE_CELL_Z } from "./config.ts";
import type { World } from "./world.ts";

export interface Heliport {
  /** Severozápadní buňka obdélníku oblasti. */
  x: number;
  z: number;
  w: number;
  h: number;
  cells: number;
  base: boolean;
}

export interface HeliportMap {
  list: Heliport[];
  /** 0 = není heliport, jinak index v `list` plus jedna. */
  mask: Uint16Array;
}

/**
 * Souvislé bílé plochy (surface 4) velké aspoň 2×2.
 * Osamělá bílá buňka je vrchol sloupu. Základna je oblast, která obsahuje buňku základny.
 */
export function findHeliports(world: World, baseX = BASE_CELL_X, baseZ = BASE_CELL_Z): HeliportMap {
  const { width, depth, surface } = world;
  const seen = new Uint8Array(width * depth);
  const mask = new Uint16Array(width * depth);
  const list: Heliport[] = [];

  for (let z = 0; z < depth; z++) {
    for (let x = 0; x < width; x++) {
      const start = z * width + x;
      if (seen[start] || surface[start] !== 4) continue;
      const cells: number[] = [];
      const stack = [start];
      seen[start] = 1;
      let minX = x;
      let maxX = x;
      let minZ = z;
      let maxZ = z;
      while (stack.length > 0) {
        const index = stack.pop() as number;
        cells.push(index);
        const cx = index % width;
        const cz = (index - cx) / width;
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cz < minZ) minZ = cz;
        if (cz > maxZ) maxZ = cz;
        if (cx > 0) push(seen, surface, stack, index - 1);
        if (cx + 1 < width) push(seen, surface, stack, index + 1);
        if (cz > 0) push(seen, surface, stack, index - width);
        if (cz + 1 < depth) push(seen, surface, stack, index + width);
      }
      if (maxX - minX < 1 || maxZ - minZ < 1) continue;
      if (!hasSolidSquare(cells, width, depth)) continue;
      const id = list.length + 1;
      let base = false;
      for (const index of cells) {
        mask[index] = id;
        const cx = index % width;
        const cz = (index - cx) / width;
        if (cx === baseX && cz === baseZ) base = true;
      }
      list.push({
        x: minX,
        z: minZ,
        w: maxX - minX + 1,
        h: maxZ - minZ + 1,
        cells: cells.length,
        base,
      });
    }
  }
  return { list, mask };
}

export function heliportIdAt(world: World, mask: Uint16Array, x: number, z: number): number {
  const cx = Math.floor(x);
  const cz = Math.floor(z);
  if (cx < 0 || cz < 0 || cx >= world.width || cz >= world.depth) return 0;
  return mask[cz * world.width + cx] ?? 0;
}

export function formatHeliport(pad: Heliport): string {
  const size = `${pad.x},${pad.z} ${pad.w}×${pad.h}`;
  return pad.base ? `${size} základna` : size;
}

function push(seen: Uint8Array, surface: Uint8Array, stack: number[], index: number): void {
  if (seen[index] || surface[index] !== 4) return;
  seen[index] = 1;
  stack.push(index);
}

function hasSolidSquare(cells: number[], width: number, depth: number): boolean {
  const member = new Set(cells);
  for (const index of cells) {
    const cx = index % width;
    const cz = (index - cx) / width;
    if (cx + 1 >= width || cz + 1 >= depth) continue;
    if (member.has(index + 1) && member.has(index + width) && member.has(index + width + 1)) return true;
  }
  return false;
}

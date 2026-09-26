import {
  type TerrainActor,
  type TerrainCrate,
  type TerrainException,
  type TerrainFace,
  type TerrainFile,
  type TerrainIsland,
  type TerrainSprite,
  type WorldFile,
} from "../../src/world/mapFormat.ts";
import { decodeRleInto } from "./rle.ts";
import {
  defaultWallTile,
  edgeBlocks,
  isDiagonal,
  isSouthWall,
  isTop,
  plainTopTile,
  surfaceCode,
  surfaceGroup,
  type Semantics,
  type SemTile,
} from "./semantics.ts";

const HELIPAD_TILE = 22;
const OPPOSITE = { N: "S", S: "N", E: "W", W: "E" } as const;

export interface TerrainIssue {
  island: number;
  type: "conflict" | "violation" | "collision";
  /** Souřadnice v buňkách půdorysu. */
  x: number;
  y: number;
  /** Souřadnice v pohledu, pro ladicí obrázek oblastí. */
  viewX: number;
  viewR: number;
  message: string;
}

export interface TerrainPatch {
  x: number;
  y: number;
  height: number;
  surface?: number;
}

export interface IslandStats {
  id: number;
  regions: number;
  minHeight: number;
  maxHeight: number;
  conflicts: number;
  violations: number;
  collisions: number;
  estimated: number;
  land: number;
  exceptions: Record<string, number>;
}

export interface TerrainReport {
  islands: IslandStats[];
  objects: Record<string, number>;
  crates: number;
  people: Record<string, number>;
  issues: TerrainIssue[];
}

interface Sprite {
  type: string;
  levels: number;
  footX: number;
  footR: number;
  tiles: number[];
  kind: string;
}

interface Placed {
  x: number;
  y: number;
  h: number;
  kind: string;
  surface: number;
  top: number;
  estimated: boolean;
  /** Díra v půdorysu doplněná podle severního souseda. Ve výhledu není vidět. */
  filled: boolean;
  viewR: number;
}

export function buildTerrain(
  world: WorldFile,
  semantics: Semantics,
): { terrain: TerrainFile; report: TerrainReport; regions: Uint16Array } {
  const objects: TerrainSprite[] = [];
  const crates: TerrainCrate[] = [];
  const people: TerrainActor[] = [];
  const faces: TerrainFace[] = [];
  const exceptions: TerrainException[] = [];
  const issues: TerrainIssue[] = [];
  const islands: TerrainIsland[] = [];
  const stats: IslandStats[] = [];
  const regions = new Uint16Array(world.cellsWide * world.cellsHigh);
  let regionBase = 2;

  for (const island of world.islands) {
    const built = buildIsland(island, semantics, issues);
    for (let row = 0; row < island.h; row++) {
      for (let col = 0; col < island.w; col++) {
        const local = built.regionOf[row * island.w + col];
        const abs = (island.y + row) * world.cellsWide + (island.x + col);
        if (local >= 0) regions[abs] = regionBase + local;
        else if (isSouthWall(semantics.byIndex[island.tiles[row * island.w + col]]) || semantics.byIndex[island.tiles[row * island.w + col]]?.role === "stena_bok") {
          regions[abs] = 1;
        }
      }
    }
    regionBase += built.stats.regions;
    islands.push(built.island);
    objects.push(...built.objects);
    crates.push(...built.crates);
    people.push(...built.people);
    faces.push(...built.faces);
    exceptions.push(...built.exceptions);
    stats.push(built.stats);
  }

  objects.sort(compareSprite);
  crates.sort(comparePoint);
  people.sort(compareActor);
  faces.sort(comparePoint);
  exceptions.sort((a, b) => a.r - b.r || a.x - b.x || a.tile - b.tile);

  const objectCounts: Record<string, number> = {};
  for (const object of objects) objectCounts[object.type] = (objectCounts[object.type] ?? 0) + 1;
  const peopleCounts: Record<string, number> = {};
  for (const person of people) peopleCounts[person.type] = (peopleCounts[person.type] ?? 0) + 1;

  return {
    terrain: { version: 1, islands, objects, crates, people, faces, exceptions },
    report: { islands: stats, objects: objectCounts, crates: crates.length, people: peopleCounts, issues },
    regions,
  };
}

function compareSprite(a: TerrainSprite, b: TerrainSprite): number {
  return a.y - b.y || a.x - b.x || a.type.localeCompare(b.type);
}

function comparePoint(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return a.y - b.y || a.x - b.x;
}

function compareActor(a: TerrainActor, b: TerrainActor): number {
  return a.y - b.y || a.x - b.x || a.type.localeCompare(b.type);
}

function buildIsland(
  island: WorldFile["islands"][number],
  semantics: Semantics,
  issues: TerrainIssue[],
): {
  island: TerrainIsland;
  objects: TerrainSprite[];
  crates: TerrainCrate[];
  people: TerrainActor[];
  faces: TerrainFace[];
  exceptions: TerrainException[];
  stats: IslandStats;
  regionOf: Int32Array;
} {
  const width = island.w;
  const height = island.h;
  const count = width * height;
  const meta: Array<SemTile | undefined> = new Array(count);
  const tiles = island.tiles.slice();
  const exceptions: TerrainException[] = [];
  const exceptionRoles: Record<string, number> = {};

  const seenException = new Set<string>();
  const noteException = (col: number, row: number, tile: number, role: string) => {
    const key = `${col},${row},${tile}`;
    if (seenException.has(key)) return;
    seenException.add(key);
    exceptions.push({ x: island.x + col, r: island.y + row, tile });
    exceptionRoles[role] = (exceptionRoles[role] ?? 0) + 1;
  };

  for (let i = 0; i < count; i++) {
    const tile = tiles[i];
    const info = semantics.byIndex[tile];
    meta[i] = info;
    const col = i % width;
    const row = (i - col) / width;
    if (!info) continue;
    if (info.kind === "vrtulnik") {
      noteException(col, row, tile, "objekt");
      tiles[i] = HELIPAD_TILE;
      meta[i] = semantics.byIndex[HELIPAD_TILE];
    } else if (info.role === "stena_bok") {
      noteException(col, row, tile, "stena_bok");
    }
  }

  const index = (col: number, row: number) => row * width + col;
  const inside = (col: number, row: number) => col >= 0 && row >= 0 && col < width && row < height;
  const at = (col: number, row: number) => (inside(col, row) ? meta[index(col, row)] : undefined);

  const regionOf = new Int32Array(count).fill(-1);
  let regionCount = 0;
  const regionKind: string[] = [];

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const start = index(col, row);
      const info = meta[start];
      if (!info || !isTop(info) || isDiagonal(info) || regionOf[start] >= 0) continue;
      const group = surfaceGroup(info.kind);
      const region = regionCount++;
      regionKind.push(info.kind);
      const stack = [start];
      regionOf[start] = region;
      while (stack.length > 0) {
        const current = stack.pop() as number;
        const cx = current % width;
        const cy = (current - cx) / width;
        const neighbors: Array<["N" | "E" | "S" | "W", number, number]> = [
          ["N", cx, cy - 1],
          ["S", cx, cy + 1],
          ["W", cx - 1, cy],
          ["E", cx + 1, cy],
        ];
        for (const [direction, nx, ny] of neighbors) {
          if (!inside(nx, ny)) continue;
          const next = index(nx, ny);
          if (regionOf[next] >= 0) continue;
          const neighbor = meta[next];
          if (!neighbor || !isTop(neighbor) || isDiagonal(neighbor)) continue;
          if (surfaceGroup(neighbor.kind) !== group) continue;
          if (edgeBlocks(meta[current], direction) || edgeBlocks(neighbor, OPPOSITE[direction])) continue;
          regionOf[next] = region;
          stack.push(next);
        }
      }
    }
  }

  const heights = new Array<number>(regionCount).fill(Number.NaN);
  const equations: Array<{ above: number; below: number | null; k: number; col: number; row: number }> = [];

  const regionNear = (col: number, row: number): number | null => {
    if (!inside(col, row)) return null;
    const info = at(col, row);
    if (!info) return null;
    if (info.role === "more") return null;
    const direct = regionOf[index(col, row)];
    if (direct >= 0) return direct;
    for (const nx of [col - 1, col + 1]) {
      if (!inside(nx, row)) continue;
      const side = regionOf[index(nx, row)];
      if (side >= 0) return side;
    }
    if (info.role === "objekt") {
      let probe = row + 1;
      while (inside(col, probe) && at(col, probe)?.role === "objekt") probe++;
      if (inside(col, probe) && regionOf[index(col, probe)] >= 0) return regionOf[index(col, probe)];
      const foot = probe - 1;
      for (const nx of [col - 1, col + 1]) {
        if (inside(nx, foot) && regionOf[index(nx, foot)] >= 0) return regionOf[index(nx, foot)];
      }
    }
    return null;
  };

  for (let col = 0; col < width; col++) {
    let row = 0;
    while (row < height) {
      if (!isSouthWall(at(col, row))) {
        row++;
        continue;
      }
      const start = row;
      while (row < height && isSouthWall(at(col, row))) row++;
      const k = row - start;
      const above = regionNear(col, start - 1);
      const belowInfo = inside(col, row) ? at(col, row) : undefined;
      // Stěna hned nad střechou nebo bílou plochou patří terase za budovou.
      // Budova její spodní část zakrývá, rovnice h(nad) = h(pod) + k z ní neplatí.
      if (belowInfo && isTop(belowInfo) && (belowInfo.kind === "strecha" || belowInfo.kind === "bila")) continue;
      const belowSea = !belowInfo || belowInfo.role === "more";
      const below = belowSea ? null : regionNear(col, row);
      if (above === null) continue;
      if (!belowSea && below === null) continue;
      equations.push({ above, below, k, col, row: start });
    }
  }

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const info = at(col, row);
      if (info?.role !== "pobrezi" || info.kind !== "pisek") continue;
      const south = at(col, row + 1);
      if (south && south.role !== "more") continue;
      const region = regionOf[index(col, row)];
      if (region < 0) continue;
      equations.push({ above: region, below: null, k: 0, col, row });
    }
  }

  const votes: Array<Map<number, number>> = Array.from({ length: regionCount }, () => new Map());
  const addVote = (region: number, heightValue: number) => {
    if (heightValue < 0 || heightValue > 12) return;
    votes[region].set(heightValue, (votes[region].get(heightValue) ?? 0) + 1);
  };
  let pending = equations.map((_, equation) => equation);
  const used = new Set<number>();
  while (pending.length > 0) {
    const next: number[] = [];
    let progressed = false;
    for (const equationIndex of pending) {
      const equation = equations[equationIndex];
      const belowHeight = equation.below === null ? 0 : heights[equation.below];
      const aboveHeight = heights[equation.above];
      if (Number.isNaN(aboveHeight) && !Number.isNaN(belowHeight)) {
        addVote(equation.above, belowHeight + equation.k);
        progressed = true;
        used.add(equationIndex);
      } else if (equation.below !== null && Number.isNaN(belowHeight) && !Number.isNaN(aboveHeight)) {
        addVote(equation.below, aboveHeight - equation.k);
        progressed = true;
        used.add(equationIndex);
      } else if (!Number.isNaN(aboveHeight) && !Number.isNaN(belowHeight)) {
        used.add(equationIndex);
      } else {
        next.push(equationIndex);
      }
    }
    for (let region = 0; region < regionCount; region++) {
      if (!Number.isNaN(heights[region]) || votes[region].size === 0) continue;
      heights[region] = majority(votes[region]);
      progressed = true;
    }
    if (!progressed) break;
    pending = next;
  }

  for (const equation of equations) {
    const belowHeight = equation.below === null ? 0 : heights[equation.below];
    const aboveHeight = heights[equation.above];
    if (Number.isNaN(aboveHeight) || Number.isNaN(belowHeight)) continue;
    if (aboveHeight !== belowHeight + equation.k) {
      issues.push({
        island: island.id,
        type: "conflict",
        x: island.x + equation.col,
        y: island.y + equation.row - 1 + aboveHeight,
        viewX: island.x + equation.col,
        viewR: island.y + equation.row,
        message: `konflikt výšek: oblast ${equation.above} má ${aboveHeight}, rovnice žádá ${belowHeight + equation.k} (k=${equation.k})`,
      });
    }
  }

  const cellHeight = new Int16Array(count).fill(-1);
  const cellEstimated = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    const region = regionOf[i];
    if (region < 0) continue;
    if (!Number.isNaN(heights[region])) cellHeight[i] = heights[region];
  }

  const estimateRegion = (region: number) => {
    let dotted = Number.POSITIVE_INFINITY;
    let any = Number.POSITIVE_INFINITY;
    let higherAcrossOwnEdge = Number.NEGATIVE_INFINITY;
    const seen = new Set<number>();
    for (let i = 0; i < count; i++) {
      if (regionOf[i] !== region) continue;
      const col = i % width;
      const row = (i - col) / width;
      const info = meta[i];
      const neighbors: Array<["N" | "E" | "S" | "W", number, number]> = [
        ["N", col, row - 1],
        ["S", col, row + 1],
        ["W", col - 1, row],
        ["E", col + 1, row],
      ];
      for (const [direction, nx, ny] of neighbors) {
        if (!inside(nx, ny)) {
          if (edgeBlocks(info, direction)) higherAcrossOwnEdge = Math.max(higherAcrossOwnEdge, 0);
          continue;
        }
        const other = regionOf[index(nx, ny)];
        if (other < 0 || other === region || seen.has(other) || Number.isNaN(heights[other])) continue;
        const touches =
          edgeBlocks(info, direction) || edgeBlocks(meta[index(nx, ny)], OPPOSITE[direction]);
        if (!touches) {
          any = Math.min(any, heights[other]);
          continue;
        }
        seen.add(other);
        if (edgeBlocks(info, direction)) higherAcrossOwnEdge = Math.max(higherAcrossOwnEdge, heights[other] + 1);
        else dotted = Math.min(dotted, heights[other] - 1);
      }
    }
    if (Number.isFinite(higherAcrossOwnEdge)) return higherAcrossOwnEdge;
    if (Number.isFinite(dotted)) return Math.max(0, dotted);
    if (Number.isFinite(any)) return any;
    return 0;
  };

  let guessed = true;
  while (guessed) {
    guessed = false;
    for (let region = 0; region < regionCount; region++) {
      if (!Number.isNaN(heights[region])) continue;
      const knownNeighbor = estimateRegion(region);
      const hasKnown = [...Array(count).keys()].some((cell) => {
        if (regionOf[cell] !== region) return false;
        const col = cell % width;
        const row = (cell - col) / width;
        return [
          [col, row - 1],
          [col, row + 1],
          [col - 1, row],
          [col + 1, row],
        ].some(([nx, ny]) => inside(nx, ny) && regionOf[index(nx, ny)] >= 0 && !Number.isNaN(heights[regionOf[index(nx, ny)]]));
      });
      if (!hasKnown && knownNeighbor === 0) {
        const touchesAnything = [...Array(count).keys()].some((cell) => {
          if (regionOf[cell] !== region) return false;
          const col = cell % width;
          const row = (cell - col) / width;
          return [
            [col, row - 1],
            [col, row + 1],
            [col - 1, row],
            [col + 1, row],
          ].some(([nx, ny]) => inside(nx, ny) && regionOf[index(nx, ny)] >= 0);
        });
        if (touchesAnything) continue;
      }
      heights[region] = knownNeighbor;
      guessed = true;
      for (let i = 0; i < count; i++) {
        if (regionOf[i] === region) {
          cellHeight[i] = knownNeighbor;
          cellEstimated[i] = 1;
        }
      }
    }
  }
  for (let region = 0; region < regionCount; region++) {
    if (!Number.isNaN(heights[region])) continue;
    heights[region] = 0;
    for (let i = 0; i < count; i++) {
      if (regionOf[i] === region) {
        cellHeight[i] = 0;
        cellEstimated[i] = 1;
      }
    }
  }

  for (let i = 0; i < count; i++) {
    const info = meta[i];
    if (!info || !isDiagonal(info)) continue;
    const col = i % width;
    const row = (i - col) / width;
    let best = -1;
    let bestRegion = -1;
    let estimated = false;
    for (const [nx, ny] of [
      [col, row - 1],
      [col, row + 1],
      [col - 1, row],
      [col + 1, row],
    ]) {
      if (!inside(nx, ny)) continue;
      const neighbor = regionOf[index(nx, ny)];
      if (neighbor < 0 || Number.isNaN(heights[neighbor])) continue;
      if (heights[neighbor] > best) {
        best = heights[neighbor];
        bestRegion = neighbor;
        estimated = cellEstimated[index(nx, ny)] === 1;
      }
    }
    if (best >= 0) {
      cellHeight[i] = best;
      cellEstimated[i] = estimated ? 1 : 0;
      regionOf[i] = bestRegion;
    }
  }

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const info = at(col, row);
      if (!info?.hrany || isDiagonal(info)) continue;
      const own = cellHeight[index(col, row)];
      if (own < 0 || cellEstimated[index(col, row)]) continue;
      for (const direction of ["N", "E", "W"] as const) {
        if (!info.hrany.includes(direction)) continue;
        const nx = col + (direction === "E" ? 1 : direction === "W" ? -1 : 0);
        const ny = row + (direction === "N" ? -1 : 0);
        let neighborHeight = 0;
        if (inside(nx, ny)) {
          const neighborInfo = at(nx, ny);
          if (neighborInfo?.role === "more" || !neighborInfo) neighborHeight = 0;
          else {
            const value = cellHeight[index(nx, ny)];
            if (value < 0) continue;
            neighborHeight = value;
          }
        }
        if (neighborHeight >= own) {
          issues.push({
            island: island.id,
            type: "violation",
            x: island.x + col,
            y: island.y + row + own,
            viewX: island.x + col,
            viewR: island.y + row,
            message: `porušená nerovnost ${direction}: výška ${own}, soused ${neighborHeight}`,
          });
        }
      }
    }
  }

  const placed = new Map<string, Placed>();
  const place = (cell: Placed) => {
    const key = `${cell.x},${cell.y}`;
    const previous = placed.get(key);
    if (previous && !previous.estimated) {
      issues.push({
        island: island.id,
        type: "collision",
        x: cell.x,
        y: cell.y,
        viewX: cell.x,
        viewR: cell.viewR,
        message: `dvě plochy v půdorysu [${cell.x}, ${cell.y}] z řádků ${previous.viewR} a ${cell.viewR}`,
      });
      noteException(cell.x - island.x, cell.viewR - island.y, cell.top, "plocha");
      return;
    }
    placed.set(key, cell);
  };

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const info = at(col, row);
      if (!info || !isTop(info) || cellHeight[index(col, row)] < 0) continue;
      const h = cellHeight[index(col, row)];
      place({
        x: island.x + col,
        y: island.y + row + h,
        h,
        kind: info.kind,
        surface: surfaceCode(info.kind),
        top: tiles[index(col, row)],
        estimated: cellEstimated[index(col, row)] === 1,
        filled: false,
        viewR: island.y + row,
      });
    }
  }

  const sprites = collectSprites(width, height, tiles, meta);
  const spriteAt = new Map<string, Sprite>();
  for (const sprite of sprites) {
    const ground = groundBeside(sprite.footX, sprite.footR, width, height, regionOf, cellHeight, meta);
    const h = ground?.height ?? 0;
    const planY = island.y + sprite.footR + h;
    const planX = island.x + sprite.footX;
    spriteAt.set(`${sprite.footX},${sprite.footR}`, sprite);
    const key = `${planX},${planY}`;
    if (!placed.has(key) && ground) {
      place({
        x: planX,
        y: planY,
        h,
        kind: ground.kind,
        surface: surfaceCode(ground.kind),
        top: plainTopTile(ground.kind),
        estimated: false,
        filled: false,
        viewR: island.y + sprite.footR,
      });
    }
  }

  const viewIsSea = (x: number, y: number) => {
    const info = at(x - island.x, y - island.y);
    return !info || info.role === "more";
  };
  // Zakrytá buňka bere výšku jen z nejbližší známé buňky severně. Známá je
  // plocha, která dopadla z pohledu, nebo viditelné moře. Doplněná buňka zdrojem není.
  const seaKnown = (x: number, y: number): Placed => ({
    x,
    y,
    h: 0,
    kind: "more",
    surface: 0,
    top: 0,
    estimated: false,
    filled: false,
    viewR: y,
  });
  for (let x = island.x; x < island.x + width; x++) {
    let known: Placed | null = null;
    for (let y = island.y; y < island.y + height; y++) {
      const key = `${x},${y}`;
      const existing = placed.get(key);
      const landed = existing && !existing.filled;
      if (viewIsSea(x, y)) {
        if (landed && !(existing.estimated && existing.h === 0)) {
          known = existing;
          continue;
        }
        if (existing) placed.delete(key);
        known = seaKnown(x, y);
        continue;
      }
      if (landed && !(existing.estimated && existing.h === 0 && (!known || known.surface === 0))) {
        known = existing;
        continue;
      }
      if (!known || known.surface === 0) {
        if (existing) placed.delete(key);
        continue;
      }
      place({
        x,
        y,
        h: known.h,
        kind: known.kind,
        surface: known.surface,
        top: plainTopTile(known.kind),
        estimated: true,
        filled: true,
        viewR: y - known.h,
      });
    }
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = 0;
  let maxY = 0;
  for (const cell of placed.values()) {
    if (cell.surface === 0) continue;
    minX = Math.min(minX, cell.x);
    minY = Math.min(minY, cell.y);
    maxX = Math.max(maxX, cell.x);
    maxY = Math.max(maxY, cell.y);
  }
  if (!Number.isFinite(minX)) {
    minX = island.x;
    minY = island.y;
    maxX = island.x;
    maxY = island.y;
  }
  const planW = maxX - minX + 1;
  const planH = maxY - minY + 1;
  const heightOut = new Array(planW * planH).fill(0);
  const surfaceOut = new Array(planW * planH).fill(0);
  const topOut = new Array(planW * planH).fill(0);
  const estimatedOut = new Array(planW * planH).fill(0);
  let estimatedCount = 0;
  for (const cell of placed.values()) {
    if (cell.x < minX || cell.y < minY || cell.x > maxX || cell.y > maxY) continue;
    const offset = (cell.y - minY) * planW + (cell.x - minX);
    heightOut[offset] = cell.h;
    surfaceOut[offset] = cell.surface;
    topOut[offset] = cell.top;
    estimatedOut[offset] = cell.estimated ? 1 : 0;
    if (cell.estimated) estimatedCount++;
  }

  const coveredSprite = new Set<string>();
  for (const sprite of sprites) {
    for (let level = 0; level < sprite.levels; level++) {
      coveredSprite.add(`${sprite.footX},${sprite.footR - (sprite.levels - 1 - level)}`);
    }
  }
  const placedView = new Set<string>();
  const coveredWall = new Set<string>();
  const realByColumn = new Map<number, Placed[]>();
  for (const cell of placed.values()) {
    if (!cell.filled) placedView.add(`${cell.x - island.x},${cell.viewR - island.y}:${cell.top}`);
    if (cell.estimated || cell.surface === 0) continue;
    const list = realByColumn.get(cell.x) ?? [];
    list.push(cell);
    realByColumn.set(cell.x, list);
  }
  for (const list of realByColumn.values()) {
    list.sort((a, b) => a.y - b.y);
    for (let indexInColumn = 0; indexInColumn < list.length; indexInColumn++) {
      const cell = list[indexInColumn];
      for (const viewRow of wallRows(cell, list[indexInColumn + 1])) {
        coveredWall.add(`${cell.x - island.x},${viewRow - island.y}`);
      }
    }
  }
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const info = at(col, row);
      if (!info) continue;
      const originalTile = island.tiles[index(col, row)];
      if (info.role === "objekt" && info.kind !== "vrtulnik" && !coveredSprite.has(`${col},${row}`)) {
        noteException(col, row, originalTile, "objekt");
      }
      if (isTop(info) && !placedView.has(`${col},${row}:${tiles[index(col, row)]}`)) {
        noteException(col, row, originalTile, info.role);
      }
      if (isSouthWall(info) && !coveredWall.has(`${col},${row}`)) {
        noteException(col, row, originalTile, info.role);
      }
    }
  }

  const objects: TerrainSprite[] = [];
  const crates: TerrainCrate[] = [];
  const people: TerrainActor[] = [];
  for (const sprite of sprites) {
    const ground = groundBeside(sprite.footX, sprite.footR, width, height, regionOf, cellHeight, meta);
    const h = ground?.height ?? cellHeight[index(sprite.footX, sprite.footR)];
    const planY = island.y + sprite.footR + (h >= 0 ? h : 0);
    const planX = island.x + sprite.footX;
    if (sprite.kind === "bedna") crates.push({ x: planX, y: planY });
    else if (sprite.kind === "muz" || sprite.kind === "zena") people.push({ type: sprite.kind, x: planX, y: planY });
    else objects.push({ type: sprite.kind, x: planX, y: planY, levels: sprite.levels });
  }

  const faces: TerrainFace[] = [];
  const realByX = new Map<number, Placed[]>();
  for (const cell of placed.values()) {
    if (cell.estimated || cell.surface === 0) continue;
    const list = realByX.get(cell.x) ?? [];
    list.push(cell);
    realByX.set(cell.x, list);
  }
  for (const list of realByX.values()) list.sort((a, b) => a.y - b.y);
  for (const list of realByX.values()) {
    for (let indexInColumn = 0; indexInColumn < list.length; indexInColumn++) {
      const cell = list[indexInColumn];
      const south = list[indexInColumn + 1];
      const rows = wallRows(cell, south);
      if (rows.length === 0) continue;
      const fallback = defaultWallTile(cell.kind);
      const tilesOfWall = rows.map((viewRow) => {
        const localRow = viewRow - island.y;
        const localCol = cell.x - island.x;
        const source = inside(localCol, localRow) ? tiles[index(localCol, localRow)] : fallback;
        const sourceInfo = semantics.byIndex[source];
        return sourceInfo && isSouthWall(sourceInfo) ? source : fallback;
      });
      if (tilesOfWall.some((tile) => tile !== fallback)) faces.push({ x: cell.x, y: cell.y, tiles: tilesOfWall });
    }
  }

  const solvedHeights = heights.filter((value) => !Number.isNaN(value));
  const stats: IslandStats = {
    id: island.id,
    regions: regionCount,
    minHeight: solvedHeights.length > 0 ? Math.min(...solvedHeights) : 0,
    maxHeight: solvedHeights.length > 0 ? Math.max(...solvedHeights) : 0,
    conflicts: issues.filter((issue) => issue.island === island.id && issue.type === "conflict").length,
    violations: issues.filter((issue) => issue.island === island.id && issue.type === "violation").length,
    collisions: issues.filter((issue) => issue.island === island.id && issue.type === "collision").length,
    estimated: estimatedCount,
    land: surfaceOut.filter((surface) => surface !== 0).length,
    exceptions: exceptionRoles,
  };

  return {
    island: {
      id: island.id,
      x: minX,
      y: minY,
      w: planW,
      h: planH,
      height: heightOut,
      surface: surfaceOut,
      top: topOut,
      estimated: estimatedOut,
    },
    objects,
    crates,
    people,
    faces,
    exceptions,
    stats,
    regionOf,
  };
}

function majority(votes: Map<number, number>): number {
  let bestHeight = 0;
  let bestCount = -1;
  for (const [height, count] of [...votes.entries()].sort((a, b) => a[0] - b[0])) {
    if (count > bestCount) {
      bestCount = count;
      bestHeight = height;
    }
  }
  return bestHeight;
}

function collectSprites(
  width: number,
  height: number,
  tiles: number[],
  meta: Array<SemTile | undefined>,
): Sprite[] {
  const used = new Uint8Array(width * height);
  const sprites: Sprite[] = [];
  const at = (col: number, row: number) => meta[row * width + col];
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const info = at(col, row);
      if (!info || info.role !== "objekt" || info.kind === "vrtulnik") continue;
      if (info.cast !== (info.vyska_spritu ?? 1) - 1) continue;
      const levels = info.vyska_spritu ?? 1;
      const stack: number[] = [];
      let valid = true;
      for (let level = 0; level < levels; level++) {
        const partRow = row - (levels - 1 - level);
        if (partRow < 0) {
          valid = false;
          break;
        }
        const part = at(col, partRow);
        if (!part || part.role !== "objekt" || part.kind !== info.kind || part.cast !== level || used[partRow * width + col]) {
          valid = false;
          break;
        }
        stack.push(tiles[partRow * width + col]);
      }
      if (!valid) continue;
      for (let level = 0; level < levels; level++) used[(row - (levels - 1 - level)) * width + col] = 1;
      sprites.push({ type: info.kind, kind: info.kind, levels, footX: col, footR: row, tiles: stack });
    }
  }
  return sprites;
}

function groundBeside(
  col: number,
  row: number,
  width: number,
  height: number,
  regionOf: Int32Array,
  cellHeight: Int16Array,
  meta: Array<SemTile | undefined>,
): { height: number; kind: string } | null {
  const candidates: Array<[number, number]> = [
    [col - 1, row],
    [col + 1, row],
    [col, row + 1],
    [col, row - 1],
  ];
  for (const [nx, ny] of candidates) {
    if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
    const info = meta[ny * width + nx];
    if (!info || !isTop(info)) continue;
    const h = cellHeight[ny * width + nx];
    if (h < 0) continue;
    return { height: h, kind: info.kind };
  }
  const own = cellHeight[row * width + col];
  if (own >= 0 && regionOf[row * width + col] >= 0) {
    const info = meta[row * width + col];
    if (info) return { height: own, kind: info.kind };
  }
  return null;
}

export function projectTerrain(
  terrain: TerrainFile,
  world: WorldFile,
  seaRle: Array<[number, number]>,
  semantics: Semantics,
): Uint16Array {
  const view = new Uint16Array(world.cellsWide * world.cellsHigh);
  decodeRleInto(seaRle, view);
  const source = new Uint16Array(view);
  for (const island of world.islands) {
    for (let row = 0; row < island.h; row++) {
      for (let col = 0; col < island.w; col++) {
        const tile = island.tiles[row * island.w + col];
        const abs = (island.y + row) * world.cellsWide + (island.x + col);
        source[abs] = tile;
        const info = semantics.byIndex[tile];
        if (info?.role === "more") view[abs] = tile;
      }
    }
  }

  const paint = (x: number, row: number, tile: number) => {
    if (x < 0 || row < 0 || x >= world.cellsWide || row >= world.cellsHigh) return;
    view[row * world.cellsWide + x] = tile;
  };

  const realCells: Placed[] = [];
  for (const island of terrain.islands) {
    for (let row = 0; row < island.h; row++) {
      for (let col = 0; col < island.w; col++) {
        const offset = row * island.w + col;
        if (island.surface[offset] === 0) continue;
        realCells.push({
          x: island.x + col,
          y: island.y + row,
          h: island.height[offset],
          kind: "",
          surface: island.surface[offset],
          top: island.top[offset],
          estimated: island.estimated[offset] === 1,
          filled: false,
          viewR: island.y + row - island.height[offset],
        });
      }
    }
  }
  realCells.sort((a, b) => a.y - b.y || a.x - b.x);

  const faceAt = new Map<string, number[]>();
  for (const face of terrain.faces) faceAt.set(`${face.x},${face.y}`, face.tiles);
  const occupied = new Map<string, Placed>();
  for (const cell of realCells) occupied.set(`${cell.x},${cell.y}`, cell);
  const realByX = new Map<number, Placed[]>();
  for (const cell of realCells) {
    if (cell.estimated) continue;
    const list = realByX.get(cell.x) ?? [];
    list.push(cell);
    realByX.set(cell.x, list);
  }

  for (const cell of realCells) {
    const viewIndex = cell.viewR * world.cellsWide + cell.x;
    const sourceTile = viewIndex >= 0 && viewIndex < source.length ? source[viewIndex] : -1;
    if (cell.estimated && sourceTile !== cell.top) continue;
    paint(cell.x, cell.viewR, cell.top);
    const column = realByX.get(cell.x) ?? [];
    const south = column.find((other) => other.y > cell.y);
    const rows = wallRows(cell, south);
    const face = faceAt.get(`${cell.x},${cell.y}`);
    const kind = kindFromSurface(cell.surface);
    rows.forEach((row, step) => {
      if (row < 0 || row >= world.cellsHigh) return;
      const sourceTile = source[row * world.cellsWide + cell.x];
      if (!isSouthWall(semantics.byIndex[sourceTile])) return;
      paint(cell.x, row, face?.[step] ?? sourceTile ?? defaultWallTile(kind));
    });
  }

  const spriteColumns = new Set<number>();
  for (const object of terrain.objects) spriteColumns.add(object.x);
  for (const crate of terrain.crates) spriteColumns.add(crate.x);
  for (const person of terrain.people) spriteColumns.add(person.x);
  for (const x of spriteColumns) {
    for (let row = 0; row < world.cellsHigh; row++) {
      const tile = source[row * world.cellsWide + x];
      const info = semantics.byIndex[tile];
      if (info?.role === "objekt" && info.kind !== "vrtulnik") paint(x, row, tile);
    }
  }

  for (const exception of terrain.exceptions) paint(exception.x, exception.r, exception.tile);
  return view;
}

function wallRows(cell: Placed, south: Placed | undefined): number[] {
  const endExclusive = south ? south.viewR : cell.y + 1;
  const rows: number[] = [];
  for (let row = cell.viewR + 1; row < endExclusive; row++) rows.push(row);
  return rows;
}

function kindFromSurface(surface: number): string {
  return ["more", "trava", "pisek", "silnice", "bila", "strecha", "beton"][surface] ?? "trava";
}

export function formatTerrainReport(report: TerrainReport): string {
  const lines: string[] = [];
  for (const island of report.islands) {
    const roles = Object.entries(island.exceptions)
      .map(([role, count]) => `${role} ${count}`)
      .join(", ");
    lines.push(
      `Ostrov ${island.id}: oblastí ${island.regions}, výšky ${island.minHeight}–${island.maxHeight}, konflikty ${island.conflicts}, nerovnosti ${island.violations}, kolize ${island.collisions}, odhady ${island.estimated}, souš ${island.land}, výjimky ${roles || "0"}`,
    );
  }
  const land = report.islands.reduce((sum, island) => sum + island.land, 0);
  const estimated = report.islands.reduce((sum, island) => sum + island.estimated, 0);
  lines.push(`Souš: ${land} buněk, z toho odhady ${estimated}`);
  const objects = Object.entries(report.objects)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([type, count]) => `${type} ${count}`)
    .join(", ");
  const people = Object.entries(report.people)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([type, count]) => `${type} ${count}`)
    .join(", ");
  lines.push(`Objekty: ${objects || "0"}`);
  lines.push(`Bedny: ${report.crates}`);
  lines.push(`Lidé: ${people || "0"} (${Object.values(report.people).reduce((sum, count) => sum + count, 0)})`);
  if (report.issues.length > 0) {
    lines.push(`Problémy: ${report.issues.length}`);
    for (const issue of report.issues) {
      lines.push(`  ostrov ${issue.island} [${issue.x}, ${issue.y}] ${issue.message}`);
    }
  }
  return lines.join("\n");
}

export function sourceView(world: WorldFile, seaRle: Array<[number, number]>): Uint16Array {
  const view = new Uint16Array(world.cellsWide * world.cellsHigh);
  decodeRleInto(seaRle, view);
  for (const island of world.islands) {
    for (let row = 0; row < island.h; row++) {
      for (let col = 0; col < island.w; col++) {
        view[(island.y + row) * world.cellsWide + (island.x + col)] = island.tiles[row * island.w + col];
      }
    }
  }
  return view;
}

export interface PlanIssue {
  type: TerrainIssue["type"];
  x: number;
  y: number;
  message: string;
}

export function planIssues(issues: TerrainIssue[]): PlanIssue[] {
  return issues
    .map((issue) => ({ type: issue.type, x: issue.x, y: issue.y, message: issue.message }))
    .sort((a, b) => a.type.localeCompare(b.type) || a.y - b.y || a.x - b.x || a.message.localeCompare(b.message));
}

/** Přepíše buňky půdorysu. Buňka mimo ostrovy založí ostrov 1×1. Vrací počet zapsaných oprav. */
export function applyTerrainPatches(terrain: TerrainFile, patches: TerrainPatch[]): number {
  let applied = 0;
  let nextId = terrain.islands.reduce((max, island) => Math.max(max, island.id), -1) + 1;
  for (const patch of patches) {
    const island = terrain.islands.find(
      (item) => patch.x >= item.x && patch.y >= item.y && patch.x < item.x + item.w && patch.y < item.y + item.h,
    );
    if (!island) {
      terrain.islands.push({
        id: nextId,
        x: patch.x,
        y: patch.y,
        w: 1,
        h: 1,
        height: [patch.height],
        surface: [patch.surface ?? 1],
        top: [0],
        estimated: [0],
      });
      nextId += 1;
      applied += 1;
      continue;
    }
    const offset = (patch.y - island.y) * island.w + (patch.x - island.x);
    island.height[offset] = patch.height;
    if (patch.surface !== undefined) island.surface[offset] = patch.surface;
    island.estimated[offset] = 0;
    applied += 1;
  }
  terrain.islands.sort((a, b) => a.id - b.id);
  return applied;
}

export function patchedViewCells(patches: TerrainPatch[]): Set<string> {
  const skip = new Set<string>();
  for (const patch of patches) {
    const top = patch.y - patch.height;
    for (let row = top - 1; row <= patch.y; row++) skip.add(`${patch.x},${row}`);
  }
  return skip;
}

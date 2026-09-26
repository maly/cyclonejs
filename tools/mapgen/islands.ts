export interface CellRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function expandRect(rect: CellRect, margin = 1): CellRect {
  return {
    x: rect.x - margin,
    y: rect.y - margin,
    w: rect.w + margin * 2,
    h: rect.h + margin * 2,
  };
}

/** Překryv na mřížce buněk. Hrany se dotýkají, ale nesdílejí buňku, takže se nepřekrývají. */
export function rectsOverlap(a: CellRect, b: CellRect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export function unionRect(a: CellRect, b: CellRect): CellRect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const right = Math.max(a.x + a.w, b.x + b.w);
  const bottom = Math.max(a.y + a.h, b.y + b.h);
  return { x, y, w: right - x, h: bottom - y };
}

function sortRects(rects: CellRect[]): CellRect[] {
  return rects.sort((a, b) => a.y - b.y || a.x - b.x || a.w - b.w || a.h - b.h);
}

/**
 * Slučuje obdélníky, jejichž rozšíření o jednu buňku na každou stranu se překrývají.
 * Výsledkem je ohraničující obdélník původních obdélníků, ne jejich rozšíření.
 * Opakuje se, protože sjednocení může nově dosáhnout na další obdélník.
 */
export function mergeCloseRects(rects: CellRect[]): CellRect[] {
  let current = rects.map((rect) => ({ ...rect }));
  const maxPasses = current.length + 1;

  for (let pass = 0; pass < maxPasses; pass++) {
    const count = current.length;
    const parent = Array.from({ length: count }, (_, index) => index);
    const find = (index: number): number => {
      let root = index;
      while (parent[root] !== root) root = parent[root];
      while (parent[index] !== root) {
        const next = parent[index];
        parent[index] = root;
        index = next;
      }
      return root;
    };
    const unite = (a: number, b: number) => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent[rb] = ra;
    };

    const bucketSize = 32;
    const buckets = new Map<number, number[]>();
    const bucketKey = (bx: number, by: number) => by * 100_000 + bx;

    for (let index = 0; index < count; index++) {
      const expanded = expandRect(current[index]);
      const x0 = Math.floor(expanded.x / bucketSize);
      const y0 = Math.floor(expanded.y / bucketSize);
      const x1 = Math.floor((expanded.x + expanded.w - 1) / bucketSize);
      const y1 = Math.floor((expanded.y + expanded.h - 1) / bucketSize);
      for (let by = y0; by <= y1; by++) {
        for (let bx = x0; bx <= x1; bx++) {
          const key = bucketKey(bx, by);
          const list = buckets.get(key);
          if (list) list.push(index);
          else buckets.set(key, [index]);
        }
      }
    }

    for (const list of buckets.values()) {
      for (let a = 0; a < list.length; a++) {
        const expandedA = expandRect(current[list[a]]);
        for (let b = a + 1; b < list.length; b++) {
          if (rectsOverlap(expandedA, expandRect(current[list[b]]))) {
            unite(list[a], list[b]);
          }
        }
      }
    }

    const groups = new Map<number, CellRect>();
    let merged = false;
    for (let index = 0; index < count; index++) {
      const root = find(index);
      const existing = groups.get(root);
      if (!existing) {
        groups.set(root, { ...current[index] });
      } else {
        groups.set(root, unionRect(existing, current[index]));
        merged = true;
      }
    }

    current = [...groups.values()];
    if (!merged) return sortRects(current);
  }

  throw new Error("Slučování obdélníků se nezastavilo");
}

export function landComponentRects(land: Uint8Array, cellsWide: number, cellsHigh: number): CellRect[] {
  const count = cellsWide * cellsHigh;
  const seen = new Uint8Array(count);
  const rects: CellRect[] = [];
  const stack: number[] = [];

  for (let start = 0; start < count; start++) {
    if (!land[start] || seen[start]) continue;
    let minX = cellsWide;
    let minY = cellsHigh;
    let maxX = 0;
    let maxY = 0;
    seen[start] = 1;
    stack.push(start);

    while (stack.length > 0) {
      const current = stack.pop() as number;
      const x = current % cellsWide;
      const y = (current - x) / cellsWide;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;

      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= cellsHigh) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          if (nx < 0 || nx >= cellsWide) continue;
          const next = ny * cellsWide + nx;
          if (!land[next] || seen[next]) continue;
          seen[next] = 1;
          stack.push(next);
        }
      }
    }

    rects.push({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 });
  }

  return rects;
}

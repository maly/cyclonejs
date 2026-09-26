export interface SemTile {
  index: number;
  role: string;
  kind: string;
  pozadi: number;
  hrany?: string;
  cast?: number;
  vyska_spritu?: number;
  note?: string;
}

export interface SemanticsFile {
  version: number;
  tiles: SemTile[];
}

export interface Semantics {
  tiles: SemTile[];
  byIndex: SemTile[];
}

const GROUND = new Set(["trava", "pisek", "silnice"]);

export function loadSemantics(file: SemanticsFile): Semantics {
  const byIndex: SemTile[] = [];
  for (const tile of file.tiles) byIndex[tile.index] = tile;
  return { tiles: file.tiles, byIndex };
}

export function surfaceGroup(kind: string): string {
  if (GROUND.has(kind)) return "zem";
  return kind;
}

export function surfaceCode(kind: string): number {
  switch (kind) {
    case "trava":
      return 1;
    case "pisek":
      return 2;
    case "silnice":
      return 3;
    case "bila":
      return 4;
    case "strecha":
      return 5;
    case "beton":
      return 6;
    default:
      return 0;
  }
}

export function isDiagonal(tile: SemTile | undefined): boolean {
  return tile?.hrany === "D/" || tile?.hrany === "D\\";
}

export function isTop(tile: SemTile | undefined): boolean {
  return tile?.role === "plocha" || tile?.role === "plocha_hrana" || tile?.role === "pobrezi";
}

/** Jižní stěna, včetně spritu nakresleného přes barvu stěny. */
export function isSouthWall(tile: SemTile | undefined): boolean {
  if (!tile) return false;
  if (tile.role === "stena_jih") return true;
  return tile.role === "objekt" && (tile.pozadi === 2 || tile.pozadi === 5);
}

export function edgeBlocks(tile: SemTile | undefined, direction: "N" | "E" | "S" | "W"): boolean {
  if (!tile?.hrany || isDiagonal(tile)) return false;
  return tile.hrany.includes(direction);
}

/** Výchozí dlaždice jižní stěny podle druhu horní plochy. */
export function defaultWallTile(kind: string): number {
  if (kind === "bila" || kind === "beton") return 27;
  return 23;
}

export function plainTopTile(kind: string): number {
  switch (kind) {
    case "pisek":
      return 24;
    case "silnice":
      return 79;
    case "bila":
      return 22;
    case "strecha":
      return 34;
    default:
      return 17;
  }
}

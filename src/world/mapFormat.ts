/** Formát mapy Cyclone. Sdílí ho nástroj mapgen a později hra. */

export const MAP_VERSION = 1;

/** Pořadí je index palety 0 až 8. Index 0 je moře. */
export const SPECTRUM_PALETTE = [
  "#00FFFF",
  "#00FF00",
  "#00CC00",
  "#000000",
  "#FFFFFF",
  "#CCCCCC",
  "#FF0000",
  "#FFFF00",
  "#CCCC00",
] as const;

export interface AtlasTile {
  index: number;
  /** 64 znaků, každý je index palety 0 až 8, řádkově v buňce 8×8. */
  pixels: string;
  count: number;
  first: [number, number];
  inIslands: boolean;
}

export interface AtlasFile {
  version: number;
  palette: string[];
  tiles: AtlasTile[];
}

export interface IslandRecord {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Indexy atlasu pro buňky obdélníku, řádkově, včetně moře uvnitř. */
  tiles: number[];
}

export interface WorldFile {
  version: number;
  pixelWidth: number;
  pixelHeight: number;
  cellsWide: number;
  cellsHigh: number;
  islands: IslandRecord[];
}

export interface SeaFile {
  version: number;
  /** Dvojice [index atlasu, počet]. Uvnitř obdélníků ostrovů je index 0. */
  rle: Array<[number, number]>;
}

/** 0 moře, 1 tráva, 2 písek, 3 silnice, 4 bílá, 5 střecha, 6 beton. */
export const SURFACE_SEA = 0;
export const SURFACE_GRASS = 1;
export const SURFACE_SAND = 2;
export const SURFACE_ROAD = 3;
export const SURFACE_WHITE = 4;
export const SURFACE_ROOF = 5;
export const SURFACE_CONCRETE = 6;

export interface TerrainIsland {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  height: number[];
  surface: number[];
  top: number[];
  estimated: number[];
}

export interface TerrainSprite {
  type: string;
  x: number;
  y: number;
  levels: number;
}

export interface TerrainActor {
  type: string;
  x: number;
  y: number;
}

export interface TerrainCrate {
  x: number;
  y: number;
}

export interface TerrainFace {
  x: number;
  y: number;
  tiles: number[];
}

export interface TerrainException {
  x: number;
  r: number;
  tile: number;
}

export interface TerrainFile {
  version: number;
  islands: TerrainIsland[];
  objects: TerrainSprite[];
  crates: TerrainCrate[];
  people: TerrainActor[];
  faces: TerrainFace[];
  exceptions: TerrainException[];
}

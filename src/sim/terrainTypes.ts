/** Minimální tvar `terrain.json`, který potřebuje simulace. */

export interface TerrainIslandData {
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

export interface TerrainFile {
  version: number;
  islands: TerrainIslandData[];
  objects: Array<{ type: string; x: number; y: number; levels: number }>;
  crates: Array<{ x: number; y: number }>;
  people: Array<{ type: string; x: number; y: number }>;
  faces: Array<{ x: number; y: number; tiles: number[] }>;
  exceptions: Array<{ x: number; r: number; tile: number }>;
}

export interface PlanIssue {
  type: "conflict" | "violation" | "collision";
  x: number;
  y: number;
  message: string;
}

export interface TerrainIssuesFile {
  version: number;
  issues: PlanIssue[];
}

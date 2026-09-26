import { describe, expect, it } from "vitest";
import type { TerrainFile } from "../sim/terrainTypes.ts";
import { worldFromTerrain } from "../sim/world.ts";
import { coastBytes } from "./sea.ts";
import { EDGE_WIDTH, FOOT_WIDTH, southWallBrightnessRatio } from "./style.ts";
import { buildTerrainMeshes } from "./terrain.ts";

describe("geometrie terénu", () => {
  it("z buňky výšky 2 postaví horní plochu a stěny k moři", () => {
    const terrain: TerrainFile = {
      version: 1,
      islands: [
        {
          id: 0,
          x: 1,
          y: 1,
          w: 1,
          h: 1,
          height: [2],
          surface: [1],
          top: [17],
          estimated: [0],
        },
      ],
      objects: [],
      crates: [],
      people: [],
      faces: [],
      exceptions: [],
    };
    const meshes = buildTerrainMeshes(worldFromTerrain(terrain));
    expect(meshes.length).toBe(1);
    const positions = meshes[0].geometry.getAttribute("position");
    // Horní plocha a čtyři stěny, každá dva trojúhelníky.
    expect(positions.count).toBe(6 * 5);
    const top = faceNormal(positions, 0);
    const south = faceNormal(positions, 12);
    expect(top.y).toBeGreaterThan(0);
    expect(south.z).toBeGreaterThan(0);
    const normals = meshes[0].geometry.getAttribute("normal");
    expect(normals.getY(0)).toBeGreaterThan(0);
    expect(normals.getZ(12)).toBeGreaterThan(0);
    const edges = meshes[0].geometry.getAttribute("aEdge");
    expect([edges.getX(0), edges.getY(0), edges.getZ(0), edges.getW(0)]).toEqual([1, 1, 1, 1]);
  });

  it("u nižší buňky ztmaví patu a u vyšší tečkuje hranu", () => {
    const terrain: TerrainFile = {
      version: 1,
      islands: [
        {
          id: 0,
          x: 4,
          y: 4,
          w: 2,
          h: 1,
          height: [1, 3],
          surface: [1, 1],
          top: [17, 17],
          estimated: [0, 0],
        },
      ],
      objects: [],
      crates: [],
      people: [],
      faces: [],
      exceptions: [],
    };
    const meshes = buildTerrainMeshes(worldFromTerrain(terrain), { eastWestWalls: false });
    const geometry = meshes[0].geometry;
    const positions = geometry.getAttribute("position");
    const foot = geometry.getAttribute("aFoot");
    const edge = geometry.getAttribute("aEdge");
    let lowFootEast = 0;
    let highEdgeWest = 0;
    for (let index = 0; index < positions.count; index++) {
      const y = positions.getY(index);
      if (Math.abs(y - 1) < 1e-4 && positions.getX(index) < 5) lowFootEast = Math.max(lowFootEast, foot.getY(index));
      if (Math.abs(y - 3) < 1e-4 && positions.getX(index) > 5) highEdgeWest = Math.max(highEdgeWest, edge.getW(index));
    }
    expect(lowFootEast).toBe(1);
    expect(highEdgeWest).toBe(1);
  });

  it("jižní stěna střechy nese souřadnice pro okna a jedny dveře na průčelí", () => {
    const terrain: TerrainFile = {
      version: 1,
      islands: [
        {
          id: 0,
          x: 2,
          y: 2,
          w: 2,
          h: 1,
          height: [3, 3],
          surface: [5, 5],
          top: [34, 34],
          estimated: [0, 0],
        },
      ],
      objects: [],
      crates: [],
      people: [],
      faces: [],
      exceptions: [],
    };
    const geometry = buildTerrainMeshes(worldFromTerrain(terrain), { eastWestWalls: false })[0].geometry;
    const position = geometry.getAttribute("position");
    const uv = geometry.getAttribute("uv");
    const same = geometry.getAttribute("aSame");
    let tallest = 0;
    let doors = 0;
    const doorX = new Set<number>();
    for (let index = 0; index < position.count; index++) {
      if (position.getZ(index) < 2.9 || position.getY(index) < 2.9) continue;
      tallest = Math.max(tallest, uv.getY(index));
      if (same.getX(index) > 0.5) {
        doors += 1;
        doorX.add(position.getX(index));
      }
    }
    expect(tallest).toBeCloseTo(3);
    expect(doors).toBeGreaterThan(0);
    expect(Math.min(...doorX)).toBeCloseTo(2);
    expect(Math.max(...doorX)).toBeCloseTo(3);
  });

  it("drží šířku hrany, stín u paty a poměr jasu jižní stěny", () => {
    expect(EDGE_WIDTH).toBeCloseTo(0.08);
    expect(FOOT_WIDTH).toBeCloseTo(0.3);
    expect(southWallBrightnessRatio()).toBeGreaterThan(0.5);
    expect(southWallBrightnessRatio()).toBeLessThan(0.6);
  });

  it("vzdálenost od břehu je nula na souši a jedna v sousedním moři", () => {
    const terrain: TerrainFile = {
      version: 1,
      islands: [
        {
          id: 0,
          x: 3,
          y: 3,
          w: 1,
          h: 1,
          height: [2],
          surface: [1],
          top: [17],
          estimated: [0],
        },
      ],
      objects: [],
      crates: [],
      people: [],
      faces: [],
      exceptions: [],
    };
    const world = worldFromTerrain(terrain);
    const bytes = coastBytes(world);
    expect(bytes[3 * world.width + 3]).toBe(0);
    expect(bytes[3 * world.width + 4]).toBe(4);
  });
});

function faceNormal(positions: { getX(index: number): number; getY(index: number): number; getZ(index: number): number }, index: number) {
  const ax = positions.getX(index);
  const ay = positions.getY(index);
  const az = positions.getZ(index);
  const ux = positions.getX(index + 1) - ax;
  const uy = positions.getY(index + 1) - ay;
  const uz = positions.getZ(index + 1) - az;
  const vx = positions.getX(index + 2) - ax;
  const vy = positions.getY(index + 2) - ay;
  const vz = positions.getZ(index + 2) - az;
  return {
    x: uy * vz - uz * vy,
    y: uz * vx - ux * vz,
    z: ux * vy - uy * vx,
  };
}

import { describe, expect, it } from "vitest";
import type { TerrainFile } from "../../src/world/mapFormat.ts";
import { applyTerrainPatches, patchedViewCells, planIssues, type TerrainIssue } from "./terrain.ts";

function terrain(): TerrainFile {
  return {
    version: 1,
    islands: [
      {
        id: 0,
        x: 10,
        y: 20,
        w: 2,
        h: 1,
        height: [1, 2],
        surface: [1, 1],
        top: [17, 17],
        estimated: [1, 0],
      },
    ],
    objects: [],
    crates: [],
    people: [],
    faces: [],
    exceptions: [],
  };
}

describe("opravy terénu", () => {
  it("přepíše výšku a povrch uvnitř ostrova a zruší odhad", () => {
    const map = terrain();
    const applied = applyTerrainPatches(map, [{ x: 10, y: 20, height: 4, surface: 4 }]);
    expect(applied).toBe(1);
    expect(map.islands[0].height[0]).toBe(4);
    expect(map.islands[0].surface[0]).toBe(4);
    expect(map.islands[0].estimated[0]).toBe(0);
    expect(map.islands[0].height[1]).toBe(2);
  });

  it("buňku mimo ostrovy založí jako ostrov 1×1", () => {
    const map = terrain();
    applyTerrainPatches(map, [{ x: 3, y: 4, height: 2 }]);
    expect(map.islands[1]).toMatchObject({ x: 3, y: 4, w: 1, h: 1, height: [2], surface: [1] });
  });

  it("z problémů udělá seznam v půdorysu a z oprav vynechá jejich pohled", () => {
    const issues: TerrainIssue[] = [
      {
        island: 1,
        type: "violation",
        x: 4,
        y: 9,
        viewX: 4,
        viewR: 8,
        message: "b",
      },
      {
        island: 0,
        type: "conflict",
        x: 2,
        y: 3,
        viewX: 2,
        viewR: 1,
        message: "a",
      },
    ];
    expect(planIssues(issues).map((issue) => issue.type)).toEqual(["conflict", "violation"]);
    expect(patchedViewCells([{ x: 5, y: 10, height: 2 }])).toEqual(new Set(["5,7", "5,8", "5,9", "5,10"]));
  });
});

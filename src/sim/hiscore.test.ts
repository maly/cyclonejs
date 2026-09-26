import { describe, expect, it } from "vitest";
import {
  emptyHiscores,
  insertHiscore,
  parseHiscores,
  qualifies,
  type HiscoreRecord,
  type HiscoreTable,
} from "./hiscore.ts";

function record(patch: Partial<HiscoreRecord> = {}): HiscoreRecord {
  return {
    name: "ANNA",
    score: 100,
    crates: 1,
    outcome: "success",
    timeLeft: 40,
    at: "2020-01-01T00:00:00.000Z",
    seed: 1,
    ...patch,
  };
}

function fill(table: HiscoreTable, count: number, score: number): HiscoreTable {
  let current = table;
  for (let i = 0; i < count; i++) {
    current = insertHiscore(current, record({ name: `H${i}`, score, at: `2020-01-${String(i + 1).padStart(2, "0")}T00:00:00.000Z` })).table;
  }
  return current;
}

describe("tabulka rekordů", () => {
  it("neplatný JSON a cizí verze se nenačtou", () => {
    expect(parseHiscores("{")).toBeNull();
    expect(parseHiscores("[]")).toBeNull();
    expect(parseHiscores("{\"version\":2,\"lastName\":\"\",\"records\":[]}")).toBeNull();
    expect(parseHiscores("{\"version\":1,\"lastName\":\"\",\"records\":[{\"name\":\"\"}]}")).toBeNull();
  });

  it("prázdná tabulka přijme i nulové skóre", () => {
    const table = emptyHiscores();
    expect(qualifies(table.records, 0)).toBe(true);
    const saved = insertHiscore(table, record({ score: 0, name: "NULA" }));
    expect(saved.index).toBe(0);
    expect(saved.table.records).toHaveLength(1);
    expect(saved.table.lastName).toBe("NULA");
  });

  it("seřadí podle skóre a nechá jen deset záznamů", () => {
    let table = fill(emptyHiscores(), 10, 100);
    expect(table.records).toHaveLength(10);
    const saved = insertHiscore(table, record({ name: "TOP", score: 500, at: "2024-05-01T00:00:00.000Z" }));
    expect(saved.table.records).toHaveLength(10);
    expect(saved.index).toBe(0);
    expect(saved.table.records[0]?.name).toBe("TOP");
    expect(saved.table.records.some((item) => item.score === 100)).toBe(true);
    expect(saved.table.records.filter((item) => item.score === 100)).toHaveLength(9);
  });

  it("při shodném skóre nechá starší záznam výš a nový se do plné tabulky nevejde", () => {
    const older = record({ name: "STARY", score: 80, at: "2019-01-01T00:00:00.000Z" });
    const newer = record({ name: "NOVY", score: 80, at: "2024-01-01T00:00:00.000Z" });
    const saved = insertHiscore(insertHiscore(emptyHiscores(), older).table, newer);
    expect(saved.table.records.map((item) => item.name)).toEqual(["STARY", "NOVY"]);

    const full = fill(emptyHiscores(), 10, 80);
    expect(qualifies(full.records, 80)).toBe(false);
    expect(qualifies(full.records, 81)).toBe(true);
    const rejected = insertHiscore(full, record({ name: "STEJNE", score: 80, at: "2025-01-01T00:00:00.000Z" }));
    expect(rejected.index).toBe(-1);
    expect(rejected.table.records).toHaveLength(10);
    expect(rejected.table.records.some((item) => item.name === "STEJNE")).toBe(false);
  });
});

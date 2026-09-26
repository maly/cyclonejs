import { describe, expect, it } from "vitest";
import { emptyHiscores, insertHiscore, type HiscoreRecord } from "../sim/hiscore.ts";
import { createHiscoreStore, HISCORE_STORAGE_KEY, type HiscoreStorage } from "./storage.ts";

function record(): HiscoreRecord {
  return {
    name: "EVA",
    score: 10,
    crates: 0,
    outcome: "failure",
    timeLeft: 0,
    at: "2024-01-01T00:00:00.000Z",
    seed: 1,
  };
}

function memory(initial?: string, failSet = false): HiscoreStorage & { raw(): string | null } {
  const values = new Map<string, string>();
  if (initial !== undefined) values.set(HISCORE_STORAGE_KEY, initial);
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      if (failSet) throw new Error("plné");
      values.set(key, value);
    },
    raw: () => values.get(HISCORE_STORAGE_KEY) ?? null,
  };
}

describe("úložiště rekordů", () => {
  it("prázdné úložiště zůstane zapisovatelné", () => {
    const box = memory();
    const store = createHiscoreStore(box);
    expect(store.load()).toEqual(emptyHiscores());
    expect(store.persistent()).toBe(true);
    const saved = insertHiscore(store.load(), record()).table;
    store.save(saved);
    expect(createHiscoreStore(box).load().records[0]?.name).toBe("EVA");
  });

  it("poškozený JSON i špatná verze nechají tabulku jen v paměti", () => {
    for (const raw of ["{", "{\"version\":2,\"lastName\":\"\",\"records\":[]}", "{\"version\":1}"]) {
      const box = memory(raw);
      const store = createHiscoreStore(box);
      expect(store.persistent()).toBe(false);
      expect(store.load().records).toEqual([]);
      store.save(insertHiscore(emptyHiscores(), record()).table);
      expect(store.load().records[0]?.name).toBe("EVA");
      expect(box.raw()).toBe(raw);
    }
  });

  it("nedostupné úložiště ani hozený zápis hru nezastaví", () => {
    const missing = createHiscoreStore(null);
    expect(missing.persistent()).toBe(false);
    missing.save(insertHiscore(emptyHiscores(), record()).table);
    expect(missing.load().records).toHaveLength(1);

    const throwing: HiscoreStorage = {
      getItem: () => {
        throw new Error("zakázáno");
      },
      setItem: () => {
        throw new Error("zakázáno");
      },
    };
    const blocked = createHiscoreStore(throwing);
    expect(blocked.persistent()).toBe(false);
    expect(() => blocked.save(insertHiscore(emptyHiscores(), record()).table)).not.toThrow();
    expect(blocked.load().records).toHaveLength(1);

    const box = memory(undefined, true);
    const full = createHiscoreStore(box);
    expect(() => full.save(insertHiscore(emptyHiscores(), record()).table)).not.toThrow();
    expect(full.persistent()).toBe(false);
    expect(full.load().records).toHaveLength(1);
    expect(box.raw()).toBeNull();
  });
});

import { emptyHiscores, parseHiscores, type HiscoreTable } from "../sim/hiscore.ts";

/** Předpona drží tabulku odděleně od ostatních her na stejné doméně GitHub Pages. */
export const HISCORE_STORAGE_KEY = "cyclone-remake.hiscores.v1";

export interface HiscoreStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface HiscoreStore {
  load(): HiscoreTable;
  save(table: HiscoreTable): void;
  persistent(): boolean;
}

/**
 * Čtení i zápis jsou v try/catch. Když úložiště chybí nebo obsah nejde načíst,
 * tabulka zůstane jen v paměti do zavření stránky a hra dál nic nehlásí.
 */
export function createHiscoreStore(storage: HiscoreStorage | null): HiscoreStore {
  let table = emptyHiscores();
  let persistent = storage !== null;
  if (storage) {
    try {
      const raw = storage.getItem(HISCORE_STORAGE_KEY);
      if (raw !== null) {
        const parsed = parseHiscores(raw);
        if (parsed) table = parsed;
        else persistent = false;
      }
    } catch {
      persistent = false;
    }
  }

  return {
    load: () => table,
    persistent: () => persistent,
    save(next) {
      table = next;
      if (!persistent || !storage) return;
      try {
        storage.setItem(HISCORE_STORAGE_KEY, JSON.stringify(next));
      } catch {
        persistent = false;
      }
    },
  };
}

export function browserHiscoreStore(): HiscoreStore {
  try {
    return createHiscoreStore(window.localStorage);
  } catch {
    return createHiscoreStore(null);
  }
}

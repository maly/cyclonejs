import type { GameOutcome } from "./game.ts";

export const HISCORE_LIMIT = 10;
export const HISCORE_NAME_MAX = 10;

export interface HiscoreRecord {
  name: string;
  score: number;
  crates: number;
  outcome: GameOutcome;
  /** Zbývající celé sekundy na konci hry. */
  timeLeft: number;
  /** Čas zápisu, ISO. Při shodném skóre je starší záznam výš. */
  at: string;
  seed: number;
}

export interface HiscoreTable {
  version: 1;
  lastName: string;
  records: HiscoreRecord[];
}

const NAME_CHAR = /^[\p{L}\p{N} ]$/u;

export function emptyHiscores(): HiscoreTable {
  return { version: 1, lastName: "", records: [] };
}

export function qualifies(records: readonly HiscoreRecord[], score: number): boolean {
  if (records.length < HISCORE_LIMIT) return true;
  const worst = records.reduce((min, record) => Math.min(min, record.score), Infinity);
  return score > worst;
}

/** Vrátí tabulku ořezanou na deset míst. Nový záznam se stejným skóre zůstane pod starším. */
export function insertHiscore(table: HiscoreTable, record: HiscoreRecord): { table: HiscoreTable; index: number } {
  const ranked = [...table.records, record].sort(compareHiscores);
  const placed = ranked.indexOf(record);
  const kept = placed < HISCORE_LIMIT;
  return {
    index: kept ? placed : -1,
    table: {
      version: 1,
      lastName: kept ? record.name : table.lastName,
      records: ranked.slice(0, HISCORE_LIMIT),
    },
  };
}

export function topScore(records: readonly HiscoreRecord[]): number {
  if (records.length === 0) return 0;
  return records.reduce((best, record) => Math.max(best, record.score), 0);
}

export function acceptNameChar(name: string, char: string): string | null {
  if (!NAME_CHAR.test(char) || name.length >= HISCORE_NAME_MAX) return null;
  return name + char;
}

export function backspaceName(name: string): string {
  return [...name].slice(0, -1).join("");
}

export function nameReady(name: string): boolean {
  return name.length >= 1 && name.length <= HISCORE_NAME_MAX && [...name].every((char) => NAME_CHAR.test(char));
}

export function parseHiscores(raw: string): HiscoreTable | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const file = data as Record<string, unknown>;
  if (file.version !== 1) return null;
  if (!isName(file.lastName, true)) return null;
  if (!Array.isArray(file.records) || file.records.length > HISCORE_LIMIT) return null;
  const records: HiscoreRecord[] = [];
  for (const item of file.records) {
    const record = readRecord(item);
    if (!record) return null;
    records.push(record);
  }
  return { version: 1, lastName: file.lastName, records: records.sort(compareHiscores) };
}

function compareHiscores(a: HiscoreRecord, b: HiscoreRecord): number {
  if (b.score !== a.score) return b.score - a.score;
  if (a.at !== b.at) return a.at < b.at ? -1 : 1;
  return 0;
}

function readRecord(item: unknown): HiscoreRecord | null {
  if (!item || typeof item !== "object") return null;
  const record = item as Record<string, unknown>;
  if (!isName(record.name, false)) return null;
  if (!isFiniteNumber(record.score) || !isFiniteNumber(record.crates) || !isFiniteNumber(record.timeLeft)) return null;
  if (record.outcome !== "success" && record.outcome !== "failure") return null;
  if (typeof record.at !== "string" || !Number.isFinite(Date.parse(record.at))) return null;
  if (!isFiniteNumber(record.seed)) return null;
  return {
    name: record.name,
    score: record.score,
    crates: record.crates,
    outcome: record.outcome,
    timeLeft: record.timeLeft,
    at: record.at,
    seed: record.seed,
  };
}

function isName(value: unknown, allowEmpty: boolean): value is string {
  if (typeof value !== "string") return false;
  if (value.length > HISCORE_NAME_MAX) return false;
  if (value.length === 0) return allowEmpty;
  return [...value].every((char) => NAME_CHAR.test(char));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

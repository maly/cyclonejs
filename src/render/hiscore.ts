import { wholeSecondsLeft, type GameState } from "../sim/game.ts";
import {
  acceptNameChar,
  backspaceName,
  insertHiscore,
  nameReady,
  qualifies,
  topScore,
  type HiscoreRecord,
  type HiscoreTable,
} from "../sim/hiscore.ts";
import { browserHiscoreStore, type HiscoreStore } from "../scores/storage.ts";

const INTRO_SWAP_MS = 8000;

export interface HiscoreUi {
  sync(state: GameState, now: number): void;
  blocksConfirm(): boolean;
}

export function createHiscoreUi(store: HiscoreStore = browserHiscoreStore()): HiscoreUi {
  let table = store.load();
  let mode: "idle" | "naming" | "board" = "idle";
  let armed = false;
  let draft = "";
  let highlight = -1;
  let snapshot: GameState | null = null;
  let introPage: "title" | "board" = "title";
  let introElapsed = 0;
  let introStamp = 0;

  const introTitle = document.querySelector<HTMLElement>("#intro-title");
  const introScreen = document.querySelector<HTMLElement>("#intro-screen");
  const introBoard = document.createElement("div");
  introBoard.className = "screen-card hiscore-card";
  introBoard.hidden = true;
  introScreen?.append(introBoard);

  const endName = document.querySelector<HTMLElement>("#end-name");
  const endBoard = document.querySelector<HTMLElement>("#end-board");
  const endContinue = document.querySelector<HTMLElement>("#end-continue");
  const endReplay = document.querySelector<HTMLElement>("#end-replay");
  const best = document.querySelector<HTMLElement>("#hud-best");

  window.addEventListener("keydown", onKey);

  paintBest();
  paintIntro();

  return { sync, blocksConfirm: () => mode === "naming" };

  function sync(state: GameState, now: number): void {
    if (state.phase !== "end") {
      armed = false;
      mode = "idle";
      snapshot = null;
      hideEnd();
    } else if (!armed) {
      armed = true;
      if (state.outcome && qualifies(table.records, state.score)) {
        mode = "naming";
        draft = table.lastName;
        highlight = -1;
        snapshot = state;
        paintName();
      } else {
        mode = "idle";
        hideEnd();
      }
    }
    if (mode === "naming") {
      if (endName) endName.hidden = false;
      if (endBoard) endBoard.hidden = true;
      showContinue(false);
    } else if (mode === "board") {
      if (endName) endName.hidden = true;
      if (endBoard) endBoard.hidden = false;
      showContinue(true);
    }
    tickIntro(state.phase === "intro", now);
  }

  function onKey(event: KeyboardEvent): void {
    if (mode !== "naming") return;
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
      return;
    }
    if (event.key === "Backspace") {
      event.preventDefault();
      draft = backspaceName(draft);
      paintName();
      return;
    }
    const next = acceptNameChar(draft, event.key);
    if (next === null) return;
    event.preventDefault();
    draft = next;
    paintName();
  }

  function commit(): void {
    if (!snapshot || !snapshot.outcome || !nameReady(draft)) return;
    const record: HiscoreRecord = {
      name: draft,
      score: snapshot.score,
      crates: snapshot.collectedCrates.filter(Boolean).length,
      outcome: snapshot.outcome,
      timeLeft: wholeSecondsLeft(snapshot.timeLeft),
      at: new Date().toISOString(),
      seed: snapshot.seed,
      layout: snapshot.layout,
      map: snapshot.mapSeed,
      generator: snapshot.generator,
    };
    const saved = insertHiscore(table, record);
    table = saved.table;
    highlight = saved.index;
    store.save(table);
    mode = "board";
    paintBest();
    paintBoard(endBoard, highlight);
    paintIntro();
    if (endName) endName.hidden = true;
    if (endBoard) endBoard.hidden = false;
    showContinue(true);
  }

  function paintName(): void {
    if (!endName) return;
    endName.hidden = false;
    endName.innerHTML = `<p>Name for the table</p><p class="name-entry"><b>${escapeHtml(draft)}</b><span class="caret"></span></p><p class="screen-action">Enter confirms</p>`;
  }

  function paintBoard(host: HTMLElement | null, marked: number): void {
    if (!host) return;
    host.innerHTML = boardHtml(table, marked);
  }

  function paintIntro(): void {
    introBoard.innerHTML = boardHtml(table, -1);
  }

  function paintBest(): void {
    if (best) best.textContent = String(topScore(table.records));
  }

  function hideEnd(): void {
    if (endName) endName.hidden = true;
    if (endBoard) endBoard.hidden = true;
    showContinue(true);
  }

  function showContinue(show: boolean): void {
    if (endContinue) endContinue.hidden = !show;
    if (endReplay) endReplay.hidden = !show;
  }

  function tickIntro(active: boolean, now: number): void {
    if (!active) {
      introElapsed = 0;
      introStamp = now;
      introPage = "title";
    } else {
      if (introStamp === 0) introStamp = now;
      introElapsed += Math.max(0, now - introStamp);
      introStamp = now;
      if (introElapsed >= INTRO_SWAP_MS) {
        introElapsed = 0;
        introPage = introPage === "title" ? "board" : "title";
        paintIntro();
      }
    }
    if (introTitle) introTitle.hidden = active && introPage === "board";
    introBoard.hidden = !active || introPage !== "board";
  }
}

function boardHtml(table: HiscoreTable, marked: number): string {
  const rows =
    table.records.length === 0
      ? `<tr><td colspan="6">No records</td></tr>`
      : table.records
          .map((record, index) => {
            const fresh = index === marked ? " class=\"fresh\"" : "";
            return `<tr${fresh}><td>${index + 1}</td><td>${escapeHtml(record.name)}</td><td>${record.score}</td><td>${record.crates}</td><td>${escapeHtml(formatDate(record.at))}</td><td>${escapeHtml(mapLabel(record.map))}</td></tr>`;
          })
          .join("");
  return `<h1>Records</h1><table class="hiscore-table"><thead><tr><th>#</th><th>name</th><th>score</th><th>crates</th><th>date</th><th>map</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function mapLabel(map: string | null): string {
  if (map === null) return "original";
  return map.length > 12 ? `${map.slice(0, 10)}…` : map;
}

function formatDate(at: string): string {
  const time = Date.parse(at);
  if (!Number.isFinite(time)) return at;
  return new Date(time).toLocaleDateString("en-GB");
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>]/g, (char) => (char === "&" ? "&amp;" : char === "<" ? "&lt;" : "&gt;"));
}

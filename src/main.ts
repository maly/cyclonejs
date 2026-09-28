import issuesFile from "../data/map/terrain-issues.json";
import terrainFile from "../data/map/terrain.json";
import { createSoundscape } from "./audio/sound.ts";
import { createInput } from "./input/input.ts";
import { startFlight } from "./render/flight.ts";
import { createHiscoreUi } from "./render/hiscore.ts";
import { startProcgen } from "./render/procgen.ts";
import { startViewer } from "./render/viewer.ts";
import { loadLayout, saveLayout } from "./scores/layout.ts";
import { IDLE_GAME } from "./sim/command.ts";
import { MAX_FRAME_SECONDS, SIM_STEP } from "./sim/config.ts";
import { createGame, interpolateGame, stepGame, toView, type GameEvent, type GameState } from "./sim/game.ts";
import type { HeliState } from "./sim/helicopter.ts";
import { applyPlacement, indexPlacement, placeFromSeed, type LayoutMode, type PlacementIndex, type PlacementResult } from "./sim/placement.ts";
import type { TerrainFile, TerrainIssuesFile } from "./sim/terrainTypes.ts";
import { GENERATOR_VERSION, generateWorld, layoutSeed, parseMapParam } from "./sim/procgen/generate.ts";
import { worldFromTerrain, type World } from "./sim/world.ts";

const root = document.querySelector<HTMLElement>("#app");
if (!root) throw new Error("Chybí #app");

const params = new URLSearchParams(window.location.search);

if (params.has("procgen")) {
  startProcgen(root);
} else if (params.has("viewer")) {
  const issues = (issuesFile as TerrainIssuesFile).issues ?? [];
  startViewer(root, worldFromTerrain(terrainFile as TerrainFile), issues);
} else {
  void startGame(root, params.has("debug"), params);
}

async function startGame(root: HTMLElement, debug: boolean, search: URLSearchParams): Promise<void> {
  const loaded = await loadWorld(root, search);
  if (!loaded) return;
  const { world, mapSeed } = loaded;
  const forcedSeed = seedFromUrl(params);
  const index = indexPlacement(world);
  let layout = loadLayout(window.localStorage);
  let seed = forcedSeed ?? randomSeed();
  const input = createInput(window, debug);
  const opened = openLayout(world, index, seed, layout, mapSeed);
  const flight = startFlight(root, world, debug);
  flight.showLayout(overlayOf(index, opened));
  const hiscores = createHiscoreUi();
  const sound = createSoundscape();
  window.addEventListener("keydown", () => sound.unlock(), { once: false });
  const options = (nextSeed: number, mode: LayoutMode) => ({
    debug,
    seed: nextSeed,
    layout: mode,
    mapSeed: mapSeed === null ? null : mapSeed.toString(),
    generator: mapSeed === null ? null : GENERATOR_VERSION,
    ...(world.baseX !== undefined && world.baseZ !== undefined ? { baseX: world.baseX, baseZ: world.baseZ } : {}),
  });
  let previous = createGame(world, options(seed, layout));
  let current = previous;
  bindMapControls(() => current.phase);
  let replayClick = false;
  document.querySelector("#end-replay")?.addEventListener("click", () => {
    replayClick = true;
  });
  let accumulator = 0;
  let last = performance.now();
  let hidden = false;
  let frameEvents: GameEvent[] = [];

  const pause = () => {
    hidden = true;
  };
  const resume = () => {
    hidden = false;
    last = performance.now();
  };
  window.addEventListener("blur", pause);
  window.addEventListener("focus", resume);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) pause();
    else resume();
  });

  const api = {
    sim(): HeliState {
      return current.heli;
    },
    game(): GameState {
      return current;
    },
    view(): GameState {
      const alpha = hidden || current.paused || current.phase !== "play" ? 1 : accumulator / SIM_STEP;
      return interpolateGame(previous, current, alpha);
    },
    camera: () => flight.cameraPosition(),
    nose: () => flight.noseWorld(),
    tail: () => flight.tailWorld(),
  };
  (window as Window & { __cyclone?: typeof api }).__cyclone = api;

  const frame = (now: number) => {
    const frameDt = Math.min(MAX_FRAME_SECONDS, Math.max(0, (now - last) / 1000));
    last = now;
    frameEvents = [];
    if (!hidden) {
      const menu = current.phase !== "play" || current.paused;
      if (menu) {
        accumulator = 0;
        let command = input.sample();
        if (hiscores.blocksConfirm()) {
          command = { ...command, confirm: false, toggleMap: false, toggleMute: false, toggleLayout: false, reseed: false };
        }
        if (command.toggleMap) flight.toggleMap();
        if (command.toggleMute) sound.toggle();
        paintVolume();
        const replaced = applyMenu(command, replayClick);
        replayClick = false;
        if (replaced) {
          previous = current;
          frameEvents = [];
        } else {
          previous = current;
          current = stepGame(current, command, world);
          frameEvents = current.events.slice();
        }
      } else {
        accumulator += frameDt;
        while (accumulator >= SIM_STEP && current.phase === "play" && !current.paused) {
          const command = input.sample();
          if (command.toggleMap) flight.toggleMap();
          if (command.toggleMute) sound.toggle();
          paintVolume();
          if (debug && command.reseed) {
            seed = (current.seed + 1) >>> 0;
            const placed = openLayout(world, index, seed, layout, mapSeed);
            flight.showLayout(overlayOf(index, placed));
            current = stepGame(createGame(world, options(seed, layout)), { ...IDLE_GAME, confirm: true }, world);
            previous = current;
            accumulator = 0;
            break;
          }
          previous = current;
          current = stepGame(current, command, world);
          frameEvents.push(...current.events);
          accumulator -= SIM_STEP;
        }
        if (current.phase !== "play" || current.paused) accumulator = 0;
      }
    }
    const alpha = hidden || current.paused || current.phase !== "play" ? 1 : accumulator / SIM_STEP;
    const shown = interpolateGame(previous, current, alpha);
    const presentation = toView(shown, world, frameEvents);
    flight.sync(presentation, hidden || current.paused ? 0 : frameDt);
    hiscores.sync(current, now);
    sound.update(presentation, frameEvents);
    const focused = document.activeElement;
    if (!(current.phase === "play" && current.paused) && focused instanceof HTMLElement && focused.id === "music-volume") focused.blur();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  bindVolume(sound);

  function paintVolume(): void {
    const readout = document.querySelector("#music-volume-readout");
    if (!readout) return;
    readout.textContent = sound.muted() ? "Muted" : String(Math.round(sound.volume() * 100));
  }

  function bindVolume(output: typeof sound): void {
    const slider = document.querySelector<HTMLInputElement>("#music-volume");
    if (!slider) return;
    slider.value = String(Math.round(output.volume() * 100));
    paintVolume();
    slider.addEventListener("input", () => {
      output.setVolume(Number(slider.value) / 100);
      paintVolume();
    });
  }

  function applyMenu(command: ReturnType<typeof input.sample>, replay: boolean): boolean {
    if (command.quit && current.phase === "play" && current.paused) {
      seed = current.seed;
      show(seed, layout);
      current = createGame(world, options(seed, layout));
      return true;
    }
    if (command.toggleLayout && current.phase === "intro") {
      layout = layout === "random" ? "original" : "random";
      saveLayout(window.localStorage, layout);
      seed = current.seed;
      show(seed, layout);
      current = createGame(world, options(seed, layout));
      return true;
    }
    if ((command.toggleLayout || replay) && current.phase === "end") {
      seed = current.seed;
      show(seed, layout);
      current = stepGame(createGame(world, options(seed, layout)), { ...IDLE_GAME, confirm: true }, world);
      return true;
    }
    if (debug && command.reseed) {
      seed = (current.seed + 1) >>> 0;
      const play = current.phase === "play";
      show(seed, layout);
      const fresh = createGame(world, options(seed, layout));
      current = play ? stepGame(fresh, { ...IDLE_GAME, confirm: true }, world) : fresh;
      return true;
    }
    if (current.phase === "end" && command.confirm) {
      seed = forcedSeed ?? randomSeed();
      show(seed, layout);
      current = createGame(world, options(seed, layout));
      return true;
    }
    return false;
  }

  function show(nextSeed: number, mode: LayoutMode): void {
    const placed = openLayout(world, index, nextSeed, mode, mapSeed);
    flight.showLayout(overlayOf(index, placed));
  }
}

function randomSeed(): number {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return buffer[0] ?? 1;
}

function seedFromUrl(search: URLSearchParams): number | null {
  if (!search.has("seed")) return null;
  const value = Number(search.get("seed"));
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) return null;
  return value;
}

function openLayout(map: World, index: PlacementIndex, nextSeed: number, mode: LayoutMode, mapSeed: bigint | null): PlacementResult {
  const placementSeed = mapSeed === null || mode === "original" ? nextSeed : layoutSeed(mapSeed, nextSeed);
  const placed = placeFromSeed(map, index, placementSeed, mode);
  applyPlacement(map, placed);
  return placed;
}

async function loadWorld(root: HTMLElement, search: URLSearchParams): Promise<{ world: World; mapSeed: bigint | null } | null> {
  const raw = search.get("map");
  if (raw === null) return { world: worldFromTerrain(terrainFile as TerrainFile), mapSeed: null };
  const note = document.createElement("div");
  note.className = "generating";
  note.textContent = "Generating the archipelago…";
  root.append(note);
  await paintFrame();
  const parsed = parseMapParam(raw);
  if (parsed === null) {
    note.textContent = "The map number is not valid.";
    return null;
  }
  try {
    const world = generateWorld(parsed);
    note.remove();
    return { world, mapSeed: parsed };
  } catch (error) {
    note.textContent = error instanceof Error ? error.message : "The generator failed.";
    return null;
  }
}

function bindMapControls(phase: () => GameState["phase"]): void {
  window.addEventListener(
    "keydown",
    (event) => {
      if (phase() !== "intro" || event.code !== "KeyG") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const buffer = new Uint32Array(1);
      crypto.getRandomValues(buffer);
      goMap(BigInt(buffer[0] ?? 0));
    },
    true,
  );
  const form = document.querySelector<HTMLFormElement>("#map-form");
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const raw = document.querySelector<HTMLInputElement>("#map-number")?.value.trim() ?? "";
    const parsed = parseMapParam(raw);
    if (parsed === null) return;
    goMap(parsed);
  });
  form?.addEventListener("keydown", (event) => {
    if (event.code !== "Space") return;
    event.preventDefault();
    event.stopPropagation();
  });
  document.querySelector("#map-original")?.addEventListener("click", () => goMap(null));
}

function goMap(seed: bigint | null): void {
  const url = new URL(window.location.href);
  if (seed === null) url.searchParams.delete("map");
  else url.searchParams.set("map", seed.toString(10));
  window.location.assign(`${url.pathname}${url.search}`);
}

function paintFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

function overlayOf(index: PlacementIndex, placed: PlacementResult) {
  return {
    crateCandidates: index.crateCells,
    peopleCandidates: index.peopleCells,
    crates: placed.cratesMarked,
  };
}

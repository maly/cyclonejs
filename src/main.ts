import issuesFile from "../data/map/terrain-issues.json";
import terrainFile from "../data/map/terrain.json";
import { createSoundscape } from "./audio/sound.ts";
import { createInput } from "./input/input.ts";
import { startFlight } from "./render/flight.ts";
import { createHiscoreUi } from "./render/hiscore.ts";
import { startViewer } from "./render/viewer.ts";
import { MAX_FRAME_SECONDS, SIM_STEP } from "./sim/config.ts";
import { createGame, interpolateGame, stepGame, toView, type GameEvent, type GameState } from "./sim/game.ts";
import type { HeliState } from "./sim/helicopter.ts";
import type { TerrainFile, TerrainIssuesFile } from "./sim/terrainTypes.ts";
import { worldFromTerrain } from "./sim/world.ts";

const root = document.querySelector<HTMLElement>("#app");
if (!root) throw new Error("Chybí #app");

const params = new URLSearchParams(window.location.search);
const world = worldFromTerrain(terrainFile as TerrainFile);

if (params.has("viewer")) {
  const issues = (issuesFile as TerrainIssuesFile).issues ?? [];
  startViewer(root, world, issues);
} else {
  startGame(root, params.has("debug"));
}

function startGame(root: HTMLElement, debug: boolean): void {
  const input = createInput(window, debug);
  const flight = startFlight(root, world, debug);
  const hiscores = createHiscoreUi();
  const sound = createSoundscape();
  window.addEventListener("keydown", () => sound.unlock(), { once: false });
  let previous = createGame(world, { debug });
  let current = previous;
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
        previous = current;
        let command = input.sample();
        if (hiscores.blocksConfirm()) command = { ...command, confirm: false, toggleMap: false, toggleMute: false };
        if (command.toggleMap) flight.toggleMap();
        if (command.toggleMute) sound.toggle();
        current = stepGame(current, command, world);
        frameEvents = current.events.slice();
      } else {
        accumulator += frameDt;
        while (accumulator >= SIM_STEP && current.phase === "play" && !current.paused) {
          previous = current;
          const command = input.sample();
          if (command.toggleMap) flight.toggleMap();
          if (command.toggleMute) sound.toggle();
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
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

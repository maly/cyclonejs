import { CEILING, CYCLONE_DANGER, FUEL_MAX, MAX_SPEED, ROUND_SECONDS, SCORE_CRATE, SCORE_PERSON, SCORE_SECOND, START_LIVES } from "../sim/config.ts";
import { formatClock, type GameView } from "../sim/game.ts";
import { horizontalSpeed } from "../sim/helicopter.ts";
import { formatHeliport } from "../sim/heliports.ts";

export interface Hud {
  update(view: GameView, aboveGround: number): void;
  setArrow(angle: number | null): void;
  readouts(): { debug: HTMLElement | null; freeButton: HTMLElement | null };
}

export function createHud(root: HTMLElement, debug: boolean): Hud {
  const hud = document.createElement("div");
  hud.className = "hud";
  hud.innerHTML = `
    <div id="plane-alert" class="plane-alert"></div>
    <aside class="hud-side">
      <div class="columns">
        <div class="column"><div class="track"><span id="hud-alt-bar"></span></div><b>A</b><small id="hud-alt"></small></div>
        <div class="column"><div class="track"><span id="hud-spd-bar"></span></div><b>S</b><small id="hud-spd"></small></div>
        <div class="column" id="hud-fuel-gauge"><div class="track"><span id="hud-fuel-bar"></span></div><b>F</b><small id="hud-fuel"></small></div>
        <div class="column"><div class="track"><span id="hud-time-bar"></span></div><b>T</b><small id="hud-time"></small></div>
      </div>
      <div class="compass"><i>N</i><span id="hud-hdg"></span></div>
      <div class="hud-lives" id="hud-lives"></div>
      <div class="hud-crates" id="hud-crates"></div>
      <div class="hud-people"><i></i><b id="hud-people">0</b></div>
      <div class="wind-force">
        <span>WIND FORCE</span>
        <span class="gauge wind" id="hud-wind-gauge"><span id="hud-wind-bar"></span><span id="hud-wind-hot"></span><em class="danger-mark">DANGER</em></span>
      </div>
      <div class="hud-meta">
        <div>Score <b id="hud-score">0</b></div>
        <div>Hiscore <b id="hud-best">0</b></div>
        <div id="hud-view">VIEW SOUTH</div>
      </div>
    </aside>
  `;
  root.appendChild(hud);

  const pause = document.createElement("div");
  pause.className = "screen";
  pause.id = "pause-screen";
  pause.hidden = true;
  pause.innerHTML = `
    <div class="screen-card">
      <h1>Paused</h1>
      <label class="volume-setting">Volume
        <input id="music-volume" type="range" min="0" max="100" step="1" value="35" />
        <b id="music-volume-readout">35</b>
      </label>
      <p class="screen-action">Esc — continue</p>
      <p class="screen-action">Q — main menu</p>
    </div>
  `;
  root.appendChild(pause);

  const title = document.createElement("div");
  title.className = "screen";
  title.id = "intro-screen";
  title.innerHTML = `
    <div class="screen-card" id="intro-title">
      <h1>Cyclone</h1>
      <p>Winch up five crates and land them at the base. Pick up people along the way, and refuel at the heliports.</p>
      <ul>
        <li>Q and up arrow to climb, A and down arrow to descend</li>
        <li>O and left arrow, P and right arrow to turn</li>
        <li>Space to fly forward, N to change the view</li>
        <li>M map, S sound, Esc pause, R layout</li>
      </ul>
      <p id="intro-layout" class="screen-action">Layout: random</p>
      <p id="intro-map" class="screen-action">Map: Original</p>
      <form id="map-form" class="map-form">
        <label>Number <input id="map-number" inputmode="numeric" autocomplete="off" spellcheck="false" /></label>
        <button type="submit">Archipelago</button>
        <button type="button" id="map-original">Original</button>
      </form>
      <p class="screen-action">G rolls an archipelago, Enter uses it</p>
      <p class="screen-action">Space starts the game</p>
    </div>
  `;
  root.appendChild(title);

  const end = document.createElement("div");
  end.className = "screen";
  end.hidden = true;
  end.innerHTML = `
    <div class="screen-card">
      <h1 id="end-title"></h1>
      <p id="end-reason"></p>
      <div id="end-score" class="score-breakdown"></div>
      <div id="end-name" hidden></div>
      <div id="end-board" hidden></div>
      <p id="end-seed"></p>
      <p id="end-map"></p>
      <button type="button" class="screen-action" id="end-replay">Play the same game again</button>
      <p class="screen-action" id="end-continue">Space — new game</p>
    </div>
  `;
  root.appendChild(end);
  const arrow = document.createElement("div");
  arrow.className = "plane-arrow";
  arrow.textContent = "▲";
  arrow.hidden = true;
  root.appendChild(arrow);
  const veil = document.createElement("div");
  veil.className = "storm-veil";
  root.appendChild(veil);
  const vignette = document.createElement("div");
  vignette.className = "vignette";
  root.appendChild(vignette);

  let debugReadout: HTMLElement | null = null;
  let freeButton: HTMLElement | null = null;
  if (debug) {
    const panel = document.createElement("div");
    panel.className = "panel";
    panel.innerHTML = `
      <h1>Cyclone, debug</h1>
      <p id="debug-readout"></p>
      <p id="debug-heliports" class="heliports"></p>
      <button type="button" id="free-camera">Free camera</button>
    `;
    root.appendChild(panel);
    debugReadout = panel.querySelector("#debug-readout");
    freeButton = panel.querySelector("#free-camera");
  }

  const take = (id: string) => hud.querySelector(`#${id}`) as HTMLElement;
  let heliportsPrinted = false;

  return {
    readouts: () => ({ debug: debugReadout, freeButton }),
    setArrow(angle) {
      arrow.hidden = angle === null;
      if (angle !== null) arrow.style.transform = `translate(-50%, -50%) rotate(${angle}rad)`;
    },
    update(view, aboveGround) {
      veil.style.opacity = String(view.phase === "play" ? Math.min(0.5, view.wind * 0.48) : 0);
      const playing = view.phase === "play";
      hud.hidden = !playing;
      pause.hidden = !(playing && view.paused);
      title.hidden = view.phase !== "intro";
      end.hidden = view.phase !== "end";
      const layout = document.querySelector("#intro-layout");
      if (layout) layout.textContent = view.layout === "original" ? "Layout: original" : "Layout: random";
      const mapLine = document.querySelector("#intro-map");
      if (mapLine) mapLine.textContent = mapCaption(view.mapSeed, view.generator);
      const seedLine = document.querySelector("#end-seed");
      if (seedLine && view.phase === "end") seedLine.textContent = `Seed ${view.seed >>> 0}`;
      const endMap = document.querySelector("#end-map");
      if (endMap && view.phase === "end") endMap.textContent = mapCaption(view.mapSeed, view.generator);

      const alert = take("plane-alert");
      alert.textContent = view.planeAlert ?? "";
      alert.classList.toggle("blink", Boolean(view.planeAlert));

      if (playing) {
        const altitude = Math.max(0, Math.min(1, aboveGround / CEILING));
        const speed = Math.max(0, Math.min(1, horizontalSpeed(view.heli) / MAX_SPEED));
        const fuel = Math.max(0, Math.min(1, view.fuel / FUEL_MAX));
        const time = Math.max(0, Math.min(1, view.timeLeft / ROUND_SECONDS));
        take("hud-alt-bar").style.height = `${altitude * 100}%`;
        take("hud-spd-bar").style.height = `${speed * 100}%`;
        take("hud-fuel-bar").style.height = `${fuel * 100}%`;
        take("hud-time-bar").style.height = `${time * 100}%`;
        take("hud-alt").textContent = aboveGround.toFixed(1);
        take("hud-spd").textContent = horizontalSpeed(view.heli).toFixed(1);
        take("hud-fuel").textContent = String(Math.round(view.fuel));
        take("hud-time").textContent = formatClock(view.timeLeft);
        take("hud-fuel-gauge").classList.toggle("warn", view.fuelWarning);
        const degrees = (view.heli.heading * 180) / Math.PI;
        take("hud-hdg").style.transform = `translate(-50%, -100%) rotate(${degrees}deg)`;
        const alive = Math.max(0, view.lives);
        take("hud-lives").innerHTML = Array.from({ length: START_LIVES }, (_, index) => `<i class="${index < alive ? "on" : ""}"></i>`).join("");
        take("hud-crates").innerHTML = view.collectedCrates.map((got) => `<i class="${got ? "got" : ""}"></i>`).join("");
        take("hud-people").textContent = String(view.people);
        take("hud-score").textContent = String(view.score);
        take("hud-view").textContent = view.heli.view === "north" ? "VIEW NORTH" : "VIEW SOUTH";
        const wind = Math.max(0, Math.min(1, view.wind));
        const danger = wind >= CYCLONE_DANGER;
        take("hud-wind-bar").style.width = `${Math.min(wind, CYCLONE_DANGER) * 100}%`;
        take("hud-wind-hot").style.width = `${Math.max(0, wind - CYCLONE_DANGER) * 100}%`;
        take("hud-wind-gauge").classList.toggle("in-danger", danger);
      }
      if (view.phase === "end") fillEnd(view);
      if (debug && !heliportsPrinted) {
        const block = root.querySelector("#debug-heliports");
        if (block) {
          block.textContent = [`Heliports (${view.heliports.length})`, ...view.heliports.map(formatHeliport)].join("\n");
          console.info(block.textContent);
          heliportsPrinted = true;
        }
      }
    },
  };
}

function mapCaption(mapSeed: string | null, generator: number | null): string {
  if (!mapSeed || generator === null) return "Map: Original";
  return `Archipelago no. ${mapSeed} · generator ${generator}`;
}

function fillEnd(view: GameView): void {
  const title = document.querySelector("#end-title");
  const reason = document.querySelector("#end-reason");
  const score = document.querySelector("#end-score");
  if (!title || !reason || !score) return;
  const success = view.outcome === "success";
  title.textContent = success ? "Success" : "Failure";
  reason.textContent = success
    ? "All the crates are at the base."
    : view.failReason === "lives"
      ? "You lost every helicopter."
      : "Time ran out.";
  score.innerHTML = [
    line("Crates", `${view.crates} × ${SCORE_CRATE}`, view.crateScore),
    line("People", `${view.people} × ${SCORE_PERSON}`, view.peopleScore),
    line("Time bonus", `${view.timeBonus / SCORE_SECOND} × ${SCORE_SECOND}`, view.timeBonus),
    line("Total", "", view.score),
  ].join("");
}

function line(label: string, detail: string, value: number): string {
  return `<div><span>${label}</span><span>${detail}</span><b>${value}</b></div>`;
}



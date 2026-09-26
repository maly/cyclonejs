import { findHeliports } from "../sim/heliports.ts";
import { assessWorld } from "../sim/procgen/validate.ts";
import { generateWorld, GENERATOR_VERSION, parseMapParam } from "../sim/procgen/generate.ts";
import type { World } from "../sim/world.ts";

const HEIGHT_COLOR: readonly (readonly [number, number, number])[] = [
  [214, 196, 138],
  [92, 158, 78],
  [70, 138, 68],
  [108, 128, 74],
  [148, 132, 96],
  [176, 154, 116],
  [214, 204, 184],
  [244, 244, 236],
];

/** Ladicí pohled shora. Číslo mapy je v `?map=`, tlačítka ho posouvají o jedna. */
export function startProcgen(root: HTMLElement): void {
  root.innerHTML = `
    <div class="procgen">
      <form id="procgen-form" class="procgen-bar">
        <button type="button" id="procgen-prev">předchozí</button>
        <label>Číslo <input id="procgen-seed" autocomplete="off" spellcheck="false" /></label>
        <button type="submit">zobrazit</button>
        <button type="button" id="procgen-next">další</button>
      </form>
      <div class="procgen-stage">
        <canvas id="procgen-map" width="638" height="588"></canvas>
        <pre id="procgen-report"></pre>
      </div>
    </div>
  `;
  const canvas = root.querySelector<HTMLCanvasElement>("#procgen-map");
  const report = root.querySelector<HTMLElement>("#procgen-report");
  const input = root.querySelector<HTMLInputElement>("#procgen-seed");
  const context = canvas?.getContext("2d");
  if (!canvas || !report || !input || !context) return;

  const initial = parseMapParam(new URLSearchParams(window.location.search).get("map") ?? "0") ?? 0n;
  let seed = initial;
  const show = (next: bigint) => {
    seed = next < 0n ? 0n : next;
    input.value = seed.toString(10);
    const url = new URL(window.location.href);
    url.searchParams.set("procgen", "");
    url.searchParams.set("map", seed.toString(10));
    history.replaceState(null, "", `${url.pathname}${url.search}`);
    const started = performance.now();
    try {
      const world = generateWorld(seed);
      const elapsed = performance.now() - started;
      drawWorld(context, world);
      const check = assessWorld(world);
      report.textContent = [
        `Souostroví č. ${seed}`,
        `generátor ${GENERATOR_VERSION}`,
        `čas ${elapsed.toFixed(1)} ms`,
        `ostrovy ${check.islands}, heliporty ${check.heliports}, domy ${check.houses}, stromy ${check.trees}`,
        check.ok ? "kontrola: v pořádku" : `kontrola: ${check.reasons.join("; ")}`,
      ].join("\n");
    } catch (error) {
      const elapsed = performance.now() - started;
      context.fillStyle = "#12343c";
      context.fillRect(0, 0, canvas.width, canvas.height);
      report.textContent = [`Souostroví č. ${seed}`, `čas ${elapsed.toFixed(1)} ms`, error instanceof Error ? error.message : "Generátor selhal."].join("\n");
    }
  };

  root.querySelector("#procgen-prev")?.addEventListener("click", () => show(seed - 1n));
  root.querySelector("#procgen-next")?.addEventListener("click", () => show(seed + 1n));
  root.querySelector("#procgen-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const parsed = parseMapParam(input.value.trim());
    if (parsed === null) return;
    show(parsed);
  });
  show(seed);
}

function drawWorld(context: CanvasRenderingContext2D, world: World): void {
  const image = context.createImageData(world.width, world.depth);
  const pixels = image.data;
  for (let index = 0; index < world.surface.length; index++) {
    const surface = world.surface[index] ?? 0;
    const offset = index * 4;
    if (surface === 0) {
      pixels[offset] = 28;
      pixels[offset + 1] = 104;
      pixels[offset + 2] = 138;
      pixels[offset + 3] = 255;
      continue;
    }
    const color = HEIGHT_COLOR[world.height[index] ?? 0] ?? HEIGHT_COLOR[1];
    pixels[offset] = color?.[0] ?? 0;
    pixels[offset + 1] = color?.[1] ?? 0;
    pixels[offset + 2] = color?.[2] ?? 0;
    pixels[offset + 3] = 255;
    if (surface === 3) paint(pixels, offset, 90, 90, 90);
    if (surface === 4) paint(pixels, offset, 244, 244, 236);
    if (surface === 5) paint(pixels, offset, 150, 72, 58);
  }
  context.putImageData(image, 0, 0);
  const pads = findHeliports(world, world.baseX, world.baseZ).list;
  context.strokeStyle = "#1d3a32";
  for (const pad of pads) context.strokeRect(pad.x + 0.5, pad.z + 0.5, pad.w - 1, pad.h - 1);
  for (const tree of world.trees) dot(context, tree.x, tree.z, "#1d4a28");
  for (const crate of world.crates) dot(context, crate.x, crate.z, "#e07020");
  for (const person of world.people) dot(context, person.x, person.z, "#f2d15a");
}

function paint(pixels: Uint8ClampedArray, offset: number, red: number, green: number, blue: number): void {
  pixels[offset] = red;
  pixels[offset + 1] = green;
  pixels[offset + 2] = blue;
}

function dot(context: CanvasRenderingContext2D, x: number, z: number, color: string): void {
  context.fillStyle = color;
  context.fillRect(x, z, 2, 2);
}

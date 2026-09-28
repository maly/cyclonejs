import { CYCLONE_DANGER_RADIUS, CYCLONE_INNER, CYCLONE_WIND } from "../sim/config.ts";
import type { GameView } from "../sim/game.ts";
import type { PlacedCrate } from "../sim/placement.ts";
import { surfaceAt, type World } from "../sim/world.ts";
import type { Heliport } from "../sim/heliports.ts";

export interface MapOverlay {
  crateCandidates: readonly { x: number; z: number }[];
  peopleCandidates: readonly { x: number; z: number }[];
  crates: readonly PlacedCrate[];
}

export interface Radar {
  toggle(): void;
  sync(view: GameView): void;
  setOverlay(overlay: MapOverlay | null): void;
}

export function createRadar(root: HTMLElement, world: World, pads: readonly Heliport[], debug = false): Radar {
  const layer = document.createElement("div");
  layer.className = "map-layer";
  layer.hidden = true;
  const canvas = document.createElement("canvas");
  const scale = 1;
  canvas.width = world.width * scale;
  canvas.height = world.depth * scale;
  canvas.style.aspectRatio = `${world.width} / ${world.depth}`;
  canvas.style.flex = "0 0 auto";
  canvas.style.width = `min(92vw, calc(86vh * ${world.width} / ${world.depth}))`;
  canvas.style.height = `min(86vh, calc(92vw * ${world.depth} / ${world.width}))`;
  layer.appendChild(canvas);
  const caption = document.createElement("p");
  caption.className = "map-caption";
  caption.hidden = !debug;
  layer.appendChild(caption);
  root.appendChild(layer);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Chybí plátno mapy");
  const islands = context.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = islands.data;
  for (let z = 0; z < world.depth; z++) {
    for (let x = 0; x < world.width; x++) {
      if (surfaceAt(world, x + 0.5, z + 0.5) === 0) continue;
      const index = (z * canvas.width + x) * 4;
      pixels[index] = 92;
      pixels[index + 1] = 140;
      pixels[index + 2] = 78;
      pixels[index + 3] = 255;
    }
  }
  const labels = islandLabels(world);
  let open = false;
  let overlayImage: ImageData | null = null;
  let placed: readonly PlacedCrate[] = [];

  return {
    toggle() {
      open = !open;
      layer.hidden = !open;
    },
    setOverlay(overlay) {
      placed = overlay?.crates ?? [];
      overlayImage = debug && overlay ? bakeOverlay(islands, overlay) : null;
    },
    sync(view) {
      if (!open) return;
      context.putImageData(overlayImage ?? islands, 0, 0);
      if (debug) {
        caption.hidden = false;
        caption.textContent = `seed ${view.seed >>> 0} · a circle is a crate, red is hidden from the south, blue from the north`;
      }
      context.fillStyle = "#f4f1e4";
      for (const pad of pads) {
        context.fillRect(pad.x, pad.z, pad.w, pad.h);
      }
      context.font = "13px sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.lineWidth = 3;
      context.strokeStyle = "#1d3a32";
      context.fillStyle = "#f7f3e8";
      for (const label of labels) {
        context.strokeText(label.name, label.x, label.z);
        context.fillText(label.name, label.x, label.z);
      }
      const storm = view.storm;
      strokeCircle(context, storm.x, storm.z, CYCLONE_WIND, "rgba(210, 220, 230, 0.55)");
      strokeCircle(context, storm.x, storm.z, CYCLONE_DANGER_RADIUS, "rgba(180, 70, 60, 0.9)");
      strokeCircle(context, storm.x, storm.z, CYCLONE_INNER, "rgba(140, 36, 28, 0.95)");
      context.fillStyle = "#e8eef2";
      context.beginPath();
      context.arc(storm.x, storm.z, 3, 0, Math.PI * 2);
      context.fill();
      if (debug) drawCrates(context, placed);
      const heli = view.heli;
      context.save();
      context.translate(heli.x, heli.z);
      context.rotate(heli.heading);
      context.fillStyle = "#f2d15a";
      context.beginPath();
      context.moveTo(0, -5);
      context.lineTo(3.2, 4);
      context.lineTo(-3.2, 4);
      context.closePath();
      context.fill();
      context.restore();
    },
  };
}

function islandLabels(world: World): { name: string; x: number; z: number }[] {
  if (!world.island || !world.islandNames) return [];
  const sumX = new Map<string, number>();
  const sumZ = new Map<string, number>();
  const count = new Map<string, number>();
  for (let z = 0; z < world.depth; z++) {
    for (let x = 0; x < world.width; x++) {
      const code = world.island[z * world.width + x] ?? 0;
      if (code === 0) continue;
      const name = world.islandNames[code - 1];
      if (!name) continue;
      sumX.set(name, (sumX.get(name) ?? 0) + x);
      sumZ.set(name, (sumZ.get(name) ?? 0) + z);
      count.set(name, (count.get(name) ?? 0) + 1);
    }
  }
  const labels: { name: string; x: number; z: number }[] = [];
  for (const [name, cells] of count) {
    if (!cells) continue;
    labels.push({ name, x: (sumX.get(name) ?? 0) / cells, z: (sumZ.get(name) ?? 0) / cells });
  }
  return labels;
}

function bakeOverlay(base: ImageData, overlay: MapOverlay): ImageData {
  const copy = new Uint8ClampedArray(base.data);
  paintCells(copy, base.width, overlay.peopleCandidates, 70, 120, 190);
  paintCells(copy, base.width, overlay.crateCandidates, 214, 140, 48);
  return new ImageData(copy, base.width, base.height);
}

function paintCells(
  pixels: Uint8ClampedArray,
  width: number,
  cells: readonly { x: number; z: number }[],
  red: number,
  green: number,
  blue: number,
): void {
  for (const cell of cells) {
    const index = (cell.z * width + cell.x) * 4;
    if (index < 0 || index + 3 >= pixels.length) continue;
    pixels[index] = red;
    pixels[index + 1] = green;
    pixels[index + 2] = blue;
    pixels[index + 3] = 255;
  }
}

function drawCrates(context: CanvasRenderingContext2D, crates: readonly PlacedCrate[]): void {
  for (const crate of crates) {
    const x = crate.x + 0.5;
    const z = crate.z + 0.5;
    context.lineWidth = 2;
    context.beginPath();
    context.arc(x, z, 7, 0, Math.PI * 2);
    context.strokeStyle = crate.south ? "#ff3b30" : crate.north ? "#3c78e0" : "#ffe14a";
    context.stroke();
    if (crate.south && crate.north) {
      context.beginPath();
      context.arc(x, z, 7, Math.PI, Math.PI * 2);
      context.strokeStyle = "#3c78e0";
      context.stroke();
    }
    context.fillStyle = "#fff8d0";
    context.fillRect(crate.x - 1, crate.z - 1, 3, 3);
  }
}

function strokeCircle(context: CanvasRenderingContext2D, x: number, z: number, radius: number, color: string): void {
  context.strokeStyle = color;
  context.lineWidth = 1.5;
  context.beginPath();
  context.arc(x, z, radius, 0, Math.PI * 2);
  context.stroke();
}

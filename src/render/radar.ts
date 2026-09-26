import { CYCLONE_DANGER_RADIUS, CYCLONE_INNER, CYCLONE_WIND } from "../sim/config.ts";
import type { GameView } from "../sim/game.ts";
import { surfaceAt, type World } from "../sim/world.ts";
import type { Heliport } from "../sim/heliports.ts";

export interface Radar {
  toggle(): void;
  sync(view: GameView): void;
}

export function createRadar(root: HTMLElement, world: World, pads: readonly Heliport[]): Radar {
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
  let open = false;

  return {
    toggle() {
      open = !open;
      layer.hidden = !open;
    },
    sync(view) {
      if (!open) return;
      context.putImageData(islands, 0, 0);
      context.fillStyle = "#f4f1e4";
      for (const pad of pads) {
        context.fillRect(pad.x, pad.z, pad.w, pad.h);
      }
      const storm = view.storm;
      strokeCircle(context, storm.x, storm.z, CYCLONE_WIND, "rgba(210, 220, 230, 0.55)");
      strokeCircle(context, storm.x, storm.z, CYCLONE_DANGER_RADIUS, "rgba(180, 70, 60, 0.9)");
      strokeCircle(context, storm.x, storm.z, CYCLONE_INNER, "rgba(140, 36, 28, 0.95)");
      context.fillStyle = "#e8eef2";
      context.beginPath();
      context.arc(storm.x, storm.z, 3, 0, Math.PI * 2);
      context.fill();
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

function strokeCircle(context: CanvasRenderingContext2D, x: number, z: number, radius: number, color: string): void {
  context.strokeStyle = color;
  context.lineWidth = 1.5;
  context.beginPath();
  context.arc(x, z, radius, 0, Math.PI * 2);
  context.stroke();
}

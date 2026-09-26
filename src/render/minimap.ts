import { CYCLONE_DANGER_RADIUS, CYCLONE_WIND, MINIMAP_CELLS } from "../sim/config.ts";
import type { GameView } from "../sim/game.ts";
import type { Heliport } from "../sim/heliports.ts";
import { heightAt, surfaceAt, type World } from "../sim/world.ts";

export function createMinimap(root: HTMLElement, world: World, pads: readonly Heliport[]): { sync(view: GameView): void } {
  const wrap = document.createElement("div");
  wrap.className = "minimap";
  const canvas = document.createElement("canvas");
  const size = 220;
  canvas.width = size;
  canvas.height = size;
  wrap.appendChild(canvas);
  root.appendChild(wrap);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Chybí plátno minimapy");
  const scale = size / MINIMAP_CELLS;

  return {
    sync(view) {
      const half = MINIMAP_CELLS / 2;
      const originX = view.heli.x - half;
      const originZ = view.heli.z - half;
      context.fillStyle = "#12343f";
      context.fillRect(0, 0, size, size);
      const x0 = Math.max(0, Math.floor(originX));
      const x1 = Math.min(world.width - 1, Math.ceil(originX + MINIMAP_CELLS));
      const z0 = Math.max(0, Math.floor(originZ));
      const z1 = Math.min(world.depth - 1, Math.ceil(originZ + MINIMAP_CELLS));
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) {
          if (surfaceAt(world, x + 0.5, z + 0.5) === 0) continue;
          const shade = 70 + heightAt(world, x + 0.5, z + 0.5) * 12;
          context.fillStyle = `rgb(${shade * 0.7}, ${shade}, ${shade * 0.55})`;
          context.fillRect((x - originX) * scale, (z - originZ) * scale, scale + 0.5, scale + 0.5);
        }
      }
      context.fillStyle = "#fff4c2";
      context.strokeStyle = "#1d3a32";
      context.lineWidth = 1.5;
      for (const pad of pads) {
        if (pad.x + pad.w < originX || pad.z + pad.h < originZ || pad.x > originX + MINIMAP_CELLS || pad.z > originZ + MINIMAP_CELLS) {
          continue;
        }
        const px = (pad.x - originX) * scale;
        const py = (pad.z - originZ) * scale;
        context.fillRect(px, py, pad.w * scale, pad.h * scale);
        context.strokeRect(px, py, pad.w * scale, pad.h * scale);
      }
      const stormX = (view.storm.x - originX) * scale;
      const stormY = (view.storm.z - originZ) * scale;
      context.lineWidth = 1.5;
      context.strokeStyle = "rgba(232, 238, 242, 0.45)";
      context.beginPath();
      context.arc(stormX, stormY, CYCLONE_WIND * scale, 0, Math.PI * 2);
      context.stroke();
      context.strokeStyle = "rgba(210, 74, 58, 0.95)";
      context.beginPath();
      context.arc(stormX, stormY, CYCLONE_DANGER_RADIUS * scale, 0, Math.PI * 2);
      context.stroke();
      const outside =
        view.storm.x < originX ||
        view.storm.z < originZ ||
        view.storm.x > originX + MINIMAP_CELLS ||
        view.storm.z > originZ + MINIMAP_CELLS;
      if (outside) {
        const dx = view.storm.x - view.heli.x;
        const dz = view.storm.z - view.heli.z;
        const reach = (half - 6) / Math.max(Math.abs(dx), Math.abs(dz), 0.001);
        drawArrow(context, size / 2 + dx * reach * scale, size / 2 + dz * reach * scale, Math.atan2(dx, -dz), "#e8eef2");
      }
      drawArrow(context, size / 2, size / 2, view.heli.heading, "#f2d15a");
    },
  };
}

function drawArrow(context: CanvasRenderingContext2D, x: number, y: number, heading: number, color: string): void {
  context.save();
  context.translate(x, y);
  context.rotate(heading);
  context.fillStyle = color;
  context.beginPath();
  context.moveTo(0, -7);
  context.lineTo(4.5, 6);
  context.lineTo(-4.5, 6);
  context.closePath();
  context.fill();
  context.restore();
}

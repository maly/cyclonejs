import { ACESFilmicToneMapping, Color, DirectionalLight, HemisphereLight, PerspectiveCamera, Raycaster, Scene, SRGBColorSpace, Vector2, WebGLRenderer } from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { PlanIssue } from "../sim/terrainTypes.ts";
import { estimatedAt, heightAt, SURFACE_NAME, surfaceAt, type World } from "../sim/world.ts";
import { buildIssueMesh } from "./markers.ts";
import { createProps } from "./props.ts";
import { createSea } from "./sea.ts";
import { HEMI_GROUND, HEMI_INTENSITY, HEMI_SKY, SUN_COLOR, SUN_DIR, SUN_INTENSITY } from "./style.ts";
import { buildEstimateMesh, buildTerrainMeshes } from "./terrain.ts";

export function startViewer(root: HTMLElement, world: World, issues: PlanIssue[]): void {
  const renderer = new WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(root.clientWidth, root.clientHeight);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  root.appendChild(renderer.domElement);

  const scene = new Scene();
  scene.background = new Color(0x7ec8d8);
  const hemi = new HemisphereLight(0xffffff, 0xffffff, HEMI_INTENSITY);
  hemi.color.setRGB(HEMI_SKY[0], HEMI_SKY[1], HEMI_SKY[2]);
  hemi.groundColor.setRGB(HEMI_GROUND[0], HEMI_GROUND[1], HEMI_GROUND[2]);
  scene.add(hemi);
  const sun = new DirectionalLight(0xffffff, SUN_INTENSITY);
  sun.color.setRGB(SUN_COLOR[0], SUN_COLOR[1], SUN_COLOR[2]);
  sun.position.set(world.width / 2 + SUN_DIR[0] * 80, SUN_DIR[1] * 80, world.depth / 2 + SUN_DIR[2] * 80);
  sun.target.position.set(world.width / 2, 0, world.depth / 2);
  scene.add(sun, sun.target);

  const terrain = buildTerrainMeshes(world);
  for (const mesh of terrain) scene.add(mesh);
  const sea = createSea(world);
  scene.add(sea.mesh);
  scene.add(createProps(world).group);

  const estimates = buildEstimateMesh(world);
  estimates.visible = false;
  estimates.raycast = () => undefined;
  scene.add(estimates);
  const issueMesh = buildIssueMesh(world, issues);
  scene.add(issueMesh);

  const camera = new PerspectiveCamera(42, root.clientWidth / root.clientHeight, 0.1, 4000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.49;
  showWorld(camera, controls, world);

  const panel = document.createElement("div");
  panel.className = "panel";
  panel.innerHTML = `
    <h1>Cyclone, terrain</h1>
    <p>Free camera. Drag to look around, scroll to zoom.</p>
    <div class="row">
      <button type="button" id="view-world">Whole map</button>
      <button type="button" id="view-base">Base</button>
    </div>
    <label><input type="checkbox" id="show-estimated" /> Estimated cells</label>
    <label><input type="checkbox" id="show-issues" /> Problem spots</label>
    <p id="cell-info">Click a cell.</p>
  `;
  root.appendChild(panel);
  panel.querySelector("#view-world")?.addEventListener("click", () => showWorld(camera, controls, world));
  panel.querySelector("#view-base")?.addEventListener("click", () => showBase(camera, controls));
  panel.querySelector("#show-estimated")?.addEventListener("change", (event: Event) => {
    estimates.visible = (event.target as HTMLInputElement).checked;
  });
  panel.querySelector("#show-issues")?.addEventListener("change", (event: Event) => {
    issueMesh.visible = (event.target as HTMLInputElement).checked;
  });

  const info = panel.querySelector("#cell-info") as HTMLElement;
  const raycaster = new Raycaster();
  const pointer = new Vector2();
  renderer.domElement.addEventListener("pointerdown", (event) => {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects([...terrain, sea.mesh], false)[0];
    if (!hit) return;
    const x = Math.floor(hit.point.x);
    const z = Math.floor(hit.point.z);
    info.textContent = describeCell(world, issues, x, z);
  });

  const started = performance.now();
  const frame = () => {
    sea.material.uniforms.uTime.value = (performance.now() - started) / 1000;
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  };
  frame();

  window.addEventListener("resize", () => {
    camera.aspect = root.clientWidth / root.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(root.clientWidth, root.clientHeight);
  });
}

function showWorld(camera: PerspectiveCamera, controls: OrbitControls, world: World) {
  controls.target.set(world.width / 2, 0, world.depth / 2);
  camera.position.set(world.width / 2, 340, world.depth / 2 + 460);
  controls.update();
}

function showBase(camera: PerspectiveCamera, controls: OrbitControls) {
  controls.target.set(274, 4, 312);
  camera.position.set(300, 48, 360);
  controls.update();
}

export function describeCell(world: World, issues: PlanIssue[], x: number, z: number): string {
  const here = issues.filter((issue) => issue.x === x && issue.y === z);
  const problem = here.length ? here.map((issue) => `${issue.type}: ${issue.message}`).join("\n") : "none";
  return [
    `Cell ${x}, ${z}`,
    `Height ${heightAt(world, x + 0.5, z + 0.5)}`,
    `Surface ${SURFACE_NAME[surfaceAt(world, x + 0.5, z + 0.5)] ?? "unknown"}`,
    `Estimated ${estimatedAt(world, x + 0.5, z + 0.5) ? "yes" : "no"}`,
    `Problem: ${problem}`,
  ].join("\n");
}

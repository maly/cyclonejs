import {
  ACESFilmicToneMapping,
  BufferGeometry,
  Color,
  DirectionalLight,
  Float32BufferAttribute,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  LineBasicMaterial,
  LineLoop,
  LineSegments,
  OrthographicCamera,
  PCFSoftShadowMap,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  CAMERA_DISTANCE,
  CAMERA_HALF,
  CAMERA_LAG,
  CAMERA_SWITCH,
  CAMERA_ZOOM_MAX,
  CAMERA_ZOOM_MIN,
  CYCLONE_DANGER_RADIUS,
  CYCLONE_INNER,
  CYCLONE_WIND,
  HELI_RADIUS,
} from "../sim/config.ts";
import type { GameView } from "../sim/game.ts";
import type { HeliState } from "../sim/helicopter.ts";
import { heightAt, type World } from "../sim/world.ts";
import { findHeliports } from "../sim/heliports.ts";
import { approachAngle, cameraOffset, isoEuler, viewAzimuth } from "./cameraMath.ts";
import { createCrashVisual } from "./crash.ts";
import { createHeliVisual } from "./helicopter.ts";
import { createHud } from "./hud.ts";
import { createMinimap } from "./minimap.ts";
import { createPlaneVisual } from "./plane.ts";
import { createProps } from "./props.ts";
import { createRadar, type MapOverlay } from "./radar.ts";
import { createSea } from "./sea.ts";
import { createStormVisual } from "./storm.ts";
import { HEMI_GROUND, HEMI_INTENSITY, HEMI_SKY, SUN_COLOR, SUN_DIR, SUN_INTENSITY } from "./style.ts";
import { buildTerrainMeshes } from "./terrain.ts";

export interface FlightView {
  sync(state: GameView, dt: number): void;
  sim: HeliState;
  cameraPosition(): { x: number; y: number; z: number };
  noseWorld(): { x: number; y: number; z: number };
  tailWorld(): { x: number; y: number; z: number };
  toggleMap(): void;
  showLayout(overlay: MapOverlay): void;
}

export function startFlight(root: HTMLElement, world: World, debug: boolean): FlightView {
  const renderer = new WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(root.clientWidth, root.clientHeight);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  root.appendChild(renderer.domElement);

  const scene = new Scene();
  scene.background = new Color(0x7ec8d8);
  const hemi = new HemisphereLight(0xffffff, 0xffffff, HEMI_INTENSITY);
  hemi.color.setRGB(HEMI_SKY[0], HEMI_SKY[1], HEMI_SKY[2]);
  hemi.groundColor.setRGB(HEMI_GROUND[0], HEMI_GROUND[1], HEMI_GROUND[2]);
  scene.add(hemi);
  const calmSky = new Color(0x7ec8d8);
  const stormSky = new Color(0x1a2830);
  const sun = new DirectionalLight(0xffffff, SUN_INTENSITY);
  sun.color.setRGB(SUN_COLOR[0], SUN_COLOR[1], SUN_COLOR[2]);
  sun.castShadow = false;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.near = 2;
  sun.shadow.camera.far = 90;
  sun.shadow.camera.left = -24;
  sun.shadow.camera.right = 24;
  sun.shadow.camera.top = 24;
  sun.shadow.camera.bottom = -24;
  sun.shadow.bias = -0.00035;
  sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);

  for (const mesh of buildTerrainMeshes(world, { eastWestWalls: true })) scene.add(mesh);
  const sea = createSea(world);
  scene.add(sea.mesh);
  const props = createProps(world);
  scene.add(props.group);

  const heli = createHeliVisual();
  const storm = createStormVisual();
  const crash = createCrashVisual();
  const plane = createPlaneVisual();
  scene.add(heli.root, heli.shadow, storm.group, storm.rain, crash.group, plane.group);
  const pads = findHeliports(world, world.baseX, world.baseZ).list;
  const radar = createRadar(root, world, pads, debug);
  const minimap = createMinimap(root, world, pads);
  let zoom = 1;

  const grid = debugGrid();
  const circle = debugCircle();
  grid.visible = debug;
  circle.visible = debug;
  scene.add(grid, circle);

  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.05, 160);
  camera.rotation.order = "YXZ";
  const fit = () => frameOrtho(camera, root.clientWidth, root.clientHeight, zoom);
  fit();
  renderer.domElement.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      zoom = Math.min(CAMERA_ZOOM_MAX, Math.max(CAMERA_ZOOM_MIN, zoom * Math.exp(event.deltaY * 0.001)));
      fit();
    },
    { passive: false },
  );
  const windRing = debugRadius(CYCLONE_WIND, 0xd7e4ea);
  const dangerRing = debugRadius(CYCLONE_DANGER_RADIUS, 0xd24a3a);
  const innerRing = debugRadius(CYCLONE_INNER, 0x8c241c);
  const planePath = debugSegment();
  windRing.visible = debug;
  dangerRing.visible = debug;
  innerRing.visible = debug;
  planePath.visible = debug;
  scene.add(windRing, dangerRing, innerRing, planePath);
  const crateMark = new SphereGeometry(0.35, 6, 5);
  const crateMaterial = new MeshBasicMaterial({ color: 0xf0a020 });
  let crateMarks: Mesh[] = [];
  const mountCrateMarks = () => {
    for (const mesh of crateMarks) scene.remove(mesh);
    crateMarks = world.crates.map((crate) => {
      const mesh = new Mesh(crateMark, crateMaterial);
      mesh.position.set(crate.x + 0.5, heightAt(world, crate.x + 0.5, crate.z + 0.5) + 1.4, crate.z + 0.5);
      mesh.visible = debug;
      return mesh;
    });
    scene.add(...crateMarks);
  };
  mountCrateMarks();
  const freeCamera = new PerspectiveCamera(50, viewAspect(root), 0.1, 4000);
  const controls = new OrbitControls(freeCamera, renderer.domElement);
  controls.enabled = false;
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.49;
  let free = false;

  const look = new Vector3();
  let azimuth = 0;
  let introAzimuth = 0;
  let lookReady = false;
  const started = performance.now();
  let frames = 0;
  let fpsWindow = 0;
  let fps = 0;
  const shown: { current: HeliState | null } = { current: null };
  const hud = createHud(root, debug);
  const debugReadout = hud.readouts().debug;
  hud.readouts().freeButton?.addEventListener("click", () => {
    free = !free;
    controls.enabled = free;
    const button = hud.readouts().freeButton;
    if (button) button.textContent = free ? "Sledovat vrtulník" : "Volná kamera";
    if (free && shown.current) {
      freeCamera.position.copy(camera.position);
      controls.target.set(shown.current.x, shown.current.y, shown.current.z);
      controls.update();
    }
  });

  const scratch = new Vector3();
  const camRight = new Vector3();
  const camUp = new Vector3();

  const view: FlightView = {
    sim: null as unknown as HeliState,
    sync(frame, dt) {
      const state = frame.heli;
      shown.current = state;
      view.sim = state;
      const groundY = heightAt(world, state.x, state.z);
      const step = Math.max(0, dt);
      heli.update(state, frame.paused ? 0 : step, groundY);
      const shownHeli = state.mode !== "crash";
      heli.root.visible = shownHeli;
      heli.shadow.visible = shownHeli;
      props.sync(frame, (performance.now() - started) / 1000);
      placeSun(sun, state.x, state.z);
      sun.intensity = SUN_INTENSITY * (1 - frame.wind * 0.82);
      hemi.intensity = HEMI_INTENSITY * (1 - frame.wind * 0.65);
      (scene.background as Color).copy(calmSky).lerp(stormSky, frame.wind);
      const elapsed = (performance.now() - started) / 1000;
      storm.update(frame.storm.x, frame.storm.z, elapsed, frame.wind, state.x, state.z);
      crash.sync(state, world, frame.events, elapsed);
      plane.update(frame.plane);
      const intro = frame.phase === "intro";
      if (intro) {
        introAzimuth += step * 0.18;
        look.set(frame.homeX, state.y, frame.homeZ);
        lookReady = false;
      } else if (!lookReady) {
        look.set(state.x, state.y, state.z);
        azimuth = viewAzimuth(state.view);
        lookReady = true;
      }
      if (!intro && step > 0 && !frame.paused) {
        azimuth = approachAngle(azimuth, viewAzimuth(state.view), (Math.PI / CAMERA_SWITCH) * step);
        const blend = 1 - Math.exp(-CAMERA_LAG * step);
        look.x += (state.x - look.x) * blend;
        look.y += (state.y - look.y) * blend;
        look.z += (state.z - look.z) * blend;
      }
      if (!free) {
        const shot = intro ? introAzimuth : azimuth;
        const offset = cameraOffset(shot, CAMERA_DISTANCE);
        const rotation = isoEuler(shot);
        camera.rotation.set(rotation.x, rotation.y, rotation.z);
        camera.position.set(look.x + offset.x, look.y + offset.y, look.z + offset.z);
      } else {
        controls.update();
      }
      if (debug) {
        rebuildGrid(grid, world, state);
        placeCircle(circle, state);
      }
      sea.material.uniforms.uTime.value = elapsed;
      sea.material.uniforms.uHeli.value.set(state.x, state.z, state.y);
      const above = Math.max(0, state.y - groundY);
      hud.update(frame, above);
      radar.sync(frame);
      minimap.sync(frame);
      if (debug) {
        placeRadius(windRing, frame.storm.x, frame.storm.z, 2);
        placeRadius(dangerRing, frame.storm.x, frame.storm.z, 2.2);
        placeRadius(innerRing, frame.storm.x, frame.storm.z, 2.4);
        placePlanePath(planePath, frame);
        crateMarks.forEach((mesh, index) => {
          mesh.visible = !frame.collectedCrates[index];
        });
      }
      if (frame.plane?.warning) {
        camera.updateMatrixWorld();
        camRight.setFromMatrixColumn(camera.matrixWorld, 0);
        camUp.setFromMatrixColumn(camera.matrixWorld, 1);
        const dx = frame.plane.x - state.x;
        const dy = frame.plane.y - state.y;
        const dz = frame.plane.z - state.z;
        const sx = dx * camRight.x + dy * camRight.y + dz * camRight.z;
        const sy = dx * camUp.x + dy * camUp.y + dz * camUp.z;
        hud.setArrow(Math.atan2(sx, sy));
      } else {
        hud.setArrow(null);
      }
      if (debugReadout) {
        frames += 1;
        fpsWindow += dt;
        if (fpsWindow >= 0.5) {
          fps = frames / fpsWindow;
          frames = 0;
          fpsWindow = 0;
        }
        const cellX = Math.floor(state.x);
        const cellZ = Math.floor(state.z);
        debugReadout.textContent = [
          `${fps.toFixed(0)} FPS · ${frame.phase}${frame.paused ? " · pauza" : ""} · ${state.mode}`,
          `buňka ${cellX}, ${cellZ}`,
          `poloha ${state.x.toFixed(1)}, ${state.z.toFixed(1)}`,
          `výška ${state.y.toFixed(1)} · palivo ${frame.fuel.toFixed(0)}`,
        ].join("\n");
      }
      renderer.render(scene, free ? freeCamera : camera);
    },
    cameraPosition() {
      const active = free ? freeCamera : camera;
      return { x: active.position.x, y: active.position.y, z: active.position.z };
    },
    toggleMap() {
      radar.toggle();
    },
    showLayout(overlay) {
      props.relayout();
      mountCrateMarks();
      radar.setOverlay(overlay);
    },
    noseWorld() {
      heli.nose.getWorldPosition(scratch);
      return { x: scratch.x, y: scratch.y, z: scratch.z };
    },
    tailWorld() {
      heli.tail.getWorldPosition(scratch);
      return { x: scratch.x, y: scratch.y, z: scratch.z };
    },
  };

  window.addEventListener("resize", () => {
    fit();
    freeCamera.aspect = viewAspect(root);
    freeCamera.updateProjectionMatrix();
    renderer.setSize(root.clientWidth, root.clientHeight);
  });

  return view;
}

function frameOrtho(camera: OrthographicCamera, width: number, height: number, zoom: number): void {
  const aspect = width / Math.max(height, 1);
  const half = CAMERA_HALF * zoom;
  camera.top = half;
  camera.bottom = -half;
  camera.left = -half * aspect;
  camera.right = half * aspect;
  camera.updateProjectionMatrix();
}

function viewAspect(root: HTMLElement): number {
  return root.clientWidth / Math.max(root.clientHeight, 1);
}

function placeSun(sun: DirectionalLight, x: number, z: number): void {
  sun.position.set(x + SUN_DIR[0] * 40, SUN_DIR[1] * 40, z + SUN_DIR[2] * 40);
  sun.target.position.set(x, 0, z);
  sun.target.updateMatrixWorld();
  sun.shadow.camera.updateProjectionMatrix();
}

function debugGrid(): LineSegments {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(new Float32Array((11 * 12 * 2 + 11 * 12 * 2) * 3), 3));
  const lines = new LineSegments(geometry, new LineBasicMaterial({ color: 0xf4e2a8 }));
  lines.frustumCulled = false;
  lines.renderOrder = 3;
  return lines;
}

function rebuildGrid(lines: LineSegments, world: World, state: HeliState): void {
  const cx = Math.floor(state.x);
  const cz = Math.floor(state.z);
  const values: number[] = [];
  for (let dz = -5; dz <= 5; dz++) {
    for (let dx = -5; dx <= 5; dx++) {
      const x = cx + dx;
      const z = cz + dz;
      const y = heightAt(world, x + 0.5, z + 0.5) + 0.12;
      values.push(x, y, z, x + 1, y, z, x, y, z, x, y, z + 1);
    }
  }
  const attribute = lines.geometry.getAttribute("position") as Float32BufferAttribute;
  attribute.set(values);
  attribute.needsUpdate = true;
  lines.geometry.setDrawRange(0, values.length / 3);
  lines.geometry.computeBoundingSphere();
}

function debugRadius(radius: number, color: number): LineLoop {
  const segments = 64;
  const values = new Float32Array((segments + 1) * 3);
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    values[i * 3] = Math.cos(angle) * radius;
    values[i * 3 + 2] = Math.sin(angle) * radius;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(values, 3));
  const loop = new LineLoop(geometry, new LineBasicMaterial({ color }));
  loop.frustumCulled = false;
  return loop;
}

function placeRadius(loop: LineLoop, x: number, z: number, y: number): void {
  loop.position.set(x, y, z);
}

function debugSegment(): LineSegments {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(new Float32Array(6), 3));
  const line = new LineSegments(geometry, new LineBasicMaterial({ color: 0xf4e2a8 }));
  line.frustumCulled = false;
  return line;
}

function placePlanePath(line: LineSegments, frame: GameView): void {
  const plane = frame.plane;
  line.visible = Boolean(plane);
  if (!plane) return;
  const attribute = line.geometry.getAttribute("position") as Float32BufferAttribute;
  attribute.setXYZ(0, plane.x - plane.dirX * 30, plane.y, plane.z - plane.dirZ * 30);
  attribute.setXYZ(1, plane.x + plane.dirX * 40, plane.y, plane.z + plane.dirZ * 40);
  attribute.needsUpdate = true;
}

function debugCircle(): LineLoop {
  const segments = 40;
  const values = new Float32Array((segments + 1) * 3);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(values, 3));
  const loop = new LineLoop(geometry, new LineBasicMaterial({ color: 0xff4030 }));
  loop.frustumCulled = false;
  loop.renderOrder = 3;
  return loop;
}

function placeCircle(loop: LineLoop, state: HeliState): void {
  const attribute = loop.geometry.getAttribute("position") as Float32BufferAttribute;
  const segments = 40;
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    attribute.setXYZ(i, state.x + Math.cos(angle) * HELI_RADIUS, state.y + 0.2, state.z + Math.sin(angle) * HELI_RADIUS);
  }
  attribute.needsUpdate = true;
  loop.geometry.computeBoundingSphere();
}

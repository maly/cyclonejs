import { ClampToEdgeWrapping, DataTexture, LinearFilter, Mesh, NoColorSpace, PlaneGeometry, RedFormat, ShaderMaterial, UnsignedByteType, Vector2, Vector3 } from "three";
import type { World } from "../sim/world.ts";
import { SEA_DASH, SEA_DEEP, SEA_FOAM, SEA_SHALLOW } from "./style.ts";

const vertex = /* glsl */ `
  varying vec2 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const fragment = /* glsl */ `
  uniform float uTime;
  uniform vec3 uHeli;
  uniform vec2 uWorldSize;
  uniform sampler2D uCoast;
  uniform vec3 uShallow;
  uniform vec3 uDeep;
  uniform vec3 uFoam;
  uniform vec3 uDash;
  varying vec2 vWorld;

  float coastAt(vec2 world) {
    vec2 uv = world / uWorldSize;
    if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 64.0;
    return texture2D(uCoast, uv).r * (255.0 / 4.0);
  }

  float valueNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = fract(sin(dot(i, vec2(127.1, 311.7))) * 43758.5453);
    float b = fract(sin(dot(i + vec2(1.0, 0.0), vec2(127.1, 311.7))) * 43758.5453);
    float c = fract(sin(dot(i + vec2(0.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
    float d = fract(sin(dot(i + vec2(1.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  void main() {
    float raw = coastAt(vWorld);
    float dx = coastAt(vWorld + vec2(1.0, 0.0)) - coastAt(vWorld - vec2(1.0, 0.0));
    float dz = coastAt(vWorld + vec2(0.0, 1.0)) - coastAt(vWorld - vec2(0.0, 1.0));
    vec2 grad = vec2(dx, dz);
    float glen = length(grad);
    vec2 shore = glen > 0.001 ? grad / glen : vec2(0.0, 1.0);
    vec2 tangent = vec2(-shore.y, shore.x);
    float along = dot(vWorld, tangent);

    float swash = sin(along * 0.55 - uTime * 1.15) * 0.5 + sin(along * 1.3 + uTime * 0.75) * 0.22;
    float dist = raw + swash * smoothstep(7.0, 0.0, raw);
    float depth = smoothstep(0.25, 14.0, dist);
    vec3 color = mix(uShallow, uDeep, depth);

    vec2 drift = vec2(0.32, 0.18) * uTime;
    vec2 flow = vWorld - drift;
    float body = valueNoise(flow * 0.42) * 0.65 + valueNoise(flow * 1.15 + 4.2) * 0.35;
    color *= 0.86 + 0.22 * body;
    float blot = smoothstep(0.64, 0.84, valueNoise(flow * 1.35 + vec2(2.0, 7.0)));
    float chip = smoothstep(0.72, 0.9, valueNoise((vWorld - drift * 1.6) * 2.8));
    color = mix(color, mix(uShallow, uFoam, 0.65), blot * 0.55 + chip * 0.4);

    float lap = valueNoise(vec2(along * 0.35 - uTime * 0.55, dot(vWorld, shore) * 1.4 + uTime * 0.35));
    float shallows = smoothstep(5.5, 0.25, raw);
    color += vec3(0.05, 0.07, 0.05) * (lap - 0.5) * shallows;
    color = mix(color, uShallow, shallows * (0.18 + 0.22 * lap));

    float wobble = sin(along * 0.48 + uTime * 0.95) * 0.38 + sin(along * 1.45 - uTime * 0.6) * 0.16;
    float foamLine = 1.0 - smoothstep(0.04, 0.42, abs(dist - 0.65 - wobble));
    foamLine *= 1.0 - smoothstep(1.6, 2.8, raw);
    float fleck = smoothstep(0.68, 0.9, valueNoise(vec2(along * 1.6 - uTime * 0.85, raw * 4.0)));
    color = mix(color, uFoam, clamp(foamLine * (0.55 + fleck * 0.45), 0.0, 1.0));

    float heliDist = distance(vWorld, uHeli.xy);
    float overWater = smoothstep(1.4, 2.4, coastAt(uHeli.xy));
    float low = 1.0 - smoothstep(1.2, 7.5, uHeli.z);
    float near = 1.0 - smoothstep(1.0, 6.5, heliDist);
    float rings = sin(heliDist * 4.2 - uTime * 4.2);
    float wash = rings * near * low * overWater;
    color += vec3(0.55, 0.78, 0.8) * max(wash, 0.0) * 0.28;

    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function coastBytes(world: World): Uint8Array {
  const distances = coastDistances(world);
  const bytes = new Uint8Array(distances.length);
  for (let index = 0; index < distances.length; index++) {
    const distance = distances[index];
    bytes[index] = distance >= 63.75 ? 255 : Math.min(255, Math.round(distance * 4));
  }
  return bytes;
}

export function createSea(world: World): { mesh: Mesh; material: ShaderMaterial } {
  const width = world.width + 8000;
  const depth = world.depth + 8000;
  const texture = new DataTexture(coastBytes(world), world.width, world.depth, RedFormat, UnsignedByteType);
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.flipY = false;
  texture.colorSpace = NoColorSpace;
  texture.needsUpdate = true;
  const material = new ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uHeli: { value: new Vector3(0, 0, 40) },
      uWorldSize: { value: new Vector2(world.width, world.depth) },
      uCoast: { value: texture },
      uShallow: { value: rgb(SEA_SHALLOW) },
      uDeep: { value: rgb(SEA_DEEP) },
      uFoam: { value: rgb(SEA_FOAM) },
      uDash: { value: rgb(SEA_DASH) },
    },
    vertexShader: vertex,
    fragmentShader: fragment,
  });
  const mesh = new Mesh(new PlaneGeometry(width, depth), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(world.width / 2, -0.03, world.depth / 2);
  mesh.receiveShadow = true;
  mesh.name = "sea";
  return { mesh, material };
}

function rgb(color: readonly [number, number, number]): { x: number; y: number; z: number } {
  return { x: color[0], y: color[1], z: color[2] };
}

function coastDistances(world: World): Float32Array {
  const { width, depth, surface } = world;
  const distance = new Float32Array(width * depth);
  distance.fill(255);
  const queue = new Int32Array(width * depth);
  let head = 0;
  let tail = 0;
  for (let index = 0; index < surface.length; index++) {
    if (surface[index] === 0) continue;
    distance[index] = 0;
    queue[tail++] = index;
  }
  while (head < tail) {
    const index = queue[head++];
    const here = distance[index];
    if (here >= 48) continue;
    const x = index % width;
    const next = [index - 1, index + 1, index - width, index + width];
    if (x === 0) next[0] = -1;
    if (x === width - 1) next[1] = -1;
    for (const neighbor of next) {
      if (neighbor < 0 || neighbor >= distance.length) continue;
      if (distance[neighbor] <= here + 1) continue;
      distance[neighbor] = here + 1;
      queue[tail++] = neighbor;
    }
  }
  return distance;
}

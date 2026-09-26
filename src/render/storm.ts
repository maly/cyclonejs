import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LineSegments,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
} from "three";

export interface StormVisual {
  group: Group;
  rain: LineSegments;
  update(x: number, z: number, time: number, wind: number, heliX: number, heliZ: number): void;
}

const RAIN_MAX = 420;

/** Spirálová oblačnost kolem oka a šikmý déšť, jehož hustota roste s větrem. */
export function createStormVisual(): StormVisual {
  const group = new Group();
  group.name = "cyclone";
  const cloud = cloudDisc(56, 7);
  const upper = cloudDisc(34, 12);
  group.add(cloud, upper);

  const rainGeometry = new BufferGeometry();
  const rainPositions = new Float32Array(RAIN_MAX * 2 * 3);
  for (let i = 0; i < RAIN_MAX; i++) {
    const angle = (i * 2.399) % (Math.PI * 2);
    const radius = 1.5 + (i % 17) * 0.7;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const y = (i * 1.7) % 14;
    const slant = 0.85 + (i % 5) * 0.08;
    rainPositions[i * 6] = x;
    rainPositions[i * 6 + 1] = y;
    rainPositions[i * 6 + 2] = z;
    rainPositions[i * 6 + 3] = x + slant;
    rainPositions[i * 6 + 4] = y - 1.35;
    rainPositions[i * 6 + 5] = z + slant * 0.25;
  }
  rainGeometry.setAttribute("position", new Float32BufferAttribute(rainPositions, 3));
  const rain = new LineSegments(
    rainGeometry,
    new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      vertexShader: `
        void main() {
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        void main() {
          gl_FragColor = vec4(0.78, 0.86, 0.9, 0.72);
        }
      `,
    }),
  );
  rain.frustumCulled = false;
  rain.visible = false;
  const bases = Float32Array.from(rainPositions);

  return {
    group,
    rain,
    update(x, z, time, wind, heliX, heliZ) {
      group.position.set(x, 0, z);
      const uniforms = (cloud.material as ShaderMaterial).uniforms;
      uniforms.uTime.value = time;
      (upper.material as ShaderMaterial).uniforms.uTime.value = time * 1.15;
      const strength = Math.max(0, Math.min(1, wind));
      uniforms.uDensity.value = 0.35 + strength * 0.65;
      (upper.material as ShaderMaterial).uniforms.uDensity.value = 0.2 + strength * 0.5;
      const lines = Math.round(strength * RAIN_MAX);
      rain.visible = lines > 8;
      rainGeometry.setDrawRange(0, lines * 2);
      rain.position.set(heliX, 0, heliZ);
      const drop = (time * (8 + strength * 18)) % 14;
      const attribute = rainGeometry.getAttribute("position") as Float32BufferAttribute;
      for (let i = 0; i < RAIN_MAX; i++) {
        const y = (bases[i * 6 + 1] - drop + 14) % 14;
        attribute.setY(i * 2, y);
        attribute.setY(i * 2 + 1, y - 1.35);
      }
      attribute.needsUpdate = true;
    },
  };
}

function cloudDisc(radius: number, altitude: number): Mesh {
  const material = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    side: DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uDensity: { value: 0.8 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform float uDensity;
      varying vec2 vUv;
      void main() {
        vec2 p = vUv * 2.0 - 1.0;
        float r = length(p);
        if (r > 1.0) discard;
        float ang = atan(p.y, p.x);
        float arm = sin(ang * 3.0 - r * 16.0 + uTime * 0.9);
        float band = smoothstep(0.05, 0.72, arm);
        float core = smoothstep(0.55, 0.0, r);
        float veil = band * (1.0 - smoothstep(0.25, 1.0, r)) + core * 0.85;
        veil *= uDensity;
        vec3 pale = vec3(0.78, 0.81, 0.84);
        vec3 ink = vec3(0.12, 0.15, 0.18);
        vec3 color = mix(pale, ink, smoothstep(0.85, 0.05, r));
        gl_FragColor = vec4(color, clamp(veil, 0.0, 0.82));
      }
    `,
  });
  const mesh = new Mesh(new PlaneGeometry(radius * 2, radius * 2), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = altitude;
  mesh.renderOrder = 3;
  return mesh;
}

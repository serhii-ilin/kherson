import * as THREE from 'three';

export interface SkyOptions {
  sunDir: THREE.Vector3;      // normalised, points FROM the scene TOWARD the sun
  zenith?: THREE.Color;       // default 0x3f7fd0
  horizon?: THREE.Color;      // default 0xc9dff0
  ground?: THREE.Color;       // colour below the horizon, default 0x9fb3c4
  radius?: number;            // default 10000
}

/** The part of a Daylight (src/world/daylight.ts) the dome needs. */
export interface SkyState {
  zenith: readonly number[];
  horizon: readonly number[];
  ground: readonly number[];
  sunDir: readonly number[];
  moonDir: readonly number[];
  lightColor: readonly number[];
  night: number;
  dusk: number;
}

export interface Sky {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  /** keep the dome centred on the camera; call once per frame */
  update(cameraPosition: THREE.Vector3): void;
  /** apply a time-of-day palette (uniform writes only, no allocation) */
  setDaylight(d: SkyState): void;
  /** the colour the fog should use so distant terrain melts into the horizon */
  horizonColor: THREE.Color;
}

const DEFAULT_ZENITH = 0x3f7fd0;
const DEFAULT_HORIZON = 0xc9dff0;
const DEFAULT_GROUND = 0x9fb3c4;
const DEFAULT_RADIUS = 10000;

const VERTEX = /* glsl */ `
varying vec3 vDir;

void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform vec3 uSunColor;
uniform float uNight;
uniform float uDusk;
varying vec3 vDir;

float skyHash(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

void main() {
  vec3 d = normalize(vDir);

  vec3 col = mix(uHorizon, uZenith, pow(max(d.y, 0.0), 0.5));
  float below = clamp(-d.y / 0.15, 0.0, 1.0);
  col = mix(col, uGround, below);

  float haze = 1.0 - smoothstep(0.0, 0.08, abs(d.y));
  col *= 1.0 + 0.05 * haze;

  vec3 sd = normalize(uSunDir);
  float s = max(dot(d, sd), 0.0);
  // the sun only shows above the horizon
  float sunUp = smoothstep(-0.03, 0.02, sd.y);
  col += sunUp * smoothstep(0.9995, 0.9998, s) * vec3(1.0, 0.95, 0.85) * 2.0;
  col += sunUp * (pow(s, 64.0) * 0.35 + pow(s, 8.0) * 0.12) * uSunColor * vec3(1.0, 0.9, 0.7);
  // golden / blue hour: a warm band of light on the horizon towards the sun
  vec2 hs = normalize(sd.xz + 1e-4);
  float az = pow(max(dot(normalize(d.xz + 1e-4), hs), 0.0), 3.0);
  float band = exp(-abs(d.y) * 7.0);
  col += uDusk * az * band * uSunColor * 0.22;

  if (uNight > 0.001) {
    // stars: jittered points in a 3D cell grid, fading towards the horizon and with daylight
    vec3 q = d * 110.0;
    vec3 id = floor(q);
    float h = skyHash(id);
    vec3 jit = vec3(skyHash(id + 7.1), skyHash(id + 13.7), skyHash(id + 29.3)) * 0.5 + 0.25;
    float dist = length(fract(q) - jit);
    float star = step(0.965, h) * (1.0 - smoothstep(0.08, 0.24, dist)) * (0.35 + 0.65 * skyHash(id + 3.3));
    float tint = skyHash(id + 51.0);
    vec3 starCol = mix(vec3(0.75, 0.85, 1.0), vec3(1.0, 0.9, 0.75), tint);
    col += starCol * star * 1.6 * uNight * smoothstep(0.02, 0.2, d.y);
    // pale moon disc with a soft halo
    float m = max(dot(d, normalize(uMoonDir)), 0.0);
    col += uNight * (smoothstep(0.9993, 0.9996, m) * vec3(0.92, 0.95, 1.0) * 1.7 + pow(m, 220.0) * 0.18 * vec3(0.7, 0.8, 1.0) + pow(m, 24.0) * 0.04 * vec3(0.6, 0.7, 1.0));
  }

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function createSky(opts: SkyOptions): Sky {
  const radius = opts.radius ?? DEFAULT_RADIUS;
  const zenith = opts.zenith ?? new THREE.Color(DEFAULT_ZENITH);
  const horizon = opts.horizon ?? new THREE.Color(DEFAULT_HORIZON);
  const ground = opts.ground ?? new THREE.Color(DEFAULT_GROUND);

  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: true,
    fog: false,
    uniforms: {
      uZenith: { value: zenith.clone() },
      uHorizon: { value: horizon.clone() },
      uGround: { value: ground.clone() },
      uSunDir: { value: opts.sunDir.clone().normalize() },
      uMoonDir: { value: new THREE.Vector3(0.5, 0.65, 0.55).normalize() },
      uSunColor: { value: new THREE.Color(1, 0.94, 0.82) },
      uNight: { value: 0 },
      uDusk: { value: 0 },
    },
  });

  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 16), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;

  return {
    mesh,
    material,
    update(cameraPosition: THREE.Vector3): void {
      mesh.position.copy(cameraPosition);
    },
    setDaylight(d: SkyState): void {
      const u = material.uniforms;
      (u.uZenith!.value as THREE.Color).setRGB(d.zenith[0]!, d.zenith[1]!, d.zenith[2]!, THREE.SRGBColorSpace);
      (u.uHorizon!.value as THREE.Color).setRGB(d.horizon[0]!, d.horizon[1]!, d.horizon[2]!, THREE.SRGBColorSpace);
      (u.uGround!.value as THREE.Color).setRGB(d.ground[0]!, d.ground[1]!, d.ground[2]!, THREE.SRGBColorSpace);
      (u.uSunColor!.value as THREE.Color).setRGB(d.lightColor[0]!, d.lightColor[1]!, d.lightColor[2]!, THREE.SRGBColorSpace);
      (u.uSunDir!.value as THREE.Vector3).set(d.sunDir[0]!, d.sunDir[1]!, d.sunDir[2]!);
      (u.uMoonDir!.value as THREE.Vector3).set(d.moonDir[0]!, d.moonDir[1]!, d.moonDir[2]!);
      u.uNight!.value = d.night;
      u.uDusk!.value = d.dusk;
    },
    horizonColor: horizon.clone(),
  };
}

import * as THREE from 'three';

/** Wave directions (xz): downstream (towards SW, +z is south) with a +-40 degree spread. */
const BASE_ANGLE = Math.atan2(0.7, -0.7);
const WAVES = [
  { len: 9, amp: 0.05, spread: 40 },
  { len: 14, amp: 0.07, spread: -15 },
  { len: 23, amp: 0.1, spread: 14 },
  { len: 37, amp: 0.13, spread: -40 },
];
const STEEPNESS = 0.35;

function waveGlsl(): string {
  let src = '';
  for (const w of WAVES) {
    const a = BASE_ANGLE + (w.spread * Math.PI) / 180;
    const k = (2 * Math.PI) / w.len;
    const omega = Math.sqrt(9.81 * k);
    const f = (n: number): string => n.toFixed(5);
    src += `  wave(p, vec2(${f(Math.cos(a))}, ${f(Math.sin(a))}), ${f(k)}, ${f(omega)}, ${f(w.amp)}, dy, dxz);\n`;
  }
  return src;
}

const VERTEX = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
#include <fog_pars_vertex>
attribute float shore;
uniform float uTime;
varying vec3 vWorldPos;
varying float vShore;

void wave(vec2 p, vec2 d, float k, float omega, float amp, inout float dy, inout vec2 dxz) {
  float ph = k * dot(d, p) - omega * uTime;
  dy += amp * sin(ph);
  dxz += d * (${STEEPNESS.toFixed(2)} * amp * cos(ph));
}

void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec2 p = wp.xz;
  float dy = 0.0;
  vec2 dxz = vec2(0.0);
${waveGlsl()}
  float calm = smoothstep(0.0, 0.6, shore);
  wp.y += dy * calm;
  wp.xz += dxz * calm;
  vWorldPos = wp.xyz;
  vShore = shore;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <logdepthbuf_vertex>
  #include <fog_vertex>
}
`;

const FRAGMENT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
#include <fog_pars_fragment>
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSky;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uFoam;
uniform vec3 uCamPos;
uniform vec3 uHole;
varying vec3 vWorldPos;
varying float vShore;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}

void main() {
  #include <logdepthbuf_fragment>
  vec2 hd = vWorldPos.xz - uHole.xy;
  if (dot(hd, hd) < uHole.z) discard;

  vec3 n = normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos)));
  if (n.y < 0.0) n = -n;
  vec2 q = vWorldPos.xz * 0.5;
  vec2 rip = vec2(
    vnoise(q + vec2(uTime * 0.35, uTime * 0.2)) + vnoise(q * 2.3 - vec2(uTime * 0.5, 0.0)) - 1.0,
    vnoise(q + vec2(17.0, 5.0) - vec2(uTime * 0.2, uTime * 0.4)) + vnoise(q * 2.3 + vec2(0.0, uTime * 0.45)) - 1.0);
  n = normalize(n + vec3(rip.x, 0.0, rip.y) * 0.12);

  vec3 L = normalize(uSunDir);
  vec3 V = normalize(uCamPos - vWorldPos);
  vec3 base = mix(uShallow, uDeep, smoothstep(0.0, 1.0, vShore));
  float diff = max(dot(n, L), 0.0);
  vec3 lit = base * (uSky * 0.55 + vec3(1.0, 0.94, 0.82) * diff * 0.75);

  float cosv = max(dot(n, V), 0.0);
  float fres = 0.02 + 0.98 * pow(1.0 - cosv, 5.0);
  vec3 col = mix(lit, uSky, fres);

  vec3 H = normalize(L + V);
  float spec = pow(max(dot(n, H), 0.0), 120.0) * 2.0;
  col += vec3(1.0, 0.95, 0.85) * spec;

  float edge = 1.0 - smoothstep(0.0, 0.25, vShore);
  float fn = vnoise(vWorldPos.xz * 1.1 + vec2(uTime * 0.3, -uTime * 0.2)) * 0.6
           + vnoise(vWorldPos.xz * 3.1 - vec2(uTime * 0.4, uTime * 0.1)) * 0.4;
  float foam = edge * smoothstep(0.38, 0.55, fn + edge * 0.25);
  col = mix(col, uFoam, foam);

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

export function createWaterMaterial(opts: {
  skyColor: THREE.Color;
  sunDir: THREE.Vector3;
  fog: boolean;
}): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    fog: opts.fog,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uSunDir: { value: opts.sunDir.clone().normalize() },
        uSky: { value: opts.skyColor.clone() },
        uDeep: { value: new THREE.Color('#1f4f74') },
        uShallow: { value: new THREE.Color('#3f86a6') },
        uFoam: { value: new THREE.Color('#e8f2f5') },
        uCamPos: { value: new THREE.Vector3() },
        /** x, z, radius squared: fragments inside are discarded. z = 0 disables the cut. */
        uHole: { value: new THREE.Vector3(0, 0, 0) },
      },
    ]),
  });
}

/**
 * Variant for the far overview terrain: shares all uniforms with `base` (so updateWater drives both)
 * except uHole, which the overview animates to cut the circle covered by detailed chunks.
 */
export function createOverviewWaterMaterial(base: THREE.ShaderMaterial): THREE.ShaderMaterial {
  const m = new THREE.ShaderMaterial({
    vertexShader: base.vertexShader,
    fragmentShader: base.fragmentShader,
    fog: base.fog,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  m.uniforms = { ...base.uniforms, uHole: { value: new THREE.Vector3(0, 0, 0) } };
  return m;
}

export function updateWater(mat: THREE.ShaderMaterial, timeSeconds: number, cameraPos: THREE.Vector3): void {
  mat.uniforms.uTime!.value = timeSeconds;
  (mat.uniforms.uCamPos!.value as THREE.Vector3).copy(cameraPos);
}

import { PBR_LAYER_COUNT } from './pbr-layers.ts';

/**
 * Shader helpers for the shared PBR material library (docs/adr/0002-realistic-buildings.md). Inject
 * `PBR_PARS` into a fragment shader with `onBeforeCompile` and sample it with metre UVs and the camera
 * distance; nothing here is tied to a particular material, so building, roof and ground shaders can share it.
 *
 * Fragment shader only: `pbrSample` uses `dFdx`/`dFdy` for mip-correct `textureGrad` taps.
 *
 * The albedo array is normalised so a texel of sRGB 128 means "unchanged": `detail = a.rgb * 2.0`
 * multiplies the vertex/tint colour. Ambient occlusion is already baked into the albedo; the normal array's
 * blue channel carries roughness and its xy channel carries the OpenGL tangent-space normal, from which z is
 * reconstructed. Anti-tiling follows Inigo Quilez's texture-repetition technique 3: a continuous 1D noise
 * field chooses and blends between two offset, quarter-turned versions of each tile.
 */

/** Names of the functions declared in `PBR_PARS`, in declaration order (checked by the tests). */
export const PBR_GLSL_FUNCS: readonly string[] = [
  'pbrSample',
  'pbrPerturb',
  'pbrWallBasis',
  'pbrGroundBasis',
];

export const PBR_PARS = /* glsl */ `
precision highp sampler2DArray;

uniform sampler2DArray uPbrA;
uniform sampler2DArray uPbrN;
uniform float uPbrTile[${PBR_LAYER_COUNT}];

struct PbrSample {
  vec3 detail;
  float rough;
  vec3 nTS;
  float ao;
};

vec2 pbrHash2(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453123);
}

vec2 pbrHash(float p) {
  return pbrHash2(vec2(p, p * 1.61803398875 + 3.7));
}

float pbrValueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = pbrHash2(i).x;
  float b = pbrHash2(i + vec2(1.0, 0.0)).x;
  float c = pbrHash2(i + vec2(0.0, 1.0)).x;
  float d = pbrHash2(i + vec2(1.0, 1.0)).x;
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

vec2 pbrRotate(vec2 v, float quarterTurns) {
  float a = quarterTurns * 1.5707963267948966;
  float c = cos(a);
  float s = sin(a);
  return vec2(c * v.x - s * v.y, s * v.x + c * v.y);
}

float pbrTurns(vec2 h) {
  return floor(h.x * 4.0);
}

vec2 pbrVariantUv(vec2 uv, vec2 h) {
  vec2 tile = floor(uv);
  vec2 local = fract(uv) - vec2(0.5);
  vec2 rotated = pbrRotate(local, pbrTurns(h)) + vec2(0.5);
  return tile + rotated + h * 7.0;
}

vec4 pbrTapA(vec2 uv, float layer, vec2 h, vec2 ddx, vec2 ddy) {
  return textureGrad(uPbrA, vec3(pbrVariantUv(uv, h), layer), ddx, ddy);
}

vec4 pbrTapN(vec2 uv, float layer, vec2 h, vec2 ddx, vec2 ddy) {
  return textureGrad(uPbrN, vec3(pbrVariantUv(uv, h), layer), ddx, ddy);
}

PbrSample pbrSample(float layer, vec2 uvM, float dist) {
  PbrSample s;
  s.detail = vec3(1.0);
  s.rough = 0.9;
  s.nTS = vec3(0.0, 0.0, 1.0);
  s.ao = 1.0;

  int layerIndex = clamp(int(layer), 0, ${PBR_LAYER_COUNT - 1});
  vec2 uv = uvM / uPbrTile[layerIndex];
  vec2 ddx = dFdx(uv);
  vec2 ddy = dFdy(uv);
  if (layer < 0.0) {
    return s;
  }

  float k = pbrValueNoise(uv * 0.25) * 8.0;
  float i = floor(k);
  float f = fract(k);
  vec2 hA = pbrHash(i);
  vec2 hB = pbrHash(i + 1.0);

  vec4 aA = pbrTapA(uv, layer, hA, ddx, ddy);
  vec4 nA = pbrTapN(uv, layer, hA, ddx, ddy);
  vec4 aB = pbrTapA(uv, layer, hB, ddx, ddy);
  vec4 nB = pbrTapN(uv, layer, hB, ddx, ddy);

  vec2 nxyA = pbrRotate(nA.rg * 2.0 - 1.0, -pbrTurns(hA));
  vec2 nxyB = pbrRotate(nB.rg * 2.0 - 1.0, -pbrTurns(hB));
  float w = smoothstep(0.2, 0.8, f - 0.1 * dot(aA.rgb - aB.rgb, vec3(1.0)));

  vec4 albedo = mix(aA, aB, w);
  float rough = mix(nA.b, nB.b, w);
  vec2 nxy = mix(nxyA, nxyB, w);
  float nz = sqrt(max(0.0, 1.0 - dot(nxy, nxy)));
  float keep = 1.0 - smoothstep(250.0, 400.0, dist);

  s.detail = mix(vec3(1.0), albedo.rgb * 2.0, keep);
  s.rough = mix(0.9, rough, keep);
  s.nTS = mix(vec3(0.0, 0.0, 1.0), vec3(nxy, nz), keep);
  s.ao = 1.0;
  return s;
}

vec3 pbrPerturb(vec3 n, vec3 t, vec3 b, vec3 nTS) {
  return normalize(t * nTS.x + b * nTS.y + n * nTS.z);
}

void pbrWallBasis(vec3 n, out vec3 t, out vec3 b) {
  b = vec3(0.0, 1.0, 0.0);
  t = cross(b, n);
  float len = length(t);
  t = len > 0.0001 ? t / len : vec3(1.0, 0.0, 0.0);
}

void pbrGroundBasis(vec3 n, out vec3 t, out vec3 b) {
  t = vec3(1.0, 0.0, 0.0);
  b = vec3(0.0, 0.0, -1.0);
}
`;

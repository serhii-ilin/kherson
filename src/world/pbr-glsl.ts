import { PBR_LAYER_COUNT } from './pbr-layers.ts';

/**
 * Shader helpers for the shared PBR material library (docs/adr/0002-realistic-buildings.md). Inject
 * `PBR_PARS` into a program with `onBeforeCompile` and sample it with metre UVs and the camera distance;
 * nothing here is tied to a particular material, so building, roof and ground shaders can share it.
 *
 * The albedo array is normalised so a texel of sRGB 128 means "unchanged": `detail = ar.rgb * 2.0`
 * multiplies the vertex/tint colour. Anti-tiling splits the metre UV into cells of four tiles and blends
 * two rotated, offset versions of each cell with value-noise so repetition read less.
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

uniform sampler2DArray uPbrAR;
uniform sampler2DArray uPbrNA;
uniform float uPbrTile[${PBR_LAYER_COUNT}];

struct PbrSample {
  vec3 detail;
  float rough;
  vec3 nTS;
  float ao;
};

vec2 pbrHash(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453123);
}

float pbrValueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = pbrHash(i).x;
  float b = pbrHash(i + vec2(1.0, 0.0)).x;
  float c = pbrHash(i + vec2(0.0, 1.0)).x;
  float d = pbrHash(i + vec2(1.0, 1.0)).x;
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

vec2 pbrRotate(vec2 v, float quarterTurns) {
  float a = quarterTurns * 1.5707963267948966;
  float c = cos(a);
  float s = sin(a);
  return vec2(c * v.x - s * v.y, s * v.x + c * v.y);
}

float pbrCellTurns(vec2 cell) {
  return floor(pbrHash(cell + vec2(11.0, 37.0)).x * 4.0);
}

vec2 pbrCellUv(vec2 uv, vec2 cell) {
  vec2 h = pbrHash(cell);
  vec2 local = uv - cell * 4.0;
  vec2 rotated = pbrRotate(local - vec2(2.0), pbrCellTurns(cell)) + vec2(2.0);
  return cell * 4.0 + rotated + h * 4.0;
}

vec4 pbrTapAR(vec2 uv, float layer, vec2 cell, vec2 ddx, vec2 ddy) {
  return textureGrad(uPbrAR, vec3(pbrCellUv(uv, cell), layer), ddx, ddy);
}

vec4 pbrTapNA(vec2 uv, float layer, vec2 cell, vec2 ddx, vec2 ddy) {
  return textureGrad(uPbrNA, vec3(pbrCellUv(uv, cell), layer), ddx, ddy);
}

PbrSample pbrSample(float layer, vec2 uvM, float dist) {
  PbrSample s;
  s.detail = vec3(1.0);
  s.rough = 0.9;
  s.nTS = vec3(0.0, 0.0, 1.0);
  s.ao = 1.0;
  if (layer < 0.0) {
    return s;
  }
  vec2 uv = uvM / uPbrTile[int(layer)];
  vec2 ddx = dFdx(uv);
  vec2 ddy = dFdy(uv);
  vec2 cell = floor(uv * 0.25);
  vec2 h = pbrHash(cell);
  vec2 neighbour = cell + (h.y < 0.5 ? vec2(1.0, 0.0) : vec2(0.0, 1.0));
  vec4 arA = pbrTapAR(uv, layer, cell, ddx, ddy);
  vec4 naA = pbrTapNA(uv, layer, cell, ddx, ddy);
  vec4 arB = pbrTapAR(uv, layer, neighbour, ddx, ddy);
  vec4 naB = pbrTapNA(uv, layer, neighbour, ddx, ddy);
  float w = pbrValueNoise(uv * 0.25);
  vec4 ar = mix(arA, arB, w);
  float ao = mix(naA.a, naB.a, w);
  float nz = mix(naA.b, naB.b, w);
  vec2 nA = pbrRotate(naA.rg * 2.0 - 1.0, -pbrCellTurns(cell));
  vec2 nB = pbrRotate(naB.rg * 2.0 - 1.0, -pbrCellTurns(neighbour));
  vec2 nxy = mix(nA, nB, w);
  float keep = 1.0 - smoothstep(250.0, 400.0, dist);
  s.detail = mix(vec3(1.0), ar.rgb * 2.0, keep);
  s.rough = mix(0.9, ar.a, keep);
  s.nTS = mix(vec3(0.0, 0.0, 1.0), vec3(nxy, nz), keep);
  s.ao = mix(1.0, ao, keep);
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

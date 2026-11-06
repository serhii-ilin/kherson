/**
 * Tiling facade / roof material for extruded buildings. One MeshStandardMaterial, shared by every
 * chunk: albedo, roughness and a little metalness come from the vertex colour plus a procedural
 * window grid (storeys and bay carried on `aFacade`). When the runtime PBR library is passed, the
 * same material also samples its wall / roof layer from `aPbr`, keeps the procedural windows and
 * fallback seams, and lights real window geometry with the painted-window hash.
 */
import * as THREE from 'three';
import { NIGHT_UNIFORM } from '../world/facade-shader.ts';
import { PBR_PARS } from '../world/pbr-glsl.ts';
import { PBR_LAYER } from '../world/pbr-layers.ts';
import type { PbrUniforms } from '../world/pbr-library.ts';

const VERT = /* glsl */`
attribute vec2 aUvM;
attribute vec4 aFacade;
attribute float aStyle;
attribute float aPbr;
varying vec2 vUvM;
varying vec4 vFacade;
varying float vStyle;
flat varying float vPbr;
`;

/** World-space varyings exist only when the PBR library is present. */
const VERT_PBR = /* glsl */`
varying vec3 vPbrWorld;
varying vec3 vPbrNormal;
`;

const VERT_BODY = /* glsl */`
vUvM = aUvM;
vFacade = aFacade;
vStyle = aStyle;
vPbr = aPbr;
`;

const VERT_BODY_PBR = /* glsl */`
vPbrWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
vPbrNormal = normalize(mat3(modelMatrix) * objectNormal);
#ifdef USE_BATCHING
vPbrWorld = (modelMatrix * batchingMatrix * vec4(transformed, 1.0)).xyz;
vPbrNormal = normalize(mat3(modelMatrix) * mat3(batchingMatrix) * objectNormal);
#endif
`;

const FRAG_HEAD = /* glsl */`
varying vec2 vUvM;
varying vec4 vFacade;
varying float vStyle;
flat varying float vPbr;
uniform float uPbrOn;
uniform float uNight;
vec3 gGlow = vec3(0.0);
float gHash(vec2 p) {
  p = fract(p * vec2(0.1031, 0.1030));
  p += dot(p, p.yx + 33.33);
  return fract((p.x + p.y) * p.x);
}
float aaBox(float v, float lo, float hi, float w) {
  return clamp((v - lo) / w + 0.5, 0.0, 1.0) * clamp((hi - v) / w + 0.5, 0.0, 1.0);
}
float aaLine(float v, float period, float lw, float w) {
  float f = fract(v / period) * period;
  float d = min(f, period - f);
  return 1.0 - clamp((d - lw * 0.5) / max(w, 1e-4) + 0.5, 0.0, 1.0);
}
`;

/** World-space varyings exist only when the PBR library is present. */
const FRAG_PBR_VARYINGS = /* glsl */`
varying vec3 vPbrWorld;
varying vec3 vPbrNormal;
`;

/**
 * Layers whose texture already carries the material colour. The shader keeps only the luminance of
 * the baked base colour for those, so brick is not tinted red twice.
 */
const PBR_CARRY_LAYERS: ReadonlyArray<readonly [string, number]> = [
  ['BRICK_RED', PBR_LAYER.BRICK_RED],
  ['GRANITE', PBR_LAYER.GRANITE],
  ['ROOF_CLAY_TILE', PBR_LAYER.ROOF_CLAY_TILE],
  ['PAVERS_BEHATON', PBR_LAYER.PAVERS_BEHATON],
  ['SETT_GRANITE', PBR_LAYER.SETT_GRANITE],
  ['GRAVEL', PBR_LAYER.GRAVEL],
];

const PBR_CARRY_GLSL = /* glsl */`
bool pbrCarriesColour(float layer) {
  return ${PBR_CARRY_LAYERS.map(([name, id]) =>
    `(layer > ${id - 0.5} && layer < ${id + 0.5}) /* ${name} */`).join('\n    || ')};
}
`;

/** Shared per-pixel PBR state. The sample is taken once and reused by colour, roughness and normals. */
const FRAG_PBR_STATE = /* glsl */`
float gPbrLayer = -1.0;
vec3 gPbrDetail = vec3(1.0);
float gPbrRough = 0.9;
vec3 gPbrNTS = vec3(0.0, 0.0, 1.0);
`;

const FRAG_PBR_SAMPLE = /* glsl */`
float gPbrLayer = uPbrOn > 0.5 ? vPbr : -1.0;
vec3 gPbrDetail = vec3(1.0);
float gPbrRough = 0.9;
vec3 gPbrNTS = vec3(0.0, 0.0, 1.0);
if (gPbrLayer > -0.5) {
  PbrSample pbr = pbrSample(gPbrLayer, vUvM, length(vPbrWorld - cameraPosition));
  gPbrDetail = pbr.detail;
  gPbrRough = pbr.rough;
  gPbrNTS = pbr.nTS;
}
`;

const FRAG_COLOR = /* glsl */`
{
  float part = vFacade.x;
  float levels = max(vFacade.y, 1.0);
  float floorH = max(vFacade.z, 0.5);
  float bay = abs(vFacade.w);
  bool realWindows = vFacade.w < 0.0;
  float styleId = floor(vStyle + 0.001);
  float shops = fract(vStyle) > 0.25 ? 1.0 : 0.0;
  float bodyH = floorH * levels;
  float v = vUvM.y;
  float u = vUvM.x;
  bool pbrBrick = uPbrOn > 0.5 && gPbrLayer > 3.5 && gPbrLayer < 5.5;
  bool pbrRoof = uPbrOn > 0.5 && gPbrLayer > 9.5 && gPbrLayer < 13.5;
  vec3 albedo = diffuseColor.rgb;
  // Colour-carrying layers bring brick / tile / stone colour in the texture; keep only the base
  // luminance so a red brick wall is not red x red.
  if (uPbrOn > 0.5 && pbrCarriesColour(gPbrLayer)) {
    albedo = min(vec3(dot(albedo, vec3(0.2126, 0.7152, 0.0722))) * 1.6, vec3(1.2));
  }
  float win = 0.0;
  // Real window geometry (aFacade.w < 0) keeps the hull unbroken here; E1 paints the panes and frames.
  if (part < 0.5 && !realWindows && bay > 0.5 && v > 0.45 && v < bodyH - 0.22) {
    float row = floor(v / floorH);
    float fy = fract(v / floorH);
    float fx = fract(u / bay);
    float px = max(fwidth(v), 0.02);
    float lo = 0.28;
    float hi = 0.78;
    float x0 = 0.22;
    float x1 = 0.78;
    // Typology. Wall colour is already the bake's reading of building:colour / material.
    bool historic = styleId > 29.5 && styleId < 34.5;
    bool khrush = styleId > 24.5 && styleId < 25.5;
    bool panel = styleId > 25.5 && styleId < 26.5;
    bool stalin = styleId > 26.5 && styleId < 27.5;
    if (historic || stalin) { lo = 0.18; hi = 0.84; x0 = 0.28; x1 = 0.72; } // tall 19th-c. / Stalin windows
    if (khrush) { lo = 0.32; hi = 0.72; x0 = 0.18; x1 = 0.82; }               // wide, short panes
    if (panel) { lo = 0.30; hi = 0.74; x0 = 0.16; x1 = 0.84; }
    if (shops > 0.5 && row < 0.5) { lo = 0.12; hi = 0.92; x0 = 0.08; x1 = 0.92; }
    if (styleId > 27.5 && styleId < 28.5) { x0 = 0.06; x1 = 0.94; lo = 0.22; hi = 0.78; } // modern glass bands
    win = aaBox(fy, lo, hi, px) * aaBox(fx, x0, x1, px);
    vec3 glass = vec3(0.16, 0.22, 0.28);
    float dirt = 0.92 + 0.08 * gHash(vec2(floor(u / bay), row));
    albedo = mix(albedo, glass * dirt, win);
    float lit = step(0.42, gHash(vec2(floor(u / bay) + 3.1, row + 1.7)));
    vec3 lamp = gHash(vec2(row, floor(u / bay))) > 0.92 ? vec3(0.55, 0.72, 1.0) : vec3(1.0, 0.72, 0.38);
    gGlow = lamp * win * lit * uNight * 1.6;
    if ((historic || stalin) && v > bodyH - 0.45) albedo = mix(albedo, vec3(0.93, 0.90, 0.84), 0.45);
    if ((khrush || panel) && win < 0.5) {
      float seamPx = max(fwidth(v), 0.015);
      float seam = max(aaLine(u, max(bay, 3.0), 0.04, seamPx), aaLine(v, floorH, 0.035, seamPx));
      albedo *= mix(1.0, panel ? 0.78 : 0.86, seam);
    }
  } else if (part > 0.5 && part < 1.5) {
    float grain = 0.94 + 0.06 * gHash(floor(vUvM * 3.0));
    if (pbrRoof) {
      // The roof texture carries the tile courses.
      albedo *= grain;
    } else {
      float py = max(fwidth(vUvM.y), 0.01);
      float tile = aaLine(vUvM.y, 0.32, 0.025, py);
      albedo *= mix(1.0, 0.82, tile) * grain;
    }
  } else if (part > 2.5) {
    albedo *= 0.72;
  } else {
    float grain = 0.95 + 0.05 * gHash(floor(vUvM * vec2(2.0, 4.0)));
    albedo *= grain;
    if (v < 0.55) albedo *= 0.78; // plinth
    if ((styleId > 29.5 && styleId < 34.5) || (styleId > 26.5 && styleId < 27.5)) {
      if (v > bodyH - 0.45) albedo = mix(albedo, vec3(0.93, 0.90, 0.84), 0.55); // cornice
    }
    if (!pbrBrick && styleId > 38.5 && styleId < 39.5) {
      float py = max(fwidth(v), 0.008);
      float mortar = max(aaLine(v, 0.075, 0.012, py), aaLine(u, 0.24, 0.012, py));
      albedo *= mix(1.0, 0.55, mortar);
    }
    if (styleId > 24.5 && styleId < 26.5) {
      float py = max(fwidth(v), 0.015);
      float seam = max(aaLine(u, max(bay, 3.0), 0.035, py), aaLine(v, floorH, 0.03, py));
      albedo *= mix(1.0, 0.86, seam);
    }
  }
  // Parts 0..4 (wall, roof, parapet, soffit, trim) and doors (7) take the texture; glass (5) and
  // frames / rails (6) keep their own material so reflections stay clean.
  if (uPbrOn > 0.5 && (part < 4.5 || part > 6.5)) albedo *= gPbrDetail;
  diffuseColor.rgb = albedo;
}
`;

const FRAG_ROUGH = /* glsl */`
{
  float part = vFacade.x;
  float bay = abs(vFacade.w);
  float v = vUvM.y;
  float floorH = max(vFacade.z, 0.5);
  float bodyH = floorH * max(vFacade.y, 1.0);
  bool textured = uPbrOn > 0.5 && gPbrLayer > -0.5;
  float wallRough = textured ? clamp(gPbrRough, 0.55, 0.98) : 0.84;
  if (part > 4.5 && part < 5.5) {
    roughnessFactor = 0.04; // glass: polished, relies on scene.environment
  } else if (part > 5.5 && part < 6.5) {
    roughnessFactor = 0.45; // frames / rails
  } else if (part > 6.5 && part < 7.5) {
    roughnessFactor = 0.6; // doors
  } else if (part < 0.5 && vFacade.w > 0.5 && v > 0.45 && v < bodyH - 0.22) {
    float fy = fract(v / floorH);
    float fx = fract(vUvM.x / bay);
    float win = aaBox(fy, 0.28, 0.78, 0.04) * aaBox(fx, 0.22, 0.78, 0.04);
    roughnessFactor = mix(wallRough, 0.08, win); // painted (mid) windows stay glossy
  } else if (part > 0.5 && part < 1.5) {
    roughnessFactor = textured ? clamp(gPbrRough, 0.55, 0.98) : 0.74;
  } else {
    roughnessFactor = textured ? clamp(gPbrRough, 0.55, 0.98) : 0.86;
  }
}
`;

const FRAG_METAL = /* glsl */`
{
  float part = vFacade.x;
  float styleId = floor(vStyle + 0.001);
  bool textured = uPbrOn > 0.5 && gPbrLayer > -0.5;
  if (part > 4.5 && part < 7.5) {
    metalnessFactor = 0.0; // glass, frames and doors
  } else if (part > 0.5 && part < 1.5) {
    if (styleId > 42.5 && styleId < 43.5) metalnessFactor = 0.35; // gold roofs
    else if (textured && gPbrLayer > 9.5 && gPbrLayer < 10.5) metalnessFactor = 0.2; // ROOF_TIN_SEAM
    else metalnessFactor = 0.0;
  } else if (part < 0.5) metalnessFactor = 0.04;
  else metalnessFactor = 0.0;
}
`;

const FRAG_NORMAL = /* glsl */`
if (uPbrOn > 0.5 && gPbrLayer > -0.5) {
  float part = vFacade.x;
  // Glass and frames keep their geometric normal; the texture must not ripple reflections.
  if (part < 4.5 || part > 6.5) {
    vec3 wn = normalize(vPbrNormal);
    vec3 t;
    vec3 b;
    bool pitchedRoof = part > 0.5 && part < 1.5 && abs(wn.y) < 0.999;
    if (abs(wn.y) < 0.5 || pitchedRoof) pbrWallBasis(wn, t, b);
    else pbrGroundBasis(wn, t, b);
    // pbrSample fades nTS to flat with distance, so no extra distance term is needed here.
    vec3 pn = pbrPerturb(wn, t, b, gPbrNTS);
    normal = normalize(mat3(viewMatrix) * pn);
  }
}
`;

const FRAG_GLOW = /* glsl */`
{
  float part = vFacade.x;
  float bay = abs(vFacade.w);
  float floorH = max(vFacade.z, 0.5);
  // Real window geometry lights with the same hash and colours the mid shader paints at this wall
  // position, so the near / mid swap keeps the same windows lit.
  if (part > 4.5 && part < 5.5 && bay > 0.5) {
    float col = floor(vUvM.x / bay);
    float row = floor(vUvM.y / floorH);
    float lit = step(0.42, gHash(vec2(col + 3.1, row + 1.7)));
    vec3 lamp = gHash(vec2(row, col)) > 0.92 ? vec3(0.55, 0.72, 1.0) : vec3(1.0, 0.72, 0.38);
    gGlow = lamp * lit * uNight * 1.6;
  }
  totalEmissiveRadiance += gGlow;
}
`;

/** Shared PBR facade. `castShadow` is applied by the batch that uses it. */
export function createFacadeMaterial(pbr?: PbrUniforms): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.86,
    metalness: 0.0,
    vertexColors: true,
  });
  // Boolean instead of checking the textures, so the placeholder arrays compile as PBR too.
  const uPbrOn = { value: pbr === undefined ? 0 : 1 };
  material.customProgramCacheKey = () => pbr === undefined ? 'vk-citymesh-facade-3' : 'vk-citymesh-facade-3-pbr';
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = NIGHT_UNIFORM;
    shader.uniforms.uPbrOn = uPbrOn;
    if (pbr !== undefined) {
      shader.uniforms.uPbrA = pbr.uPbrA;
      shader.uniforms.uPbrN = pbr.uPbrN;
      shader.uniforms.uPbrTile = pbr.uPbrTile;
    }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${pbr === undefined ? VERT : `${VERT}\n${VERT_PBR}`}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${pbr === undefined ? VERT_BODY : `${VERT_BODY}\n${VERT_BODY_PBR}`}`);
    const head = pbr === undefined ? FRAG_HEAD : `${FRAG_HEAD}\n${FRAG_PBR_VARYINGS}\n${PBR_PARS}`;
    const sample = pbr === undefined ? FRAG_PBR_STATE : FRAG_PBR_SAMPLE;
    let fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${head}\n${PBR_CARRY_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${sample}\n${FRAG_COLOR}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${FRAG_ROUGH}`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>\n${FRAG_METAL}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${FRAG_GLOW}`);
    // The normal hook uses pbrWallBasis / pbrGroundBasis / pbrPerturb, which exist only in PBR_PARS.
    if (pbr !== undefined) {
      fragmentShader = fragmentShader.replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>\n${FRAG_NORMAL}`,
      );
    }
    shader.fragmentShader = fragmentShader;
  };
  return material;
}

/**
 * Tiling facade / roof material for extruded buildings. One MeshStandardMaterial, shared by every
 * chunk: albedo, roughness and a little metalness come from the vertex colour plus a procedural
 * window grid (storeys and bay carried on `aFacade`). No texture files, so nothing extra is downloaded.
 */
import * as THREE from 'three';
import { NIGHT_UNIFORM } from '../world/facade-shader.ts';

const VERT = /* glsl */`
attribute vec2 aUvM;
attribute vec4 aFacade;
attribute float aStyle;
varying vec2 vUvM;
varying vec4 vFacade;
varying float vStyle;
`;

const VERT_BODY = /* glsl */`
vUvM = aUvM;
vFacade = aFacade;
vStyle = aStyle;
`;

const FRAG_HEAD = /* glsl */`
varying vec2 vUvM;
varying vec4 vFacade;
varying float vStyle;
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

const FRAG_COLOR = /* glsl */`
{
  float part = vFacade.x;
  float levels = max(vFacade.y, 1.0);
  float floorH = max(vFacade.z, 0.5);
  float bay = vFacade.w;
  float styleId = floor(vStyle + 0.001);
  float shops = fract(vStyle) > 0.25 ? 1.0 : 0.0;
  float bodyH = floorH * levels;
  float v = vUvM.y;
  float u = vUvM.x;
  vec3 albedo = diffuseColor.rgb;
  float win = 0.0;
  if (part < 0.5 && bay > 0.5 && v > 0.45 && v < bodyH - 0.22) {
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
    float py = max(fwidth(vUvM.y), 0.01);
    float tile = aaLine(vUvM.y, 0.32, 0.025, py);
    float grain = 0.94 + 0.06 * gHash(floor(vUvM * 3.0));
    albedo *= mix(1.0, 0.82, tile) * grain;
  } else if (part > 2.5) {
    albedo *= 0.72;
  } else {
    float grain = 0.95 + 0.05 * gHash(floor(vUvM * vec2(2.0, 4.0)));
    albedo *= grain;
    if (v < 0.55) albedo *= 0.78; // plinth
    if ((styleId > 29.5 && styleId < 34.5) || (styleId > 26.5 && styleId < 27.5)) {
      if (v > bodyH - 0.45) albedo = mix(albedo, vec3(0.93, 0.90, 0.84), 0.55); // cornice
    }
    if (styleId > 38.5 && styleId < 39.5) {
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
  diffuseColor.rgb = albedo;
}
`;

const FRAG_ROUGH = /* glsl */`
{
  float part = vFacade.x;
  float bay = vFacade.w;
  float v = vUvM.y;
  float floorH = max(vFacade.z, 0.5);
  float bodyH = floorH * max(vFacade.y, 1.0);
  if (part < 0.5 && bay > 0.5 && v > 0.45 && v < bodyH - 0.22) {
    float fy = fract(v / floorH);
    float fx = fract(vUvM.x / bay);
    float win = aaBox(fy, 0.28, 0.78, 0.04) * aaBox(fx, 0.22, 0.78, 0.04);
    roughnessFactor = mix(0.84, 0.08, win);
  } else if (part > 0.5 && part < 1.5) roughnessFactor = 0.74;
  else roughnessFactor = 0.86;
}
`;

const FRAG_METAL = /* glsl */`
{
  float part = vFacade.x;
  float styleId = floor(vStyle + 0.001);
  if (part > 0.5 && part < 1.5 && styleId > 42.5 && styleId < 43.5) metalnessFactor = 0.35;
  else if (part < 0.5) metalnessFactor = 0.04;
  else metalnessFactor = 0.0;
}
`;

const FRAG_GLOW = /* glsl */`
totalEmissiveRadiance += gGlow;
`;

/** Shared PBR facade. `castShadow` is applied by the batch that uses it. */
export function createFacadeMaterial(): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.86,
    metalness: 0.0,
    vertexColors: true,
  });
  material.customProgramCacheKey = () => 'vk-citymesh-facade-2';
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = NIGHT_UNIFORM;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERT_BODY}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_HEAD}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAG_COLOR}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${FRAG_ROUGH}`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>\n${FRAG_METAL}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${FRAG_GLOW}`);
  };
  return material;
}

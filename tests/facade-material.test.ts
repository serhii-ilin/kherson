import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createFacadeMaterial } from '../src/mesh/facade.ts';
import { SkyEnvironment, shouldRegenerate } from '../src/world/environment.ts';
import type { PbrUniforms } from '../src/world/pbr-library.ts';

interface CompiledShader {
  vertexShader: string;
  fragmentShader: string;
  uniforms: Record<string, THREE.IUniform>;
}

/** The object three hands to onBeforeCompile: strings from the physical shader, no renderer needed. */
function compiled(): CompiledShader {
  return {
    vertexShader: THREE.ShaderLib.physical.vertexShader,
    fragmentShader: THREE.ShaderLib.physical.fragmentShader,
    uniforms: {},
  };
}

/** Run the material's onBeforeCompile hook the way the renderer would (minus the GL program). */
function run(material: THREE.MeshStandardMaterial, shader: CompiledShader = compiled()): CompiledShader {
  const hook = material.onBeforeCompile as unknown as (s: CompiledShader, r: unknown) => void;
  hook(shader, null);
  return shader;
}

function fakePbr(): PbrUniforms {
  return {
    uPbrA: { value: new THREE.DataArrayTexture(new Uint8Array(4 * 4 * 4), 4, 4, 1) },
    uPbrN: { value: new THREE.DataArrayTexture(new Uint8Array(4 * 4 * 4), 4, 4, 1) },
    uPbrTile: { value: new Float32Array(20).fill(1) },
  };
}

describe('createFacadeMaterial with the PBR library', () => {
  const pbr = fakePbr();
  const material = createFacadeMaterial(pbr);
  const shader = run(material);

  it('shares the PBR uniform objects and turns the layer on', () => {
    expect(shader.uniforms.uPbrA).toBe(pbr.uPbrA);
    expect(shader.uniforms.uPbrN).toBe(pbr.uPbrN);
    expect(shader.uniforms.uPbrTile).toBe(pbr.uPbrTile);
    expect(shader.uniforms.uPbrOn!.value).toBe(1);
    expect(shader.uniforms.uNight).toBeDefined();
  });

  it('declares aPbr and a flat layer varying in the vertex shader', () => {
    expect(shader.vertexShader).toContain('attribute float aPbr;');
    expect(shader.vertexShader).toContain('flat varying float vPbr;');
    expect(shader.vertexShader).toContain('vPbr = aPbr;');
    expect(shader.vertexShader).toContain('vPbrWorld');
    expect(shader.vertexShader).toContain('vPbrNormal');
  });

  it('injects the PBR parser, the sample call and the flat varying in the fragment shader', () => {
    expect(shader.fragmentShader).toContain('uniform sampler2DArray uPbrA;');
    expect(shader.fragmentShader).toContain('pbrSample(');
    expect(shader.fragmentShader).toContain('flat varying float vPbr;');
    expect(shader.fragmentShader).toContain('uniform float uPbrOn;');
  });

  it('exposes pbrCarriesColour with the colour-carrying layer ids', () => {
    const source = shader.fragmentShader;
    expect(source).toContain('bool pbrCarriesColour(');
    // BRICK_RED (4), GRANITE (9), ROOF_CLAY_TILE (11), PAVERS_BEHATON (16), SETT_GRANITE (17), GRAVEL (19)
    for (const id of [4, 9, 11, 16, 17, 19]) {
      expect(source).toContain(`(layer > ${id - 0.5} && layer < ${id + 0.5})`);
    }
    expect(source).toContain('dot(');
    expect(source).toContain('0.2126, 0.7152, 0.0722');
  });

  it('hooks the world-space normal perturbation after normal_fragment_maps and skips glass and frames', () => {
    const source = shader.fragmentShader;
    expect(source).toContain('#include <normal_fragment_maps>');
    expect(source).toContain('pbrPerturb(');
    expect(source).toContain('pbrWallBasis(');
    expect(source).toContain('pbrGroundBasis(');
    expect(source).toContain('mat3(viewMatrix)');
    // parts 5 (glass) and 6 (frame) are excluded from texturing and perturbation
    expect(source).toContain('part < 4.5 || part > 6.5');
  });

  it('uses the absolute bay so real-window walls keep their seams and hashes', () => {
    const source = shader.fragmentShader;
    expect(source).toContain('abs(vFacade.w)');
    expect(source).toContain('floor(u / bay)');
  });

  it('lights real window geometry with the painted-window hash', () => {
    expect(shader.fragmentShader).toContain('step(0.42, gHash(vec2(col + 3.1, row + 1.7)))');
    expect(shader.fragmentShader).toContain('vec3(0.55, 0.72, 1.0)');
    expect(shader.fragmentShader).toContain('vec3(1.0, 0.72, 0.38)');
  });

  it('uses a distinct program cache key', () => {
    expect(material.customProgramCacheKey()).toBe('vk-citymesh-facade-3-pbr');
  });
});

describe('createFacadeMaterial without the PBR library', () => {
  const material = createFacadeMaterial();
  const shader = run(material);

  it('keeps today’s procedural material and leaves the layer off', () => {
    expect(shader.fragmentShader).not.toContain('pbrSample(');
    expect(shader.fragmentShader).not.toContain('uniform sampler2DArray uPbrA;');
    expect(shader.uniforms.uPbrOn!.value).toBe(0);
    expect(shader.uniforms.uPbrA).toBeUndefined();
    expect(shader.uniforms.uPbrN).toBeUndefined();
    expect(shader.uniforms.uPbrTile).toBeUndefined();
  });

  it('still declares the varying and attribute contract for geometry that provides them', () => {
    expect(shader.vertexShader).toContain('attribute float aPbr;');
    expect(shader.fragmentShader).toContain('flat varying float vPbr;');
    expect(shader.fragmentShader).toContain('bool pbrCarriesColour(');
  });

  it('keeps the procedural window, mortar and tile fallbacks', () => {
    expect(shader.fragmentShader).toContain('float lit = step(0.42, gHash(vec2(floor(u / bay) + 3.1, row + 1.7)));');
    expect(shader.fragmentShader).toContain('float mortar = max(aaLine(v, 0.075, 0.012, py), aaLine(u, 0.24, 0.012, py));');
    expect(shader.fragmentShader).toContain('float tile = aaLine(vUvM.y, 0.32, 0.025, py);');
  });

  it('uses the base program cache key', () => {
    expect(material.customProgramCacheKey()).toBe('vk-citymesh-facade-3');
  });
});

describe('SkyEnvironment', () => {
  it('regenerates on the first call, every ten minutes, and across midnight', () => {
    expect(shouldRegenerate(null, 0)).toBe(true);
    expect(shouldRegenerate(100, 105)).toBe(false);
    expect(shouldRegenerate(100, 109.9)).toBe(false);
    expect(shouldRegenerate(100, 110)).toBe(true);
    // 23:55 -> 00:05 is ten minutes across the wrap
    expect(shouldRegenerate(1435, 5)).toBe(true);
    // 23:55 -> midnight is five minutes, so no render
    expect(shouldRegenerate(1435, 0)).toBe(false);
    expect(shouldRegenerate(5, 1435)).toBe(true);
    // 00:00 -> 23:59 is one minute backwards across the wrap
    expect(shouldRegenerate(0, 1439)).toBe(false);
  });

  it('is a class with update and dispose, keeping throttling in the pure helper', () => {
    expect(typeof SkyEnvironment).toBe('function');
    expect(typeof SkyEnvironment.prototype.update).toBe('function');
    expect(typeof SkyEnvironment.prototype.dispose).toBe('function');
  });
});

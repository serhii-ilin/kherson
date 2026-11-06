import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ShaderLib } from 'three';
import { facadeShader, setGroundPbr } from '../src/world/facade-shader.ts';
import { MAT } from '../src/world/materials.ts';
import { hasGroundDetail } from '../src/world/mesher.ts';
import { groundLayer, PBR_LAYER_COUNT } from '../src/world/pbr-layers.ts';
import type { PbrUniforms } from '../src/world/pbr-library.ts';

interface FakeShader {
  vertexShader: string;
  fragmentShader: string;
  uniforms: Record<string, { value: unknown }>;
}

/** Run facadeShader against the real Lambert chunks, as the renderer does before linking. */
function compile(): FakeShader {
  const shader: FakeShader = {
    vertexShader: ShaderLib.lambert.vertexShader,
    fragmentShader: ShaderLib.lambert.fragmentShader,
    uniforms: {},
  };
  facadeShader.call(undefined, shader);
  return shader;
}

function fakeUniforms(): PbrUniforms {
  const a = new Uint8Array(PBR_LAYER_COUNT * 4);
  const n = new Uint8Array(PBR_LAYER_COUNT * 4);
  a.fill(128);
  n.fill(128);
  const tile = new Float32Array(PBR_LAYER_COUNT);
  tile.fill(2);
  return {
    uPbrA: { value: new THREE.DataArrayTexture(a, 1, 1, PBR_LAYER_COUNT) },
    uPbrN: { value: new THREE.DataArrayTexture(n, 1, 1, PBR_LAYER_COUNT) },
    uPbrTile: { value: tile },
  };
}

afterEach(() => {
  setGroundPbr(null);
});

describe('ground detail ids', () => {
  it('tags every fine road and paving surface, including kerbs and granite', () => {
    for (const id of [
      MAT.ASPHALT, MAT.SIDEWALK, MAT.PLAZA, MAT.RAIL, MAT.MARKING, MAT.STEEL, MAT.PAVING, MAT.KERB,
      MAT.SETT, MAT.PAVERS, MAT.CONCRETE_SLAB, MAT.ASPHALT_PATCH, MAT.GRANITE, MAT.TRAM_BED,
      MAT.MANHOLE, MAT.DRAIN, MAT.STOP_LINE,
    ]) {
      expect(hasGroundDetail(id), `mat ${id}`).toBe(true);
    }
  });

  it('leaves natural ground and structures procedural', () => {
    for (const id of [MAT.AIR, MAT.WATER, MAT.GRASS, MAT.SAND, MAT.DIRT, MAT.PARK, MAT.FOREST,
      MAT.WETLAND, MAT.REED, MAT.MEADOW, MAT.SCRUB, MAT.WALL_HOUSE, MAT.ROOF_RED]) {
      expect(hasGroundDetail(id), `mat ${id}`).toBe(false);
    }
  });
});

describe('generated groundPbrLayer GLSL', () => {
  it('matches groundLayer() for every id 0..80', () => {
    const source = compile().fragmentShader;
    const match = /const float gGroundPbrLayers\[81\] = float\[81\]\(([\s\S]*?)\);/.exec(source);
    expect(match).not.toBeNull();
    const values = match![1]!.split(',').map((value) => Number(value.trim()));
    expect(values).toHaveLength(81);
    for (let id = 0; id <= 80; id++) {
      expect(values[id], `id ${id}`).toBe(groundLayer(id));
    }
  });

  it('returns -1 outside the table for ids without a layer', () => {
    const source = compile().fragmentShader;
    expect(source).toContain('float groundPbrLayer( float id )');
    expect(source).toContain('if ( i < 0 || i > 80 ) return -1.0;');
  });
});

describe('facadeShader ground PBR variant', () => {
  it('injects the PBR library, the uniform gate and the normal-maps hook', () => {
    const shader = compile();
    const fragment = shader.fragmentShader;
    expect(fragment).toContain('precision highp sampler2DArray;');
    expect(fragment).toContain('pbrSample(');
    expect(fragment).toContain('uGroundPbrOn');
    expect(fragment).toContain('groundPbrLayer(');
    expect(fragment).toContain('groundPbrColorLayer(');
    const maps = fragment.indexOf('#include <normal_fragment_maps>');
    expect(maps).toBeGreaterThanOrEqual(0);
    expect(fragment.indexOf('pbrPerturb(', maps)).toBeGreaterThan(maps);
    expect(shader.uniforms.uPbrA).toBeDefined();
    expect(shader.uniforms.uPbrN).toBeDefined();
    expect(shader.uniforms.uPbrTile).toBeDefined();
    expect(shader.uniforms.uGroundPbrOn!.value).toBe(0);
  });

  it('swaps shared uniform values without changing the program source', () => {
    const before = compile();
    expect(before.uniforms.uGroundPbrOn!.value).toBe(0);

    const uniforms = fakeUniforms();
    setGroundPbr(uniforms);
    const after = compile();

    // Source, and therefore the program cache key, is identical.
    expect(after.vertexShader).toBe(before.vertexShader);
    expect(after.fragmentShader).toBe(before.fragmentShader);
    // Both shaders share the module-level uniform objects; setGroundPbr swapped their values.
    expect(after.uniforms.uGroundPbrOn).toBe(before.uniforms.uGroundPbrOn);
    expect(after.uniforms.uGroundPbrOn!.value).toBe(1);
    expect(after.uniforms.uPbrA!.value).toBe(uniforms.uPbrA.value);
    expect(after.uniforms.uPbrN!.value).toBe(uniforms.uPbrN.value);
    expect(after.uniforms.uPbrTile!.value).toBe(uniforms.uPbrTile.value);
    expect(before.uniforms.uPbrA!.value).toBe(uniforms.uPbrA.value);

    setGroundPbr(null);
    expect(after.uniforms.uGroundPbrOn!.value).toBe(0);
    expect(after.uniforms.uPbrA!.value).not.toBe(uniforms.uPbrA.value);
  });
});

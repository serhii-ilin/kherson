import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { LandmarkLayer, landmarkLod } from '../src/landmarks/layer.ts';
import { prismSurface } from '../src/landmarks/hero-physics.ts';
import type { Landmark, LandmarkBuild, LandmarkBuildContext, LandmarkMeshData } from '../src/landmarks/types.ts';
import type { OsmRef } from '../src/world/osm-ref.ts';
import type { PbrUniforms } from '../src/world/pbr-library.ts';
import { versioned } from '../src/version.ts';

const flatGround = {
  heightAt: () => 0,
  groundHeightAt: () => 0,
  isWater: () => false,
};

function meshData(kind: 'opaque' | 'textured', photo?: string, pbr?: readonly number[]): LandmarkMeshData {
  const count = 3;
  return {
    positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    normals: Float32Array.from([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    colors: Float32Array.from([1, 1, 1, 1, 1, 1, 1, 1, 1]),
    indices: Uint32Array.from([0, 1, 2]),
    kind,
    ...(kind === 'textured' ? { uvs: Float32Array.from([0, 0, 1, 0, 0, 1]) } : {}),
    ...(pbr ? { pbr: Float32Array.from(pbr) } : {}),
    ...(photo ? { photo } : {}),
  };
}

function build(meshes: readonly LandmarkMeshData[]): LandmarkBuild {
  let triangles = 0;
  for (const mesh of meshes) triangles += mesh.indices.length / 3;
  return { meshes, surfaces: [], triangleCount: triangles, materialCount: meshes.length };
}

interface StubOptions {
  replaces?: readonly OsmRef[];
  meshes?: readonly LandmarkMeshData[];
}

function stub(options: StubOptions = {}) {
  const lods: (string | undefined)[] = [];
  const landmark: Landmark = {
    id: 'stub',
    name: 'Stub',
    anchor: { lat: 0, lon: 0, x: 0, z: 0 },
    footprint: [[-1, -1], [1, -1], [1, 1], [-1, 1]],
    ...(options.replaces ? { replaces: options.replaces } : {}),
    build(ctx: LandmarkBuildContext) {
      lods.push(ctx.lod);
      return build(options.meshes ?? [meshData('opaque')]);
    },
  };
  return { landmark, lods };
}

function layerFor(landmarks: readonly Landmark[], options?: ConstructorParameters<typeof LandmarkLayer>[4]) {
  const scene = new THREE.Scene();
  const layer = new LandmarkLayer(scene, landmarks, flatGround, 'high', options);
  return { layer, scene };
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function sceneMeshes(scene: THREE.Scene): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  scene.traverse((object) => {
    if ((object as THREE.Mesh).isMesh) meshes.push(object as THREE.Mesh);
  });
  return meshes;
}

function fakePbr(): PbrUniforms {
  const texture = new THREE.DataArrayTexture(new Uint8Array(4), 1, 1, 1);
  return { uPbrA: { value: texture }, uPbrN: { value: texture }, uPbrTile: { value: new Float32Array(20) } };
}

describe('landmarkLod', () => {
  it('goes near within 250 m and returns to far only beyond 300 m', () => {
    expect(landmarkLod(0, 'far')).toBe('near');
    expect(landmarkLod(250, 'far')).toBe('near');
    expect(landmarkLod(250.01, 'far')).toBe('far');
    expect(landmarkLod(300, 'near')).toBe('near');
    expect(landmarkLod(300.01, 'near')).toBe('far');
    expect(landmarkLod(400, 'far')).toBe('far');
  });
});

describe('LandmarkLayer registration', () => {
  it('publishes every replaced OSM key once, for ways and relations', () => {
    const a = stub({ replaces: [{ type: 'way', id: 10 }, { type: 'relation', id: 20 }] });
    const b = stub({ replaces: [{ type: 'way', id: 10 }] });
    const { layer } = layerFor([a.landmark, b.landmark]);
    expect([...layer.replacedKeys].sort()).toEqual(['r20', 'w10']);
    expect(layer.replacedKeys.size).toBe(2);
  });

  it('builds replaced heroes at 700 m and drops them at 950 m', () => {
    const replaced = stub({ replaces: [{ type: 'way', id: 1 }] });
    const near = layerFor([replaced.landmark]);
    near.layer.update(699, 0);
    expect(near.layer.builtCount).toBe(1);
    const justOutside = layerFor([stub({ replaces: [{ type: 'way', id: 1 }] }).landmark]);
    justOutside.layer.update(701, 0);
    expect(justOutside.layer.builtCount).toBe(0);

    near.layer.update(949, 0);
    expect(near.layer.builtCount).toBe(1);
    near.layer.update(951, 0);
    expect(near.layer.builtCount).toBe(0);
  });

  it('keeps the 600 m build and 900 m drop radius for other landmarks', () => {
    const plain = stub();
    const near = layerFor([plain.landmark]);
    near.layer.update(599, 0);
    expect(near.layer.builtCount).toBe(1);
    const justOutside = layerFor([stub().landmark]);
    justOutside.layer.update(601, 0);
    expect(justOutside.layer.builtCount).toBe(0);

    near.layer.update(899, 0);
    expect(near.layer.builtCount).toBe(1);
    near.layer.update(901, 0);
    expect(near.layer.builtCount).toBe(0);
  });
});

describe('LandmarkLayer LOD', () => {
  it('rebuilds once per threshold crossing and passes ctx.lod', () => {
    const { landmark, lods } = stub();
    const { layer } = layerFor([landmark]);
    layer.update(0, 0);
    expect(lods).toEqual(['near']);

    layer.update(240, 0);
    expect(lods).toEqual(['near']);

    layer.update(301, 0);
    expect(lods).toEqual(['near', 'far']);

    layer.update(320, 0);
    expect(lods).toEqual(['near', 'far']);

    layer.update(290, 0);
    expect(lods).toEqual(['near', 'far']);

    layer.update(240, 0);
    expect(lods).toEqual(['near', 'far', 'near']);
  });

  it('does not evaluate the LOD again until the camera has moved 16 m', () => {
    const { landmark, lods } = stub();
    const { layer } = layerFor([landmark]);
    layer.update(0, 0);
    layer.update(300, 0);
    expect(lods).toEqual(['near']);

    layer.update(301, 0);
    expect(lods).toEqual(['near']);

    layer.update(317, 0);
    expect(lods).toEqual(['near', 'far']);
  });
});

describe('LandmarkLayer textured materials', () => {
  it('shares one material and one texture load for two meshes with the same photo, then disposes both', async () => {
    const texture = new THREE.Texture();
    const textureDispose = vi.spyOn(texture, 'dispose');
    const loadTexture = vi.fn(async () => texture);
    const { landmark } = stub({ meshes: [meshData('textured', 'hero'), meshData('textured', 'hero')] });
    const { layer, scene } = layerFor([landmark], { base: '/base/', loadTexture });

    layer.update(0, 0);
    await flush();

    const meshes = sceneMeshes(scene);
    expect(meshes).toHaveLength(2);
    expect(new Set(meshes.map((mesh) => mesh.material)).size).toBe(1);
    expect(loadTexture).toHaveBeenCalledTimes(1);
    expect(loadTexture.mock.calls[0]?.[0]).toBe(versioned('/base/assets/facades/hero.webp'));
    expect(layer.texturedMaterials).toBe(1);
    expect(layer.photoTextures).toBe(1);

    const material = meshes[0]!.material as THREE.MeshStandardMaterial;
    const materialDispose = vi.spyOn(material, 'dispose');
    layer.update(1000, 0);

    expect(materialDispose).toHaveBeenCalledTimes(1);
    expect(textureDispose).toHaveBeenCalledTimes(1);
    expect(layer.texturedMaterials).toBe(0);
    expect(layer.photoTextures).toBe(0);
  });

  it('keeps the fallback and warns once when a photo fails to load', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const loadTexture = vi.fn(() => Promise.reject(new Error('404')));
    try {
      const { landmark } = stub({ meshes: [meshData('textured', 'missing')] });
      const { layer, scene } = layerFor([landmark], { base: '/base/', loadTexture });

      layer.update(0, 0);
      await flush();
      expect(warn).toHaveBeenCalledTimes(1);

      const material = sceneMeshes(scene)[0]!.material as THREE.MeshStandardMaterial;
      expect((material.userData.uHasPhoto as { value: number }).value).toBe(0);
      expect(layer.photoTextures).toBe(0);

      layer.update(20, 0);
      await flush();
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  it('defaults aPbr to -1 when a textured mesh has no PBR layer', () => {
    const { landmark } = stub({ meshes: [meshData('textured')] });
    const { layer, scene } = layerFor([landmark]);
    layer.update(0, 0);
    const attribute = sceneMeshes(scene)[0]!.geometry.getAttribute('aPbr');
    expect(Array.from(attribute.array)).toEqual([-1, -1, -1]);
  });

  it('injects pbrSample only when PBR uniforms are supplied', () => {
    const makeShader = () => ({
      vertexShader: '#include <common>\n#include <begin_vertex>',
      fragmentShader: '#include <common>\n#include <color_fragment>\n#include <roughnessmap_fragment>\n#include <normal_fragment_maps>',
      uniforms: {} as Record<string, THREE.IUniform>,
    });

    const pbr = fakePbr();
    const withPbr = stub({ meshes: [meshData('textured', undefined, [0, 0, 0])] });
    const first = layerFor([withPbr.landmark], { pbr });
    first.layer.update(0, 0);
    const pbrMaterial = sceneMeshes(first.scene)[0]!.material as THREE.MeshStandardMaterial;
    const pbrShader = makeShader();
    pbrMaterial.onBeforeCompile(pbrShader as never, {} as never);
    expect(pbrShader.fragmentShader).toContain('pbrSample(');
    expect(pbrShader.uniforms.uPbrA).toBe(pbr.uPbrA);

    const withoutPbr = stub({ meshes: [meshData('textured', undefined, [0, 0, 0])] });
    const second = layerFor([withoutPbr.landmark]);
    second.layer.update(0, 0);
    const plainMaterial = sceneMeshes(second.scene)[0]!.material as THREE.MeshStandardMaterial;
    const plainShader = makeShader();
    plainMaterial.onBeforeCompile(plainShader as never, {} as never);
    expect(plainShader.fragmentShader).not.toContain('pbrSample(');
  });
});

describe('prismSurface', () => {
  const square: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10]];

  it('is not walkable and blocks only where the body overlaps the prism', () => {
    const surface = prismSurface(square, 2, 5);
    expect(surface.heightAt(5, 5)).toBeNull();
    expect(surface.blockedAt!(5, 5, 2)).toBe(true);
    expect(surface.blockedAt!(5, 5, 4.9)).toBe(true);
    expect(surface.blockedAt!(5, 5, 5)).toBe(false);
    expect(surface.blockedAt!(5, 5, 5.1)).toBe(false);
    expect(surface.blockedAt!(5, 5, 0.5, 1.7)).toBe(true);
    expect(surface.blockedAt!(5, 5, 0.2, 1.7)).toBe(false);
    expect(surface.blockedAt!(11, 5, 3)).toBe(false);
  });
});

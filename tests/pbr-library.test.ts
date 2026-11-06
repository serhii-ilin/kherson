import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { BUILD_ID } from '../src/version.ts';
import { PBR_LAYER_COUNT, PBR_LAYER_NAMES, PBR_TILE_M } from '../src/world/pbr-layers.ts';
import {
  assembleLayers, createPbrLibrary, neutralLayer, PBR_SIZE, pbrAssetUrls, type PbrLoaderDeps,
} from '../src/world/pbr-library.ts';
import { PBR_GLSL_FUNCS, PBR_PARS } from '../src/world/pbr-glsl.ts';

const HI = PBR_SIZE.high;
const LO = PBR_SIZE.low;
const AR_BYTES = HI * HI * 4;

interface Slice {
  a: Uint8Array;
  n: Uint8Array;
}

function filled(size: number, value: number): Uint8Array {
  const data = new Uint8Array(size * size * 4);
  data.fill(value);
  return data;
}

function sliceOf(data: Uint8Array, size: number, layer: number): Uint8Array {
  const stride = size * size * 4;
  return data.subarray(layer * stride, (layer + 1) * stride);
}

/** Which layer and which of the two maps an asset URL asks for. */
function parseUrl(url: string): { layer: number; kind: 'a' | 'n' } {
  const m = /materials\/(?:hi|lo)\/(.+)_(a|n)\.webp/.exec(url);
  if (!m) throw new Error(`unexpected PBR URL ${url}`);
  const layer = PBR_LAYER_NAMES.indexOf(m[1]!);
  if (layer < 0) throw new Error(`unknown PBR layer ${m[1]}`);
  return { layer, kind: m[2] as 'a' | 'n' };
}

/**
 * Injected loader that encodes the layer and map in the fetched bytes, then decodes to a flat byte value
 * `2 * layer + (n ? 1 : 0)`, so the assembled array can be checked layer by layer.
 */
function fakeDeps(): PbrLoaderDeps {
  return {
    async fetchBytes(url) {
      const { layer, kind } = parseUrl(url);
      return new Uint8Array([layer, kind === 'n' ? 1 : 0]).buffer;
    },
    async decode(bytes, size) {
      const tag = new Uint8Array(bytes);
      const out = new Uint8Array(size * size * 4);
      out.fill(tag[0]! * 2 + tag[1]!);
      return out;
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('pbrAssetUrls', () => {
  it('lists one pair of assets per layer in index order, through versioned()', () => {
    const urls = pbrAssetUrls('high', '/kherson/');
    expect(urls).toHaveLength(PBR_LAYER_COUNT);
    for (let layer = 0; layer < PBR_LAYER_COUNT; layer++) {
      const entry = urls[layer]!;
      expect(entry.layer).toBe(layer);
      expect(entry.a).toBe(
        `/kherson/assets/materials/hi/${PBR_LAYER_NAMES[layer]}_a.webp?v=${BUILD_ID}`,
      );
      expect(entry.n).toBe(
        `/kherson/assets/materials/hi/${PBR_LAYER_NAMES[layer]}_n.webp?v=${BUILD_ID}`,
      );
    }
    expect(urls[0]!.a).toContain('/hi/stucco_smooth_a.webp');
  });

  it('uses the lo folder at low quality and accepts a base without a trailing slash', () => {
    const urls = pbrAssetUrls('low', '/kherson');
    expect(urls).toHaveLength(PBR_LAYER_COUNT);
    expect(urls[PBR_LAYER_COUNT - 1]!.a).toBe(
      `/kherson/assets/materials/lo/${PBR_LAYER_NAMES[PBR_LAYER_COUNT - 1]}_a.webp?v=${BUILD_ID}`,
    );
    expect(new Set(urls.map((u) => u.a)).size).toBe(PBR_LAYER_COUNT);
    expect(new Set(urls.map((u) => u.n)).size).toBe(PBR_LAYER_COUNT);
  });
});

describe('neutralLayer and assembleLayers', () => {
  it('writes one opaque RGBA neutral texel per pixel', () => {
    const size = 4;
    const { a, n } = neutralLayer(size);
    expect(a).toHaveLength(size * size * 4);
    expect(n).toHaveLength(size * size * 4);
    for (let i = 0; i < size * size; i++) {
      expect(Array.from(a.subarray(i * 4, i * 4 + 4))).toEqual([128, 128, 128, 255]);
      expect(Array.from(n.subarray(i * 4, i * 4 + 4))).toEqual([128, 128, 230, 255]);
    }
  });

  it('puts each loaded slice at layer * size * size * 4 and fills null or missing slices with neutral', () => {
    const size = 4;
    const layers: (Slice | null)[] = new Array(PBR_LAYER_COUNT).fill(null);
    layers[2] = { a: filled(size, 11), n: filled(size, 12) };
    layers[PBR_LAYER_COUNT - 1] = { a: filled(size, 21), n: filled(size, 22) };

    const out = assembleLayers(size, layers);
    const stride = size * size * 4;
    expect(out.a).toHaveLength(PBR_LAYER_COUNT * stride);
    expect(out.n).toHaveLength(PBR_LAYER_COUNT * stride);
    const neutral = neutralLayer(size);

    for (let layer = 0; layer < PBR_LAYER_COUNT; layer++) {
      const a = sliceOf(out.a, size, layer);
      const n = sliceOf(out.n, size, layer);
      const custom = layers[layer];
      if (custom) {
        expect(a).toEqual(custom.a);
        expect(n).toEqual(custom.n);
      } else {
        expect(a).toEqual(neutral.a);
        expect(n).toEqual(neutral.n);
      }
    }
  });
});

describe('createPbrLibrary', () => {
  it('publishes the quality sizes', () => {
    expect(PBR_SIZE).toEqual({ high: 512, low: 256 });
  });

  it('starts with small neutral arrays and stable uniform objects', () => {
    const lib = createPbrLibrary('high', '/kherson/', fakeDeps());
    const uniforms = lib.uniforms;
    const a = uniforms.uPbrA.value;
    const n = uniforms.uPbrN.value;
    expect(a.image.width).toBe(4);
    expect(a.image.height).toBe(4);
    expect(a.image.depth).toBe(PBR_LAYER_COUNT);
    expect(n.image.depth).toBe(PBR_LAYER_COUNT);
    expect(uniforms.uPbrTile.value).toEqual(new Float32Array(PBR_TILE_M));
    lib.dispose();
    expect(lib.uniforms).toBe(uniforms);
    expect(lib.uniforms.uPbrA.value).toBe(a);
    expect(lib.uniforms.uPbrN.value).toBe(n);
  });

  it('loads every layer, keeps the texture objects, and uploads one full array', async () => {
    const lib = createPbrLibrary('high', '/kherson/', fakeDeps());
    const uniforms = lib.uniforms;
    const aObject = uniforms.uPbrA;
    const nObject = uniforms.uPbrN;
    const aTexture = aObject.value;
    const nTexture = nObject.value;
    const aVersion = aTexture.version;
    const nVersion = nTexture.version;

    await expect(lib.ready).resolves.toBe(true);
    expect(lib.loaded()).toBe(true);

    expect(lib.uniforms).toBe(uniforms);
    expect(lib.uniforms.uPbrA).toBe(aObject);
    expect(lib.uniforms.uPbrN).toBe(nObject);
    expect(lib.uniforms.uPbrA.value).toBe(aTexture);
    expect(lib.uniforms.uPbrN.value).toBe(nTexture);

    for (const tex of [aTexture, nTexture]) {
      expect(tex).toBeInstanceOf(THREE.DataArrayTexture);
      expect(tex.image.width).toBe(HI);
      expect(tex.image.height).toBe(HI);
      expect(tex.image.depth).toBe(PBR_LAYER_COUNT);
      expect(tex.colorSpace).toBe(THREE.LinearSRGBColorSpace);
      expect(tex.wrapS).toBe(THREE.RepeatWrapping);
      expect(tex.wrapT).toBe(THREE.RepeatWrapping);
      expect(tex.minFilter).toBe(THREE.LinearMipmapLinearFilter);
      expect(tex.generateMipmaps).toBe(true);
    }
    // `needsUpdate` is a write-only setter in three: one swap must bump each version exactly once.
    expect(aTexture.version).toBe(aVersion + 1);
    expect(nTexture.version).toBe(nVersion + 1);
    expect(aTexture.anisotropy).toBe(4);

    const aData = aTexture.image.data as Uint8Array;
    const nData = nTexture.image.data as Uint8Array;
    expect(aData).toHaveLength(HI * HI * 4 * PBR_LAYER_COUNT);
    expect(nData).toHaveLength(HI * HI * 4 * PBR_LAYER_COUNT);
    for (let layer = 0; layer < PBR_LAYER_COUNT; layer++) {
      const a = sliceOf(aData, HI, layer);
      const n = sliceOf(nData, HI, layer);
      expect(a[0]).toBe(layer * 2);
      expect(a[AR_BYTES - 1]).toBe(layer * 2);
      expect(n[0]).toBe(layer * 2 + 1);
      expect(n[AR_BYTES - 1]).toBe(layer * 2 + 1);
    }
    lib.dispose();
  });

  it('disposes each old texture once when swapping in the full arrays', async () => {
    const lib = createPbrLibrary('high', '/kherson/', fakeDeps());
    const aTexture = lib.uniforms.uPbrA.value;
    const nTexture = lib.uniforms.uPbrN.value;
    const aDispose = vi.spyOn(aTexture, 'dispose');
    const nDispose = vi.spyOn(nTexture, 'dispose');

    await expect(lib.ready).resolves.toBe(true);
    expect(aDispose).toHaveBeenCalledTimes(1);
    expect(nDispose).toHaveBeenCalledTimes(1);
    expect(lib.uniforms.uPbrA.value).toBe(aTexture);
    expect(lib.uniforms.uPbrN.value).toBe(nTexture);
    lib.dispose();
  });

  it('loads the low tier at 256 px', async () => {
    const lib = createPbrLibrary('low', '/kherson/', fakeDeps());
    await expect(lib.ready).resolves.toBe(true);
    expect(lib.uniforms.uPbrA.value.image.width).toBe(LO);
    expect((lib.uniforms.uPbrA.value.image.data as Uint8Array)).toHaveLength(LO * LO * 4 * PBR_LAYER_COUNT);
    lib.dispose();
  });

  it('keeps a failed layer neutral, loads the rest, warns once and resolves false', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failedLayer = 5;
    const failedUrl = `${PBR_LAYER_NAMES[failedLayer]}_n.webp`;
    const deps = fakeDeps();
    const base = deps.fetchBytes;
    deps.fetchBytes = async (url) => {
      if (url.includes(failedUrl)) throw new Error('404');
      return base(url);
    };

    const lib = createPbrLibrary('high', '/kherson/', deps);
    await expect(lib.ready).resolves.toBe(false);
    expect(lib.loaded()).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);

    const aData = lib.uniforms.uPbrA.value.image.data as Uint8Array;
    const nData = lib.uniforms.uPbrN.value.image.data as Uint8Array;
    const neutral = neutralLayer(HI);
    expect(sliceOf(aData, HI, failedLayer)).toEqual(neutral.a);
    expect(sliceOf(nData, HI, failedLayer)).toEqual(neutral.n);

    const neighbour = failedLayer + 1;
    expect(sliceOf(aData, HI, neighbour)[0]).toBe(neighbour * 2);
    expect(sliceOf(nData, HI, neighbour)[0]).toBe(neighbour * 2 + 1);
    expect(lib.uniforms.uPbrA.value.image.depth).toBe(PBR_LAYER_COUNT);
    lib.dispose();
  });

  it('fetches at most six files at a time', async () => {
    let active = 0;
    let peak = 0;
    let fetches = 0;
    const lib = createPbrLibrary('low', '/kherson/', {
      async fetchBytes() {
        fetches++;
        active++;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 2));
        active--;
        return new ArrayBuffer(0);
      },
      async decode(_bytes, size) {
        return new Uint8Array(size * size * 4);
      },
    });

    await expect(lib.ready).resolves.toBe(true);
    expect(fetches).toBe(PBR_LAYER_COUNT * 2);
    expect(peak).toBeLessThanOrEqual(6);
    expect(peak).toBeGreaterThan(1);
    lib.dispose();
  });
});

describe('PBR GLSL chunk', () => {
  const count = (text: string, char: string): number => {
    let n = 0;
    for (const c of text) if (c === char) n++;
    return n;
  };

  it('declares the sampler arrays with one tile per layer', () => {
    expect(PBR_PARS).toContain('precision highp sampler2DArray;');
    expect(PBR_PARS).toContain('uniform sampler2DArray uPbrA;');
    expect(PBR_PARS).toContain('uniform sampler2DArray uPbrN;');
    expect(PBR_PARS).toContain(`uniform float uPbrTile[${PBR_LAYER_COUNT}];`);
    expect(PBR_PARS).toContain('struct PbrSample');
  });

  it('defines every advertised function with balanced braces and parentheses', () => {
    expect(PBR_GLSL_FUNCS.length).toBeGreaterThanOrEqual(4);
    for (const name of PBR_GLSL_FUNCS) {
      expect(PBR_PARS, name).toContain(`${name}(`);
    }
    expect(PBR_GLSL_FUNCS).toEqual(
      expect.arrayContaining(['pbrSample', 'pbrPerturb', 'pbrWallBasis', 'pbrGroundBasis']),
    );
    expect(count(PBR_PARS, '{')).toBe(count(PBR_PARS, '}'));
    expect(count(PBR_PARS, '(')).toBe(count(PBR_PARS, ')'));
  });

  it('follows the decode, anti-tiling and distance-fade contract', () => {
    expect(PBR_PARS).toContain('textureGrad(');
    expect(PBR_PARS).toContain('albedo.rgb * 2.0');
    expect(PBR_PARS).toContain('nA.rg * 2.0 - 1.0');
    expect(PBR_PARS).toContain('nB.rg * 2.0 - 1.0');
    expect(PBR_PARS).toContain('sqrt(max(0.0, 1.0 - dot(nxy, nxy)))');
    expect(PBR_PARS).toContain('pbrValueNoise(uv * 0.25) * 8.0');
    expect(PBR_PARS).toContain('smoothstep(0.2, 0.8');
    expect(PBR_PARS).toContain('smoothstep(250.0, 400.0, dist)');
    expect(PBR_PARS).toContain('uPbrTile[layerIndex]');
  });
});

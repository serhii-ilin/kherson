/**
 * Runtime PBR material library (docs/adr/0002-realistic-buildings.md). Loads the CC0 WebP textures of every
 * layer into two `DataArrayTexture`s shared by the building, roof and ground shaders: albedo with ambient
 * occlusion baked in (`_a`) and normal + roughness (`_n`). Nothing here runs per frame; shaders inject `PBR_PARS`.
 *
 * The library starts with tiny neutral arrays so a material can be created before the download finishes,
 * then swaps in the full arrays once, keeping the same uniform and texture objects.
 */
import * as THREE from 'three';
import type { Quality } from '../quality.ts';
import { PBR_LAYER_COUNT, PBR_LAYER_NAMES, PBR_TILE_M } from './pbr-layers.ts';
import { versioned } from '../version.ts';
import type { PbrDecodeRequest, PbrDecodeResponse } from './pbr-decode.worker.ts';

/** Texture edge length per quality tier. */
export const PBR_SIZE: Record<Quality, number> = { high: 512, low: 256 };

/** Neutral placeholder edge length: 4×4×20 costs almost no GPU memory before the real arrays arrive. */
const PLACEHOLDER_SIZE = 4;

export interface PbrUniforms {
  uPbrA: { value: THREE.DataArrayTexture };
  uPbrN: { value: THREE.DataArrayTexture };
  uPbrTile: { value: Float32Array };
}

export interface PbrLibrary {
  /** Stable objects: share them into any ShaderMaterial/onBeforeCompile. */
  readonly uniforms: PbrUniforms;
  /** True when every layer loaded, false if any failed (those layers stay neutral). */
  readonly ready: Promise<boolean>;
  loaded(): boolean;
  dispose(): void;
}

export interface PbrLoaderDeps {
  fetchBytes(url: string): Promise<ArrayBuffer>;
  decode(bytes: ArrayBuffer, size: number): Promise<Uint8Array>;
}

interface LayerBytes {
  a: Uint8Array;
  n: Uint8Array;
}

function assetDir(quality: Quality): 'hi' | 'lo' {
  return quality === 'high' ? 'hi' : 'lo';
}

/** Asset URLs per layer in index order. Pure: no fetch, no globals besides the deploy id in `versioned`. */
export function pbrAssetUrls(quality: Quality, base: string): { layer: number; a: string; n: string }[] {
  const root = base.endsWith('/') ? base : `${base}/`;
  const dir = assetDir(quality);
  const urls: { layer: number; a: string; n: string }[] = [];
  for (let layer = 0; layer < PBR_LAYER_COUNT; layer++) {
    const stem = PBR_LAYER_NAMES[layer]!;
    const folder = `${root}assets/materials/${dir}/${stem}`;
    urls.push({ layer, a: versioned(`${folder}_a.webp`), n: versioned(`${folder}_n.webp`) });
  }
  return urls;
}

/**
 * One RGBA texel per pixel of a neutral layer: albedo 128 (×2 = 1), roughness 230, flat normal xy 128.
 * The asset files have no alpha, but the texture arrays stay RGBA8, so alpha is 255.
 */
export function neutralLayer(size: number): { a: Uint8Array; n: Uint8Array } {
  const pixels = size * size;
  const a = new Uint8Array(pixels * 4);
  const n = new Uint8Array(pixels * 4);
  for (let i = 0; i < pixels; i++) {
    const o = i * 4;
    a[o] = 128;
    a[o + 1] = 128;
    a[o + 2] = 128;
    a[o + 3] = 255;
    n[o] = 128;
    n[o + 1] = 128;
    n[o + 2] = 230;
    n[o + 3] = 255;
  }
  return { a, n };
}

/** Concatenate one RGBA slice per layer in index order; a null or missing layer becomes neutral. */
export function assembleLayers(
  size: number,
  layers: readonly (LayerBytes | null)[],
): { a: Uint8Array; n: Uint8Array } {
  const slice = size * size * 4;
  const a = new Uint8Array(PBR_LAYER_COUNT * slice);
  const n = new Uint8Array(PBR_LAYER_COUNT * slice);
  const neutral = neutralLayer(size);
  for (let layer = 0; layer < PBR_LAYER_COUNT; layer++) {
    const bytes = layers[layer] ?? null;
    if (bytes === null) {
      a.set(neutral.a, layer * slice);
      n.set(neutral.n, layer * slice);
      continue;
    }
    if (bytes.a.length !== slice || bytes.n.length !== slice) {
      throw new Error(`PBR layer ${layer} has ${bytes.a.length}/${bytes.n.length} bytes, expected ${slice}`);
    }
    a.set(bytes.a, layer * slice);
    n.set(bytes.n, layer * slice);
  }
  return { a, n };
}

async function fetchPbrBytes(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`PBR asset ${response.status} ${response.statusText}: ${url}`);
  return response.arrayBuffer();
}

interface DecodeWorker {
  decode(bytes: ArrayBuffer, size: number): Promise<Uint8Array>;
  dispose(): void;
}

/** Lazily creates the one shared decode worker; `dispose()` terminates it and rejects anything still queued. */
function createDecodeWorker(): DecodeWorker {
  let worker: Worker | null = null;
  let nextId = 1;
  let disposed = false;
  const pending = new Map<number, { resolve(data: Uint8Array): void; reject(reason: unknown): void }>();

  const failAll = (reason: unknown): void => {
    for (const entry of pending.values()) entry.reject(reason);
    pending.clear();
  };

  const ensure = (): Worker => {
    if (worker) return worker;
    const created = new Worker(new URL('./pbr-decode.worker.ts', import.meta.url), { type: 'module' });
    created.onmessage = (event: MessageEvent<PbrDecodeResponse>) => {
      const { id, data, error } = event.data;
      const entry = pending.get(id);
      if (!entry) return;
      pending.delete(id);
      if (data) entry.resolve(data);
      else entry.reject(new Error(error ?? 'PBR decode failed'));
    };
    created.onerror = (event: ErrorEvent) => {
      failAll(new Error(event.message || 'PBR decode worker failed'));
    };
    created.onmessageerror = () => {
      failAll(new Error('PBR decode worker message could not be decoded'));
      created.terminate();
      if (worker === created) worker = null;
    };
    worker = created;
    return created;
  };

  return {
    decode(bytes, size) {
      if (disposed) return Promise.reject(new Error('PBR decode worker disposed'));
      const target = ensure();
      const id = nextId++;
      return new Promise<Uint8Array>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        target.postMessage({ id, bytes, size } satisfies PbrDecodeRequest, [bytes]);
      });
    },
    dispose() {
      disposed = true;
      worker?.terminate();
      worker = null;
      failAll(new Error('PBR decode worker disposed'));
    },
  };
}

function makeArrayTexture(data: Uint8Array, size: number): THREE.DataArrayTexture {
  const texture = new THREE.DataArrayTexture(data, size, size, PBR_LAYER_COUNT);
  texture.colorSpace = THREE.LinearSRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

/** Replace the whole array image without replacing the texture or uniform objects. */
function swapArrayImage(texture: THREE.DataArrayTexture, data: Uint8Array, size: number): void {
  // A WebGL2 texture allocates immutable storage on its first upload, so a 4×4 placeholder cannot grow
  // via texSubImage3D. Disposing makes the renderer drop that storage; the next use reallocates it at the
  // full size because the image below has changed. The THREE.Texture and uniform objects stay the same.
  texture.dispose();
  texture.image = { data, width: size, height: size, depth: PBR_LAYER_COUNT };
  texture.needsUpdate = true;
}

/**
 * Create the library and start loading immediately. The returned uniforms and textures never change
 * identity, so a shader may keep references while `ready` is pending.
 */
export function createPbrLibrary(quality: Quality, base: string, deps?: PbrLoaderDeps): PbrLibrary {
  const size = PBR_SIZE[quality];
  const placeholder = assembleLayers(PLACEHOLDER_SIZE, []);
  const aTexture = makeArrayTexture(placeholder.a, PLACEHOLDER_SIZE);
  const nTexture = makeArrayTexture(placeholder.n, PLACEHOLDER_SIZE);
  aTexture.anisotropy = 4;

  const uniforms: PbrUniforms = {
    uPbrA: { value: aTexture },
    uPbrN: { value: nTexture },
    uPbrTile: { value: new Float32Array(PBR_TILE_M) },
  };

  const decoder = deps ? null : createDecodeWorker();
  const io: PbrLoaderDeps = deps ?? {
    fetchBytes: fetchPbrBytes,
    decode: (bytes, edge) => decoder!.decode(bytes, edge),
  };

  let allLoaded = false;
  let disposed = false;

  const load = async (): Promise<boolean> => {
    const urls = pbrAssetUrls(quality, base);
    const a: (Uint8Array | null)[] = new Array(PBR_LAYER_COUNT).fill(null);
    const n: (Uint8Array | null)[] = new Array(PBR_LAYER_COUNT).fill(null);
    const failed: string[] = [];
    const expected = size * size * 4;

    const tasks: (() => Promise<void>)[] = [];
    const add = (layer: number, kind: 'a' | 'n', url: string): void => {
      tasks.push(async () => {
        try {
          const encoded = await io.fetchBytes(url);
          const decoded = await io.decode(encoded, size);
          if (decoded.length !== expected) {
            throw new Error(`decoded ${decoded.length} bytes, expected ${expected}`);
          }
          if (kind === 'a') a[layer] = decoded;
          else n[layer] = decoded;
        } catch {
          failed.push(url);
        }
      });
    };
    for (const entry of urls) {
      add(entry.layer, 'a', entry.a);
      add(entry.layer, 'n', entry.n);
    }

    let next = 0;
    const runner = async (): Promise<void> => {
      for (;;) {
        const index = next++;
        if (index >= tasks.length) return;
        await tasks[index]!();
      }
    };
    await Promise.all(Array.from({ length: Math.min(6, tasks.length) }, runner));

    decoder?.dispose();
    if (disposed) return false;

    if (failed.length > 0) {
      const layers = [...new Set(failed.map((url) => {
        const name = url.slice(url.lastIndexOf('/') + 1);
        return PBR_LAYER_NAMES.findIndex((stem) =>
          name.startsWith(`${stem}_a.webp`) || name.startsWith(`${stem}_n.webp`));
      }))].filter((layer) => layer >= 0);
      console.warn(
        `PBR material library: ${failed.length} of ${tasks.length} files failed; ` +
        `layers ${layers.join(', ')} stay neutral`,
      );
    }

    const layers = Array.from({ length: PBR_LAYER_COUNT }, (_, layer): LayerBytes | null => {
      const albedo = a[layer] ?? null;
      const normal = n[layer] ?? null;
      return albedo !== null && normal !== null ? { a: albedo, n: normal } : null;
    });
    const assembled = assembleLayers(size, layers);
    swapArrayImage(aTexture, assembled.a, size);
    swapArrayImage(nTexture, assembled.n, size);

    allLoaded = failed.length === 0;
    return allLoaded;
  };

  const ready = load();

  return {
    uniforms,
    ready,
    loaded: () => allLoaded,
    dispose: () => {
      disposed = true;
      decoder?.dispose();
      aTexture.dispose();
      nTexture.dispose();
    },
  };
}

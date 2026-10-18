import { decodeVectorTile, type VectorTile } from '../world/vector-format.ts';
import { generateBlockChunk, generateFineChunk, type BlockMesh } from './generate.ts';
import type { FineMesh } from './mesh.ts';

/** One vector tile of a job: `data` carries bytes the worker may not have cached yet. */
export interface TileRef {
  key: number;
  rx: number;
  rz: number;
  /** 'none': the region has no tile (404); 'cached': worker should have it; 'data': bytes follow. */
  kind: 'none' | 'cached' | 'data';
  buffer?: ArrayBuffer;
}

export interface FineRequest {
  id: number;
  /** 'blocks' generates the 1 m building/bridge blocks (from `win`), otherwise the 0.2 m ground (from `patch`). */
  kind?: 'blocks';
  gcx: number;
  gcz: number;
  patch: Uint8Array;
  /** Coarse window for the block tier (see block-input.ts). */
  win?: Uint8Array;
  tiles: TileRef[];
}

export interface FineResponse {
  id: number;
  /** Keys of 'cached' tiles this worker no longer holds; the streamer resends them with data. */
  missing?: number[];
  mesh?: FineMesh;
  blocks?: BlockMesh;
  error?: string;
}

interface WorkerScope {
  onmessage: ((e: MessageEvent<FineRequest>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;
const CACHE_MAX = 24;
/** Map iteration order doubles as LRU order (oldest first). */
const cache = new Map<number, VectorTile>();

scope.onmessage = (e) => {
  const { id, kind, gcx, gcz, patch, win, tiles } = e.data;
  const missing: number[] = [];
  const decoded: VectorTile[] = [];
  try {
    for (const t of tiles) {
      if (t.kind === 'none') continue;
      let tile = cache.get(t.key);
      if (tile !== undefined) {
        cache.delete(t.key);
        cache.set(t.key, tile);
      } else if (t.kind === 'data' && t.buffer !== undefined) {
        tile = decodeVectorTile(t.buffer);
        cache.set(t.key, tile);
        if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
      } else {
        missing.push(t.key);
        continue;
      }
      decoded.push(tile);
    }
    if (missing.length > 0) {
      scope.postMessage({ id, missing } satisfies FineResponse);
      return;
    }
    if (kind === 'blocks') {
      const blocks = generateBlockChunk({ gcx, gcz, win: win!, tiles: decoded });
      scope.postMessage({ id, blocks } satisfies FineResponse, [
        blocks.positions.buffer,
        blocks.normals.buffer,
        blocks.colors.buffer,
        blocks.walls.buffer,
        blocks.indices.buffer,
        blocks.tops.buffer,
        ...(blocks.signs !== undefined ? [blocks.signs.data.buffer] : []),
      ]);
      return;
    }
    const mesh = generateFineChunk({ gcx, gcz, patch, tiles: decoded });
    scope.postMessage({ id, mesh } satisfies FineResponse, [
      mesh.positions.buffer,
      mesh.normals.buffer,
      mesh.colors.buffer,
      mesh.walls.buffer,
      mesh.indices.buffer,
      mesh.raster.buffer,
    ]);
  } catch (err) {
    scope.postMessage({ id, error: String(err) } satisfies FineResponse);
  }
};

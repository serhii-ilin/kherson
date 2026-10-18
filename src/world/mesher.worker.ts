import { decodeRegion, type RegionData } from './format.ts';
import { meshChunk, type ChunkMeshResult, type RegionEdges } from './mesher.ts';

/** Job from the streamer. `buffer` is present only when the worker may not have the region yet. */
export interface MeshRequest {
  id: number;
  /** Region cache key chosen by the streamer. */
  region: number;
  buffer?: ArrayBuffer;
  /** Chunk coordinates inside the region, 0..REGION_CHUNKS-1. */
  cx: number;
  cz: number;
  edges?: RegionEdges;
}

export interface MeshResponse {
  id: number;
  /** True when the region is not cached here; the streamer must resend with the buffer. */
  missing?: boolean;
  mesh?: ChunkMeshResult;
}

interface WorkerScope {
  onmessage: ((e: MessageEvent<MeshRequest>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;
const CACHE_MAX = 8;
/** Map iteration order doubles as LRU order (oldest first). */
const cache = new Map<number, RegionData>();

scope.onmessage = (e) => {
  const { id, region, buffer, cx, cz, edges } = e.data;
  let data = cache.get(region);
  if (data) {
    cache.delete(region);
    cache.set(region, data);
  } else if (buffer) {
    data = decodeRegion(buffer);
    cache.set(region, data);
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
  } else {
    scope.postMessage({ id, missing: true } satisfies MeshResponse);
    return;
  }
  const mesh = meshChunk(data, cx, cz, edges);
  scope.postMessage({ id, mesh } satisfies MeshResponse, [
    mesh.positions.buffer,
    mesh.normals.buffer,
    mesh.colors.buffer,
    mesh.walls.buffer,
    mesh.indices.buffer,
    ...(mesh.water ? [mesh.water.positions.buffer, mesh.water.shore.buffer, mesh.water.indices.buffer] : []),
  ]);
};

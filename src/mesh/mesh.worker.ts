import { decodeVectorTile, type VectorTile } from '../world/vector-format.ts';
import { buildChunkMesh, groundAtFromGrid } from './chunk.ts';
import type { CityMeshRequest, CityMeshResponse, MeshTileRef } from './protocol.ts';

interface WorkerScope {
  onmessage: ((e: MessageEvent<CityMeshRequest>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;
const CACHE_MAX = 24;
const cache = new Map<number, VectorTile>();

function remember(key: number, tile: VectorTile): void {
  cache.delete(key);
  cache.set(key, tile);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
}

scope.onmessage = (e) => {
  const { id, gcx, gcz, ground, tiles } = e.data;
  const missing: number[] = [];
  const decoded: VectorTile[] = [];
  try {
    for (const t of tiles) {
      const tile = take(t, missing);
      if (tile !== null) decoded.push(tile);
    }
    if (missing.length > 0) {
      scope.postMessage({ id, missing } satisfies CityMeshResponse);
      return;
    }
    const mesh = buildChunkMesh(decoded, gcx, gcz, groundAtFromGrid(gcx, gcz, ground));
    const transfer: Transferable[] = [];
    if (mesh.indices.length > 0) {
      transfer.push(
        mesh.positions.buffer, mesh.normals.buffer, mesh.uvs.buffer, mesh.colors.buffer,
        mesh.facade.buffer, mesh.style.buffer, mesh.indices.buffer,
      );
    }
    scope.postMessage({
      id,
      positions: mesh.positions,
      normals: mesh.normals,
      uvs: mesh.uvs,
      colors: mesh.colors,
      facade: mesh.facade,
      style: mesh.style,
      indices: mesh.indices,
    } satisfies CityMeshResponse, transfer);
  } catch (err) {
    scope.postMessage({ id, error: String(err) } satisfies CityMeshResponse);
  }
};

function take(t: MeshTileRef, missing: number[]): VectorTile | null {
  if (t.kind === 'none') return null;
  let tile = cache.get(t.key);
  if (tile !== undefined) {
    remember(t.key, tile);
    return tile;
  }
  if (t.kind === 'data' && t.buffer !== undefined) {
    tile = decodeVectorTile(t.buffer);
    remember(t.key, tile);
    return tile;
  }
  missing.push(t.key);
  return null;
}

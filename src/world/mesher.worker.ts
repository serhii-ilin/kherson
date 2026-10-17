import { decodeRegion, type RegionData } from './format.ts';
import { meshChunk, type ChunkMesh } from './mesher.ts';

interface MeshRequest {
  id: number;
  buffer: ArrayBuffer;
  cx: number;
  cz: number;
}

interface WorkerScope {
  onmessage: ((e: MessageEvent<MeshRequest>) => void) | null;
  postMessage(message: unknown, transfer: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;

let cached: RegionData | null = null;
let cachedKey = '';

scope.onmessage = (e) => {
  const { id, buffer, cx, cz } = e.data;
  // Cache key is the header's rx/rz, read without a full decode when possible.
  const hdr = new DataView(buffer);
  const key = `${hdr.getInt16(6, true)},${hdr.getInt16(8, true)}`;
  if (cached === null || key !== cachedKey) {
    cached = decodeRegion(buffer);
    cachedKey = key;
  }
  const mesh: ChunkMesh = meshChunk(cached, cx, cz);
  scope.postMessage({ id, mesh }, [
    mesh.positions.buffer,
    mesh.normals.buffer,
    mesh.colors.buffer,
    mesh.indices.buffer,
  ]);
};

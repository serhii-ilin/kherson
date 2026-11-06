/** Messages between the mesh streamer and `mesh.worker.ts`. Tile bytes are copied, not transferred. */
import type { RoadMesh } from './roads.ts';

export interface MeshTileRef {
  key: number;
  rx: number;
  rz: number;
  kind: 'none' | 'cached' | 'data';
  buffer?: ArrayBuffer;
}

export interface CityMeshRequest {
  id: number;
  gcx: number;
  gcz: number;
  /** Coarse ground heights in voxels, `GW * GW`, origin at the chunk minus the block-window margin. */
  ground: Uint8Array;
  tiles: MeshTileRef[];
  /** Detail level; omitted means `mid` (the legacy shader-painted facade). */
  lod?: 'near' | 'mid';
}

/** Replaces the worker's hidden-building set; applies to every later chunk job. */
export interface CityMeshHidden {
  type: 'hidden';
  keys: string[];
}

export type MeshWorkerMessage = CityMeshRequest | CityMeshHidden;

export interface CityMeshResponse {
  id: number;
  missing?: number[];
  positions?: Float32Array;
  normals?: Float32Array;
  uvs?: Float32Array;
  colors?: Float32Array;
  facade?: Float32Array;
  style?: Float32Array;
  pbr?: Float32Array;
  indices?: Uint32Array;
  /** Smooth road ribbons for this chunk (same in both LODs), or undefined when it has no roads. */
  roads?: RoadMesh;
  error?: string;
}

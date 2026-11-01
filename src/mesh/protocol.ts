/** Messages between the mesh streamer and `mesh.worker.ts`. Tile bytes are copied, not transferred. */

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
}

export interface CityMeshResponse {
  id: number;
  missing?: number[];
  positions?: Float32Array;
  normals?: Float32Array;
  uvs?: Float32Array;
  colors?: Float32Array;
  facade?: Float32Array;
  style?: Float32Array;
  indices?: Uint32Array;
  error?: string;
}

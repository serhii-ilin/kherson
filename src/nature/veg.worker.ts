import { buildModel, type VegModel } from './models.ts';

export interface VegRequest {
  id: number;
  species: number;
  variant: number;
  lod: 0 | 1 | 2 | 3;
  /** Micro-voxel crowns. Absent or false builds the leaf-card model. */
  voxel?: boolean;
}

export interface VegResponse {
  id: number;
  model?: VegModel;
  error?: string;
}

interface WorkerScope {
  onmessage: ((e: MessageEvent<VegRequest>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = (e) => {
  const { id, species, variant, lod, voxel } = e.data;
  try {
    const model = buildModel(species, variant, lod, voxel === true);
    const transfer: Transferable[] = [
      model.positions.buffer as ArrayBuffer,
      model.normals.buffer as ArrayBuffer,
      model.colors.buffer as ArrayBuffer,
      model.sway.buffer as ArrayBuffer,
      model.indices.buffer as ArrayBuffer,
    ];
    if (model.leaf) transfer.push(model.leaf.buffer as ArrayBuffer);
    if (model.uvs) transfer.push(model.uvs.buffer as ArrayBuffer);
    scope.postMessage({ id, model } satisfies VegResponse, transfer);
  } catch (err) {
    scope.postMessage({ id, error: String(err) } satisfies VegResponse);
  }
};

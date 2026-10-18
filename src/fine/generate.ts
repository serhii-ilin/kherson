import { rasterizeGround, type FineInput } from './ground.ts';
import { meshFineGround, type FineMesh } from './mesh.ts';

/** Fine ground for one chunk: rasterise from coarse cells + vector tiles, then mesh. */
export function generateFineChunk(input: FineInput): FineMesh {
  return meshFineGround(rasterizeGround(input), input.patch);
}

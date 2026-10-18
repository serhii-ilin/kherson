import type { Bbox } from '../world/manifest.ts';
import { createFreedomSquare } from './freedom-square.ts';
import { createPier } from './pier.ts';
import type { Landmark } from './types.ts';

export { createFreedomSquare } from './freedom-square.ts';
export { createPier } from './pier.ts';
export type * from './types.ts';

export function createLandmarks(bbox: Bbox): Landmark[] {
  return [createFreedomSquare(bbox), createPier(bbox)];
}

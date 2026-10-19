import type { Bbox } from '../world/manifest.ts';
import { createFilatovaCourtyard } from './courtyard.ts';
import { createFreedomSquare } from './freedom-square.ts';
import { createPier } from './pier.ts';
import { createPortCranes } from './port-cranes.ts';
import type { Landmark } from './types.ts';

export { createFreedomSquare } from './freedom-square.ts';
export { createFilatovaCourtyard } from './courtyard.ts';
export { createPier } from './pier.ts';
export { createPortCranes } from './port-cranes.ts';
export type * from './types.ts';

export function createLandmarks(bbox: Bbox): Landmark[] {
  return [createFreedomSquare(bbox), createPier(bbox), createPortCranes(bbox), createFilatovaCourtyard(bbox)];
}

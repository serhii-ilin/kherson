import { DEFAULT_BBOX } from './geo.ts';
import { createLandmarks } from './index.ts';
import type { Bbox } from '../world/manifest.ts';
import type { LandmarkPropExclusion } from './types.ts';

export type ExclusionPolygon = readonly [number, number][];
export type PropExclusion = LandmarkPropExclusion;

/** Static worker-safe paving exclusions; landmark meshes are not built in the worker. */
export function getLandmarkExclusions(bbox: Bbox = DEFAULT_BBOX): PropExclusion[] {
  return createLandmarks(bbox).flatMap((landmark) => landmark.propExclusions ?? []);
}

/** Vegetation exclusions are deliberately narrow: the open hardscape is treeless, while the park
 * and avenue trees outside it remain part of the streamed OSM vegetation. */
export function getVegetationExclusions(bbox: Bbox = DEFAULT_BBOX): ExclusionPolygon[] {
  return createLandmarks(bbox).flatMap((landmark) => landmark.vegetationExclusions ?? []);
}


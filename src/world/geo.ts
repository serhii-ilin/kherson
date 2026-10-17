import type { Bbox } from './manifest.ts';

const M_PER_DEG_LAT = 110540;

/** World metres (x east, z south of the NW corner) to [lat, lon]; mirrors tools/bake/project.ts. */
export function toLatLon(bbox: Bbox, x: number, z: number): [number, number] {
  const latC = (bbox.south + bbox.north) / 2;
  const mPerDegLon = 111320 * Math.cos((latC * Math.PI) / 180);
  return [bbox.north - z / M_PER_DEG_LAT, x / mPerDegLon + bbox.west];
}

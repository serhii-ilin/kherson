import type { Bbox } from '../world/manifest.ts';

const M_PER_DEG_LAT = 110540;

/** Default project bounds, also used by the fine worker for static landmark exclusions. */
export const DEFAULT_BBOX: Bbox = { south: 46.58, west: 32.48, north: 46.72, east: 32.72 };

/** World metres (x east, z south of the NW corner) from a WGS84 latitude/longitude. */
export function fromLatLon(bbox: Bbox, lat: number, lon: number): { x: number; z: number } {
  const latC = (bbox.south + bbox.north) / 2;
  const mPerDegLon = 111320 * Math.cos((latC * Math.PI) / 180);
  return { x: (lon - bbox.west) * mPerDegLon, z: (bbox.north - lat) * M_PER_DEG_LAT };
}

/** Inverse of {@link fromLatLon}; kept in step with src/world/geo.ts. */
export function toLatLon(bbox: Bbox, x: number, z: number): [number, number] {
  const latC = (bbox.south + bbox.north) / 2;
  const mPerDegLon = 111320 * Math.cos((latC * Math.PI) / 180);
  return [bbox.north - z / M_PER_DEG_LAT, x / mPerDegLon + bbox.west];
}

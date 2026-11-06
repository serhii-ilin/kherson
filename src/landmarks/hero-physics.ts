import { pointInPolygon, type LandmarkSurface } from './types.ts';

/**
 * Solid collision volume for a hero landmark that replaces an OSM building: the footprint polygon extruded from
 * `yBase` to `yTop`. It is never walkable, and it blocks only while the body actually overlaps that height
 * range, so a walker can pass under a bridge-like deck and stand on a roof surface above it.
 */
export function prismSurface(
  polygon: readonly [number, number][],
  yBase: number,
  yTop: number,
): LandmarkSurface {
  return {
    heightAt: () => null,
    blockedAt(x: number, z: number, y: number, bodyH = 1.7): boolean {
      if (y >= yTop || y + bodyH <= yBase) return false;
      return pointInPolygon(polygon, x, z);
    },
  };
}

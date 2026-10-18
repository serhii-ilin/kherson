import { fillPolygon, type Pt } from "./rasterize.ts";
import type { Tags } from "./osm.ts";

// Pure helpers for limiting the world to the city boundary (see CITY_RELATION in config.ts).
// Coordinates are in cell units, same grid as the bake.

export class CityMask {
  readonly cellsX: number;
  readonly cellsZ: number;
  readonly bits: Uint8Array;
  constructor(cellsX: number, cellsZ: number) {
    this.cellsX = cellsX;
    this.cellsZ = cellsZ;
    this.bits = new Uint8Array(cellsX * cellsZ);
  }
  hasCell(cx: number, cz: number): boolean {
    return cx >= 0 && cz >= 0 && cx < this.cellsX && cz < this.cellsZ && this.bits[cz * this.cellsX + cx] === 1;
  }
  /** Point in cell units (fractional). */
  hasPoint(x: number, z: number): boolean {
    return this.hasCell(Math.floor(x), Math.floor(z));
  }
}

/** Rasterise the boundary rings (even-odd) and grow the result by `dilateCells` (round structuring element). */
export function buildCityMask(rings: readonly (readonly Pt[])[], cellsX: number, cellsZ: number, dilateCells: number): CityMask {
  const m = new CityMask(cellsX, cellsZ);
  fillPolygon(rings, (cx, cz) => {
    if (cx >= 0 && cz >= 0 && cx < cellsX && cz < cellsZ) m.bits[cz * cellsX + cx] = 1;
  });
  if (dilateCells <= 0) return m;
  const src = m.bits.slice();
  const at = (x: number, z: number): boolean => x >= 0 && z >= 0 && x < cellsX && z < cellsZ && src[z * cellsX + x] === 1;
  const r2 = dilateCells * dilateCells;
  const R = Math.ceil(dilateCells);
  for (let cz = 0; cz < cellsZ; cz++) {
    for (let cx = 0; cx < cellsX; cx++) {
      if (!at(cx, cz)) continue;
      // only boundary cells need to stamp the disc
      if (at(cx - 1, cz) && at(cx + 1, cz) && at(cx, cz - 1) && at(cx, cz + 1)) continue;
      for (let dz = -R; dz <= R; dz++) {
        const z = cz + dz;
        if (z < 0 || z >= cellsZ) continue;
        for (let dx = -R; dx <= R; dx++) {
          const x = cx + dx;
          if (x < 0 || x >= cellsX || dx * dx + dz * dz > r2) continue;
          m.bits[z * cellsX + x] = 1;
        }
      }
    }
  }
  return m;
}

/**
 * Ground areas (see groundClass) that are natural land cover and so stay outside the city:
 * forest, wood, scrub, sand and beach. Everything else (industrial, parks, plazas, ...) is dropped there.
 */
export function keepOutsideGround(t: Tags): boolean {
  return t.landuse === "forest" || t.natural === "wood" || t.natural === "scrub" || t.natural === "beach" || t.natural === "sand";
}

/** Mean of the ring vertices, the building anchor used for the in/out decision. */
export function ringCentroid(r: readonly Pt[]): Pt {
  let sx = 0, sz = 0;
  for (const p of r) { sx += p[0]; sz += p[1]; }
  return [sx / r.length, sz / r.length];
}

/** True if any vertex of the ring lies inside the mask. */
export function ringTouchesMask(mask: CityMask, r: readonly Pt[]): boolean {
  for (const p of r) if (mask.hasPoint(p[0], p[1])) return true;
  return false;
}

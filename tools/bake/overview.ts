import {
  F_GROUND_H,
  F_GROUND_MAT,
  F_ROOF_MAT,
  F_STRUCT_H,
  F_STRUCT_MAT,
  REGION,
} from "../../src/world/constants.ts";
import { MAT } from "../../src/world/materials.ts";

export const OVERVIEW_BLOCK = 8; // cells per block side (16 m)
const BLOCKS = REGION / OVERVIEW_BLOCK; // blocks per region side
const PLANE = REGION * REGION;
/** A block counts as built-up when at least this many of its 64 cells carry a structure. */
const STRUCT_MIN = 12;

/**
 * Builds overview.bin: u16 w, u16 h (little endian) then w*h*3 bytes, row-major (z, then x):
 * dominant groundMat, top height in voxels, top material.
 * Built-up blocks use the tallest structure and the dominant roof material; other blocks use
 * the highest ground and the dominant ground material, so lone houses do not become spikes.
 */
export function buildOverview(
  regions: Map<number, Uint8Array>,
  regionsX: number,
  regionsZ: number,
  defaultCells: Uint8Array,
): Uint8Array {
  const w = regionsX * BLOCKS;
  const h = regionsZ * BLOCKS;
  const out = new Uint8Array(4 + w * h * 3);
  const dv = new DataView(out.buffer);
  dv.setUint16(0, w, true);
  dv.setUint16(2, h, true);
  const cnt = new Uint16Array(256);
  const cntTop = new Uint16Array(256);

  for (let rz = 0; rz < regionsZ; rz++) {
    for (let rx = 0; rx < regionsX; rx++) {
      const cells = regions.get(rx * 65536 + rz) ?? defaultCells;
      for (let bz = 0; bz < BLOCKS; bz++) {
        for (let bx = 0; bx < BLOCKS; bx++) {
          cnt.fill(0);
          cntTop.fill(0);
          let structCells = 0;
          let maxGround = 0;
          let maxTop = 0;
          for (let dz = 0; dz < OVERVIEW_BLOCK; dz++) {
            for (let dx = 0; dx < OVERVIEW_BLOCK; dx++) {
              const i = (bz * OVERVIEW_BLOCK + dz) * REGION + bx * OVERVIEW_BLOCK + dx;
              const gm = cells[F_GROUND_MAT * PLANE + i]!;
              const gh = cells[F_GROUND_H * PLANE + i]!;
              const sh = cells[F_STRUCT_H * PLANE + i]!;
              cnt[gm]!++;
              if (gh > maxGround) maxGround = gh;
              if (sh > 0) {
                structCells++;
                const m = cells[F_ROOF_MAT * PLANE + i]! || (cells[F_STRUCT_MAT * PLANE + i]! & 63) || gm;
                cntTop[m]!++;
                if (gh + sh > maxTop) maxTop = gh + sh;
              }
            }
          }
          let groundMat: number = MAT.GRASS;
          let best = -1;
          for (let m = 0; m < 256; m++) if (cnt[m]! > best) { best = cnt[m]!; groundMat = m; }
          let topMat = groundMat;
          let top = maxGround;
          if (structCells >= STRUCT_MIN) {
            best = -1;
            for (let m = 0; m < 256; m++) if (cntTop[m]! > best) { best = cntTop[m]!; topMat = m; }
            top = Math.min(255, maxTop);
          }
          const o = 4 + ((rz * BLOCKS + bz) * w + rx * BLOCKS + bx) * 3;
          out[o] = groundMat;
          out[o + 1] = top;
          out[o + 2] = topMat;
        }
      }
    }
  }
  return out;
}

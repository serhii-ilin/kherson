/**
 * Coarse-cell window the fine generator works from: the 32x32 coarse cells of a chunk plus a
 * one-cell ring (for seams, fill materials and contact AO). Three byte planes: ground material,
 * ground height (voxels), structure height (voxels).
 */
import { CHUNK, F_GROUND_H, F_GROUND_MAT, F_STRUCT_H, REGION } from '../world/constants.ts';
import type { RegionData } from '../world/format.ts';
import { MAT } from '../world/materials.ts';

export const PATCH_W = CHUNK + 2;
export const PATCH_PLANE = PATCH_W * PATCH_W;
export const P_MAT = 0;
export const P_GH = 1;
export const P_SH = 2;
/** Defaults of an all-empty region (see streamer: DEFAULT_GROUND_H). */
const EMPTY_GROUND_H = 2;
const REGION_PLANE = REGION * REGION;

/**
 * Builds the window for global chunk (gcx, gcz). `getRegion` returns the decoded region, `null`
 * for an all-default region, or `undefined` when it is not available (the call then returns null).
 * Cells outside the world repeat the nearest edge cell, like the coarse mesher (no wall there).
 */
export function buildPatch(
  gcx: number, gcz: number, regionsX: number, regionsZ: number,
  getRegion: (rx: number, rz: number) => RegionData | null | undefined,
): Uint8Array | null {
  const out = new Uint8Array(3 * PATCH_PLANE);
  const maxX = regionsX * REGION - 1;
  const maxZ = regionsZ * REGION - 1;
  let lastRx = -1, lastRz = -1;
  let region: RegionData | null | undefined;
  for (let pz = 0; pz < PATCH_W; pz++) {
    const cz = Math.min(maxZ, Math.max(0, gcz * CHUNK - 1 + pz));
    const rz = Math.floor(cz / REGION);
    const lz = cz - rz * REGION;
    for (let px = 0; px < PATCH_W; px++) {
      const cx = Math.min(maxX, Math.max(0, gcx * CHUNK - 1 + px));
      const rx = Math.floor(cx / REGION);
      if (rx !== lastRx || rz !== lastRz) {
        region = getRegion(rx, rz);
        if (region === undefined) return null;
        lastRx = rx;
        lastRz = rz;
      }
      const o = pz * PATCH_W + px;
      if (region === null || region === undefined) {
        out[P_MAT * PATCH_PLANE + o] = MAT.GRASS;
        out[P_GH * PATCH_PLANE + o] = EMPTY_GROUND_H;
        out[P_SH * PATCH_PLANE + o] = 0;
      } else {
        const i = lz * REGION + (cx - rx * REGION);
        out[P_MAT * PATCH_PLANE + o] = region.cells[REGION_PLANE * F_GROUND_MAT + i]!;
        out[P_GH * PATCH_PLANE + o] = region.cells[REGION_PLANE * F_GROUND_H + i]!;
        out[P_SH * PATCH_PLANE + o] = region.cells[REGION_PLANE * F_STRUCT_H + i]!;
      }
    }
  }
  return out;
}

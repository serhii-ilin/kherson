import { describe, expect, it } from 'vitest';
import { FIELDS, REGION } from '../src/world/constants';
import { cellIndex, type RegionData } from '../src/world/format';
import { MAT } from '../src/world/materials';
import { PATCH_PLANE, PATCH_W, P_GH, P_MAT, P_SH, buildPatch } from '../src/fine/patch';

function region(rx: number, rz: number, gh: number): RegionData {
  const cells = new Uint8Array(FIELDS * REGION * REGION);
  cells.fill(MAT.GRASS, 0, REGION * REGION);
  cells.fill(gh, REGION * REGION, 2 * REGION * REGION);
  cells[cellIndex(2, 0, 0)] = 7; // structure in this region's NW cell
  return { rx, rz, cells, features: [] };
}

describe('buildPatch', () => {
  it('reads the chunk plus a one-cell ring across region borders', () => {
    // chunk (7, 0) is the last chunk of region (0, 0) in x
    const regions = new Map<string, RegionData | null>([['0,0', region(0, 0, 3)], ['1,0', region(1, 0, 5)]]);
    const p = buildPatch(7, 0, 2, 1, (rx, rz) => (rx === 0 && rz === 0 ? regions.get('0,0') : rx === 1 ? regions.get('1,0') : undefined))!;
    expect(p[P_GH * PATCH_PLANE + 1 * PATCH_W + 1]).toBe(3);
    expect(p[P_GH * PATCH_PLANE + 1 * PATCH_W + 33]).toBe(5); // ring cell inside region (1, 0)
    expect(p[P_SH * PATCH_PLANE + 1 * PATCH_W + 33]).toBe(7); // its NW cell
    expect(p[P_MAT * PATCH_PLANE + 1 * PATCH_W + 33]).toBe(MAT.GRASS);
    // above the world: repeats the edge row
    expect(p[P_GH * PATCH_PLANE + 0 * PATCH_W + 1]).toBe(3);
  });

  it('returns null while a needed region is unavailable and defaults for empty regions', () => {
    expect(buildPatch(7, 0, 2, 1, (rx) => (rx === 0 ? region(0, 0, 3) : undefined))).toBeNull();
    const p = buildPatch(0, 0, 1, 1, () => null)!;
    expect(p[P_GH * PATCH_PLANE + 5 * PATCH_W + 5]).toBe(2);
    expect(p[P_MAT * PATCH_PLANE + 5 * PATCH_W + 5]).toBe(MAT.GRASS);
  });
});

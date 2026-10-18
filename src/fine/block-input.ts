/**
 * Coarse-world window the block generator works from: the chunk's 32x32 coarse cells plus a ring of
 * GM cells (96 m), as three byte planes: ground height (voxels), ground material, bridge-deck top
 * (voxels, 0 = none). The margin lets every chunk sample the ground over whole buildings, so all the
 * chunks that see a building agree on its base level (up to buildings reaching past the margin).
 */
import { CHUNK, F_GROUND_H, F_GROUND_MAT, F_ROOF_MAT, F_STRUCT_H, F_STRUCT_MAT, REGION, VOXEL } from '../world/constants.ts';
import { FEATURE_BRIDGE_DECK, type Feature, type RegionData } from '../world/format.ts';
import { MAT } from '../world/materials.ts';

export const GM = 48;
export const GW = CHUNK + 2 * GM;
export const GPLANE = GW * GW;
export const G_GH = 0;
export const G_MAT = 1;
export const G_DECK = 2;
/** Coarse structure planes (building height in voxels, raw wall byte with tint, roof material), for the
 * block job's 2 m fallback of buildings that stay coarse (see generate.ts). */
export const G_SH = 3;
export const G_SMAT = 4;
export const G_RMAT = 5;
export const G_PLANES = 6;

const EMPTY_GROUND_H = 2;
const REGION_PLANE = REGION * REGION;
const deckCache = new WeakMap<RegionData, Feature[]>();

function decksOf(r: RegionData): Feature[] {
  let d = deckCache.get(r);
  if (d === undefined) {
    d = r.features.filter((f) => f.type === FEATURE_BRIDGE_DECK);
    deckCache.set(r, d);
  }
  return d;
}

/**
 * Builds the window for global chunk (gcx, gcz). `getRegion` returns the decoded region, `null` for an
 * all-default region, or `undefined` when it is not available (the call then returns null). Cells
 * outside the world repeat the nearest edge cell.
 */
export function buildBlockInput(
  gcx: number, gcz: number, regionsX: number, regionsZ: number,
  getRegion: (rx: number, rz: number) => RegionData | null | undefined,
): Uint8Array | null {
  const out = new Uint8Array(G_PLANES * GPLANE);
  const maxX = regionsX * REGION - 1;
  const maxZ = regionsZ * REGION - 1;
  const cx0 = gcx * CHUNK - GM;
  const cz0 = gcz * CHUNK - GM;
  const seen = new Map<number, RegionData | null>();
  let lastRx = -1, lastRz = -1;
  let region: RegionData | null | undefined;
  for (let pz = 0; pz < GW; pz++) {
    const cz = Math.min(maxZ, Math.max(0, cz0 + pz));
    const rz = Math.floor(cz / REGION);
    const lz = cz - rz * REGION;
    for (let px = 0; px < GW; px++) {
      const cx = Math.min(maxX, Math.max(0, cx0 + px));
      const rx = Math.floor(cx / REGION);
      if (rx !== lastRx || rz !== lastRz) {
        region = getRegion(rx, rz);
        if (region === undefined) return null;
        lastRx = rx;
        lastRz = rz;
        seen.set(rz * 4096 + rx, region);
      }
      const o = pz * GW + px;
      if (region === null || region === undefined) {
        out[G_GH * GPLANE + o] = EMPTY_GROUND_H;
        out[G_MAT * GPLANE + o] = MAT.GRASS;
      } else {
        const i = lz * REGION + (cx - rx * REGION);
        out[G_GH * GPLANE + o] = region.cells[REGION_PLANE * F_GROUND_H + i]!;
        out[G_MAT * GPLANE + o] = region.cells[REGION_PLANE * F_GROUND_MAT + i]!;
        out[G_SH * GPLANE + o] = region.cells[REGION_PLANE * F_STRUCT_H + i]!;
        out[G_SMAT * GPLANE + o] = region.cells[REGION_PLANE * F_STRUCT_MAT + i]!;
        out[G_RMAT * GPLANE + o] = region.cells[REGION_PLANE * F_ROOF_MAT + i]!;
      }
    }
  }
  for (const [key, r] of seen) {
    if (r === null) continue;
    const rx = key % 4096, rz = Math.floor(key / 4096);
    for (const f of decksOf(r)) {
      const px = rx * REGION + f.x - cx0;
      const pz = rz * REGION + f.z - cz0;
      if (px < 0 || pz < 0 || px >= GW || pz >= GW) continue;
      const o = G_DECK * GPLANE + pz * GW + px;
      const top = Math.min(255, f.param + 1);
      if (out[o]! < top) out[o] = top;
    }
  }
  return out;
}

/** Reads the window planes in world metres; coordinates outside the window clamp to its edge. */
export class BlockWindowData {
  readonly planes: Uint8Array;
  private readonly cx0: number;
  private readonly cz0: number;

  constructor(planes: Uint8Array, gcx: number, gcz: number) {
    this.planes = planes;
    this.cx0 = gcx * CHUNK - GM;
    this.cz0 = gcz * CHUNK - GM;
  }

  private cell(x: number, z: number): number {
    let i = Math.floor(x / VOXEL) - this.cx0;
    let j = Math.floor(z / VOXEL) - this.cz0;
    i = i < 0 ? 0 : i >= GW ? GW - 1 : i;
    j = j < 0 ? 0 : j >= GW ? GW - 1 : j;
    return j * GW + i;
  }

  /** Coarse ground top (m), structures excluded. */
  groundAt = (x: number, z: number): number => this.planes[G_GH * GPLANE + this.cell(x, z)]! * VOXEL;

  isWater = (x: number, z: number): boolean => this.planes[G_MAT * GPLANE + this.cell(x, z)] === MAT.WATER;

  /** Coarse bridge deck top (m), or null. */
  deckTopAt = (x: number, z: number): number | null => {
    const d = this.planes[G_DECK * GPLANE + this.cell(x, z)]!;
    return d === 0 ? null : d * VOXEL;
  };
}

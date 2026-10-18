/**
 * 1 m block volume for one 64 m chunk: the shared contract between the building and bridge
 * generators (src/fine/buildings.ts, src/fine/bridges.ts) and the block mesher.
 *
 * Blocks sit on the global 1 m grid: block (x, y, z) covers world metres
 * [x0 + x, x0 + x + 1) × [y, y + 1) × [z0 + z, z0 + z + 1). Generators write every building or bridge
 * piece that OVERLAPS the chunk, clipped to it, so pieces from neighbouring chunks meet exactly.
 * Values are MAT ids (src/world/materials.ts); 0 is air.
 */
import { CHUNK, VOXEL } from '../world/constants.ts';

export const BLOCK = 1;
/** Blocks per chunk side (64). */
export const VOL_XZ = (CHUNK * VOXEL) / BLOCK;
/** Blocks in height: world y from 0 to 192 m. */
export const VOL_Y = 192;

export class Volume {
  /** World metres of the chunk's NW corner. */
  readonly x0: number;
  readonly z0: number;
  /** MAT id per block, index (y * VOL_XZ + z) * VOL_XZ + x. */
  readonly mats: Uint8Array;

  constructor(x0: number, z0: number) {
    this.x0 = x0;
    this.z0 = z0;
    this.mats = new Uint8Array(VOL_XZ * VOL_XZ * VOL_Y);
  }

  static index(x: number, y: number, z: number): number {
    return (y * VOL_XZ + z) * VOL_XZ + x;
  }

  inside(x: number, y: number, z: number): boolean {
    return x >= 0 && x < VOL_XZ && z >= 0 && z < VOL_XZ && y >= 0 && y < VOL_Y;
  }

  /** 0 (air) outside the volume. */
  get(x: number, y: number, z: number): number {
    return this.inside(x, y, z) ? this.mats[Volume.index(x, y, z)]! : 0;
  }

  /** Ignored outside the volume, so generators can write whole pieces and let the chunk clip them. */
  set(x: number, y: number, z: number, mat: number): void {
    if (this.inside(x, y, z)) this.mats[Volume.index(x, y, z)] = mat;
  }

  /** Fills blocks [xa, xb) × [ya, yb) × [za, zb) (local block coordinates, clipped). */
  fill(xa: number, ya: number, za: number, xb: number, yb: number, zb: number, mat: number): void {
    const x1 = Math.max(0, xa), x2 = Math.min(VOL_XZ, xb);
    const y1 = Math.max(0, ya), y2 = Math.min(VOL_Y, yb);
    const z1 = Math.max(0, za), z2 = Math.min(VOL_XZ, zb);
    for (let y = y1; y < y2; y++) {
      for (let z = z1; z < z2; z++) {
        const row = (y * VOL_XZ + z) * VOL_XZ;
        this.mats.fill(mat, row + x1, row + x2);
      }
    }
  }

  /** Local block x of a world x in metres (may be outside 0..VOL_XZ-1). */
  bx(worldX: number): number {
    return Math.floor((worldX - this.x0) / BLOCK);
  }

  /** Local block z of a world z in metres (may be outside 0..VOL_XZ-1). */
  bz(worldZ: number): number {
    return Math.floor((worldZ - this.z0) / BLOCK);
  }
}

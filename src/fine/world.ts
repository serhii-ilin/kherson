/**
 * Physics world for the fine tier: the coarse world height plus the fine ground raster (kerbs)
 * wherever a fine chunk is loaded. Pure (no three.js) so it runs in Node tests.
 */
import { CHUNK, VOXEL } from '../world/constants.ts';
import { FINE_CELL, FINE_N, NO_GROUND } from './raster.ts';

const CHUNK_M = CHUNK * VOXEL;

/** The coarse world the fine tier sits on (the WorldStreamer). */
export interface CoarseWorld {
  heightAt(x: number, z: number, refY?: number): number | null;
  /** Like heightAt but ignoring building structures (ground and bridge decks only). */
  groundHeightAt?(x: number, z: number, refY?: number): number | null;
  isWater?(x: number, z: number, refY?: number): boolean;
  trunkNear?(x: number, z: number, r: number): boolean;
}

/** Block columns per chunk side (1 m). */
const BLOCK_N = CHUNK_M;

export class FineWorld {
  /** chunk key -> absolute height raster (cm, NO_GROUND where the cell has no fine ground). */
  private readonly rasters = new Map<number, Uint16Array>();
  /** chunk key -> top (m) per 1 m block column of the block tier (0 = none), row-major 64 x 64. */
  private readonly blockTops = new Map<number, Uint8Array>();
  private lastKey = Number.NaN;
  private lastRaster: Uint16Array | undefined;
  private lastTops: Uint8Array | undefined;

  constructor(private readonly coarse: CoarseWorld) {}

  get loadedChunks(): number { return this.rasters.size; }

  /** Registers (or with null removes) the fine height raster of global chunk (gcx, gcz). */
  setChunk(gcx: number, gcz: number, raster: Uint16Array | null): void {
    const key = gcz * 4096 + gcx;
    if (raster === null) this.rasters.delete(key);
    else this.rasters.set(key, raster);
    this.lastKey = Number.NaN;
  }

  hasChunk(gcx: number, gcz: number): boolean {
    return this.rasters.has(gcz * 4096 + gcx);
  }

  /**
   * Registers (or with null removes) the block tier's column tops of global chunk (gcx, gcz). Where
   * they are loaded the coarse building cells (2 m, up to 1 m wider than the real walls) are ignored
   * and the 1 m columns decide, so walkers stop at the real wall.
   */
  setBlocks(gcx: number, gcz: number, tops: Uint8Array | null): void {
    const key = gcz * 4096 + gcx;
    if (tops === null) this.blockTops.delete(key);
    else this.blockTops.set(key, tops);
    this.lastKey = Number.NaN;
  }

  hasBlocks(gcx: number, gcz: number): boolean {
    return this.blockTops.has(gcz * 4096 + gcx);
  }

  /**
   * Top surface in metres: the coarse height, raised to the fine ground (kerbs) where a fine chunk is
   * loaded. Fine ground is never below the coarse ground, so a walker cannot fall through it; bridge
   * decks and buildings (taller than the ground) keep winning through the max. Where the block tier is
   * loaded the coarse structures are replaced by the 1 m block columns (decks stay coarse).
   */
  heightAt(x: number, z: number, refY?: number): number | null {
    const gcx = Math.floor(x / CHUNK_M);
    const gcz = Math.floor(z / CHUNK_M);
    const key = gcz * 4096 + gcx;
    if (key !== this.lastKey) {
      this.lastKey = key;
      this.lastRaster = this.rasters.get(key);
      this.lastTops = this.blockTops.get(key);
    }
    const tops = this.lastTops;
    let h = tops !== undefined && this.coarse.groundHeightAt !== undefined
      ? this.coarse.groundHeightAt(x, z, refY)
      : this.coarse.heightAt(x, z, refY);
    if (h === null) return null;
    const r = this.lastRaster;
    if (r !== undefined) {
      let cx = Math.floor((x - gcx * CHUNK_M) / FINE_CELL);
      let cz = Math.floor((z - gcz * CHUNK_M) / FINE_CELL);
      cx = cx < 0 ? 0 : cx >= FINE_N ? FINE_N - 1 : cx;
      cz = cz < 0 ? 0 : cz >= FINE_N ? FINE_N - 1 : cz;
      const v = r[cz * FINE_N + cx]!;
      if (v !== NO_GROUND) {
        const f = v / 100;
        if (f > h) h = f;
      }
    }
    if (tops !== undefined) {
      let bx = Math.floor(x - gcx * CHUNK_M);
      let bz = Math.floor(z - gcz * CHUNK_M);
      bx = bx < 0 ? 0 : bx >= BLOCK_N ? BLOCK_N - 1 : bx;
      bz = bz < 0 ? 0 : bz >= BLOCK_N ? BLOCK_N - 1 : bz;
      const t = tops[bz * BLOCK_N + bx]!;
      if (t > h) h = t;
    }
    return h;
  }

  isWater(x: number, z: number, refY?: number): boolean {
    return this.coarse.isWater !== undefined && this.coarse.isWater(x, z, refY);
  }

  trunkNear(x: number, z: number, r: number): boolean {
    return this.coarse.trunkNear !== undefined && this.coarse.trunkNear(x, z, r);
  }
}

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
  isWater?(x: number, z: number, refY?: number): boolean;
  trunkNear?(x: number, z: number, r: number): boolean;
}

export class FineWorld {
  /** chunk key -> absolute height raster (cm, NO_GROUND where the cell has no fine ground). */
  private readonly rasters = new Map<number, Uint16Array>();
  private lastKey = Number.NaN;
  private lastRaster: Uint16Array | undefined;

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
   * Top surface in metres: the coarse height, raised to the fine ground (kerbs) where a fine chunk is
   * loaded. Fine ground is never below the coarse ground, so a walker cannot fall through it; bridge
   * decks and buildings (taller than the ground) keep winning through the max.
   */
  heightAt(x: number, z: number, refY?: number): number | null {
    const h = this.coarse.heightAt(x, z, refY);
    if (h === null) return null;
    const gcx = Math.floor(x / CHUNK_M);
    const gcz = Math.floor(z / CHUNK_M);
    const key = gcz * 4096 + gcx;
    if (key !== this.lastKey) {
      this.lastKey = key;
      this.lastRaster = this.rasters.get(key);
    }
    const r = this.lastRaster;
    if (r === undefined) return h;
    let cx = Math.floor((x - gcx * CHUNK_M) / FINE_CELL);
    let cz = Math.floor((z - gcz * CHUNK_M) / FINE_CELL);
    cx = cx < 0 ? 0 : cx >= FINE_N ? FINE_N - 1 : cx;
    cz = cz < 0 ? 0 : cz >= FINE_N ? FINE_N - 1 : cz;
    const v = r[cz * FINE_N + cx]!;
    if (v === NO_GROUND) return h;
    const f = v / 100;
    return f > h ? f : h;
  }

  isWater(x: number, z: number, refY?: number): boolean {
    return this.coarse.isWater !== undefined && this.coarse.isWater(x, z, refY);
  }

  trunkNear(x: number, z: number, r: number): boolean {
    return this.coarse.trunkNear !== undefined && this.coarse.trunkNear(x, z, r);
  }
}

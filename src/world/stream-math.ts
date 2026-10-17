import { CHUNK, REGION_CHUNKS, VOXEL } from './constants.ts';

export const CHUNK_M = CHUNK * VOXEL;
export const REGION_M = CHUNK_M * REGION_CHUNKS;

/** Edge direction bits: neighbour region on the +x / -x / +z / -z side. */
export const DIR_PX = 1;
export const DIR_NX = 2;
export const DIR_PZ = 4;
export const DIR_NZ = 8;

export interface ChunkRef {
  /** Global chunk coordinates (world metres / CHUNK_M). */
  gcx: number;
  gcz: number;
  /** Distance from the query point to the nearest point of the chunk, in metres. */
  dist: number;
}

export function chunkKey(gcx: number, gcz: number): number {
  return gcz * 4096 + gcx;
}

export function regionKey(rx: number, rz: number): number {
  return rz * 4096 + rx;
}

/** Horizontal distance from (x, z) to the nearest point of chunk (gcx, gcz). */
export function distToChunk(x: number, z: number, gcx: number, gcz: number): number {
  const x0 = gcx * CHUNK_M;
  const z0 = gcz * CHUNK_M;
  const dx = Math.max(x0 - x, 0, x - (x0 + CHUNK_M));
  const dz = Math.max(z0 - z, 0, z - (z0 + CHUNK_M));
  return Math.hypot(dx, dz);
}

/**
 * Chunks of a chunksX x chunksZ world whose area intersects the circle of `radius`
 * metres around (x, z), nearest first (ties broken by gcz, then gcx).
 */
export function neededChunks(
  x: number, z: number, radius: number, chunksX: number, chunksZ: number,
): ChunkRef[] {
  const out: ChunkRef[] = [];
  const gx0 = Math.max(0, Math.floor((x - radius) / CHUNK_M));
  const gx1 = Math.min(chunksX - 1, Math.floor((x + radius) / CHUNK_M));
  const gz0 = Math.max(0, Math.floor((z - radius) / CHUNK_M));
  const gz1 = Math.min(chunksZ - 1, Math.floor((z + radius) / CHUNK_M));
  for (let gcz = gz0; gcz <= gz1; gcz++) {
    for (let gcx = gx0; gcx <= gx1; gcx++) {
      const dist = distToChunk(x, z, gcx, gcz);
      if (dist <= radius) out.push({ gcx, gcz, dist });
    }
  }
  out.sort((a, b) => a.dist - b.dist || a.gcz - b.gcz || a.gcx - b.gcx);
  return out;
}

/** Which region borders a chunk touches (DIR_* mask), from its global chunk coordinates. */
export function edgeDirs(gcx: number, gcz: number): number {
  const lx = gcx % REGION_CHUNKS;
  const lz = gcz % REGION_CHUNKS;
  let m = 0;
  if (lx === REGION_CHUNKS - 1) m |= DIR_PX;
  if (lx === 0) m |= DIR_NX;
  if (lz === REGION_CHUNKS - 1) m |= DIR_PZ;
  if (lz === 0) m |= DIR_NZ;
  return m;
}

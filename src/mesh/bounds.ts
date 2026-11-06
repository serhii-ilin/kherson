import { CHUNK_M } from '../world/stream-math.ts';

/**
 * Reference rectangle around Freedom Square and Ushakova avenue, used only to
 * compare measurements with the phase-0 prototype. The renderer no longer clips to it.
 * World metres. Spawn «Площа Свободи» is about (10293, 8817).
 */
export const MESH_NEIGHBOURHOOD = {
  /** Inclusive minimum, exclusive maximum. */
  x0: 9984,
  z0: 8320,
  x1: 11264,
  z1: 10496,
} as const;

/**
 * How far extruded buildings are generated. Matches the coarse view radius in
 * `main.ts`: 640 m on a laptop at High, 384 m on a phone or Low. Every chunk
 * inside that disc is meshed. Past it, voxel buildings stay until the camera arrives.
 */
export function meshViewRadius(quality: 'high' | 'low', mobile: boolean): number {
  return quality === 'low' || mobile ? 384 : 640;
}

/** Keep finished chunks this far past the radius so a small step does not rebuild them. */
export const MESH_KEEP = 96;

/**
 * Near-LOD radius for real window / balcony geometry. 100 m on a desktop at High, 50 m on a
 * phone at High, and 0 on Low (no near LOD; mid stays as before).
 */
export function meshNearRadius(quality: 'high' | 'low', mobile: boolean): number {
  if (quality === 'low') return 0;
  return mobile ? 50 : 100;
}

export type MeshLod = 'near' | 'mid';

/**
 * LOD of a chunk at its distance from the camera. Once near, it stays near until the chunk is
 * 32 m past the near radius, so a chunk on the boundary does not flip on every step.
 */
export function chunkLod(dist: number, current: MeshLod | null, nearR: number): MeshLod {
  if (nearR <= 0) return 'mid';
  if (current === 'near') return dist <= nearR + 32 ? 'near' : 'mid';
  return dist <= nearR ? 'near' : 'mid';
}

export interface Aabb {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

/** True when the chunk's closest point is inside the mesh disc. */
export function chunkInMeshRadius(x: number, z: number, gcx: number, gcz: number, radius: number): boolean {
  const x0 = gcx * CHUNK_M;
  const z0 = gcz * CHUNK_M;
  const dx = Math.max(x0 - x, 0, x - (x0 + CHUNK_M));
  const dz = Math.max(z0 - z, 0, z - (z0 + CHUNK_M));
  return Math.hypot(dx, dz) <= radius;
}

import { CHUNK_M } from '../world/stream-math.ts';

/**
 * City-centre mesh prototype: Freedom Square and the Ushakova / Nezalezhnosti avenue
 * down to the embankment. World metres, origin at the NW corner of the bake bbox.
 *
 * Anchors (this snapshot): spawn «Площа Свободи» ≈ (10293, 8817); the avenue's
 * embankment fountain pose x=10790, z=10172. The box is 1.28 km × 2.18 km, about
 * three by five 512 m regions (rx 19–21, rz 16–20). Chunk edges, so neighbouring
 * chunks agree on the boundary.
 */
export const MESH_NEIGHBOURHOOD = {
  /** Inclusive minimum, exclusive maximum. */
  x0: 9984,
  z0: 8320,
  x1: 11264,
  z1: 10496,
} as const;

/**
 * Interior inset (m). Coarse building voxels are hidden only this far inside the box, so a
 * building that straddles the outer edge is never cut in half. Freedom Square and the
 * embankment pose both sit in the interior.
 */
export const MESH_HIDE_INSET = 96;

export interface Aabb {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export function chunkIntersects(gcx: number, gcz: number, box: Aabb): boolean {
  const x0 = gcx * CHUNK_M;
  const z0 = gcz * CHUNK_M;
  return x0 < box.x1 && x0 + CHUNK_M > box.x0 && z0 < box.z1 && z0 + CHUNK_M > box.z0;
}

/** Chunks that receive extruded buildings (the whole neighbourhood). */
export function chunkInNeighbourhood(gcx: number, gcz: number): boolean {
  return chunkIntersects(gcx, gcz, MESH_NEIGHBOURHOOD);
}

/** Interior chunks whose coarse walls/roofs can be hidden once the mesh job has landed. */
export function chunkHidesStructures(gcx: number, gcz: number): boolean {
  const x0 = gcx * CHUNK_M;
  const z0 = gcz * CHUNK_M;
  const x1 = x0 + CHUNK_M;
  const z1 = z0 + CHUNK_M;
  const b = MESH_NEIGHBOURHOOD;
  const m = MESH_HIDE_INSET;
  return x0 >= b.x0 + m && x1 <= b.x1 - m && z0 >= b.z0 + m && z1 <= b.z1 - m;
}

/** Distance from a point to the neighbourhood box (0 when inside). */
export function distToNeighbourhood(x: number, z: number): number {
  const b = MESH_NEIGHBOURHOOD;
  const dx = Math.max(b.x0 - x, 0, x - b.x1);
  const dz = Math.max(b.z0 - z, 0, z - b.z1);
  return Math.hypot(dx, dz);
}

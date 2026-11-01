/**
 * One 64 m chunk of extruded buildings. A building belongs to the chunk that holds its footprint
 * centroid (the same anchor the bake uses) and only when that centroid lies in the mesh neighbourhood.
 * The mesh is in chunk-local metres.
 */
import { VOXEL } from '../world/constants.ts';
import { CHUNK_M } from '../world/stream-math.ts';
import { GM, GW } from '../fine/block-input.ts';
import type { VectorTile, VBuilding } from '../world/vector-format.ts';
import { MESH_NEIGHBOURHOOD, type Aabb } from './bounds.ts';
import {
  emptyMesh, extrudeBuilding, mergeMeshes, type CityMesh, type ExtrudeBuilding,
} from './extrude.ts';

const REGION_M = 512;

function ringMetres(ring: Int32Array, ox: number, oz: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < ring.length; i += 2) out.push([ox + ring[i]! / 100, oz + ring[i + 1]! / 100]);
  return out;
}

function pointInRing(ring: ReadonlyArray<readonly [number, number]>, x: number, z: number): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const yi = ring[i]![1];
    const yj = ring[j]![1];
    if ((yi > z) !== (yj > z)) {
      const xi = ring[i]![0];
      const xj = ring[j]![0];
      if (x < xi + ((z - yi) * (xj - xi)) / (yj - yi)) hit = !hit;
    }
  }
  return hit;
}

function centroid(ring: readonly (readonly [number, number])[]): [number, number] {
  let x = 0, z = 0;
  for (const p of ring) { x += p[0]; z += p[1]; }
  const n = ring.length || 1;
  return [x / n, z / n];
}

function inBox(x: number, z: number, box: Aabb): boolean {
  return x >= box.x0 && x < box.x1 && z >= box.z0 && z < box.z1;
}

/** Minimum ground sample over the footprint (vertices plus a 4 m lattice). */
export function footprintGround(
  rings: ReadonlyArray<ReadonlyArray<readonly [number, number]>>,
  groundAt: (x: number, z: number) => number,
): number {
  const outer = rings[0];
  if (outer === undefined || outer.length === 0) return groundAt(0, 0);
  let g = Infinity;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const p of outer) {
    g = Math.min(g, groundAt(p[0], p[1]));
    if (p[0] < x0) x0 = p[0];
    if (p[0] > x1) x1 = p[0];
    if (p[1] < z0) z0 = p[1];
    if (p[1] > z1) z1 = p[1];
  }
  for (let z = z0; z <= z1; z += 4) {
    for (let x = x0; x <= x1; x += 4) {
      if (pointInRing(outer, x, z)) g = Math.min(g, groundAt(x, z));
    }
  }
  return Number.isFinite(g) ? g : 4;
}

/**
 * Ground height in metres from a coarse window (the block-tier `G_GH` plane): voxel bytes,
 * origin at the chunk's NW cell minus {@link GM} cells.
 */
export function groundAtFromGrid(gcx: number, gcz: number, ground: Uint8Array): (x: number, z: number) => number {
  const cx0 = gcx * (CHUNK_M / VOXEL) - GM;
  const cz0 = gcz * (CHUNK_M / VOXEL) - GM;
  return (x, z) => {
    const px = Math.min(GW - 1, Math.max(0, Math.floor(x / VOXEL) - cx0));
    const pz = Math.min(GW - 1, Math.max(0, Math.floor(z / VOXEL) - cz0));
    return ground[pz * GW + px]! * VOXEL;
  };
}

export function buildingsInChunk(
  tiles: readonly VectorTile[], gcx: number, gcz: number,
  groundAt: (x: number, z: number) => number,
  box: Aabb = MESH_NEIGHBOURHOOD,
): ExtrudeBuilding[] {
  const out: ExtrudeBuilding[] = [];
  for (const tile of tiles) {
    const ox = tile.rx * REGION_M;
    const oz = tile.rz * REGION_M;
    for (const b of tile.buildings) out.push(...one(b, ox, oz, gcx, gcz, groundAt, box));
  }
  out.sort((a, b) => a.id - b.id);
  return out;
}

function one(
  b: VBuilding, ox: number, oz: number, gcx: number, gcz: number,
  groundAt: (x: number, z: number) => number, box: Aabb,
): ExtrudeBuilding[] {
  const ring0 = b.rings[0];
  if (ring0 === undefined || ring0.length < 6) return [];
  const rings = b.rings.map((r) => ringMetres(r, ox, oz));
  const [cx, cz] = centroid(rings[0]!);
  if (Math.floor(cx / CHUNK_M) !== gcx || Math.floor(cz / CHUNK_M) !== gcz) return [];
  if (!inBox(cx, cz, box)) return [];
  return [{
    id: b.id,
    rings,
    heightM: b.heightCm / 100,
    minHeightM: b.minHeightCm / 100,
    levels: b.levels,
    wall: b.wall,
    roof: b.roof,
    roofShape: b.roofShape,
    groundY: footprintGround(rings, groundAt),
  }];
}

/** Merged mesh of every building this chunk owns. Empty when there are none. */
export function buildChunkMesh(
  tiles: readonly VectorTile[], gcx: number, gcz: number,
  groundAt: (x: number, z: number) => number,
  box?: Aabb,
): CityMesh {
  const list = buildingsInChunk(tiles, gcx, gcz, groundAt, box);
  if (list.length === 0) return emptyMesh();
  const ox = gcx * CHUNK_M;
  const oz = gcz * CHUNK_M;
  return mergeMeshes(list.map((b) => extrudeBuilding(b, ox, oz)));
}

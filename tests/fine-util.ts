import { CHUNK, REGION_CHUNKS } from '../src/world/constants';
import { MAT } from '../src/world/materials';
import { NO_DIR, ROAD, type VArea, type VLine, type VPoint, type VRoad, type VectorTile } from '../src/world/vector-format';
import { PATCH_PLANE, PATCH_W, P_GH, P_MAT, P_SH } from '../src/fine/patch';
import { FINE_CELL, FINE_N, type FineGrid } from '../src/fine/raster';
import { rasterizeGround } from '../src/fine/ground';

/** Test chunk: global chunk (4, 4), world origin (256, 256) m, inside region (0, 0). */
export const GCX = 4;
export const GCZ = 4;
export const ORIGIN = GCX * CHUNK * 2;
void REGION_CHUNKS;

export function flatPatch(mat: number = MAT.GRASS, gh = 2): Uint8Array {
  const p = new Uint8Array(3 * PATCH_PLANE);
  p.fill(mat, P_MAT * PATCH_PLANE, (P_MAT + 1) * PATCH_PLANE);
  p.fill(gh, P_GH * PATCH_PLANE, (P_GH + 1) * PATCH_PLANE);
  return p;
}

export function setCoarse(p: Uint8Array, lcx: number, lcz: number, mat: number, gh: number, sh = 0): void {
  const i = (lcz + 1) * PATCH_W + lcx + 1;
  p[P_MAT * PATCH_PLANE + i] = mat;
  p[P_GH * PATCH_PLANE + i] = gh;
  p[P_SH * PATCH_PLANE + i] = sh;
}

export function emptyTile(rx = 0, rz = 0): VectorTile {
  return { rx, rz, strings: [], buildings: [], roads: [], areas: [], lines: [], points: [] };
}

/** Chunk-local metres -> region-0 centimetres. */
function cm(pts: ReadonlyArray<readonly [number, number]>): Int32Array {
  const out = new Int32Array(pts.length * 2);
  pts.forEach(([x, z], i) => {
    out[i * 2] = Math.round((x + ORIGIN) * 100);
    out[i * 2 + 1] = Math.round((z + ORIGIN) * 100);
  });
  return out;
}

export function road(
  pts: ReadonlyArray<readonly [number, number]>, widthM: number,
  o: Partial<Pick<VRoad, 'kind' | 'flags' | 'lanes' | 'name' | 'layer'>> = {},
): VRoad {
  return {
    pts: cm(pts), kind: o.kind ?? ROAD.RESIDENTIAL, flags: o.flags ?? 0, widthCm: Math.round(widthM * 100),
    lanes: o.lanes ?? 0, layer: o.layer ?? 0, name: o.name ?? -1,
  };
}

export function line(pts: ReadonlyArray<readonly [number, number]>, kind: number): VLine {
  return { pts: cm(pts), kind };
}

export function point(x: number, z: number, kind: number, dir = NO_DIR): VPoint {
  return { x: Math.round((x + ORIGIN) * 100), z: Math.round((z + ORIGIN) * 100), kind, dir, name: -1 };
}

export function area(rings: ReadonlyArray<ReadonlyArray<readonly [number, number]>>, mat: number, prio = 0): VArea {
  return { rings: rings.map(cm), mat, prio };
}

export function raster(patch: Uint8Array, tile: VectorTile): FineGrid {
  return rasterizeGround({ gcx: GCX, gcz: GCZ, patch, tiles: [tile] });
}

/** Material at chunk-local metres. */
export function matAt(g: FineGrid, x: number, z: number): number {
  return g.mat[Math.floor(z / FINE_CELL) * FINE_N + Math.floor(x / FINE_CELL)]!;
}

export function hAt(g: FineGrid, x: number, z: number): number {
  return g.hcm[Math.floor(z / FINE_CELL) * FINE_N + Math.floor(x / FINE_CELL)]!;
}

export function countMat(g: FineGrid, mat: number): number {
  let n = 0;
  for (let i = 0; i < g.mat.length; i++) if (g.mat[i] === mat) n++;
  return n;
}

export { FINE_CELL, FINE_N };

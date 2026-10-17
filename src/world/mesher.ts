import {
  CHUNK,
  F_GROUND_H,
  F_GROUND_MAT,
  F_ROOF_MAT,
  F_STRUCT_H,
  F_STRUCT_MAT,
  REGION,
  VOXEL,
} from './constants.ts';
import { FEATURE_BRIDGE_DECK, FEATURE_TREE, type RegionData } from './format.ts';
import { MAT, PALETTE } from './materials.ts';

/**
 * Region top heights (groundH + structH, in voxels) of the touching column/row of
 * the four adjacent regions. Each array has REGION entries:
 *  px: neighbour at +x, its column x=0 indexed by z;  nx: neighbour at -x, column x=REGION-1 by z;
 *  pz: neighbour at +z, its row z=0 indexed by x;     nz: neighbour at -z, row z=REGION-1 by x.
 */
export interface RegionEdges {
  px?: Uint8Array;
  nx?: Uint8Array;
  pz?: Uint8Array;
  nz?: Uint8Array;
}

export type EdgeKey = keyof RegionEdges;

/** Extracts the touching edge of `neighbour` as seen from the region on the opposite side. */
export function edgeTops(neighbour: Uint8Array, key: EdgeKey): Uint8Array {
  const out = new Uint8Array(REGION);
  for (let i = 0; i < REGION; i++) {
    const c = key === 'px' ? i * REGION : key === 'nx' ? i * REGION + REGION - 1
      : key === 'pz' ? i : (REGION - 1) * REGION + i;
    out[i] = neighbour[PLANE * F_GROUND_H + c]! + neighbour[PLANE * F_STRUCT_H + c]!;
  }
  return out;
}

export interface ChunkMesh {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
}

/** Tessellated water surface; normals and colours are computed by the water shader. */
export interface WaterMesh {
  positions: Float32Array;
  /** 0 at the shore .. 1 three or more cells from land. */
  shore: Float32Array;
  indices: Uint32Array;
}

export interface ChunkMeshResult extends ChunkMesh {
  water: WaterMesh | null;
}

const PLANE = REGION * REGION;
const SIDE_SHADE = 0.8;
const BOTTOM_SHADE = 0.65;

/** Growable quad buffer producing the final typed arrays. */
export class QuadBuilder {
  private pos = new Float32Array(1024 * 12);
  private nor = new Float32Array(1024 * 12);
  private col = new Float32Array(1024 * 12);
  quads = 0;

  private grow(): void {
    const n = this.pos.length * 2;
    for (const k of ['pos', 'nor', 'col'] as const) {
      const a = new Float32Array(n);
      a.set(this[k]);
      this[k] = a;
    }
  }

  /** Vertices must be counter-clockwise seen from the outside. */
  quad(
    x0: number, y0: number, z0: number,
    x1: number, y1: number, z1: number,
    x2: number, y2: number, z2: number,
    x3: number, y3: number, z3: number,
    nx: number, ny: number, nz: number,
    mat: number, shade: number,
  ): void {
    if ((this.quads + 1) * 12 > this.pos.length) this.grow();
    const o = this.quads * 12;
    const p = this.pos;
    p[o] = x0; p[o + 1] = y0; p[o + 2] = z0;
    p[o + 3] = x1; p[o + 4] = y1; p[o + 5] = z1;
    p[o + 6] = x2; p[o + 7] = y2; p[o + 8] = z2;
    p[o + 9] = x3; p[o + 10] = y3; p[o + 11] = z3;
    const r = (PALETTE[mat * 3]! / 255) * shade;
    const g = (PALETTE[mat * 3 + 1]! / 255) * shade;
    const b = (PALETTE[mat * 3 + 2]! / 255) * shade;
    for (let v = 0; v < 4; v++) {
      const i = o + v * 3;
      this.nor[i] = nx; this.nor[i + 1] = ny; this.nor[i + 2] = nz;
      this.col[i] = r; this.col[i + 1] = g; this.col[i + 2] = b;
    }
    this.quads++;
  }

  /** Top face; xa..xb, za..zb in metres. */
  top(xa: number, xb: number, y: number, za: number, zb: number, mat: number): void {
    this.quad(xa, y, zb, xb, y, zb, xb, y, za, xa, y, za, 0, 1, 0, mat, y === 0 ? BOTTOM_SHADE : 1);
  }

  bottom(xa: number, xb: number, y: number, za: number, zb: number, mat: number): void {
    this.quad(xa, y, za, xb, y, za, xb, y, zb, xa, y, zb, 0, -1, 0, mat, BOTTOM_SHADE);
  }

  /** Wall facing +X/-X at plane x, spanning y and z ranges. */
  wallX(x: number, ya: number, yb: number, za: number, zb: number, positive: boolean, mat: number): void {
    const s = ya === 0 ? BOTTOM_SHADE : SIDE_SHADE;
    if (positive) this.quad(x, ya, zb, x, ya, za, x, yb, za, x, yb, zb, 1, 0, 0, mat, s);
    else this.quad(x, ya, za, x, ya, zb, x, yb, zb, x, yb, za, -1, 0, 0, mat, s);
  }

  /** Wall facing +Z/-Z at plane z, spanning x and y ranges. */
  wallZ(z: number, ya: number, yb: number, xa: number, xb: number, positive: boolean, mat: number): void {
    const s = ya === 0 ? BOTTOM_SHADE : SIDE_SHADE;
    if (positive) this.quad(xa, ya, z, xb, ya, z, xb, yb, z, xa, yb, z, 0, 0, 1, mat, s);
    else this.quad(xb, ya, z, xa, ya, z, xa, yb, z, xb, yb, z, 0, 0, -1, mat, s);
  }

  /** Axis-aligned box in metres; sides and top always, bottom optional. */
  box(
    xa: number, ya: number, za: number,
    xb: number, yb: number, zb: number,
    mat: number, withBottom: boolean,
  ): void {
    this.top(xa, xb, yb, za, zb, mat);
    if (withBottom) this.bottom(xa, xb, ya, za, zb, mat);
    this.wallX(xb, ya, yb, za, zb, true, mat);
    this.wallX(xa, ya, yb, za, zb, false, mat);
    this.wallZ(zb, ya, yb, xa, xb, true, mat);
    this.wallZ(za, ya, yb, xa, xb, false, mat);
  }

  build(): ChunkMesh {
    const q = this.quads;
    const indices = new Uint32Array(q * 6);
    for (let i = 0; i < q; i++) {
      const v = i * 4;
      const o = i * 6;
      indices[o] = v; indices[o + 1] = v + 1; indices[o + 2] = v + 2;
      indices[o + 3] = v; indices[o + 4] = v + 2; indices[o + 5] = v + 3;
    }
    return {
      positions: this.pos.slice(0, q * 12),
      normals: this.nor.slice(0, q * 12),
      colors: this.col.slice(0, q * 12),
      indices,
    };
  }
}

function soilFor(groundMat: number): number {
  return groundMat === MAT.GRASS || groundMat === MAT.PARK || groundMat === MAT.FOREST
    ? MAT.DIRT
    : groundMat;
}

const topKey = new Int32Array(CHUNK * CHUNK);

function meshTops(b: QuadBuilder, cells: Uint8Array, x0: number, z0: number): void {
  for (let lz = 0; lz < CHUNK; lz++) {
    for (let lx = 0; lx < CHUNK; lx++) {
      const i = (z0 + lz) * REGION + x0 + lx;
      const gh = cells[PLANE * F_GROUND_H + i]!;
      const sh = cells[PLANE * F_STRUCT_H + i]!;
      let mat: number;
      if (sh > 0) {
        mat = cells[PLANE * F_ROOF_MAT + i]! || cells[PLANE * F_STRUCT_MAT + i]! || cells[i]!;
      } else {
        mat = cells[PLANE * F_GROUND_MAT + i]!;
      }
      topKey[lz * CHUNK + lx] = sh === 0 && mat === MAT.WATER ? -1 : ((gh + sh) << 8) | mat;
    }
  }
  const used = new Uint8Array(CHUNK * CHUNK);
  for (let k = 0; k < CHUNK * CHUNK; k++) if (topKey[k] === -1) used[k] = 1;
  for (let lz = 0; lz < CHUNK; lz++) {
    for (let lx = 0; lx < CHUNK; lx++) {
      const s = lz * CHUNK + lx;
      if (used[s]) continue;
      const key = topKey[s]!;
      let w = 1;
      while (lx + w < CHUNK && !used[s + w] && topKey[s + w] === key) w++;
      let h = 1;
      outer: while (lz + h < CHUNK) {
        const row = s + h * CHUNK;
        for (let k = 0; k < w; k++) {
          if (used[row + k] || topKey[row + k] !== key) break outer;
        }
        h++;
      }
      for (let dz = 0; dz < h; dz++) used.fill(1, s + dz * CHUNK, s + dz * CHUNK + w);
      b.top(
        (x0 + lx) * VOXEL, (x0 + lx + w) * VOXEL, (key >> 8) * VOXEL,
        (z0 + lz) * VOXEL, (z0 + lz + h) * VOXEL, key & 255,
      );
    }
  }
}

/**
 * Side faces. dir: 0=+X, 1=-X, 2=+Z, 3=-Z. Walls are merged along the run axis
 * (z for X-facing walls, x for Z-facing walls). Layer 0 is the soil part below
 * the ground top, layer 1 the structure part above it.
 */
function meshSides(
  b: QuadBuilder, cells: Uint8Array, x0: number, z0: number, edges: RegionEdges | undefined,
): void {
  for (let dir = 0; dir < 4; dir++) {
    const alongX = dir >= 2; // run axis is x for Z-facing walls
    const step = dir === 0 || dir === 2 ? 1 : -1;
    const positive = step === 1;
    for (let layer = 0; layer < 2; layer++) {
      for (let a = 0; a < CHUNK; a++) {
        let runStart = -1;
        let runY0 = 0;
        let runY1 = 0;
        let runMat = 0;
        for (let bi = 0; bi <= CHUNK; bi++) {
          let y0 = 0;
          let y1 = 0;
          let mat = 0;
          if (bi < CHUNK) {
            const cx = alongX ? x0 + bi : x0 + a;
            const cz = alongX ? z0 + a : z0 + bi;
            const i = cz * REGION + cx;
            const gh = cells[PLANE * F_GROUND_H + i]!;
            const top = gh + cells[PLANE * F_STRUCT_H + i]!;
            const nx = alongX ? cx : cx + step;
            const nz = alongX ? cz + step : cz;
            let nTop = gh;
            if (nx >= 0 && nx < REGION && nz >= 0 && nz < REGION) {
              const ni = nz * REGION + nx;
              nTop = cells[PLANE * F_GROUND_H + ni]! + cells[PLANE * F_STRUCT_H + ni]!;
            } else if (edges) {
              const e = nx >= REGION ? edges.px : nx < 0 ? edges.nx : nz >= REGION ? edges.pz : edges.nz;
              if (e) nTop = e[alongX ? cx : cz]!;
            }
            const gm = cells[i]!;
            if (layer === 0) {
              y0 = nTop;
              y1 = Math.min(top, gh);
              mat = soilFor(gm);
            } else {
              y0 = Math.max(nTop, gh);
              y1 = top;
              mat = cells[PLANE * F_STRUCT_MAT + i]! || soilFor(gm);
            }
            if (y1 <= y0) y1 = y0 = 0;
          }
          const continues =
            runStart >= 0 && y1 > y0 && y0 === runY0 && y1 === runY1 && mat === runMat;
          if (!continues) {
            if (runStart >= 0) {
              const ya = runY0 * VOXEL;
              const yb = runY1 * VOXEL;
              if (alongX) {
                const z = (z0 + a + (positive ? 1 : 0)) * VOXEL;
                b.wallZ(z, ya, yb, (x0 + runStart) * VOXEL, (x0 + bi) * VOXEL, positive, runMat);
              } else {
                const x = (x0 + a + (positive ? 1 : 0)) * VOXEL;
                b.wallX(x, ya, yb, (z0 + runStart) * VOXEL, (z0 + bi) * VOXEL, positive, runMat);
              }
              runStart = -1;
            }
            if (y1 > y0) {
              runStart = bi;
              runY0 = y0;
              runY1 = y1;
              runMat = mat;
            }
          }
        }
      }
    }
  }
}

const BLOCKS = CHUNK / 2;
const GRID = BLOCKS + 1;
const SHORE_MARGIN = 3;
const WIN = CHUNK + 2 * SHORE_MARGIN;
const shoreDist = new Uint8Array(WIN * WIN);
const gridVert = new Int32Array(GRID * GRID);

/** Chebyshev distance (capped at SHORE_MARGIN) to the nearest land cell, over the chunk plus a margin. */
function computeShore(cells: Uint8Array, x0: number, z0: number, edges: RegionEdges | undefined, level: number): void {
  for (let wz = 0; wz < WIN; wz++) {
    for (let wx = 0; wx < WIN; wx++) {
      const cx = x0 - SHORE_MARGIN + wx;
      const cz = z0 - SHORE_MARGIN + wz;
      let water: boolean;
      if (cx >= 0 && cx < REGION && cz >= 0 && cz < REGION) {
        water = cells[cz * REGION + cx] === MAT.WATER;
      } else if (edges && cz >= 0 && cz < REGION && (cx < 0 ? edges.nx : cx >= REGION ? edges.px : undefined)) {
        water = (cx < 0 ? edges.nx! : edges.px!)[cz]! <= level;
      } else if (edges && cx >= 0 && cx < REGION && (cz < 0 ? edges.nz : cz >= REGION ? edges.pz : undefined)) {
        water = (cz < 0 ? edges.nz! : edges.pz!)[cx]! <= level;
      } else {
        water = true; // unknown
      }
      shoreDist[wz * WIN + wx] = water ? SHORE_MARGIN : 0;
    }
  }
  for (let wz = 0; wz < WIN; wz++) {
    for (let wx = 0; wx < WIN; wx++) {
      let d = shoreDist[wz * WIN + wx]!;
      if (d === 0) continue;
      for (let dz = -1; dz <= 0; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dz === 0 && dx >= 0) break;
          const nx = wx + dx;
          const nz = wz + dz;
          if (nx < 0 || nx >= WIN || nz < 0) continue;
          const v = shoreDist[nz * WIN + nx]! + 1;
          if (v < d) d = v;
        }
      }
      shoreDist[wz * WIN + wx] = d;
    }
  }
  for (let wz = WIN - 1; wz >= 0; wz--) {
    for (let wx = WIN - 1; wx >= 0; wx--) {
      let d = shoreDist[wz * WIN + wx]!;
      if (d === 0) continue;
      for (let dz = 1; dz >= 0; dz--) {
        for (let dx = 1; dx >= -1; dx--) {
          if (dz === 0 && dx <= 0) break;
          const nx = wx + dx;
          const nz = wz + dz;
          if (nx < 0 || nx >= WIN || nz >= WIN) continue;
          const v = shoreDist[nz * WIN + nx]! + 1;
          if (v < d) d = v;
        }
      }
      shoreDist[wz * WIN + wx] = d;
    }
  }
}

/**
 * Water surface: shared-vertex grid of 2x2-cell quads over every 2x2 block containing a water cell.
 * Vertex (i, j) sits at cell corner (x0 + 2i, z0 + 2j), so neighbouring chunks agree on border vertices.
 */
function meshWater(cells: Uint8Array, x0: number, z0: number, edges: RegionEdges | undefined): WaterMesh | null {
  let level = -1;
  const blockLevel = new Int16Array(BLOCKS * BLOCKS);
  let blockCount = 0;
  for (let bz = 0; bz < BLOCKS; bz++) {
    for (let bx = 0; bx < BLOCKS; bx++) {
      let lv = -1;
      for (let k = 0; k < 4 && lv < 0; k++) {
        const i = (z0 + bz * 2 + (k >> 1)) * REGION + x0 + bx * 2 + (k & 1);
        if (cells[i] === MAT.WATER) lv = cells[PLANE * F_GROUND_H + i]!;
      }
      blockLevel[bz * BLOCKS + bx] = lv;
      if (lv >= 0) {
        blockCount++;
        if (level < 0) level = lv;
      }
    }
  }
  if (blockCount === 0) return null;
  computeShore(cells, x0, z0, edges, level);

  gridVert.fill(-1);
  const pos = new Float32Array(blockCount * 4 * 3);
  const shore = new Float32Array(blockCount * 4);
  const idx = new Uint32Array(blockCount * 6);
  let nv = 0;
  let ni = 0;
  const vert = (gi: number, gj: number, y: number): number => {
    const g = gj * GRID + gi;
    let v = gridVert[g]!;
    if (v >= 0) return v;
    v = nv++;
    gridVert[g] = v;
    pos[v * 3] = (x0 + gi * 2) * VOXEL;
    pos[v * 3 + 1] = y * VOXEL;
    pos[v * 3 + 2] = (z0 + gj * 2) * VOXEL;
    // vertex touches window cells (cx-1..cx, cz-1..cz) with cx = SHORE_MARGIN + 2*gi
    const wx = SHORE_MARGIN + gi * 2;
    const wz = SHORE_MARGIN + gj * 2;
    const d = Math.min(
      shoreDist[(wz - 1) * WIN + wx - 1]!, shoreDist[(wz - 1) * WIN + wx]!,
      shoreDist[wz * WIN + wx - 1]!, shoreDist[wz * WIN + wx]!,
    );
    shore[v] = d / SHORE_MARGIN;
    return v;
  };
  for (let bz = 0; bz < BLOCKS; bz++) {
    for (let bx = 0; bx < BLOCKS; bx++) {
      const lv = blockLevel[bz * BLOCKS + bx]!;
      if (lv < 0) continue;
      const a = vert(bx, bz + 1, lv);
      const b = vert(bx + 1, bz + 1, lv);
      const c = vert(bx + 1, bz, lv);
      const d = vert(bx, bz, lv);
      idx[ni++] = a; idx[ni++] = b; idx[ni++] = c;
      idx[ni++] = a; idx[ni++] = c; idx[ni++] = d;
    }
  }
  return { positions: pos.slice(0, nv * 3), shore: shore.slice(0, nv), indices: idx };
}

function meshFeatures(b: QuadBuilder, region: RegionData, x0: number, z0: number): void {
  const cells = region.cells;
  for (const f of region.features) {
    if (f.x < x0 || f.x >= x0 + CHUNK || f.z < z0 || f.z >= z0 + CHUNK) continue;
    const xm = f.x * VOXEL;
    const zm = f.z * VOXEL;
    if (f.type === FEATURE_TREE) {
      const i = f.z * REGION + f.x;
      const base = cells[PLANE * F_GROUND_H + i]! + cells[PLANE * F_STRUCT_H + i]!;
      const trunkTop = base + Math.max(1, f.param - 2);
      b.box(xm, base * VOXEL, zm, xm + VOXEL, trunkTop * VOXEL, zm + VOXEL, MAT.TRUNK, false);
      b.box(
        xm - VOXEL, trunkTop * VOXEL, zm - VOXEL,
        xm + 2 * VOXEL, (trunkTop + 2) * VOXEL, zm + 2 * VOXEL,
        MAT.LEAVES, true,
      );
    } else if (f.type === FEATURE_BRIDGE_DECK) {
      b.box(xm, f.param * VOXEL, zm, xm + VOXEL, (f.param + 1) * VOXEL, zm + VOXEL, MAT.BRIDGE, true);
    }
  }
}

export function meshChunk(region: RegionData, cx: number, cz: number, edges?: RegionEdges): ChunkMeshResult {
  const b = new QuadBuilder();
  const x0 = cx * CHUNK;
  const z0 = cz * CHUNK;
  meshTops(b, region.cells, x0, z0);
  meshSides(b, region.cells, x0, z0, edges);
  meshFeatures(b, region, x0, z0);
  return { ...b.build(), water: meshWater(region.cells, x0, z0, edges) };
}

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

export interface ChunkMesh {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
}

const PLANE = REGION * REGION;
const SIDE_SHADE = 0.8;
const BOTTOM_SHADE = 0.65;

/** Growable quad buffer producing the final typed arrays. */
class QuadBuilder {
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
      topKey[lz * CHUNK + lx] = ((gh + sh) << 8) | mat;
    }
  }
  const used = new Uint8Array(CHUNK * CHUNK);
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
function meshSides(b: QuadBuilder, cells: Uint8Array, x0: number, z0: number): void {
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

export function meshChunk(region: RegionData, cx: number, cz: number): ChunkMesh {
  const b = new QuadBuilder();
  const x0 = cx * CHUNK;
  const z0 = cz * CHUNK;
  meshTops(b, region.cells, x0, z0);
  meshSides(b, region.cells, x0, z0);
  meshFeatures(b, region, x0, z0);
  return b.build();
}

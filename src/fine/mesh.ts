/**
 * Greedy mesher for the fine ground grid. Output uses the coarse chunk vertex layout (positions,
 * normals, AO-multiplied colours, `walls` with the ground material id in x) so the same chunk
 * material renders it. Positions are chunk-local metres; the mesh sits at the chunk's NW corner.
 *
 * Seams follow the coarse mesher's rule: a side face belongs to the higher of two neighbouring
 * columns and spans down to the neighbour's top. Cells without fine ground (water, buildings) and
 * cells outside the chunk are measured with their coarse heights, so a fine chunk meets its coarse
 * (or fine) neighbours exactly; neighbouring fine chunks only ever add faces hidden inside solid.
 */
import { QuadBuilder, type ChunkMesh } from '../world/mesher.ts';
import { MAT } from '../world/materials.ts';
import { PATCH_PLANE, PATCH_W, P_GH, P_MAT, P_SH } from './patch.ts';
import { CM_PER_VOXEL, FINE_CELL, FINE_N, FINE_PER_COARSE, NO_GROUND, type FineGrid } from './raster.ts';

export interface FineMesh extends ChunkMesh {
  /** Absolute top height in cm per fine cell (row-major, NO_GROUND where the cell has no fine ground). */
  raster: Uint16Array;
}

/** Side-face material below a ground cell of material `m`. */
export function sideMaterial(m: number): number {
  switch (m) {
    case MAT.GRASS:
    case MAT.PARK:
    case MAT.FOREST:
      return MAT.DIRT;
    case MAT.SIDEWALK:
    case MAT.PAVING:
    case MAT.PLAZA:
      return MAT.KERB;
    case MAT.MARKING:
    case MAT.STEEL:
      return MAT.ASPHALT;
    default:
      return m;
  }
}

const topKey = new Int32Array(FINE_N * FINE_N);
const used = new Uint8Array(FINE_N * FINE_N);

function meshTops(b: QuadBuilder, g: FineGrid): void {
  for (let i = 0; i < FINE_N * FINE_N; i++) {
    const m = g.mat[i]!;
    topKey[i] = m === 0 ? -1 : (g.ao[i]! << 24) | (g.hcm[i]! << 8) | m;
  }
  for (let k = 0; k < FINE_N * FINE_N; k++) used[k] = topKey[k] === -1 ? 1 : 0;
  for (let cz = 0; cz < FINE_N; cz++) {
    for (let cx = 0; cx < FINE_N; cx++) {
      const s = cz * FINE_N + cx;
      if (used[s]) continue;
      const key = topKey[s]!;
      let w = 1;
      while (cx + w < FINE_N && !used[s + w] && topKey[s + w] === key) w++;
      let h = 1;
      outer: while (cz + h < FINE_N) {
        const row = s + h * FINE_N;
        for (let k = 0; k < w; k++) {
          if (used[row + k] || topKey[row + k] !== key) break outer;
        }
        h++;
      }
      for (let dz = 0; dz < h; dz++) used.fill(1, s + dz * FINE_N, s + dz * FINE_N + w);
      const lvl = key >> 24;
      b.top(
        cx * FINE_CELL, (cx + w) * FINE_CELL, ((key >> 8) & 0xffff) / 100,
        cz * FINE_CELL, (cz + h) * FINE_CELL, key & 255,
        lvl | (lvl << 2) | (lvl << 4) | (lvl << 6),
      );
    }
  }
}

// result of faceFor()
let fy0 = 0;
let fy1 = 0;
let fmat = 0;

/**
 * Side face of cell (cx, cz) towards neighbour (nx, nz) (either may be outside the chunk by one
 * cell): sets fy0/fy1 (cm) and fmat and returns true when the cell is higher than the neighbour.
 */
function faceFor(g: FineGrid, patch: Uint8Array, cx: number, cz: number, nx: number, nz: number): boolean {
  const i = cz * FINE_N + cx;
  let top: number;
  let mat: number;
  if (g.mat[i] !== 0) {
    top = g.hcm[i]!;
    mat = sideMaterial(g.mat[i]!);
  } else {
    // no fine ground here: the coarse ground part (soil step) still belongs to this cell
    const pi = (Math.floor(cz / FINE_PER_COARSE) + 1) * PATCH_W + Math.floor(cx / FINE_PER_COARSE) + 1;
    top = patch[P_GH * PATCH_PLANE + pi]! * CM_PER_VOXEL;
    const gm = patch[P_MAT * PATCH_PLANE + pi]!;
    mat = gm === MAT.GRASS || gm === MAT.PARK || gm === MAT.FOREST ? MAT.DIRT : gm;
  }
  let nTop: number;
  if (nx >= 0 && nx < FINE_N && nz >= 0 && nz < FINE_N && g.mat[nz * FINE_N + nx] !== 0) {
    nTop = g.hcm[nz * FINE_N + nx]!;
  } else {
    const pi = (Math.floor(nz / FINE_PER_COARSE) + 1) * PATCH_W + Math.floor(nx / FINE_PER_COARSE) + 1;
    nTop = (patch[P_GH * PATCH_PLANE + pi]! + patch[P_SH * PATCH_PLANE + pi]!) * CM_PER_VOXEL;
  }
  if (top <= nTop) return false;
  fy0 = nTop;
  fy1 = top;
  fmat = mat;
  return true;
}

/** dir: 0=+X, 1=-X, 2=+Z, 3=-Z, merged along the run axis like the coarse side faces. */
function meshSides(b: QuadBuilder, g: FineGrid, patch: Uint8Array): void {
  for (let dir = 0; dir < 4; dir++) {
    const alongX = dir >= 2;
    const step = dir === 0 || dir === 2 ? 1 : -1;
    const positive = step === 1;
    for (let a = 0; a < FINE_N; a++) {
      let runStart = -1;
      let runY0 = 0, runY1 = 0, runMat = 0;
      for (let bi = 0; bi <= FINE_N; bi++) {
        let has = false;
        if (bi < FINE_N) {
          const cx = alongX ? bi : a;
          const cz = alongX ? a : bi;
          has = faceFor(g, patch, cx, cz, alongX ? cx : cx + step, alongX ? cz + step : cz);
        }
        const continues = has && runStart >= 0 && fy0 === runY0 && fy1 === runY1 && fmat === runMat;
        if (continues) continue;
        if (runStart >= 0) {
          const ya = runY0 / 100, yb = runY1 / 100;
          if (alongX) {
            const z = (a + (positive ? 1 : 0)) * FINE_CELL;
            b.wallZ(z, ya, yb, runStart * FINE_CELL, bi * FINE_CELL, positive, runMat);
          } else {
            const x = (a + (positive ? 1 : 0)) * FINE_CELL;
            b.wallX(x, ya, yb, runStart * FINE_CELL, bi * FINE_CELL, positive, runMat);
          }
          runStart = -1;
        }
        if (has) {
          runStart = bi;
          runY0 = fy0;
          runY1 = fy1;
          runMat = fmat;
        }
      }
    }
  }
}

/** Meshes a rasterised chunk and extracts the physics height raster. */
export function meshFineGround(g: FineGrid, patch: Uint8Array): FineMesh {
  const b = new QuadBuilder();
  meshTops(b, g);
  meshSides(b, g, patch);
  const raster = new Uint16Array(FINE_N * FINE_N);
  for (let i = 0; i < raster.length; i++) raster[i] = g.mat[i] === 0 ? NO_GROUND : g.hcm[i]!;
  return { ...b.build(), raster };
}

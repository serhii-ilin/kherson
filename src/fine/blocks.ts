/**
 * Block mesher: greedy meshing of a 1 m block window into the chunk vertex layout (positions,
 * normals, AO-multiplied colours, `walls`, indices), so the shared chunk material renders it.
 *
 * The window is the chunk's 64x64 columns plus a one-block margin on each side (66x66): the margin is
 * generated with the same rules as the neighbouring chunk, so a face is emitted exactly when the block
 * next to it (possibly in the next chunk) is air, and ambient occlusion samples agree across borders.
 * Only the inner 64x64 columns are meshed; positions are chunk-local metres.
 *
 * `walls` (see QuadBuilder): wall-style faces carry the style id, a 1 m "carved" marker
 * (w = 2 + contact) that tells the facade shader to skip its procedural windows, and the column's
 * lowest block as the wall base. GLASS and SHOPFRONT faces carry their own id for glass shading.
 */
import { BOTTOM_SHADE, QuadBuilder, SIDE_SHADE, type ChunkMesh } from '../world/mesher.ts';
import { MAT } from '../world/materials.ts';
import { VOL_XZ, VOL_Y } from './volume.ts';

/** Margin (blocks) around the chunk in a window. */
export const BLOCK_PAD = 1;
/** Window side in blocks. */
export const BLOCK_WIN = VOL_XZ + 2 * BLOCK_PAD;

/** A chunk's block window: (VOL_XZ + 2) squared columns, VOL_Y high, on the global 1 m grid. */
export class BlockWindow {
  /** World metres of the window's NW corner (the chunk corner minus the margin). */
  readonly x0: number;
  readonly z0: number;
  readonly mats = new Uint8Array(BLOCK_WIN * BLOCK_WIN * VOL_Y);
  /** 1 on columns inside a building footprint (see addBuildings). */
  readonly foot = new Uint8Array(BLOCK_WIN * BLOCK_WIN);

  constructor(chunkX0: number, chunkZ0: number) {
    this.x0 = chunkX0 - BLOCK_PAD;
    this.z0 = chunkZ0 - BLOCK_PAD;
  }

  get size(): number { return BLOCK_WIN; }

  clear(chunkX0: number, chunkZ0: number): void {
    (this as { x0: number }).x0 = chunkX0 - BLOCK_PAD;
    (this as { z0: number }).z0 = chunkZ0 - BLOCK_PAD;
    this.mats.fill(0);
    this.foot.fill(0);
  }

  get(wx: number, y: number, wz: number): number {
    const x = wx - this.x0, z = wz - this.z0;
    if (x < 0 || z < 0 || x >= BLOCK_WIN || z >= BLOCK_WIN || y < 0 || y >= VOL_Y) return 0;
    return this.mats[(y * BLOCK_WIN + z) * BLOCK_WIN + x]!;
  }

  set(wx: number, y: number, wz: number, m: number): void {
    const x = wx - this.x0, z = wz - this.z0;
    if (x < 0 || z < 0 || x >= BLOCK_WIN || z >= BLOCK_WIN || y < 0 || y >= VOL_Y) return;
    this.mats[(y * BLOCK_WIN + z) * BLOCK_WIN + x] = m;
  }
}

const WALL_MIN = 20;
const WALL_MAX = 39;

function isWallMat(m: number): boolean {
  return m >= WALL_MIN && m <= WALL_MAX;
}

/**
 * Greedy-meshes the inner (size - 2*pad)^2 columns of `mats` (a size x size x VOL_Y block array).
 * `groundY` (optional, size*size, metres) marks the terrain: bottom faces at or below it are not emitted.
 */
export function meshBlocks(mats: Uint8Array, size: number, pad: number, groundY?: Uint8Array): ChunkMesh {
  const S = size;
  const S2 = S * S;
  const lo = pad;
  const hi = size - pad; // exclusive
  const n = hi - lo;

  // vertical extent and per-column lowest block
  const lowest = new Uint8Array(S2).fill(255);
  let ymax = 0;
  for (let y = 0; y < VOL_Y; y++) {
    const row = y * S2;
    for (let c = 0; c < S2; c++) {
      if (mats[row + c] !== 0) {
        if (lowest[c] === 255) lowest[c] = y;
        ymax = y + 1;
      }
    }
  }
  const b = new QuadBuilder();
  if (ymax === 0) return b.build();

  const occ = (x: number, y: number, z: number): number => {
    if (y < 0 || y >= VOL_Y || x < 0 || x >= S || z < 0 || z >= S) return 0;
    return mats[y * S2 + z * S + x] !== 0 ? 1 : 0;
  };

  // axis ranges: x and z inner, y full
  const rangeLo = [lo, 0, lo];
  const rangeHi = [hi, ymax, hi];
  const mask = new Int32Array(Math.max(n, ymax) * Math.max(n, ymax));
  const c3 = [0, 0, 0];
  const t1 = [0, 0, 0];
  const t2 = [0, 0, 0];

  const aoOf = (a: number, sg: number, c: number[], su: number, sv: number): number => {
    // cell c, normal axis a / sign sg; tangent axes ta = (a+1)%3, tb = (a+2)%3; corner signs (su, sv)
    const ta = (a + 1) % 3, tb = (a + 2) % 3;
    t1[0] = c[0]!; t1[1] = c[1]!; t1[2] = c[2]!;
    t1[a]! += sg;
    const bx = t1[0]!, by = t1[1]!, bz = t1[2]!;
    const sx1 = ta === 0 ? su : 0, sy1 = ta === 1 ? su : 0, sz1 = ta === 2 ? su : 0;
    const sx2 = tb === 0 ? sv : 0, sy2 = tb === 1 ? sv : 0, sz2 = tb === 2 ? sv : 0;
    const s1 = occ(bx + sx1, by + sy1, bz + sz1);
    const s2 = occ(bx + sx2, by + sy2, bz + sz2);
    const co = occ(bx + sx1 + sx2, by + sy1 + sy2, bz + sz1 + sz2);
    return s1 && s2 ? 0 : 3 - (s1 + s2 + co);
  };

  for (let a = 0; a < 3; a++) {
    const ta = (a + 1) % 3, tb = (a + 2) % 3;
    const nu = rangeHi[ta]! - rangeLo[ta]!;
    const nv = rangeHi[tb]! - rangeLo[tb]!;
    for (let sgi = 0; sgi < 2; sgi++) {
      const sg = sgi === 0 ? 1 : -1;
      for (let ca = rangeLo[a]!; ca < rangeHi[a]!; ca++) {
        let any = false;
        c3[a] = ca;
        for (let v = 0; v < nv; v++) {
          c3[tb] = rangeLo[tb]! + v;
          for (let u = 0; u < nu; u++) {
            c3[ta] = rangeLo[ta]! + u;
            const m = mats[c3[1]! * S2 + c3[2]! * S + c3[0]!]!;
            let key = 0;
            if (m !== 0) {
              const nx = c3[0]! + (a === 0 ? sg : 0);
              const ny = c3[1]! + (a === 1 ? sg : 0);
              const nz = c3[2]! + (a === 2 ? sg : 0);
              if (occ(nx, ny, nz) === 0) {
                let skip = false;
                if (a === 1 && sg < 0 && groundY !== undefined && c3[1]! <= groundY[c3[2]! * S + c3[0]!]!) skip = true;
                if (!skip) {
                  // corner AO in the order (u0,v0) (u1,v0) (u1,v1) (u0,v1)
                  // Vertical faces stay flat: per-corner AO on every window reveal and balcony would
                  // stop quads merging and double the triangle count for little visible gain (the
                  // shader darkens wall bases, the sun shades the reveals). Tops and bottoms keep AO.
                  const flat = a !== 1;
                  const a00 = flat ? 3 : aoOf(a, sg, c3, -1, -1);
                  const a10 = flat ? 3 : aoOf(a, sg, c3, 1, -1);
                  const a11 = flat ? 3 : aoOf(a, sg, c3, 1, 1);
                  const a01 = flat ? 3 : aoOf(a, sg, c3, -1, 1);
                  const ao = a00 | (a10 << 2) | (a11 << 4) | (a01 << 6);
                  const base = isWallMat(m) ? lowest[c3[2]! * S + c3[0]!]! : 0;
                  key = m | (ao << 8) | (base << 16);
                  any = true;
                }
              }
            }
            mask[v * nu + u] = key;
          }
        }
        if (!any) continue;
        // greedy rectangles
        for (let v = 0; v < nv; v++) {
          for (let u = 0; u < nu; u++) {
            const k = mask[v * nu + u]!;
            if (k === 0) continue;
            const ao = (k >> 8) & 255;
            const a00 = ao & 3, a10 = (ao >> 2) & 3, a11 = (ao >> 4) & 3, a01 = (ao >> 6) & 3;
            const alongU = a00 === a10 && a01 === a11;
            const alongV = a00 === a01 && a10 === a11;
            let w = 1;
            if (alongU) while (u + w < nu && mask[v * nu + u + w] === k) w++;
            let h = 1;
            if (alongV) {
              outer: while (v + h < nv) {
                for (let i = 0; i < w; i++) if (mask[(v + h) * nu + u + i] !== k) break outer;
                h++;
              }
            }
            for (let j = 0; j < h; j++) mask.fill(0, (v + j) * nu + u, (v + j) * nu + u + w);
            emit(b, a, sg, ca - (a === 1 ? 0 : pad), rangeLo[ta]! - (ta === 1 ? 0 : pad) + u, rangeLo[tb]! - (tb === 1 ? 0 : pad) + v, w, h, k);
          }
        }
      }
    }
  }
  return b.build();
}

const P = [0, 0, 0];

/** Emits one merged face. (cu, cv) are chunk-local tangent coordinates of the rectangle's low corner. */
function emit(b: QuadBuilder, a: number, sg: number, ca: number, cu: number, cv: number, w: number, h: number, key: number): void {
  const mat = key & 255;
  const ao = (key >> 8) & 255;
  const base = (key >> 16) & 255;
  const ta = (a + 1) % 3, tb = (a + 2) % 3;
  const plane = sg > 0 ? ca + 1 : ca;
  // corners (u0,v0) (u1,v0) (u1,v1) (u0,v1)
  const cuv = [cu, cu + w, cu + w, cu];
  const cvv = [cv, cv, cv + h, cv + h];
  const order = sg > 0 ? [0, 1, 2, 3] : [0, 3, 2, 1];
  const xs: number[] = [0, 0, 0, 0];
  const ys: number[] = [0, 0, 0, 0];
  const zs: number[] = [0, 0, 0, 0];
  let packed = 0;
  const aoc = [ao & 3, (ao >> 2) & 3, (ao >> 4) & 3, (ao >> 6) & 3];
  for (let i = 0; i < 4; i++) {
    const ci = order[i]!;
    P[a] = plane;
    P[ta] = cuv[ci]!;
    P[tb] = cvv[ci]!;
    xs[i] = P[0]!; ys[i] = P[1]!; zs[i] = P[2]!;
    packed |= aoc[ci]! << (i * 2);
  }
  const nx = a === 0 ? sg : 0, ny = a === 1 ? sg : 0, nz = a === 2 ? sg : 0;
  const shade = a === 1 ? (sg > 0 ? 1 : BOTTOM_SHADE) : SIDE_SHADE;
  let wTop = 0, wBase = 0, wContact = 0, wMat = -1;
  if (isWallMat(mat)) {
    wTop = 1;
    wBase = base;
    wContact = 3; // carved (2) + ground contact (1)
  } else if (mat >= MAT.GLASS && mat < 60) {
    wTop = 1;
    wMat = mat;
  }
  b.quad(
    xs[0]!, ys[0]!, zs[0]!, xs[1]!, ys[1]!, zs[1]!, xs[2]!, ys[2]!, zs[2]!, xs[3]!, ys[3]!, zs[3]!,
    nx, ny, nz, mat, shade, packed, wTop, wBase, wContact, wMat,
  );
}

/**
 * Physics raster of the chunk's inner columns (row-major VOL_XZ x VOL_XZ, metres, 0 = none):
 *  - building footprint columns: the highest solid block + 1 (overhangs are part of the column);
 *  - other columns: the top of the solid run that starts at the ground (within 1 m of `groundY`), so
 *    piers and ramps count while balconies, canopies and bridge decks above open air do not.
 */
export function columnTops(mats: Uint8Array, size: number, pad: number, foot: Uint8Array, groundY: Uint8Array): Uint8Array {
  const S2 = size * size;
  const n = size - 2 * pad;
  const out = new Uint8Array(n * n);
  for (let z = 0; z < n; z++) {
    for (let x = 0; x < n; x++) {
      const c = (z + pad) * size + x + pad;
      let top = 0;
      if (foot[c] === 1) {
        for (let y = VOL_Y - 1; y >= 0; y--) {
          if (mats[y * S2 + c] !== 0) { top = y + 1; break; }
        }
      } else {
        const g = groundY[c]!;
        let y = 0;
        while (y < VOL_Y && mats[y * S2 + c] === 0) y++;
        if (y < VOL_Y && y <= g + 1) {
          while (y < VOL_Y && mats[y * S2 + c] !== 0) y++;
          top = y;
        }
      }
      out[z * n + x] = top;
    }
  }
  return out;
}

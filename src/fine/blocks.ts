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
 * Vertical faces also add 4 * a 4-bit recess mask to w (bit0 +u, bit1 -u, bit2 +v, bit3 -v for the face's
 * tangent axes (a+1)%3, (a+2)%3: x/y/z = 0/1/2): which neighbours of the outward cell are solid.
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
  /** Per-building tint 0..3 of the building on each footprint column (see buildings.ts buildingTint). */
  readonly tint = new Uint8Array(BLOCK_WIN * BLOCK_WIN);

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
    this.tint.fill(0);
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
 * `tints` (optional, size*size) gives each wall column's per-building tint 0..3 (bits 28..29 of the merge key).
 */
export function meshBlocks(
  mats: Uint8Array, size: number, pad: number, groundY?: Uint8Array, tints?: Uint8Array,
): ChunkMesh {
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
  if (ymax === 0) return b.buildNoRuns();

  const occ = (x: number, y: number, z: number): number => {
    if (y < 0 || y >= VOL_Y || x < 0 || x >= S || z < 0 || z >= S) return 0;
    return mats[y * S2 + z * S + x] !== 0 ? 1 : 0;
  };

  // axis ranges: x and z inner, y full
  const rangeLo = [lo, 0, lo];
  const rangeHi = [hi, ymax, hi];
  const mask = new Int32Array(Math.max(n, ymax) * Math.max(n, ymax));
  const mask2 = new Int32Array(mask.length);
  const rects: number[] = [];
  const rects2: number[] = [];
  const rects3: number[] = [];
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
                  // recess mask: which of the outward cell's four tangent neighbours are solid (vertical
                  // faces only). The shader turns it into a cheap per-cell edge gradient, so reveals and
                  // balcony undersides get occlusion without per-corner AO splitting the greedy quads.
                  let rmask = 0;
                  if (flat && isWallMat(m)) {
                    const tu = ta === 0 ? 1 : 0, tv = ta === 1 ? 1 : 0, tw = ta === 2 ? 1 : 0;
                    const su = tb === 0 ? 1 : 0, sv = tb === 1 ? 1 : 0, sw = tb === 2 ? 1 : 0;
                    // a slot: solid on both sides along one tangent axis (window head and sill, side piers)
                    if ((occ(nx + tu, ny + tv, nz + tw) && occ(nx - tu, ny - tv, nz - tw)) ||
                      (occ(nx + su, ny + sv, nz + sw) && occ(nx - su, ny - sv, nz - sw))) rmask = 1;
                  }
                  key = m | (ao << 8) | (base << 16) | (rmask << 24) | (isWallMat(m) && tints !== undefined ? tints[c3[2]! * S + c3[0]!]! << 28 : 0);
                  any = true;
                }
              }
            }
            mask[v * nu + u] = key;
          }
        }
        if (!any) continue;
        // Three covers, the one with the fewest quads wins: row-first, column-first, and "long runs first"
        // (strips of >= LONG_RUN cells along either axis are cut before the short pieces, so a facade's
        // floor slabs stay single strips instead of being chopped by the window piers).
        rects.length = 0;
        mask2.set(mask.subarray(0, nu * nv));
        let best = rects;
        let bestN = greedy(mask2, nu, nv, false, rects);
        rects2.length = 0;
        mask2.set(mask.subarray(0, nu * nv));
        const nV = greedy(mask2, nu, nv, true, rects2);
        if (nV < bestN) { best = rects2; bestN = nV; }
        rects3.length = 0;
        mask2.set(mask.subarray(0, nu * nv));
        let nL = greedy(mask2, nu, nv, false, rects3, LONG_RUN);
        nL += greedy(mask2, nu, nv, true, rects3, LONG_RUN);
        nL += greedy(mask2, nu, nv, false, rects3);
        if (nL < bestN) best = rects3;
        for (let r = 0; r < best.length; r += 5) {
          const u = best[r]!, v = best[r + 1]!, w = best[r + 2]!, h = best[r + 3]!;
          emit(b, a, sg, ca - (a === 1 ? 0 : pad), rangeLo[ta]! - (ta === 1 ? 0 : pad) + u, rangeLo[tb]! - (tb === 1 ? 0 : pad) + v, w, h, best[r + 4]!);
        }
      }
    }
  }
  return b.buildNoRuns();
}

/**
 * Greedy rectangle cover of a nu x nv key mask (consumed). Cells merge when everything but the AO
 * matches and the cells' corner AO is exactly the bilinear surface of the rectangle's four outer corners
 * (a constant AO is the common case; a linear ramp such as a roof edge shading off merges too), so the
 * merged quad shades identically to its cells. `vFirst` extends along v before u. Appends
 * [u, v, w, h, key-with-merged-AO] per rectangle to `out` and returns the rectangle count. Rectangles
 * shorter than `minLen` along the first axis are skipped (left in the mask for a later pass).
 */
function greedy(mask: Int32Array, nu: number, nv: number, vFirst: boolean, out: number[], minLen = 1): number {
  let count = 0;
  for (let v = 0; v < nv; v++) {
    for (let u = 0; u < nu; u++) {
      const k = mask[v * nu + u]!;
      if (k === 0) continue;
      // a start cell with four equal corner levels merges with any identical cell without a check
      const ao0 = (k >> 8) & 255;
      const flat0 = ao0 === (ao0 & 3) * 0x55;
      let w = 1;
      let h = 1;
      if (!vFirst) {
        while (u + w < nu) {
          const n = mask[v * nu + u + w]!;
          if (!sameKey(n, k)) break;
          if (!(flat0 && ((n >> 8) & 255) === ao0) && !aoBilinear(mask, nu, u, v, w + 1, 1)) break;
          w++;
        }
        outer: while (v + h < nv) {
          let rowSame = true;
          for (let i = 0; i < w; i++) {
            const n = mask[(v + h) * nu + u + i]!;
            if (!sameKey(n, k)) break outer;
            if (((n >> 8) & 255) !== ao0) rowSame = false;
          }
          if (!(flat0 && rowSame) && !aoBilinear(mask, nu, u, v, w, h + 1)) break;
          h++;
        }
      } else {
        while (v + h < nv) {
          const n = mask[(v + h) * nu + u]!;
          if (!sameKey(n, k)) break;
          if (!(flat0 && ((n >> 8) & 255) === ao0) && !aoBilinear(mask, nu, u, v, 1, h + 1)) break;
          h++;
        }
        outer2: while (u + w < nu) {
          let colSame = true;
          for (let j = 0; j < h; j++) {
            const n = mask[(v + j) * nu + u + w]!;
            if (!sameKey(n, k)) break outer2;
            if (((n >> 8) & 255) !== ao0) colSame = false;
          }
          if (!(flat0 && colSame) && !aoBilinear(mask, nu, u, v, w + 1, h)) break;
          w++;
        }
      }
      if ((vFirst ? h : w) < minLen) continue;
      const ao = rectAO(mask, nu, u, v, w, h);
      for (let j = 0; j < h; j++) mask.fill(0, (v + j) * nu + u, (v + j) * nu + u + w);
      out.push(u, v, w, h, (k & ~(255 << 8)) | (ao << 8));
      count++;
    }
  }
  return count;
}

const SMALL_FACE = 4;
/** Strips at least this long (cells) are cut first by the long-runs cover. */
const LONG_RUN = 8;

/** True when two mask keys differ at most in their packed AO (bits 8..15). */
function sameKey(a: number, b: number): boolean {
  return b !== 0 && ((a ^ b) & ~(255 << 8)) === 0;
}

/** AO level (0..3) of corner `c` (0 = (u0,v0), 1 = (u1,v0), 2 = (u1,v1), 3 = (u0,v1)) of the mask cell at `i`. */
function cornerAO(mask: Int32Array, i: number, c: number): number {
  return (mask[i]! >> (8 + 2 * c)) & 3;
}

/**
 * True when the w x h cells at (u, v) can be one quad: the AO level at every cell corner equals the
 * bilinear interpolation of the rectangle's four outer corners (compared in integers, scaled by w*h).
 */
function aoBilinear(mask: Int32Array, nu: number, u: number, v: number, w: number, h: number): boolean {
  if (w === 1 && h === 1) return true;
  const c00 = cornerAO(mask, v * nu + u, 0);
  const c10 = cornerAO(mask, v * nu + u + w - 1, 1);
  const c11 = cornerAO(mask, (v + h - 1) * nu + u + w - 1, 2);
  const c01 = cornerAO(mask, (v + h - 1) * nu + u, 3);
  const wh = w * h;
  const tol = wh <= SMALL_FACE ? wh : 0;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const cell = (v + j) * nu + u + i;
      for (let c = 0; c < 4; c++) {
        const I = i + (c === 1 || c === 2 ? 1 : 0);
        const J = j + (c >= 2 ? 1 : 0);
        const want = c00 * (w - I) * (h - J) + c10 * I * (h - J) + c11 * I * J + c01 * (w - I) * J;
        if (Math.abs(want - cornerAO(mask, cell, c) * wh) > tol) return false;
      }
    }
  }
  return true;
}

/** Packed AO of the merged quad: the outer corners of the rectangle. */
function rectAO(mask: Int32Array, nu: number, u: number, v: number, w: number, h: number): number {
  return cornerAO(mask, v * nu + u, 0)
    | (cornerAO(mask, v * nu + u + w - 1, 1) << 2)
    | (cornerAO(mask, (v + h - 1) * nu + u + w - 1, 2) << 4)
    | (cornerAO(mask, (v + h - 1) * nu + u, 3) << 6);
}

const P = [0, 0, 0];

/** Emits one merged face. (cu, cv) are chunk-local tangent coordinates of the rectangle's low corner. */
function emit(b: QuadBuilder, a: number, sg: number, ca: number, cu: number, cv: number, w: number, h: number, key: number): void {
  const mat = key & 255;
  const ao = (key >> 8) & 255;
  const base = (key >> 16) & 255;
  const rmask = (key >> 24) & 15;
  const tint = (key >> 28) & 3;
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
    wContact = 3 + rmask * 4; // carved (2) + ground contact (1) + 4 * recess mask
  } else if (mat >= MAT.GLASS && mat < 60) {
    wTop = 1;
    wMat = mat;
  }
  b.quad(
    xs[0]!, ys[0]!, zs[0]!, xs[1]!, ys[1]!, zs[1]!, xs[2]!, ys[2]!, zs[2]!, xs[3]!, ys[3]!, zs[3]!,
    nx, ny, nz, mat, shade, packed, wTop, wBase, wContact, wMat, tint,
  );
}

/** Physics rasters of a chunk's inner columns (row-major VOL_XZ x VOL_XZ, metres, 0 = none). */
export interface ColumnPhysics {
  /** Ground-supported surface: see {@link columnPhysics}. */
  tops: Uint8Array;
  /** Walkable top of a bridge deck that floats above the ground (walkers pass under it). */
  decks: Uint8Array;
  /** Bottom (= deck surface) of a 1 m bridge railing standing on a deck, 0 = none; railings are solid walls. */
  rails: Uint8Array;
}

/**
 * Physics rasters of the chunk's inner columns:
 *  - `tops`, building footprint columns: the highest solid block + 1 (overhangs are part of the column);
 *  - `tops`, other columns: the top of the solid run that starts at the ground (within 1 m of `groundY`),
 *    so piers and ramps count while balconies and canopies above open air do not;
 *  - `decks`: a run that starts higher above the ground but contains BRIDGE blocks is a bridge deck: its
 *    walking surface (the highest non-METAL block + 1) goes here, so the 1 m deck replaces the coarse 2 m
 *    one over water and the walker can still pass under it (FineWorld honours the walker's height);
 *  - `rails`: METAL blocks capping a bridge run (the railings) are not walkable surface; their bottom is
 *    recorded so they act as 1 m walls. Only runs containing BRIDGE count, so door canopies and
 *    balcony rails (also METAL) never become solid or walkable.
 */
export function columnPhysics(mats: Uint8Array, size: number, pad: number, foot: Uint8Array, groundY: Uint8Array): ColumnPhysics {
  const S2 = size * size;
  const n = size - 2 * pad;
  const tops = new Uint8Array(n * n);
  const decks = new Uint8Array(n * n);
  const rails = new Uint8Array(n * n);
  for (let z = 0; z < n; z++) {
    for (let x = 0; x < n; x++) {
      const c = (z + pad) * size + x + pad;
      const o = z * n + x;
      if (foot[c] === 1) {
        for (let y = VOL_Y - 1; y >= 0; y--) {
          if (mats[y * S2 + c] !== 0) { tops[o] = y + 1; break; }
        }
        continue;
      }
      const g = groundY[c]!;
      let y = 0;
      let firstRun = true;
      while (y < VOL_Y) {
        while (y < VOL_Y && mats[y * S2 + c] === 0) y++;
        if (y >= VOL_Y) break;
        const y0 = y;
        let bridge = false;
        let walk = 0; // top of the highest block that is not a railing cap
        while (y < VOL_Y && mats[y * S2 + c] !== 0) {
          const m = mats[y * S2 + c]!;
          if (m === MAT.BRIDGE) bridge = true;
          if (m !== MAT.METAL) walk = y + 1;
          y++;
        }
        const grounded = firstRun && y0 <= g + 1;
        firstRun = false;
        if (bridge && walk > 0) {
          const hasRail = y > walk;
          if (grounded) tops[o] = walk;
          else if (walk > decks[o]!) decks[o] = walk;
          if (hasRail) rails[o] = walk;
        } else if (grounded) {
          tops[o] = y;
        }
      }
    }
  }
  return { tops, decks, rails };
}

/** The ground-supported column tops of {@link columnPhysics}. */
export function columnTops(mats: Uint8Array, size: number, pad: number, foot: Uint8Array, groundY: Uint8Array): Uint8Array {
  return columnPhysics(mats, size, pad, foot, groundY).tops;
}

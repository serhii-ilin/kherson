/**
 * Raster primitives for the fine ground: a 320x320 grid of 0.2 m cells per 64 m chunk.
 * Pure and allocation-light; everything is in chunk-local metres (x east, z south).
 */
import { CHUNK, VOXEL } from '../world/constants.ts';

/** Fine cell size in metres. */
export const FINE_CELL = 0.2;
/** Fine cells per chunk side (64 m / 0.2 m). */
export const FINE_N = (CHUNK * VOXEL) / FINE_CELL;
/** Fine cells per coarse (2 m) cell side. */
export const FINE_PER_COARSE = VOXEL / FINE_CELL;
/** Coarse voxel height in cm. */
export const CM_PER_VOXEL = VOXEL * 100;
/** Chunk side in metres. */
export const CHUNK_SIZE_M = CHUNK * VOXEL;
/** Height raster value for cells without fine ground. */
export const NO_GROUND = 0xffff;

export class FineGrid {
  /** Material per cell; 0 = no fine ground (water, buildings). */
  readonly mat = new Uint8Array(FINE_N * FINE_N);
  /** Absolute top height in cm. */
  readonly hcm = new Uint16Array(FINE_N * FINE_N);
  /** Coarse ground height in cm of the containing coarse cell. */
  readonly base = new Uint16Array(FINE_N * FINE_N);
  /** Carriageway owner (road index + 1) of asphalt cells; 0 elsewhere. */
  readonly own = new Uint16Array(FINE_N * FINE_N);
  /** Ground AO level 0 (dark) .. 3 (open) per cell. */
  readonly ao = new Uint8Array(FINE_N * FINE_N).fill(3);
  /**
   * Bridge-deck marking overlay: top height in cm of a marking lying on a 1 m bridge deck (0 = none).
   * Allocated by the ground generator only for chunks with bridge markings; the mesher adds a small
   * lift so the quads sit just above the deck top.
   */
  deckH: Uint16Array | null = null;
}

function clampCell(v: number): number {
  return v < 0 ? 0 : v > FINE_N - 1 ? FINE_N - 1 : v;
}

/**
 * Paints every non-empty cell whose centre is within `r` metres of the polyline.
 * `raise` is the height above the coarse ground in cm (-1 keeps the cell height);
 * `owner` (when non-zero) is recorded in the owner map; `protect[mat]` cells are left alone.
 */
export function paintBuffer(
  g: FineGrid, pts: Float64Array, n: number, r: number,
  mat: number, raise: number, owner: number, protect: Uint8Array | null,
): void {
  const r2 = r * r;
  for (let k = 0; k + 1 < n; k++) {
    const ax = pts[k * 2]!, az = pts[k * 2 + 1]!;
    const ex = pts[k * 2 + 2]! - ax, ez = pts[k * 2 + 3]! - az;
    const l2 = ex * ex + ez * ez;
    const x0 = clampCell(Math.floor((Math.min(ax, ax + ex) - r) / FINE_CELL));
    const x1 = clampCell(Math.floor((Math.max(ax, ax + ex) + r) / FINE_CELL));
    const z0 = clampCell(Math.floor((Math.min(az, az + ez) - r) / FINE_CELL));
    const z1 = clampCell(Math.floor((Math.max(az, az + ez) + r) / FINE_CELL));
    if (Math.max(ax, ax + ex) + r < 0 || Math.min(ax, ax + ex) - r > CHUNK_SIZE_M) continue;
    if (Math.max(az, az + ez) + r < 0 || Math.min(az, az + ez) - r > CHUNK_SIZE_M) continue;
    for (let cz = z0; cz <= z1; cz++) {
      const pz = (cz + 0.5) * FINE_CELL;
      for (let cx = x0; cx <= x1; cx++) {
        const i = cz * FINE_N + cx;
        const m = g.mat[i]!;
        if (m === 0 || (protect !== null && protect[m] === 1)) continue;
        const px = (cx + 0.5) * FINE_CELL;
        let t = l2 > 0 ? ((px - ax) * ex + (pz - az) * ez) / l2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const dx = px - ax - t * ex;
        const dz = pz - az - t * ez;
        if (dx * dx + dz * dz > r2) continue;
        g.mat[i] = mat;
        if (raise >= 0) g.hcm[i] = g.base[i]! + raise;
        if (owner !== 0) g.own[i] = owner;
      }
    }
  }
}

/** Options for {@link paintStripe}. */
export interface StripeOpts {
  /** Signed offset from the polyline (positive = to the right of travel in x-east/z-south axes). */
  offset: number;
  /** Half width of the stripe in metres. */
  half: number;
  /** Dash period in metres (3 m on, centred in each period); 0 = solid. */
  period: number;
  mat: number;
  /** Cells are painted only when their current material is flagged here (null = any non-empty). */
  need: Uint8Array | null;
  /** When non-zero only cells owned by this road are painted. */
  owner: number;
  /** Circular exclusion zones (junctions): x, z, radius squared. */
  zones: Float64Array | null;
  zoneCount: number;
}

export const DASH_ON = 3;

/** Dash period for a polyline of `len` metres: about 9 m, stretched so the line starts and ends in a gap. */
export function dashPeriod(len: number): number {
  const n = Math.max(1, Math.round(len / 9));
  return len / n;
}

/**
 * Paints a stripe parallel to the polyline at `offset`. A cell belongs to a segment only when its
 * projection falls within the segment, so stripes never bulge around corners or past the ends.
 * `cum` holds the arc length at each vertex (for dash phase).
 */
export function paintStripe(g: FineGrid, pts: Float64Array, n: number, cum: Float64Array, o: StripeOpts): void {
  const reach = Math.abs(o.offset) + o.half;
  for (let k = 0; k + 1 < n; k++) {
    const ax = pts[k * 2]!, az = pts[k * 2 + 1]!;
    const bx = pts[k * 2 + 2]!, bz = pts[k * 2 + 3]!;
    const len = cum[k + 1]! - cum[k]!;
    if (len < 1e-6) continue;
    const ux = (bx - ax) / len, uz = (bz - az) / len;
    const nx = -uz, nz = ux;
    const x0 = clampCell(Math.floor((Math.min(ax, bx) - reach) / FINE_CELL));
    const x1 = clampCell(Math.floor((Math.max(ax, bx) + reach) / FINE_CELL));
    const z0 = clampCell(Math.floor((Math.min(az, bz) - reach) / FINE_CELL));
    const z1 = clampCell(Math.floor((Math.max(az, bz) + reach) / FINE_CELL));
    if (Math.max(ax, bx) + reach < 0 || Math.min(ax, bx) - reach > CHUNK_SIZE_M) continue;
    if (Math.max(az, bz) + reach < 0 || Math.min(az, bz) - reach > CHUNK_SIZE_M) continue;
    for (let cz = z0; cz <= z1; cz++) {
      const pz = (cz + 0.5) * FINE_CELL;
      for (let cx = x0; cx <= x1; cx++) {
        const i = cz * FINE_N + cx;
        const m = g.mat[i]!;
        if (m === 0 || (o.need !== null && o.need[m] !== 1)) continue;
        if (o.owner !== 0 && g.own[i] !== o.owner) continue;
        const px = (cx + 0.5) * FINE_CELL;
        const rx = px - ax, rz = pz - az;
        const p = rx * ux + rz * uz;
        if (p < 0 || p > len) continue;
        const v = rx * nx + rz * nz;
        if (v - o.offset > o.half || o.offset - v > o.half) continue;
        if (o.period > 0) {
          const s = cum[k]! + p;
          const mm = s - Math.floor(s / o.period) * o.period;
          if (Math.abs(mm - o.period / 2) > DASH_ON / 2) continue;
        }
        if (o.zones !== null) {
          let blocked = false;
          for (let j = 0; j < o.zoneCount; j++) {
            const dx = px - o.zones[j * 3]!, dz = pz - o.zones[j * 3 + 1]!;
            if (dx * dx + dz * dz < o.zones[j * 3 + 2]!) { blocked = true; break; }
          }
          if (blocked) continue;
        }
        g.mat[i] = o.mat;
      }
    }
  }
}

let crossings = new Float64Array(256);

/**
 * Even-odd scanline fill of polygon rings (outer + holes) given as flat [x, z, ...] metres.
 * Only non-empty cells are repainted (material only; heights are untouched).
 */
export function fillRings(g: FineGrid, rings: Float64Array[], mat: number): void {
  let minZ = Infinity, maxZ = -Infinity, edges = 0;
  for (const r of rings) {
    const n = r.length / 2;
    if (n < 3) return; // degenerate input: ignore the whole polygon
    edges += n;
    for (let i = 0; i < n; i++) {
      const z = r[i * 2 + 1]!;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
  }
  if (rings.length === 0 || maxZ < 0 || minZ > CHUNK_SIZE_M) return;
  if (crossings.length < edges) crossings = new Float64Array(edges * 2);
  const j0 = clampCell(Math.floor(minZ / FINE_CELL));
  const j1 = clampCell(Math.floor(maxZ / FINE_CELL));
  for (let cz = j0; cz <= j1; cz++) {
    const zc = (cz + 0.5) * FINE_CELL;
    let nc = 0;
    for (const r of rings) {
      const n = r.length / 2;
      let px = r[(n - 1) * 2]!, pz = r[(n - 1) * 2 + 1]!;
      for (let i = 0; i < n; i++) {
        const qx = r[i * 2]!, qz = r[i * 2 + 1]!;
        if ((pz <= zc) !== (qz <= zc)) {
          const x = px + ((zc - pz) * (qx - px)) / (qz - pz);
          // insertion sort keeps the crossings ordered
          let k = nc++;
          while (k > 0 && crossings[k - 1]! > x) { crossings[k] = crossings[k - 1]!; k--; }
          crossings[k] = x;
        }
        px = qx;
        pz = qz;
      }
    }
    for (let c = 0; c + 1 < nc; c += 2) {
      const xa = Math.max(0, Math.ceil(crossings[c]! / FINE_CELL - 0.5));
      const xb = Math.min(FINE_N - 1, Math.ceil(crossings[c + 1]! / FINE_CELL - 0.5) - 1);
      for (let cx = xa; cx <= xb; cx++) {
        const i = cz * FINE_N + cx;
        if (g.mat[i] !== 0) g.mat[i] = mat;
      }
    }
  }
}

/**
 * Even-odd scanline fill of rings (outer + holes, flat [x, z, ...] chunk-local metres) into a byte mask
 * covering cells -pad .. FINE_N + pad - 1 on both axes (row length FINE_N + 2 * pad). Sets `value`.
 */
export function fillMask(mask: Uint8Array, pad: number, rings: Float64Array[], value = 1): void {
  const w = FINE_N + 2 * pad;
  let minZ = Infinity, maxZ = -Infinity, edges = 0;
  for (const r of rings) {
    const n = r.length / 2;
    if (n < 3) return;
    edges += n;
    for (let i = 0; i < n; i++) {
      const z = r[i * 2 + 1]!;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
  }
  if (rings.length === 0) return;
  if (crossings.length < edges) crossings = new Float64Array(edges * 2);
  const lo = -pad, hi = FINE_N + pad - 1;
  const j0 = Math.max(lo, Math.floor(minZ / FINE_CELL));
  const j1 = Math.min(hi, Math.floor(maxZ / FINE_CELL));
  for (let cz = j0; cz <= j1; cz++) {
    const zc = (cz + 0.5) * FINE_CELL;
    let nc = 0;
    for (const r of rings) {
      const n = r.length / 2;
      let px = r[(n - 1) * 2]!, pz = r[(n - 1) * 2 + 1]!;
      for (let i = 0; i < n; i++) {
        const qx = r[i * 2]!, qz = r[i * 2 + 1]!;
        if ((pz <= zc) !== (qz <= zc)) {
          const x = px + ((zc - pz) * (qx - px)) / (qz - pz);
          let k = nc++;
          while (k > 0 && crossings[k - 1]! > x) { crossings[k] = crossings[k - 1]!; k--; }
          crossings[k] = x;
        }
        px = qx;
        pz = qz;
      }
    }
    for (let c = 0; c + 1 < nc; c += 2) {
      const xa = Math.max(lo, Math.ceil(crossings[c]! / FINE_CELL - 0.5));
      const xb = Math.min(hi, Math.ceil(crossings[c + 1]! / FINE_CELL - 0.5) - 1);
      for (let cx = xa; cx <= xb; cx++) mask[(cz + pad) * w + cx + pad] = value;
    }
  }
}

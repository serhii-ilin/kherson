/**
 * Pure placement helpers for street detail on the 0.2 m ground (docs/BUILDINGS_PLAN.md task F1):
 * asphalt repair patches, manhole covers, gutter drains and stop lines at traffic signals.
 *
 * Every choice is a hash of the road seed and a running index (Constitution 2.3): there is no
 * `Math.random()` here, so a snapshot always produces the same placements. The helpers take a flat
 * polyline `[x0, z0, x1, z1, ...]` in metres and return placement lists; the rasteriser in
 * `ground.ts` is the only thing that knows about cells and materials.
 */

/** An oriented rectangle on the road, aligned to the tangent at its centre. */
export interface RoadRect {
  /** Centre of the rectangle (metres). */
  x: number;
  z: number;
  /** Unit tangent of travel at the centre. */
  ux: number;
  uz: number;
  /** Full size along the road (m). */
  length: number;
  /** Full size across the road (m). */
  width: number;
  /** Lateral centre from the polyline, positive = right of travel (m). */
  offset: number;
}

/** A manhole cover: a flat disc of radius `r` at road height. */
export interface Manhole {
  x: number;
  z: number;
  r: number;
  /** Lateral offset from the polyline, positive = right of travel (m). */
  offset: number;
}

/** Standard manhole radius in metres (0.7 m cover). */
export const MANHOLE_R = 0.35;
/** Asphalt patch spacing in metres (mean of the 15..35 m hash jitter, about one per 25 m). */
const PATCH_SPACING = 25;
/** Stop line distance before the signal and bar thickness in metres. */
const STOP_BEFORE = 4;
const STOP_THICK = 0.4;

/**
 * Stable 32-bit seed from any integers (an OSM id, coordinates, kind, width, name). The v3 road record
 * has no OSM id, so the ground passes the region-level start/end coordinates and tags; identical road
 * pieces then get identical detail in every chunk.
 */
export function hashSeed(...parts: number[]): number {
  let h = 0x811c9dc5;
  for (const p of parts) {
    h ^= p | 0;
    h = Math.imul(h, 0x01000193);
    h ^= h >>> 13;
  }
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}

/** A deterministic fraction in [0, 1) from a seed and index. */
function unit(seed: number, i: number): number {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((i | 0) + 0x165667b1, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x27d4eb2f);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

function cumulative(pts: Float64Array): Float64Array {
  const n = pts.length >> 1;
  const cum = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    cum[i] = cum[i - 1]! + Math.hypot(pts[i * 2]! - pts[i * 2 - 2]!, pts[i * 2 + 1]! - pts[i * 2 - 1]!);
  }
  return cum;
}

interface Sample {
  x: number;
  z: number;
  ux: number;
  uz: number;
}

/** Point and unit tangent at arc length `s` of the polyline, or null outside it. */
function sampleAt(pts: Float64Array, cum: Float64Array, s: number): Sample | null {
  const n = pts.length >> 1;
  const total = cum[n - 1]!;
  if (!(s >= 0 && s <= total)) return null;
  for (let k = 0; k + 1 < n; k++) {
    if (s > cum[k + 1]!) continue;
    const ax = pts[k * 2]!, az = pts[k * 2 + 1]!;
    const ex = pts[k * 2 + 2]! - ax, ez = pts[k * 2 + 3]! - az;
    const len = cum[k + 1]! - cum[k]!;
    if (len < 1e-9) continue;
    const t = Math.min(1, Math.max(0, (s - cum[k]!) / len));
    return { x: ax + ex * t, z: az + ez * t, ux: ex / len, uz: ez / len };
  }
  return null;
}

/** Nearest point on the polyline to (x, z): arc length, distance and tangent of the winning segment. */
function nearest(pts: Float64Array, cum: Float64Array, x: number, z: number): { s: number; d: number; ux: number; uz: number } {
  let best = Infinity, bs = 0, bux = 1, buz = 0;
  for (let k = 0; k + 1 < pts.length / 2; k++) {
    const ax = pts[k * 2]!, az = pts[k * 2 + 1]!;
    const ex = pts[k * 2 + 2]! - ax, ez = pts[k * 2 + 3]! - az;
    const l2 = ex * ex + ez * ez;
    if (l2 < 1e-12) continue;
    let t = ((x - ax) * ex + (z - az) * ez) / l2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = ax + t * ex, qz = az + t * ez;
    const d = Math.hypot(x - qx, z - qz);
    if (d < best) {
      const l = Math.sqrt(l2);
      best = d;
      bs = cum[k]! + t * l;
      bux = ex / l;
      buz = ez / l;
    }
  }
  return { s: bs, d: best, ux: bux, uz: buz };
}

/**
 * Asphalt repair patches along a carriageway of half-width `half`: rectangles 1.5..4 m long by
 * 1..2.5 m wide, about one per 25 m (15..35 m hash jitter), each kept wholly inside the carriageway.
 * The caller paints them under the markings.
 */
export function patchesAlong(pts: Float64Array, half: number, seed: number): RoadRect[] {
  const out: RoadRect[] = [];
  const n = pts.length >> 1;
  if (n < 2) return out;
  const cum = cumulative(pts);
  const total = cum[n - 1]!;
  if (total <= 4) return out;
  let s = Math.min(total - 1, 1 + unit(seed, 0) * PATCH_SPACING);
  for (let k = 0; s < total - 1; k++) {
    const length = 1.5 + unit(seed, 1 + k * 8) * 2.5;
    const width = 1 + unit(seed, 2 + k * 8) * 1.5;
    // 0.1 m safety margin so a rotated rectangle never pokes over the kerb line
    const room = half - width / 2 - 0.1;
    if (room > 0) {
      const offset = -room + unit(seed, 3 + k * 8) * 2 * room;
      const q = sampleAt(pts, cum, Math.min(s, total - 0.5));
      if (q !== null) out.push({ x: q.x, z: q.z, ux: q.ux, uz: q.uz, length, width, offset });
    }
    s += PATCH_SPACING * (0.6 + unit(seed, 4 + k * 8) * 0.8); // 15..35 m
  }
  return out;
}

/**
 * Manhole covers along a carriageway of half-width `half`, every 30..45 m (hash-jittered), near a lane
 * centre. `lanes` is the OSM lane count; 0 means two lanes, matching the visible lane centres.
 */
export function manholesAlong(pts: Float64Array, half: number, seed: number, lanes = 0): Manhole[] {
  const out: Manhole[] = [];
  const n = pts.length >> 1;
  if (n < 2) return out;
  const cum = cumulative(pts);
  const total = cum[n - 1]!;
  if (total <= 4) return out;
  const laneCount = Math.max(2, lanes > 0 ? lanes : 2);
  const laneW = (half * 2) / laneCount;
  let s = Math.min(total - 1, 10 + unit(seed, 0) * 20);
  for (let k = 0; s < total - 1; k++) {
    const lane = Math.min(laneCount - 1, Math.floor(unit(seed, 1 + k * 6) * laneCount));
    let offset = -half + (lane + 0.5) * laneW;
    const max = half - MANHOLE_R - 0.05;
    offset = offset > max ? max : offset < -max ? -max : offset;
    const q = sampleAt(pts, cum, Math.min(s, total - 0.5));
    if (q !== null) out.push({ x: q.x, z: q.z, r: MANHOLE_R, offset });
    s += 30 + unit(seed, 2 + k * 6) * 15; // 30..45 m
  }
  return out;
}

/**
 * Storm-drain grates in the right-hand gutter, 0.3 m from the kerb, every 25..40 m. Each grate is
 * 0.4 m across the gutter and 0.8 m along the road, flat at road height.
 */
export function drainsAlong(pts: Float64Array, half: number, seed: number): RoadRect[] {
  const out: RoadRect[] = [];
  const n = pts.length >> 1;
  if (n < 2) return out;
  const cum = cumulative(pts);
  const total = cum[n - 1]!;
  const width = 0.4;
  const offset = half - 0.3 - width / 2;
  if (total <= 4 || offset < width / 2) return out;
  let s = Math.min(total - 1, 8 + unit(seed, 0) * 12);
  for (let k = 0; s < total - 1; k++) {
    const q = sampleAt(pts, cum, Math.min(s, total - 0.5));
    if (q !== null) out.push({ x: q.x, z: q.z, ux: q.ux, uz: q.uz, length: 0.8, width, offset });
    s += 25 + unit(seed, 1 + k * 4) * 15; // 25..40 m
  }
  return out;
}

/**
 * Stop bars at a traffic signal: a 0.4 m thick line 4 m before the signal on each approach, across
 * the right-hand half of the carriageway (Ukraine drives on the right). Two-way roads get both
 * approaches; a one-way road gets only the incoming one (the polyline direction, as OSM tags it).
 * A signal farther than 3 m from the polyline gets nothing.
 */
export function stopLines(pts: Float64Array, half: number, oneWay: boolean, sx: number, sz: number): RoadRect[] {
  const out: RoadRect[] = [];
  const n = pts.length >> 1;
  if (n < 2 || half <= 0.2) return out;
  const cum = cumulative(pts);
  const total = cum[n - 1]!;
  const hit = nearest(pts, cum, sx, sz);
  if (hit.d > 3) return out;
  const add = (s: number, back: boolean): void => {
    if (s < 0.1 || s > total - 0.1) return;
    const q = sampleAt(pts, cum, s);
    if (q === null) return;
    // `offset` is always positive: the right half of the travel direction of this approach
    out.push({
      x: q.x, z: q.z,
      ux: back ? -q.ux : q.ux, uz: back ? -q.uz : q.uz,
      length: STOP_THICK, width: half, offset: half / 2,
    });
  };
  add(hit.s - STOP_BEFORE, false);
  if (!oneWay) add(hit.s + STOP_BEFORE, true);
  return out;
}

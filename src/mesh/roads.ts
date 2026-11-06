/**
 * Smooth mid-distance road ribbons for one 64 m chunk, built from the vector road polylines.
 * The coarse 2 m ground staircases diagonal streets; these ribbons lay a real-edged carriageway,
 * sidewalks and markings a few centimetres over it for every chunk outside the fine radius.
 *
 * Pure and deterministic. All positions are chunk-local metres; terrain comes from the coarse
 * ground sampler the mesh worker passes in. Geometry is clipped to the chunk square so neighbouring
 * chunks meet exactly at the border.
 */
import { MAT, PALETTE } from '../world/materials.ts';
import { surfaceMat } from '../world/pbr-layers.ts';
import { CHUNK_M, REGION_M } from '../world/stream-math.ts';
import {
  ROAD,
  ROAD_BRIDGE,
  ROAD_ONEWAY,
  ROAD_SIDEWALK,
  ROAD_UNPAVED,
  type VRoad,
  type VectorTile,
} from '../world/vector-format.ts';

/** Ribbon height over the coarse ground (metres). */
export const ROAD_RIBBON_LIFT = 0.06;
/** Marking height over the ribbon (metres). */
export const ROAD_MARKING_LIFT = 0.02;

const SEGMENT_M = 8;
const SIDEWALK_M = 2.5;
const SIDEWALK_MAJOR_M = 3.5;
/** Offset cap at a mitre join: twice the half-width (one road width). */
const MITER_LIMIT = 2;
/** Carriageway ends within this distance of one another form a junction. */
const JUNCTION_END_M = 3;
/** Markings stop this far short of a junction. */
const JUNCTION_CLEAR_M = 6;
const MARK_HALF = 0.075;
const DASH_ON = 3;
const DASH_PERIOD = 9;
const MIN_CARRIAGEWAY_M = 2.5;
const PAVING_HALF = 1;
const PAVING_MIN_WIDTH_M = 1.5;
const JUNCTION_LIFT = ROAD_RIBBON_LIFT - 0.005;

/** Vertex buffers of a chunk's road ribbons. */
export interface RoadMesh {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  /** Per vertex: `x` = ground material id, `y..w` = 0 (as `QuadBuilder.top` writes ground faces). */
  walls: Float32Array;
  indices: Uint32Array;
}

/** A road piece in world metres. */
interface Piece {
  kind: number;
  flags: number;
  lanes: number;
  name: number;
  surface: number;
  car: boolean;
  paving: boolean;
  half: number;
  band: number;
  isMajor: boolean;
  x: Float64Array;
  z: Float64Array;
  n: number;
  cum: Float64Array;
  len: number;
}

/** Densified centre line with a mitre offset frame at every vertex. */
interface Dense {
  x: Float64Array;
  z: Float64Array;
  s: Float64Array;
  /** Unit mitre direction (right of travel). */
  mx: Float64Array;
  mz: Float64Array;
  /** Mitre length factor: offset point = p + m * distance * ms. */
  ms: Float64Array;
  n: number;
}

interface JNode {
  x: number;
  z: number;
  deg: number;
  members: number;
  name0: number;
  kind0: number;
  differs: boolean;
  maxHalf: number;
  mat: number;
  corners: number[];
}

function isFootKind(kind: number): boolean {
  return kind === ROAD.FOOTWAY || kind === ROAD.PATH || kind === ROAD.CYCLEWAY
    || kind === ROAD.STEPS || kind === ROAD.PEDESTRIAN;
}

function isMajor(kind: number): boolean {
  return kind === ROAD.PRIMARY || kind === ROAD.TRUNK || kind === ROAD.MOTORWAY;
}

function wideSidewalk(kind: number): boolean {
  return kind === ROAD.PRIMARY || kind === ROAD.TRUNK || kind === ROAD.SECONDARY;
}

function carriagewayMat(p: Piece): number {
  return surfaceMat(p.surface, (p.flags & ROAD_UNPAVED) !== 0 ? MAT.DIRT : MAT.ASPHALT);
}

function rightNormal(dx: number, dz: number, out: Float64Array): void {
  const l = Math.hypot(dx, dz) || 1;
  out[0] = -dz / l;
  out[1] = dx / l;
}

const joinTmp = new Float64Array(3);

/** Right-side mitre direction and length factor at vertex `i`: point = p + m * 1 m * factor. */
function joinAt(x: Float64Array, z: Float64Array, n: number, i: number, out: Float64Array): void {
  if (i <= 0 || i >= n - 1) {
    const a = i <= 0 ? 0 : i - 1;
    const b = i <= 0 ? 1 : i;
    rightNormal(x[b]! - x[a]!, z[b]! - z[a]!, out);
    out[2] = 1;
    return;
  }
  const r0x = -(z[i]! - z[i - 1]!), r0z = x[i]! - x[i - 1]!;
  const r1x = -(z[i + 1]! - z[i]!), r1z = x[i + 1]! - x[i]!;
  const l0 = Math.hypot(r0x, r0z) || 1;
  const l1 = Math.hypot(r1x, r1z) || 1;
  const n0x = r0x / l0, n0z = r0z / l0;
  let mx = n0x + r1x / l1;
  let mz = n0z + r1z / l1;
  const ml = Math.hypot(mx, mz);
  if (ml < 1e-6) {
    // a near U-turn: keep the incoming side and cap the mitre
    out[0] = n0x;
    out[1] = n0z;
    out[2] = MITER_LIMIT;
    return;
  }
  mx /= ml;
  mz /= ml;
  const dot = mx * n0x + mz * n0z;
  out[0] = mx;
  out[1] = mz;
  out[2] = dot > 1e-6 ? Math.min(1 / dot, MITER_LIMIT) : MITER_LIMIT;
}

function nearChunk(p: Piece, gcx: number, gcz: number, margin: number): boolean {
  const x0 = gcx * CHUNK_M, z0 = gcz * CHUNK_M;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < p.n; i++) {
    const x = p.x[i]!, z = p.z[i]!;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return maxX >= x0 - margin && minX <= x0 + CHUNK_M + margin
    && maxZ >= z0 - margin && minZ <= z0 + CHUNK_M + margin;
}

function densify(p: Piece): Dense {
  let count = 1;
  for (let i = 0; i + 1 < p.n; i++) {
    const l = Math.hypot(p.x[i + 1]! - p.x[i]!, p.z[i + 1]! - p.z[i]!);
    count += Math.max(1, Math.ceil(l / SEGMENT_M));
  }
  const x = new Float64Array(count);
  const z = new Float64Array(count);
  let k = 0;
  for (let i = 0; i + 1 < p.n; i++) {
    const ax = p.x[i]!, az = p.z[i]!;
    const bx = p.x[i + 1]!, bz = p.z[i + 1]!;
    const l = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(1, Math.ceil(l / SEGMENT_M));
    for (let j = 0; j < steps; j++) {
      const t = j / steps;
      x[k] = ax + (bx - ax) * t;
      z[k] = az + (bz - az) * t;
      k++;
    }
  }
  x[k] = p.x[p.n - 1]!;
  z[k] = p.z[p.n - 1]!;
  k++;
  const s = new Float64Array(count);
  for (let i = 1; i < count; i++) s[i] = s[i - 1]! + Math.hypot(x[i]! - x[i - 1]!, z[i]! - z[i - 1]!);
  const mx = new Float64Array(count);
  const mz = new Float64Array(count);
  const ms = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    joinAt(x, z, count, i, joinTmp);
    mx[i] = joinTmp[0]!;
    mz[i] = joinTmp[1]!;
    ms[i] = joinTmp[2]!;
  }
  return { x, z, s, mx, mz, ms, n: count };
}

/** Sutherland-Hodgman against one axis-aligned half-plane, interpolating heights. */
function clipPlane(
  ax: Float64Array, ay: Float64Array, az: Float64Array, count: number,
  bx: Float64Array, by: Float64Array, bz: Float64Array,
  axis: 0 | 1, limit: number, keepGreater: boolean,
): number {
  let out = 0;
  for (let i = 0; i < count; i++) {
    const j = i + 1 === count ? 0 : i + 1;
    const ai = axis === 0 ? ax[i]! : az[i]!;
    const aj = axis === 0 ? ax[j]! : az[j]!;
    const ina = keepGreater ? ai >= limit : ai <= limit;
    const inb = keepGreater ? aj >= limit : aj <= limit;
    if (ina) {
      bx[out] = ax[i]!; by[out] = ay[i]!; bz[out] = az[i]!;
      out++;
    }
    if (ina !== inb) {
      const t = (limit - ai) / (aj - ai);
      bx[out] = ax[i]! + (ax[j]! - ax[i]!) * t;
      by[out] = ay[i]! + (ay[j]! - ay[i]!) * t;
      bz[out] = az[i]! + (az[j]! - az[i]!) * t;
      out++;
    }
  }
  return out;
}

/** Convex hull (Andrew's monotone chain) of flat [x, z, …] pairs, returned as flat pairs. */
function convexHull(pts: number[]): number[] {
  const n = pts.length / 2;
  if (n < 3) return pts.slice();
  const order: number[] = [];
  for (let i = 0; i < n; i++) order.push(i);
  order.sort((a, b) => pts[a * 2]! - pts[b * 2]! || pts[a * 2 + 1]! - pts[b * 2 + 1]!);
  const cross = (o: number, a: number, b: number): number =>
    (pts[a * 2]! - pts[o * 2]!) * (pts[b * 2 + 1]! - pts[o * 2 + 1]!)
    - (pts[a * 2 + 1]! - pts[o * 2 + 1]!) * (pts[b * 2]! - pts[o * 2]!);
  const lower: number[] = [];
  for (const i of order) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, i) <= 0) lower.pop();
    lower.push(i);
  }
  const upper: number[] = [];
  for (let k = order.length - 1; k >= 0; k--) {
    const i = order[k]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, i) <= 0) upper.pop();
    upper.push(i);
  }
  lower.pop();
  upper.pop();
  const hull = lower.concat(upper);
  const out: number[] = [];
  for (const i of hull) out.push(pts[i * 2]!, pts[i * 2 + 1]!);
  return out;
}

class RibbonBuilder {
  private pos = new Float32Array(4096 * 3);
  private nor = new Float32Array(4096 * 3);
  private col = new Float32Array(4096 * 3);
  private wal = new Float32Array(4096 * 4);
  private idx = new Uint32Array(8192);
  private vcount = 0;
  private icount = 0;

  /** Scratch polygon for one quad/triangle, then ping-pong buffers for the four clip planes. */
  private qx = new Float64Array(16);
  private qy = new Float64Array(16);
  private qz = new Float64Array(16);
  private qn = 0;
  private ax = new Float64Array(32);
  private ay = new Float64Array(32);
  private az = new Float64Array(32);
  private bx = new Float64Array(32);
  private by = new Float64Array(32);
  private bz = new Float64Array(32);

  private readonly x0: number;
  private readonly z0: number;
  private readonly x1: number;
  private readonly z1: number;
  private readonly ground: (x: number, z: number) => number;

  constructor(gcx: number, gcz: number, ground: (x: number, z: number) => number) {
    this.x0 = gcx * CHUNK_M;
    this.z0 = gcz * CHUNK_M;
    this.x1 = this.x0 + CHUNK_M;
    this.z1 = this.z0 + CHUNK_M;
    this.ground = ground;
  }

  private growVerts(need: number): void {
    if (this.vcount + need <= this.pos.length / 3) return;
    let cap = this.pos.length / 3;
    while (cap < this.vcount + need) cap *= 2;
    const pos = new Float32Array(cap * 3);
    pos.set(this.pos);
    this.pos = pos;
    const nor = new Float32Array(cap * 3);
    nor.set(this.nor);
    this.nor = nor;
    const col = new Float32Array(cap * 3);
    col.set(this.col);
    this.col = col;
    const wal = new Float32Array(cap * 4);
    wal.set(this.wal);
    this.wal = wal;
  }

  private growIdx(need: number): void {
    if (this.icount + need <= this.idx.length) return;
    let cap = this.idx.length;
    while (cap < this.icount + need) cap *= 2;
    const idx = new Uint32Array(cap);
    idx.set(this.idx);
    this.idx = idx;
  }

  private vertex(x: number, y: number, z: number, mat: number): number {
    this.growVerts(1);
    const v = this.vcount++;
    const o = (mat & 255) * 3;
    const r = PALETTE[o]! / 255;
    const g = PALETTE[o + 1]! / 255;
    const b = PALETTE[o + 2]! / 255;
    this.pos[v * 3] = x - this.x0;
    this.pos[v * 3 + 1] = y;
    this.pos[v * 3 + 2] = z - this.z0;
    this.nor[v * 3] = 0;
    this.nor[v * 3 + 1] = 1;
    this.nor[v * 3 + 2] = 0;
    this.col[v * 3] = r;
    this.col[v * 3 + 1] = g;
    this.col[v * 3 + 2] = b;
    this.wal[v * 4] = mat;
    this.wal[v * 4 + 1] = 0;
    this.wal[v * 4 + 2] = 0;
    this.wal[v * 4 + 3] = 0;
    return v;
  }

  triangle(mat: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number): void {
    this.qx[0] = ax; this.qy[0] = ay; this.qz[0] = az;
    this.qx[1] = bx; this.qy[1] = by; this.qz[1] = bz;
    this.qx[2] = cx; this.qy[2] = cy; this.qz[2] = cz;
    this.qn = 3;
    this.clipEmit(mat);
  }

  /** Adds a front-facing (upward) quad; corners are in [right, right, left, left] order. */
  private quad(
    mat: number,
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number,
    dx: number, dy: number, dz: number,
  ): void {
    this.qx[0] = ax; this.qy[0] = ay; this.qz[0] = az;
    this.qx[1] = bx; this.qy[1] = by; this.qz[1] = bz;
    this.qx[2] = cx; this.qy[2] = cy; this.qz[2] = cz;
    this.qx[3] = dx; this.qy[3] = dy; this.qz[3] = dz;
    this.qn = 4;
    this.clipEmit(mat);
  }

  private clipEmit(mat: number): void {
    let X = this.ax, Y = this.ay, Z = this.az;
    let X2 = this.bx, Y2 = this.by, Z2 = this.bz;
    let count = this.qn;
    for (let i = 0; i < count; i++) {
      X[i] = this.qx[i]!; Y[i] = this.qy[i]!; Z[i] = this.qz[i]!;
    }
    count = clipPlane(X, Y, Z, count, X2, Y2, Z2, 0, this.x0, true);
    let t = X; X = X2; X2 = t;
    t = Y; Y = Y2; Y2 = t;
    t = Z; Z = Z2; Z2 = t;
    if (count >= 3) {
      count = clipPlane(X, Y, Z, count, X2, Y2, Z2, 0, this.x1, false);
      t = X; X = X2; X2 = t;
      t = Y; Y = Y2; Y2 = t;
      t = Z; Z = Z2; Z2 = t;
    }
    if (count >= 3) {
      count = clipPlane(X, Y, Z, count, X2, Y2, Z2, 1, this.z0, true);
      t = X; X = X2; X2 = t;
      t = Y; Y = Y2; Y2 = t;
      t = Z; Z = Z2; Z2 = t;
    }
    if (count >= 3) {
      count = clipPlane(X, Y, Z, count, X2, Y2, Z2, 1, this.z1, false);
      t = X; X = X2; X2 = t;
      t = Y; Y = Y2; Y2 = t;
      t = Z; Z = Z2; Z2 = t;
    }
    if (count < 3) return;
    let area = 0;
    for (let i = 0; i < count; i++) {
      const j = i + 1 === count ? 0 : i + 1;
      area += X[i]! * Z[j]! - X[j]! * Z[i]!;
    }
    // A polygon clipped to a line has no surface; emitting it would duplicate border vertices.
    if (Math.abs(area) < 1e-9) return;
    const first = this.vertex(X[0]!, Y[0]!, Z[0]!, mat);
    let prev = this.vertex(X[1]!, Y[1]!, Z[1]!, mat);
    for (let i = 2; i < count; i++) {
      const cur = this.vertex(X[i]!, Y[i]!, Z[i]!, mat);
      this.growIdx(3);
      this.idx[this.icount++] = first;
      this.idx[this.icount++] = prev;
      this.idx[this.icount++] = cur;
      prev = cur;
    }
  }

  private groundAt(x: number, z: number): number {
    return this.ground(x, z) + ROAD_RIBBON_LIFT;
  }

  /** Carriageway/foot strip from the dense offset frame. */
  strip(d: Dense, i: number, j: number, inner: number, outer: number, mat: number, side: -1 | 1 | 0): void {
    if (side === 0) {
      const rix = d.x[i]! + d.mx[i]! * inner * d.ms[i]!;
      const riz = d.z[i]! + d.mz[i]! * inner * d.ms[i]!;
      const rjx = d.x[j]! + d.mx[j]! * inner * d.ms[j]!;
      const rjz = d.z[j]! + d.mz[j]! * inner * d.ms[j]!;
      const lix = d.x[i]! - d.mx[i]! * inner * d.ms[i]!;
      const liz = d.z[i]! - d.mz[i]! * inner * d.ms[i]!;
      const ljx = d.x[j]! - d.mx[j]! * inner * d.ms[j]!;
      const ljz = d.z[j]! - d.mz[j]! * inner * d.ms[j]!;
      this.quad(
        mat,
        rix, this.groundAt(rix, riz), riz,
        rjx, this.groundAt(rjx, rjz), rjz,
        ljx, this.groundAt(ljx, ljz), ljz,
        lix, this.groundAt(lix, liz), liz,
      );
      return;
    }
    const iix = d.x[i]! + side * d.mx[i]! * inner * d.ms[i]!;
    const iiz = d.z[i]! + side * d.mz[i]! * inner * d.ms[i]!;
    const ijx = d.x[j]! + side * d.mx[j]! * inner * d.ms[j]!;
    const ijz = d.z[j]! + side * d.mz[j]! * inner * d.ms[j]!;
    const oix = d.x[i]! + side * d.mx[i]! * outer * d.ms[i]!;
    const oiz = d.z[i]! + side * d.mz[i]! * outer * d.ms[i]!;
    const ojx = d.x[j]! + side * d.mx[j]! * outer * d.ms[j]!;
    const ojz = d.z[j]! + side * d.mz[j]! * outer * d.ms[j]!;
    if (side < 0) {
      this.quad(
        mat,
        iix, this.groundAt(iix, iiz), iiz,
        ijx, this.groundAt(ijx, ijz), ijz,
        ojx, this.groundAt(ojx, ojz), ojz,
        oix, this.groundAt(oix, oiz), oiz,
      );
    } else {
      this.quad(
        mat,
        oix, this.groundAt(oix, oiz), oiz,
        ojx, this.groundAt(ojx, ojz), ojz,
        ijx, this.groundAt(ijx, ijz), ijz,
        iix, this.groundAt(iix, iiz), iiz,
      );
    }
  }

  /** Emits the clipped pieces of a marking line over one dense segment. */
  marking(d: Dense, i: number, j: number, offset: number, a: number, b: number): void {
    const s0 = d.s[i]!;
    const s1 = d.s[j]!;
    const span = s1 - s0;
    if (span <= 1e-9 || b - a <= 1e-9) return;
    const fa = (a - s0) / span;
    const fb = (b - s0) / span;
    const pix = d.x[i]! + d.mx[i]! * offset * d.ms[i]!;
    const piz = d.z[i]! + d.mz[i]! * offset * d.ms[i]!;
    const pjx = d.x[j]! + d.mx[j]! * offset * d.ms[j]!;
    const pjz = d.z[j]! + d.mz[j]! * offset * d.ms[j]!;
    const ax = pix + (pjx - pix) * fa, az = piz + (pjz - piz) * fa;
    const bx = pix + (pjx - pix) * fb, bz = piz + (pjz - piz) * fb;
    const dx = d.x[j]! - d.x[i]!, dz = d.z[j]! - d.z[i]!;
    const l = Math.hypot(dx, dz) || 1;
    const nx = -dz / l, nz = dx / l;
    const h = MARK_HALF;
    const ya = this.groundAt(ax, az) + ROAD_MARKING_LIFT;
    const yb = this.groundAt(bx, bz) + ROAD_MARKING_LIFT;
    this.quad(
      MAT.MARKING,
      ax + nx * h, ya, az + nz * h,
      bx + nx * h, yb, bz + nz * h,
      bx - nx * h, yb, bz - nz * h,
      ax - nx * h, ya, az - nz * h,
    );
  }

  /** Emits a marking strip along one original polyline segment (dashes are not split at 8 m joins). */
  markPiece(p: Piece, offset: number, a: number, b: number): void {
    if (b - a <= 1e-9) return;
    let k = 0;
    while (k + 1 < p.n && p.cum[k + 1]! <= a + 1e-9) k++;
    let cur = a;
    while (cur < b - 1e-9 && k + 1 < p.n) {
      const segEnd = p.cum[k + 1]!;
      const u = Math.max(cur, p.cum[k]!);
      const v = Math.min(b, segEnd);
      if (v > u + 1e-9) this.markSegment(p, k, u, v, offset);
      cur = v;
      if (segEnd <= b + 1e-9) k++;
      else break;
    }
  }

  private markSegment(p: Piece, k: number, a: number, b: number, offset: number): void {
    const segLen = p.cum[k + 1]! - p.cum[k]!;
    if (segLen <= 1e-9) return;
    const t0 = (a - p.cum[k]!) / segLen;
    const t1 = (b - p.cum[k]!) / segLen;
    const ax0 = p.x[k]!, az0 = p.z[k]!;
    const ax1 = p.x[k + 1]!, az1 = p.z[k + 1]!;
    let dx = ax1 - ax0, dz = az1 - az0;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l; dz /= l;
    const nx = -dz, nz = dx;
    const cx0 = ax0 + (ax1 - ax0) * t0, cz0 = az0 + (az1 - az0) * t0;
    const cx1 = ax0 + (ax1 - ax0) * t1, cz1 = az0 + (az1 - az0) * t1;
    const px0 = cx0 + nx * offset, pz0 = cz0 + nz * offset;
    const px1 = cx1 + nx * offset, pz1 = cz1 + nz * offset;
    const h = MARK_HALF;
    this.quad(
      MAT.MARKING,
      px0 + nx * h, this.groundAt(px0 + nx * h, pz0 + nz * h) + ROAD_MARKING_LIFT, pz0 + nz * h,
      px1 + nx * h, this.groundAt(px1 + nx * h, pz1 + nz * h) + ROAD_MARKING_LIFT, pz1 + nz * h,
      px1 - nx * h, this.groundAt(px1 - nx * h, pz1 - nz * h) + ROAD_MARKING_LIFT, pz1 - nz * h,
      px0 - nx * h, this.groundAt(px0 - nx * h, pz0 - nz * h) + ROAD_MARKING_LIFT, pz0 - nz * h,
    );
  }

  build(): RoadMesh {
    return {
      positions: this.pos.slice(0, this.vcount * 3),
      normals: this.nor.slice(0, this.vcount * 3),
      colors: this.col.slice(0, this.vcount * 3),
      walls: this.wal.slice(0, this.vcount * 4),
      indices: this.idx.slice(0, this.icount),
    };
  }
}

/** Nearest point on a polyline: writes distance and arc length into `nearTmp`. */
const nearTmp = new Float64Array(2);
function nearestOnPolyline(p: Piece, x: number, z: number): void {
  let best = Infinity;
  let bestS = 0;
  for (let k = 0; k + 1 < p.n; k++) {
    const ax = p.x[k]!, az = p.z[k]!;
    const ex = p.x[k + 1]! - ax, ez = p.z[k + 1]! - az;
    const l2 = ex * ex + ez * ez;
    if (l2 < 1e-12) continue;
    let t = ((x - ax) * ex + (z - az) * ez) / l2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const d = Math.hypot(x - (ax + t * ex), z - (az + t * ez));
    if (d < best) {
      best = d;
      bestS = p.cum[k]! + t * Math.sqrt(l2);
    }
  }
  nearTmp[0] = best;
  nearTmp[1] = bestS;
}

function pieceFrom(
  road: VRoad, ox: number, oz: number,
): Piece | null {
  if (road.layer !== 0 || (road.flags & ROAD_BRIDGE) !== 0 || road.pts.length < 4) return null;
  const kind = road.kind;
  if (kind === ROAD.PATH || kind === ROAD.STEPS || kind === ROAD.CYCLEWAY || kind === ROAD.TRACK) return null;
  const car = !isFootKind(kind);
  const paving = kind === ROAD.PEDESTRIAN || kind === ROAD.FOOTWAY;
  if (!car && !paving) return null;
  const width = Math.max(road.widthCm / 100, MIN_CARRIAGEWAY_M);
  if (paving && road.widthCm / 100 <= PAVING_MIN_WIDTH_M) return null;
  const n = road.pts.length >> 1;
  const x = new Float64Array(n);
  const z = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    x[i] = ox + road.pts[i * 2]! / 100;
    z[i] = oz + road.pts[i * 2 + 1]! / 100;
  }
  const cum = new Float64Array(n);
  for (let i = 1; i < n; i++) cum[i] = cum[i - 1]! + Math.hypot(x[i]! - x[i - 1]!, z[i]! - z[i - 1]!);
  const band = car && (road.flags & ROAD_SIDEWALK) !== 0 && kind !== ROAD.TRACK
    ? (wideSidewalk(kind) ? SIDEWALK_MAJOR_M : SIDEWALK_M)
    : 0;
  return {
    kind, flags: road.flags, lanes: road.lanes, name: road.name, surface: road.surface ?? 0,
    car, paving, half: width / 2, band, isMajor: isMajor(kind), x, z, n, cum, len: cum[n - 1]!,
  };
}

/** One carriageway end (first or last vertex of a piece). */
interface RoadEnd {
  p: Piece;
  v: number;
  x: number;
  z: number;
}

function carriagewayEnds(pieces: readonly Piece[]): RoadEnd[] {
  const out: RoadEnd[] = [];
  for (const p of pieces) {
    if (!p.car) continue;
    out.push({ p, v: 0, x: p.x[0]!, z: p.z[0]! });
    out.push({ p, v: p.n - 1, x: p.x[p.n - 1]!, z: p.z[p.n - 1]! });
  }
  return out;
}

/**
 * Clusters carriageway ends within 3 m (a uniform 3 m grid and union-find, so a dense tile set stays
 * linear). Clusters of three or more ends become junction fill polygons.
 */
function clusterEnds(ends: readonly RoadEnd[]): JNode[] {
  const n = ends.length;
  if (n < 3) return [];
  const order = new Array<number>(n);
  for (let i = 0; i < n; i++) order[i] = i;
  order.sort((a, b) => ends[a]!.x - ends[b]!.x || ends[a]!.z - ends[b]!.z);
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (i: number): number => {
    let r = i;
    while (parent[r] !== r) r = parent[r]!;
    while (parent[i] !== r) {
      const next = parent[i]!;
      parent[i] = r;
      i = next;
    }
    return r;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };
  const buckets = new Map<number, number[]>();
  const CELL = JUNCTION_END_M;
  for (const i of order) {
    const e = ends[i]!;
    const cx = Math.floor(e.x / CELL);
    const cz = Math.floor(e.z / CELL);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const list = buckets.get((cx + dx) * 1e6 + (cz + dz));
        if (list === undefined) continue;
        for (const j of list) {
          const o = ends[j]!;
          const ddx = o.x - e.x, ddz = o.z - e.z;
          if (ddx * ddx + ddz * ddz <= CELL * CELL) union(i, j);
        }
      }
    }
    const key = cx * 1e6 + cz;
    let list = buckets.get(key);
    if (list === undefined) buckets.set(key, (list = []));
    list.push(i);
  }
  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    let g = groups.get(r);
    if (g === undefined) groups.set(r, (g = []));
    g.push(i);
  }
  const out: JNode[] = [];
  for (const g of groups.values()) {
    if (g.length < 3) continue;
    let x = 0, z = 0, maxHalf = 0, mat: number = MAT.ASPHALT;
    const corners: number[] = [];
    for (const i of g) {
      const e = ends[i]!;
      x += e.x;
      z += e.z;
      if (e.p.half > maxHalf) {
        maxHalf = e.p.half;
        mat = carriagewayMat(e.p);
      }
      joinAt(e.p.x, e.p.z, e.p.n, e.v, joinTmp);
      const s = joinTmp[2]!;
      corners.push(
        e.x + joinTmp[0]! * e.p.half * s, e.z + joinTmp[1]! * e.p.half * s,
        e.x - joinTmp[0]! * e.p.half * s, e.z - joinTmp[1]! * e.p.half * s,
      );
    }
    out.push({
      x: x / g.length, z: z / g.length, deg: g.length, members: g.length,
      name0: -1, kind0: -1, differs: false, maxHalf, mat, corners,
    });
  }
  out.sort((a, b) => a.x - b.x || a.z - b.z);
  return out;
}

/** Builds the road ribbons of one chunk. */
export function buildRoadRibbons(
  tiles: readonly VectorTile[], gcx: number, gcz: number,
  groundAt: (x: number, z: number) => number,
): RoadMesh {
  const pieces: Piece[] = [];
  for (const t of tiles) {
    const ox = t.rx * REGION_M;
    const oz = t.rz * REGION_M;
    for (const r of t.roads) {
      const p = pieceFrom(r, ox, oz);
      if (p === null) continue;
      if (!nearChunk(p, gcx, gcz, p.half + p.band + SEGMENT_M)) continue;
      pieces.push(p);
    }
  }
  const builder = new RibbonBuilder(gcx, gcz, groundAt);
  if (pieces.length === 0) return builder.build();

  // ---- junction nodes (same rule as the fine ground: >= 3 degrees, or two different ways)
  const nodes = new Map<number, JNode>();
  for (const p of pieces) {
    if (!p.car) continue;
    const mat = carriagewayMat(p);
    for (let v = 0; v < p.n; v++) {
      const x = p.x[v]!, z = p.z[v]!;
      const key = (Math.round(x * 100) + 1e6) * 4e6 + Math.round(z * 100) + 1e6;
      let nd = nodes.get(key);
      if (nd === undefined) {
        nd = {
          x, z, deg: 0, members: 0, name0: p.name, kind0: p.kind, differs: false,
          maxHalf: 0, mat, corners: [],
        };
        nodes.set(key, nd);
      } else if (nd.name0 !== p.name || nd.kind0 !== p.kind) {
        nd.differs = true;
      }
      nd.deg += v === 0 || v === p.n - 1 ? 1 : 2;
      nd.members++;
      if (p.half > nd.maxHalf) {
        nd.maxHalf = p.half;
        nd.mat = mat;
      }
    }
  }
  const junctions: JNode[] = [];
  for (const nd of nodes.values()) {
    if (nd.deg >= 3 || (nd.members >= 2 && nd.differs)) junctions.push(nd);
  }
  // Junction fill needs >= 3 carriageway *ends* within 3 m (the fine ground's degree rule also
  // counts a road passing straight through, which needs no fill because its strips already meet).
  const ends = carriagewayEnds(pieces);
  const fills = clusterEnds(ends);
  for (const nd of fills) junctions.push(nd);
  // deterministic order regardless of Map insertion order
  junctions.sort((a, b) => a.x - b.x || a.z - b.z);

  // ---- junction fill: a convex hull of the end corners, a few millimetres under the strips
  for (const nd of fills) {
    const hull = convexHull(nd.corners);
    if (hull.length < 6) continue;
    const y0 = groundAt(hull[0]!, hull[1]!) + JUNCTION_LIFT;
    const first = hull;
    for (let i = 2; i < hull.length / 2; i++) {
      const ax = first[0]!, az = first[1]!;
      const bx = hull[(i - 1) * 2]!, bz = hull[(i - 1) * 2 + 1]!;
      const cx = hull[i * 2]!, cz = hull[i * 2 + 1]!;
      const yb = groundAt(bx, bz) + JUNCTION_LIFT;
      const yc = groundAt(cx, cz) + JUNCTION_LIFT;
      // reverse the CCW hull into the up-facing winding used by the strips
      builder.triangle(nd.mat, ax, y0, az, cx, yc, cz, bx, yb, bz);
    }
  }

  for (const p of pieces) {
    const d = densify(p);
    const clear = markingClear(p, junctions);
    const mat = p.paving ? MAT.PAVING : carriagewayMat(p);
    for (let i = 0; i + 1 < d.n; i++) {
      if (p.paving) {
        builder.strip(d, i, i + 1, PAVING_HALF, PAVING_HALF, mat, 0);
        continue;
      }
      builder.strip(d, i, i + 1, p.half, p.half, mat, 0);
      if (p.band > 0) {
        builder.strip(d, i, i + 1, p.half, p.half + p.band, MAT.SIDEWALK, -1);
        builder.strip(d, i, i + 1, p.half, p.half + p.band, MAT.SIDEWALK, 1);
      }
    }
    if (p.car) markings(builder, p, d, clear);
  }
  return builder.build();
}

/** Arc-length intervals where markings must not be painted (6 m either side of a junction). */
function markingClear(p: Piece, junctions: readonly JNode[]): Float64Array {
  const out: number[] = [];
  for (const nd of junctions) {
    nearestOnPolyline(p, nd.x, nd.z);
    if (nearTmp[0]! > nd.maxHalf + JUNCTION_END_M) continue;
    out.push(nearTmp[1]! - JUNCTION_CLEAR_M, nearTmp[1]! + JUNCTION_CLEAR_M);
  }
  if (out.length === 0) return new Float64Array(0);
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < out.length; i += 2) pairs.push([out[i]!, out[i + 1]!]);
  pairs.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const flat: number[] = [];
  for (const [a, b] of pairs) flat.push(a, b);
  return Float64Array.from(flat);
}

function shouldMark(p: Piece): boolean {
  return p.car && p.kind !== ROAD.TRACK && p.kind !== ROAD.SERVICE
    && (p.flags & ROAD_UNPAVED) === 0 && p.len >= 4.5;
}

type MarkLine = { offset: number; dashed: boolean };

function markings(builder: RibbonBuilder, p: Piece, d: Dense, clear: Float64Array): void {
  if (!shouldMark(p)) return;
  const lines = markingLines(p);
  if (lines.length === 0) return;
  for (const line of lines) {
    if (line.dashed) {
      // A 3 m dash is short enough not to need terrain subdivision; keep it in one quad so it
      // never breaks at an internal 8 m dense join.
      const k1 = Math.floor((p.len - 1e-9) / DASH_PERIOD);
      for (let k = 0; k <= k1; k++) {
        const a = k * DASH_PERIOD;
        const b = Math.min(p.len, a + DASH_ON);
        if (b > a) emitWithClear(builder, p, null, -1, line.offset, a, b, clear);
      }
    } else {
      for (let i = 0; i + 1 < d.n; i++) {
        emitWithClear(builder, p, d, i, line.offset, d.s[i]!, d.s[i + 1]!, clear);
      }
    }
  }
}

/** Emits a run, subtracting the junction clearance intervals. */
function emitWithClear(
  builder: RibbonBuilder, p: Piece, d: Dense | null, i: number, offset: number,
  a: number, b: number, clear: Float64Array,
): void {
  let cur = a;
  for (let k = 0; k < clear.length; k += 2) {
    const ca = clear[k]!, cb = clear[k + 1]!;
    if (cb <= cur) continue;
    if (ca >= b) break;
    if (ca > cur) {
      const end = Math.min(ca, b);
      if (d !== null) builder.marking(d, i, i + 1, offset, cur, end);
      else builder.markPiece(p, offset, cur, end);
    }
    cur = Math.max(cur, cb);
    if (cur >= b) return;
  }
  if (cur < b) {
    if (d !== null) builder.marking(d, i, i + 1, offset, cur, b);
    else builder.markPiece(p, offset, cur, b);
  }
}

function markingLines(p: Piece): MarkLine[] {
  const lines: MarkLine[] = [];
  const width = p.half * 2;
  const oneway = (p.flags & ROAD_ONEWAY) !== 0;
  let centre = false;
  if (!oneway && width >= 6) {
    centre = true;
    if (p.isMajor && p.lanes >= 4) {
      lines.push({ offset: -0.3, dashed: false }, { offset: 0.3, dashed: false });
    } else {
      lines.push({ offset: 0, dashed: true });
    }
  }
  if ((oneway && p.lanes >= 3) || (!oneway && p.lanes >= 4)) {
    const laneW = width / p.lanes;
    for (let k = 1; k < p.lanes; k++) {
      const v = -p.half + k * laneW;
      if (!oneway && centre && Math.abs(v) < 0.8) continue;
      lines.push({ offset: v, dashed: true });
    }
  }
  if (p.isMajor) {
    const e = p.half - 0.3;
    if (e > 0) lines.push({ offset: -e, dashed: false }, { offset: e, dashed: false });
  }
  return lines;
}

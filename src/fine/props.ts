/**
 * Street props for the 1 m block tier (lamps, traffic lights, bus shelters, benches, bins, fences).
 * Pure and deterministic; runs in the fine worker.
 *
 * Chunk independence: every placement is computed from the decoded vector tiles and world
 * coordinates only (never from which chunk asks), and `placeProps` returns exactly the placements
 * whose anchor point lies in the half-open bounds [x0, x1) x [z0, z1). Two adjacent chunks therefore
 * emit disjoint sets whose union equals one run over both. Anything that needs neighbours (obstacle
 * roads, buildings, OSM lamps for suppression, de-duplication) looks at everything within a fixed
 * margin of the bounds.
 */
import { MAT } from '../world/materials.ts';
import {
  LINE,
  NO_DIR,
  POINT,
  ROAD,
  ROAD_BRIDGE,
  ROAD_LIT,
  ROAD_SIDEWALK,
  type VectorTile,
} from '../world/vector-format.ts';
import { KERB_CM } from './ground.ts';
import { buildProp, PROP } from './prop-models.ts';
import type { ChunkMesh } from '../world/mesher.ts';
import type { PropExclusion } from '../landmarks/exclusions.ts';

const REGION_M = 512;

/** One prop instance. (x, z) is the anchor (the base centre); the prop's +z faces (sin yaw, cos yaw). */
export interface PropPlacement {
  kind: number;
  variant: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export interface PropGround {
  /** Coarse ground top (m). */
  groundAt(x: number, z: number): number;
  isWater?(x: number, z: number): boolean;
  /** Bridge deck top (m) or null. */
  deckTopAt?(x: number, z: number): number | null;
}

export interface Bounds {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

/** Spacing of generated street lamps along lit roads (m). */
export const LAMP_SPACING = 30;
/** Generated lamps closer than this to an OSM lamp are dropped (m). */
export const LAMP_SUPPRESS = 12;
/** Distance from the carriageway edge (kerb) to a generated lamp (m). */
export const LAMP_KERB_OFFSET = 0.5;
/** OSM lamps within this distance of a vehicle road are snapped next to its kerb (m). */
export const LAMP_SNAP = 5;
const BENCH_SPACING = 25;
const FENCE_LEN = 2;
/** Everything within this many metres of the bounds is considered for obstacles and neighbours. */
const MARGIN = 40;
const LAMP_DEDUPE = 8;

// ---------------------------------------------------------------- helpers

export function hash(a: number, b = 0, c = 0): number {
  let h = Math.imul(a | 0, 0x9e3779b1) ^ Math.imul((b | 0) + 0x7f4a7c15, 0x85ebca6b) ^ Math.imul((c | 0) + 0x165667b1, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return h >>> 0;
}

/** Hash of a world position (cm resolution). */
function posHash(x: number, z: number, salt = 0): number {
  return hash(Math.round(x * 100), Math.round(z * 100), salt);
}

export interface WRoad {
  pts: Float64Array;
  n: number;
  cum: Float64Array;
  len: number;
  kind: number;
  flags: number;
  half: number;
  layer: number;
  bx0: number;
  bz0: number;
  bx1: number;
  bz1: number;
}

export interface WPoly {
  rings: Float64Array[];
  id: number;
  bx0: number;
  bz0: number;
  bx1: number;
  bz1: number;
  heightCm: number;
}

interface WArea {
  rings: Float64Array[];
  mat: number;
  bx0: number;
  bz0: number;
  bx1: number;
  bz1: number;
}

interface WLine {
  pts: Float64Array;
  n: number;
  kind: number;
  bx0: number;
  bz0: number;
  bx1: number;
  bz1: number;
}

export interface WPoint {
  x: number;
  z: number;
  kind: number;
  dir: number;
  name: number;
  tile: VectorTile;
}

function toWorld(src: Int32Array, ox: number, oz: number): Float64Array {
  const out = new Float64Array(src.length);
  for (let i = 0; i < src.length; i += 2) {
    out[i] = ox + src[i]! / 100;
    out[i + 1] = oz + src[i + 1]! / 100;
  }
  return out;
}

function bbox(p: Float64Array): [number, number, number, number] {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (let i = 0; i < p.length; i += 2) {
    const x = p[i]!, z = p[i + 1]!;
    if (x < a) a = x;
    if (x > c) c = x;
    if (z < b) b = z;
    if (z > d) d = z;
  }
  return [a, b, c, d];
}

function hits(b: Bounds, m: number, x0: number, z0: number, x1: number, z1: number): boolean {
  return !(x1 < b.x0 - m || x0 > b.x1 + m || z1 < b.z0 - m || z0 > b.z1 + m);
}

function isFootKind(kind: number): boolean {
  return kind === ROAD.FOOTWAY || kind === ROAD.PATH || kind === ROAD.CYCLEWAY
    || kind === ROAD.STEPS || kind === ROAD.PEDESTRIAN;
}

/** Drivable (carriageway) road kinds. */
export function isVehicleKind(kind: number): boolean {
  return kind >= ROAD.MOTORWAY && kind <= ROAD.SERVICE;
}

function sidewalkBand(kind: number): number {
  return kind === ROAD.PRIMARY || kind === ROAD.TRUNK || kind === ROAD.SECONDARY ? 3.5 : 2.5;
}

/** Scene data near `bounds`, in world metres. */
export class PropWorld {
  roads: WRoad[] = [];
  /** Roads that carry a surface carriageway at ground level (vehicle kinds, no bridges or tunnels). */
  veh: WRoad[] = [];
  foot: WRoad[] = [];
  buildings: WPoly[] = [];
  areas: WArea[] = [];
  lines: WLine[] = [];
  /** All points of the tiles (OSM lamps are needed for suppression regardless of the bounds). */
  points: WPoint[] = [];

  constructor(tiles: readonly VectorTile[], bounds: Bounds, margin = MARGIN) {
    for (const t of tiles) {
      const ox = t.rx * REGION_M, oz = t.rz * REGION_M;
      for (const r of t.roads) {
        const pts = toWorld(r.pts, ox, oz);
        if (pts.length < 4) continue;
        const [a, b, c, d] = bbox(pts);
        if (!hits(bounds, margin, a, b, c, d)) continue;
        const n = pts.length >> 1;
        const cum = new Float64Array(n);
        for (let i = 1; i < n; i++) cum[i] = cum[i - 1]! + Math.hypot(pts[i * 2]! - pts[i * 2 - 2]!, pts[i * 2 + 1]! - pts[i * 2 - 1]!);
        const minW = isFootKind(r.kind) ? 1 : 2.5;
        const w: WRoad = {
          pts, n, cum, len: cum[n - 1]!, kind: r.kind, flags: r.flags, layer: r.layer,
          half: Math.max(r.widthCm / 100, minW) / 2, bx0: a, bz0: b, bx1: c, bz1: d,
        };
        this.roads.push(w);
        const surface = (r.flags & ROAD_BRIDGE) === 0 && r.layer >= 0;
        if (surface && isVehicleKind(r.kind)) this.veh.push(w);
        else if (surface && isFootKind(r.kind)) this.foot.push(w);
      }
      for (const b of t.buildings) {
        const ring = b.rings[0];
        if (ring === undefined || ring.length < 6) continue;
        const rings = b.rings.map((q) => toWorld(q, ox, oz));
        const [x0, z0, x1, z1] = bbox(rings[0]!);
        if (!hits(bounds, margin, x0, z0, x1, z1)) continue;
        this.buildings.push({ rings, id: b.id, bx0: x0, bz0: z0, bx1: x1, bz1: z1, heightCm: b.heightCm });
      }
      for (const a of t.areas) {
        if (a.mat !== MAT.PARK && a.mat !== MAT.PLAZA) continue;
        const rings = a.rings.map((q) => toWorld(q, ox, oz));
        if (rings.length === 0 || rings[0]!.length < 6) continue;
        const [x0, z0, x1, z1] = bbox(rings[0]!);
        if (!hits(bounds, margin, x0, z0, x1, z1)) continue;
        this.areas.push({ rings, mat: a.mat, bx0: x0, bz0: z0, bx1: x1, bz1: z1 });
      }
      for (const l of t.lines) {
        if (l.kind !== LINE.FENCE || l.pts.length < 4) continue;
        const pts = toWorld(l.pts, ox, oz);
        const [x0, z0, x1, z1] = bbox(pts);
        if (!hits(bounds, 4, x0, z0, x1, z1)) continue;
        this.lines.push({ pts, n: pts.length >> 1, kind: l.kind, bx0: x0, bz0: z0, bx1: x1, bz1: z1 });
      }
      for (const p of t.points) {
        const x = ox + p.x / 100, z = oz + p.z / 100;
        if (!hits(bounds, margin, x, z, x, z)) continue;
        this.points.push({ x, z, kind: p.kind, dir: p.dir, name: p.name, tile: t });
      }
    }
  }
}

/** Even-odd containment over all rings (holes included). */
export function inRings(rings: readonly Float64Array[], x: number, z: number): boolean {
  let inside = false;
  for (const r of rings) {
    const n = r.length >> 1;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = r[i * 2]!, zi = r[i * 2 + 1]!, xj = r[j * 2]!, zj = r[j * 2 + 1]!;
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    }
  }
  return inside;
}

/** Distance from (x, z) to the outer ring of a polygon (0 inside). */
export function polyDist(p: WPoly, x: number, z: number): number {
  if (inRings(p.rings, x, z)) return 0;
  const r = p.rings[0]!;
  const n = r.length >> 1;
  let best = Infinity;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const d = segDist(x, z, r[j * 2]!, r[j * 2 + 1]!, r[i * 2]!, r[i * 2 + 1]!);
    if (d < best) best = d;
  }
  return best;
}

export function segDist(x: number, z: number, ax: number, az: number, bx: number, bz: number): number {
  const ex = bx - ax, ez = bz - az;
  const l2 = ex * ex + ez * ez;
  let t = l2 > 0 ? ((x - ax) * ex + (z - az) * ez) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(ax + ex * t - x, az + ez * t - z);
}

export interface Hit {
  d: number;
  px: number;
  pz: number;
  /** Unit tangent of the nearest segment. */
  tx: number;
  tz: number;
  s: number;
}

/** Nearest point of a road's centre line to (x, z). */
export function closest(r: WRoad, x: number, z: number, out: Hit): Hit {
  out.d = Infinity;
  const p = r.pts;
  for (let i = 0; i + 1 < r.n; i++) {
    const ax = p[i * 2]!, az = p[i * 2 + 1]!;
    const ex = p[i * 2 + 2]! - ax, ez = p[i * 2 + 3]! - az;
    const l2 = ex * ex + ez * ez;
    if (l2 === 0) continue;
    let t = ((x - ax) * ex + (z - az) * ez) / l2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = ax + ex * t, qz = az + ez * t;
    const d = Math.hypot(qx - x, qz - z);
    if (d < out.d) {
      const l = Math.sqrt(l2);
      out.d = d;
      out.px = qx;
      out.pz = qz;
      out.tx = ex / l;
      out.tz = ez / l;
      out.s = r.cum[i]! + t * l;
    }
  }
  return out;
}

/** Position and unit tangent at arc length s along a polyline. */
function atArc(pts: Float64Array, n: number, cum: Float64Array, s: number, out: Hit): void {
  let i = 0;
  while (i + 2 < n && cum[i + 1]! < s) i++;
  const ax = pts[i * 2]!, az = pts[i * 2 + 1]!;
  const ex = pts[i * 2 + 2]! - ax, ez = pts[i * 2 + 3]! - az;
  const l = Math.hypot(ex, ez) || 1;
  const t = Math.min(1, Math.max(0, (s - cum[i]!) / l));
  out.px = ax + ex * t;
  out.pz = az + ez * t;
  out.tx = ex / l;
  out.tz = ez / l;
  out.s = s;
}

function newHit(): Hit {
  return { d: 0, px: 0, pz: 0, tx: 1, tz: 0, s: 0 };
}

/** Local +z of a prop pointing along (dx, dz). */
function yawOf(dx: number, dz: number): number {
  return Math.atan2(dx, dz);
}

// ---------------------------------------------------------------- placement

/** Placement context shared by the individual generators. */
class Ctx {
  readonly hit = newHit();
  readonly out: PropPlacement[] = [];

  readonly w: PropWorld;
  readonly b: Bounds;
  readonly g: PropGround;
  readonly exclusions: readonly PropExclusion[];

  constructor(w: PropWorld, b: Bounds, g: PropGround, exclusions: readonly PropExclusion[]) {
    this.w = w;
    this.b = b;
    this.g = g;
    this.exclusions = exclusions;
  }

  inBounds(x: number, z: number): boolean {
    return x >= this.b.x0 && x < this.b.x1 && z >= this.b.z0 && z < this.b.z1;
  }

  /** Distance to the nearest building (0 inside). */
  buildingDist(x: number, z: number, limit = 3): number {
    let best = Infinity;
    for (const p of this.w.buildings) {
      if (x < p.bx0 - limit || x > p.bx1 + limit || z < p.bz0 - limit || z > p.bz1 + limit) continue;
      const d = polyDist(p, x, z);
      if (d < best) best = d;
    }
    return best;
  }

  blocked(x: number, z: number): boolean {
    if (this.g.isWater?.(x, z) === true) return true;
    if (this.g.deckTopAt?.(x, z) != null) return true;
    return false;
  }

  /** True when (x, z) is on the carriageway of any surface vehicle road (shrunk by `pad`). */
  onCarriageway(x: number, z: number, pad: number, skip?: WRoad): boolean {
    const h = this.hit;
    for (const r of this.w.veh) {
      if (r === skip) continue;
      if (x < r.bx0 - r.half - pad || x > r.bx1 + r.half + pad || z < r.bz0 - r.half - pad || z > r.bz1 + r.half + pad) continue;
      if (closest(r, x, z, h).d < r.half - pad) return true;
    }
    return false;
  }

  /** Ground height with the 15 cm kerb step where (x, z) is on a raised sidewalk band. */
  surfaceY(x: number, z: number): number {
    const base = this.g.groundAt(x, z);
    const h = this.hit;
    let walk = false;
    for (const r of this.w.veh) {
      if (x < r.bx0 - 6 || x > r.bx1 + 6 || z < r.bz0 - 6 || z > r.bz1 + 6) continue;
      const d = closest(r, x, z, h).d;
      if (d < r.half) return base;
      if ((r.flags & ROAD_SIDEWALK) !== 0 && r.kind !== ROAD.TRACK && d < r.half + sidewalkBand(r.kind)) walk = true;
    }
    return walk ? base + KERB_CM / 100 : base;
  }

  /** Nearest surface vehicle road within `max` metres of (x, z), preferring wider roads on ties. */
  nearestRoad(x: number, z: number, max: number, widest = false): { r: WRoad; hit: Hit } | null {
    let best: WRoad | null = null;
    const bh = newHit();
    const h = this.hit;
    for (const r of this.w.veh) {
      if (x < r.bx0 - max || x > r.bx1 + max || z < r.bz0 - max || z > r.bz1 + max) continue;
      closest(r, x, z, h);
      if (h.d > max) continue;
      const better = best === null || (widest && Math.abs(h.d - bh.d) < 3
        ? best !== null && (r.half > best.half + 1e-9 || (r.half === best.half && h.d < bh.d))
        : h.d < bh.d);
      if (best === null || better) {
        best = r;
        Object.assign(bh, h);
      }
    }
    return best === null ? null : { r: best, hit: bh };
  }

  add(kind: number, x: number, z: number, yaw: number, y?: number): void {
    for (const exclusion of this.exclusions) {
      if (!exclusion.kinds.includes(kind)) continue;
      const polygon = exclusion.polygon;
      let inside = false;
      for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i]![0], zi = polygon[i]![1], xj = polygon[j]![0], zj = polygon[j]![1];
        if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
      }
      if (inside) return;
    }
    this.out.push({ kind, variant: posHash(x, z, kind) % 3, x, y: y ?? this.surfaceY(x, z), z, yaw });
  }
}

function lampRoad(r: WRoad): boolean {
  if (r.kind === ROAD.TRACK || r.len < 8) return false;
  return r.kind <= ROAD.RESIDENTIAL || ((r.flags & ROAD_LIT) !== 0 && isVehicleKind(r.kind));
}

/** Generated lamp candidates (world metres) of one road piece. Spacing is even per piece, so pieces never double up. */
function lampCandidates(r: WRoad, out: { x: number; z: number; yaw: number; r: WRoad }[]): void {
  const n = Math.max(1, Math.round(r.len / LAMP_SPACING));
  const h0 = hash(Math.round(r.pts[0]! * 100), Math.round(r.pts[1]! * 100), r.n);
  const hit = newHit();
  for (let k = 0; k < n; k++) {
    atArc(r.pts, r.n, r.cum, ((k + 0.5) * r.len) / n, hit);
    const side = ((k + h0) & 1) === 0 ? 1 : -1;
    const nx = -hit.tz * side, nz = hit.tx * side;
    const off = r.half + LAMP_KERB_OFFSET;
    out.push({ x: hit.px + nx * off, z: hit.pz + nz * off, yaw: yawOf(-nx, -nz), r });
  }
}

function placeLamps(c: Ctx): void {
  const osm = c.w.points.filter((p) => p.kind === POINT.STREET_LAMP);
  // OSM lamps: snapped to the sidewalk side of the nearest road, arm towards it
  for (const p of osm) {
    if (!c.inBounds(p.x, p.z)) continue;
    let x = p.x, z = p.z, yaw = posHash(p.x, p.z, 77) / 4294967296 * Math.PI * 2;
    const near = c.nearestRoad(p.x, p.z, LAMP_SNAP);
    if (near !== null) {
      const { r, hit } = near;
      let nx = p.x - hit.px, nz = p.z - hit.pz;
      const l = Math.hypot(nx, nz);
      if (l < 0.05) { nx = -hit.tz; nz = hit.tx; } else { nx /= l; nz /= l; }
      const off = r.half + Math.min(1, Math.max(LAMP_KERB_OFFSET, hit.d - r.half));
      x = hit.px + nx * off;
      z = hit.pz + nz * off;
      yaw = yawOf(-nx, -nz);
    } else {
      const far = c.nearestRoad(p.x, p.z, 20);
      if (far !== null) yaw = yawOf(far.hit.px - p.x, far.hit.pz - p.z);
    }
    if (c.blocked(x, z) || c.buildingDist(x, z) < 0.3 || c.onCarriageway(x, z, 0.1)) continue;
    c.add(PROP.LAMP, x, z, yaw);
  }
  // generated lamps along lit roads of residential class and above; candidates of all nearby roads are
  // de-duplicated in a global order so parallel or overlapping pieces do not double up
  const cands: { x: number; z: number; yaw: number; r: WRoad }[] = [];
  for (const r of c.w.veh) if (lampRoad(r)) lampCandidates(r, cands);
  cands.sort((a, b) => a.x - b.x || a.z - b.z);
  const kept: { x: number; z: number }[] = [];
  for (const q of cands) {
    if (c.blocked(q.x, q.z)) continue;
    let bad = false;
    for (const p of osm) if (Math.hypot(p.x - q.x, p.z - q.z) < LAMP_SUPPRESS) { bad = true; break; }
    if (bad) continue;
    if (c.onCarriageway(q.x, q.z, 0.3, q.r) || c.buildingDist(q.x, q.z) < 0.5) continue;
    for (const k of kept) if (Math.hypot(k.x - q.x, k.z - q.z) < LAMP_DEDUPE) { bad = true; break; }
    if (bad) continue;
    kept.push(q);
    if (c.inBounds(q.x, q.z)) c.add(PROP.LAMP, q.x, q.z, q.yaw);
  }
}

function placeTrafficLights(c: Ctx): void {
  for (const p of c.w.points) {
    if (p.kind !== POINT.TRAFFIC_SIGNALS || !c.inBounds(p.x, p.z)) continue;
    const near = c.nearestRoad(p.x, p.z, 6, true);
    let tx: number, tz: number, half: number, px = p.x, pz = p.z;
    if (near !== null) {
      tx = near.hit.tx; tz = near.hit.tz; half = near.r.half; px = near.hit.px; pz = near.hit.pz;
    } else if (p.dir !== NO_DIR) {
      half = 3.5;
      tx = 0; tz = 0;
    } else continue;
    if (p.dir !== NO_DIR) {
      // the OSM node direction (road axis at the signal, 256ths of a turn) wins over the nearest road's
      // tangent, which at a junction may belong to the cross street
      const a = (p.dir / 256) * Math.PI * 2;
      tx = Math.cos(a); tz = Math.sin(a);
    }
    const rx = -tz, rz = tx; // right-hand side of traffic heading +t
    const back = 4, off = half + 0.6;
    const spots: [number, number, number, number][] = [
      [px - tx * back + rx * off, pz - tz * back + rz * off, -tx, -tz], // for traffic heading +t, faces it
      [px + tx * back - rx * off, pz + tz * back - rz * off, tx, tz],
    ];
    for (const [x, z, dx, dz] of spots) {
      if (c.blocked(x, z) || c.buildingDist(x, z) < 0.3) continue;
      c.add(PROP.TRAFFIC_LIGHT, x, z, yawOf(dx, dz));
    }
  }
}

/** A free-standing shop sign: post position, unit direction the plate faces (towards the road), kerb step. */
export interface PostSpot {
  x: number;
  z: number;
  nx: number;
  nz: number;
  /** True on a raised sidewalk band (+KERB_CM), as Ctx.surfaceY. */
  raised: boolean;
}

/** Shops with no building within this distance (m) get a post instead of a wall sign (see sign-place.ts). */
export const SIGN_BUILDING_RANGE = 25;
const POST_ROAD_RANGE = 40;

/**
 * Where the free-standing sign of shop `p` stands, or null when it has a building within
 * SIGN_BUILDING_RANGE (it gets a wall sign) or no free spot exists. Pure world data, so the post prop
 * (placeProps) and the sign quad (placeSigns) agree. The post stands on the sidewalk of the nearest
 * drivable road, on the shop's side, opposite the shop point; the plate faces the road.
 */
export function shopPostSpot(w: PropWorld, p: WPoint): PostSpot | null {
  const L = SIGN_BUILDING_RANGE;
  for (const b of w.buildings) {
    if (p.x < b.bx0 - L || p.x > b.bx1 + L || p.z < b.bz0 - L || p.z > b.bz1 + L) continue;
    if (polyDist(b, p.x, p.z) <= L) return null;
  }
  const h = newHit();
  let best: WRoad | null = null;
  const bh = newHit();
  for (const r of w.veh) {
    if (p.x < r.bx0 - POST_ROAD_RANGE || p.x > r.bx1 + POST_ROAD_RANGE || p.z < r.bz0 - POST_ROAD_RANGE || p.z > r.bz1 + POST_ROAD_RANGE) continue;
    closest(r, p.x, p.z, h);
    if (h.d <= POST_ROAD_RANGE && (best === null || h.d < bh.d)) { best = r; Object.assign(bh, h); }
  }
  if (best === null) return null;
  const cross = bh.tx * (p.z - bh.pz) - bh.tz * (p.x - bh.px);
  const first = Math.abs(cross) < 0.3 ? (posHash(p.x, p.z, 11) & 1 ? 1 : -1) : cross > 0 ? 1 : -1;
  const off = best.half + 1.2;
  for (const side of [first, -first]) {
    const nx = -bh.tz * side, nz = bh.tx * side; // from the road towards the post
    const x = bh.px + nx * off, z = bh.pz + nz * off;
    let bad = false;
    for (const b of w.buildings) {
      if (x < b.bx0 - 0.4 || x > b.bx1 + 0.4 || z < b.bz0 - 0.4 || z > b.bz1 + 0.4) continue;
      if (polyDist(b, x, z) < 0.4) { bad = true; break; }
    }
    if (bad) continue;
    for (const r of w.veh) {
      if (r === best || x < r.bx0 - r.half || x > r.bx1 + r.half || z < r.bz0 - r.half || z > r.bz1 + r.half) continue;
      if (closest(r, x, z, h).d < r.half + 0.3) { bad = true; break; }
    }
    if (bad) continue;
    return { x, z, nx: -nx, nz: -nz, raised: (best.flags & ROAD_SIDEWALK) !== 0 && best.kind !== ROAD.TRACK };
  }
  return null;
}

function placeSignPosts(c: Ctx): void {
  for (const p of c.w.points) {
    if (p.kind !== POINT.SHOP || p.name < 0 || (p.tile.strings[p.name] ?? '') === '' || !c.inBounds(p.x, p.z)) continue;
    const s = shopPostSpot(c.w, p);
    if (s === null) continue;
    c.add(PROP.SIGN_POST, s.x, s.z, yawOf(s.nx, s.nz), c.g.groundAt(s.x, s.z) + (s.raised ? KERB_CM / 100 : 0));
  }
}

function placeBusStops(c: Ctx): void {
  for (const p of c.w.points) {
    if (p.kind !== POINT.BUS_STOP || !c.inBounds(p.x, p.z)) continue;
    const near = c.nearestRoad(p.x, p.z, 25);
    if (near === null) continue;
    const { r, hit } = near;
    const cross = hit.tx * (p.z - hit.pz) - hit.tz * (p.x - hit.px);
    const side = Math.abs(cross) < 0.3 ? (posHash(p.x, p.z, 5) & 1 ? 1 : -1) : cross > 0 ? 1 : -1;
    // `cross > 0` is the (-tz, tx) side
    const nx = -hit.tz * side, nz = hit.tx * side;
    const off = r.half + 1.2;
    const x = hit.px + nx * off, z = hit.pz + nz * off;
    if (c.blocked(x, z) || c.buildingDist(x, z) < 0.3 || c.onCarriageway(x, z, 0.1)) continue;
    const yaw = yawOf(-nx, -nz);
    c.add(PROP.BUS_SHELTER, x, z, yaw);
    // a bin beside the shelter, 2.6 m along the road
    const dir = (posHash(p.x, p.z, 6) & 1) === 0 ? 1 : -1;
    const bx = x + hit.tx * 2.6 * dir, bz = z + hit.tz * 2.6 * dir;
    if (!c.blocked(bx, bz) && c.buildingDist(bx, bz) >= 0.3 && !c.onCarriageway(bx, bz, 0.1)) c.add(PROP.BIN, bx, bz, yaw);
  }
}

function inGreen(w: PropWorld, x: number, z: number): boolean {
  for (const a of w.areas) {
    if (x < a.bx0 || x > a.bx1 || z < a.bz0 || z > a.bz1) continue;
    if (inRings(a.rings, x, z)) return true;
  }
  return false;
}

function placeBenches(c: Ctx): void {
  const hit = newHit();
  for (const r of c.w.foot) {
    if (r.kind === ROAD.STEPS || r.len < 12) continue;
    const n = Math.max(1, Math.round(r.len / BENCH_SPACING));
    const h0 = hash(Math.round(r.pts[0]! * 100), Math.round(r.pts[1]! * 100), r.n);
    for (let k = 0; k < n; k++) {
      atArc(r.pts, r.n, r.cum, ((k + 0.5) * r.len) / n, hit);
      if (!inGreen(c.w, hit.px, hit.pz)) continue;
      const side = ((k + h0) & 1) === 0 ? 1 : -1;
      const nx = -hit.tz * side, nz = hit.tx * side;
      const off = r.half + 0.5;
      const x = hit.px + nx * off, z = hit.pz + nz * off;
      const yaw = yawOf(-nx, -nz);
      if (c.inBounds(x, z) && !c.blocked(x, z) && c.buildingDist(x, z) >= 0.3 && !c.onCarriageway(x, z, 0.1)) {
        c.add(PROP.BENCH, x, z, yaw);
      }
      if ((k & 1) === 1) {
        const bx = x + hit.tx * 1.7, bz = z + hit.tz * 1.7;
        if (c.inBounds(bx, bz) && !c.blocked(bx, bz) && c.buildingDist(bx, bz) >= 0.3 && !c.onCarriageway(bx, bz, 0.1)) {
          c.add(PROP.BIN, bx, bz, yaw);
        }
      }
    }
  }
  // OSM benches / waste baskets, if the data ever has them
  for (const p of c.w.points) {
    if ((p.kind !== POINT.BENCH && p.kind !== POINT.WASTE_BASKET) || !c.inBounds(p.x, p.z)) continue;
    const yaw = p.dir === NO_DIR ? posHash(p.x, p.z, 9) / 4294967296 * Math.PI * 2 : (p.dir / 256) * Math.PI * 2;
    c.add(p.kind === POINT.BENCH ? PROP.BENCH : PROP.BIN, p.x, p.z, yaw);
  }
}

function placeFences(c: Ctx): void {
  const hit = newHit();
  for (const l of c.w.lines) {
    const cum = new Float64Array(l.n);
    for (let i = 1; i < l.n; i++) cum[i] = cum[i - 1]! + Math.hypot(l.pts[i * 2]! - l.pts[i * 2 - 2]!, l.pts[i * 2 + 1]! - l.pts[i * 2 - 1]!);
    const len = cum[l.n - 1]!;
    for (let s = FENCE_LEN / 2; s < len + 1e-9; s += FENCE_LEN) {
      atArc(l.pts, l.n, cum, Math.min(s, len), hit);
      const x = hit.px, z = hit.pz;
      if (!c.inBounds(x, z) || c.blocked(x, z) || c.buildingDist(x, z) < 0.1) continue;
      c.add(PROP.FENCE, x, z, Math.atan2(-hit.tz, hit.tx), c.g.groundAt(x, z));
    }
  }
}

/** All props whose anchor lies in the half-open `bounds`, deterministic and chunk independent. */
export function placeProps(
  tiles: readonly VectorTile[], bounds: Bounds, ground: PropGround, exclusions: readonly PropExclusion[] = [],
): PropPlacement[] {
  const w = new PropWorld(tiles, bounds);
  const c = new Ctx(w, bounds, ground, exclusions);
  placeLamps(c);
  placeTrafficLights(c);
  placeSignPosts(c);
  placeBusStops(c);
  placeBenches(c);
  placeFences(c);
  return c.out;
}

// ---------------------------------------------------------------- meshing

const modelCache = new Map<number, ReturnType<typeof buildProp>>();

/** Transformed copy of every placement as one mesh in chunk-local coordinates (origin ox, oz). */
export function buildPropMesh(placements: readonly PropPlacement[], ox: number, oz: number): ChunkMesh {
  let nv = 0, ni = 0;
  const models = placements.map((p) => {
    const key = p.kind * 4 + p.variant;
    let m = modelCache.get(key);
    if (m === undefined) { m = buildProp(p.kind, p.variant); modelCache.set(key, m); }
    nv += m.positions.length / 3;
    ni += m.indices.length;
    return m;
  });
  const positions = new Float32Array(nv * 3);
  const normals = new Float32Array(nv * 3);
  const colors = new Float32Array(nv * 3);
  const walls = new Float32Array(nv * 4);
  const indices = new Uint32Array(ni);
  let vo = 0, io = 0;
  for (let k = 0; k < placements.length; k++) {
    const p = placements[k]!, m = models[k]!;
    const s = Math.sin(p.yaw), co = Math.cos(p.yaw);
    const n = m.positions.length / 3;
    const px = p.x - ox, pz = p.z - oz;
    for (let i = 0; i < n; i++) {
      const x = m.positions[i * 3]!, y = m.positions[i * 3 + 1]!, z = m.positions[i * 3 + 2]!;
      positions[(vo + i) * 3] = px + x * co + z * s;
      positions[(vo + i) * 3 + 1] = p.y + y;
      positions[(vo + i) * 3 + 2] = pz - x * s + z * co;
      const nx = m.normals[i * 3]!, nz = m.normals[i * 3 + 2]!;
      normals[(vo + i) * 3] = nx * co + nz * s;
      normals[(vo + i) * 3 + 1] = m.normals[i * 3 + 1]!;
      normals[(vo + i) * 3 + 2] = -nx * s + nz * co;
    }
    colors.set(m.colors, vo * 3);
    walls.set(m.walls, vo * 4);
    for (let i = 0; i < m.indices.length; i++) indices[io + i] = m.indices[i]! + vo;
    vo += n;
    io += m.indices.length;
  }
  return { positions, normals, colors, walls, indices };
}

/** Appends `extra` to `base` (indices rebased). */
export function appendMesh(base: ChunkMesh, extra: ChunkMesh): ChunkMesh {
  if (extra.indices.length === 0) return base;
  const nv = base.positions.length / 3;
  const indices = new Uint32Array(base.indices.length + extra.indices.length);
  indices.set(base.indices);
  for (let i = 0; i < extra.indices.length; i++) indices[base.indices.length + i] = extra.indices[i]! + nv;
  const cat = (a: Float32Array, b: Float32Array): Float32Array => {
    const o = new Float32Array(a.length + b.length);
    o.set(a);
    o.set(b, a.length);
    return o;
  };
  return {
    positions: cat(base.positions, extra.positions),
    normals: cat(base.normals, extra.normals),
    colors: cat(base.colors, extra.colors),
    walls: cat(base.walls, extra.walls),
    indices,
  };
}

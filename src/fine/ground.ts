/**
 * Fine ground generator: rasterises a chunk's 0.2 m micro-voxel ground (material + height per cell)
 * from the coarse cells and the decoded vector tiles. Pure and deterministic; runs in a worker.
 *
 * Composition order: coarse base -> areas -> track ballast -> footways -> sidewalks (raised kerb)
 * -> carriageways -> lane/centre/edge markings -> zebra crossings -> rail/tram steel -> AO.
 */
import { MAT } from '../world/materials.ts';
import {
  LINE,
  NO_DIR,
  POINT,
  ROAD,
  ROAD_BRIDGE,
  ROAD_ONEWAY,
  ROAD_SIDEWALK,
  ROAD_UNPAVED,
  type VRoad,
  type VectorTile,
} from '../world/vector-format.ts';
import { CHUNK, REGION_CHUNKS, VOXEL } from '../world/constants.ts';
import { PATCH_PLANE, PATCH_W, P_GH, P_MAT, P_SH } from './patch.ts';
import {
  CHUNK_SIZE_M,
  CM_PER_VOXEL,
  FINE_CELL,
  FINE_N,
  FINE_PER_COARSE,
  FineGrid,
  dashPeriod,
  fillRings,
  paintBuffer,
  paintStripe,
  type StripeOpts,
} from './raster.ts';

export interface FineInput {
  /** Global chunk coordinates. */
  gcx: number;
  gcz: number;
  /** Coarse window from {@link buildPatch}. */
  patch: Uint8Array;
  /** Decoded tiles of the chunk's 3x3 region neighbourhood (any order; missing tiles = no items). */
  tiles: readonly VectorTile[];
}

/** Sidewalk kerb height above the carriageway in cm. */
export const KERB_CM = 15;
const REGION_M = REGION_CHUNKS * CHUNK * VOXEL;
const SIDEWALK_WIDTH = 2.5;
const SIDEWALK_WIDTH_MAJOR = 3.5;
/** Centre of a rail to the centre of the other: 1520 mm gauge. */
export const RAIL_GAUGE = 1.52;
const RAIL_HALF = 0.1;
const MARK_HALF = 0.1;
const JUNCTION_PAD = 2;
/** Roads and rails this close to the chunk (metres) are rasterised; covers junction radii too. */
const ROAD_MARGIN = 24;
const ZEBRA_SEARCH = 8;
const ZEBRA_LENGTH = 3;
const ZEBRA_STRIPE = 0.5;
const ZEBRA_PITCH = 1.0;

function table(...mats: number[]): Uint8Array {
  const t = new Uint8Array(256);
  for (const m of mats) t[m] = 1;
  return t;
}
const ROAD_MATS = table(MAT.ASPHALT, MAT.SIDEWALK, MAT.RAIL, MAT.WATER, MAT.AIR);
const ASPHALT_ONLY = table(MAT.ASPHALT);
const GRASSY = table(MAT.GRASS, MAT.PARK, MAT.FOREST, MAT.DIRT, MAT.SAND);
const NOT_GRASSY = (() => {
  const t = new Uint8Array(256).fill(1);
  for (let i = 0; i < 256; i++) if (GRASSY[i] === 1) t[i] = 0;
  return t;
})();

/** Paint order of carriageways: minor classes first, major last. */
function roadRank(kind: number): number {
  switch (kind) {
    case ROAD.TRACK: return 0;
    case ROAD.SERVICE: return 1;
    case ROAD.LIVING_STREET: return 2;
    case ROAD.UNCLASSIFIED: return 2;
    case ROAD.RESIDENTIAL: return 3;
    case ROAD.TERTIARY: return 4;
    case ROAD.SECONDARY: return 5;
    case ROAD.PRIMARY: return 6;
    case ROAD.TRUNK: return 7;
    case ROAD.MOTORWAY: return 8;
    default: return 3;
  }
}

function isFootKind(kind: number): boolean {
  return kind === ROAD.FOOTWAY || kind === ROAD.PATH || kind === ROAD.CYCLEWAY
    || kind === ROAD.STEPS || kind === ROAD.PEDESTRIAN;
}

function isMajor(kind: number): boolean {
  return kind === ROAD.PRIMARY || kind === ROAD.TRUNK || kind === ROAD.MOTORWAY;
}

/** A road in chunk-local metres. */
interface LRoad {
  pts: Float64Array;
  n: number;
  /** Arc length at each vertex. */
  cum: Float64Array;
  len: number;
  kind: number;
  flags: number;
  half: number;
  lanes: number;
  name: number;
  /** Paint order (rank, then input order). */
  order: number;
  /** Owner id (index in the carriageway paint order + 1); set while painting. */
  ownerId: number;
}

interface LLine {
  pts: Float64Array;
  n: number;
  cum: Float64Array;
  kind: number;
}

function localPoints(tile: VectorTile, src: Int32Array, gcx: number, gcz: number): Float64Array {
  const ox = tile.rx * REGION_M - gcx * CHUNK_SIZE_M;
  const oz = tile.rz * REGION_M - gcz * CHUNK_SIZE_M;
  const n = src.length >> 1;
  const out = new Float64Array(n * 2);
  for (let i = 0; i < n; i++) {
    out[i * 2] = ox + src[i * 2]! / 100;
    out[i * 2 + 1] = oz + src[i * 2 + 1]! / 100;
  }
  return out;
}

function nearChunk(pts: Float64Array, margin: number): boolean {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    const x = pts[i]!, z = pts[i + 1]!;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (z < z0) z0 = z;
    if (z > z1) z1 = z;
  }
  return x1 >= -margin && x0 <= CHUNK_SIZE_M + margin && z1 >= -margin && z0 <= CHUNK_SIZE_M + margin;
}

function cumulative(pts: Float64Array): Float64Array {
  const n = pts.length >> 1;
  const cum = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    cum[i] = cum[i - 1]! + Math.hypot(pts[i * 2]! - pts[i * 2 - 2]!, pts[i * 2 + 1]! - pts[i * 2 - 1]!);
  }
  return cum;
}

function toLRoad(pts: Float64Array, r: VRoad, order: number): LRoad {
  const cum = cumulative(pts);
  const minW = isFootKind(r.kind) ? 1 : 2.5;
  return {
    pts, n: pts.length >> 1, cum, len: cum[cum.length - 1]!, kind: r.kind, flags: r.flags,
    half: Math.max(r.widthCm / 100, minW) / 2, lanes: r.lanes, name: r.name, order, ownerId: 0,
  };
}

// ---------------------------------------------------------------- base

/** Most common non-road, non-water ground material among the 8 neighbours (ties: lowest id), else GRASS. */
function fillMaterial(patch: Uint8Array, pcx: number, pcz: number): number {
  const counts = fillCounts;
  counts.fill(0);
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dz === 0) continue;
      const m = patch[P_MAT * PATCH_PLANE + (pcz + dz) * PATCH_W + pcx + dx]!;
      if (ROAD_MATS[m] === 0) counts[m]!++;
    }
  }
  let best: number = MAT.GRASS;
  let bestN = 0;
  for (let m = 1; m < 256; m++) {
    if (counts[m]! > bestN) { bestN = counts[m]!; best = m; }
  }
  return best;
}
const fillCounts = new Uint8Array(256);

function paintBase(g: FineGrid, patch: Uint8Array): void {
  for (let lz = 0; lz < CHUNK; lz++) {
    for (let lx = 0; lx < CHUNK; lx++) {
      const pi = (lz + 1) * PATCH_W + lx + 1;
      const gm = patch[P_MAT * PATCH_PLANE + pi]!;
      const hcm = patch[P_GH * PATCH_PLANE + pi]! * CM_PER_VOXEL;
      const solid = patch[P_SH * PATCH_PLANE + pi]! === 0 && gm !== MAT.WATER;
      const mat = !solid ? 0 : ROAD_MATS[gm] === 1 ? fillMaterial(patch, lx + 1, lz + 1) : gm;
      for (let fz = 0; fz < FINE_PER_COARSE; fz++) {
        const row = (lz * FINE_PER_COARSE + fz) * FINE_N + lx * FINE_PER_COARSE;
        g.mat.fill(mat, row, row + FINE_PER_COARSE);
        g.hcm.fill(hcm, row, row + FINE_PER_COARSE);
        g.base.fill(hcm, row, row + FINE_PER_COARSE);
      }
    }
  }
}

// ---------------------------------------------------------------- junctions

interface JNode {
  x: number;
  z: number;
  deg: number;
  members: number;
  name0: number;
  kind0: number;
  differs: boolean;
  maxHalf: number;
}

/**
 * Junction zones (x, z, radius squared) where markings are suppressed. A road vertex is a junction when
 * three or more road pieces meet (an end counts 1, a pass-through 2), or two pieces of a different
 * name or class meet. Pieces of one road split at 64 m just share an end and are not junctions.
 */
function findJunctions(roads: readonly LRoad[]): Float64Array {
  const nodes = new Map<number, JNode>();
  for (const r of roads) {
    if (isFootKind(r.kind)) continue;
    for (let v = 0; v < r.n; v++) {
      const x = r.pts[v * 2]!, z = r.pts[v * 2 + 1]!;
      const key = (Math.round(x * 100) + 1e6) * 4e6 + Math.round(z * 100) + 1e6;
      let nd = nodes.get(key);
      if (nd === undefined) {
        nd = { x, z, deg: 0, members: 0, name0: r.name, kind0: r.kind, differs: false, maxHalf: 0 };
        nodes.set(key, nd);
      } else if (nd.name0 !== r.name || nd.kind0 !== r.kind) {
        nd.differs = true;
      }
      nd.deg += v === 0 || v === r.n - 1 ? 1 : 2;
      nd.members++;
      if (r.half > nd.maxHalf) nd.maxHalf = r.half;
    }
  }
  const out: number[] = [];
  for (const nd of nodes.values()) {
    if (nd.deg >= 3 || (nd.members >= 2 && nd.differs)) {
      const r = nd.maxHalf + JUNCTION_PAD;
      out.push(nd.x, nd.z, r * r);
    }
  }
  return Float64Array.from(out);
}

/** Zones of `all` that can touch a road (its bbox grown by the zone radius). */
function zonesNear(all: Float64Array, r: LRoad): { zones: Float64Array; count: number } {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < r.n; i++) {
    const x = r.pts[i * 2]!, z = r.pts[i * 2 + 1]!;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (z < z0) z0 = z;
    if (z > z1) z1 = z;
  }
  const keep: number[] = [];
  for (let j = 0; j < all.length; j += 3) {
    const rad = Math.sqrt(all[j + 2]!);
    if (all[j]! >= x0 - rad && all[j]! <= x1 + rad && all[j + 1]! >= z0 - rad && all[j + 1]! <= z1 + rad) {
      keep.push(all[j]!, all[j + 1]!, all[j + 2]!);
    }
  }
  return { zones: Float64Array.from(keep), count: keep.length / 3 };
}

// ---------------------------------------------------------------- markings

const stripe: StripeOpts = {
  offset: 0, half: MARK_HALF, period: 0, mat: MAT.MARKING, need: ASPHALT_ONLY, owner: 0, zones: null, zoneCount: 0,
};

function paintMark(g: FineGrid, r: LRoad, offset: number, dashed: boolean, zones: Float64Array, count: number): void {
  stripe.offset = offset;
  stripe.half = MARK_HALF;
  stripe.period = dashed ? dashPeriod(r.len) : 0;
  stripe.mat = MAT.MARKING;
  stripe.need = ASPHALT_ONLY;
  stripe.owner = r.ownerId;
  stripe.zones = zones;
  stripe.zoneCount = count;
  paintStripe(g, r.pts, r.n, r.cum, stripe);
}

function paintRoadMarkings(g: FineGrid, r: LRoad, junctions: Float64Array): void {
  if (r.kind === ROAD.TRACK || r.kind === ROAD.SERVICE || (r.flags & ROAD_UNPAVED) !== 0) return;
  if (r.len < 4.5) return;
  const w = r.half * 2;
  const oneway = (r.flags & ROAD_ONEWAY) !== 0;
  const { zones, count } = zonesNear(junctions, r);
  const lanes = r.lanes;
  let centre = false;
  if (!oneway && w >= 6) {
    centre = true;
    if (isMajor(r.kind) && lanes >= 4) {
      paintMark(g, r, -0.3, false, zones, count);
      paintMark(g, r, 0.3, false, zones, count);
    } else {
      paintMark(g, r, 0, true, zones, count);
    }
  }
  if ((oneway && lanes >= 3) || (!oneway && lanes >= 4)) {
    const laneW = w / lanes;
    for (let k = 1; k < lanes; k++) {
      const v = -r.half + k * laneW;
      if (!oneway && centre && Math.abs(v) < 0.8) continue;
      paintMark(g, r, v, true, zones, count);
    }
  }
  if (r.kind === ROAD.PRIMARY || r.kind === ROAD.SECONDARY || r.kind === ROAD.TRUNK || r.kind === ROAD.MOTORWAY) {
    paintMark(g, r, -(r.half - 0.3), false, zones, count);
    paintMark(g, r, r.half - 0.3, false, zones, count);
  }
}

/** Nearest point of the road polyline to (x, z): fills `near` with distance, point, segment direction. */
const near = { d: 0, px: 0, pz: 0, dx: 1, dz: 0 };
function nearestOnRoad(r: LRoad, x: number, z: number): void {
  let best = Infinity;
  for (let k = 0; k + 1 < r.n; k++) {
    const ax = r.pts[k * 2]!, az = r.pts[k * 2 + 1]!;
    const ex = r.pts[k * 2 + 2]! - ax, ez = r.pts[k * 2 + 3]! - az;
    const l2 = ex * ex + ez * ez;
    if (l2 === 0) continue;
    let t = ((x - ax) * ex + (z - az) * ez) / l2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = ax + t * ex, qz = az + t * ez;
    const d = Math.hypot(x - qx, z - qz);
    if (d < best) {
      const l = Math.sqrt(l2);
      best = d;
      near.d = d; near.px = qx; near.pz = qz; near.dx = ex / l; near.dz = ez / l;
    }
  }
  if (best === Infinity) near.d = Infinity;
}

function paintZebra(g: FineGrid, roads: readonly LRoad[], x: number, z: number, dir: number): void {
  let bestRoad: LRoad | null = null;
  let bd = Infinity, bpx = 0, bpz = 0, bdx = 1, bdz = 0;
  for (const r of roads) {
    if (isFootKind(r.kind) || r.kind === ROAD.TRACK) continue;
    nearestOnRoad(r, x, z);
    // ties go to the wider (more important) road, then to input order
    if (near.d <= ZEBRA_SEARCH && (near.d < bd - 1e-9 || (Math.abs(near.d - bd) <= 1e-9 && bestRoad !== null && r.half > bestRoad.half))) {
      bestRoad = r; bd = near.d; bpx = near.px; bpz = near.pz; bdx = near.dx; bdz = near.dz;
    }
  }
  if (bestRoad === null) return;
  let dx = bdx, dz = bdz;
  if (dir !== NO_DIR) {
    const a = (dir / 256) * Math.PI * 2;
    const cx = Math.cos(a), cz = Math.sin(a);
    // the node direction may come from a footway; trust it only when it follows the road
    if (Math.abs(cx * bdz - cz * bdx) < 0.5) { dx = cx; dz = cz; }
  }
  const hw = bestRoad.half;
  const w = hw * 2;
  const count = Math.max(1, Math.floor((w - ZEBRA_STRIPE) / ZEBRA_PITCH) + 1);
  const start = (w - ((count - 1) * ZEBRA_PITCH + ZEBRA_STRIPE)) / 2;
  const reach = Math.hypot(ZEBRA_LENGTH / 2, hw);
  const x0 = Math.max(0, Math.floor((bpx - reach) / FINE_CELL));
  const x1 = Math.min(FINE_N - 1, Math.floor((bpx + reach) / FINE_CELL));
  const z0 = Math.max(0, Math.floor((bpz - reach) / FINE_CELL));
  const z1 = Math.min(FINE_N - 1, Math.floor((bpz + reach) / FINE_CELL));
  for (let cz = z0; cz <= z1; cz++) {
    const pz = (cz + 0.5) * FINE_CELL - bpz;
    for (let cx = x0; cx <= x1; cx++) {
      const i = cz * FINE_N + cx;
      if (g.mat[i] !== MAT.ASPHALT) continue;
      const px = (cx + 0.5) * FINE_CELL - bpx;
      const u = px * dx + pz * dz;
      if (u < -ZEBRA_LENGTH / 2 || u > ZEBRA_LENGTH / 2) continue;
      const t = -px * dz + pz * dx + hw - start;
      if (t < 0) continue;
      const j = Math.floor(t);
      if (j >= count || t - j >= ZEBRA_STRIPE) continue;
      g.mat[i] = MAT.MARKING;
    }
  }
}

// ---------------------------------------------------------------- AO

const AO_PAD = 4;
const AO_W = FINE_N + 2 * AO_PAD;
const aoDist = new Uint8Array(AO_W * AO_W);

/** Contact shadow next to coarse building walls and at the foot of kerbs; 4 levels (0 darkest). */
function paintAo(g: FineGrid, patch: Uint8Array): void {
  const cap = AO_PAD;
  for (let wz = 0; wz < AO_W; wz++) {
    const pz = Math.floor((wz - AO_PAD) / FINE_PER_COARSE) + 1;
    for (let wx = 0; wx < AO_W; wx++) {
      const px = Math.floor((wx - AO_PAD) / FINE_PER_COARSE) + 1;
      aoDist[wz * AO_W + wx] = patch[P_SH * PATCH_PLANE + pz * PATCH_W + px]! > 0 ? 0 : cap;
    }
  }
  for (let wz = 0; wz < AO_W; wz++) {
    for (let wx = 0; wx < AO_W; wx++) {
      let d = aoDist[wz * AO_W + wx]!;
      if (d === 0) continue;
      if (wx > 0) d = Math.min(d, aoDist[wz * AO_W + wx - 1]! + 1);
      if (wz > 0) {
        d = Math.min(d, aoDist[(wz - 1) * AO_W + wx]! + 1);
        if (wx > 0) d = Math.min(d, aoDist[(wz - 1) * AO_W + wx - 1]! + 1);
        if (wx < AO_W - 1) d = Math.min(d, aoDist[(wz - 1) * AO_W + wx + 1]! + 1);
      }
      aoDist[wz * AO_W + wx] = d;
    }
  }
  for (let wz = AO_W - 1; wz >= 0; wz--) {
    for (let wx = AO_W - 1; wx >= 0; wx--) {
      let d = aoDist[wz * AO_W + wx]!;
      if (d === 0) continue;
      if (wx < AO_W - 1) d = Math.min(d, aoDist[wz * AO_W + wx + 1]! + 1);
      if (wz < AO_W - 1) {
        d = Math.min(d, aoDist[(wz + 1) * AO_W + wx]! + 1);
        if (wx > 0) d = Math.min(d, aoDist[(wz + 1) * AO_W + wx - 1]! + 1);
        if (wx < AO_W - 1) d = Math.min(d, aoDist[(wz + 1) * AO_W + wx + 1]! + 1);
      }
      aoDist[wz * AO_W + wx] = d;
    }
  }
  for (let cz = 0; cz < FINE_N; cz++) {
    for (let cx = 0; cx < FINE_N; cx++) {
      const i = cz * FINE_N + cx;
      if (g.mat[i] === 0) continue;
      let level = 3;
      const d = aoDist[(cz + AO_PAD) * AO_W + cx + AO_PAD]!;
      if (d <= 1) level = 1;
      else if (d <= 3) level = 2;
      if (level > 2) {
        const h = g.hcm[i]! + 10;
        if ((cx > 0 && g.mat[i - 1] !== 0 && g.hcm[i - 1]! >= h)
          || (cx < FINE_N - 1 && g.mat[i + 1] !== 0 && g.hcm[i + 1]! >= h)
          || (cz > 0 && g.mat[i - FINE_N] !== 0 && g.hcm[i - FINE_N]! >= h)
          || (cz < FINE_N - 1 && g.mat[i + FINE_N] !== 0 && g.hcm[i + FINE_N]! >= h)) level = 2;
      }
      g.ao[i] = level;
    }
  }
}

// ---------------------------------------------------------------- composition

/** Rasterises one chunk's fine ground. */
export function rasterizeGround(input: FineInput): FineGrid {
  const { gcx, gcz, patch } = input;
  const g = new FineGrid();
  paintBase(g, patch);

  const tiles = [...input.tiles].sort((a, b) => a.rz - b.rz || a.rx - b.rx);
  const rx = Math.floor(gcx / REGION_CHUNKS);
  const rz = Math.floor(gcz / REGION_CHUNKS);

  // ---- areas: only the chunk's own region (areas are duplicated into every overlapping region)
  for (const t of tiles) {
    if (t.rx !== rx || t.rz !== rz) continue;
    const order = t.areas.map((_, i) => i).sort((a, b) => t.areas[a]!.prio - t.areas[b]!.prio || a - b);
    for (const ai of order) {
      const a = t.areas[ai]!;
      if (a.mat === MAT.WATER || a.mat === MAT.AIR || a.rings.length === 0) continue;
      const rings = a.rings.map((r) => localPoints(t, r, gcx, gcz));
      if (!nearChunk(rings[0]!, 0)) continue;
      fillRings(g, rings, a.mat);
    }
  }

  // ---- gather linear features
  const veh: LRoad[] = [];
  const foot: LRoad[] = [];
  const lines: LLine[] = [];
  let order = 0;
  for (const t of tiles) {
    for (const r of t.roads) {
      if (r.layer !== 0 || (r.flags & ROAD_BRIDGE) !== 0 || r.pts.length < 4) continue;
      const pts = localPoints(t, r.pts, gcx, gcz);
      if (!nearChunk(pts, isFootKind(r.kind) ? 6 : ROAD_MARGIN)) continue;
      const lr = toLRoad(pts, r, order++);
      (isFootKind(r.kind) ? foot : veh).push(lr);
    }
    for (const l of t.lines) {
      if ((l.kind !== LINE.RAIL && l.kind !== LINE.TRAM) || l.pts.length < 4) continue;
      const pts = localPoints(t, l.pts, gcx, gcz);
      if (!nearChunk(pts, 6)) continue;
      lines.push({ pts, n: pts.length >> 1, cum: cumulative(pts), kind: l.kind });
    }
  }
  veh.sort((a, b) => roadRank(a.kind) - roadRank(b.kind) || a.order - b.order);

  // ---- ballast under rails (and under trams only where they run on open ground)
  for (const l of lines) {
    if (l.kind === LINE.RAIL) paintBuffer(g, l.pts, l.n, 1.5, MAT.RAIL, 0, 0, null);
    else paintBuffer(g, l.pts, l.n, 1.2, MAT.RAIL, 0, 0, NOT_GRASSY);
  }

  // ---- footways, paths, cycleways, steps, pedestrian streets
  for (const f of foot) {
    const mat = f.kind === ROAD.PEDESTRIAN ? MAT.PLAZA
      : f.kind === ROAD.PATH || (f.flags & ROAD_UNPAVED) !== 0 ? MAT.DIRT : MAT.PAVING;
    paintBuffer(g, f.pts, f.n, f.half, mat, 0, 0, null);
  }

  // ---- raised sidewalk bands, then the carriageways over them
  for (const r of veh) {
    if ((r.flags & ROAD_SIDEWALK) === 0 || r.kind === ROAD.TRACK) continue;
    const band = r.kind === ROAD.PRIMARY || r.kind === ROAD.TRUNK || r.kind === ROAD.SECONDARY
      ? SIDEWALK_WIDTH_MAJOR : SIDEWALK_WIDTH;
    paintBuffer(g, r.pts, r.n, r.half + band, MAT.SIDEWALK, KERB_CM, 0, null);
  }
  for (let i = 0; i < veh.length; i++) {
    const r = veh[i]!;
    r.ownerId = (i % 65534) + 1;
    const mat = (r.flags & ROAD_UNPAVED) !== 0 || r.kind === ROAD.TRACK ? MAT.DIRT : MAT.ASPHALT;
    paintBuffer(g, r.pts, r.n, r.half, mat, 0, r.ownerId, null);
  }

  // ---- markings
  const junctions = findJunctions(veh);
  for (const r of veh) paintRoadMarkings(g, r, junctions);
  for (const t of tiles) {
    const ox = t.rx * REGION_M - gcx * CHUNK_SIZE_M;
    const oz = t.rz * REGION_M - gcz * CHUNK_SIZE_M;
    for (const p of t.points) {
      if (p.kind !== POINT.CROSSING) continue;
      const x = ox + p.x / 100, z = oz + p.z / 100;
      if (x < -ZEBRA_SEARCH - 6 || x > CHUNK_SIZE_M + ZEBRA_SEARCH + 6 || z < -ZEBRA_SEARCH - 6 || z > CHUNK_SIZE_M + ZEBRA_SEARCH + 6) continue;
      paintZebra(g, veh, x, z, p.dir);
    }
  }

  // ---- steel rails over whatever carries them
  stripe.half = RAIL_HALF;
  stripe.period = 0;
  stripe.mat = MAT.STEEL;
  stripe.need = null;
  stripe.owner = 0;
  stripe.zones = null;
  stripe.zoneCount = 0;
  for (const l of lines) {
    for (const side of [-1, 1]) {
      stripe.offset = side * (RAIL_GAUGE / 2);
      paintStripe(g, l.pts, l.n, l.cum, stripe);
    }
  }

  paintAo(g, patch);
  return g;
}

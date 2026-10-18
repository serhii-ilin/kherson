/**
 * Fine ground generator: rasterises a chunk's 0.2 m micro-voxel ground (material + height per cell)
 * from the coarse cells and the decoded vector tiles. Pure and deterministic; runs in a worker.
 *
 * Composition order: coarse base -> areas -> track ballast -> footways -> sidewalks (raised kerb)
 * -> carriageways -> lane/centre/edge markings -> zebra crossings -> bridge-deck markings (overlay)
 * -> rail/tram steel -> sandy banks -> AO. Water polygons (when the tiles have them) carve the shoreline
 * at 0.2 m: see paintWater.
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
import { BlockWindowData } from './block-input.ts';
import {
  bridgeGeometry, bridgeProfile, deckTopOfColumn, sharedBridgeEnds, type BridgeDeck, type PlacedRoad,
} from './bridges.ts';
import { PATCH_PLANE, PATCH_W, P_GH, P_MAT, P_SH } from './patch.ts';
import {
  CHUNK_SIZE_M,
  CM_PER_VOXEL,
  FINE_CELL,
  FINE_N,
  FINE_PER_COARSE,
  FineGrid,
  dashPeriod,
  fillMask,
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
  /**
   * Optional block-tier coarse window from buildBlockInput (ground height, material, bridge-deck top
   * over 160x160 cells). Needed for the lane markings on bridge decks: they must follow the exact deck
   * profile of the 1 m bridge blocks, which samples the coarse decks around the whole piece. Without it
   * bridge decks get no markings.
   */
  win?: Uint8Array;
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
const PER_M = 1 / FINE_CELL;

/**
 * Two-pass chamfer distance (Chebyshev, in cells) over a w x w window: cells holding 0 are sources, every
 * other cell holds the cap on entry and the distance to the nearest source (<= cap) on exit.
 */
function chamfer(d: Uint8Array, w: number): void {
  for (let z = 0; z < w; z++) {
    for (let x = 0; x < w; x++) {
      let v = d[z * w + x]!;
      if (v === 0) continue;
      if (x > 0) v = Math.min(v, d[z * w + x - 1]! + 1);
      if (z > 0) {
        v = Math.min(v, d[(z - 1) * w + x]! + 1);
        if (x > 0) v = Math.min(v, d[(z - 1) * w + x - 1]! + 1);
        if (x < w - 1) v = Math.min(v, d[(z - 1) * w + x + 1]! + 1);
      }
      d[z * w + x] = v;
    }
  }
  for (let z = w - 1; z >= 0; z--) {
    for (let x = w - 1; x >= 0; x--) {
      let v = d[z * w + x]!;
      if (v === 0) continue;
      if (x < w - 1) v = Math.min(v, d[z * w + x + 1]! + 1);
      if (z < w - 1) {
        v = Math.min(v, d[(z + 1) * w + x]! + 1);
        if (x > 0) v = Math.min(v, d[(z + 1) * w + x - 1]! + 1);
        if (x < w - 1) v = Math.min(v, d[(z + 1) * w + x + 1]! + 1);
      }
      d[z * w + x] = v;
    }
  }
}

/** Columns of 1 m around the chunk covered by the building raster (the AO reaches < 1 m). */
const BLD_PAD = 2;
const BLD_W = CHUNK_SIZE_M + 2 * BLD_PAD;
const bldCols = new Uint8Array(BLD_W * BLD_W);

/**
 * 1 m building columns around the chunk from the vector-tile footprints, by the rule the 1 m block tier
 * uses (src/fine/buildings.ts rasterMask): a column belongs to a building when its centre is inside
 * ring 0 and outside the holes (even-odd over all rings). Buildings snap to whole 1 m columns, so this
 * is where the real 1 m walls stand. Returns null when the tiles hold no building at all (caller falls back to the 2 m
 * coarse outline).
 */
function buildingColumns(tiles: readonly VectorTile[], gcx: number, gcz: number): Uint8Array | null {
  let total = 0;
  for (const t of tiles) total += t.buildings.length;
  if (total === 0) return null; // no tile data: keep the coarse outline
  bldCols.fill(0);
  const lo = -BLD_PAD, hi = CHUNK_SIZE_M + BLD_PAD;
  const xs: number[] = [];
  for (const t of tiles) {
    for (const b of t.buildings) {
      const r0 = b.rings[0];
      if (r0 === undefined || r0.length < 6) continue;
      const rings = b.rings.map((r) => localPoints(t, r, gcx, gcz));
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      const ring = rings[0]!;
      for (let i = 0; i < ring.length; i += 2) {
        const x = ring[i]!, z = ring[i + 1]!;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (z < z0) z0 = z;
        if (z > z1) z1 = z;
      }
      if (x1 - x0 > 420 || z1 - z0 > 420) continue; // data noise, skipped by the block tier too
      if (x1 < lo || x0 > hi || z1 < lo || z0 > hi) continue;
      const j0 = Math.max(lo, Math.floor(z0)), j1 = Math.min(hi - 1, Math.floor(z1));
      for (let j = j0; j <= j1; j++) {
        const zc = j + 0.5;
        xs.length = 0;
        for (const rg of rings) {
          const n = rg.length >> 1;
          for (let i = 0; i < n; i++) {
            const k = (i + 1) % n;
            const za = rg[i * 2 + 1]!, zb = rg[k * 2 + 1]!;
            if ((za <= zc && zc < zb) || (zb <= zc && zc < za)) {
              const xa = rg[i * 2]!;
              xs.push(xa + ((zc - za) * (rg[k * 2]! - xa)) / (zb - za));
            }
          }
        }
        if (xs.length < 2) continue;
        xs.sort((p, q) => p - q);
        for (let k = 0; k + 1 < xs.length; k += 2) {
          const a = Math.max(lo, Math.ceil(xs[k]! - 0.5));
          const e = Math.min(hi - 1, Math.ceil(xs[k + 1]! - 0.5) - 1);
          for (let gx = a; gx <= e; gx++) bldCols[(j + BLD_PAD) * BLD_W + gx + BLD_PAD] = 1;
        }
      }
    }
  }
  return bldCols;
}

/**
 * Contact shadow next to building walls and at the foot of kerbs; 4 levels (0 darkest). Walls come from the
 * 1 m building columns of the vector tiles (`bld`), else from the 2 m coarse structure outline.
 */
function paintAo(g: FineGrid, patch: Uint8Array, bld: Uint8Array | null): void {
  const cap = AO_PAD;
  for (let wz = 0; wz < AO_W; wz++) {
    for (let wx = 0; wx < AO_W; wx++) {
      let wall: boolean;
      if (bld !== null) {
        const col = Math.floor((wx - AO_PAD) / PER_M) + BLD_PAD;
        const row = Math.floor((wz - AO_PAD) / PER_M) + BLD_PAD;
        wall = bld[row * BLD_W + col] === 1;
      } else {
        const pz = Math.floor((wz - AO_PAD) / FINE_PER_COARSE) + 1;
        const px = Math.floor((wx - AO_PAD) / FINE_PER_COARSE) + 1;
        wall = patch[P_SH * PATCH_PLANE + pz * PATCH_W + px]! > 0;
      }
      aoDist[wz * AO_W + wx] = wall ? 0 : cap;
    }
  }
  chamfer(aoDist, AO_W);
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

// ---------------------------------------------------------------- water shoreline

/** Cells of margin around the chunk in the water window; 20 = two coarse cells (qualification reach). */
const WPAD = 20;
const WW = FINE_N + 2 * WPAD;
const waterPoly = new Uint8Array(WW * WW);
/** Coarse cells -2 .. 33 (index + 2) with polygon coverage counts. */
const CW = CHUNK + 4;
const polyCnt = new Uint16Array(CW * CW);
/** Water-ness for the bank distance over the chunk plus one coarse cell (10 fine cells). */
const bankDist = new Uint8Array(WW * WW);
const qualP = new Uint8Array(PATCH_W * PATCH_W);
const lvlP = new Uint16Array(PATCH_W * PATCH_W);
const BANK_REACH = 10;
/** Banks fade from full sand to the original ground over this many fine cells (1.6 m). */
const BANK_WIDTH = 8;
const BANK_FULL = 3;
/** Bank surface above the water in cm. */
const BANK_ABOVE_CM = 10;
const NB = [[1, 1], [1, 0], [0, 1], [-1, 1], [1, -1], [-1, 0], [0, -1], [-1, -1]] as const;

// shoreline classes of a fine cell
const C_LAND = 0;
const C_WATER = 1;
const C_CARVE = 2;
const C_NEWLAND = 3;

function bankHash(gx: number, gz: number): number {
  let h = Math.imul(gx, 73856093) ^ Math.imul(gz, 19349663);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) & 255;
}

/**
 * Water shoreline at 0.2 m from the WATER polygons of the vector tiles (all 3x3 tiles; polygons are
 * duplicated per region, painted here by union). Three effects, all functions of the coarse patch and
 * the polygons only, so neighbouring chunks agree on their border:
 *  - a coarse WATER cell whose fine cell lies outside every polygon becomes sandy land at the height of the
 *    nearest land neighbour (never below the water surface + 10 cm), covering the 2 m staircase;
 *  - a coarse land cell whose fine cell lies inside a polygon is lowered to the water surface + 10 cm and
 *    painted sand (only where a coarse water cell is within one coarse cell, so stray polygons cannot dig pits);
 *  - bank colouring: ground within BANK_WIDTH cells of the water turns sandy with a dithered fade, so the
 *    short side faces next to water are sand rather than brown soil.
 * A coarse water cell is carved only when a polygon touches its 3x3 coarse neighbourhood, so canals and
 * streams that exist only as buffered lines keep their coarse water. Without polygons nothing changes.
 * Returns whether polygons were present (then {@link paintBanks} must run after the roads).
 */
function paintWater(g: FineGrid, patch: Uint8Array, tiles: readonly VectorTile[], gcx: number, gcz: number): boolean {
  let any = false;
  waterPoly.fill(0);
  const margin = WPAD * FINE_CELL + 1;
  for (const t of tiles) {
    for (const a of t.areas) {
      if (a.mat !== MAT.WATER || a.rings.length === 0) continue;
      const rings = a.rings.map((r) => localPoints(t, r, gcx, gcz));
      if (!nearChunk(rings[0]!, margin)) continue;
      fillMask(waterPoly, WPAD, rings);
      any = true;
    }
  }
  if (!any) return false;

  polyCnt.fill(0);
  for (let wz = 0; wz < WW; wz++) {
    for (let wx = 0; wx < WW; wx++) {
      if (waterPoly[wz * WW + wx] === 0) continue;
      const cxc = Math.floor((wx - WPAD) / FINE_PER_COARSE) + 2;
      const czc = Math.floor((wz - WPAD) / FINE_PER_COARSE) + 2;
      polyCnt[czc * CW + cxc]!++;
    }
  }
  let touched = false;
  for (let i = 0; i < polyCnt.length; i++) if (polyCnt[i]! > 0) { touched = true; break; }
  if (!touched) return false;

  // per patch cell (pc = coarse + 1): polygon qualification and nearby water level in cm
  for (let pcz = 0; pcz < PATCH_W; pcz++) {
    for (let pcx = 0; pcx < PATCH_W; pcx++) {
      let q = 0;
      // coarse cell c = pc - 1 ; counts cover c in -2..33 (index c + 2 = pc + 1)
      for (let dz = -1; dz <= 1 && q === 0; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const ix = pcx + 1 + dx, iz = pcz + 1 + dz;
          if (ix < 0 || iz < 0 || ix >= CW || iz >= CW) continue;
          if (polyCnt[iz * CW + ix]! > 0) { q = 1; break; }
        }
      }
      let lv = 0;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const x = pcx + dx, z = pcz + dz;
          if (x < 0 || z < 0 || x >= PATCH_W || z >= PATCH_W) continue;
          const o = z * PATCH_W + x;
          if (patch[P_MAT * PATCH_PLANE + o] === MAT.WATER && patch[P_SH * PATCH_PLANE + o] === 0) {
            lv = Math.max(lv, patch[P_GH * PATCH_PLANE + o]! * CM_PER_VOXEL);
          }
        }
      }
      qualP[pcz * PATCH_W + pcx] = q;
      lvlP[pcz * PATCH_W + pcx] = lv;
    }
  }
  const levelCm = (pcx: number, pcz: number): number => lvlP[pcz * PATCH_W + pcx]!;
  const cls = (pcx: number, pcz: number, poly: number): number => {
    const o = pcz * PATCH_W + pcx;
    if (patch[P_SH * PATCH_PLANE + o]! > 0) return C_LAND;
    if (patch[P_MAT * PATCH_PLANE + o] === MAT.WATER) {
      return poly === 1 || qualP[o] === 0 ? C_WATER : C_NEWLAND;
    }
    return poly === 1 && lvlP[o]! > 0 ? C_CARVE : C_LAND;
  };

  // carve the chunk's own cells
  for (let cz = 0; cz < FINE_N; cz++) {
    const pcz = Math.floor(cz / FINE_PER_COARSE) + 1;
    for (let cx = 0; cx < FINE_N; cx++) {
      const pcx = Math.floor(cx / FINE_PER_COARSE) + 1;
      const c = cls(pcx, pcz, waterPoly[(cz + WPAD) * WW + cx + WPAD]!);
      if (c === C_LAND || c === C_WATER) continue;
      const i = cz * FINE_N + cx;
      const lvl = levelCm(pcx, pcz);
      if (c === C_CARVE) {
        if (g.mat[i] === 0) continue;
        const h = lvl + BANK_ABOVE_CM;
        if (h < g.hcm[i]!) g.hcm[i] = h;
        g.mat[i] = MAT.SAND;
        continue;
      }
      // coarse water that the polygon calls land: nearest land neighbour, towards the cell's side
      const sx = cx % FINE_PER_COARSE < FINE_PER_COARSE / 2 ? -1 : 1;
      const sz = cz % FINE_PER_COARSE < FINE_PER_COARSE / 2 ? -1 : 1;
      let found = false;
      for (let k = 0; k < 8 && !found; k++) {
        const nx = pcx + NB[k]![0] * sx, nz = pcz + NB[k]![1] * sz;
        if (nx < 0 || nz < 0 || nx >= PATCH_W || nz >= PATCH_W) continue;
        const o = nz * PATCH_W + nx;
        if (patch[P_MAT * PATCH_PLANE + o] === MAT.WATER || patch[P_SH * PATCH_PLANE + o]! > 0) continue;
        const h = Math.max(patch[P_GH * PATCH_PLANE + o]! * CM_PER_VOXEL, lvl + BANK_ABOVE_CM);
        g.mat[i] = MAT.SAND;
        g.hcm[i] = h;
        g.base[i] = h;
        found = true;
      }
    }
  }

  // water-ness over the chunk plus one coarse cell, for the bank distance
  bankDist.fill(BANK_WIDTH + 1);
  for (let wz = WPAD - BANK_REACH; wz < WPAD + FINE_N + BANK_REACH; wz++) {
    const cz = wz - WPAD;
    const pcz = Math.floor(cz / FINE_PER_COARSE) + 1;
    for (let wx = WPAD - BANK_REACH; wx < WPAD + FINE_N + BANK_REACH; wx++) {
      const cx = wx - WPAD;
      const pcx = Math.floor(cx / FINE_PER_COARSE) + 1;
      const c = cls(pcx, pcz, waterPoly[wz * WW + wx]!);
      let water = c === C_WATER || c === C_CARVE;
      if (c === C_NEWLAND) {
        water = !hasLandNeighbour(patch, pcx, pcz);
      }
      if (water) bankDist[wz * WW + wx] = 0;
    }
  }
  chamfer(bankDist, WW);
  return true;
}

function hasLandNeighbour(patch: Uint8Array, pcx: number, pcz: number): boolean {
  for (let k = 0; k < 8; k++) {
    const nx = pcx + NB[k]![0], nz = pcz + NB[k]![1];
    if (nx < 0 || nz < 0 || nx >= PATCH_W || nz >= PATCH_W) continue;
    const o = nz * PATCH_W + nx;
    if (patch[P_MAT * PATCH_PLANE + o] !== MAT.WATER && patch[P_SH * PATCH_PLANE + o] === 0) return true;
  }
  return false;
}

/** Sandy bank fade on soft ground next to the water (after the roads, so paved ground keeps its look). */
function paintBanks(g: FineGrid, gcx: number, gcz: number): void {
  for (let cz = 0; cz < FINE_N; cz++) {
    for (let cx = 0; cx < FINE_N; cx++) {
      const i = cz * FINE_N + cx;
      if (GRASSY[g.mat[i]!] !== 1) continue;
      const d = bankDist[(cz + WPAD) * WW + cx + WPAD]!;
      if (d === 0 || d > BANK_WIDTH) continue;
      // full sand to BANK_FULL cells, then a dithered fade (deterministic in global cell coordinates)
      const keep = d <= BANK_FULL ? 256 : Math.round(256 * (BANK_WIDTH + 1 - d) / (BANK_WIDTH + 1 - BANK_FULL));
      if (bankHash(gcx * FINE_N + cx, gcz * FINE_N + cz) < keep) g.mat[i] = MAT.SAND;
    }
  }
}

// ---------------------------------------------------------------- bridge deck markings

/**
 * Lane markings on 1 m bridge decks: the markings use the same line rules as ground roads, laid out on a
 * scratch carriageway raster, and each marked cell records the deck top of the 1 m bridge column below it
 * (deckTopOfColumn: the profile bridges.ts builds the deck from). The mesher lifts them 1.5 cm above it.
 */
function paintBridgeMarkings(g: FineGrid, input: FineInput, tiles: readonly VectorTile[]): void {
  const { gcx, gcz } = input;
  if (input.win === undefined) return;
  const all: PlacedRoad[] = [];
  for (const t of tiles) {
    for (const road of t.roads) if ((road.flags & ROAD_BRIDGE) !== 0) all.push({ road, ox: t.rx * REGION_M, oz: t.rz * REGION_M });
  }
  if (all.length === 0) return;
  const shared = sharedBridgeEnds(all);
  const wd = new BlockWindowData(input.win, gcx, gcz);
  const ctx = { groundAt: wd.groundAt, isWater: wd.isWater, deckTopAt: wd.deckTopAt };
  const x0 = gcx * CHUNK_SIZE_M, z0 = gcz * CHUNK_SIZE_M;
  const pieces: { lr: LRoad; deck: BridgeDeck }[] = [];
  for (const pr of all) {
    const r = pr.road;
    if (r.kind < ROAD.MOTORWAY || r.kind > ROAD.SERVICE || r.kind === ROAD.TRACK || r.kind === ROAD.SERVICE) continue;
    if ((r.flags & ROAD_UNPAVED) !== 0) continue;
    const deck = bridgeGeometry(pr);
    if (deck === null) continue;
    const [bx0, bz0, bx1, bz1] = deck.bbox;
    if (bx1 < x0 - 1 || bx0 > x0 + CHUNK_SIZE_M + 1 || bz1 < z0 - 1 || bz0 > z0 + CHUNK_SIZE_M + 1) continue;
    const t = tiles.find((tt) => tt.rx * REGION_M === pr.ox && tt.rz * REGION_M === pr.oz)!;
    const lr = toLRoad(localPoints(t, r.pts, gcx, gcz), r, pieces.length);
    lr.half = deck.halfCar;
    pieces.push({ lr, deck: bridgeProfile(deck, ctx, shared) });
  }
  if (pieces.length === 0) return;
  pieces.sort((a, b) => roadRank(a.lr.kind) - roadRank(b.lr.kind) || a.lr.order - b.lr.order);

  const dg = new FineGrid();
  dg.mat.fill(255);
  const lrs = pieces.map((p) => p.lr);
  for (let i = 0; i < lrs.length; i++) {
    const r = lrs[i]!;
    r.ownerId = i + 1;
    paintBuffer(dg, r.pts, r.n, r.half, MAT.ASPHALT, -1, r.ownerId, null);
  }
  const junctions = findJunctions(lrs);
  for (const r of lrs) paintRoadMarkings(dg, r, junctions);

  for (let cz = 0; cz < FINE_N; cz++) {
    for (let cx = 0; cx < FINE_N; cx++) {
      const i = cz * FINE_N + cx;
      if (dg.mat[i] !== MAT.MARKING) continue;
      const deck = pieces[dg.own[i]! - 1]!.deck;
      const H = deckTopOfColumn(deck, x0 + (cx + 0.5) * FINE_CELL, z0 + (cz + 0.5) * FINE_CELL);
      if (H < 0) continue;
      g.deckH ??= new Uint16Array(FINE_N * FINE_N);
      g.deckH[i] = H * 100;
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

  // ---- water shoreline from the WATER polygons (after the areas, which never touch empty cells)
  const banks = paintWater(g, patch, tiles, gcx, gcz);

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

  paintBridgeMarkings(g, input, tiles);

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

  if (banks) paintBanks(g, gcx, gcz);
  paintAo(g, patch, buildingColumns(tiles, gcx, gcz));
  return g;
}

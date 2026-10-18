import {
  CHUNK, F_GROUND_H, F_GROUND_MAT, F_ROOF_MAT, F_STRUCT_H, F_STRUCT_MAT, FIELDS, REGION, VOXEL,
} from '../world/constants.ts';
import { meshStructureChunk, type ChunkMesh } from '../world/mesher.ts';
import { ROAD, ROAD_BRIDGE, type VectorTile } from '../world/vector-format.ts';
import { rasterizeGround, type FineInput } from './ground.ts';
import { meshFineGround, type FineMesh } from './mesh.ts';
import { BlockWindowData, G_GH, G_MAT, G_PLANES, G_RMAT, G_SH, G_SMAT, GM, GPLANE, GW } from './block-input.ts';
import { addBridges, type PlacedRoad } from './bridges.ts';
import { addBuildings, canBlock, type PlacedBuilding } from './buildings.ts';
import { BLOCK_PAD, BLOCK_WIN, BlockWindow, columnPhysics, meshBlocks } from './blocks.ts';
import { VOL_XZ, Volume } from './volume.ts';
import { appendMesh, buildPropMesh, placeProps } from './props.ts';
import { packSigns, placeSigns } from './sign-place.ts';

/** Fine ground for one chunk: rasterise from coarse cells + vector tiles, then mesh. */
export function generateFineChunk(input: FineInput): FineMesh {
  return meshFineGround(rasterizeGround(input), input.patch);
}

/** Chunks around the job's chunk whose block-tier status the building assignment may read (radius). */
export const TIER_R = 4;
export const TIER_W = 2 * TIER_R + 1;

/**
 * Which chunks are in the block tier when a job is dispatched: TIER_W x TIER_W bytes (row-major, z then
 * x) centred on the job's chunk, 1 = in the tier. Chunks outside the window count as coarse.
 */
export function makeTierSnapshot(gcx: number, gcz: number, inTier: (gx: number, gz: number) => boolean): Uint8Array {
  const t = new Uint8Array(TIER_W * TIER_W);
  for (let dz = -TIER_R; dz <= TIER_R; dz++) {
    for (let dx = -TIER_R; dx <= TIER_R; dx++) {
      if (inTier(gcx + dx, gcz + dz)) t[(dz + TIER_R) * TIER_W + dx + TIER_R] = 1;
    }
  }
  return t;
}

export interface BlockInput {
  gcx: number;
  gcz: number;
  /**
   * Block-tier status of the chunks around this one (see {@link makeTierSnapshot}). A building is drawn
   * as 1 m blocks only when every chunk its footprint box overlaps is in the tier; omitted = every chunk
   * is (all buildings are blocks).
   */
  tier?: Uint8Array;
  /** Coarse window from {@link buildBlockInput}. */
  win: Uint8Array;
  /** Decoded tiles of the chunk's 3x3 region neighbourhood. */
  tiles: readonly VectorTile[];
}

export interface BlockMesh extends ChunkMesh {
  /** Physics raster: top in metres per 1 m column of the chunk (row-major 64x64), 0 = none. */
  tops: Uint8Array;
  /** Walkable tops (m) of floating bridge decks per block column, 0 = none (see blocks.ts columnPhysics). */
  decks: Uint8Array;
  /** Bottom (m) of solid 1 m bridge railings per block column, 0 = none. */
  rails: Uint8Array;
  /** Shop signs anchored in this chunk (see sign-place.ts packSigns; x/z chunk-local). */
  signs?: { data: Float32Array; names: string[] };
  /** Triangles contributed by props (already merged into the mesh). */
  propTris?: number;
  /**
   * Wall-run data (2 floats per vertex, see ChunkMesh.runs) of the 2 m coarse structures this mesh also
   * carries for buildings that stay coarse; absent when there are none.
   */
  runs?: Float32Array;
  /**
   * Chunks (flat [dx, dz, ...] relative to this one) whose tier status decided a building's assignment
   * here. When any of them changes status the chunk must be regenerated.
   */
  deps?: Int8Array;
}

const REGION_M = 512;
const CHUNK_M = CHUNK * VOXEL;
/** Buildings and roads within this many metres of the window are collected. */
const GATHER = 8;
const BRIDGE_GATHER = 24;

let scratch: BlockWindow | null = null;

/** Segment list of drivable roads near the window, for shop-front plausibility. */
function roadDistFn(roads: PlacedRoad[]): (x: number, z: number) => number {
  const segs: number[] = [];
  for (const { road, ox, oz } of roads) {
    if (road.kind < ROAD.MOTORWAY || road.kind > ROAD.SERVICE) continue;
    const n = road.pts.length >> 1;
    for (let i = 0; i + 1 < n; i++) {
      segs.push(
        ox + road.pts[i * 2]! / 100, oz + road.pts[i * 2 + 1]! / 100,
        ox + road.pts[i * 2 + 2]! / 100, oz + road.pts[i * 2 + 3]! / 100,
      );
    }
  }
  return (x, z) => {
    let best = Infinity;
    for (let i = 0; i < segs.length; i += 4) {
      const ax = segs[i]!, az = segs[i + 1]!;
      const ex = segs[i + 2]! - ax, ez = segs[i + 3]! - az;
      const l2 = ex * ex + ez * ez;
      let t = l2 > 0 ? ((x - ax) * ex + (z - az) * ez) / l2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d = Math.hypot(ax + ex * t - x, az + ez * t - z);
      if (d < best) best = d;
    }
    return best;
  };
}

/** Collects the buildings and bridge roads of `tiles` that can touch the window around chunk (gcx, gcz). */
export function gatherPieces(
  gcx: number, gcz: number, tiles: readonly VectorTile[],
): { buildings: PlacedBuilding[]; bridges: PlacedRoad[]; roads: PlacedRoad[]; allBridges: PlacedRoad[] } {
  const x0 = gcx * CHUNK_M - BLOCK_PAD, z0 = gcz * CHUNK_M - BLOCK_PAD;
  const x1 = x0 + BLOCK_WIN, z1 = z0 + BLOCK_WIN;
  const buildings: PlacedBuilding[] = [];
  const bridges: PlacedRoad[] = [];
  const roads: PlacedRoad[] = [];
  const allBridges: PlacedRoad[] = [];
  for (const t of tiles) {
    const ox = t.rx * REGION_M, oz = t.rz * REGION_M;
    for (const b of t.buildings) {
      const r = b.rings[0];
      if (r === undefined) continue;
      let mnx = Infinity, mxx = -Infinity, mnz = Infinity, mxz = -Infinity;
      for (let i = 0; i < r.length; i += 2) {
        const x = ox + r[i]! / 100, z = oz + r[i + 1]! / 100;
        if (x < mnx) mnx = x;
        if (x > mxx) mxx = x;
        if (z < mnz) mnz = z;
        if (z > mxz) mxz = z;
      }
      if (mxx < x0 - GATHER || mnx > x1 + GATHER || mxz < z0 - GATHER || mnz > z1 + GATHER) continue;
      buildings.push({ b, ox, oz });
    }
    for (const road of t.roads) {
      if ((road.flags & ROAD_BRIDGE) !== 0) allBridges.push({ road, ox, oz });
      const p = road.pts;
      let mnx = Infinity, mxx = -Infinity, mnz = Infinity, mxz = -Infinity;
      for (let i = 0; i < p.length; i += 2) {
        const x = ox + p[i]! / 100, z = oz + p[i + 1]! / 100;
        if (x < mnx) mnx = x;
        if (x > mxx) mxx = x;
        if (z < mnz) mnz = z;
        if (z > mxz) mxz = z;
      }
      const g = (road.flags & ROAD_BRIDGE) !== 0 ? BRIDGE_GATHER + road.widthCm / 200 : 20;
      if (mxx < x0 - g || mnx > x1 + g || mxz < z0 - g || mnz > z1 + g) continue;
      const pr = { road, ox, oz };
      roads.push(pr);
      if ((road.flags & ROAD_BRIDGE) !== 0) bridges.push(pr);
    }
  }
  return { buildings, bridges, roads, allBridges };
}

/**
 * Writes the chunk's buildings and bridges into `win` (cleared first). Buildings go straight into the
 * 66x66 window; bridges (rare) are generated into four 64x64 volumes shifted by +-1 block that
 * together cover the window, and copied over.
 */
export function fillBlockWindow(
  win: BlockWindow, input: BlockInput,
): { groundY: Uint8Array; block: PlacedBuilding[]; deps: number[] } {
  const wd = new BlockWindowData(input.win, input.gcx, input.gcz);
  const { buildings, bridges, roads, allBridges } = gatherPieces(input.gcx, input.gcz, input.tiles);
  const { block, deps } = assignTier(input, buildings);
  addBuildings(win, block, { groundAt: wd.groundAt, roadDist: roadDistFn(roads) }, win.foot, win.tint);
  if (bridges.length > 0) {
    const ctx = { groundAt: wd.groundAt, isWater: wd.isWater, deckTopAt: wd.deckTopAt };
    for (const dz of [0, 2]) {
      for (const dx of [0, 2]) {
        const vol = new Volume(win.x0 + dx, win.z0 + dz);
        addBridges(vol, bridges, ctx, allBridges);
        for (let y = 0; y < vol.mats.length / (VOL_XZ * VOL_XZ); y++) {
          for (let z = 0; z < VOL_XZ; z++) {
            const row = (y * VOL_XZ + z) * VOL_XZ;
            for (let x = 0; x < VOL_XZ; x++) {
              const m = vol.mats[row + x]!;
              if (m !== 0) win.mats[(y * BLOCK_WIN + z + dz) * BLOCK_WIN + x + dx] = m;
            }
          }
        }
      }
    }
  }
  const groundY = new Uint8Array(BLOCK_WIN * BLOCK_WIN);
  for (let z = 0; z < BLOCK_WIN; z++) {
    for (let x = 0; x < BLOCK_WIN; x++) {
      groundY[z * BLOCK_WIN + x] = Math.max(0, Math.floor(wd.groundAt(win.x0 + x + 0.5, win.z0 + z + 0.5) + 1e-6));
    }
  }
  return { groundY, block, deps };
}


// ---------------------------------------------------------------- tier assignment

/**
 * Tier assignment, one rule for every chunk (so chunks agree without talking to each other): a building
 * is drawn as 1 m blocks only if it can be (canBlock) and ALL the chunks its outer-ring bounding box
 * overlaps are in the block tier (`tier`); otherwise it stays a coarse 2 m building in every chunk. A block
 * chunk hides the chunk's coarse structures wholesale, so for the buildings that stay coarse it re-emits
 * their coarse cells itself (see coarseStructures): no building is drawn twice or missing, and the two
 * representations of one building never meet at a chunk border.
 */
function assignTier(
  input: BlockInput, buildings: readonly PlacedBuilding[],
): { block: PlacedBuilding[]; coarse: PlacedBuilding[]; deps: number[] } {
  const block: PlacedBuilding[] = [];
  const coarse: PlacedBuilding[] = [];
  const deps: number[] = [];
  const seen = new Set<number>();
  for (const pb of buildings) {
    if (!canBlock(pb)) { coarse.push(pb); continue; }
    if (input.tier === undefined) { block.push(pb); continue; }
    const r = pb.b.rings[0]!;
    let mnx = Infinity, mxx = -Infinity, mnz = Infinity, mxz = -Infinity;
    for (let i = 0; i < r.length; i += 2) {
      const x = pb.ox + r[i]! / 100, z = pb.oz + r[i + 1]! / 100;
      if (x < mnx) mnx = x;
      if (x > mxx) mxx = x;
      if (z < mnz) mnz = z;
      if (z > mxz) mxz = z;
    }
    const gx0 = Math.floor(mnx / CHUNK_M), gx1 = Math.floor(mxx / CHUNK_M);
    const gz0 = Math.floor(mnz / CHUNK_M), gz1 = Math.floor(mxz / CHUNK_M);
    let all = true;
    for (let gz = gz0; gz <= gz1; gz++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        const dx = gx - input.gcx, dz = gz - input.gcz;
        const inWin = Math.abs(dx) <= TIER_R && Math.abs(dz) <= TIER_R;
        const on = inWin && input.tier[(dz + TIER_R) * TIER_W + dx + TIER_R] === 1;
        if (!on) all = false;
        if (inWin && (dx !== 0 || dz !== 0)) {
          const k = (dz + TIER_R) * TIER_W + dx + TIER_R;
          if (!seen.has(k)) { seen.add(k); deps.push(dx, dz); }
        }
      }
    }
    (all ? block : coarse).push(pb);
  }
  return { block, coarse, deps };
}

function inRings(rings: readonly Float64Array[], x: number, z: number): boolean {
  let inside = false;
  for (const ring of rings) {
    const n = ring.length >> 1;
    for (let i = 0, k = n - 1; i < n; k = i++) {
      const zi = ring[i * 2 + 1]!, zk = ring[k * 2 + 1]!;
      if ((zi > z) !== (zk > z)) {
        const xi = ring[i * 2]!, xk = ring[k * 2]!;
        if (x < xi + ((z - zi) * (xk - xi)) / (zk - zi)) inside = !inside;
      }
    }
  }
  return inside;
}

/** Window of coarse cells around a chunk: the chunk plus one cell of margin. */
const CW = CHUNK + 2;

/**
 * Marks (1) the coarse cells of the chunk window (chunk plus one cell margin, CW x CW) that belong to the
 * given block buildings: cells whose centre is inside a footprint, as the coarse bake rasterises it; a
 * footprint smaller than a cell claims the cell holding its centroid (the bake's fallback).
 */
function claimCells(block: readonly PlacedBuilding[], gcx: number, gcz: number): Uint8Array {
  const claim = new Uint8Array(CW * CW);
  const cx0 = gcx * CHUNK - 1, cz0 = gcz * CHUNK - 1;
  for (const pb of block) {
    const rings: Float64Array[] = pb.b.rings.map((src) => {
      const o = new Float64Array(src.length);
      for (let i = 0; i < src.length; i += 2) { o[i] = pb.ox + src[i]! / 100; o[i + 1] = pb.oz + src[i + 1]! / 100; }
      return o;
    });
    const r0 = rings[0]!;
    let mnx = Infinity, mxx = -Infinity, mnz = Infinity, mxz = -Infinity, sx = 0, sz = 0;
    for (let i = 0; i < r0.length; i += 2) {
      const x = r0[i]!, z = r0[i + 1]!;
      if (x < mnx) mnx = x;
      if (x > mxx) mxx = x;
      if (z < mnz) mnz = z;
      if (z > mxz) mxz = z;
      sx += x; sz += z;
    }
    const ax = Math.max(cx0, Math.floor(mnx / VOXEL)), bx = Math.min(cx0 + CW - 1, Math.floor(mxx / VOXEL));
    const az = Math.max(cz0, Math.floor(mnz / VOXEL)), bz = Math.min(cz0 + CW - 1, Math.floor(mxz / VOXEL));
    for (let cz = az; cz <= bz; cz++) {
      for (let cx = ax; cx <= bx; cx++) {
        if (inRings(rings, (cx + 0.5) * VOXEL, (cz + 0.5) * VOXEL)) claim[(cz - cz0) * CW + cx - cx0] = 1;
      }
    }
    if (mxx - mnx < 2 * VOXEL && mxz - mnz < 2 * VOXEL) {
      const n = r0.length / 2;
      const cx = Math.floor(sx / n / VOXEL), cz = Math.floor(sz / n / VOXEL);
      if (cx >= cx0 && cx < cx0 + CW && cz >= cz0 && cz < cz0 + CW) claim[(cz - cz0) * CW + cx - cx0] = 1;
    }
  }
  return claim;
}

let scratchCells: Uint8Array | null = null;

/**
 * The coarse 2 m roofs and walls of the structure cells that no block building claims, meshed as the
 * coarse tier would, plus raising `tops` (physics) over them. Returns null when there are none or the
 * window carries no structure planes.
 */
function coarseStructures(
  win: Uint8Array, gcx: number, gcz: number, claim: Uint8Array, tops: Uint8Array,
): (ChunkMesh & { runs: Float32Array }) | null {
  if (win.length < G_PLANES * GPLANE) return null;
  if (scratchCells === null) scratchCells = new Uint8Array(FIELDS * REGION * REGION);
  const cells = scratchCells;
  const RP = REGION * REGION;
  let any = false;
  for (let j = -1; j <= CHUNK; j++) {
    for (let i = -1; i <= CHUNK; i++) {
      const w = (GM + j) * GW + GM + i;
      const o = (CHUNK + j) * REGION + CHUNK + i;
      const claimed = claim[(j + 1) * CW + i + 1] === 1;
      const sh = claimed ? 0 : win[G_SH * GPLANE + w]!;
      cells[RP * F_GROUND_H + o] = win[G_GH * GPLANE + w]!;
      cells[RP * F_GROUND_MAT + o] = win[G_MAT * GPLANE + w]!;
      cells[RP * F_STRUCT_H + o] = sh;
      cells[RP * F_STRUCT_MAT + o] = sh > 0 ? win[G_SMAT * GPLANE + w]! : 0;
      cells[RP * F_ROOF_MAT + o] = sh > 0 ? win[G_RMAT * GPLANE + w]! : 0;
      if (sh > 0 && i >= 0 && j >= 0 && i < CHUNK && j < CHUNK) {
        any = true;
        const top = Math.min(255, (win[G_GH * GPLANE + w]! + sh) * VOXEL);
        for (let k = 0; k < 4; k++) {
          const t = (j * VOXEL + (k >> 1)) * CHUNK_M + i * VOXEL + (k & 1);
          if (tops[t]! < top) tops[t] = top;
        }
      }
    }
  }
  return any ? meshStructureChunk(cells, CHUNK, CHUNK) : null;
}

function concatF(a: Float32Array, b: Float32Array): Float32Array {
  const o = new Float32Array(a.length + b.length);
  o.set(a);
  o.set(b, a.length);
  return o;
}

/** Appends the coarse structure mesh to the block mesh; runs are zero for the block part. */
function withCoarse(base: ChunkMesh, extra: ChunkMesh & { runs: Float32Array }): ChunkMesh & { runs: Float32Array } {
  const nv = base.positions.length / 3;
  const indices = new Uint32Array(base.indices.length + extra.indices.length);
  indices.set(base.indices);
  for (let i = 0; i < extra.indices.length; i++) indices[base.indices.length + i] = extra.indices[i]! + nv;
  return {
    positions: concatF(base.positions, extra.positions),
    normals: concatF(base.normals, extra.normals),
    colors: concatF(base.colors, extra.colors),
    walls: concatF(base.walls, extra.walls),
    runs: concatF(new Float32Array(nv * 2), extra.runs),
    indices,
  };
}

/** 1 m building and bridge blocks for one chunk: generate into a 66x66 window, mesh the inner 64x64. */
export function generateBlockChunk(input: BlockInput): BlockMesh {
  const x0 = input.gcx * CHUNK_M, z0 = input.gcz * CHUNK_M;
  if (scratch === null) scratch = new BlockWindow(x0, z0);
  else scratch.clear(x0, z0);
  const win = scratch;
  const { groundY, block, deps } = fillBlockWindow(win, input);
  let mesh: ChunkMesh = meshBlocks(win.mats, BLOCK_WIN, BLOCK_PAD, groundY, win.tint);
  const { tops, decks, rails } = columnPhysics(win.mats, BLOCK_WIN, BLOCK_PAD, win.foot, groundY);
  // the chunk hides ALL coarse structures, so buildings that stay coarse are re-emitted as coarse cells
  const claim = claimCells(block, input.gcx, input.gcz);
  const coarseMesh = coarseStructures(input.win, input.gcx, input.gcz, claim, tops);
  let runs: Float32Array | undefined;
  if (coarseMesh !== null) {
    const m = withCoarse(mesh, coarseMesh);
    runs = m.runs;
    mesh = m;
  }
  // street props and shop signs: placed from world data only, emitted by the chunk holding their anchor
  const wd = new BlockWindowData(input.win, input.gcx, input.gcz);
  const bounds = { x0, z0, x1: x0 + CHUNK_M, z1: z0 + CHUNK_M };
  const placements = placeProps(input.tiles, bounds, wd);
  const props = buildPropMesh(placements, x0, z0);
  mesh = appendMesh(mesh, props);
  if (runs !== undefined) runs = concatF(runs, new Float32Array((props.positions.length / 3) * 2));
  const signs = packSigns(placeSigns(input.tiles, bounds, wd.groundAt), x0, z0);
  return { ...mesh, ...(runs !== undefined ? { runs } : {}), deps: Int8Array.from(deps), tops, decks, rails, signs, propTris: props.indices.length / 3 };
}

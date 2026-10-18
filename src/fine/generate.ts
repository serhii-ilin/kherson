import { CHUNK, VOXEL } from '../world/constants.ts';
import type { ChunkMesh } from '../world/mesher.ts';
import { ROAD, ROAD_BRIDGE, type VectorTile } from '../world/vector-format.ts';
import { rasterizeGround, type FineInput } from './ground.ts';
import { meshFineGround, type FineMesh } from './mesh.ts';
import { BlockWindowData } from './block-input.ts';
import { addBridges, type PlacedRoad } from './bridges.ts';
import { addBuildings, type PlacedBuilding } from './buildings.ts';
import { BLOCK_PAD, BLOCK_WIN, BlockWindow, columnTops, meshBlocks } from './blocks.ts';
import { VOL_XZ, Volume } from './volume.ts';
import { appendMesh, buildPropMesh, placeProps } from './props.ts';
import { packSigns, placeSigns } from './sign-place.ts';

/** Fine ground for one chunk: rasterise from coarse cells + vector tiles, then mesh. */
export function generateFineChunk(input: FineInput): FineMesh {
  return meshFineGround(rasterizeGround(input), input.patch);
}

export interface BlockInput {
  gcx: number;
  gcz: number;
  /** Coarse window from {@link buildBlockInput}. */
  win: Uint8Array;
  /** Decoded tiles of the chunk's 3x3 region neighbourhood. */
  tiles: readonly VectorTile[];
}

export interface BlockMesh extends ChunkMesh {
  /** Physics raster: top in metres per 1 m column of the chunk (row-major 64x64), 0 = none. */
  tops: Uint8Array;
  /** Shop signs anchored in this chunk (see sign-place.ts packSigns; x/z chunk-local). */
  signs?: { data: Float32Array; names: string[] };
  /** Triangles contributed by props (already merged into the mesh). */
  propTris?: number;
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
): { buildings: PlacedBuilding[]; bridges: PlacedRoad[]; roads: PlacedRoad[] } {
  const x0 = gcx * CHUNK_M - BLOCK_PAD, z0 = gcz * CHUNK_M - BLOCK_PAD;
  const x1 = x0 + BLOCK_WIN, z1 = z0 + BLOCK_WIN;
  const buildings: PlacedBuilding[] = [];
  const bridges: PlacedRoad[] = [];
  const roads: PlacedRoad[] = [];
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
  return { buildings, bridges, roads };
}

/**
 * Writes the chunk's buildings and bridges into `win` (cleared first). Buildings go straight into the
 * 66x66 window; bridges (rare) are generated into four 64x64 volumes shifted by +-1 block that
 * together cover the window, and copied over.
 */
export function fillBlockWindow(win: BlockWindow, input: BlockInput): Uint8Array {
  const wd = new BlockWindowData(input.win, input.gcx, input.gcz);
  const { buildings, bridges, roads } = gatherPieces(input.gcx, input.gcz, input.tiles);
  addBuildings(win, buildings, { groundAt: wd.groundAt, roadDist: roadDistFn(roads) }, win.foot);
  if (bridges.length > 0) {
    const ctx = { groundAt: wd.groundAt, isWater: wd.isWater, deckTopAt: wd.deckTopAt };
    for (const dz of [0, 2]) {
      for (const dx of [0, 2]) {
        const vol = new Volume(win.x0 + dx, win.z0 + dz);
        addBridges(vol, bridges, ctx);
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
  return groundY;
}

/** 1 m building and bridge blocks for one chunk: generate into a 66x66 window, mesh the inner 64x64. */
export function generateBlockChunk(input: BlockInput): BlockMesh {
  const x0 = input.gcx * CHUNK_M, z0 = input.gcz * CHUNK_M;
  if (scratch === null) scratch = new BlockWindow(x0, z0);
  else scratch.clear(x0, z0);
  const win = scratch;
  const groundY = fillBlockWindow(win, input);
  let mesh = meshBlocks(win.mats, BLOCK_WIN, BLOCK_PAD, groundY);
  const tops = columnTops(win.mats, BLOCK_WIN, BLOCK_PAD, win.foot, groundY);
  // street props and shop signs: placed from world data only, emitted by the chunk holding their anchor
  const wd = new BlockWindowData(input.win, input.gcx, input.gcz);
  const bounds = { x0, z0, x1: x0 + CHUNK_M, z1: z0 + CHUNK_M };
  const placements = placeProps(input.tiles, bounds, wd);
  const props = buildPropMesh(placements, x0, z0);
  mesh = appendMesh(mesh, props);
  const signs = packSigns(placeSigns(input.tiles, bounds, wd.groundAt), x0, z0);
  return { ...mesh, tops, signs, propTris: props.indices.length / 3 };
}

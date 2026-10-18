import { describe, expect, it } from 'vitest';
import { CHUNK } from '../src/world/constants';
import { MAT } from '../src/world/materials';
import { ROAD, ROAD_BRIDGE, ROOF, type VBuilding, type VRoad } from '../src/world/vector-format';
import { rasterizeGround } from '../src/fine/ground';
import { generateFineChunk } from '../src/fine/generate';
import { GPLANE, GW, GM, G_DECK, G_GH, G_MAT, BlockWindowData } from '../src/fine/block-input';
import { addBridges, deckTopOfColumn, bridgeGeometry, bridgeProfile, sharedBridgeEnds, type BridgeContext, type PlacedRoad } from '../src/fine/bridges';
import { Volume } from '../src/fine/volume';
import { PATCH_PLANE, PATCH_W, P_GH, P_MAT } from '../src/fine/patch';
import { FINE_CELL, FINE_N, GCX, GCZ, ORIGIN, area, emptyTile, flatPatch, hAt, matAt, raster, road, setCoarse } from './fine-util';

/** Building from a chunk-local ring (metres), in the tile of region (0, 0). */
function building(ring: ReadonlyArray<readonly [number, number]>): VBuilding {
  const r = new Int32Array(ring.length * 2);
  ring.forEach(([x, z], i) => { r[i * 2] = Math.round((x + ORIGIN) * 100); r[i * 2 + 1] = Math.round((z + ORIGIN) * 100); });
  return { id: 7, rings: [r], heightCm: 1600, minHeightCm: 0, levels: 5, wall: MAT.WALL_KHRUSH, roof: MAT.ROOF_GREY, roofShape: ROOF.FLAT, name: -1 };
}
const aoAt = (g: ReturnType<typeof raster>, x: number, z: number): number => g.ao[Math.floor(z / FINE_CELL) * FINE_N + Math.floor(x / FINE_CELL)]!;

describe('#5 contact AO from the 1 m building footprint', () => {
  // coarse outline: cell (16, 16) = local 32..34 m is a building; the real footprint column is x,z in 33..34
  const patch = (): Uint8Array => {
    const p = flatPatch();
    setCoarse(p, 16, 16, MAT.WALL_HOUSE, 2, 4);
    return p;
  };

  it('does not darken a halo off a wall that stands 1 m inside the coarse outline', () => {
    const tile = emptyTile();
    tile.buildings.push(building([[33.1, 33.1], [33.9, 33.1], [33.9, 33.9], [33.1, 33.9]]));
    const g = raster(patch(), tile);
    // coarse-outline AO would give level 1 here (next to the outline); the wall is 2.1 m away
    expect(aoAt(g, 31.9, 33.5)).toBe(3);
    expect(aoAt(g, 34.1, 33.5)).toBe(1); // east of the 1 m column [33, 34): this is outside the coarse cell
  });

  it('still darkens next to a wall that fills the coarse outline', () => {
    const tile = emptyTile();
    tile.buildings.push(building([[32.2, 32.2], [33.8, 32.2], [33.8, 33.8], [32.2, 33.8]]));
    const g = raster(patch(), tile);
    // columns 32 and 33 are walls (centres 32.5, 33.5 inside)
    expect(aoAt(g, 31.9, 33.5)).toBe(1);
    expect(aoAt(g, 20, 33.5)).toBe(3);
  });

  it('honours holes and falls back to the coarse outline without footprints', () => {
    const tile = emptyTile();
    const g = raster(patch(), tile);
    expect(aoAt(g, 31.9, 33.5)).toBe(1);
  });
});

// ---------------------------------------------------------------- water

/** Coarse world: land at 4 m (gh 2) with water (level gh 1) from coarse cell `wx0` to the east. */
function riverPatch(wx0: number): Uint8Array {
  const p = flatPatch();
  for (let z = 0; z < PATCH_W; z++) {
    for (let x = wx0 + 1; x < PATCH_W; x++) { // patch x = coarse + 1 {
      p[P_MAT * PATCH_PLANE + z * PATCH_W + x] = MAT.WATER;
      p[P_GH * PATCH_PLANE + z * PATCH_W + x] = 1;
    }
  }
  return p;
}
/** A water polygon covering local x in [x0, x1] (whole chunk height, with margin). */
function lake(x0: number, x1: number) {
  return area([[[x0, -20], [x1, -20], [x1, 90], [x0, 90]]], MAT.WATER, 0);
}

describe('#7 water shoreline from polygons', () => {
  // water coarse cells start at coarse x = 16 (local 32 m)
  it('is unchanged without water polygons', () => {
    const g = raster(riverPatch(16), emptyTile());
    expect(matAt(g, 33, 20)).toBe(0);
    expect(matAt(g, 20, 20)).toBe(MAT.GRASS);
    expect(hAt(g, 20, 20)).toBe(400);
  });

  it('paints land where the polygon says land over a coarse water cell, at the neighbouring land height', () => {
    const tile = emptyTile();
    tile.areas.push(lake(33.3, 90)); // shore at 33.3 m, coarse cell edge at 32
    const g = raster(riverPatch(16), tile);
    expect(matAt(g, 32.5, 20)).toBe(MAT.SAND);
    expect(hAt(g, 32.5, 20)).toBe(400);
    expect(matAt(g, 33.1, 20)).toBe(MAT.SAND);
    expect(matAt(g, 33.5, 20)).toBe(0); // in the polygon: still water
    // the sand edge is where the polygon is, to 0.2 m
    let edge = -1;
    for (let cx = Math.floor(32 / FINE_CELL); cx < FINE_N; cx++) {
      if (g.mat[Math.floor(20 / FINE_CELL) * FINE_N + cx] === 0) { edge = cx * FINE_CELL; break; }
    }
    expect(Math.abs(edge - 33.3)).toBeLessThanOrEqual(0.2);
  });

  it('lowers coarse land inside a polygon to just above the water and gives short sandy faces', () => {
    const tile = emptyTile();
    tile.areas.push(lake(29.3, 90));
    const g = raster(riverPatch(16), tile);
    expect(matAt(g, 31, 20)).toBe(MAT.SAND);
    expect(hAt(g, 31, 20)).toBe(210); // water level gh 1 = 200 cm, +10 cm
    expect(hAt(g, 28.5, 20)).toBe(400); // land west of the shore keeps its height
    // the bank face next to the water is sand, not soil: the cells along the shore are sand all the way
    for (const x of [29.9, 30.5, 31.9]) expect(matAt(g, x, 20)).toBe(MAT.SAND);
  });

  it('fades sand into the ground next to the water (deterministic dither)', () => {
    const tile = emptyTile();
    tile.areas.push(lake(29.3, 90));
    const a = raster(riverPatch(16), tile), b = raster(riverPatch(16), tile);
    expect(Buffer.from(a.mat).equals(Buffer.from(b.mat))).toBe(true);
    const row = Math.floor(20 / FINE_CELL);
    const kind = (x: number): number => a.mat[row * FINE_N + Math.floor(x / FINE_CELL)]!;
    expect(kind(28.9)).toBe(MAT.SAND); // < 0.6 m from the water
    expect(kind(20)).toBe(MAT.GRASS); // far inland
    let sandMid = 0, n = 0;
    for (let cz = 0; cz < FINE_N; cz++) {
      for (let x = 28.6; x < 29.2; x += FINE_CELL) {
        n++;
        if (a.mat[cz * FINE_N + Math.floor(x / FINE_CELL)] === MAT.SAND) sandMid++;
      }
    }
    expect(sandMid).toBeGreaterThan(n * 0.2);
    expect(sandMid).toBeLessThan(n * 0.95);
  });

  it('does not carve line-only water (no polygon near it)', () => {
    const tile = emptyTile();
    tile.areas.push(lake(0, 3)); // a pond far from the coarse river cells
    const g = raster(riverPatch(16), tile);
    expect(matAt(g, 33, 20)).toBe(0);
  });

  it('keeps chunk borders consistent: a shore along the border looks the same from both sides', () => {
    // Shore at world x = 320.3 (just east of the chunk border 320): the chunk (5, 4) to the east starts at 320.
    const worldPatch = (gcx: number): Uint8Array => {
      const p = flatPatch();
      for (let z = 0; z < PATCH_W; z++) {
        for (let x = 0; x < PATCH_W; x++) {
          const wcx = gcx * CHUNK - 1 + x; // global coarse cell
          if (wcx >= 160) { // x >= 320 m
            p[P_MAT * PATCH_PLANE + z * PATCH_W + x] = MAT.WATER;
            p[P_GH * PATCH_PLANE + z * PATCH_W + x] = 1;
          }
        }
      }
      return p;
    };
    const tile = emptyTile();
    tile.areas.push(area([[[320.3 - ORIGIN, -300], [900, -300], [900, 900], [320.3 - ORIGIN, 900]]], MAT.WATER, 0));
    const west = rasterizeGround({ gcx: 4, gcz: 4, patch: worldPatch(4), tiles: [tile] });
    const east = rasterizeGround({ gcx: 5, gcz: 4, patch: worldPatch(5), tiles: [tile] });
    // west chunk's last columns (x 63.x) and east chunk's first columns (x 0.x) are both sand at 400 cm
    for (const z of [3, 20, 50]) {
      expect(matAt(west, 63.9, z)).toBe(MAT.SAND);
      expect(hAt(west, 63.9, z)).toBe(400);
      expect(matAt(east, 0.1, z)).toBe(MAT.SAND);
      expect(hAt(east, 0.1, z)).toBe(400);
      expect(matAt(east, 1.0, z)).toBe(0);
    }
  });
});

// ---------------------------------------------------------------- bridges

function mk(pts: ReadonlyArray<readonly [number, number]>, widthM: number): PlacedRoad {
  const a = new Int32Array(pts.length * 2);
  pts.forEach(([x, z], i) => { a[i * 2] = Math.round(x * 100); a[i * 2 + 1] = Math.round(z * 100); });
  const r: VRoad = { pts: a, kind: ROAD.PRIMARY, flags: ROAD_BRIDGE, widthCm: widthM * 100, lanes: 2, layer: 1, name: 5 };
  return { road: r, ox: 0, oz: 0 };
}

/** Land at 4 m; water for world z in [280, 300) with a coarse deck (top 8 m) over it. */
const crossing: BridgeContext = {
  groundAt: (_x, z) => (z >= 280 && z < 300 ? 2 : 4),
  isWater: (_x, z) => z >= 280 && z < 300,
  deckTopAt: (_x, z) => (z >= 280 && z < 300 ? 8 : null),
};

function column(v: Volume, wx: number, wz: number): number {
  let top = 0;
  for (let y = 0; y < 40; y++) if (v.get(Math.floor(wx) - v.x0, y, Math.floor(wz) - v.z0) === MAT.ASPHALT) top = y + 1;
  return top;
}

describe('#9 deck profile across bridge pieces', () => {
  // x = 288.5; A: z 240..304 (land -> water -> land), B: 304..368, C: 368..432 (land)
  const A = mk([[288.5, 240], [288.5, 304]], 8);
  const B = mk([[288.5, 304], [288.5, 368]], 8);
  const C = mk([[288.5, 368], [288.5, 432]], 8);
  const all = [A, B, C];

  it('detects shared ends by exact coordinate match', () => {
    const s = sharedBridgeEnds(all);
    expect(s.size).toBe(2); // the two joints; the true ends are not shared
    expect(sharedBridgeEnds([A]).size).toBe(0);
    expect(sharedBridgeEnds([A, A]).size).toBe(0); // a piece duplicated in two tiles is one piece
  });

  it('keeps the deck height across the joint instead of ramping each piece to the ground', () => {
    const v = new Volume(256, 256);
    addBridges(v, all, crossing);
    // water 280..300 at 8 m; the joint at 304 is 4 m past the water: still at deck height on both sides
    expect(column(v, 288.5, 290)).toBe(8);
    expect(column(v, 288.5, 303)).toBe(8);
    expect(column(v, 288.5, 305)).toBe(8);
    // then B descends monotonically to the ground (4) at the next joint, C stays on the ground
    let prev = 99;
    const v2 = new Volume(256, 320);
    addBridges(v2, all, crossing);
    for (let z = 321; z < 366; z += 5) {
      const h = column(v2, 288.5, z);
      expect(h).toBeLessThanOrEqual(prev);
      prev = h;
    }
    expect(column(v2, 288.5, 366)).toBe(4);
    expect(column(v2, 288.5, 380)).toBe(4);
    // a single piece (no neighbours known) ramps to the ground at its end
    const lone = new Volume(256, 256);
    addBridges(lone, [A], crossing);
    expect(column(lone, 288.5, 303.5)).toBeLessThanOrEqual(5); // sagged to the ground (the old behaviour)
  });

  it('is chunk independent: the same blocks whichever pieces were gathered', () => {
    const a = new Volume(256, 256);
    addBridges(a, all, crossing);
    const b = new Volume(256, 256);
    addBridges(b, [A], crossing, all); // only A gathered near this chunk, B and C known from the tiles
    for (let z = 0; z < 64; z++) {
      for (let y = 0; y < 14; y++) for (const x of [32, 30, 35]) {
        if (z + 256 < 304) expect(b.get(x, y, z)).toBe(a.get(x, y, z));
      }
    }
  });
});

/** Block-tier coarse window for chunk (GCX, GCZ) matching `crossing`. */
function crossingWindow(): Uint8Array {
  const win = new Uint8Array(3 * GPLANE);
  win.fill(2, G_GH * GPLANE, (G_GH + 1) * GPLANE);
  win.fill(MAT.GRASS, G_MAT * GPLANE, (G_MAT + 1) * GPLANE);
  const cz0 = GCZ * CHUNK - GM;
  for (let pz = 0; pz < GW; pz++) {
    const wz = (cz0 + pz) * 2;
    if (wz >= 280 && wz < 300) {
      for (let px = 0; px < GW; px++) {
        win[G_GH * GPLANE + pz * GW + px] = 1;
        win[G_MAT * GPLANE + pz * GW + px] = MAT.WATER;
        win[G_DECK * GPLANE + pz * GW + px] = 4; // deck top (4 + 1) * 2 = 10 m? see below
      }
    }
  }
  return win;
}

describe('#8 lane markings on bridge decks', () => {
  const bridgeRoad = (): ReturnType<typeof road> => ({
    ...road([[32.55, -12], [32.55, 60]], 8, { kind: ROAD.PRIMARY, lanes: 2, flags: ROAD_BRIDGE, layer: 1, name: 5 }),
  });

  it('puts dashed centre and solid edge markings on the deck top, 1.5 cm above it', () => {
    const win = crossingWindow();
    const tile = emptyTile();
    tile.roads.push(bridgeRoad());
    const input = { gcx: GCX, gcz: GCZ, patch: flatPatch(), tiles: [tile], win };
    const g = rasterizeGround(input);
    expect(g.deckH).not.toBeNull();
    // the same blocks the 1 m tier builds
    const wd = new BlockWindowData(win, GCX, GCZ);
    const ctx = { groundAt: wd.groundAt, isWater: wd.isWater, deckTopAt: wd.deckTopAt };
    const vol = new Volume(256, 256);
    const placed: PlacedRoad = { road: tile.roads[0]!, ox: 0, oz: 0 };
    addBridges(vol, [placed], ctx);
    let marked = 0;
    const heights = new Set<number>();
    for (let cz = 0; cz < FINE_N; cz++) {
      for (let cx = 0; cx < FINE_N; cx++) {
        const h = g.deckH![cz * FINE_N + cx]!;
        if (h === 0) continue;
        marked++;
        heights.add(h);
        const bx = Math.floor(cx * FINE_CELL), bz = Math.floor(cz * FINE_CELL);
        const top = h / 100;
        expect(vol.get(bx, top - 1, bz)).not.toBe(0); // the deck surface block is right below
        expect(vol.get(bx, top, bz)).not.toBe(MAT.ASPHALT);
        // and the geometry helper used by both agrees
        const geo = bridgeProfile(bridgeGeometry(placed)!, ctx, sharedBridgeEnds([placed]));
        expect(deckTopOfColumn(geo, 256 + (cx + 0.5) * FINE_CELL, 256 + (cz + 0.5) * FINE_CELL) * 100).toBe(h);
      }
    }
    expect(marked).toBeGreaterThan(200);
    expect(heights.size).toBeGreaterThan(1); // follows the ramp, not one flat level
    // centre line at x = 32.5 is on the deck; marked cells exist near the centre and near the edges
    const colMarked = (x: number): number => {
      let n = 0;
      for (let cz = 0; cz < FINE_N; cz++) if (g.deckH![cz * FINE_N + Math.floor(x / FINE_CELL)]! > 0) n++;
      return n;
    };
    expect(colMarked(32.55)).toBeGreaterThan(20);
    expect(colMarked(28.85)).toBeGreaterThan(100); // solid edge line (half 4 - 0.3)
    expect(colMarked(25)).toBe(0);
    // the mesh carries them: quads at deck top + 1.5 cm
    const m = generateFineChunk(input);
    let lifted = 0;
    for (let i = 1; i < m.positions.length; i += 3) {
      const y = m.positions[i]!;
      if (heights.has(Math.round((y - 0.015) * 100))) lifted++;
    }
    expect(lifted).toBeGreaterThan(0);
  });

  it('paints nothing on bridges without the block window or for a footbridge', () => {
    const tile = emptyTile();
    tile.roads.push(bridgeRoad());
    expect(rasterizeGround({ gcx: GCX, gcz: GCZ, patch: flatPatch(), tiles: [tile] }).deckH).toBeNull();
    const foot = emptyTile();
    foot.roads.push(road([[32.5, -12], [32.5, 60]], 3, { kind: ROAD.FOOTWAY, flags: ROAD_BRIDGE }));
    expect(rasterizeGround({ gcx: GCX, gcz: GCZ, patch: flatPatch(), tiles: [foot], win: crossingWindow() }).deckH).toBeNull();
  });
});

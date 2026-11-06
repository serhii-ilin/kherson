import { describe, expect, it } from 'vitest';
import { CHUNK, REGION, REGION_CHUNKS, VOXEL } from '../src/world/constants';
import { MAT } from '../src/world/materials';
import { POINT, ROAD, ROAD_SIDEWALK, type VRoad, type VectorTile } from '../src/world/vector-format';
import { sideMaterial } from '../src/fine/mesh';
import { rasterizeGround } from '../src/fine/ground';
import { FineGrid, paintObb } from '../src/fine/raster';
import { FINE_CELL, FINE_N, countMat, emptyTile, flatPatch, hAt, matAt, raster, road } from './fine-util';
import {
  MANHOLE_R, drainsAlong, manholesAlong, patchesAlong, stopLines, type RoadRect,
} from '../src/fine/street-detail';

const REGION_M = REGION * VOXEL;

/** Straight polyline in chunk-local metres. */
function linePts(len: number, z = 0): Float64Array {
  return Float64Array.from([0, z, len, z]);
}

/** Right-hand normal of a placement direction: +offset is the right side of travel. */
function rectCentre(q: RoadRect): [number, number] {
  const nx = -q.uz, nz = q.ux;
  return [q.x + nx * q.offset, q.z + nz * q.offset];
}

/** A road in the region of a central chunk, from chunk-local metres. */
function centralRoad(
  tile: VectorTile, gcx: number, gcz: number,
  pts: ReadonlyArray<readonly [number, number]>, widthM: number, flags: number,
): VRoad {
  const ox = tile.rx * REGION_M, oz = tile.rz * REGION_M;
  const out = new Int32Array(pts.length * 2);
  pts.forEach(([x, z], i) => {
    out[i * 2] = Math.round((gcx * CHUNK * VOXEL + x - ox) * 100);
    out[i * 2 + 1] = Math.round((gcz * CHUNK * VOXEL + z - oz) * 100);
  });
  return {
    pts: out, kind: ROAD.RESIDENTIAL, flags, widthCm: Math.round(widthM * 100), lanes: 0, layer: 0, name: -1,
  };
}

describe('fine ground: carriageway surfaces', () => {
  it('maps sett, cobblestone, paving stones and concrete to their fine materials', () => {
    const cases: Array<[number, number]> = [
      [5, MAT.SETT], // SURFACE.SETT
      [6, MAT.SETT], // SURFACE.COBBLESTONE
      [4, MAT.PAVERS], // SURFACE.PAVING_STONES
      [2, MAT.CONCRETE_SLAB], // SURFACE.CONCRETE
      [3, MAT.CONCRETE_SLAB], // SURFACE.CONCRETE_PLATES
      [1, MAT.ASPHALT], // SURFACE.ASPHALT
    ];
    for (const [surface, expected] of cases) {
      const tile = emptyTile();
      tile.roads.push(road([[-10, 32.1], [75, 32.1]], 8, { flags: 1, surface }));
      const g = raster(flatPatch(), tile);
      expect(expected).toBeGreaterThan(0);
      expect(countMat(g, expected)).toBeGreaterThan(0);
      if (expected !== MAT.ASPHALT) expect(countMat(g, MAT.ASPHALT)).toBe(0);
      // sample away from the centre line and the gutter detail
      expect(matAt(g, 20, 32.1 + 2.5)).toBe(expected);
    }
  });

  it('keeps asphalt as the untagged default and dirt for unpaved roads', () => {
    const paved = emptyTile();
    paved.roads.push(road([[-10, 32.1], [75, 32.1]], 8, { flags: 1 }));
    const g = raster(flatPatch(), paved);
    expect(countMat(g, MAT.ASPHALT) + countMat(g, MAT.ASPHALT_PATCH)).toBeGreaterThan(0);
    expect(matAt(g, 20, 32.1 + 2.5)).toBe(MAT.ASPHALT);

    const dirt = emptyTile();
    dirt.roads.push(road([[-10, 32.1], [75, 32.1]], 8, { flags: 1 | 16 })); // ROAD_UNPAVED
    const d = raster(flatPatch(), dirt);
    expect(countMat(d, MAT.DIRT)).toBeGreaterThan(0);
    expect(countMat(d, MAT.ASPHALT)).toBe(0);
  });

  it('maps footway and pedestrian surfaces, keeping the defaults when untagged', () => {
    const foot = (kind: number, surface?: number): number => {
      const tile = emptyTile();
      tile.roads.push(road([[-5, 10.1], [70, 10.1]], 2, { kind, ...(surface ? { surface } : {}) }));
      return matAt(raster(flatPatch(), tile), 30, 10.1);
    };
    expect(foot(ROAD.FOOTWAY)).toBe(MAT.PAVING);
    expect(foot(ROAD.PEDESTRIAN)).toBe(MAT.PLAZA);
    expect(foot(ROAD.FOOTWAY, 5)).toBe(MAT.SETT); // sett
    expect(foot(ROAD.FOOTWAY, 4)).toBe(MAT.PAVERS); // paving_stones
    expect(foot(ROAD.FOOTWAY, 1)).toBe(MAT.ASPHALT); // asphalt
    expect(foot(ROAD.PEDESTRIAN, 4)).toBe(MAT.PAVERS);
  });
});

describe('fine ground: central sidewalks and granite kerbs', () => {
  it('uses behaton pavers on untagged sidewalks near Freedom Square and asphalt elsewhere', () => {
    const gcx = Math.floor(10293 / (CHUNK * VOXEL));
    const gcz = Math.floor(8817 / (CHUNK * VOXEL));
    const tile = emptyTile(Math.floor(gcx / REGION_CHUNKS), Math.floor(gcz / REGION_CHUNKS));
    const z = 8817 - gcz * CHUNK * VOXEL; // the square's z inside this chunk
    tile.roads.push(centralRoad(tile, gcx, gcz, [[-10, z], [75, z]], 8, ROAD_SIDEWALK));
    const g = rasterizeGround({ gcx, gcz, patch: flatPatch(), tiles: [tile] });
    // sidewalk band starts at the 4 m half-width and is 2.5 m wide
    expect(matAt(g, 20, z - 5)).toBe(MAT.PAVERS);
    expect(hAt(g, 20, z - 5)).toBe(400 + 15);
    expect(countMat(g, MAT.SIDEWALK)).toBe(0);

    const outer = emptyTile();
    outer.roads.push(road([[-10, 32.1], [75, 32.1]], 8, { flags: ROAD_SIDEWALK }));
    const o = raster(flatPatch(), outer);
    expect(matAt(o, 20, 32.1 - 5)).toBe(MAT.SIDEWALK);
    expect(countMat(o, MAT.PAVERS)).toBe(0);
  });

  it('tops the kerb with granite only on primary, secondary and trunk roads', () => {
    const render = (kind: number): ReturnType<typeof raster> => {
      const tile = emptyTile();
      tile.roads.push(road([[-10, 32.1], [75, 32.1]], 10, { kind, flags: ROAD_SIDEWALK }));
      return raster(flatPatch(), tile);
    };
    for (const kind of [ROAD.PRIMARY, ROAD.SECONDARY, ROAD.TRUNK]) {
      const g = render(kind);
      let n = 0;
      for (let cz = 0; cz < FINE_N; cz++) {
        for (let cx = 0; cx < FINE_N; cx++) {
          if (g.mat[cz * FINE_N + cx] !== MAT.GRANITE) continue;
          n++;
          // the strip is the 0.2 m band just outside the 5 m carriageway half-width
          const z = (cz + 0.5) * FINE_CELL;
          const d = Math.abs(z - 32.1);
          expect(d).toBeGreaterThan(5 - FINE_CELL);
          expect(d).toBeLessThan(5 + 0.4);
        }
      }
      expect(n).toBeGreaterThan(100);
    }
    for (const kind of [ROAD.RESIDENTIAL, ROAD.TERTIARY, ROAD.LIVING_STREET]) {
      expect(countMat(render(kind), MAT.GRANITE)).toBe(0);
    }
    expect(sideMaterial(MAT.GRANITE)).toBe(MAT.GRANITE);
    expect(sideMaterial(MAT.PAVERS)).toBe(MAT.KERB);
  });
});

describe('street detail placement helpers', () => {
  it('places asphalt patches about every 25 m, aligned and inside the carriageway', () => {
    const half = 4;
    const patches = patchesAlong(linePts(200), half, 4242);
    expect(patches.length).toBeGreaterThanOrEqual(5);
    expect(patches.length).toBeLessThanOrEqual(11);
    for (const q of patches) {
      expect(q.length).toBeGreaterThanOrEqual(1.5);
      expect(q.length).toBeLessThanOrEqual(4);
      expect(q.width).toBeGreaterThanOrEqual(1);
      expect(q.width).toBeLessThanOrEqual(2.5);
      expect(Math.abs(q.offset) + q.width / 2).toBeLessThanOrEqual(half + 1e-9);
      expect(q.uz).toBe(0); // straight road: aligned with +x
      expect(q.ux).toBe(1);
      const [cx] = rectCentre(q);
      expect(cx).toBeGreaterThanOrEqual(0);
      expect(cx).toBeLessThanOrEqual(200);
    }
    // deterministic for the same seed, different for another
    expect(patchesAlong(linePts(200), half, 4242).map((q) => q.x)).toEqual(patches.map((q) => q.x));
    expect(patchesAlong(linePts(200), half, 99).map((q) => q.x)).not.toEqual(patches.map((q) => q.x));
  });

  it('spaces manholes 30-45 m apart near a lane centre', () => {
    const half = 4;
    const list = manholesAlong(linePts(300), half, 77, 2);
    expect(list.length).toBeGreaterThanOrEqual(6);
    for (const m of list) {
      expect(m.r).toBe(MANHOLE_R);
      // two 4 m lanes: centres at -2 and +2
      expect(Math.min(Math.abs(m.offset - 2), Math.abs(m.offset + 2))).toBeLessThanOrEqual(FINE_CELL);
      expect(Math.abs(m.offset) + m.r).toBeLessThanOrEqual(half + 1e-9);
    }
    for (let i = 1; i < list.length; i++) {
      const gap = Math.hypot(list[i]!.x - list[i - 1]!.x, list[i]!.z - list[i - 1]!.z);
      expect(gap).toBeGreaterThanOrEqual(30 - 1e-9);
      expect(gap).toBeLessThanOrEqual(45 + 1e-9);
    }
  });

  it('spaces gutter drains 25-40 m apart on the right, 0.3 m from the kerb', () => {
    const half = 4;
    const list = drainsAlong(linePts(300), half, 123);
    expect(list.length).toBeGreaterThanOrEqual(7);
    for (const q of list) {
      expect(q.ux).toBe(1);
      expect(q.uz).toBe(0);
      expect(q.length).toBeCloseTo(0.8, 6);
      expect(q.width).toBeCloseTo(0.4, 6);
      // right of +x is +z; the grate edge nearest the kerb is 0.3 m inside it
      expect(q.offset + q.width / 2).toBeCloseTo(half - 0.3, 6);
    }
    for (let i = 1; i < list.length; i++) {
      const gap = list[i]!.x - list[i - 1]!.x;
      expect(gap).toBeGreaterThanOrEqual(25 - 1e-9);
      expect(gap).toBeLessThanOrEqual(40 + 1e-9);
    }
  });

  it('puts stop bars 4 m before a signal on each approach, right half only', () => {
    const half = 4;
    const two = stopLines(linePts(100), half, false, 50, 0);
    expect(two.length).toBe(2);
    // incoming (+x) approach: bar at x = 46, spans the +z half
    expect(two[0]!.x).toBeCloseTo(46, 6);
    expect(two[0]!.ux).toBe(1);
    expect(two[0]!.length).toBeCloseTo(0.4, 6);
    expect(two[0]!.width).toBeCloseTo(half, 6);
    expect(two[0]!.offset).toBeCloseTo(half / 2, 6);
    // the opposite approach travels -x, so its right-hand half is -z
    expect(two[1]!.x).toBeCloseTo(54, 6);
    expect(two[1]!.ux).toBe(-1);
    const [, cz1] = rectCentre(two[1]!);
    expect(cz1).toBeLessThan(0);

    const one = stopLines(linePts(100), half, true, 50, 0);
    expect(one.length).toBe(1);
    expect(one[0]!.x).toBeCloseTo(46, 6);
    // a signal more than 3 m off the carriageway gets no stop line
    expect(stopLines(linePts(100), half, false, 50, 3.2)).toEqual([]);

    // on a 30 degree road the bar's long (length) axis follows the tangent exactly, so the bar itself
    // is perpendicular to the road within any tolerance
    const a = Math.PI / 6;
    const dx = Math.cos(a), dz = Math.sin(a);
    const diagonal = Float64Array.from([32 - dx * 60, 32 - dz * 60, 32 + dx * 60, 32 + dz * 60]);
    const bars = stopLines(diagonal, half, false, 32, 32);
    expect(bars.length).toBe(2);
    for (const bar of bars) {
      const cross = bar.ux * dz - bar.uz * dx; // zero when the length axis is the road axis
      expect(Math.abs(cross)).toBeLessThan(1e-9);
      expect(bar.length).toBeCloseTo(0.4, 6);
      expect(bar.width).toBeCloseTo(half, 6);
    }
  });
});

describe('fine ground: street detail raster', () => {
  it('leaves marking and zebra cells alone in the detail painter', () => {
    // The detail passes filter with `need`; `ASPHALT_ONLY` for patches and `CAR_ANY` for stop lines both
    // exclude MARKING, so rule 8's material priority is one table lookup, not a second pass.
    const g = new FineGrid();
    g.mat.fill(MAT.ASPHALT);
    const need = new Uint8Array(256);
    need[MAT.ASPHALT] = 1;
    for (let k = 0; k < 10; k++) g.mat[100 * FINE_N + 100 + k] = MAT.MARKING;
    paintObb(g, 20, 20, 1, 0, 10, 10, MAT.ASPHALT_PATCH, need, 0);
    for (let k = 0; k < 10; k++) expect(g.mat[100 * FINE_N + 100 + k]).toBe(MAT.MARKING);
    expect(g.mat[100 * FINE_N + 99]).toBe(MAT.ASPHALT_PATCH);
  });

  it('paints patches on asphalt only, never outside the road or over a marking', () => {
    const tile = emptyTile();
    tile.roads.push(road([[-20, 32.1], [85, 32.1]], 8, { flags: 1 })); // one-way: no centre line
    const g = raster(flatPatch(), tile);
    expect(countMat(g, MAT.ASPHALT_PATCH)).toBeGreaterThan(0);
    for (let cz = 0; cz < FINE_N; cz++) {
      for (let cx = 0; cx < FINE_N; cx++) {
        const i = cz * FINE_N + cx;
        if (g.mat[i] !== MAT.ASPHALT_PATCH) continue;
        expect(g.own[i]).toBe(1);
        expect(Math.abs((cz + 0.5) * FINE_CELL - 32.1)).toBeLessThanOrEqual(4 + FINE_CELL);
      }
    }
    const setts = emptyTile();
    setts.roads.push(road([[-20, 32.1], [85, 32.1]], 8, { flags: 1, surface: 5 })); // sett
    expect(countMat(raster(flatPatch(), setts), MAT.ASPHALT_PATCH)).toBe(0);
  });

  it('paints manholes and drains on residential asphalt, not on service roads', () => {
    const make = (kind: number): ReturnType<typeof raster> => {
      const tile = emptyTile();
      tile.roads.push(road([[-20, 32.1], [85, 32.1]], 8, { kind, flags: 1 }));
      return raster(flatPatch(), tile);
    };
    const g = make(ROAD.RESIDENTIAL);
    expect(countMat(g, MAT.MANHOLE)).toBeGreaterThan(0);
    expect(countMat(g, MAT.DRAIN)).toBeGreaterThan(0);
    const service = make(ROAD.SERVICE);
    expect(countMat(service, MAT.MANHOLE)).toBe(0);
    expect(countMat(service, MAT.DRAIN)).toBe(0);
  });

  it('paints perpendicular, right-half stop lines and leaves zebra stripes intact', () => {
    const tile = emptyTile();
    tile.roads.push(road([[-20, 32.1], [85, 32.1]], 8)); // two-way
    tile.points.push({ x: Math.round((32 + 256) * 100), z: Math.round((32.1 + 256) * 100), kind: POINT.TRAFFIC_SIGNALS, dir: 255, name: -1 });
    // a zebra right where the incoming stop bar would be: the zebra must win
    tile.points.push({ x: Math.round((28 + 256) * 100), z: Math.round((32.1 + 256) * 100), kind: POINT.CROSSING, dir: 255, name: -1 });
    const g = raster(flatPatch(), tile);

    const cells: Array<[number, number]> = [];
    for (let cz = 0; cz < FINE_N; cz++) {
      for (let cx = 0; cx < FINE_N; cx++) {
        if (g.mat[cz * FINE_N + cx] === MAT.STOP_LINE) cells.push([(cx + 0.5) * FINE_CELL, (cz + 0.5) * FINE_CELL]);
      }
    }
    expect(cells.length).toBeGreaterThan(20);
    const incoming = cells.filter(([x]) => x < 32);
    const outgoing = cells.filter(([x]) => x > 32);
    expect(incoming.length).toBeGreaterThan(10);
    expect(outgoing.length).toBeGreaterThan(10);
    for (const [x, z] of incoming) {
      expect(x).toBeGreaterThanOrEqual(27.4);
      expect(x).toBeLessThanOrEqual(28.6);
      expect(z).toBeGreaterThanOrEqual(32.1 - 0.01); // right half of +x travel
    }
    for (const [x, z] of outgoing) {
      expect(x).toBeGreaterThanOrEqual(35.4);
      expect(x).toBeLessThanOrEqual(36.6);
      expect(z).toBeLessThanOrEqual(32.1 + 0.01); // right half of -x travel
    }

    // no stop line may survive on a zebra stripe
    const withoutSignal = emptyTile();
    withoutSignal.roads.push(road([[-20, 32.1], [85, 32.1]], 8));
    withoutSignal.points.push({ x: Math.round((28 + 256) * 100), z: Math.round((32.1 + 256) * 100), kind: POINT.CROSSING, dir: 255, name: -1 });
    const s = raster(flatPatch(), withoutSignal);
    for (let i = 0; i < g.mat.length; i++) {
      if (s.mat[i] === MAT.MARKING) expect(g.mat[i]).toBe(MAT.MARKING);
    }
  });

  it('are deterministic: the same input gives byte-identical grids', () => {
    const make = (): ReturnType<typeof raster> => {
      const tile = emptyTile();
      tile.roads.push(road([[-20, 20.1], [85, 22.3]], 9, { kind: ROAD.SECONDARY, lanes: 2, flags: ROAD_SIDEWALK }));
      tile.roads.push(road([[30.1, -10], [30.1, 75]], 7, { flags: ROAD_SIDEWALK, name: 1, surface: 4 }));
      tile.points.push({ x: Math.round((30.1 + 256) * 100), z: Math.round((21.5 + 256) * 100), kind: POINT.TRAFFIC_SIGNALS, dir: 255, name: -1 });
      tile.points.push({ x: Math.round((40 + 256) * 100), z: Math.round((25 + 256) * 100), kind: POINT.CROSSING, dir: 255, name: -1 });
      return raster(flatPatch(), tile);
    };
    const a = make(), b = make();
    for (const k of ['mat', 'hcm', 'base', 'own', 'ao'] as const) {
      expect(Buffer.from(a[k]).equals(Buffer.from(b[k]))).toBe(true);
    }
    expect(a.deckH).toBeNull();
    expect(b.deckH).toBeNull();
  });
});

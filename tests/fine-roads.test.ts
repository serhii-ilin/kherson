import { describe, expect, it } from 'vitest';
import { MAT } from '../src/world/materials';
import { ROAD, ROAD_SIDEWALK } from '../src/world/vector-format';
import { KERB_CM } from '../src/fine/ground';
import { FINE_CELL, FINE_N, countMat, emptyTile, flatPatch, hAt, matAt, raster, road, setCoarse } from './fine-util';

/** Cells of `mat` in the column at x, as [first, last] z cell index and count. */
function columnRun(g: ReturnType<typeof raster>, x: number, mat: number): { n: number; z0: number; z1: number } {
  const cx = Math.floor(x / FINE_CELL);
  let n = 0, z0 = -1, z1 = -1;
  for (let cz = 0; cz < FINE_N; cz++) {
    if (g.mat[cz * FINE_N + cx] === mat) {
      n++;
      if (z0 < 0) z0 = cz;
      z1 = cz;
    }
  }
  return { n, z0, z1 };
}

describe('fine ground: roads', () => {
  it('paints an 8 m road exactly ~8 m wide with raised 2.5 m sidewalks', () => {
    const tile = emptyTile();
    tile.roads.push(road([[-10, 32.1], [75, 32.1]], 8, { flags: ROAD_SIDEWALK }));
    const g = raster(flatPatch(), tile);
    const a = columnRun(g, 20, MAT.ASPHALT);
    expect(Math.abs(a.n - 40)).toBeLessThanOrEqual(1);
    expect(a.z1 - a.z0 + 1).toBe(a.n); // contiguous
    const s = columnRun(g, 20, MAT.SIDEWALK);
    expect(Math.abs(s.n - 25)).toBeLessThanOrEqual(2); // 2 x 2.5 m
    // sidewalk is 15 cm above the carriageway (gh 2 voxels = 400 cm)
    expect(hAt(g, 20, 32.1 - 5)).toBe(400 + KERB_CM);
    expect(hAt(g, 20, 32.1)).toBe(400);
    expect(matAt(g, 20, 32.1 - 3)).toBe(MAT.ASPHALT);
    expect(matAt(g, 20, 32.1 - 5)).toBe(MAT.SIDEWALK);
    expect(matAt(g, 20, 32.1 - 8)).toBe(MAT.GRASS);
    expect(hAt(g, 20, 32.1 - 8)).toBe(400);
  });

  it('keeps the width on a 45 degree road', () => {
    const tile = emptyTile();
    tile.roads.push(road([[-10, -10], [75, 75]], 8, { flags: ROAD_SIDEWALK }));
    const g = raster(flatPatch(), tile);
    const a = columnRun(g, 32, MAT.ASPHALT);
    expect(Math.abs((a.n * FINE_CELL) / Math.SQRT2 - 8)).toBeLessThan(0.5);
    const s = columnRun(g, 32, MAT.SIDEWALK);
    expect(Math.abs((s.n * FINE_CELL) / Math.SQRT2 - 5)).toBeLessThan(0.7);
  });

  it('uses 3.5 m sidewalks on primary roads and paints major roads last', () => {
    const tile = emptyTile();
    tile.roads.push(road([[-10, 32.1], [75, 32.1]], 10, { kind: ROAD.PRIMARY, flags: ROAD_SIDEWALK }));
    tile.roads.push(road([[20.1, -10], [20.1, 75]], 6, { kind: ROAD.RESIDENTIAL, flags: ROAD_SIDEWALK }));
    const g = raster(flatPatch(), tile);
    const s = columnRun(g, 45, MAT.SIDEWALK);
    expect(Math.abs(s.n * FINE_CELL - 7)).toBeLessThanOrEqual(0.5);
    // the side street crosses the primary road's sidewalk band; the primary carriageway stays whole
    expect(matAt(g, 20.1, 32.1)).toBe(MAT.ASPHALT);
    expect(matAt(g, 20.1, 32.1 + 6)).toBe(MAT.ASPHALT);
    expect(hAt(g, 20.1, 32.1 + 6)).toBe(400);
    expect(matAt(g, 26.5, 32.1 + 6)).toBe(MAT.SIDEWALK);
  });

  it('paints unpaved roads and tracks as dirt, skips bridges and other layers', () => {
    const tile = emptyTile();
    tile.roads.push(road([[-10, 10.1], [75, 10.1]], 4, { kind: ROAD.TRACK }));
    tile.roads.push(road([[-10, 20.1], [75, 20.1]], 6, { flags: 2 })); // bridge
    tile.roads.push(road([[-10, 30.1], [75, 30.1]], 6, { layer: -1 }));
    const g = raster(flatPatch(), tile);
    expect(matAt(g, 20, 10.1)).toBe(MAT.DIRT);
    expect(countMat(g, MAT.ASPHALT)).toBe(0);
  });

  it('replaces coarse road cells by the neighbouring ground and leaves water and buildings empty', () => {
    const p = flatPatch(MAT.PARK);
    setCoarse(p, 10, 10, MAT.ASPHALT, 2);
    setCoarse(p, 11, 10, MAT.SIDEWALK, 2);
    setCoarse(p, 20, 20, MAT.WATER, 1);
    setCoarse(p, 25, 5, MAT.GRASS, 2, 4);
    const g = raster(p, emptyTile());
    expect(matAt(g, 21, 21)).toBe(MAT.PARK);
    expect(matAt(g, 23, 21)).toBe(MAT.PARK);
    expect(matAt(g, 41, 41)).toBe(0);
    expect(matAt(g, 51, 11)).toBe(0);
    // a lone road cell surrounded by nothing known falls back to grass
    const q = flatPatch(MAT.ASPHALT);
    expect(matAt(raster(q, emptyTile()), 10, 10)).toBe(MAT.GRASS);
  });

  it('paints areas by priority with holes and never onto water', () => {
    const p = flatPatch();
    setCoarse(p, 16, 16, MAT.WATER, 1);
    const tile = emptyTile();
    tile.areas.push({
      rings: [
        Int32Array.from([10, 10, 50, 10, 50, 50, 10, 50].map((v, i) => (v + 256) * 100 + (i & 0))),
        Int32Array.from([25, 25, 35, 25, 35, 35, 25, 35].map((v) => (v + 256) * 100)),
      ],
      mat: MAT.PARK, prio: 1,
    });
    tile.areas.push({
      rings: [Int32Array.from([0, 0, 20, 0, 20, 20, 0, 20].map((v) => (v + 256) * 100))],
      mat: MAT.SAND, prio: 0,
    });
    const g = raster(p, tile);
    expect(matAt(g, 15, 15)).toBe(MAT.PARK); // higher prio wins over the sand
    expect(matAt(g, 5, 5)).toBe(MAT.SAND);
    expect(matAt(g, 30, 30)).toBe(MAT.GRASS); // hole
    expect(matAt(g, 33, 33)).toBe(0); // coarse water stays empty
    expect(matAt(g, 60, 60)).toBe(MAT.GRASS);
  });

  it('paints footways at carriageway height with paving', () => {
    const tile = emptyTile();
    tile.roads.push(road([[-5, 10.1], [70, 10.1]], 2, { kind: ROAD.FOOTWAY }));
    const g = raster(flatPatch(), tile);
    expect(matAt(g, 30, 10.1)).toBe(MAT.PAVING);
    expect(hAt(g, 30, 10.1)).toBe(400);
    const n = columnRun(g, 30, MAT.PAVING).n * FINE_CELL;
    expect(Math.abs(n - 2)).toBeLessThanOrEqual(0.25);
  });
});

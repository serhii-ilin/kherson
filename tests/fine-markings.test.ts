import { describe, expect, it } from 'vitest';
import { MAT } from '../src/world/materials';
import { LINE, POINT, ROAD, ROAD_ONEWAY, ROAD_UNPAVED } from '../src/world/vector-format';
import { RAIL_GAUGE } from '../src/fine/ground';
import { FINE_CELL, FINE_N, countMat, emptyTile, flatPatch, line, matAt, point, raster, road } from './fine-util';

/** Starts and lengths (metres) of marking runs along one cell row. */
function runs(g: ReturnType<typeof raster>, row: number): Array<{ x: number; len: number }> {
  const out: Array<{ x: number; len: number }> = [];
  let start = -1;
  for (let cx = 0; cx <= FINE_N; cx++) {
    const on = cx < FINE_N && g.mat[row * FINE_N + cx] === MAT.MARKING;
    if (on && start < 0) start = cx;
    if (!on && start >= 0) {
      out.push({ x: start * FINE_CELL, len: (cx - start) * FINE_CELL });
      start = -1;
    }
  }
  return out;
}

describe('fine ground: markings', () => {
  it('dashes the centre line 3 m on / 6 m off (9 m period)', () => {
    const tile = emptyTile();
    // 90 m long, two-way, 8 m wide, line centre inside cell row 160
    tile.roads.push(road([[-13, 32.1], [77, 32.1]], 8));
    const g = raster(flatPatch(), tile);
    const r = runs(g, 160);
    expect(r.length).toBeGreaterThanOrEqual(6);
    const full = r.filter((d) => d.x > 0.1 && d.x + d.len < 63.9); // not clipped by the chunk border
    expect(full.length).toBeGreaterThanOrEqual(5);
    for (const d of full) expect(Math.abs(d.len - 3)).toBeLessThanOrEqual(0.41);
    for (let i = 1; i < full.length; i++) expect(Math.abs(full[i]!.x - full[i - 1]!.x - 9)).toBeLessThanOrEqual(0.41);
    // asphalt only: no marking cell sits on anything else
    for (let i = 0; i < g.mat.length; i++) if (g.mat[i] === MAT.MARKING) expect(g.own[i]).toBe(1);
  });

  it('paints no centre line on narrow, one-way or unpaved roads', () => {
    const tile = emptyTile();
    tile.roads.push(road([[-5, 10.1], [70, 10.1]], 5));
    tile.roads.push(road([[-5, 25.1], [70, 25.1]], 8, { flags: ROAD_ONEWAY }));
    tile.roads.push(road([[-5, 40.1], [70, 40.1]], 8, { flags: ROAD_UNPAVED }));
    tile.roads.push(road([[-5, 55.1], [70, 55.1]], 8, { kind: ROAD.TRACK }));
    expect(countMat(raster(flatPatch(), tile), MAT.MARKING)).toBe(0);
  });

  it('suppresses markings around a T-junction but not where pieces of one road meet', () => {
    const t = emptyTile();
    t.roads.push(road([[-10, 32.1], [32.1, 32.1]], 8, { name: 0 }));
    t.roads.push(road([[32.1, 32.1], [75, 32.1]], 8, { name: 0 }));
    t.roads.push(road([[32.1, -10], [32.1, 32.1]], 8, { name: 1 }));
    const g = raster(flatPatch(), t);
    let near = 0, far = 0;
    for (let cz = 0; cz < FINE_N; cz++) {
      for (let cx = 0; cx < FINE_N; cx++) {
        if (g.mat[cz * FINE_N + cx] !== MAT.MARKING) continue;
        const d = Math.hypot((cx + 0.5) * FINE_CELL - 32.1, (cz + 0.5) * FINE_CELL - 32.1);
        if (d < 5.9) near++;
        else far++;
      }
    }
    expect(near).toBe(0);
    expect(far).toBeGreaterThan(50);

    // the same main road without the side street: pieces share an end but this is no junction
    const u = emptyTile();
    u.roads.push(road([[-10, 32.1], [32.1, 32.1]], 8, { name: 0 }));
    u.roads.push(road([[32.1, 32.1], [75, 32.1]], 8, { name: 0 }));
    const h = raster(flatPatch(), u);
    let around = 0;
    for (let cx = Math.floor(26 / FINE_CELL); cx < Math.floor(38 / FINE_CELL); cx++) {
      if (h.mat[160 * FINE_N + cx] === MAT.MARKING) around++;
    }
    expect(around).toBeGreaterThan(0);
  });

  it('paints solid double centre lines and edge lines on wide primary roads', () => {
    const tile = emptyTile();
    tile.roads.push(road([[-5, 32.1], [70, 32.1]], 14, { kind: ROAD.PRIMARY, lanes: 4 }));
    const g = raster(flatPatch(), tile);
    // double line: two parallel solid stripes about 0.6 m apart
    const col = 100;
    const marks: number[] = [];
    for (let cz = 0; cz < FINE_N; cz++) if (g.mat[cz * FINE_N + col] === MAT.MARKING) marks.push(cz);
    expect(marks.length).toBeGreaterThanOrEqual(4);
    // edge lines 0.3 m inside the 7 m half width
    expect(matAt(g, 20, 32.1 - 6.7)).toBe(MAT.MARKING);
    expect(matAt(g, 20, 32.1 + 6.7)).toBe(MAT.MARKING);
    // double centre line is solid: no gap along a row
    expect(runs(g, Math.floor(31.8 / FINE_CELL))[0]!.len).toBeGreaterThan(50);
  });

  it('puts dashed lane separators on multi-lane one-way roads', () => {
    const tile = emptyTile();
    tile.roads.push(road([[-10, 32.1], [75, 32.1]], 12, { kind: ROAD.SECONDARY, lanes: 3, flags: ROAD_ONEWAY }));
    const g = raster(flatPatch(), tile);
    // separators at +-2 m from the centre
    const r = runs(g, Math.floor((32.1 - 2) / FINE_CELL));
    expect(r.length).toBeGreaterThan(3);
    expect(r[0]!.len).toBeLessThan(4);
  });
});

/** Cell centres of marking cells within `radius` of (x, z). */
function markingsNear(g: ReturnType<typeof raster>, x: number, z: number, radius: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let cz = 0; cz < FINE_N; cz++) {
    for (let cx = 0; cx < FINE_N; cx++) {
      if (g.mat[cz * FINE_N + cx] !== MAT.MARKING) continue;
      const px = (cx + 0.5) * FINE_CELL, pz = (cz + 0.5) * FINE_CELL;
      if (Math.hypot(px - x, pz - z) <= radius) out.push([px, pz]);
    }
  }
  return out;
}

describe('fine ground: zebra crossings', () => {
  for (const deg of [0, 45]) {
    it(`aligns stripes with a ${deg} degree road`, () => {
      const a = (deg * Math.PI) / 180;
      const dx = Math.cos(a), dz = Math.sin(a);
      const tile = emptyTile();
      // one-way 8 m road: no centre line, so every marking cell belongs to the zebra
      tile.roads.push(road(
        [[32 - dx * 50, 32 - dz * 50], [32 + dx * 50, 32 + dz * 50]], 8, { flags: ROAD_ONEWAY },
      ));
      const dir = deg === 0 ? 255 : Math.round((deg / 360) * 256);
      tile.points.push(point(32, 32, POINT.CROSSING, dir));
      const g = raster(flatPatch(), tile);
      const cells = markingsNear(g, 32, 32, 9);
      // 8 stripes of 0.5 x 3 m (cell sampling makes them 2-3 cells wide)
      expect(Math.abs(cells.length * FINE_CELL * FINE_CELL - 12)).toBeLessThan(4);
      let along = 0, across = 0;
      for (const [px, pz] of cells) {
        const u = (px - 32) * dx + (pz - 32) * dz;
        const v = -(px - 32) * dz + (pz - 32) * dx;
        along = Math.max(along, Math.abs(u));
        across = Math.max(across, Math.abs(v));
        // stripe pattern depends on the lateral coordinate only: 0.5 on, 0.5 off with 0.5 m start offset
        const t = v + 4 - (8 - 7.5) / 2;
        const frac = t - Math.floor(t);
        expect(frac < 0.5 + 0.2 || frac > 1 - 0.2).toBe(true);
      }
      expect(along).toBeLessThan(1.65);
      expect(along).toBeGreaterThan(1.3);
      expect(across).toBeGreaterThan(3.5);
      expect(across).toBeLessThan(4.05);
      // each stripe is long along the road: cells with the same lateral band reach both ends
      const first = cells.filter(([px, pz]) => {
        const v = -(px - 32) * dz + (pz - 32) * dx;
        return v > -3.95 && v < -3.55;
      });
      let uMin = Infinity, uMax = -Infinity;
      for (const [px, pz] of first) {
        const u = (px - 32) * dx + (pz - 32) * dz;
        uMin = Math.min(uMin, u);
        uMax = Math.max(uMax, u);
      }
      expect(uMax - uMin).toBeGreaterThan(2.4);
    });
  }

  it('ignores a crossing node whose direction crosses the road', () => {
    const tile = emptyTile();
    tile.roads.push(road([[-10, 32.1], [75, 32.1]], 8, { flags: ROAD_ONEWAY }));
    tile.points.push(point(32, 32.1, POINT.CROSSING, 64)); // footway direction: 90 degrees off
    const g = raster(flatPatch(), tile);
    const cells = markingsNear(g, 32, 32.1, 9);
    const zs = cells.map(([, z]) => z);
    // stripes still run along x and spread over the 8 m carriageway (perpendicular ones would span 3 m)
    expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThan(6.5);
  });
});

describe('fine ground: tracks', () => {
  it('lays tram rails 1.52 m apart', () => {
    let sum = 0, count = 0;
    for (let k = 0; k < 10; k++) {
      const z = 32.1 + k * 0.02;
      const tile = emptyTile();
      tile.lines.push(line([[-5, z], [70, z]], LINE.TRAM));
      const g = raster(flatPatch(), tile);
      const rows: number[] = [];
      for (let cz = 0; cz < FINE_N; cz++) if (g.mat[cz * FINE_N + 100] === MAT.STEEL) rows.push(cz);
      expect(rows.length).toBe(2);
      const sep = (rows[1]! - rows[0]!) * FINE_CELL;
      expect(Math.abs(sep - RAIL_GAUGE)).toBeLessThanOrEqual(FINE_CELL + 1e-9);
      sum += sep;
      count++;
    }
    expect(Math.abs(sum / count - 1.52)).toBeLessThan(0.07);
  });

  it('keeps tram rails on top of asphalt and rails on a 3 m ballast bed', () => {
    const tile = emptyTile();
    tile.roads.push(road([[-5, 20.1], [70, 20.1]], 8));
    tile.lines.push(line([[-5, 20.1], [70, 20.1]], LINE.TRAM));
    tile.lines.push(line([[-5, 50.1], [70, 50.1]], LINE.RAIL));
    const g = raster(flatPatch(), tile);
    expect(matAt(g, 30, 20.1 - 0.76)).toBe(MAT.STEEL);
    expect(matAt(g, 30, 20.1 + 0.3)).toBe(MAT.ASPHALT);
    let ballast = 0, steel = 0;
    for (let cz = 0; cz < FINE_N; cz++) {
      const m = g.mat[cz * FINE_N + 100];
      if (cz * FINE_CELL > 40) {
        if (m === MAT.RAIL) ballast++;
        if (m === MAT.STEEL) steel++;
      }
    }
    expect(steel).toBe(2);
    expect(Math.abs((ballast + steel) * FINE_CELL - 3)).toBeLessThanOrEqual(0.45);
  });
});

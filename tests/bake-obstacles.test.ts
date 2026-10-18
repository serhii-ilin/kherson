import { describe, expect, it } from 'vitest';
import { Obstacles } from '../tools/bake/obstacles';
import { distanceTransform, DIST_UNIT } from '../tools/bake/distance';
import { buildOverview } from '../tools/bake/overview';
import { buildVectorTiles, type VectorInput } from '../tools/bake/vectors';
import { jitterX, jitterZ } from '../src/nature/placement';
import { F_GROUND_MAT, F_ROOF_MAT, F_STRUCT_H, F_STRUCT_MAT, FIELDS, REGION } from '../src/world/constants';
import { MAT } from '../src/world/materials';
import { packStruct } from '../src/world/format';
import { DEFAULT_CELLS } from '../tools/bake/grid';

// geometry is in cell units (2 m)
describe('bake obstacles (#6)', () => {
  // east-west residential road at z = 50 cells (100 m), 8 m wide (4.6 m radius with the margin); building 20..30 x 60..70 cells
  const roads = [{ pts: [[0, 50], [100, 50]] as [number, number][], widthM: 8 }];
  const building: [number, number][] = [[20, 60], [30, 60], [30, 70], [20, 70]];
  const o = new Obstacles(roads, [[building]]);

  it('blocks the carriageway plus 0.6 m and frees the sidewalk band', () => {
    expect(o.blocked(10, 100)).toBe(true);
    expect(o.blocked(10, 100 + 4.5)).toBe(true);
    expect(o.blocked(10, 100 + 4.7)).toBe(false);
    expect(o.blocked(10, 100 - 4.7)).toBe(false);
  });

  it('blocks building footprints plus 0.5 m', () => {
    expect(o.blocked(50, 130)).toBe(true); // inside
    expect(o.blocked(39.6, 130)).toBe(true); // 0.4 m outside the west wall (x = 40 m)
    expect(o.blocked(39.4, 130)).toBe(false);
  });

  it('nudges a seed off the carriageway or drops the plant', () => {
    // cell (5, 54): centre z = 109 m; the road radius reaches z = 104.6, so the cell is free for the seed that keeps jitter >= 0
    let nudged = 0, kept = 0, dropped = 0;
    for (let s = 0; s < 256; s += 5) {
      const z = (54 + 0.5 + jitterZ(s)) * 2;
      const r = o.freeSeed(5, 54, s);
      if (r < 0) dropped++;
      else {
        if (r === s) kept++; else nudged++;
        expect(o.blocked((5 + 0.5 + jitterX(r)) * 2, (54 + 0.5 + jitterZ(r)) * 2)).toBe(false);
      }
      if (z > 104.6) expect(r).toBe(s);
    }
    expect(kept).toBeGreaterThan(0);
    // a cell centred on the road centre line has no free position within +-0.7 m
    expect(o.freeSeed(5, 50, 17)).toBe(-1);
    expect(nudged + dropped + kept).toBeGreaterThan(0);
  });
});

describe('bake distance transform', () => {
  it('measures distance in thirds of a cell, saturating at 255', () => {
    const w = 200, h = 5;
    const src = new Uint8Array(w * h);
    src[2 * w] = 1;
    const d = distanceTransform(src, w, h);
    expect(d[2 * w]).toBe(0);
    expect(d[2 * w + 10]).toBe(10 * DIST_UNIT);
    expect(d[2 * w + 150]).toBe(255);
    expect(d[0 * w + 1]).toBe(7); // two rows up, one column right: orthogonal 3 + diagonal 4

  });
});

describe('overview.bin and the v2 struct byte', () => {
  it('does not leak tint bits into material ids', () => {
    const cells = DEFAULT_CELLS.slice();
    const P = REGION * REGION;
    for (let i = 0; i < 64; i++) {
      const idx = (i >> 3) * REGION + (i & 7);
      cells[F_STRUCT_H * P + idx] = 5;
      cells[F_STRUCT_MAT * P + idx] = packStruct(MAT.WALL_PANEL, 3);
      cells[F_ROOF_MAT * P + idx] = 0; // no roof: the wall byte decides the top material
    }
    const regions = new Map<number, Uint8Array>([[0, cells]]);
    const ov = buildOverview(regions, 1, 1, DEFAULT_CELLS);
    expect(ov[4 + 2]).toBe(MAT.WALL_PANEL);
    expect(FIELDS).toBe(5);
    expect(F_GROUND_MAT).toBe(0);
  });
});

describe('vector area clipping of multi-outer water', () => {
  it('keeps a second outer ring in regions the first outer ring does not reach', () => {
    const input: VectorInput = { areas: [], lines: [], barriers: [], taggedNodes: [], regionsX: 4, regionsZ: 4, centre: [0, 0] };
    const sq = (x: number, z: number, s: number): [number, number][] => [[x, z], [x + s, z], [x + s, z + s], [x, z + s]];
    input.areas.push({ id: 1, tags: { natural: 'water' }, rings: [sq(10, 10, 20), sq(600, 10, 20)] });
    const { tiles } = buildVectorTiles(input);
    expect(tiles.get(2)).toBeDefined(); // region (2, 0) holds the second ring only
    expect(tiles.get(2)!.areas[0]!.mat).toBe(MAT.WATER);
  });
});

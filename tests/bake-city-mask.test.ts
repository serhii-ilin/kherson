import { describe, expect, it } from 'vitest';
import { buildCityMask, keepOutsideGround, ringCentroid, ringTouchesMask } from '../tools/bake/city-mask';
import { buildVectorTiles, type VectorInput } from '../tools/bake/vectors';
import { groundClass } from '../tools/bake/classes';
import { MAT } from '../src/world/materials';

// square city from cell (20,20) to (60,60)
const square: [number, number][] = [[20, 20], [60, 20], [60, 60], [20, 60]];

describe('city mask', () => {
  it('rasterises the polygon and respects the cell grid bounds', () => {
    const m = buildCityMask([square], 100, 100, 0);
    expect(m.hasCell(40, 40)).toBe(true);
    expect(m.hasCell(20, 20)).toBe(true);
    expect(m.hasCell(59, 59)).toBe(true);
    expect(m.hasCell(60, 40)).toBe(false);
    expect(m.hasCell(19, 40)).toBe(false);
    expect(m.hasCell(-1, 40)).toBe(false);
    expect(m.hasCell(100, 40)).toBe(false);
    expect(m.hasPoint(40.9, 40.9)).toBe(true);
  });

  it('dilates by a round margin', () => {
    const m = buildCityMask([square], 100, 100, 10);
    expect(m.hasCell(11, 40)).toBe(true); // 9 cells outside the edge
    expect(m.hasCell(9, 40)).toBe(false); // 11 cells outside
    expect(m.hasCell(40, 69)).toBe(true);
    expect(m.hasCell(40, 71)).toBe(false);
    expect(m.hasCell(12, 12)).toBe(false); // diagonal corner is rounded: ~11.3 cells away
    expect(m.hasCell(13, 13)).toBe(true); // ~9.9 cells away
  });

  it('is deterministic and handles holes', () => {
    const hole: [number, number][] = [[35, 35], [45, 35], [45, 45], [35, 45]];
    const a = buildCityMask([square, hole], 100, 100, 3);
    const b = buildCityMask([square, hole], 100, 100, 3);
    expect(Buffer.compare(a.bits, b.bits)).toBe(0);
    expect(a.hasCell(40, 40)).toBe(false); // hole centre is 5 cells from its edge, margin is 3
    expect(a.hasCell(36, 40)).toBe(true); // dilation grows into the hole
    expect(a.hasCell(30, 30)).toBe(true);
  });

  it('classifies outside ground: natural stays, built-up goes', () => {
    const keep: Record<string, string>[] = [{ landuse: 'forest' }, { natural: 'wood' }, { natural: 'scrub' }, { natural: 'sand' }, { natural: 'beach' }];
    const drop: Record<string, string>[] = [
      { landuse: 'industrial' }, { landuse: 'construction' }, { landuse: 'recreation_ground' }, { leisure: 'park' },
      { leisure: 'garden' }, { place: 'square' }, { landuse: 'quarry' }, { landuse: 'railway' },
    ];
    for (const t of keep) {
      expect(groundClass(t), JSON.stringify(t)).not.toBeNull();
      expect(keepOutsideGround(t)).toBe(true);
    }
    for (const t of drop) expect(keepOutsideGround(t), JSON.stringify(t)).toBe(false);
    expect(keepOutsideGround({ landuse: 'farmland' })).toBe(false);
  });

  it('centroid and ring tests', () => {
    const m = buildCityMask([square], 100, 100, 0);
    expect(ringCentroid([[0, 0], [10, 0], [10, 10], [0, 10]])).toEqual([5, 5]);
    expect(ringTouchesMask(m, [[0, 0], [30, 30]])).toBe(true);
    expect(ringTouchesMask(m, [[0, 0], [5, 5]])).toBe(false);
  });
});

describe('vector tiles with a city mask', () => {
  const base = (): VectorInput => ({
    areas: [], lines: [], barriers: [], taggedNodes: [], regionsX: 4, regionsZ: 4, centre: [0, 0],
    // cell (cx) = cm / 200: inside when x < 100 cells
    inCity: (x, z) => x >= 0 && x < 100 * 200 && z >= 0 && z < 100 * 200,
  });
  const sq = (x: number, z: number, s: number): [number, number][] => [[x, z], [x + s, z], [x + s, z + s], [x, z + s]];

  it('drops outside buildings, points, and road pieces whose midpoint is outside', () => {
    const input = base();
    input.areas.push({ id: 1, tags: { building: 'yes' }, rings: [sq(10, 10, 5)] });
    input.areas.push({ id: 2, tags: { building: 'yes' }, rings: [sq(150, 10, 5)] });
    input.lines.push({ id: 3, tags: { highway: 'residential' }, pts: [[50, 10], [150, 10]] }); // 200 m: pieces inside up to x=100
    input.taggedNodes.push({ id: 4, cx: 20, cz: 20, tags: { highway: 'street_lamp' } });
    input.taggedNodes.push({ id: 5, cx: 150, cz: 20, tags: { highway: 'street_lamp' } });
    const { tiles, stats } = buildVectorTiles(input);
    expect(stats.buildings).toBe(1);
    expect(stats.points).toBe(1);
    expect(stats.roads).toBe(2); // 4 pieces of 50 m, midpoints at 12.5, 37.5, 62.5, 87.5 m -> cells 56..94 inside; 2 inside
    expect(tiles.size).toBeGreaterThan(0);
  });

  it('keeps only natural ground areas outside, and drops built-up areas that straddle the mask (#16)', () => {
    const input = base();
    input.areas.push({ id: 1, tags: { natural: 'wood' }, rings: [sq(150, 150, 10)] });
    input.areas.push({ id: 2, tags: { landuse: 'industrial' }, rings: [sq(160, 160, 10)] });
    input.areas.push({ id: 3, tags: { landuse: 'industrial' }, rings: [sq(95, 10, 10)] }); // straddles the edge: excluded
    input.areas.push({ id: 4, tags: { landuse: 'industrial' }, rings: [sq(10, 10, 10)] }); // fully inside: kept
    input.areas.push({ id: 5, tags: { natural: 'wood' }, rings: [sq(95, 50, 10)] }); // natural classes straddle freely
    const { stats, tiles } = buildVectorTiles(input);
    expect(stats.areas).toBe(3);
    expect(stats.straddleDropped).toBe(1);
    const mats = [...tiles.values()].flatMap((t) => t.areas.map((a) => a.mat));
    expect(mats.length).toBeGreaterThan(0);
  });

  it('keeps water polygons everywhere (prio 0), inside and outside the mask', () => {
    const input = base();
    input.areas.push({ id: 1, tags: { natural: 'water' }, rings: [sq(10, 10, 10)] });
    input.areas.push({ id: 2, tags: { waterway: 'riverbank' }, rings: [sq(300, 300, 30)] });
    input.areas.push({ id: 3, tags: { natural: 'water', water: 'lake' }, rings: [sq(90, 90, 30)] }); // straddles
    input.areas.push({ id: 4, tags: { landuse: 'industrial' }, rings: [sq(20, 20, 5)] });
    const { stats, tiles } = buildVectorTiles(input);
    expect(stats.waterAreas).toBe(3);
    const all = [...tiles.values()].flatMap((t) => t.areas);
    expect(all.filter((a) => a.mat === MAT.WATER).every((a) => a.prio === 0)).toBe(true);
    expect(all.some((a) => a.mat === MAT.WATER)).toBe(true);
    // water first, land cover after it
    const t0 = tiles.get(0)!;
    expect(t0.areas[0]!.mat).toBe(MAT.WATER);
  });

  it('classifies floodplain ground (wetland, reed, meadow, scrub) as natural ground', () => {
    expect(groundClass({ natural: 'wetland', wetland: 'marsh' })).toEqual({ mat: MAT.WETLAND, prio: 2 });
    expect(groundClass({ natural: 'wetland', wetland: 'reedbed' })).toEqual({ mat: MAT.REED, prio: 2 });
    expect(groundClass({ natural: 'scrub' })!.mat).toBe(MAT.SCRUB);
    expect(groundClass({ landuse: 'meadow' })!.mat).toBe(MAT.MEADOW);
    for (const t of [{ natural: 'wetland' }, { landuse: 'meadow' }, { natural: 'heath' }] as Record<string, string>[]) expect(keepOutsideGround(t)).toBe(true);
  });
});

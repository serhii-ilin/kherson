import { describe, expect, it } from 'vitest';
import { HISTORIC_WALLS, HOUSE_WALLS, MAT } from '../src/world/materials';
import { buildingSpec, estimateStoreys, nearestVariant } from '../tools/bake/building-style';

describe('buildingSpec facade styles', () => {
  it('is deterministic', () => {
    for (const id of [1, 77, 123456789]) {
      const t = { building: 'yes', 'building:levels': '2' };
      expect(buildingSpec(id, t, 500, 150)).toEqual(buildingSpec(id, t, 500, 150));
    }
  });

  it('apartments: khrushchevka, panel, stalin', () => {
    expect(buildingSpec(10, { building: 'apartments', 'building:levels': '5' }, 5000).wall).toBe(MAT.WALL_KHRUSH);
    expect(buildingSpec(10, { building: 'apartments' }, 5000).wall).toBe(MAT.WALL_KHRUSH);
    expect(buildingSpec(10, { building: 'apartments', 'building:levels': '9' }, 5000).wall).toBe(MAT.WALL_PANEL);
    expect(buildingSpec(10, { building: 'apartments', height: '24' }, 5000).wall).toBe(MAT.WALL_PANEL);
    expect(buildingSpec(10, { building: 'apartments', 'building:architecture': 'stalinist' }, 5000).wall).toBe(MAT.WALL_STALIN);
    // near the centre a share of mid-rise blocks is Stalin-era
    let stalin = 0;
    for (let id = 0; id < 300; id++) {
      if (buildingSpec(id, { building: 'apartments', 'building:levels': '5' }, 1000).wall === MAT.WALL_STALIN) stalin++;
    }
    expect(stalin).toBeGreaterThan(50);
    expect(stalin).toBeLessThan(200);
    // ...but never a typical khrushchevka slab (12 x 66 m, five storeys), e.g. Filatova 28
    const slab = { ring: [[0, 0], [33, 0], [33, 6], [0, 6]] as [number, number][] }; // cell units (2 m)
    for (let id = 0; id < 300; id++) {
      expect(buildingSpec(id, { building: 'apartments', 'building:levels': '5' }, 1000, 790, slab).wall).toBe(MAT.WALL_KHRUSH);
    }
  });

  it('low central buildings are historic pastels; far ones are plain houses', () => {
    const seen = new Set<number>();
    for (let id = 0; id < 200; id++) {
      const w = buildingSpec(id, { building: 'yes', 'building:levels': '2' }, 400, 150).wall;
      expect(HISTORIC_WALLS).toContain(w);
      seen.add(w);
    }
    expect(seen.size).toBeGreaterThanOrEqual(3);
    for (let id = 0; id < 50; id++) {
      expect(HOUSE_WALLS).toContain(buildingSpec(id, { building: 'house' }, 8000).wall);
    }
    // outside the radius, tagged levels>3 central buildings do not become historic
    expect(HISTORIC_WALLS).not.toContain(buildingSpec(3, { building: 'yes', 'building:levels': '4' }, 400).wall);
  });

  it('other types', () => {
    expect(buildingSpec(1, { building: 'garages' }, 0).wall).toBe(MAT.WALL_GARAGE);
    expect(buildingSpec(1, { building: 'church' }, 0).wall).toBe(MAT.WALL_CHURCH);
    expect(buildingSpec(1, { building: 'warehouse' }, 0).wall).toBe(MAT.WALL_INDUSTRIAL);
    expect(buildingSpec(1, { building: 'retail' }, 9000).wall).toBe(MAT.WALL_MODERN);
    expect(buildingSpec(1, { building: 'school' }, 9000).wall).toBe(MAT.WALL_PUBLIC);
  });

  it('calibrates untagged residential footprints and never overrides explicit tags', () => {
    const slab = [[0, 0], [30, 0], [30, 6], [0, 6]] as const; // 60 x 12 m, 720 m²
    const tower = [[0, 0], [10, 0], [10, 10], [0, 10]] as const; // 20 x 20 m
    expect(estimateStoreys({ building: 'yes' }, 4000, 720, { ring: slab, residential: true })).toBe(5);
    expect(estimateStoreys({ building: 'yes' }, 4000, 400, { ring: tower, residential: true })).toBe(9);
    expect(estimateStoreys({ building: 'yes' }, 4000, 100, { ring: slab, residential: true })).toBe(2);
    const tagged = buildingSpec(88, { building: 'yes', 'building:levels': '9' }, 4000, 720, { ring: slab, residential: true });
    expect(tagged.levels).toBe(9);
    expect(tagged.hm).toBe(28);
    expect(tagged.heightHeuristic).toBe(false);
  });

  it('uses brick only for an explicit building:material tag', () => {
    expect(buildingSpec(1, { building: 'apartments', 'building:levels': '5', 'building:material': 'brick' }, 5000).wall).toBe(MAT.WALL_BRICK);
    expect(buildingSpec(1, { building: 'apartments', 'building:levels': '5', colour: 'red' }, 5000).wall).not.toBe(MAT.WALL_BRICK);
  });

  it('building:colour picks the nearest palette variant', () => {
    expect(nearestVariant('pink', HOUSE_WALLS)).toBe(MAT.WALL_HOUSE_PINK);
    expect(nearestVariant('#a9d2b4', HISTORIC_WALLS)).toBe(MAT.WALL_HISTORIC_MINT);
    expect(nearestVariant('nonsense', HOUSE_WALLS)).toBe(-1);
    expect(buildingSpec(5, { building: 'house', 'building:colour': 'blue' }, 9000).wall).toBe(MAT.WALL_HOUSE_BLUE);
  });

  it('all wall ids stay inside 25..39 for new styles and keep old ids', () => {
    expect([MAT.WALL_HOUSE, MAT.WALL_APART, MAT.WALL_INDUSTRIAL, MAT.WALL_CHURCH, MAT.WALL_PUBLIC]).toEqual([20, 21, 22, 23, 24]);
    for (const id of [MAT.WALL_KHRUSH, MAT.WALL_PANEL, MAT.WALL_STALIN, MAT.WALL_MODERN, MAT.WALL_GARAGE, ...HISTORIC_WALLS.slice(), ...HOUSE_WALLS.slice(1)]) {
      expect(id).toBeGreaterThanOrEqual(25);
      expect(id).toBeLessThanOrEqual(39);
    }
  });
});

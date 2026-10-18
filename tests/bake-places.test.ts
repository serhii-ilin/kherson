import { describe, expect, it } from 'vitest';
import { dedupePlaces, nudgeToWalkable, type Place } from '../tools/bake/places';

describe('bake places', () => {
  it('keeps one entry per settlement name+kind, preferring the first (the OSM node)', () => {
    const sorted: Place[] = [
      { name: 'Херсон', kind: 'city', x: 10269.7, z: 8828.9 },
      { name: 'Херсон', kind: 'city', x: 10273.3, z: 8036.3 },
      { name: 'Міст', kind: 'bridge', x: 100, z: 100 },
      { name: 'Міст', kind: 'bridge', x: 120, z: 100 }, // < 50 m: same bridge
      { name: 'Міст', kind: 'bridge', x: 5000, z: 100 }, // elsewhere: another bridge
    ];
    const out = dedupePlaces(sorted);
    expect(out.filter((p) => p.name === 'Херсон')).toEqual([sorted[0]]);
    expect(out.filter((p) => p.name === 'Міст').length).toBe(2);
  });

  it('snaps places in water to the nearest walkable cell', () => {
    const water = (cx: number): boolean => cx < 10; // cells x < 10 are water
    const p: Place = { name: 'Причал', kind: 'ferry_terminal', x: 6, z: 6 }; // cell 3
    const q = nudgeToWalkable(p, (cx) => !water(cx), 2, 30);
    expect(q.x).toBe(21); // cell 10 centre
    expect(Math.abs(q.z - 6)).toBeLessThanOrEqual(14); // within the 7-cell ring
    expect(nudgeToWalkable({ ...p, x: 50 }, (cx) => !water(cx), 2)).toEqual({ ...p, x: 50 });
    expect(nudgeToWalkable(p, () => false, 2, 5)).toBe(p);
  });
});

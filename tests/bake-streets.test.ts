import { describe, expect, it } from 'vitest';
import { collectStreets } from '../tools/bake/streets.ts';

const all = (): boolean => true;
const line = (tags: Record<string, string>, pts: [number, number][]) => ({ tags, pts });

describe('collectStreets', () => {
  it('merges the ways of one street into one entry on the street, facing along it', () => {
    const name = 'Грецька вулиця';
    const s = collectStreets(
      [
        line({ highway: 'residential', name }, [[0, 100], [100, 100]]),
        line({ highway: 'residential', name }, [[100, 100], [200, 100]]),
      ],
      all,
      2,
    );
    expect(s).toHaveLength(1);
    expect(s[0]!.kind).toBe('street');
    // middle of the street, in metres, on its centreline
    expect(s[0]!.x).toBeCloseTo(200, 0);
    expect(s[0]!.z).toBeCloseTo(200, 0);
    // the street runs east-west: yaw ±90°
    expect(Math.abs(s[0]!.yaw)).toBe(90);
  });

  it('splits one name used in distant parts of the city', () => {
    const name = 'Садова вулиця';
    const s = collectStreets(
      [line({ highway: 'residential', name }, [[0, 0], [50, 0]]), line({ highway: 'residential', name }, [[3000, 0], [3050, 0]])],
      all,
      2,
    );
    expect(s).toHaveLength(2);
  });

  it('skips unnamed, footway and link roads, and points outside the city', () => {
    const s = collectStreets(
      [
        line({ highway: 'footway', name: 'Алея' }, [[0, 0], [10, 0]]),
        line({ highway: 'primary_link', name: 'З’їзд' }, [[0, 0], [10, 0]]),
        line({ highway: 'residential' }, [[0, 0], [10, 0]]),
        line({ highway: 'residential', name: 'За містом' }, [[500, 0], [510, 0]]),
      ],
      (x) => x < 100,
      2,
    );
    expect(s).toHaveLength(0);
  });

  it('keeps former names for search, without the current name', () => {
    const s = collectStreets(
      [
        line({ highway: 'primary', name: 'проспект Незалежності', old_name: 'проспект Ушакова' }, [[0, 0], [0, 50]]),
        line(
          { highway: 'primary', name: 'проспект Незалежності', 'old_name:uk': 'проспект Ушакова;проспект Незалежності' },
          [[0, 50], [0, 100]],
        ),
      ],
      all,
      2,
    );
    expect(s[0]!.old).toEqual(['проспект Ушакова']);
    // north-south street
    expect([0, 180, -180]).toContain(s[0]!.yaw);
  });

  it('is deterministic', () => {
    const lines = [
      line({ highway: 'tertiary', name: 'Б' }, [[0, 0], [10, 5]]),
      line({ highway: 'tertiary', name: 'А' }, [[20, 0], [30, 5]]),
    ];
    const a = collectStreets(lines, all, 2);
    expect(collectStreets(lines, all, 2)).toEqual(a);
    expect(a.map((p) => p.name)).toEqual(['А', 'Б']);
  });
});

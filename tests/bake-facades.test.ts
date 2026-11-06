import { describe, expect, it, vi } from 'vitest';
import { buildFacadeRows, readFacadeRows } from '../tools/bake/facades.ts';
import { REGION_CM } from '../tools/bake/vectors.ts';
import { OSM_TYPE, type VBuilding, type VectorTile } from '../src/world/vector-format.ts';
import type { FacadeProfile } from '../src/mesh/facade-profile.ts';

function profile(key: string): FacadeProfile {
  return {
    key,
    label: 'Example row',
    sources: [],
    storeys: 3,
    wall: { colour: '#d8c7a8' },
    trim: { colour: '#efe7d8' },
    roof: { kind: 'flat', colour: '#8a7f6d' },
    windows: { shape: 'rect', widthM: 1.1, heightM: 1.7, surround: 'band', frame: '#f2efe8' },
    cornice: { profile: 'simple', heightM: 0.35, projectionM: 0.25 },
    edges: [{ edge: 0, pattern: 'wwwww', groundPattern: 'dwwsw' }],
  };
}

function building(id: number, heightCm = 1000, minHeightCm = 0, osmType?: number): VBuilding {
  return {
    id,
    rings: [Int32Array.from([100, 200, 500, 200, 500, 600, 100, 600])],
    heightCm,
    minHeightCm,
    levels: 3,
    wall: 1,
    roof: 1,
    roofShape: 0,
    name: -1,
    ...(osmType === undefined ? {} : { osmType }),
  };
}

function tile(rx: number, rz: number, buildings: VBuilding[]): VectorTile {
  return { rx, rz, strings: [], buildings, roads: [], areas: [], lines: [], points: [] };
}

describe('facade bake', () => {
  it('matches a way and converts its ring from region centimetres to world metres', () => {
    const result = buildFacadeRows([profile('w7')], [tile(2, 3, [building(7, 1234, 200)])]);
    expect(result.unmatched).toEqual([]);
    expect(result.rows).toHaveLength(1);
    const row = result.rows[0]!;
    expect(row.ring[0]).toEqual([(100 + 2 * REGION_CM) / 100, (200 + 3 * REGION_CM) / 100]);
    expect(row.ring[2]).toEqual([(500 + 2 * REGION_CM) / 100, (600 + 3 * REGION_CM) / 100]);
    expect(row.heightM).toBe(12.34);
    expect(row.minHeightM).toBe(2);
  });

  it('matches a relation separately from a way with the same id', () => {
    const relation = buildFacadeRows([profile('r42')], [tile(0, 0, [building(42, 900, 0, OSM_TYPE.RELATION)])]);
    expect(relation.rows).toHaveLength(1);
    const way = buildFacadeRows([profile('w42')], [tile(0, 0, [building(42, 900, 0, OSM_TYPE.RELATION)])]);
    expect(way.rows).toHaveLength(0);
    expect(way.unmatched).toEqual(['w42']);
  });

  it('warns about unmatched keys and skips them without failing', () => {
    const warn = vi.fn();
    const result = buildFacadeRows([profile('w999'), profile('w7')], [tile(0, 0, [building(7)])], warn);
    expect(result.rows.map((row) => row.profile.key)).toEqual(['w7']);
    expect(result.unmatched).toEqual(['w999']);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('w999');
  });

  it('is deterministic and sorts rows by key', () => {
    const tiles = [tile(0, 0, [building(20), building(10)])];
    const input = [profile('w20'), profile('w10')];
    const first = buildFacadeRows(input, tiles);
    const second = buildFacadeRows(input, tiles);
    expect(first.rows.map((row) => row.profile.key)).toEqual(['w10', 'w20']);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('fails the bake on an invalid descriptor row', () => {
    const invalid = profile('w7');
    invalid.storeys = 0;
    expect(() => buildFacadeRows([invalid], [tile(0, 0, [building(7)])])).toThrow(/validation failed/);
  });

  it('matches both hand-written example rows against the real snapshot keys', () => {
    const rows = readFacadeRows('data/facades');
    expect(rows.map((row) => row.key)).toEqual(['w1376950956', 'w262457726']);
    const result = buildFacadeRows(rows, [tile(0, 0, [building(1376950956), building(262457726)])]);
    expect(result.unmatched).toEqual([]);
    expect(result.rows).toHaveLength(2);
  });
});

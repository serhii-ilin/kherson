import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FacadeProfile } from '../src/mesh/facade-profile.ts';
import { validateFacadeFile, validateFacadeProfile } from '../src/mesh/facade-profile-validate.ts';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function base(): FacadeProfile {
  return {
    key: 'w1376950956',
    label: 'Example row',
    sources: [],
    storeys: 3,
    floorHeights: [4, 3.6, 3.6],
    plinthM: 0.6,
    wall: { colour: '#d8c7a8', pbr: 'STUCCO_ROUGH' },
    trim: { colour: '#efe7d8', pbr: 'STUCCO_SMOOTH' },
    roof: { kind: 'flat', colour: '#8a7f6d', pbr: 'ROOF_BITUMEN' },
    windows: {
      shape: 'rect', widthM: 1.1, heightM: 1.7, surround: 'band', frame: '#f2efe8', mixedFrames: true,
      ground: { shape: 'rect', widthM: 1.2, heightM: 2 },
    },
    rusticated: true,
    stringCourses: true,
    pilasters: { everyBays: 2, capital: 'plain' },
    cornice: { profile: 'simple', heightM: 0.35, projectionM: 0.25 },
    attic: { kind: 'parapet', heightM: 0.7 },
    balconies: [{ kind: 'iron', storeys: [1, 2], bays: [1, 3] }],
    edges: [{ edge: 0, pattern: 'wwwww', groundPattern: 'dwwsw' }],
  };
}

function errorsAfter(mutate: (row: FacadeProfile) => void): string[] {
  const row = clone(base());
  mutate(row);
  return validateFacadeProfile(row);
}

describe('validateFacadeProfile', () => {
  it('accepts the base row', () => {
    expect(validateFacadeProfile(base())).toEqual([]);
  });

  it('accepts the hand-written example file', () => {
    const rows = JSON.parse(
      fs.readFileSync(new URL('../data/facades/example.json', import.meta.url), 'utf8'),
    ) as FacadeProfile[];
    expect(rows.map((row) => row.key)).toEqual(['w1376950956', 'w262457726']);
    for (const row of rows) expect(validateFacadeProfile(row), row.key).toEqual([]);
    expect(validateFacadeFile(rows)).toEqual([]);
  });

  it('rejects malformed keys and duplicate keys', () => {
    for (const key of ['', 'x1', 'w0', 'w-1', 'wabc', 'r', 'W12']) {
      const row = clone(base());
      (row as { key: string }).key = key;
      expect(validateFacadeProfile(row).some((error) => error.startsWith('key:')), key).toBe(true);
    }
    const first = base();
    const second = clone(base());
    second.label = 'Other label';
    expect(validateFacadeFile([first, second]).some((error) => error.includes('duplicate key'))).toBe(true);
  });

  it('rejects storey counts outside 1..20 and invalid floor heights', () => {
    expect(errorsAfter((row) => { row.storeys = 0; }).some((error) => error.startsWith('storeys:'))).toBe(true);
    expect(errorsAfter((row) => { row.storeys = 21; }).some((error) => error.startsWith('storeys:'))).toBe(true);
    expect(errorsAfter((row) => { row.storeys = 2.5; }).some((error) => error.startsWith('storeys:'))).toBe(true);
    expect(errorsAfter((row) => { row.floorHeights = [2.4, 3.6]; })).toContain('floorHeights[0]: expected a number in 2.5..6');
    expect(errorsAfter((row) => { row.floorHeights = [4, 6.1]; })).toContain('floorHeights[1]: expected a number in 2.5..6');
    for (const storeys of [1, 20]) {
      const row = clone(base());
      row.storeys = storeys;
      row.balconies = [];
      expect(validateFacadeProfile(row).some((error) => error.startsWith('storeys:'))).toBe(false);
    }
  });

  it('rejects unknown bay codes and mismatched ground patterns', () => {
    expect(errorsAfter((row) => { row.edges[0]!.pattern = 'wwq'; })).toContain('edges[0].pattern: unknown bay code "q"');
    expect(errorsAfter((row) => { row.edges[0]!.pattern = ''; }).some((error) => error.includes('bay pattern'))).toBe(true);
    expect(errorsAfter((row) => { row.edges[0]!.groundPattern = 'dww'; })).toContain(
      'edges[0].groundPattern: length 3 does not match pattern length 5',
    );
    expect(errorsAfter((row) => { row.edges[0]!.groundPattern = 'dwwsq'; })).toContain(
      'edges[0].groundPattern: unknown bay code "q"',
    );
  });

  it('checks every colour field and PBR layer name', () => {
    expect(errorsAfter((row) => { row.wall.colour = '#fff'; })).toContain('wall.colour: expected a #rrggbb colour');
    expect(errorsAfter((row) => { row.trim.colour = 'red'; })).toContain('trim.colour: expected a #rrggbb colour');
    expect(errorsAfter((row) => { row.roof.colour = '#gggggg'; })).toContain('roof.colour: expected a #rrggbb colour');
    expect(errorsAfter((row) => { row.windows.frame = '#12345'; })).toContain('windows.frame: expected a #rrggbb colour');
    expect(errorsAfter((row) => { row.wall.pbr = 'NOPE'; })).toContain('wall.pbr: unknown PBR layer "NOPE"');
    expect(errorsAfter((row) => { row.trim.pbr = 'NOPE'; })).toContain('trim.pbr: unknown PBR layer "NOPE"');
    expect(errorsAfter((row) => { row.roof.pbr = 'NOPE'; })).toContain('roof.pbr: unknown PBR layer "NOPE"');
  });

  it('checks window and ground-window numeric ranges', () => {
    expect(errorsAfter((row) => { row.windows.widthM = 0.3; })).toContain('windows.widthM: expected a number in 0.4..3');
    expect(errorsAfter((row) => { row.windows.widthM = 3.1; })).toContain('windows.widthM: expected a number in 0.4..3');
    expect(errorsAfter((row) => { row.windows.heightM = 0.5; })).toContain('windows.heightM: expected a number in 0.6..4.5');
    expect(errorsAfter((row) => { row.windows.heightM = 4.6; })).toContain('windows.heightM: expected a number in 0.6..4.5');
    expect(errorsAfter((row) => { row.windows.ground!.widthM = 3.2; })).toContain(
      'windows.ground.widthM: expected a number in 0.4..3',
    );
    expect(errorsAfter((row) => { row.windows.ground!.heightM = 0.4; })).toContain(
      'windows.ground.heightM: expected a number in 0.6..4.5',
    );
  });

  it('checks photo crops and duplicate street edges', () => {
    expect(errorsAfter((row) => {
      row.edges[0]!.photo = { id: 'photo', u0: -0.1, u1: 0.8, v0: 0, v1: 1 };
    })).toContain('edges[0].photo.u0: expected a number in 0..1');
    expect(errorsAfter((row) => {
      row.edges[0]!.photo = { id: 'photo', u0: 0.8, u1: 0.2, v0: 0, v1: 1 };
    })).toContain('edges[0].photo: expected u0 < u1');
    expect(errorsAfter((row) => {
      row.edges[0]!.photo = { id: 'photo', u0: 0.1, u1: 0.8, v0: 0.9, v1: 0.9 };
    })).toContain('edges[0].photo: expected v0 < v1');
    expect(errorsAfter((row) => {
      row.edges.push({ edge: 0, pattern: 'wwwww' });
    })).toContain('edges[1].edge: duplicate edge index 0');
  });

  it('allows the reviewer-only confidence and notes fields', () => {
    const row = clone(base()) as FacadeProfile & { confidence: string; notes: string };
    row.confidence = 'low';
    row.notes = 'compare with the 2019 photo before building';
    expect(validateFacadeProfile(row)).toEqual([]);
  });
});

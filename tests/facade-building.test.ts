import { describe, expect, it, vi } from 'vitest';
import { buildFacadeBuilding, type FacadeBuildingRow } from '../src/landmarks/facade-building.ts';
import { FacadeLandmarks } from '../src/landmarks/facades.ts';
import type { FacadeProfile } from '../src/mesh/facade-profile.ts';
import type { LandmarkMeshData } from '../src/landmarks/types.ts';
import { PBR_LAYER_COUNT } from '../src/world/pbr-layers.ts';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function profile(): FacadeProfile {
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
    edges: [{ edge: 0, pattern: 'wwwwwww', groundPattern: 'wwwwwww' }],
  };
}

function row(p: FacadeProfile = profile()): FacadeBuildingRow {
  return {
    profile: p,
    // 25 m × 12 m footprint, open ring in world metres.
    ring: [[0, 0], [25, 0], [25, 12], [0, 12]],
    heightM: 12,
    minHeightM: 0,
  };
}

function expectDenseTexturedMesh(mesh: LandmarkMeshData): void {
  expect(mesh.kind).toBe('textured');
  const vertices = mesh.positions.length / 3;
  expect(vertices).toBeGreaterThan(0);
  expect(mesh.normals.length).toBe(mesh.positions.length);
  expect(mesh.colors.length).toBe(mesh.positions.length);
  expect(mesh.uvs!.length).toBe(vertices * 2);
  expect(mesh.pbr!.length).toBe(vertices);
  for (let i = 0; i < vertices; i++) {
    const length = Math.hypot(mesh.normals[i * 3]!, mesh.normals[i * 3 + 1]!, mesh.normals[i * 3 + 2]!);
    expect(length, `normal ${i}`).toBeCloseTo(1, 5);
    const layer = mesh.pbr![i]!;
    expect(Number.isInteger(layer)).toBe(true);
    expect(layer === -1 || (layer >= 0 && layer < PBR_LAYER_COUNT)).toBe(true);
    expect(Number.isFinite(mesh.uvs![i * 2]!) && Number.isFinite(mesh.uvs![i * 2 + 1]!)).toBe(true);
    for (let k = 0; k < 3; k++) {
      expect(mesh.colors[i * 3 + k]!).toBeGreaterThanOrEqual(0);
      expect(mesh.colors[i * 3 + k]!).toBeLessThanOrEqual(1);
    }
  }
  for (const index of mesh.indices) expect(index).toBeLessThan(vertices);
}

describe('buildFacadeBuilding', () => {
  it('reports the requested storeys and applies the ground pattern to storey 0 only', () => {
    const p = clone(profile());
    p.edges[0] = { edge: 0, pattern: 'wwww', groundPattern: 'ddww' };
    const build = buildFacadeBuilding(row(p), 2, 'near');
    expect(build.stats.storeys).toBe(3);
    const edge = build.stats.edges.find((item) => item.edge === 0)!;
    expect(edge.patterns).toEqual(['ddww', 'wwww', 'wwww']);
    expect(edge.bays).toBe(4);
    expect(edge.openings).toBe(4 + 4 + 4);
  });

  it('creates one opening per patterned bay per storey on every street edge', () => {
    const p = clone(profile());
    p.balconies = [];
    const build = buildFacadeBuilding(row(p), 0, 'near');
    const edge = build.stats.edges.find((item) => item.edge === 0)!;
    const nonBlank = (pattern: string): number => [...pattern].filter((code) => code !== 'b').length;
    expect(edge.openings).toBe(3 * nonBlank(p.edges[0]!.pattern));
    for (const other of build.stats.edges.filter((item) => item.edge !== 0)) {
      const bays = Math.floor(other.lengthM / 3.2);
      expect(other.bays).toBe(bays);
      expect(other.patterns).toEqual([ 'w'.repeat(bays), 'w'.repeat(bays), 'w'.repeat(bays) ]);
      expect(other.openings).toBe(bays * 3);
    }
  });

  it('orients the street wall outward and puts bay 0 on the left end for CW and CCW rings', () => {
    const ccw: [number, number][] = [[0, 0], [25, 0], [25, 12], [0, 12]];
    const cw: [number, number][] = [[0, 0], [0, 12], [25, 12], [25, 0]];
    const cases = [{ ring: ccw, streetEdge: 0 }, { ring: cw, streetEdge: 3 }];
    for (const { ring, streetEdge } of cases) {
      const p = clone(profile());
      p.balconies = [];
      p.edges = [{ edge: streetEdge, pattern: 'wwww' }];
      const build = buildFacadeBuilding({ ...row(p), ring }, 0, 'near');
      const edge = build.stats.edges.find((item) => item.edge === streetEdge)!;
      const a = ring[streetEdge]!;
      const b = ring[(streetEdge + 1) % ring.length]!;
      const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const cx = ring.reduce((sum, point) => sum + point[0], 0) / ring.length;
      const cz = ring.reduce((sum, point) => sum + point[1], 0) / ring.length;

      expect(edge.normal[0] * (mid[0] - cx) + edge.normal[1] * (mid[1] - cz)).toBeGreaterThan(0);

      // The viewer faces the wall, so their left is (-normal.z, normal.x).
      const left: [number, number] = [-edge.normal[1], edge.normal[0]];
      const leftEnd = a[0] * left[0] + a[1] * left[1] > b[0] * left[0] + b[1] * left[1] ? a : b;
      const rightEnd = leftEnd === a ? b : a;
      const bay0 = edge.bay0!;
      const distance = (point: [number, number]): number => Math.hypot(bay0[0] - point[0], bay0[1] - point[1]);
      expect(distance(leftEnd)).toBeLessThan(distance(rightEnd));
    }
  });

  it('ignores a parapet attic on a pitched roof', () => {
    const plain = clone(profile());
    plain.roof.kind = 'gable';
    plain.attic = { kind: 'none', heightM: 0 };
    plain.balconies = [];
    const withParapet = clone(plain);
    withParapet.attic = { kind: 'parapet', heightM: 0.7 };
    expect(buildFacadeBuilding(row(withParapet), 0, 'near').triangleCount).toBe(
      buildFacadeBuilding(row(plain), 0, 'near').triangleCount,
    );
  });

  it('keeps near and far triangle budgets for a 3-storey 25 m facade', () => {
    const near = buildFacadeBuilding(row(), 0, 'near');
    const far = buildFacadeBuilding(row(), 0, 'far');
    expect(near.triangleCount).toBeGreaterThan(0);
    expect(near.triangleCount).toBeLessThanOrEqual(15_000);
    expect(far.triangleCount).toBeGreaterThan(0);
    expect(far.triangleCount).toBeLessThanOrEqual(1_500);
  });

  it('is byte-deterministic for both levels of detail', () => {
    for (const lod of ['near', 'far'] as const) {
      const first = buildFacadeBuilding(row(), 3, lod);
      const second = buildFacadeBuilding(row(), 3, lod);
      expect(first.meshes.length).toBe(second.meshes.length);
      for (let i = 0; i < first.meshes.length; i++) {
        const a = first.meshes[i]!;
        const b = second.meshes[i]!;
        expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
        expect(Array.from(a.normals)).toEqual(Array.from(b.normals));
        expect(Array.from(a.uvs!)).toEqual(Array.from(b.uvs!));
        expect(Array.from(a.pbr!)).toEqual(Array.from(b.pbr!));
        expect(Array.from(a.indices)).toEqual(Array.from(b.indices));
      }
    }
  });

  it('emits dense textured meshes with unit normals and valid PBR layers', () => {
    for (const lod of ['near', 'far'] as const) {
      const build = buildFacadeBuilding(row(), 0, lod);
      expect(build.meshes.length).toBeGreaterThan(0);
      for (const mesh of build.meshes) expectDenseTexturedMesh(mesh);
    }
  });

  it('maps a photo edge to one textured mesh per photo id inside the crop', () => {
    const p = clone(profile());
    p.balconies = [];
    p.edges[0] = {
      edge: 0, pattern: 'wwwww', groundPattern: 'wwwww',
      photo: { id: 'demo', u0: 0.2, u1: 0.8, v0: 0.1, v1: 0.9 },
    };
    const build = buildFacadeBuilding(row(p), 0, 'near');
    const photos = build.meshes.filter((mesh) => mesh.photo !== undefined);
    expect(photos).toHaveLength(1);
    const photo = photos[0]!;
    expect(photo.photo).toBe('demo');
    expect(photo.kind).toBe('textured');
    expect(photo.uvs!.length).toBe((photo.positions.length / 3) * 2);
    for (let i = 0; i < photo.uvs!.length; i += 2) {
      expect(photo.uvs![i]!).toBeGreaterThanOrEqual(0.2 - 1e-5);
      expect(photo.uvs![i]!).toBeLessThanOrEqual(0.8 + 1e-5);
      expect(photo.uvs![i + 1]!).toBeGreaterThanOrEqual(0.1 - 1e-5);
      expect(photo.uvs![i + 1]!).toBeLessThanOrEqual(0.9 + 1e-5);
    }
    const edge = build.stats.edges.find((item) => item.edge === 0)!;
    expect(edge.photo).toBe(true);
    expect(edge.openings).toBe(0);
  });

  it('shares one photo mesh when two edges use the same photo id', () => {
    const p = clone(profile());
    p.balconies = [];
    p.edges = [
      { edge: 0, pattern: 'www', photo: { id: 'demo', u0: 0, u1: 0.5, v0: 0, v1: 1 } },
      { edge: 1, pattern: 'www', photo: { id: 'demo', u0: 0.5, u1: 1, v0: 0, v1: 1 } },
    ];
    const build = buildFacadeBuilding(row(p), 0, 'near');
    expect(build.meshes.filter((mesh) => mesh.photo === 'demo')).toHaveLength(1);
  });

  it('returns a collision prism that blocks only the building volume', () => {
    const build = buildFacadeBuilding(row(), 2, 'near');
    expect(build.surfaces).toHaveLength(1);
    const surface = build.surfaces[0]!;
    expect(surface.heightAt(12, 6)).toBeNull();
    expect(surface.blockedAt!(12, 6, 2.5)).toBe(true);
    expect(surface.blockedAt!(12, 6, 13.9)).toBe(true);
    expect(surface.blockedAt!(12, 6, 14)).toBe(false);
    expect(surface.blockedAt!(30, 6, 5)).toBe(false);
  });
});

describe('FacadeLandmarks', () => {
  it('fetches the baked rows once and turns each into a replacing landmark', async () => {
    const baked = row();
    const fetchJson = vi.fn(async (_url: string) => ({
      version: 1,
      rows: [{ profile: baked.profile, ring: baked.ring, heightM: baked.heightM, minHeightM: baked.minHeightM }],
    }));
    const facades = new FacadeLandmarks('/base/', fetchJson);
    await facades.ready;
    expect(fetchJson).toHaveBeenCalledTimes(1);
    expect(fetchJson.mock.calls[0]?.[0]).toContain('world/facades.json');

    const list = facades.landmarks();
    expect(list).toHaveLength(1);
    const landmark = list[0]!;
    expect(landmark.id).toBe('facade:w1376950956');
    expect(landmark.replaces).toEqual([{ type: 'way', id: 1376950956 }]);
    expect(landmark.anchor.x).toBeCloseTo(12.5, 5);
    expect(landmark.ready!({ groundAt: () => 5, quality: 'high' })).toBe(true);
    expect(landmark.ready!({ groundAt: () => null, quality: 'high' })).toBe(false);

    const build = landmark.build({ groundAt: () => 5, quality: 'high', lod: 'far' });
    expect(build.triangleCount).toBeGreaterThan(0);
    expect(build.triangleCount).toBeLessThanOrEqual(1_500);
    expect(build.surfaces[0]!.blockedAt!(12, 6, 6)).toBe(true);
  });

  it('is empty and quiet when the facade file is absent', async () => {
    const facades = new FacadeLandmarks('/base/', async () => {
      throw new Error('404');
    });
    await facades.ready;
    expect(facades.landmarks()).toEqual([]);
  });

  it('warns once when facades.json has an unknown version', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const fetchJson = vi.fn(async (_url: string) => ({ version: 2, rows: [] }));
      const first = new FacadeLandmarks('/base/', fetchJson);
      const second = new FacadeLandmarks('/base/', fetchJson);
      await Promise.all([first.ready, second.ready]);
      expect(first.landmarks()).toEqual([]);
      expect(second.landmarks()).toEqual([]);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain('unsupported version 2');
    } finally {
      warn.mockRestore();
    }
  });
});

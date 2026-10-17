import { describe, expect, it } from 'vitest';
import { FIELDS, REGION, VOXEL } from '../src/world/constants';
import { FEATURE_BRIDGE_DECK, FEATURE_TREE, cellIndex, type RegionData } from '../src/world/format';
import { meshChunk } from '../src/world/mesher';
import { MAT } from '../src/world/materials';

function flat(): RegionData {
  const cells = new Uint8Array(FIELDS * REGION * REGION);
  cells.fill(MAT.GRASS, 0, REGION * REGION);
  cells.fill(2, REGION * REGION, 2 * REGION * REGION);
  return { rx: 0, rz: 0, cells, features: [] };
}

function quadNormalDirs(m: ReturnType<typeof meshChunk>): void {
  // Winding check: geometric normal must match the declared normal.
  const p = m.positions;
  for (let i = 0; i < m.indices.length; i += 3) {
    const a = m.indices[i]! * 3;
    const b = m.indices[i + 1]! * 3;
    const c = m.indices[i + 2]! * 3;
    const e1 = [p[b]! - p[a]!, p[b + 1]! - p[a + 1]!, p[b + 2]! - p[a + 2]!];
    const e2 = [p[c]! - p[a]!, p[c + 1]! - p[a + 1]!, p[c + 2]! - p[a + 2]!];
    const n = [
      e1[1]! * e2[2]! - e1[2]! * e2[1]!,
      e1[2]! * e2[0]! - e1[0]! * e2[2]!,
      e1[0]! * e2[1]! - e1[1]! * e2[0]!,
    ];
    const dot = n[0]! * m.normals[a]! + n[1]! * m.normals[a + 1]! + n[2]! * m.normals[a + 2]!;
    expect(dot).toBeGreaterThan(0);
  }
}

describe('meshChunk', () => {
  it('flat chunk is a single top quad', () => {
    const m = meshChunk(flat(), 0, 0);
    expect(m.positions.length / 3).toBe(4);
    expect(m.indices.length).toBe(6);
    expect(m.normals[1]).toBe(1);
    quadNormalDirs(m);
  });

  it('single building cell yields top, ring of tops and 4 walls', () => {
    const r = flat();
    const x = 16;
    const z = 16;
    r.cells[cellIndex(2, x, z)] = 3;
    r.cells[cellIndex(3, x, z)] = MAT.WALL_HOUSE;
    r.cells[cellIndex(4, x, z)] = MAT.ROOF_RED;
    const m = meshChunk(r, 0, 0);
    // ground with a hole is split into 4 rectangles (greedy) + roof + 4 walls
    const quads = m.positions.length / 12;
    const walls = [...Array(quads).keys()].filter((q) => m.normals[q * 12 + 1] === 0).length;
    const tops = quads - walls;
    expect(walls).toBe(4);
    expect(tops).toBe(1 + 4);
    // wall spans from ground (y=2 voxels) to 5 voxels
    let maxY = 0;
    for (let i = 1; i < m.positions.length; i += 3) maxY = Math.max(maxY, m.positions[i]!);
    expect(maxY).toBe(5 * VOXEL);
    quadNormalDirs(m);
  });

  it('merges walls along a run', () => {
    const r = flat();
    for (let x = 4; x < 10; x++) {
      r.cells[cellIndex(2, x, 8)] = 4;
      r.cells[cellIndex(3, x, 8)] = MAT.WALL_APART;
      r.cells[cellIndex(4, x, 8)] = MAT.ROOF_GREY;
    }
    const m = meshChunk(r, 0, 0);
    const quads = m.positions.length / 12;
    const sideZ = [...Array(quads).keys()].filter((q) => Math.abs(m.normals[q * 12 + 2]!) === 1).length;
    expect(sideZ).toBe(2);
  });

  it('water next to water of equal height has no side faces', () => {
    const r = flat();
    for (let z = 0; z < 32; z++) {
      for (let x = 0; x < 32; x++) {
        r.cells[cellIndex(0, x, z)] = MAT.WATER;
        r.cells[cellIndex(1, x, z)] = 1;
      }
    }
    const m = meshChunk(r, 0, 0);
    expect(m.positions.length / 12).toBe(1); // lower than surrounding land, so only the top face
    quadNormalDirs(m);
  });

  it('features stay in bounds and render', () => {
    const r = flat();
    r.features.push(
      { type: FEATURE_TREE, param: 6, x: 10, z: 10 },
      { type: FEATURE_BRIDGE_DECK, param: 3, x: 20, z: 20 },
      { type: FEATURE_TREE, param: 6, x: 100, z: 100 }, // other chunk
    );
    const m = meshChunk(r, 0, 0);
    // top + trunk(5) + leaves(6) + deck(6)
    expect(m.positions.length / 12).toBe(1 + 5 + 6 + 6);
    const max = REGION * VOXEL;
    for (const v of m.positions) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(max);
    }
    quadNormalDirs(m);
  });

  it('all positions of a full chunk are within region bounds', () => {
    const r = flat();
    for (let i = 0; i < REGION * REGION; i += 7) r.cells[REGION * REGION * 2 + i] = i % 11;
    for (const [cx, cz] of [[0, 0], [7, 7], [3, 5]] as const) {
      const m = meshChunk(r, cx, cz);
      for (const v of m.positions) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(REGION * VOXEL + 100);
      }
    }
  });
});

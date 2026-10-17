import { describe, expect, it } from 'vitest';
import { FIELDS, REGION, VOXEL } from '../src/world/constants';
import { FEATURE_BRIDGE_DECK, FEATURE_TREE, cellIndex, type RegionData } from '../src/world/format';
import { edgeTops, meshChunk } from '../src/world/mesher';
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
    expect(m.positions.length / 12).toBe(0); // water tops live in the water mesh
    expect(m.water).not.toBeNull();
    expect(m.water!.indices.length / 6).toBe(16 * 16);
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

describe('meshChunk region seams', () => {
  function raised(top: number): RegionData {
    const r = flat();
    r.cells.fill(top, REGION * REGION, 2 * REGION * REGION);
    return r;
  }

  /** Counts quads that face along x lying on plane x. */
  function wallQuads(m: ReturnType<typeof meshChunk>, x: number, nx: number): number {
    let n = 0;
    for (let v = 0; v < m.positions.length / 3; v += 4) {
      if (m.normals[v * 3] !== nx) continue;
      let on = true;
      for (let k = 0; k < 4; k++) if (m.positions[(v + k) * 3] !== x) on = false;
      if (on) n++;
    }
    return n;
  }

  it('without neighbour info there is no wall at the region border', () => {
    expect(wallQuads(meshChunk(raised(6), 0, 0), 0, -1)).toBe(0);
  });

  it('a taller region gets a wall where its neighbour is lower', () => {
    const lowCol = new Uint8Array(REGION).fill(2);
    const m = meshChunk(raised(6), 0, 0, { nx: lowCol });
    expect(wallQuads(m, 0, -1)).toBe(1); // merged along z over the chunk
    const q = m.positions;
    let ymax = 0;
    for (let i = 1; i < q.length; i += 3) ymax = Math.max(ymax, q[i]!);
    expect(ymax).toBe(6 * VOXEL);
    quadNormalDirs(m);
  });

  it('the lower region emits nothing, and equal heights emit nothing', () => {
    const high = new Uint8Array(REGION).fill(6);
    expect(wallQuads(meshChunk(flat(), 7, 0, { px: high }), REGION * VOXEL, 1)).toBe(0);
    const same = new Uint8Array(REGION).fill(2);
    expect(wallQuads(meshChunk(flat(), 7, 0, { px: same }), REGION * VOXEL, 1)).toBe(0);
  });

  it('works on all four sides, and edgeTops reads the touching column/row', () => {
    const lower = new Uint8Array(REGION).fill(2);
    const r = raised(5);
    const m = meshChunk(r, 7, 7, { px: lower, pz: lower });
    expect(wallQuads(m, REGION * VOXEL, 1)).toBe(1);
    const nb = flat();
    nb.cells[REGION * REGION + 3 * REGION + 0] = 9; // x=0, z=3
    nb.cells[REGION * REGION + 0 * REGION + 7] = 8; // x=7, z=0
    expect(edgeTops(nb.cells, 'px')[3]).toBe(9);
    expect(edgeTops(nb.cells, 'pz')[7]).toBe(8);
    expect(edgeTops(nb.cells, 'nx')[3]).toBe(2);
  });
});

describe('water mesh', () => {
  /** Water band covering cells x in [8, 40) for the whole region height. */
  function river(): RegionData {
    const r = flat();
    for (let z = 0; z < REGION; z++) {
      for (let x = 8; x < 40; x++) {
        r.cells[cellIndex(0, x, z)] = MAT.WATER;
        r.cells[cellIndex(1, x, z)] = 1;
      }
    }
    return r;
  }

  it('emits a 4 m quad grid, no water tops in the main mesh, shore 0 at land and 1 far away', () => {
    const m = meshChunk(river(), 0, 0);
    const w = m.water!;
    expect(w).not.toBeNull();
    // chunk 0 spans cells 0..31; water cells 8..31 -> 12 blocks wide x 16 tall
    expect(w.indices.length / 6).toBe(12 * 16);
    expect(w.positions.length / 3).toBe(13 * 17);
    expect(w.shore.length).toBe(13 * 17);
    // no main-mesh top quad may lie at the water level over the river
    for (let v = 0; v < m.positions.length / 3; v += 4) {
      if (m.normals[v * 3 + 1] !== 1) continue;
      expect(m.positions[v * 3 + 1]).not.toBe(1 * VOXEL);
    }
    const shoreAt = (xm: number, zm: number): number => {
      for (let v = 0; v < w.positions.length / 3; v++) {
        if (w.positions[v * 3] === xm && w.positions[v * 3 + 2] === zm) return w.shore[v]!;
      }
      return NaN;
    };
    expect(shoreAt(8 * VOXEL, 16 * VOXEL)).toBe(0); // on the bank
    expect(shoreAt(24 * VOXEL, 16 * VOXEL)).toBe(1); // mid-river, >= 3 cells from either bank
  });

  it('far from land the shore is 1', () => {
    const r = river();
    for (let z = 0; z < REGION; z++) {
      for (let x = 8; x < 100; x++) {
        r.cells[cellIndex(0, x, z)] = MAT.WATER;
        r.cells[cellIndex(1, x, z)] = 1;
      }
    }
    const w = meshChunk(r, 1, 1).water!;
    let max = 0;
    for (const s of w.shore) max = Math.max(max, s);
    expect(max).toBe(1);
    const w0 = meshChunk(r, 0, 0).water!;
    const near = [...w0.shore].filter((s) => s === 0).length;
    expect(near).toBeGreaterThan(0);
  });

  it('border vertices coincide between neighbouring chunks', () => {
    const r = river();
    const a = meshChunk(r, 0, 0).water!;
    const b = meshChunk(r, 1, 0).water!;
    const border = 32 * VOXEL;
    const pick = (w: NonNullable<typeof a>): string[] => {
      const out: string[] = [];
      for (let v = 0; v < w.positions.length / 3; v++) {
        if (w.positions[v * 3] === border) out.push(`${w.positions[v * 3 + 1]},${w.positions[v * 3 + 2]},${w.shore[v]}`);
      }
      return out.sort();
    };
    expect(pick(a).length).toBeGreaterThan(0);
    expect(pick(a)).toEqual(pick(b));
  });

  it('chunks without water have none', () => {
    expect(meshChunk(flat(), 0, 0).water).toBeNull();
  });
});

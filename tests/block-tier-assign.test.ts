import { describe, expect, it } from 'vitest';
import { MAT } from '../src/world/materials';
import { packStruct } from '../src/world/format';
import { CHUNK, VOXEL } from '../src/world/constants';
import { G_GH, G_MAT, G_PLANES, G_RMAT, G_SH, G_SMAT, GM, GPLANE, GW } from '../src/fine/block-input';
import { TIER_R, TIER_W, generateBlockChunk, makeTierSnapshot } from '../src/fine/generate';
import { buildingTint } from '../src/fine/buildings';
import { hash } from '../tools/bake/building-style';
import { emptyTile } from './fine-util';
import { bld, rect } from './fine-buildings-util';

const CM = CHUNK * VOXEL; // 64 m

/** Coarse window of global chunk (gcx, 0) with a 14 x 6 cell building (x 50..78 m, z 20..32 m), 8 voxels high. */
function windowFor(gcx: number, tint: number): Uint8Array {
  const win = new Uint8Array(G_PLANES * GPLANE);
  win.fill(2, G_GH * GPLANE, (G_GH + 1) * GPLANE);
  win.fill(MAT.GRASS, G_MAT * GPLANE, (G_MAT + 1) * GPLANE);
  const cx0 = gcx * CHUNK - GM;
  for (let pz = 0; pz < GW; pz++) {
    for (let px = 0; px < GW; px++) {
      const cx = cx0 + px, cz = pz - GM;
      if (cx >= 25 && cx < 39 && cz >= 10 && cz < 16) {
        win[G_SH * GPLANE + pz * GW + px] = 8;
        win[G_SMAT * GPLANE + pz * GW + px] = packStruct(MAT.WALL_KHRUSH, tint);
        win[G_RMAT * GPLANE + pz * GW + px] = MAT.ROOF_GREY;
      }
    }
  }
  return win;
}

const building = bld(rect(50, 20, 78, 32), { heightCm: 1600, id: 4242 });
const tile = { ...emptyTile(), buildings: [building.b] };

function run(gcx: number, tierOn: number[]): ReturnType<typeof generateBlockChunk> {
  const tier = makeTierSnapshot(gcx, 0, (gx) => tierOn.includes(gx));
  return generateBlockChunk({ gcx, gcz: 0, win: windowFor(gcx, buildingTint(4242)), tier, tiles: [tile] });
}

/** Counts wall quads by kind: carved 1 m block faces (w >= 2) vs coarse 2 m faces (w < 2). */
function wallQuads(m: { walls: Float32Array }): { block: number; coarse: number } {
  let block = 0, coarse = 0;
  for (let q = 0; q < m.walls.length / 16; q++) {
    const id = m.walls[q * 16]!;
    if (id < 20 || id >= 40 || m.walls[q * 16 + 1]! <= 0) continue;
    if (m.walls[q * 16 + 3]! >= 2) block++; else coarse++;
  }
  return { block, coarse };
}

describe('block tier building assignment', () => {
  it('draws a straddling building as blocks only when all its chunks are in the tier', () => {
    const both = run(0, [0, 1]);
    const q = wallQuads(both);
    expect(q.block).toBeGreaterThan(20);
    expect(q.coarse).toBe(0); // the whole building is blocks: no coarse cells re-emitted
    expect(both.runs).toBeUndefined();
    expect(Array.from(both.deps!)).toEqual(expect.arrayContaining([1, 0]));
  });

  it('keeps it coarse in every chunk when a chunk it overlaps is outside the tier', () => {
    for (const gcx of [0, 1]) {
      const m = run(gcx, [gcx]); // the other chunk is not in the tier
      const q = wallQuads(m);
      expect(q.block, `chunk ${gcx}`).toBe(0);
      expect(q.coarse, `chunk ${gcx}`).toBeGreaterThan(0);
      expect(m.runs).toBeDefined();
      // the coarse walls carry the baked tint and a run
      let tinted = 0;
      for (let q2 = 0; q2 < m.walls.length / 16; q2++) {
        const id = m.walls[q2 * 16]!;
        if (id >= 20 && id < 40 && m.walls[q2 * 16 + 1]! > 0) {
          expect(Math.round((id - Math.floor(id + 0.02)) * 10)).toBe(buildingTint(4242));
          expect(m.runs![q2 * 8 + 1]).toBeGreaterThan(0);
          tinted++;
        }
      }
      expect(tinted).toBeGreaterThan(0);
      // physics: the coarse cells still block walkers (8 voxels = 16 m + 4 m ground)
      const lx = gcx === 0 ? 60 : 10; // inside the building (x 50..78 m)
      expect(m.tops[30 * 1 * 64 + lx]).toBeGreaterThan(0);
    }
  });

  it('is consistent: no building is drawn in both tiers across the two chunks', () => {
    // block faces and coarse faces of the same building never both appear in one assignment
    const a = wallQuads(run(0, [0, 1]));
    const b = wallQuads(run(1, [0, 1]));
    expect(a.coarse + b.coarse).toBe(0);
    const c = wallQuads(run(0, [0]));
    const d = wallQuads(run(1, [1]));
    expect(c.block + d.block).toBe(0);
  });

  it('tier snapshot window is centred on the chunk', () => {
    const t = makeTierSnapshot(7, 3, (x, z) => x === 8 && z === 3);
    expect(t.length).toBe(TIER_W * TIER_W);
    expect(t[TIER_R * TIER_W + TIER_R + 1]).toBe(1);
    expect(t.reduce((a, b) => a + b, 0)).toBe(1);
  });

  it('building tint matches the bake hash', () => {
    for (const id of [1, 42, 4242, 123456789, 0xffffffff, 3_000_000_001]) {
      expect(buildingTint(id >>> 0)).toBe(hash(id, 0x7177) >>> 30);
    }
    void CM;
  });
});

import { describe, expect, it } from 'vitest';
import { MAT } from '../src/world/materials';
import { ROOF } from '../src/world/vector-format';
import { BLOCK_PAD, BLOCK_WIN, BlockWindow, columnTops, meshBlocks } from '../src/fine/blocks';
import { VOL_XZ, VOL_Y } from '../src/fine/volume';
import { bld, groundFlat, meshOf, rect, topsOf, window } from './fine-buildings-util';
import type { ChunkMesh } from '../src/world/mesher';

/** Unit face cells "axis:sign:plane:u:v" covered by the quads of a mesh (each cell counted). */
function faceCells(m: ChunkMesh): Map<string, number> {
  const cells = new Map<string, number>();
  const quads = m.positions.length / 12;
  for (let q = 0; q < quads; q++) {
    const o = q * 12;
    const nx = m.normals[o]!, ny = m.normals[o + 1]!, nz = m.normals[o + 2]!;
    const a = Math.abs(nx) > 0.5 ? 0 : Math.abs(ny) > 0.5 ? 1 : 2;
    const sg = (a === 0 ? nx : a === 1 ? ny : nz) > 0 ? '+' : '-';
    const ta = (a + 1) % 3, tb = (a + 2) % 3;
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let v = 0; v < 4; v++) for (let k = 0; k < 3; k++) {
      const c = m.positions[o + v * 3 + k]!;
      lo[k] = Math.min(lo[k]!, c);
      hi[k] = Math.max(hi[k]!, c);
    }
    expect(lo[a]).toBe(hi[a]); // planar, axis aligned
    for (let u = lo[ta]!; u < hi[ta]!; u++) for (let v = lo[tb]!; v < hi[tb]!; v++) {
      const key = `${a}:${sg}:${lo[a]}:${u}:${v}`;
      cells.set(key, (cells.get(key) ?? 0) + 1);
    }
  }
  return cells;
}

/** The faces a brute-force walk over the inner columns says must exist (air next to solid). */
function expectedCells(w: BlockWindow, groundY?: Uint8Array): Set<string> {
  const out = new Set<string>();
  const S = BLOCK_WIN;
  const solid = (x: number, y: number, z: number): boolean =>
    y >= 0 && y < VOL_Y && x >= 0 && x < S && z >= 0 && z < S && w.mats[(y * S + z) * S + x] !== 0;
  for (let y = 0; y < VOL_Y; y++) for (let z = BLOCK_PAD; z < S - BLOCK_PAD; z++) for (let x = BLOCK_PAD; x < S - BLOCK_PAD; x++) {
    if (!solid(x, y, z)) continue;
    const lx = x - BLOCK_PAD, lz = z - BLOCK_PAD;
    if (!solid(x + 1, y, z)) out.add(`0:+:${lx + 1}:${y}:${lz}`);
    if (!solid(x - 1, y, z)) out.add(`0:-:${lx}:${y}:${lz}`);
    if (!solid(x, y + 1, z)) out.add(`1:+:${y + 1}:${lz}:${lx}`);
    if (!solid(x, y - 1, z) && !(groundY !== undefined && y <= groundY[z * S + x]!)) out.add(`1:-:${y}:${lz}:${lx}`);
    if (!solid(x, y, z + 1)) out.add(`2:+:${lz + 1}:${lx}:${y}`);
    if (!solid(x, y, z - 1)) out.add(`2:-:${lz}:${lx}:${y}`);
  }
  return out;
}

function expectWatertight(w: BlockWindow, groundY?: Uint8Array): void {
  const got = faceCells(meshOf(w, groundY));
  const want = expectedCells(w, groundY);
  for (const [k, n] of got) {
    expect(n, `face ${k} emitted ${n} times`).toBe(1); // no doubles, no overlaps
    expect(want.has(k), `face ${k} should not exist`).toBe(true); // nothing between solid blocks
  }
  for (const k of want) expect(got.has(k), `face ${k} is missing`).toBe(true); // every air/solid boundary
}

const straddle = [
  bld(rect(40, 8, 100, 22), { id: 11 }),
  bld(rect(30, 40, 90, 50), { id: 12, wall: MAT.WALL_STALIN, heightCm: 1800 }),
  bld(rect(60, 28, 80, 38), { id: 13, wall: MAT.WALL_HOUSE, heightCm: 700, roof: MAT.ROOF_RED }),
  bld(rect(20, 4, 36, 30), { id: 14, wall: MAT.WALL_CHURCH, heightCm: 2400, roof: MAT.ROOF_GOLD }),
];

describe('block mesher', () => {
  it('emits exactly the faces between air and solid, including on chunk borders', () => {
    for (const x0 of [0, 64]) {
      const w = window(x0, 0, straddle);
      expect(w.mats.some((m) => m !== 0)).toBe(true);
      expectWatertight(w);
      expectWatertight(w, groundFlat(4)); // ground-level undersides are skipped
    }
  });

  it('border faces agree: the east chunk meshes the same boundary as the west one', () => {
    const a = window(0, 0, straddle);
    const b = window(64, 0, straddle);
    // the margin columns of one window equal the neighbouring chunk's edge columns:
    // a covers world x -1..64 (index 0..65), b covers 63..128
    for (let y = 0; y < VOL_Y; y++) for (let z = 0; z < BLOCK_WIN; z++) {
      for (let k = 0; k < 2; k++) {
        expect(a.mats[(y * BLOCK_WIN + z) * BLOCK_WIN + 64 + k]).toBe(b.mats[(y * BLOCK_WIN + z) * BLOCK_WIN + k]);
      }
    }
    // so no face lies on the shared plane x = 64 between two solid blocks, and none is missing there
    const fa = faceCells(meshOf(a));
    const fb = faceCells(meshOf(b));
    for (const k of fa.keys()) if (k.startsWith('0:+:64:')) {
      const [, , , y, z] = k.split(':');
      expect(b.get(64, Number(y), Number(z))).toBe(0);
    }
    for (const k of fb.keys()) if (k.startsWith('0:-:0:')) {
      const [, , , y, z] = k.split(':');
      expect(a.get(63, Number(y), Number(z))).toBe(0);
    }
  });

  it('winds every triangle counter-clockwise around its declared normal', () => {
    const m = meshOf(window(0, 0, straddle));
    for (let t = 0; t < m.indices.length; t += 3) {
      const i = [m.indices[t]!, m.indices[t + 1]!, m.indices[t + 2]!];
      const p = i.map((k) => [m.positions[k * 3]!, m.positions[k * 3 + 1]!, m.positions[k * 3 + 2]!]);
      const e1 = [p[1]![0]! - p[0]![0]!, p[1]![1]! - p[0]![1]!, p[1]![2]! - p[0]![2]!];
      const e2 = [p[2]![0]! - p[0]![0]!, p[2]![1]! - p[0]![1]!, p[2]![2]! - p[0]![2]!];
      const c = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
      const n = [m.normals[i[0]! * 3]!, m.normals[i[0]! * 3 + 1]!, m.normals[i[0]! * 3 + 2]!];
      expect(c[0]! * n[0]! + c[1]! * n[1]! + c[2]! * n[2]!).toBeGreaterThan(0);
    }
  });

  it('tags wall faces as carved and glass faces for the shader', () => {
    const m = meshOf(window(0, 0, straddle));
    let carved = 0, glass = 0;
    for (let v = 0; v < m.positions.length / 3; v++) {
      const id = m.walls[v * 4]!, w = m.walls[v * 4 + 3]!;
      if (id >= 20 && id <= 39) { expect(w).toBeGreaterThanOrEqual(2); carved++; }
      if (id === MAT.GLASS) glass++;
    }
    expect(carved).toBeGreaterThan(0);
    expect(glass).toBeGreaterThan(0);
  });

  it('is byte-identical for the same input', () => {
    const a = meshOf(window(0, 0, straddle));
    const b = meshOf(window(0, 0, straddle));
    for (const k of ['positions', 'normals', 'colors', 'walls', 'indices'] as const) {
      expect(Buffer.from(a[k].buffer).equals(Buffer.from(b[k].buffer))).toBe(true);
    }
  });

  it('keeps a 5-storey 60 x 12 m khrushchevka within 4k triangles', () => {
    const w = window(0, 0, [bld(rect(2, 20, 62, 32), { heightCm: 1600 })]);
    const m = meshOf(w, groundFlat(4));
    const tris = m.indices.length / 3;
    // eslint-disable-next-line no-console
    console.log(`khrushchevka 60x12x5: ${tris} triangles`);
    expect(tris).toBeLessThanOrEqual(3800); // 3962 before the AO-bilinear merge + three-cover greedy (see blocks.ts)
    expect(tris).toBeGreaterThan(500);
  });

  it('meshes bigger styles in a sane budget', () => {
    for (const [wall, h] of [[MAT.WALL_PANEL, 2800], [MAT.WALL_STALIN, 1800], [MAT.WALL_HISTORIC, 1100], [MAT.WALL_MODERN, 1500]] as const) {
      const w = window(0, 0, [bld(rect(2, 20, 62, 32), { wall, heightCm: h, levels: 0 })]);
      const tris = meshOf(w, groundFlat(4)).indices.length / 3;
      // eslint-disable-next-line no-console
      console.log(`${wall} ${h / 100} m 60x12: ${tris} triangles`);
      expect(tris).toBeLessThan(9000);
    }
    void ROOF;
  });
});

describe('physics column tops', () => {
  it('uses the building column top, ignoring open-air overhangs but keeping piers and ramps', () => {
    const S = BLOCK_WIN;
    const mats = new Uint8Array(S * S * VOL_Y);
    const foot = new Uint8Array(S * S);
    const set = (x: number, y: number, z: number, m: number): void => { mats[(y * S + z) * S + x] = m; };
    // building column with a balcony slab hanging beside it
    for (let y = 4; y < 20; y++) set(10, y, 10, MAT.WALL_KHRUSH);
    foot[10 * S + 10] = 1;
    set(11, 12, 10, MAT.CONCRETE);
    // pier from the ground to a deck
    for (let y = 0; y < 12; y++) set(20, y, 20, MAT.CONCRETE);
    // deck over open air, canopy over a door
    set(21, 11, 20, MAT.BRIDGE);
    set(30, 6, 30, MAT.METAL);
    // ramp block on the ground
    set(40, 4, 40, MAT.BRIDGE);
    const tops = columnTops(mats, S, BLOCK_PAD, foot, groundFlat(4));
    const at = (x: number, z: number): number => tops[(z - BLOCK_PAD) * VOL_XZ + (x - BLOCK_PAD)]!;
    expect(at(10, 10)).toBe(20);
    expect(at(11, 10)).toBe(0); // balcony: ignored
    expect(at(20, 20)).toBe(12); // pier
    expect(at(21, 20)).toBe(0); // deck above open air: the coarse deck handles it
    expect(at(30, 30)).toBe(0); // canopy
    expect(at(40, 40)).toBe(5); // ground-supported
    void topsOf;
  });
});

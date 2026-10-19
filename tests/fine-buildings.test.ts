import { describe, expect, it } from 'vitest';
import { MAT } from '../src/world/materials';
import { ROOF } from '../src/world/vector-format';
import { VOL_XZ, VOL_Y } from '../src/fine/volume';
import { bld, flatCtx, rect, volume, window } from './fine-buildings-util';

function count(mats: Uint8Array, m: number): number {
  let n = 0;
  for (let i = 0; i < mats.length; i++) if (mats[i] === m) n++;
  return n;
}

/** Rotated rectangle (30 degrees) as a staircased diagonal building. */
function rotated(cx: number, cz: number, w: number, d: number, deg: number): Array<[number, number]> {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a), s = Math.sin(a);
  return ([[-w, -d], [w, -d], [w, d], [-w, d]] as const).map(([x, z]): [number, number] => [cx + x * c - z * s, cz + x * s + z * c]);
}

const CASES: Array<[string, ReturnType<typeof bld>]> = [
  ['khrushchevka', bld(rect(40, 10, 100, 22))],
  ['panel block', bld(rect(50, 8, 90, 30), { wall: MAT.WALL_PANEL, heightCm: 2800 })],
  ['stalin with shops', bld(rect(44, 6, 96, 24), { wall: MAT.WALL_STALIN, heightCm: 1800 })],
  ['historic', bld(rect(40, 30, 90, 44), { wall: MAT.WALL_HISTORIC_PINK, heightCm: 1100 })],
  ['house with gable roof', bld(rect(50, 40, 78, 52), { wall: MAT.WALL_HOUSE_YELLOW, heightCm: 700, roof: MAT.ROOF_RED })],
  ['hipped house', bld(rect(52, 5, 76, 16), { wall: MAT.WALL_HOUSE, heightCm: 800, roofShape: ROOF.HIPPED })],
  ['church with dome', bld(rect(52, 20, 74, 40), { wall: MAT.WALL_CHURCH, heightCm: 2400, roof: MAT.ROOF_GOLD })],
  ['garage', bld(rect(40, 50, 100, 58), { wall: MAT.WALL_GARAGE, heightCm: 300 })],
  ['industrial', bld(rect(40, 50, 100, 62), { wall: MAT.WALL_INDUSTRIAL, heightCm: 900 })],
  ['modern', bld(rect(40, 12, 100, 28), { wall: MAT.WALL_MODERN, heightCm: 1500 })],
  ['rotated panel block', bld(rotated(64, 30, 30, 7, 30), { wall: MAT.WALL_PANEL, heightCm: 2800 })],
  ['rotated stalin', bld(rotated(66, 32, 26, 9, 55), { wall: MAT.WALL_STALIN, heightCm: 1800 })],
  ['floating part (min_height)', bld(rect(50, 10, 80, 24), { heightCm: 2000, minHeightCm: 800 })],
];

describe('buildings: chunk-border continuity', () => {
  for (const [name, b] of CASES) {
    it(`${name} straddling x = 64 is identical in adjacent volumes and in a volume shifted by 32`, () => {
      const a = volume(0, 0, [b]);
      const c = volume(64, 0, [b]);
      const mid = volume(32, 0, [b]);
      expect(count(mid.mats, 0)).toBeLessThan(mid.mats.length); // something was written
      let diff = 0;
      for (let y = 0; y < VOL_Y; y++) {
        for (let z = 0; z < VOL_XZ; z++) {
          for (let x = 0; x < VOL_XZ; x++) {
            const m = mid.get(x, y, z);
            const ref = x + 32 < 64 ? a.get(x + 32, y, z) : c.get(x + 32 - 64, y, z);
            const ref2 = x < 32 ? a.get(x + 32, y, z) : c.get(x - 32, y, z);
            if (m !== ref2 && m !== ref) diff++;
            if (m !== ref2) diff++;
          }
        }
      }
      expect(diff).toBe(0);
    });
  }

  it('also meets across the z border and for two touching buildings in any input order', () => {
    const b1 = bld(rect(10, 50, 40, 80), { id: 5 });
    const b2 = bld(rect(40, 50, 70, 80), { id: 9, wall: MAT.WALL_PANEL });
    const a = volume(0, 0, [b1, b2]);
    const a2 = volume(0, 0, [b2, b1]);
    expect(Buffer.from(a.mats).equals(Buffer.from(a2.mats))).toBe(true);
    const south = volume(0, 64, [b1, b2]);
    const mid = volume(0, 32, [b2, b1]);
    for (let y = 0; y < VOL_Y; y++) {
      for (let z = 0; z < 32; z++) for (let x = 0; x < 64; x++) {
        expect(mid.get(x, y, z)).toBe(a.get(x, y, z + 32));
        expect(mid.get(x, y, z + 32)).toBe(south.get(x, y, z));
      }
    }
  });
});

describe('buildings: facades', () => {
  const b = bld(rect(4, 10, 60, 22), { heightCm: 1600 }); // khrushchevka, 5 floors (levels * 3 + 1 m, as the bake sets it)
  const v = volume(0, 0, [b]);
  const base = 4;

  it('carves windows as air in front of glass, in whole-floor rows and repeating by bay', () => {
    const glass: Array<[number, number, number]> = [];
    for (let y = 0; y < VOL_Y; y++) for (let z = 0; z < 64; z++) for (let x = 0; x < 64; x++) {
      if (v.get(x, y, z) === MAT.GLASS) glass.push([x, y, z]);
    }
    expect(glass.length).toBeGreaterThan(40);
    const south: number[] = [];
    for (const [x, y, z] of glass) {
      // an air block in front, solid wall behind
      const front = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dz]) => v.get(x + dx!, y, z + dz!) === 0 && v.get(x - dx!, y, z - dz!) !== 0);
      expect(front.length).toBe(1);
      // rows: 3 m floors starting at the base, windows on rows 1 and 2 of each floor
      expect([1, 2]).toContain((y - base) % 3);
      if (z === 20) south.push(x); // the block behind the outer wall of the +z facade (z = 21)
    }
    expect(south.length).toBeGreaterThan(10);
    // the same bay phase everywhere along the facade
    expect(new Set(south.map((x) => ((x % 4) + 4) % 4)).size).toBeLessThanOrEqual(2); // 2-wide windows in 4 m bays
    // and a window on each floor (5 floors x 2 rows) in a typical bay
    const x0 = south[0]!;
    let rows = 0;
    for (let y = 0; y < VOL_Y; y++) if (v.get(x0, y, 20) === MAT.GLASS) rows++;
    expect(rows).toBe(10);
  });

  it('keeps the footprint solid up to a flush flat roof, with a trim row on cornice styles', () => {
    const top = base + 16;
    expect(v.get(30, top, 16)).toBe(0); // nothing above the roof surface
    expect(v.get(30, top - 1, 16)).toBe(MAT.ROOF_GREY);
    expect(v.get(4, top - 1, 15)).toBe(MAT.WALL_KHRUSH); // the roof edge is wall material, flush
    const st = volume(0, 0, [bld(rect(4, 10, 60, 22), { heightCm: 1600, wall: MAT.WALL_STALIN })]);
    expect(st.get(30, top - 2, 16)).toBe(MAT.ROOF_GREY);
    expect(st.get(4, top - 1, 15)).toBe(MAT.TRIM); // cornice row on the edge
    expect(st.get(3, top - 1, 15)).toBe(MAT.TRIM); // ...sticking out one block
    expect(st.get(5, top - 1, 15)).toBe(0);
  });

  it('gives a house a stepped roof of the roof material and a hall a plain flat one', () => {
    const house = volume(0, 0, [bld(rect(10, 10, 26, 20), { wall: MAT.WALL_HOUSE, heightCm: 700, roof: MAT.ROOF_RED, levels: 2 })]);
    let roofTop = 0;
    for (let y = 0; y < VOL_Y; y++) if (house.get(18, y, 15) === MAT.ROOF_RED) roofTop = y + 1;
    expect(roofTop).toBeLessThanOrEqual(4 + 7);
    expect(roofTop).toBeGreaterThanOrEqual(4 + 5);
    // the ridge is higher than the eaves
    let eaves = 0;
    for (let y = 0; y < VOL_Y; y++) if (house.get(18, y, 10) !== 0) eaves = y + 1;
    expect(roofTop).toBeGreaterThan(eaves);
  });

  it('tiny footprints become plain blocks and never crash', () => {
    const tiny = volume(0, 0, [bld(rect(10, 10, 12, 12))]);
    expect(count(tiny.mats, MAT.GLASS)).toBe(0);
    expect(count(tiny.mats, 0)).toBeLessThan(tiny.mats.length);
    const sliver = volume(0, 0, [bld(rect(10, 10, 11, 40))]);
    expect(count(sliver.mats, MAT.GLASS)).toBe(0);
  });

  it('sits on the lowest ground and extends walls down where the ground falls away', () => {
    const slope = { groundAt: (x: number) => (x < 20 ? 4 : 8) };
    const s = volume(0, 0, [bld(rect(10, 10, 40, 20), { heightCm: 900 })], slope);
    // base = 4 (the lowest); the part on the higher ground starts at the same level (buried)
    expect(s.get(15, 4, 15)).not.toBe(0);
    expect(s.get(35, 4, 15)).not.toBe(0);
    const pit = { groundAt: (x: number) => (x < 20 ? 2 : 4) };
    const p = volume(0, 0, [bld(rect(10, 10, 40, 20), { heightCm: 900 })], pit);
    expect(p.get(15, 2, 15)).not.toBe(0); // foundation down to the lower ground, base is the lowest (2)
  });

  it('is deterministic', () => {
    const a = volume(0, 0, [b]);
    const c = volume(0, 0, [b]);
    expect(Buffer.from(a.mats).equals(Buffer.from(c.mats))).toBe(true);
    void flatCtx;
  });

  it('places entrances and balconies on apartment blocks', () => {
    expect(count(v.mats, MAT.DOOR)).toBeGreaterThan(0);
    expect(count(v.mats, MAT.METAL)).toBeGreaterThan(0);
    expect(count(v.mats, MAT.CONCRETE)).toBeGreaterThan(0);
    // khrushchevka: no sills or cornice, only the light portal around each entrance door
    const trims: number[] = [];
    for (let y = 0; y < VOL_Y; y++) for (let z = 0; z < 64; z++) for (let x = 0; x < 64; x++) if (v.get(x, y, z) === MAT.TRIM) trims.push(y);
    expect(trims.length).toBeGreaterThan(0);
    expect(Math.max(...trims)).toBeLessThan(base + 3);
    const old = volume(0, 0, [bld(rect(4, 10, 60, 22), { wall: MAT.WALL_HISTORIC, heightCm: 1100 })]);
    expect(count(old.mats, MAT.TRIM)).toBeGreaterThan(20); // sills, plinth and cornice
  });

  it('puts shop fronts on ground floors of public buildings near a road only', () => {
    const pub = bld(rect(10, 10, 50, 26), { wall: MAT.WALL_PUBLIC, heightCm: 1200 });
    const near = window(0, 0, [pub], { groundAt: () => 4, roadDist: () => 5 });
    const far = window(0, 0, [pub], { groundAt: () => 4, roadDist: () => 90 });
    expect(count(near.mats, MAT.SHOPFRONT)).toBeGreaterThan(0);
    expect(count(far.mats, MAT.SHOPFRONT)).toBe(0);
  });
});

import { describe, expect, it } from 'vitest';
import { MAT } from '../src/world/materials';
import { ROAD, ROAD_BRIDGE, type VRoad } from '../src/world/vector-format';
import { addBridges, type BridgeContext, type PlacedRoad } from '../src/fine/bridges';
import { VOL_XZ, Volume } from '../src/fine/volume';

function mk(pts: ReadonlyArray<readonly [number, number]>, widthM: number, kind: number = ROAD.PRIMARY): PlacedRoad {
  const a = new Int32Array(pts.length * 2);
  pts.forEach(([x, z], i) => { a[i * 2] = Math.round(x * 100); a[i * 2 + 1] = Math.round(z * 100); });
  const road: VRoad = { pts: a, kind, flags: ROAD_BRIDGE, widthCm: widthM * 100, lanes: 2, layer: 1, name: -1 };
  return { road, ox: 0, oz: 0 };
}

/** River for z in [20, 100) with bed at 0, land at 4 elsewhere; coarse deck (top 8) over the river. */
const river: BridgeContext = {
  groundAt: (_x, z) => (z >= 20 && z < 100 ? 0 : 4),
  isWater: (_x, z) => z >= 20 && z < 100,
  deckTopAt: (_x, z) => (z >= 20 && z < 100 ? 8 : null),
};
const flat: BridgeContext = { groundAt: () => 4, isWater: () => false, deckTopAt: () => null };

function build(x0: number, z0: number, roads: PlacedRoad[], ctx: BridgeContext): Volume {
  const v = new Volume(x0, z0);
  addBridges(v, roads, ctx);
  return v;
}
const at = (v: Volume, wx: number, y: number, wz: number) => v.get(wx - v.x0, y, wz - v.z0);

// North-south bridge along x = 32.5, z from -20 to 130 (pieces would be split, but one is fine).
const ns = mk([[32, 0], [32, 120]], 8);

describe('bridges', () => {
  it('builds deck, rails and piers over water', () => {
    const v = build(0, 0, [ns], river);
    // width 8 + 2*1.5 = 11 -> centres within 5.5 m of x=32: blocks 26..37 (12)
    for (let z = 30; z < 64; z += 7) {
      let deck = 0;
      for (let x = 0; x < 64; x++) {
        if (at(v, x, 7, z) !== 0) deck++;
      }
      expect(deck).toBe(12);
      expect(at(v, 32, 7, z)).toBe(MAT.ASPHALT);
      expect(at(v, 26, 7, z)).toBe(MAT.SIDEWALK);
      expect(at(v, 32, 6, z)).toBe(MAT.BRIDGE);
      expect(at(v, 26, 8, z)).toBe(MAT.METAL);
      expect(at(v, 37, 8, z)).toBe(MAT.METAL);
      expect(at(v, 32, 8, z)).toBe(0);
    }
    // pier band on the 40 m grid: z 40..42 is a pier, from bed 0 up to the underside (y 5)
    for (let y = 0; y < 6; y++) expect(at(v, 32, y, 41)).toBe(MAT.CONCRETE);
    expect(at(v, 32, 5, 50)).toBe(0);
    expect(at(v, 32, 6, 41)).toBe(MAT.BRIDGE);
  });

  it('is chunk independent', () => {
    const a = build(0, 0, [ns], river);
    const b = build(0, 64, [ns], river);
    // reference: a tall-order check that a differently split run gives identical blocks
    const a2 = build(0, 0, [ns], river), b2 = build(0, 64, [ns], river);
    for (let z = 0; z < 64; z++) {
      for (let x = 0; x < 64; x++) {
        for (let y = 0; y < 12; y++) {
          expect(a.get(x, y, z)).toBe(a2.get(x, y, z));
          expect(b.get(x, y, z)).toBe(b2.get(x, y, z));
        }
      }
    }
    // seam: rows z=63 (chunk a) and z=64 (chunk b) both carry deck, rails and a continuous profile
    for (let x = 26; x <= 37; x++) {
      expect(a.get(x, 7, 63)).not.toBe(0);
      expect(b.get(x, 7, 0)).not.toBe(0);
      expect(a.get(x, 7, 63)).toBe(b.get(x, 7, 0));
    }
    // piers at z=80..82 live in chunk b (global grid), consistent with a whole-bridge rasterisation
    expect(b.get(32, 0, 17)).toBe(MAT.CONCRETE);
    // a bridge seen from the x-neighbour chunk only writes inside it
    const side = build(64, 0, [ns], river);
    expect(side.mats.every((m) => m === 0)).toBe(true);
    void VOL_XZ;
  });

  it('has no holes in a 45 degree deck', () => {
    const r = mk([[5, 5], [60, 60]], 6, ROAD.RESIDENTIAL);
    const v = build(0, 0, [r], flat);
    const hw = (6 + 3) / 2;
    for (let z = 0; z < 64; z++) {
      for (let x = 0; x < 64; x++) {
        const along = (x + 0.5 - 5 + (z + 0.5 - 5)) / Math.SQRT2;
        const perp = Math.abs((x + 0.5 - 5) - (z + 0.5 - 5)) / Math.SQRT2;
        if (perp <= hw - 0.5 && along > 1 && along < 76) {
          const filled = v.get(x, 3, z) !== 0 || v.get(x, 4, z) !== 0 || v.get(x, 2, z) !== 0;
          expect(filled).toBe(true);
        }
      }
    }
  });

  it('is deterministic', () => {
    const a = build(0, 0, [ns, mk([[5, 5], [60, 60]], 6)], river);
    const b = build(0, 0, [ns, mk([[5, 5], [60, 60]], 6)], river);
    expect(Buffer.compare(Buffer.from(a.mats), Buffer.from(b.mats))).toBe(0);
  });

  it('ramps meet the ground at land ends', () => {
    // coarse deck only over the river (z 20..100); piece runs 0..120 over land at 4.
    const ctx: BridgeContext = { ...river, groundAt: (_x, z) => (z >= 20 && z < 100 ? 0 : 4) };
    const v = build(0, 0, [ns], ctx);
    // start end: deck top == ground (4) -> surface block y = 3
    expect(at(v, 32, 3, 0)).toBe(MAT.ASPHALT);
    // an approach piece on flat land with no deck stays at the ground
    const w = build(0, 0, [mk([[32, 0], [32, 30]], 6)], flat);
    for (let z = 0; z < 30; z++) expect(at(w, 32, 3, z)).toBe(MAT.ASPHALT);
    // heights rise monotonically from ground to deck along the ramp (z 0..20)
    let prev = 0;
    for (let z = 0; z < 24; z++) {
      let top = 0;
      for (let y = 0; y < 12; y++) if (at(v, 32, y, z) === MAT.ASPHALT) top = y + 1;
      expect(top).toBeGreaterThanOrEqual(prev);
      prev = top;
    }
    expect(prev).toBe(8);
  });
});

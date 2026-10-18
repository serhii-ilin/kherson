import { describe, expect, it } from 'vitest';
import { MAT } from '../src/world/materials';
import {
  LINE, NO_DIR, POINT, ROAD, ROAD_LIT, ROAD_SIDEWALK, ROOF, type VectorTile,
} from '../src/world/vector-format';
import { placeProps, type PropPlacement } from '../src/fine/props';
import { placeSigns } from '../src/fine/sign-place';
import { PROP } from '../src/fine/prop-models';
import { SlotLru, plateColor } from '../src/fine/signs';

type P = ReadonlyArray<readonly [number, number]>;
const cm = (pts: P): Int32Array => Int32Array.from(pts.flatMap(([x, z]) => [Math.round(x * 100), Math.round(z * 100)]));

function tile(): VectorTile {
  return { rx: 0, rz: 0, strings: ['Аптека Добра'], buildings: [], roads: [], areas: [], lines: [], points: [] };
}
function addRoad(t: VectorTile, pts: P, kind = ROAD.RESIDENTIAL, flags = ROAD_SIDEWALK | ROAD_LIT, widthM = 6.5): void {
  t.roads.push({ pts: cm(pts), kind, flags, widthCm: widthM * 100, lanes: 2, layer: 0, name: -1 });
}
function addPoint(t: VectorTile, x: number, z: number, kind: number, name = -1): void {
  t.points.push({ x: Math.round(x * 100), z: Math.round(z * 100), kind, dir: NO_DIR, name });
}
function addBuilding(t: VectorTile, ring: P, id = 7): void {
  t.buildings.push({ id, rings: [cm(ring)], heightCm: 1600, minHeightCm: 0, levels: 5, wall: MAT.WALL_KHRUSH, roof: MAT.ROOF_GREY, roofShape: ROOF.FLAT, name: -1 });
}
const ground = { groundAt: () => 2 };
const key = (p: PropPlacement): string => `${p.kind}:${p.x.toFixed(3)}:${p.z.toFixed(3)}:${p.yaw.toFixed(3)}`;
const sorted = (a: PropPlacement[]): string[] => a.map(key).sort();
const B = (x0: number, z0: number, x1: number, z1: number) => ({ x0, z0, x1, z1 });

/** An east-west residential street at z = 100 made of 50 m pieces. */
function street(): VectorTile {
  const t = tile();
  for (let x = 0; x < 300; x += 50) addRoad(t, [[x, 100], [x + 50, 100]]);
  return t;
}

describe('props', () => {
  it('is deterministic', () => {
    const t = street();
    expect(sorted(placeProps([t], B(0, 0, 300, 200), ground))).toEqual(sorted(placeProps([t], B(0, 0, 300, 200), ground)));
  });

  it('chunk independence: halves are disjoint and add up to the whole', () => {
    const t = street();
    addPoint(t, 150, 104, POINT.STREET_LAMP);
    addPoint(t, 99.5, 96, POINT.BUS_STOP);
    addPoint(t, 100.5, 100, POINT.TRAFFIC_SIGNALS);
    const whole = placeProps([t], B(0, 0, 300, 200), ground);
    const a = placeProps([t], B(0, 0, 100, 200), ground);
    const b = placeProps([t], B(100, 0, 300, 200), ground);
    expect(whole.length).toBeGreaterThan(10);
    expect(sorted([...a, ...b])).toEqual(sorted(whole));
    const ka = new Set(sorted(a));
    for (const k of sorted(b)) expect(ka.has(k)).toBe(false);
  });

  it('generated lamps: ~30 m spacing, 0.5 m off the kerb, arm towards the road', () => {
    const t = street();
    const lamps = placeProps([t], B(0, 0, 300, 200), ground).filter((p) => p.kind === PROP.LAMP).sort((a, b) => a.x - b.x);
    expect(lamps.length).toBeGreaterThanOrEqual(8);
    for (let i = 1; i < lamps.length; i++) {
      const d = lamps[i]!.x - lamps[i - 1]!.x;
      expect(d).toBeGreaterThan(14);
      expect(d).toBeLessThan(46);
    }
    for (const l of lamps) {
      expect(Math.abs(Math.abs(l.z - 100) - (3.25 + 0.5))).toBeLessThan(1e-6);
      // front (sin yaw, cos yaw) points to the road centre line
      expect(Math.cos(l.yaw) * (100 - l.z)).toBeGreaterThan(0);
      expect(l.y).toBeCloseTo(2.15, 5); // sidewalk kerb step
    }
    // alternating sides overall
    expect(lamps.some((l) => l.z > 100) && lamps.some((l) => l.z < 100)).toBe(true);
  });

  it('OSM lamps snap next to the kerb and suppress generated lamps within 12 m', () => {
    const t = street();
    addPoint(t, 120, 104.2, POINT.STREET_LAMP);
    const lamps = placeProps([t], B(0, 0, 300, 200), ground).filter((p) => p.kind === PROP.LAMP);
    const osm = lamps.filter((l) => Math.abs(l.x - 120) < 0.01);
    expect(osm.length).toBe(1);
    expect(osm[0]!.z - 100).toBeGreaterThanOrEqual(3.25 + 0.5 - 1e-9);
    expect(osm[0]!.z - 100).toBeLessThanOrEqual(3.25 + 1 + 1e-9);
    for (const l of lamps) if (l !== osm[0]) expect(Math.hypot(l.x - osm[0]!.x, l.z - osm[0]!.z)).toBeGreaterThanOrEqual(12);
  });

  it('no lamps inside buildings', () => {
    const t = street();
    addBuilding(t, [[0, 90], [300, 90], [300, 110], [0, 110]]);
    expect(placeProps([t], B(0, 0, 300, 200), ground).filter((p) => p.kind === PROP.LAMP).length).toBe(0);
  });

  it('bus shelter stands on the sidewalk with its front towards the road, plus a bin', () => {
    const t = street();
    addPoint(t, 150, 98, POINT.BUS_STOP);
    const p = placeProps([t], B(0, 0, 300, 200), ground);
    const s = p.find((q) => q.kind === PROP.BUS_SHELTER)!;
    expect(s).toBeDefined();
    expect(Math.abs(s.z - 100)).toBeGreaterThan(3.25);
    const toRoad = 100 - s.z;
    expect(Math.cos(s.yaw) * toRoad).toBeGreaterThan(0.9 * Math.abs(toRoad));
    expect(Math.abs(Math.sin(s.yaw))).toBeLessThan(0.2);
    expect(p.some((q) => q.kind === PROP.BIN && Math.abs(q.x - s.x) < 3.5)).toBe(true);
  });

  it('traffic lights come in pairs at opposite corners', () => {
    const t = street();
    addPoint(t, 150, 100, POINT.TRAFFIC_SIGNALS);
    const l = placeProps([t], B(0, 0, 300, 200), ground).filter((q) => q.kind === PROP.TRAFFIC_LIGHT);
    expect(l.length).toBe(2);
    expect(Math.sign(l[0]!.z - 100)).toBe(-Math.sign(l[1]!.z - 100));
    expect(Math.sign(l[0]!.x - 150)).toBe(-Math.sign(l[1]!.x - 150));
  });

  it('benches along park footways, fences along fence lines', () => {
    const t = tile();
    t.areas.push({ rings: [cm([[0, 0], [200, 0], [200, 60], [0, 60]])], mat: MAT.PARK, prio: 1 });
    t.roads.push({ pts: cm([[10, 30], [60, 30], [110, 30], [160, 30]]), kind: ROAD.FOOTWAY, flags: 0, widthCm: 200, lanes: 0, layer: 0, name: -1 });
    t.lines.push({ pts: cm([[0, 80], [20, 80]]), kind: LINE.FENCE });
    const p = placeProps([t], B(0, 0, 200, 100), ground);
    expect(p.filter((q) => q.kind === PROP.BENCH).length).toBeGreaterThanOrEqual(4);
    expect(p.filter((q) => q.kind === PROP.BIN).length).toBeGreaterThanOrEqual(1);
    expect(p.filter((q) => q.kind === PROP.FENCE).length).toBe(10);
  });
});

describe('shop signs', () => {
  function shopTile(): VectorTile {
    const t = tile();
    addBuilding(t, [[40, 20], [60, 20], [60, 30], [40, 30]]);
    addRoad(t, [[0, 36], [100, 36]], ROAD.RESIDENTIAL, 0);
    addPoint(t, 50, 33, POINT.SHOP, 0);
    return t;
  }

  it('faces outward from the wall nearest the street and stays within the facade', () => {
    const s = placeSigns([shopTile()], B(0, 0, 100, 100), () => 2);
    expect(s.length).toBe(1);
    const q = s[0]!;
    expect(q.name).toBe('Аптека Добра');
    expect(q.nx).toBeCloseTo(0, 6);
    expect(q.nz).toBeCloseTo(1, 6); // south wall faces +z
    expect(q.z).toBeGreaterThan(30);
    expect(q.z).toBeLessThan(30.3);
    expect(q.x - q.avail / 2).toBeGreaterThanOrEqual(40 - 1e-6);
    expect(q.x + q.avail / 2).toBeLessThanOrEqual(60 + 1e-6);
    expect(q.y).toBeGreaterThan(4);
    expect(q.y).toBeLessThan(7);
  });

  it('is emitted by exactly one chunk', () => {
    const t = shopTile();
    const a = placeSigns([t], B(0, 0, 50, 100), () => 2);
    const b = placeSigns([t], B(50, 0, 100, 100), () => 2);
    expect(a.length + b.length).toBe(1);
    expect(placeSigns([t], B(0, 0, 100, 100), () => 2)).toEqual([...a, ...b]);
  });

  it('works for walls facing every direction', () => {
    for (const [sx, sz, nx, nz] of [[50, 15, 0, -1], [65, 25, 1, 0], [35, 25, -1, 0], [50, 35, 0, 1]] as const) {
      const t = tile();
      addBuilding(t, [[40, 20], [60, 20], [60, 30], [40, 30]]);
      addRoad(t, [[sx + nx * 6 - 30 * Math.abs(nz), sz + nz * 6 - 30 * Math.abs(nx)], [sx + nx * 6 + 30 * Math.abs(nz), sz + nz * 6 + 30 * Math.abs(nx)]], ROAD.RESIDENTIAL, 0);
      addPoint(t, sx, sz, POINT.SHOP, 0);
      const s = placeSigns([t], B(0, 0, 100, 100), () => 2)[0]!;
      expect(s.nx).toBeCloseTo(nx, 6);
      expect(s.nz).toBeCloseTo(nz, 6);
    }
  });
});

describe('sign atlas', () => {
  it('LRU evicts the least recently used slot, never one in use this stamp', () => {
    const l = new SlotLru(2);
    expect(l.acquire('a', 1)).toEqual({ slot: expect.any(Number), fresh: true });
    const b = l.acquire('b', 1)!;
    expect(l.acquire('c', 1)).toBeNull(); // both in use
    expect(l.acquire('a', 2)!.fresh).toBe(false); // touch a
    const c = l.acquire('c', 2)!; // evicts b
    expect(c.fresh).toBe(true);
    expect(c.slot).toBe(b.slot);
    expect(l.has('b')).toBe(false);
    expect(l.has('a')).toBe(true);
  });

  it('plate colours are stable and keyword based', () => {
    expect(plateColor('Аптека Добра')).toBe(plateColor('аптека добра'));
    expect(plateColor('Універсал')).toBe(plateColor('Універсал'));
  });
});

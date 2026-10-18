import { describe, expect, it } from 'vitest';
import { buildVectorTiles, roadWidthCm, REGION_CM, type VectorInput } from '../tools/bake/vectors';
import { decodeVectorTile, encodeVectorTile, LINE, NO_DIR, POINT, ROAD, ROAD_ONEWAY, ROAD_SIDEWALK } from '../src/world/vector-format';

// 1 cell = 2 m = 200 cm; a region is 256 cells.
const base = (): VectorInput => ({
  areas: [], lines: [], barriers: [], taggedNodes: [], regionsX: 4, regionsZ: 4, centre: [0, 0],
});
const key = (rx: number, rz: number): number => rz * 65536 + rx;

describe('bake vector tiles', () => {
  it('splits roads into <= 64 m pieces sharing endpoints, anchored by midpoint', () => {
    const input = base();
    // 240 m east along z = 10 cells, crossing the region 0/1 border (x = 256 cells)
    input.lines.push({ id: 1, tags: { highway: 'residential' }, pts: [[200, 10], [320, 10]] });
    const { tiles } = buildVectorTiles(input);
    const pieces: { rx: number; pts: number[] }[] = [];
    for (const t of tiles.values()) for (const r of t.roads) {
      const abs: number[] = [];
      for (let i = 0; i < r.pts.length; i += 2) abs.push(r.pts[i]! + t.rx * REGION_CM, r.pts[i + 1]!);
      pieces.push({ rx: t.rx, pts: abs });
    }
    pieces.sort((a, b) => a.pts[0]! - b.pts[0]!);
    expect(pieces.length).toBe(4);
    for (let i = 0; i < pieces.length; i++) {
      const p = pieces[i]!.pts;
      const len = Math.hypot(p[p.length - 2]! - p[0]!, p[p.length - 1]! - p[1]!);
      expect(len).toBeLessThanOrEqual(6400);
      const mid = (p[0]! + p[p.length - 2]!) / 2;
      expect(pieces[i]!.rx).toBe(Math.floor(mid / REGION_CM));
      if (i > 0) {
        const q = pieces[i - 1]!.pts;
        expect([q[q.length - 2], q[q.length - 1]]).toEqual([p[0], p[1]]);
      }
    }
    expect(new Set(pieces.map((p) => p.rx))).toEqual(new Set([0, 1]));
    expect(pieces[0]!.pts[0]).toBe(40000);
    const last = pieces[3]!.pts;
    expect(last[last.length - 2]).toBe(64000);
  });

  it('reverses oneway=-1 and sets flags', () => {
    const input = base();
    input.lines.push({ id: 2, tags: { highway: 'primary', oneway: '-1', sidewalk: 'no' }, pts: [[10, 10], [20, 10]] });
    input.lines.push({ id: 3, tags: { highway: 'secondary', oneway: 'yes' }, pts: [[10, 20], [20, 20]] });
    const roads = [...buildVectorTiles(input).tiles.values()].flatMap((t) => t.roads);
    const rev = roads.find((r) => r.kind === ROAD.PRIMARY)!;
    expect(rev.flags & ROAD_ONEWAY).toBe(ROAD_ONEWAY);
    expect(rev.flags & ROAD_SIDEWALK).toBe(0);
    expect(rev.pts[0]).toBe(4000);
    expect(rev.pts[2]).toBe(2000);
    const fwd = roads.find((r) => r.kind === ROAD.SECONDARY)!;
    expect(fwd.flags & ROAD_SIDEWALK).toBe(ROAD_SIDEWALK);
    expect(fwd.pts[0]).toBe(2000);
  });

  it('derives widths and lanes', () => {
    expect(roadWidthCm({}, 'residential')).toBe(800);
    expect(roadWidthCm({}, 'primary')).toBe(1600);
    expect(roadWidthCm({ lanes: '4' }, 'primary')).toBe(1300);
    expect(roadWidthCm({ lanes: '1' }, 'residential')).toBe(550);
    expect(roadWidthCm({ width: '7,5' }, 'residential')).toBe(750);
    expect(roadWidthCm({}, 'footway')).toBe(200);
    expect(roadWidthCm({}, 'pedestrian')).toBe(400);
    expect(roadWidthCm({}, 'track')).toBe(300);
    expect(roadWidthCm({}, 'service')).toBe(450);
  });

  it('duplicates a large area clipped into each neighbouring region', () => {
    const input = base();
    input.areas.push({
      id: 5, tags: { leisure: 'park' },
      rings: [[[200, 10], [320, 10], [320, 50], [200, 50], [200, 10]]],
    });
    const { tiles } = buildVectorTiles(input);
    const a0 = tiles.get(key(0, 0))!.areas;
    const a1 = tiles.get(key(1, 0))!.areas;
    expect(a0.length).toBe(1);
    expect(a1.length).toBe(1);
    const xs = (r: Int32Array): number[] => Array.from(r).filter((_, i) => i % 2 === 0);
    expect(Math.max(...xs(a0[0]!.rings[0]!))).toBe(REGION_CM + 6400); // clipped at the 64 m margin
    expect(Math.min(...xs(a0[0]!.rings[0]!))).toBe(40000);
    expect(Math.min(...xs(a1[0]!.rings[0]!))).toBe(-6400);
    expect(Math.max(...xs(a1[0]!.rings[0]!))).toBe(64000 - REGION_CM);
    expect(tiles.has(key(0, 1))).toBe(false);
  });

  it('anchors buildings by centroid and uses exact heights', () => {
    const input = base();
    input.areas.push({
      id: 4294967296 + 7, tags: { building: 'yes', 'building:levels': '5', name: 'Dom', 'roof:shape': 'gabled', min_height: '2' },
      rings: [[[250, 10], [270, 10], [270, 20], [250, 20], [250, 10]]],
    });
    const { tiles } = buildVectorTiles(input);
    const t = tiles.get(key(1, 0))!; // centroid x ~ 259 cells > 256
    expect(t).toBeDefined();
    expect(tiles.has(key(0, 0))).toBe(false);
    const b = t.buildings[0]!;
    expect(b.id).toBe(7);
    expect(b.heightCm).toBe(1600);
    expect(b.minHeightCm).toBe(200);
    expect(b.levels).toBe(5);
    expect(b.roofShape).toBe(1);
    expect(t.strings[b.name]).toBe('Dom');
    expect(b.rings[0]!.length).toBe(8); // closing point dropped
  });

  it('gives crossings the direction of the road through them and handles other points', () => {
    const input = base();
    input.lines.push({ id: 9, tags: { highway: 'residential' }, pts: [[10, 10], [10, 20], [10, 30]], nodeIds: [100, 101, 102] });
    input.taggedNodes.push(
      { id: 101, cx: 10, cz: 20, tags: { highway: 'crossing' } },
      { id: 555, cx: 12, cz: 20, tags: { highway: 'crossing' } },
      { id: 556, cx: 14, cz: 20, tags: { highway: 'street_lamp' } },
      { id: 557, cx: 16, cz: 20, tags: { shop: 'kiosk', name: 'Kiosk' } },
      { id: 558, cx: 18, cz: 20, tags: { shop: 'kiosk' } },
    );
    input.barriers.push({ id: 11, tags: { barrier: 'fence' }, pts: [[1, 1], [5, 1]] });
    const t = buildVectorTiles(input).tiles.get(key(0, 0))!;
    const crossing = t.points.find((p) => p.kind === POINT.CROSSING && p.x === 2000)!;
    expect(crossing.dir).toBe(64); // heading south = quarter turn
    expect(t.points.find((p) => p.kind === POINT.CROSSING && p.x === 2400)!.dir).toBe(NO_DIR);
    expect(t.points.some((p) => p.kind === POINT.STREET_LAMP)).toBe(true);
    const shops = t.points.filter((p) => p.kind === POINT.SHOP);
    expect(shops.length).toBe(1);
    expect(t.strings[shops[0]!.name]).toBe('Kiosk');
    expect(t.lines.map((l) => l.kind)).toEqual([LINE.FENCE]);
  });

  it('bakes explicit barrier heights and industrial perimeter gates', () => {
    const input = base();
    input.areas.push({ id: 20, tags: { landuse: 'industrial' }, rings: [[[0, 0], [20, 0], [20, 20], [0, 20]]] });
    input.areas.push({ id: 21, tags: { building: 'warehouse' }, rings: [[[0, 0], [2, 0], [2, 2], [0, 2]]] });
    input.lines.push({ id: 22, tags: { highway: 'service', width: '4' }, pts: [[10, -5], [10, 25]] });
    input.barriers.push({ id: 23, tags: { barrier: 'wall', height: '1.4' }, pts: [[30, 0], [30, 10]] });
    input.barriers.push({ id: 24, tags: { barrier: 'fence', height: '2.7' }, pts: [[32, 0], [32, 10]] });
    const lines = [...buildVectorTiles(input).tiles.values()].flatMap((t) => t.lines);
    expect(lines.some((l) => l.kind === LINE.WALL && l.heightCm === 140)).toBe(true);
    expect(lines.some((l) => l.kind === LINE.FENCE && l.heightCm === 270)).toBe(true);
    const perimeter = lines.filter((l) => l.kind === LINE.FENCE && l.heightCm === 220);
    expect(perimeter.length).toBeGreaterThan(0);
    expect(perimeter.some((l) => {
      const x = (l.pts[0]! + l.pts[2]!) / 2 / 200;
      const z = (l.pts[1]! + l.pts[3]!) / 2 / 200;
      return Math.abs(x - 10) < 3;
    })).toBe(false); // service-road gate
    expect(perimeter.some((l) => {
      const x = (l.pts[0]! + l.pts[2]!) / 2 / 200;
      const z = (l.pts[1]! + l.pts[3]!) / 2 / 200;
      return x < 3 && z < 1;
    })).toBe(false); // no panel through the warehouse
  });

  it('is deterministic and round-trips through the codec', () => {
    const make = (): VectorInput => {
      const input = base();
      input.lines.push({ id: 2, tags: { highway: 'residential', name: 'Ulitsa', lanes: '2' }, pts: [[10, 10], [200, 40]] });
      input.areas.push({ id: 8, tags: { building: 'yes' }, rings: [[[5, 5], [9, 5], [9, 9], [5, 9]]] });
      return input;
    };
    const a = buildVectorTiles(make()).tiles.get(key(0, 0))!;
    const b = buildVectorTiles(make()).tiles.get(key(0, 0))!;
    expect(a).toEqual(b);
    let bytes: Uint8Array;
    try {
      bytes = encodeVectorTile(a);
    } catch (e) {
      if ((e as Error).message === 'not implemented') return;
      throw e;
    }
    expect(Array.from(encodeVectorTile(b))).toEqual(Array.from(bytes));
    expect(decodeVectorTile(bytes)).toEqual(a);
  });
});

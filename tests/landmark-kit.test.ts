import { describe, expect, it } from 'vitest';
import type { LandmarkMeshData } from '../src/landmarks/types.ts';
import { PBR_LAYER_COUNT } from '../src/world/pbr-layers.ts';
import { detailSegments, frame, KitBuilder, type Detail, type Frame } from '../src/landmarks/kit/builder.ts';
import { boxPrism, slab, wallWithOpenings } from '../src/landmarks/kit/walls.ts';
import { addOpening, doorway, openingTop, type Opening } from '../src/landmarks/kit/openings.ts';
import {
  ARCHITRAVE, CORNICE_DENTIL, CORNICE_SIMPLE, PLINTH, rustication, STRING_COURSE, sweepProfile,
} from '../src/landmarks/kit/mouldings.ts';
import { balustrade, colonnadePortico, column, pediment, pilaster } from '../src/landmarks/kit/orders.ts';
import { attic, flatRoofWithParapet, gableRoof, hipRoof, mansardRoof } from '../src/landmarks/kit/roofs.ts';
import {
  archGate, belfryStage, clockFace, cross, dome, drum, lantern,
} from '../src/landmarks/kit/domes.ts';

const WALL: readonly [number, number, number] = [0.86, 0.83, 0.76];
const TRIM: readonly [number, number, number] = [0.93, 0.91, 0.86];
const ROOF: readonly [number, number, number] = [0.36, 0.24, 0.19];

/** A rotated frame in the middle of the world, so every local→world mapping is exercised. */
const f: Frame = frame(120, 4, -80, 0.37);
/** Unrotated frame at the origin for checks that compare against local coordinates. */
const f0: Frame = frame();

function build(fn: (b: KitBuilder, detail: Detail) => void, detail: Detail = 'near'): LandmarkMeshData {
  const b = new KitBuilder();
  fn(b, detail);
  return b.finish();
}

/** Structural checks every kit mesh must pass: dense attributes, unit normals, valid uv/pbr, CCW winding. */
function checkMesh(mesh: LandmarkMeshData): number {
  const p = mesh.positions, n = mesh.normals, c = mesh.colors, uv = mesh.uvs!, pbr = mesh.pbr!, ix = mesh.indices;
  const vertexCount = p.length / 3;
  expect(vertexCount).toBeGreaterThan(0);
  expect(n.length).toBe(p.length);
  expect(c.length).toBe(p.length);
  expect(uv.length).toBe(vertexCount * 2);
  expect(pbr.length).toBe(vertexCount);
  for (let i = 0; i < vertexCount; i++) {
    const l = Math.hypot(n[i * 3]!, n[i * 3 + 1]!, n[i * 3 + 2]!);
    expect(l, `normal ${i}`).toBeCloseTo(1, 5);
    expect(Number.isFinite(p[i * 3]!) && Number.isFinite(p[i * 3 + 1]!) && Number.isFinite(p[i * 3 + 2]!)).toBe(true);
    expect(Number.isFinite(uv[i * 2]!) && Number.isFinite(uv[i * 2 + 1]!)).toBe(true);
    for (let k = 0; k < 3; k++) {
      expect(c[i * 3 + k]!).toBeGreaterThanOrEqual(0);
      expect(c[i * 3 + k]!).toBeLessThanOrEqual(1);
    }
    const layer = pbr[i]!;
    expect(Number.isInteger(layer)).toBe(true);
    expect(layer === -1 || (layer >= 0 && layer < PBR_LAYER_COUNT)).toBe(true);
  }
  expect(ix.length % 3).toBe(0);
  for (const index of ix) expect(index).toBeLessThan(vertexCount);
  // Stored normal agrees with the counter-clockwise winding.
  for (let t = 0; t < ix.length; t += 3) {
    const a = ix[t]! * 3, b = ix[t + 1]! * 3, d = ix[t + 2]! * 3;
    const ux = p[b]! - p[a]!, uy = p[b + 1]! - p[a + 1]!, uz = p[b + 2]! - p[a + 2]!;
    const vx = p[d]! - p[a]!, vy = p[d + 1]! - p[a + 1]!, vz = p[d + 2]! - p[a + 2]!;
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    const dot = fx * n[a]! + fy * n[a + 1]! + fz * n[a + 2]!;
    expect(dot, `triangle ${t / 3} faces its normal`).toBeGreaterThanOrEqual(-1e-7);
  }
  return ix.length / 3;
}

/** Undirected edges keyed by rounded position, so separately emitted faces that meet still join. */
function openEdges(mesh: LandmarkMeshData): string[] {
  const p = mesh.positions;
  const key = (i: number) => `${p[i * 3]!.toFixed(4)},${p[i * 3 + 1]!.toFixed(4)},${p[i * 3 + 2]!.toFixed(4)}`;
  const edges = new Map<string, number>();
  const add = (a: number, b: number) => {
    const ka = key(a), kb = key(b);
    const k = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
    edges.set(k, (edges.get(k) ?? 0) + 1);
  };
  for (let t = 0; t < mesh.indices.length; t += 3) {
    add(mesh.indices[t]!, mesh.indices[t + 1]!);
    add(mesh.indices[t + 1]!, mesh.indices[t + 2]!);
    add(mesh.indices[t + 2]!, mesh.indices[t]!);
  }
  return [...edges].filter(([, count]) => count !== 2).map(([k]) => k);
}

const rectOpening = (x: number, y: number, w: number, h: number): Opening => ({
  x, y, w, h, shape: 'rect', depth: 0.18, surround: 'band', sill: true,
});

const archedOpening = (x: number, y: number, w: number, h: number): Opening => ({
  x, y, w, h, shape: 'arched', depth: 0.22, surround: 'arch_moulding', sill: true,
});

interface ElementCase {
  name: string;
  min: number;
  max: number;
  /** Curved elements must use fewer segments (about a third) at far detail. */
  curved?: boolean;
  build(b: KitBuilder, detail: Detail): void;
}

const ELEMENTS: readonly ElementCase[] = [
  {
    name: 'wallWithOpenings rect',
    min: 16, max: 60,
    build: (b) => wallWithOpenings(b, f, {
      x0: -6, x1: 6, y0: 0, y1: 9, colour: WALL, pbr: 0,
      openings: [rectOpening(-4, 1, 1.6, 2.4), rectOpening(-0.8, 0, 2.2, 3.2), rectOpening(3.4, 3, 1.4, 2)],
    }),
  },
  {
    name: 'wallWithOpenings arch',
    min: 14, max: 60, curved: true,
    build: (b, d) => wallWithOpenings(b, f, {
      x0: -4, x1: 4, y0: 0, y1: 7, colour: WALL, pbr: 0, detail: d,
      openings: [archedOpening(-2, 0, 2.4, 3.2), rectOpening(1.2, 1, 1.2, 2)],
    }),
  },
  {
    name: 'slab',
    min: 12, max: 12,
    build: (b) => slab(b, f, { x0: -1, x1: 1, y0: 0, y1: 2, z0: -0.3, z1: 0, colour: WALL, pbr: 0 }),
  },
  {
    name: 'boxPrism',
    min: 12, max: 12,
    build: (b) => boxPrism(b, f, { x0: -1, x1: 1, y0: 0, y1: 1.5, z0: -1, z1: 0.2, colour: WALL, pbr: 0 }),
  },
  {
    name: 'opening rect band',
    min: 40, max: 120,
    build: (b) => addOpening(b, f, rectOpening(0, 1, 1.4, 2.2), { reveal: WALL, surround: TRIM }),
  },
  {
    name: 'opening arched keystone',
    min: 90, max: 250, curved: true,
    build: (b, d) => addOpening(b, f, {
      x: 0, y: 1, w: 1.6, h: 2.4, shape: 'arched', depth: 0.2, surround: 'keystone', sill: true,
      frame: { colour: TRIM, bars: 'cross' },
    }, { reveal: WALL, surround: TRIM }, d),
  },
  {
    name: 'opening pediment',
    min: 50, max: 150,
    build: (b) => addOpening(b, f, {
      x: 0, y: 2, w: 1.2, h: 2, shape: 'rect', depth: 0.16, surround: 'pediment', sill: true,
    }, { reveal: WALL, surround: TRIM }),
  },
  {
    name: 'opening segmental moulding',
    min: 50, max: 200, curved: true,
    build: (b, d) => addOpening(b, f, {
      x: 0, y: 1.2, w: 1.8, h: 2.1, shape: 'segmental', depth: 0.2, surround: 'arch_moulding', sill: false,
    }, { reveal: WALL, surround: TRIM }, d),
  },
  {
    name: 'doorway',
    min: 60, max: 200, curved: true,
    build: (b, d) => doorway(b, f, {
      x: 0, y0: 0, w: 1.6, h: 3.2, depth: 0.25, fanlight: true, steps: 3,
      colour: [0.3, 0.2, 0.14], frame: TRIM, detail: d,
    }),
  },
  {
    name: 'sweepProfile closed square',
    min: 40, max: 40,
    build: (b) => sweepProfile(b, f, CORNICE_SIMPLE, [[0, 0], [4, 0], [4, 4], [0, 4]], true, TRIM, 0),
  },
  {
    name: 'sweepProfile open path',
    min: 30, max: 30,
    build: (b) => sweepProfile(b, f, CORNICE_SIMPLE, [[0, 0], [2, 0], [4, 1.5], [6, 1.5]], false, TRIM, 0),
  },
  {
    name: 'sweepProfile dentils',
    min: 200, max: 400,
    build: (b) => sweepProfile(b, f, CORNICE_DENTIL, [[0, 0], [6, 0]], false, TRIM, 0, { dentils: { spacing: 0.3 } }),
  },
  {
    name: 'string course',
    min: 6, max: 6,
    build: (b) => sweepProfile(b, f, STRING_COURSE, [[0, 0], [5, 0]], false, TRIM, 0),
  },
  {
    name: 'plinth',
    min: 6, max: 6,
    build: (b) => sweepProfile(b, f, PLINTH, [[0, 0], [5, 0]], false, TRIM, 0),
  },
  {
    name: 'architrave',
    min: 8, max: 8,
    build: (b) => sweepProfile(b, f, ARCHITRAVE, [[0, 0], [5, 0]], false, TRIM, 0),
  },
  {
    name: 'rustication',
    min: 40, max: 120,
    build: (b) => rustication(b, f, { x0: 0, x1: 6, y0: 0, y1: 4, courseH: 0.6, jointDepth: 0.03, colour: WALL, pbr: 0 }),
  },
  {
    name: 'pilaster plain',
    min: 40, max: 120,
    build: (b) => pilaster(b, f, { x: 0, y0: 0, y1: 6, w: 0.8, depth: 0.25, capital: 'plain', base: true, colour: WALL, pbr: 0 }),
  },
  {
    name: 'pilaster ionic',
    min: 60, max: 160,
    build: (b) => pilaster(b, f, { x: 0, y0: 0, y1: 6, w: 0.8, depth: 0.3, capital: 'ionic', base: true, colour: WALL, pbr: 0 }),
  },
  {
    name: 'pilaster corinthian',
    min: 100, max: 250,
    build: (b) => pilaster(b, f, { x: 0, y0: 0, y1: 6, w: 0.8, depth: 0.3, capital: 'corinthian', base: true, colour: WALL, pbr: 0 }),
  },
  {
    name: 'column corinthian',
    min: 120, max: 500, curved: true,
    build: (b, d) => column(b, f, { x: 0, z: 0.4, y0: 0, y1: 6, r: 0.4, capital: 'corinthian', colour: TRIM, pbr: 0, detail: d }),
  },
  {
    name: 'column ionic',
    min: 100, max: 400, curved: true,
    build: (b, d) => column(b, f, { x: 0, y0: 0, y1: 5, r: 0.3, capital: 'ionic', colour: TRIM, pbr: 0, detail: d }),
  },
  {
    name: 'balustrade',
    min: 400, max: 1400, curved: true,
    build: (b, d) => balustrade(b, f, { x0: 0, x1: 8, y: 4, h: 1, colour: TRIM, pbr: 0, detail: d }),
  },
  {
    name: 'pediment',
    min: 8, max: 40,
    build: (b) => pediment(b, f, { x0: -4, x1: 4, y: 6, h: 1.4, depth: 1.2, colour: TRIM, tympanumColour: WALL, pbr: 0 }),
  },
  {
    name: 'colonnade portico',
    min: 600, max: 2400, curved: true,
    build: (b, d) => colonnadePortico(b, f, {
      x0: -5, x1: 5, y0: 0, y1: 6, columns: 6, depth: 2, capital: 'ionic', pedimentH: 1.6, colour: TRIM, pbr: 0, detail: d,
    }),
  },
  {
    name: 'hip roof',
    min: 6, max: 40,
    build: (b) => hipRoof(b, f, { x0: -5, x1: 5, z0: -3, z1: 3, y: 9, rise: 2.4, colour: ROOF, pbr: 10 }),
  },
  {
    name: 'gable roof',
    min: 6, max: 40,
    build: (b) => gableRoof(b, f, { x0: -5, x1: 5, z0: -3, z1: 3, y: 9, rise: 2.4, colour: ROOF, pbr: 10 }),
  },
  {
    name: 'hip roof ridge along z',
    min: 6, max: 40,
    build: (b) => hipRoof(b, f, { x0: -3, x1: 3, z0: -7, z1: 7, y: 9, rise: 2.4, colour: ROOF, pbr: 10 }),
  },
  {
    name: 'gable roof ridge along z',
    min: 6, max: 40,
    build: (b) => gableRoof(b, f, { x0: -3, x1: 3, z0: -7, z1: 7, y: 9, rise: 2.4, colour: ROOF, pbr: 10 }),
  },
  {
    name: 'mansard roof',
    min: 16, max: 80,
    build: (b) => mansardRoof(b, f, { x0: -5, x1: 5, z0: -3, z1: 3, y: 9, rise: 2.6, overhang: 0.4, colour: ROOF, pbr: 10 }),
  },
  {
    name: 'flat roof with parapet',
    min: 40, max: 200,
    build: (b) => flatRoofWithParapet(b, f, {
      ring: [[-5, -3], [2, -3], [2, 1], [5, 1], [5, 3], [-5, 3]], y: 9, parapetH: 0.9, thickness: 0.3, colour: TRIM, pbr: 0,
    }),
  },
  {
    name: 'attic',
    min: 20, max: 80,
    build: (b) => attic(b, f, { x0: -5, x1: 5, z0: -3, z1: 3, y: 9, h: 1.8, colour: WALL, pbr: 0 }),
  },
  {
    name: 'drum',
    min: 200, max: 900, curved: true,
    build: (b, d) => drum(b, f, { cx: 0, cz: 0, y0: 8, h: 2.4, r: 2.6, windows: 8, windowShape: 'arched', colour: WALL, pbr: 0, detail: d }),
  },
  {
    name: 'dome hemi',
    min: 30, max: 700, curved: true,
    build: (b, d) => dome(b, f, { cx: 0, cz: 0, y0: 10, r: 2.6, profile: 'hemi', colour: [0.45, 0.5, 0.36], pbr: 10, detail: d }),
  },
  {
    name: 'dome helmet',
    min: 30, max: 700, curved: true,
    build: (b, d) => dome(b, f, { cx: 0, cz: 0, y0: 10, r: 2.6, profile: 'helmet', colour: [0.45, 0.5, 0.36], pbr: 10, detail: d }),
  },
  {
    name: 'dome onion',
    min: 30, max: 700, curved: true,
    build: (b, d) => dome(b, f, { cx: 0, cz: 0, y0: 10, r: 2.6, profile: 'onion', colour: [0.7, 0.58, 0.2], pbr: 10, detail: d }),
  },
  {
    name: 'dome spire',
    min: 20, max: 700, curved: true,
    build: (b, d) => dome(b, f, { cx: 0, cz: 0, y0: 10, r: 2.2, profile: 'spire', colour: [0.45, 0.5, 0.36], pbr: 10, detail: d }),
  },
  {
    name: 'lantern',
    min: 60, max: 600, curved: true,
    build: (b, d) => lantern(b, f, { cx: 0, cz: 0, y0: 14, r: 0.9, h: 2.2, colour: TRIM, pbr: 0, detail: d }),
  },
  {
    name: 'cross',
    min: 40, max: 80,
    build: (b) => cross(b, f, { x: 0, y: 16, h: 2.4, colour: [0.7, 0.58, 0.2], pbr: 10 }),
  },
  {
    name: 'belfry stage',
    min: 600, max: 2400, curved: true,
    build: (b, d) => belfryStage(b, f, { cx: 0, cz: 0, y0: 12, w: 5, h: 5, archesPerSide: 2, colour: WALL, pbr: 0, detail: d }),
  },
  {
    name: 'clock face',
    min: 40, max: 200,
    build: (b) => clockFace(b, f, { x: 0, y: 14, r: 1.4, colour: [0.95, 0.93, 0.86] }),
  },
  {
    name: 'arch gate',
    min: 60, max: 900, curved: true,
    build: (b, d) => archGate(b, f, {
      x0: -6, x1: 6, y0: 0, y1: 8, archH: 5, archW: 4.4, depth: 1.5, colour: WALL, pbr: 3, detail: d,
    }),
  },
];

function arrays(mesh: LandmarkMeshData): number[][] {
  return [
    Array.from(mesh.positions), Array.from(mesh.normals), Array.from(mesh.colors),
    Array.from(mesh.uvs!), Array.from(mesh.pbr!), Array.from(mesh.indices),
  ];
}

describe('KitBuilder', () => {
  it('derives outward normals and metre UVs for a vertical quad', () => {
    const b = new KitBuilder();
    b.quad([0, 0, 0], [2, 0, 0], [2, 3, 0], [0, 3, 0], undefined, undefined, [0.5, 0.5, 0.5], 2);
    const mesh = b.finish();
    expect(b.triangles()).toBe(2);
    expect(Array.from(mesh.normals.slice(0, 3))).toEqual([0, 0, 1]);
    expect(Array.from(mesh.uvs!)).toEqual([0, 0, 2, 0, 2, 3, 0, 3]);
    expect(Array.from(mesh.pbr!)).toEqual([2, 2, 2, 2]);
    expect(mesh.kind).toBe('textured');
  });

  it('takes a photo again and keeps triangles() in step', () => {
    const b = new KitBuilder();
    b.tri([0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], [[0, 0], [1, 0], [0, 1]], [1, 1, 1], -1);
    expect(b.triangles()).toBe(1);
    const mesh = b.finish('textured', 'w123');
    expect(mesh.photo).toBe('w123');
    expect(mesh.indices).toHaveLength(3);
  });

  it('halves the segment count at far detail', () => {
    expect(detailSegments(12, 'near')).toBe(12);
    expect(detailSegments(12, 'far')).toBe(4);
    expect(detailSegments(8, 'far')).toBe(3);
    expect(detailSegments(4, 'far')).toBe(3);
  });
});

describe('architectural kit elements', () => {
  it.each(ELEMENTS)('$name stays inside its triangle bounds and is a valid mesh', ({ name, min, max, build: make }) => {
    for (const detail of ['near', 'far'] as const) {
      const mesh = build(make, detail);
      const triangles = checkMesh(mesh);
      expect(triangles, `${name} ${detail}`).toBeGreaterThanOrEqual(min);
      expect(triangles, `${name} ${detail}`).toBeLessThanOrEqual(max);
      expect(triangles, `${name} ${detail}`).toBeLessThan(2500);
    }
  });

  it.each(ELEMENTS.filter((e) => e.curved))('$name uses fewer segments at far detail', ({ name, build: make }) => {
    const near = build(make, 'near').indices.length;
    const far = build(make, 'far').indices.length;
    expect(far, name).toBeLessThan(near);
  });

  it('is byte-identical when built twice', () => {
    for (const element of ELEMENTS) {
      const a = arrays(build(element.build, 'near'));
      const b = arrays(build(element.build, 'near'));
      expect(b, element.name).toEqual(a);
    }
  });
});

describe('walls', () => {
  const area = (mesh: LandmarkMeshData): number => {
    const p = mesh.positions, ix = mesh.indices;
    let sum = 0;
    for (let t = 0; t < ix.length; t += 3) {
      const a = ix[t]! * 3, b = ix[t + 1]! * 3, c = ix[t + 2]! * 3;
      const ux = p[b]! - p[a]!, uy = p[b + 1]! - p[a + 1]!, uz = p[b + 2]! - p[a + 2]!;
      const vx = p[c]! - p[a]!, vy = p[c + 1]! - p[a + 1]!, vz = p[c + 2]! - p[a + 2]!;
      const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
      sum += Math.hypot(cx, cy, cz) / 2;
    }
    return sum;
  };

  it('has exactly the wall area left after rectangular openings', () => {
    const openings = [rectOpening(1, 1, 1.5, 2), rectOpening(4, 0.5, 2, 2.5), rectOpening(8, 2, 1.2, 1.6)];
    const mesh = build((b) => wallWithOpenings(b, f0, {
      x0: 0, x1: 10, y0: 0, y1: 6, openings, colour: WALL, pbr: 0,
    }));
    let holes = 0;
    for (const o of openings) holes += o.w * o.h;
    expect(area(mesh)).toBeCloseTo(60 - holes, 1);
    // The front face is all in the frame plane; nothing pokes out of it.
    const p = mesh.positions;
    for (let i = 0; i < p.length; i += 3) expect(p[i + 2]!).toBeCloseTo(0, 5);
  });

  it('puts an arched opening top w/2 above the rectangular top', () => {
    const o: Opening = { x: -1, y: 1, w: 2, h: 3, shape: 'arched', depth: 0.2 };
    expect(openingTop(o, o.x + o.w / 2)).toBeCloseTo(1 + 3 + 1, 6);
    expect(openingTop(o, o.x)).toBeCloseTo(1 + 3, 6);
    expect(openingTop({ ...o, shape: 'segmental' }, o.x + o.w / 2)).toBeGreaterThan(4);
    expect(openingTop({ ...o, shape: 'segmental' }, o.x + o.w / 2)).toBeLessThan(4.5);
    const mesh = build((b) => addOpening(b, f0, o, { reveal: WALL }));
    let maxY = -Infinity;
    for (let i = 1; i < mesh.positions.length; i += 3) maxY = Math.max(maxY, mesh.positions[i]!);
    expect(maxY).toBeCloseTo(5, 1);
    // The rise is w/2 ± 2 %.
    expect(Math.abs(maxY - (1 + 3) - 1)).toBeLessThan(0.02 * 1);
  });

  it('leaves the wall intact around the arch (the carved hole follows the curve)', () => {
    const mesh = build((b) => wallWithOpenings(b, f0, {
      x0: -2, x1: 2, y0: 0, y1: 6, colour: WALL, pbr: 0,
      openings: [{ x: -1, y: 0.5, w: 2, h: 2.5, shape: 'arched' }],
    }), 'near');
    const p = mesh.positions;
    let apex = false;
    for (let i = 0; i < p.length; i += 3) {
      const x = p[i]!, y = p[i + 1]!;
      if (Math.abs(x - 0) < 1e-6 && Math.abs(y - 4) < 1e-4) apex = true;
    }
    expect(apex).toBe(true);
    expect(area(mesh)).toBeGreaterThan(16 - 2 * 3.5);
  });

  it('maps photo uvs exactly onto the requested crop', () => {
    const mesh = build((b) => wallWithOpenings(b, f, {
      x0: 2, x1: 12, y0: 1, y1: 7, colour: WALL, pbr: 0,
      openings: [rectOpening(4, 2, 1.5, 2)],
      photo: { u0: 0.25, u1: 0.75, v0: 0.1, v1: 0.9 },
    }));
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (let i = 0; i < mesh.uvs!.length; i += 2) {
      u0 = Math.min(u0, mesh.uvs![i]!); u1 = Math.max(u1, mesh.uvs![i]!);
      v0 = Math.min(v0, mesh.uvs![i + 1]!); v1 = Math.max(v1, mesh.uvs![i + 1]!);
    }
    expect(u0).toBeCloseTo(0.25, 6);
    expect(u1).toBeCloseTo(0.75, 6);
    expect(v0).toBeCloseTo(0.1, 6);
    expect(v1).toBeCloseTo(0.9, 6);
  });

  it('points every box face away from its centre', () => {
    const mesh = build((b) => boxPrism(b, f0, { x0: -1, x1: 1, y0: 0, y1: 2, z0: -0.5, z1: 0.5, colour: WALL, pbr: 0 }));
    const p = mesh.positions, n = mesh.normals, ix = mesh.indices;
    for (let t = 0; t < ix.length; t += 3) {
      const a = ix[t]! * 3, b = ix[t + 1]! * 3, c = ix[t + 2]! * 3;
      const cx = (p[a]! + p[b]! + p[c]!) / 3;
      const cy = (p[a + 1]! + p[b + 1]! + p[c + 1]!) / 3 - 1;
      const cz = (p[a + 2]! + p[b + 2]! + p[c + 2]!) / 3;
      expect(cx * n[a]! + cy * n[a + 1]! + cz * n[a + 2]!).toBeGreaterThan(0);
    }
  });

  it('makes a wall with thickness a closed shell', () => {
    const mesh = build((b) => wallWithOpenings(b, f0, {
      x0: -3, x1: 3, y0: 0, y1: 5, thickness: 0.5, colour: WALL, pbr: 0,
      openings: [rectOpening(-0.8, 1, 1.6, 2)],
    }));
    // Both faces and the perimeter are present; openings are assumed to be lined by addOpening.
    expect(openEdges(mesh).length).toBeGreaterThan(0);
    const p = mesh.positions;
    let minZ = Infinity, maxZ = -Infinity;
    for (let i = 2; i < p.length; i += 3) { minZ = Math.min(minZ, p[i]!); maxZ = Math.max(maxZ, p[i]!); }
    expect(minZ).toBeCloseTo(-0.5, 5);
    expect(maxZ).toBeCloseTo(0, 5);
  });
});

describe('mouldings', () => {
  it('mitres the four corners of a closed rectangle without gaps', () => {
    const mesh = build((b) => sweepProfile(b, f0, [[0, 0], [0.3, 0]], [[0, 0], [4, 0], [4, 4], [0, 4]], true, TRIM, 0));
    // Each of the 8 ring positions (4 corners × 2 profile points) is emitted once per adjoining segment.
    const keys = new Map<string, number>();
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const k = `${mesh.positions[i]!.toFixed(5)},${mesh.positions[i + 1]!.toFixed(5)},${mesh.positions[i + 2]!.toFixed(5)}`;
      keys.set(k, (keys.get(k) ?? 0) + 1);
    }
    expect(keys.size).toBe(8);
    for (const count of keys.values()) expect(count).toBe(2);
    // Four outer mitre points, each 0.3·√2 from its path corner.
    const p = mesh.positions;
    const corners = [[0, 0], [4, 0], [4, 4], [0, 4]];
    let mitres = 0;
    for (const [cx, cz] of corners) {
      let found = false;
      for (let i = 0; i < p.length; i += 3) {
        const d = Math.hypot(p[i]! - cx!, p[i + 2]! - cz!);
        if (Math.abs(d - 0.3 * Math.SQRT2) < 1e-6) found = true;
      }
      if (found) mitres++;
    }
    expect(mitres).toBe(4);
  });

  it('lays banda joint courses without overlapping the wall face', () => {
    const mesh = build((b) => rustication(b, f, { x0: 0, x1: 4, y0: 0, y1: 2.4, courseH: 0.6, jointDepth: 0.04, colour: WALL, pbr: 0 }));
    const maxZ = Math.max(...Array.from({ length: mesh.positions.length / 3 }, (_, i) => mesh.positions[i * 3 + 2]!));
    expect(maxZ).toBeLessThanOrEqual(1e-6);
    checkMesh(mesh);
  });
});

describe('orders', () => {
  it('makes a column watertight', () => {
    for (const detail of ['near', 'far'] as const) {
      const mesh = build((b) => column(b, f, {
        x: 0, z: 0.3, y0: 0, y1: 5, r: 0.4, entasis: 0.08, capital: 'ionic', colour: TRIM, pbr: 0, detail,
      }), detail);
      expect(openEdges(mesh), detail).toEqual([]);
    }
  });

  it('makes boxes and drums watertight', () => {
    const box = build((b) => boxPrism(b, f, { x0: -1, x1: 1, y0: 0, y1: 2, z0: -0.5, z1: 0.5, colour: WALL, pbr: 0 }));
    expect(openEdges(box)).toEqual([]);
    const d = build((b) => drum(b, f, { cx: 0, cz: 0, y0: 0, h: 3, r: 2, windows: 0, colour: WALL, pbr: 0 }));
    expect(openEdges(d)).toEqual([]);
  });

  it('joins a dome to its drum into one closed shell', () => {
    const mesh = build((b) => {
      drum(b, f, { cx: 0, cz: 0, y0: 0, h: 3, r: 2, windows: 0, top: false, colour: WALL, pbr: 0, detail: 'near' });
      dome(b, f, { cx: 0, cz: 0, y0: 3, r: 2, profile: 'hemi', segments: 24, colour: ROOF, pbr: 10, detail: 'near' });
    });
    expect(openEdges(mesh)).toEqual([]);
  });
});

describe('domes and gates', () => {
  it('keeps a belfry stage closed from outside', () => {
    const mesh = build((b) => belfryStage(b, f0, { cx: 0, cz: 0, y0: 0, w: 5, h: 5, archesPerSide: 2, colour: WALL, pbr: 0 }));
    checkMesh(mesh);
    const p = mesh.positions;
    const ys = Array.from({ length: p.length / 3 }, (_, i) => p[i * 3 + 1]!);
    expect(Math.max(...ys)).toBeCloseTo(5, 5);
  });

  it('spans the clock face with 12 hour marks and two hands', () => {
    const mesh = build((b) => clockFace(b, f, { x: 0, y: 12, r: 1.2, colour: [0.95, 0.93, 0.86], handColour: [0.1, 0.1, 0.1] }));
    // The disc fan plus marks and hands; count thin dark quads by their colour.
    let darkTriangles = 0;
    const c = mesh.colors;
    for (let t = 0; t < mesh.indices.length; t += 3) {
      const i = mesh.indices[t]! * 3;
      if (c[i]! < 0.2) darkTriangles++;
    }
    expect(darkTriangles).toBeGreaterThanOrEqual(28);
    checkMesh(mesh);
  });

  it('leaves a passage through an arched gate', () => {
    const mesh = build((b) => archGate(b, f0, {
      x0: -4, x1: 4, y0: 0, y1: 6, archH: 4.4, archW: 3.6, depth: 1.2, colour: WALL, pbr: 3,
    }));
    // Passage walls reach up to the crown at y = 4.4.
    const p = mesh.positions;
    let crown = -Infinity;
    for (let i = 0; i < p.length; i += 3) if (Math.abs(p[i]!) < 1.4 && p[i + 1]! < 5) crown = Math.max(crown, p[i + 1]!);
    expect(crown).toBeCloseTo(4.4, 1);
    expect(crown).toBeLessThanOrEqual(4.4001);
    checkMesh(mesh);
  });
});

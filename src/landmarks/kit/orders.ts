/**
 * Orders: pilasters, columns, balustrades, pediments and a composed colonnade portico.
 *
 * Capitals are simplified but recognisable: stacked boxes and leaf/volute blocks for Ionic and Corinthian. Every
 * solid is closed (a column's base, shaft and capital are separate closed pieces that interpenetrate slightly), so
 * the rendered column has no silhouette holes. Faces that always sit on the wall (a pilaster's back) are omitted and
 * the call site says so.
 */
import type { Color } from '../shapes.ts';
import { detailSegments, emitBox, frameAt, type Detail, type Frame, type KitBuilder, type Vec3 } from './builder.ts';

export type Capital = 'plain' | 'ionic' | 'corinthian';

/** Height of the capital for a shaft of radius `r`, shared by pilasters and columns. */
function capitalHeight(r: number): number {
  return Math.max(0.16, r * 0.9);
}

export interface PilasterSpec {
  /** Centre in frame x. */
  x: number;
  y0: number;
  y1: number;
  w: number;
  /** Projection from the wall plane. */
  depth: number;
  capital?: Capital;
  base?: boolean;
  colour: Color;
  pbr?: number;
  detail?: Detail;
}

/** A flat, attached pier: base, shaft and a capital; its back sits on the wall and is not emitted. */
export function pilaster(b: KitBuilder, f: Frame, spec: PilasterSpec): void {
  const { x, y0, y1, w, depth, colour } = spec;
  if (!(y1 > y0) || w <= 0 || depth <= 0) return;
  const pbr = spec.pbr ?? -1;
  const capH = Math.min((y1 - y0) * 0.35, Math.max(0.2, w * 0.45));
  const baseH = spec.base === false ? 0 : Math.min((y1 - y0) * 0.2, Math.max(0.12, w * 0.28));
  const hw = w / 2;
  if (baseH > 0) {
    emitBox(b, f, x - hw * 1.35, x + hw * 1.35, y0, y0 + baseH * 0.55, 0, depth * 1.25, colour, pbr, { back: false });
    emitBox(b, f, x - hw * 1.1, x + hw * 1.1, y0 + baseH * 0.55, y0 + baseH, 0, depth * 1.1, colour, pbr, { back: false });
  }
  emitBox(b, f, x - hw, x + hw, y0 + baseH, y1 - capH, 0, depth, colour, pbr, { back: false });
  capitalBoxes(b, f, spec.capital ?? 'plain', x, depth / 2, y1 - capH, y1, hw, depth / 2, colour, pbr, spec.detail ?? 'near');
}

export interface ColumnSpec {
  x: number;
  /** Local z of the column axis; default 0. */
  z?: number;
  y0: number;
  y1: number;
  /** Shaft radius at the base. */
  r: number;
  /** Sides of the shaft; default 12 at near detail. */
  sides?: number;
  /** Entasis swell as a fraction of the radius at mid-height; default 0. */
  entasis?: number;
  capital?: Capital;
  colour: Color;
  pbr?: number;
  detail?: Detail;
}

/**
 * A free-standing column: square-ish base, entasised shaft, capital. Base, shaft and capital are closed pieces;
 * the shaft's caps are present so the shaft on its own is watertight.
 */
export function column(b: KitBuilder, f: Frame, spec: ColumnSpec): void {
  const { x, y0, y1, r, colour } = spec;
  if (!(y1 > y0) || r <= 0) return;
  const pbr = spec.pbr ?? -1;
  const z = spec.z ?? 0;
  const detail = spec.detail ?? 'near';
  const sides = Math.max(3, Math.round(spec.sides ?? detailSegments(12, detail)));
  const capH = Math.min((y1 - y0) * 0.35, capitalHeight(r));
  const baseH = Math.min((y1 - y0) * 0.2, Math.max(0.12, r * 0.55));
  emitBox(b, f, x - r * 1.35, x + r * 1.35, y0, y0 + baseH * 0.5, z - r * 1.35, z + r * 1.35, colour, pbr);
  emitBox(b, f, x - r * 1.12, x + r * 1.12, y0 + baseH * 0.5, y0 + baseH, z - r * 1.12, z + r * 1.12, colour, pbr);

  const shaftBottom = y0 + baseH, shaftTop = y1 - capH;
  const rings = 4;
  const entasis = spec.entasis ?? 0;
  const radius = (t: number): number => r * (1 - 0.14 * t) * (1 + entasis * Math.sin(Math.PI * t));
  const ring: [number, number][] = [];
  for (let i = 0; i < rings; i++) {
    const t = i / (rings - 1);
    ring.push([shaftBottom + (shaftTop - shaftBottom) * t, radius(t)]);
  }
  const points = ring.map(([y, rad]) => {
    const pts: Vec3[] = [];
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2;
      pts.push(f.toWorld(x + Math.cos(a) * rad, y, z + Math.sin(a) * rad));
    }
    return pts;
  });
  for (let s = 0; s + 1 < rings; s++) {
    const a = points[s]!, c = points[s + 1]!;
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      b.quad(a[i]!, c[i]!, c[j]!, a[j]!, undefined, undefined, colour, pbr);
    }
  }
  const bottomY = ring[0]![0], topY = ring[rings - 1]![0];
  const bottomC = f.toWorld(x, bottomY, z), topC = f.toWorld(x, topY, z);
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    b.tri(bottomC, points[0]![i]!, points[0]![j]!, undefined, undefined, colour, pbr);
    b.tri(topC, points[rings - 1]![j]!, points[rings - 1]![i]!, undefined, undefined, colour, pbr);
  }
  emitBox(b, f, x - r * 1.05, x + r * 1.05, shaftTop, y1 - capH * 0.3, z - r * 1.05, z + r * 1.05, colour, pbr);
  capitalBoxes(b, f, spec.capital ?? 'plain', x, z, y1 - capH, y1, r, r, colour, pbr, detail);
}

/** Stacked capital blocks; `hw`/`hz` are the shaft half-extents. */
function capitalBoxes(
  b: KitBuilder, f: Frame, kind: Capital, x: number, z: number, y0: number, y1: number,
  hw: number, hz: number, colour: Color, pbr: number, detail: Detail,
): void {
  const h = y1 - y0;
  if (kind === 'plain') {
    emitBox(b, f, x - hw * 1.18, x + hw * 1.18, y0, y0 + h * 0.6, z - hz * 1.12, z + hz * 1.12, colour, pbr);
    emitBox(b, f, x - hw * 1.4, x + hw * 1.4, y0 + h * 0.6, y1, z - hz * 1.3, z + hz * 1.3, colour, pbr);
    return;
  }
  if (kind === 'ionic') {
    emitBox(b, f, x - hw * 1.08, x + hw * 1.08, y0, y0 + h * 0.28, z - hz * 1.05, z + hz * 1.05, colour, pbr);
    emitBox(b, f, x - hw * 1.3, x + hw * 1.3, y0 + h * 0.28, y0 + h * 0.72, z - hz * 1.2, z + hz * 1.2, colour, pbr);
    emitBox(b, f, x - hw * 1.55, x + hw * 1.55, y0 + h * 0.72, y1, z - hz * 1.4, z + hz * 1.4, colour, pbr);
    // Volutes: small blocks at both ends of the abacus.
    emitBox(b, f, x - hw * 1.85, x - hw * 1.2, y0 + h * 0.35, y0 + h * 0.85, z - hz * 0.45, z + hz * 0.45, colour, pbr);
    emitBox(b, f, x + hw * 1.2, x + hw * 1.85, y0 + h * 0.35, y0 + h * 0.85, z - hz * 0.45, z + hz * 0.45, colour, pbr);
    return;
  }
  emitBox(b, f, x - hw * 1.05, x + hw * 1.05, y0, y0 + h * 0.2, z - hz * 1.02, z + hz * 1.02, colour, pbr);
  emitBox(b, f, x - hw * 1.3, x + hw * 1.3, y0 + h * 0.2, y0 + h * 0.6, z - hz * 1.2, z + hz * 1.2, colour, pbr);
  emitBox(b, f, x - hw * 1.6, x + hw * 1.6, y0 + h * 0.6, y1, z - hz * 1.45, z + hz * 1.45, colour, pbr);
  // Simplified acanthus leaves around the bell (fewer at far detail).
  const leaves = detail === 'far' ? 4 : 8;
  for (let i = 0; i < leaves; i++) {
    const a = (i / leaves) * Math.PI * 2;
    const lx = x + Math.cos(a) * hw * 1.05, lz = z + Math.sin(a) * hz * 1.05;
    emitBox(b, f, lx - hw * 0.16, lx + hw * 0.16, y0 + h * 0.18, y0 + h * 0.58,
      lz - hz * (0.16 + Math.abs(Math.sin(a)) * 0.1), lz + hz * (0.16 + Math.abs(Math.sin(a)) * 0.1), colour, pbr);
  }
}

export interface BalustradeSpec {
  x0: number;
  x1: number;
  /** Base height of the balustrade. */
  y: number;
  h: number;
  /** Baluster centre-to-centre spacing; default 0.4 m. */
  balusterSpacing?: number;
  /** Bottom and top rails; default true. */
  rail?: boolean;
  colour: Color;
  pbr?: number;
  detail?: Detail;
}

/** A rail with 6-sided lathe balusters. Rails and balusters are closed solids. */
export function balustrade(b: KitBuilder, f: Frame, spec: BalustradeSpec): void {
  const { x0, x1, y, h, colour } = spec;
  if (!(x1 > x0) || h <= 0) return;
  const pbr = spec.pbr ?? -1;
  const detail = spec.detail ?? 'near';
  const sides = Math.max(3, detailSegments(6, detail));
  const railH = Math.min(0.14, h * 0.18);
  const spacing = Math.max(0.15, spec.balusterSpacing ?? 0.4);
  if (spec.rail !== false) {
    emitBox(b, f, x0, x1, y, y + railH, -0.14, 0.14, colour, pbr);
    emitBox(b, f, x0, x1, y + h - railH, y + h, -0.16, 0.16, colour, pbr);
  }
  const count = Math.max(1, Math.round((x1 - x0) / spacing));
  const step = (x1 - x0) / count;
  const bottom = y + railH, top = y + h - railH;
  const profile: readonly [t: number, r: number][] = [[0, 0.055], [0.25, 0.085], [0.7, 0.045], [1, 0.05]];
  const width = step * 0.5;
  for (let n = 0; n < count; n++) {
    const cx = x0 + (n + 0.5) * step;
    const rings: Vec3[][] = profile.map(([t, rr]) => {
      const yy = bottom + (top - bottom) * t;
      const pts: Vec3[] = [];
      for (let i = 0; i < sides; i++) {
        const a = (i / sides) * Math.PI * 2;
        pts.push(f.toWorld(cx + Math.cos(a) * Math.min(rr, width), yy, Math.sin(a) * Math.min(rr, width)));
      }
      return pts;
    });
    for (let s = 0; s + 1 < rings.length; s++) {
      const a = rings[s]!, c = rings[s + 1]!;
      for (let i = 0; i < sides; i++) {
        const j = (i + 1) % sides;
        b.quad(a[i]!, c[i]!, c[j]!, a[j]!, undefined, undefined, colour, pbr);
      }
    }
    const bottomC = f.toWorld(cx, bottom, 0), topC = f.toWorld(cx, top, 0);
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      b.tri(bottomC, rings[0]![i]!, rings[0]![j]!, undefined, undefined, colour, pbr);
      b.tri(topC, rings[rings.length - 1]![j]!, rings[rings.length - 1]![i]!, undefined, undefined, colour, pbr);
    }
  }
}

export interface PedimentSpec {
  x0: number;
  x1: number;
  /** Base height of the triangle. */
  y: number;
  h: number;
  /** Depth back from the front face at z = 0. */
  depth: number;
  colour: Color;
  tympanumColour?: Color;
  pbr?: number;
}

/** A closed triangular pediment: tympanum face, raking cornice slopes, back and underside. */
export function pediment(b: KitBuilder, f: Frame, spec: PedimentSpec): void {
  const { x0, x1, y, h, depth, colour } = spec;
  if (!(x1 > x0) || h <= 0) return;
  const pbr = spec.pbr ?? -1;
  const d = -Math.max(0, depth);
  const cx = (x0 + x1) / 2;
  const w = (lx: number, ly: number, lz: number) => f.toWorld(lx, ly, lz);
  b.tri(w(x0, y, 0), w(x1, y, 0), w(cx, y + h, 0), undefined, undefined, spec.tympanumColour ?? colour, pbr);
  b.tri(w(x1, y, d), w(x0, y, d), w(cx, y + h, d), undefined, undefined, colour, pbr);
  b.quad(w(x0, y, d), w(x1, y, d), w(x1, y, 0), w(x0, y, 0), undefined, undefined, colour, pbr);
  b.quad(w(x0, y, 0), w(cx, y + h, 0), w(cx, y + h, d), w(x0, y, d), undefined, undefined, colour, pbr);
  b.quad(w(cx, y + h, 0), w(x1, y, 0), w(x1, y, d), w(cx, y + h, d), undefined, undefined, colour, pbr);
}

export interface ColonnadePorticoSpec {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** Number of columns across the front. */
  columns: number;
  /** Portico projection from the wall. */
  depth: number;
  columnR?: number;
  capital?: Capital;
  /** Pediment height; 0 or absent leaves the portico flat-topped. */
  pedimentH?: number;
  colour: Color;
  tympanumColour?: Color;
  pbr?: number;
  detail?: Detail;
}

/** Columns + entablature + optional pediment, all in one frame. The back of the portico is left open to the wall. */
export function colonnadePortico(b: KitBuilder, f: Frame, spec: ColonnadePorticoSpec): void {
  const { x0, x1, y0, y1, colour } = spec;
  if (!(x1 > x0) || !(y1 > y0)) return;
  const pbr = spec.pbr ?? -1;
  const detail = spec.detail ?? 'near';
  const r = spec.columnR ?? Math.min(0.45, (y1 - y0) * 0.055);
  const count = Math.max(2, Math.round(spec.columns));
  const margin = r * 1.6;
  const usable = Math.max(0, x1 - x0 - margin * 2);
  for (let i = 0; i < count; i++) {
    const x = count === 1 ? (x0 + x1) / 2 : x0 + margin + (usable * i) / (count - 1);
    column(b, f, {
      x, z: spec.depth, y0, y1, r, capital: spec.capital ?? 'plain', colour, pbr, detail,
    });
  }
  const entH = Math.max(0.35, (y1 - y0) * 0.09);
  emitBox(b, f, x0, x1, y1, y1 + entH, 0, spec.depth + r * 1.5, colour, pbr, { back: false, bottom: false });
  if (spec.pedimentH && spec.pedimentH > 0) {
    const front = spec.depth + r * 1.5;
    const pf = frameAt(f, 0, y1 + entH, front);
    pediment(b, pf, {
      x0, x1, y: 0, h: spec.pedimentH, depth: front, colour, tympanumColour: spec.tympanumColour ?? colour, pbr,
    });
  }
}

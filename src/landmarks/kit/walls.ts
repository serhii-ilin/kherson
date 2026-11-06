/**
 * Walls: a facade plane split around openings, plus solid slabs and prisms.
 *
 * The wall plane lies at frame z = 0 and faces +z. A hole is cut by vertical strips whose x cuts include every
 * opening edge and the arch subdivisions, so no two wall faces overlap and the spandrels follow an arched head as a
 * short polyline. Openings must not overlap each other (each strip is split vertically). With `thickness > 0` a back
 * plane and the four perimeter edges are added; opening reveals are left to `addOpening`, so the shell is closed
 * only around the perimeter, not through the holes.
 */
import type { Color } from '../shapes.ts';
import { emitBox, type Detail, type Frame, type KitBuilder, type Vec2 } from './builder.ts';
import { openingTop, type OpeningShape } from './openings.ts';

export interface WallOpening {
  x: number;
  y: number;
  w: number;
  h: number;
  shape: OpeningShape;
  /** Per-opening LOD, overriding the wall's. */
  detail?: Detail;
  /** Arch segments, matching `Opening.segments` so the cut and its lining line up; defaults 8 near / 4 far. */
  segments?: number;
}

export interface WallWithOpeningsSpec {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  openings?: readonly WallOpening[];
  /** Adds a back plane and perimeter edges; default 0 (a single facade plane). */
  thickness?: number;
  colour: Color;
  pbr?: number;
  /** Photo mapping over x0..x1 × y0..y1; without it UVs are metres in the wall plane. */
  photo?: { u0: number; u1: number; v0: number; v1: number };
  detail?: Detail;
}

interface Hole {
  x0: number;
  x1: number;
  bottom: number;
  /** The original opening, for `openingTop` (which needs its unclamped x/w). */
  o: WallOpening;
}

export function wallWithOpenings(b: KitBuilder, f: Frame, spec: WallWithOpeningsSpec): void {
  const { x0, x1, y0, y1, colour } = spec;
  if (!(x1 > x0) || !(y1 > y0)) return;
  const pbr = spec.pbr ?? -1;
  const detail = spec.detail ?? 'near';
  const w = (lx: number, ly: number, lz: number) => f.toWorld(lx, ly, lz);
  const uv = (x: number, y: number): Vec2 => {
    if (!spec.photo) return [x, y];
    const { u0, u1, v0, v1 } = spec.photo;
    return [u0 + ((x - x0) / (x1 - x0)) * (u1 - u0), v0 + ((y - y0) / (y1 - y0)) * (v1 - v0)];
  };

  const holes: Hole[] = [];
  const cuts = new Set<number>([x0, x1]);
  for (const o of spec.openings ?? []) {
    if (o.w <= 0 || o.h <= 0) continue;
    const left = Math.max(x0, o.x), right = Math.min(x1, o.x + o.w);
    if (right <= left) continue;
    if (o.y >= y1 || openingTop(o, o.x + o.w / 2) <= y0) continue;
    holes.push({ x0: left, x1: right, bottom: o.y, o });
    cuts.add(left); cuts.add(right);
    if (o.shape !== 'rect') {
      const n = Math.max(2, Math.round(o.segments ?? ((o.detail ?? detail) === 'far' ? 4 : 8)));
      for (let i = 1; i < n; i++) cuts.add(left + ((right - left) * i) / n);
    }
  }
  const xs = [...cuts].sort((a, b) => a - b);

  /** One wall quad from a (possibly sloped) bottom edge up to a (possibly sloped) top edge, facing +z. */
  const face = (xa: number, ybA: number, xb: number, ybB: number, ytA: number, ytB: number, z: number, back: boolean): void => {
    if (xb - xa < 1e-9) return;
    if (ytA - ybA < 1e-9 && ytB - ybB < 1e-9) return;
    const uvs: [Vec2, Vec2, Vec2, Vec2] = back
      ? [uv(xb, ybB), uv(xa, ybA), uv(xa, ytA), uv(xb, ytB)]
      : [uv(xa, ybA), uv(xb, ybB), uv(xb, ytB), uv(xa, ytA)];
    if (back) {
      b.quad(w(xb, ybB, z), w(xa, ybA, z), w(xa, ytA, z), w(xb, ytB, z), undefined, uvs, colour, pbr);
    } else {
      b.quad(w(xa, ybA, z), w(xb, ybB, z), w(xb, ytB, z), w(xa, ytA, z), undefined, uvs, colour, pbr);
    }
  };

  /** One plane (front or back) split into strips around the same holes. */
  const emitPlane = (z: number, back: boolean): void => {
    for (let i = 0; i < xs.length - 1; i++) {
      const xa = xs[i]!, xb = xs[i + 1]!;
      if (xb - xa < 1e-9) continue;
      const strip = holes
        .filter((h) => h.x0 <= xa + 1e-9 && h.x1 >= xb - 1e-9)
        .sort((a, b2) => a.bottom - b2.bottom);
      let cursor = y0;
      for (let k = 0; k < strip.length; k++) {
        const h = strip[k]!;
        const bottom = Math.max(y0, h.bottom);
        const next = strip[k + 1];
        const nextBottom = next ? Math.max(y0, next.bottom) : y1;
        const topA = Math.min(y1, openingTop(h.o, xa));
        const topB = Math.min(y1, openingTop(h.o, xb));
        if (bottom > cursor + 1e-9) face(xa, cursor, xb, cursor, bottom, bottom, z, back);
        if (nextBottom > Math.max(topA, topB) + 1e-9) {
          face(xa, topA, xb, topB, nextBottom, nextBottom, z, back);
        }
        cursor = Math.max(cursor, nextBottom);
      }
      if (y1 > cursor + 1e-9) face(xa, cursor, xb, cursor, y1, y1, z, back);
    }
  };

  emitPlane(0, false);
  const thickness = Math.max(0, spec.thickness ?? 0);
  if (thickness > 0) {
    emitPlane(-thickness, true);
    // Perimeter: bottom, top, left and right, each a single quad. The winding is chosen to face outward.
    b.quad(w(x0, y0, -thickness), w(x1, y0, -thickness), w(x1, y0, 0), w(x0, y0, 0), undefined, undefined, colour, pbr);
    b.quad(w(x0, y1, 0), w(x1, y1, 0), w(x1, y1, -thickness), w(x0, y1, -thickness), undefined, undefined, colour, pbr);
    b.quad(w(x0, y0, -thickness), w(x0, y0, 0), w(x0, y1, 0), w(x0, y1, -thickness), undefined, undefined, colour, pbr);
    b.quad(w(x1, y0, 0), w(x1, y0, -thickness), w(x1, y1, -thickness), w(x1, y1, 0), undefined, undefined, colour, pbr);
  }
}

export interface SlabSpec {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /**
   * Back (wall-side) plane; it must be the smaller value. With the default front at z1 = 0 the back therefore lies
   * at z0 = −0.2, i.e. z0 ≤ z1; reversing them would invert every side face.
   */
  z0?: number;
  /** Front (outward) plane; defaults to 0. */
  z1?: number;
  colour: Color;
  pbr?: number;
  bottom?: boolean;
  top?: boolean;
  front?: boolean;
  back?: boolean;
  left?: boolean;
  right?: boolean;
}

/** A thin box (a string course, pavement slab, floor band) with metre UVs. All faces by default. */
export function slab(b: KitBuilder, f: Frame, spec: SlabSpec): void {
  const z1 = spec.z1 ?? 0;
  emitBox(b, f, spec.x0, spec.x1, spec.y0, spec.y1, spec.z0 ?? z1 - 0.2, z1, spec.colour, spec.pbr ?? -1, spec);
}

/** A general prism box with metre UVs; all faces by default. Omit faces that sit on a wall/roof at the call site. */
export function boxPrism(b: KitBuilder, f: Frame, spec: SlabSpec): void {
  emitBox(b, f, spec.x0, spec.x1, spec.y0, spec.y1, spec.z0 ?? -0.2, spec.z1 ?? 0, spec.colour, spec.pbr ?? -1, spec);
}

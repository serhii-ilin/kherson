/**
 * Roofs: hipped, gabled and mansard roofs over a frame-local rectangle, a flat roof with a parapet over an
 * arbitrary local polygon (earcut), and a blank attic storey.
 *
 * Roofs are shells over an eave/roof plane: the underside is never emitted (it is hidden by the building), and the
 * hip/gable/mansard shells are open along the eaves for the same reason. The flat roof's top is a triangulated
 * polygon with upward normals; its parapet is a ring of closed boxes (bottom faces omitted on the roof deck).
 */
import { Earcut } from 'three/src/extras/Earcut.js';
import type { Color } from '../shapes.ts';
import { emitBox, frameAt, type Frame, type KitBuilder, type Vec3 } from './builder.ts';

export interface RoofSpec {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  /** Eave height. */
  y: number;
  /** Ridge height above the eaves. */
  rise: number;
  /** Eave overhang; default 0.4 m. */
  overhang?: number;
  colour: Color;
  pbr?: number;
}

interface Eaves {
  x0: number; x1: number; z0: number; z1: number; y: number; rise: number; ridgeAlongX: boolean;
}

function eaves(spec: RoofSpec): Eaves {
  const o = Math.max(0, spec.overhang ?? 0.4);
  return {
    x0: spec.x0 - o, x1: spec.x1 + o, z0: spec.z0 - o, z1: spec.z1 + o,
    y: spec.y, rise: Math.max(0.05, spec.rise), ridgeAlongX: spec.x1 - spec.x0 >= spec.z1 - spec.z0,
  };
}

/** Four hipped slopes over a rectangle, ridge along the longer side. Eaves are open (no underside). */
export function hipRoof(b: KitBuilder, f: Frame, spec: RoofSpec): void {
  const e = eaves(spec);
  const pbr = spec.pbr ?? -1;
  const w = e.x1 - e.x0, d = e.z1 - e.z0;
  if (!(w > 0) || !(d > 0)) return;
  const wpt = (lx: number, ly: number, lz: number) => f.toWorld(lx, ly, lz);
  if (e.ridgeAlongX) {
    const inset = d / 2, zmid = (e.z0 + e.z1) / 2, ry = e.y + e.rise;
    const r0 = wpt(e.x0 + inset, ry, zmid), r1 = wpt(e.x1 - inset, ry, zmid);
    b.quad(wpt(e.x0, e.y, e.z1), wpt(e.x1, e.y, e.z1), r1, r0, undefined, undefined, spec.colour, pbr);
    b.quad(wpt(e.x1, e.y, e.z0), wpt(e.x0, e.y, e.z0), r0, r1, undefined, undefined, spec.colour, pbr);
    b.tri(wpt(e.x0, e.y, e.z0), wpt(e.x0, e.y, e.z1), r0, undefined, undefined, spec.colour, pbr);
    b.tri(wpt(e.x1, e.y, e.z1), wpt(e.x1, e.y, e.z0), r1, undefined, undefined, spec.colour, pbr);
    return;
  }
  const inset = w / 2, xmid = (e.x0 + e.x1) / 2, ry = e.y + e.rise;
  const r0 = wpt(xmid, ry, e.z0 + inset), r1 = wpt(xmid, ry, e.z1 - inset);
  b.quad(wpt(e.x1, e.y, e.z1), wpt(e.x1, e.y, e.z0), r0, r1, undefined, undefined, spec.colour, pbr);
  b.quad(wpt(e.x0, e.y, e.z0), wpt(e.x0, e.y, e.z1), r1, r0, undefined, undefined, spec.colour, pbr);
  b.tri(wpt(e.x0, e.y, e.z0), wpt(e.x1, e.y, e.z0), r0, undefined, undefined, spec.colour, pbr);
  b.tri(wpt(e.x0, e.y, e.z1), wpt(e.x1, e.y, e.z1), r1, undefined, undefined, spec.colour, pbr);
}

/** Two slopes and two triangular gable ends; underside open. */
export function gableRoof(b: KitBuilder, f: Frame, spec: RoofSpec): void {
  const e = eaves(spec);
  const pbr = spec.pbr ?? -1;
  const w = e.x1 - e.x0, d = e.z1 - e.z0;
  if (!(w > 0) || !(d > 0)) return;
  const wpt = (lx: number, ly: number, lz: number) => f.toWorld(lx, ly, lz);
  if (e.ridgeAlongX) {
    const ry = e.y + e.rise, zmid = (e.z0 + e.z1) / 2;
    b.quad(wpt(e.x0, e.y, e.z1), wpt(e.x1, e.y, e.z1), wpt(e.x1, ry, zmid), wpt(e.x0, ry, zmid), undefined, undefined, spec.colour, pbr);
    b.quad(wpt(e.x1, e.y, e.z0), wpt(e.x0, e.y, e.z0), wpt(e.x0, ry, zmid), wpt(e.x1, ry, zmid), undefined, undefined, spec.colour, pbr);
    b.tri(wpt(e.x0, e.y, e.z0), wpt(e.x0, e.y, e.z1), wpt(e.x0, ry, zmid), undefined, undefined, spec.colour, pbr);
    b.tri(wpt(e.x1, e.y, e.z1), wpt(e.x1, e.y, e.z0), wpt(e.x1, ry, zmid), undefined, undefined, spec.colour, pbr);
    return;
  }
  const ry = e.y + e.rise, xmid = (e.x0 + e.x1) / 2;
  b.quad(wpt(e.x1, e.y, e.z1), wpt(e.x1, e.y, e.z0), wpt(xmid, ry, e.z0), wpt(xmid, ry, e.z1), undefined, undefined, spec.colour, pbr);
  b.quad(wpt(e.x0, e.y, e.z0), wpt(e.x0, e.y, e.z1), wpt(xmid, ry, e.z1), wpt(xmid, ry, e.z0), undefined, undefined, spec.colour, pbr);
  b.tri(wpt(e.x1, e.y, e.z0), wpt(e.x0, e.y, e.z0), wpt(xmid, ry, e.z0), undefined, undefined, spec.colour, pbr);
  b.tri(wpt(e.x0, e.y, e.z1), wpt(e.x1, e.y, e.z1), wpt(xmid, ry, e.z1), undefined, undefined, spec.colour, pbr);
}

/** A mansard: steep lower slopes, shallow upper slopes and a flat deck. Under-eave faces are open. */
export function mansardRoof(b: KitBuilder, f: Frame, spec: RoofSpec): void {
  const e = eaves(spec);
  const pbr = spec.pbr ?? -1;
  const w = e.x1 - e.x0, d = e.z1 - e.z0;
  if (!(w > 0) || !(d > 0)) return;
  const wpt = (lx: number, ly: number, lz: number) => f.toWorld(lx, ly, lz);
  const inset = Math.min(w, d) * 0.22;
  const mid = { x0: e.x0 + inset, x1: e.x1 - inset, z0: e.z0 + inset, z1: e.z1 - inset, y: e.y + e.rise * 0.62 };
  const top = { x0: mid.x0 + inset * 0.75, x1: mid.x1 - inset * 0.75, z0: mid.z0 + inset * 0.75, z1: mid.z1 - inset * 0.75, y: e.y + e.rise };
  const ring = (r: { x0: number; x1: number; z0: number; z1: number }, y: number) => [
    wpt(r.x0, y, r.z1), wpt(r.x1, y, r.z1), wpt(r.x1, y, r.z0), wpt(r.x0, y, r.z0),
  ];
  const corners = (ringPoints: readonly Vec3[]) => ringPoints;
  const eb = corners(ring(e, e.y)), mb = corners(ring(mid, mid.y)), tb = corners(ring(top, top.y));
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    b.quad(eb[i]!, eb[j]!, mb[j]!, mb[i]!, undefined, undefined, spec.colour, pbr);
    b.quad(mb[i]!, mb[j]!, tb[j]!, tb[i]!, undefined, undefined, spec.colour, pbr);
  }
  b.quad(tb[0]!, tb[1]!, tb[2]!, tb[3]!, undefined, undefined, spec.colour, pbr);
}

export interface FlatRoofSpec {
  /** Local x/z polygon (outer ring, counter-clockwise or clockwise). */
  ring: readonly (readonly [number, number])[];
  y: number;
  /** Parapet height; 0 for none. */
  parapetH?: number;
  /** Parapet wall thickness; default 0.3 m. */
  thickness?: number;
  colour: Color;
  pbr?: number;
}

/**
 * A flat deck over an arbitrary local polygon, triangulated with Earcut, ringed by a parapet. The deck faces up and
 * the parapet boxes omit their bottoms (they sit on the deck). No underside is emitted.
 */
export function flatRoofWithParapet(b: KitBuilder, f: Frame, spec: FlatRoofSpec): void {
  const ring = spec.ring;
  if (ring.length < 3) return;
  const pbr = spec.pbr ?? -1;
  const data: number[] = [];
  for (const [x, z] of ring) data.push(x, z);
  const tris = Earcut.triangulate(data, undefined, 2);
  for (let t = 0; t + 2 < tris.length; t += 3) {
    const ia = tris[t]!, ib = tris[t + 1]!, ic = tris[t + 2]!;
    const a = ring[ia]!, c = ring[ib]!, d = ring[ic]!;
    // Earcut keeps the input winding; force the deck to face up.
    const crossY = (c[1] - a[1]) * (d[0] - a[0]) - (c[0] - a[0]) * (d[1] - a[1]);
    const order = crossY >= 0 ? [a, c, d] : [a, d, c];
    b.tri(
      f.toWorld(order[0]![0], spec.y, order[0]![1]),
      f.toWorld(order[1]![0], spec.y, order[1]![1]),
      f.toWorld(order[2]![0], spec.y, order[2]![1]),
      [0, 1, 0], undefined, spec.colour, pbr,
    );
  }
  const parapet = Math.max(0, spec.parapetH ?? 0);
  if (parapet > 0) {
    const t = Math.max(0.05, spec.thickness ?? 0.3);
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!, c = ring[(i + 1) % ring.length]!;
      const dx = c[0] - a[0], dz = c[1] - a[1];
      const len = Math.hypot(dx, dz);
      if (len < 1e-6) continue;
      const g = frameAt(f, (a[0] + c[0]) / 2, spec.y, (a[1] + c[1]) / 2, Math.atan2(-dz, dx));
      emitBox(b, g, -len / 2, len / 2, 0, parapet, -t / 2, t / 2, spec.colour, pbr, { bottom: false });
    }
  }
}

export interface AtticSpec {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  y: number;
  h: number;
  colour: Color;
  pbr?: number;
}

/** A blank attic storey above a cornice, with a slim top lip. Closed on all six faces. */
export function attic(b: KitBuilder, f: Frame, spec: AtticSpec): void {
  if (!(spec.x1 > spec.x0) || !(spec.z1 > spec.z0) || spec.h <= 0) return;
  const pbr = spec.pbr ?? -1;
  emitBox(b, f, spec.x0, spec.x1, spec.y, spec.y + spec.h, spec.z0, spec.z1, spec.colour, pbr);
  const lip = Math.min(0.18, spec.h * 0.15);
  emitBox(b, f, spec.x0 - 0.12, spec.x1 + 0.12, spec.y + spec.h, spec.y + spec.h + lip,
    spec.z0 - 0.12, spec.z1 + 0.12, spec.colour, pbr);
}

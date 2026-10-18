import type { LandmarkMeshBuilder } from './types.ts';

export type Color = readonly [number, number, number];
export interface Vec { x: number; y: number; z: number; }
/** Horizontal frame: `u` and `v` are unit vectors in the x/z plane, v = u turned +90°. */
export interface Frame { x: number; z: number; ux: number; uz: number; vx: number; vz: number; }

export function frameAt(x: number, z: number, angle: number): Frame {
  const ux = Math.cos(angle), uz = Math.sin(angle);
  return { x, z, ux, uz, vx: -uz, vz: ux };
}

export function at(f: Frame, a: number, c: number, y: number): Vec {
  return { x: f.x + f.ux * a + f.vx * c, y, z: f.z + f.uz * a + f.vz * c };
}

export function toFrame(f: Frame, x: number, z: number): [number, number] {
  const dx = x - f.x, dz = z - f.z;
  return [dx * f.ux + dz * f.uz, dx * f.vx + dz * f.vz];
}

const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const cross = (a: Vec, b: Vec): Vec => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const dot = (a: Vec, b: Vec): number => a.x * b.x + a.y * b.y + a.z * b.z;

/** Flat quad whose winding and normal are made to face `hint` (an outward direction). Degenerate quads are dropped. */
export function face(b: LandmarkMeshBuilder, v0: Vec, v1: Vec, v2: Vec, v3: Vec, hint: Vec, color: Color): void {
  let n = cross(sub(v1, v0), sub(v2, v0));
  if (dot(n, n) < 1e-12) n = cross(sub(v2, v0), sub(v3, v0));
  const len = Math.sqrt(dot(n, n));
  if (len < 1e-6) return;
  let quad = [v0, v1, v2, v3];
  if (dot(n, hint) < 0) { quad = [v0, v3, v2, v1]; n = { x: -n.x, y: -n.y, z: -n.z }; }
  const nx = n.x / len, ny = n.y / len, nz = n.z / len;
  const vtx = (v: Vec) => ({ x: v.x, y: v.y, z: v.z, nx, ny, nz });
  b.addQuad([vtx(quad[0]!), vtx(quad[1]!), vtx(quad[2]!), vtx(quad[3]!)], color);
}

/**
 * Convex hexahedron from a bottom and a top ring (each [a0c0, a1c0, a1c1, a0c1]).
 * Covers boxes, sheared posts, tapering pylons and wedges; `bottom = false` skips the underside.
 */
export function hexa(b: LandmarkMeshBuilder, bot: readonly Vec[], top: readonly Vec[], color: Color, bottom = true): void {
  const all = [...bot, ...top];
  const centre = { x: 0, y: 0, z: 0 };
  for (const p of all) { centre.x += p.x / 8; centre.y += p.y / 8; centre.z += p.z / 8; }
  const quad = (p: readonly Vec[]) => {
    const m = { x: (p[0]!.x + p[1]!.x + p[2]!.x + p[3]!.x) / 4, y: (p[0]!.y + p[1]!.y + p[2]!.y + p[3]!.y) / 4, z: (p[0]!.z + p[1]!.z + p[2]!.z + p[3]!.z) / 4 };
    face(b, p[0]!, p[1]!, p[2]!, p[3]!, sub(m, centre), color);
  };
  quad([top[0]!, top[1]!, top[2]!, top[3]!]);
  if (bottom) quad([bot[0]!, bot[1]!, bot[2]!, bot[3]!]);
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    quad([bot[i]!, bot[j]!, top[j]!, top[i]!]);
  }
}

/** Box in a frame: a/c ranges, y range, optional top offsets (shear) and top inset (taper). */
export function fbox(
  b: LandmarkMeshBuilder, f: Frame, a0: number, a1: number, c0: number, c1: number, y0: number, y1: number, color: Color,
  bottom = true,
): void {
  hexa(b, ring(f, a0, a1, c0, c1, y0), ring(f, a0, a1, c0, c1, y1), color, bottom);
}

export function ring(f: Frame, a0: number, a1: number, c0: number, c1: number, y: number): Vec[] {
  return [at(f, a0, c0, y), at(f, a1, c0, y), at(f, a1, c1, y), at(f, a0, c1, y)];
}

/** Round (or conical, r0 ≠ r1) tube between two points; caps are optional. */
export function tube(
  b: LandmarkMeshBuilder, p0: Vec, p1: Vec, r0: number, r1: number, color: Color, segments = 8, caps = true,
): void {
  const d = sub(p1, p0);
  const len = Math.sqrt(dot(d, d));
  if (len < 1e-6) return;
  const dn = { x: d.x / len, y: d.y / len, z: d.z / len };
  const ref = Math.abs(dn.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  let e1 = cross(dn, ref);
  const l1 = Math.sqrt(dot(e1, e1));
  e1 = { x: e1.x / l1, y: e1.y / l1, z: e1.z / l1 };
  const e2 = cross(dn, e1);
  const pt = (c: Vec, r: number, t: number): Vec => {
    const ct = Math.cos(t), st = Math.sin(t);
    return { x: c.x + (e1.x * ct + e2.x * st) * r, y: c.y + (e1.y * ct + e2.y * st) * r, z: c.z + (e1.z * ct + e2.z * st) * r };
  };
  for (let i = 0; i < segments; i++) {
    const t0 = (i / segments) * Math.PI * 2, t1 = ((i + 1) / segments) * Math.PI * 2, tm = (t0 + t1) / 2;
    const hint = { x: e1.x * Math.cos(tm) + e2.x * Math.sin(tm), y: e1.y * Math.cos(tm) + e2.y * Math.sin(tm), z: e1.z * Math.cos(tm) + e2.z * Math.sin(tm) };
    face(b, pt(p0, r0, t0), pt(p0, r0, t1), pt(p1, r1, t1), pt(p1, r1, t0), hint, color);
    if (caps) {
      if (r1 > 0) face(b, p1, p1, pt(p1, r1, t0), pt(p1, r1, t1), dn, color);
      if (r0 > 0) face(b, p0, p0, pt(p0, r0, t1), pt(p0, r0, t0), { x: -dn.x, y: -dn.y, z: -dn.z }, color);
    }
  }
}

/** A polyline of tubes (arcs, scrolls, rails). */
export function tubePath(b: LandmarkMeshBuilder, pts: readonly Vec[], r: number, color: Color, segments = 6): void {
  for (let i = 1; i < pts.length; i++) tube(b, pts[i - 1]!, pts[i]!, r, r, color, segments, false);
}

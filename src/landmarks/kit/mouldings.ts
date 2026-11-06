/**
 * Mouldings: swept profiles for cornices, string courses, plinths and architraves, plus rusticated wall bands.
 *
 * A profile is a section in the frame's local z/y plane (`z` measured outward along the path's left normal, `y` up).
 * It is extruded along a local x/z polyline; at each bend the section is mitred (scaled by 1/cos of the half-angle)
 * so neighbouring segments meet without gaps. Open sweeps are open at their two ends; closed sweeps are seamless.
 * No caps are emitted, so a sweep is not a closed solid.
 */
import type { Color } from '../shapes.ts';
import { emitBox, frameAt, type Frame, type KitBuilder, type Vec3 } from './builder.ts';

export type ProfilePoint = readonly [z: number, y: number];
export type PathPoint = readonly [x: number, z: number];

export interface DentilOptions {
  /** Centre-to-centre spacing in metres. */
  spacing: number;
  /** Protrusion beyond the profile; default 0.08. */
  depth?: number;
  /** Dentil height; default 0.1. */
  height?: number;
  /** Dentil width along the path; default 0.45 × spacing. */
  width?: number;
  /** Lateral offset (profile z) of the dentil front; default the deepest profile point minus the depth. */
  z?: number;
  /** Vertical centre (profile y); default the middle of the profile. */
  y?: number;
}

export interface SweepProfileOptions {
  dentils?: DentilOptions;
}

/** A simple cavetto-and-fillet cornice, 0.22 m high and 0.2 m proud. */
export const CORNICE_SIMPLE: readonly ProfilePoint[] = [
  [0, 0], [0.2, 0], [0.2, 0.05], [0.12, 0.09], [0.12, 0.22], [0, 0.22],
];

/** A dentilled cornice: a recessed fascia between two fillets, ready for `dentils` boxes. */
export const CORNICE_DENTIL: readonly ProfilePoint[] = [
  [0, 0], [0.24, 0], [0.24, 0.05], [0.1, 0.09], [0.1, 0.22], [0.24, 0.26], [0.24, 0.3], [0, 0.3],
];

/** A small flat string course, 0.1 m high and 0.1 m proud. */
export const STRING_COURSE: readonly ProfilePoint[] = [[0, 0], [0.1, 0], [0.1, 0.1], [0, 0.1]];

/** A plain plinth, 0.55 m high and 0.14 m proud. */
export const PLINTH: readonly ProfilePoint[] = [[0, 0], [0.14, 0], [0.14, 0.55], [0, 0.55]];

/** An architrave with a small fascia and a chamfer, 0.2 m high and 0.1 m proud. */
export const ARCHITRAVE: readonly ProfilePoint[] = [[0, 0], [0.1, 0], [0.1, 0.16], [0.05, 0.2], [0, 0.2]];

function segmentNormal(a: PathPoint, b: PathPoint): [number, number] {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const len = Math.hypot(dx, dz) || 1;
  return [-dz / len, dx / len];
}

/** Mitre vector (unit-ish, already scaled) at every path vertex. */
function mitres(path: readonly PathPoint[], closed: boolean): [number, number][] {
  const n = path.length;
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const prev = closed ? path[(i - 1 + n) % n]! : path[Math.max(0, i - 1)]!;
    const here = path[i]!;
    const next = closed ? path[(i + 1) % n]! : path[Math.min(n - 1, i + 1)]!;
    const atStart = !closed && i === 0;
    const atEnd = !closed && i === n - 1;
    if (atStart || atEnd) {
      const other = atStart ? next : prev;
      if (other[0] === here[0] && other[1] === here[1]) { out.push([0, 0]); continue; }
      const nrm = atStart ? segmentNormal(here, next) : segmentNormal(prev, here);
      out.push(nrm);
      continue;
    }
    const nIn = segmentNormal(prev, here);
    const nOut = segmentNormal(here, next);
    let mx = nIn[0] + nOut[0], mz = nIn[1] + nOut[1];
    let len = Math.hypot(mx, mz);
    if (len < 1e-9) { out.push(nOut); continue; }
    mx /= len; mz /= len;
    const denom = mx * nIn[0] + mz * nIn[1];
    const scale = Math.abs(denom) > 0.25 ? Math.min(3, Math.max(0.25, 1 / denom)) : 1;
    out.push([mx * scale, mz * scale]);
  }
  return out;
}

/**
 * Sweeps `profile` along `path` (frame-local). `closed` joins the last path point back to the first. `pbr` is the
 * layer for the whole sweep; `options.dentils` adds evenly spaced blocks along the path.
 */
export function sweepProfile(
  b: KitBuilder, f: Frame, profile: readonly ProfilePoint[], path: readonly PathPoint[], closed: boolean,
  colour: Color, pbr = -1, options: SweepProfileOptions = {},
): void {
  if (profile.length < 2 || path.length < 2) return;
  const m = mitres(path, closed);
  const rings: Vec3[][] = path.map((p, i) => profile.map(([pz, py]) =>
    f.toWorld(p[0] + m[i]![0] * pz, py, p[1] + m[i]![1] * pz)));
  const segments = closed ? path.length : path.length - 1;
  for (let s = 0; s < segments; s++) {
    const a = rings[s]!, c = rings[(s + 1) % path.length]!;
    for (let k = 0; k + 1 < profile.length; k++) {
      b.quad(a[k]!, c[k]!, c[k + 1]!, a[k + 1]!, undefined, undefined, colour, pbr);
    }
  }
  if (options.dentils) dentils(b, f, profile, path, segments, colour, pbr, options.dentils);
}

/** Evens spaced blocks along each path segment, aligned with the segment. */
function dentils(
  b: KitBuilder, f: Frame, profile: readonly ProfilePoint[], path: readonly PathPoint[], segments: number,
  colour: Color, pbr: number, d: DentilOptions,
): void {
  const spacing = Math.max(0.05, d.spacing);
  const depth = d.depth ?? 0.08;
  const height = d.height ?? 0.1;
  const width = d.width ?? spacing * 0.45;
  const maxZ = Math.max(...profile.map((p) => p[0]));
  const minY = Math.min(...profile.map((p) => p[1]));
  const maxY = Math.max(...profile.map((p) => p[1]));
  const z = d.z ?? Math.max(0, maxZ - depth);
  const y = d.y ?? (minY + maxY) / 2;
  for (let s = 0; s < segments; s++) {
    const a = path[s]!, c = path[(s + 1) % path.length]!;
    const dx = c[0] - a[0], dz = c[1] - a[1];
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) continue;
    const nx = -dz / len, nz = dx / len;
    const yaw = Math.atan2(nx, nz);
    const count = Math.max(1, Math.floor(len / spacing));
    const step = len / count;
    for (let i = 0; i < count; i++) {
      const t = (i + 0.5) * step / len;
      const px = a[0] + dx * t, pz = a[1] + dz * t;
      const g = frameAt(f, px, y, pz, yaw);
      emitBox(b, g, -width / 2, width / 2, -height / 2, height / 2, z, z + depth, colour, pbr);
    }
  }
}

export interface RusticationSpec {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** Nominal course height; the courses are resized to fit y0..y1 exactly. */
  courseH: number;
  /** Depth of the horizontal joints. */
  jointDepth: number;
  colour: Color;
  pbr?: number;
}

/**
 * Banded rustication: each course is a front face at z = 0 and the joints between courses are shallow grooves
 * (recessed back faces plus the two visible groove cheeks). No face overlaps another.
 */
export function rustication(b: KitBuilder, f: Frame, spec: RusticationSpec): void {
  const { x0, x1, y0, y1, colour } = spec;
  if (!(x1 > x0) || !(y1 > y0)) return;
  const pbr = spec.pbr ?? -1;
  const courses = Math.max(1, Math.round((y1 - y0) / Math.max(0.05, spec.courseH)));
  const course = (y1 - y0) / courses;
  const joint = Math.min(course * 0.12, 0.03);
  const d = Math.max(0, spec.jointDepth);
  const w = (lx: number, ly: number, lz: number) => f.toWorld(lx, ly, lz);
  for (let i = 0; i < courses; i++) {
    const ya = y0 + i * course, yb = y0 + (i + 1) * course;
    const faceTop = yb - joint;
    // Front face of the course.
    b.quad(w(x0, ya, 0), w(x1, ya, 0), w(x1, faceTop, 0), w(x0, faceTop, 0), undefined, undefined, colour, pbr);
    if (i + 1 < courses) {
      // Recessed joint face and its two cheeks.
      b.quad(w(x0, faceTop, -d), w(x1, faceTop, -d), w(x1, yb, -d), w(x0, yb, -d), undefined, undefined, colour, pbr);
      b.quad(w(x0, yb, -d), w(x1, yb, -d), w(x1, yb, 0), w(x0, yb, 0), undefined, undefined, colour, pbr);
      b.quad(w(x0, faceTop, 0), w(x1, faceTop, 0), w(x1, faceTop, -d), w(x0, faceTop, -d), undefined, undefined, colour, pbr);
    }
  }
}

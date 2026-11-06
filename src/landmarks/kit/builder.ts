/**
 * Geometry accumulator for the architectural kit (docs/BUILDINGS_PLAN.md, task H).
 *
 * Pure and DOM-free (Constitution 5.4): it builds the same attribute buffers a `LandmarkMeshData` holds and nothing
 * else. Conventions: metres, counter-clockwise front faces, normals outward, vertex colours 0..1, UVs in metres in
 * the face plane (u along the face's horizontal direction, v up; horizontal faces use world x/z).
 */
import type { Color } from '../shapes.ts';
import type { LandmarkMeshData, LandmarkMeshKind } from '../types.ts';

export type Vec3 = readonly [number, number, number];
export type Vec2 = readonly [number, number];
/** Level of detail for curved elements: `far` uses about a third of the near segment count. */
export type Detail = 'near' | 'far';

/** A local facade frame: `x` along the facade, `y` up, `z` outward from the wall. `yaw` rotates the frame. */
export interface Frame {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  toWorld(lx: number, ly: number, lz: number): Vec3;
}

/** A frame at world (x, y, z); yaw 0 means local +z is world +z, so the facade faces +z. */
export function frame(x = 0, y = 0, z = 0, yaw = 0): Frame {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return {
    x, y, z, yaw,
    toWorld(lx, ly, lz) {
      return [x + lx * c + lz * s, y + ly, z - lx * s + lz * c];
    },
  };
}

/** A frame offset inside another frame (local position plus an extra yaw), e.g. the four sides of a tower. */
export function frameAt(f: Frame, lx: number, ly: number, lz: number, yaw = 0): Frame {
  const [x, y, z] = f.toWorld(lx, ly, lz);
  return frame(x, y, z, f.yaw + yaw);
}

/** Segment count for a curved element at the requested detail; far is about a third, never fewer than 3. */
export function detailSegments(near: number, detail: Detail = 'near'): number {
  if (detail === 'near') return Math.max(3, Math.round(near));
  return Math.max(3, Math.round(near / 3));
}

const WHITE: Color = [1, 1, 1];

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Unit normal of the first non-degenerate triangle of a quad (or triangle when `d` is omitted), or null. */
function faceNormal(a: Vec3, b: Vec3, c: Vec3, d?: Vec3): Vec3 | null {
  const tri = (p: Vec3, q: Vec3, r: Vec3): Vec3 => {
    const ux = q[0] - p[0], uy = q[1] - p[1], uz = q[2] - p[2];
    const vx = r[0] - p[0], vy = r[1] - p[1], vz = r[2] - p[2];
    return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
  };
  const candidates: Vec3[] = [tri(a, b, c)];
  if (d) candidates.push(tri(a, c, d), tri(a, b, d));
  for (const n of candidates) {
    const len = Math.sqrt(dot(n, n));
    if (len > 1e-9) return [n[0] / len, n[1] / len, n[2] / len];
  }
  return null;
}

export class KitBuilder {
  private readonly positions: number[] = [];
  private readonly normals: number[] = [];
  private readonly colors: number[] = [];
  private readonly uvs: number[] = [];
  private readonly pbr: number[] = [];
  private readonly indices: number[] = [];

  /** Adds a quad (a,b,c,d counter-clockwise seen from outside). The normal is derived unless given. */
  quad(
    a: Vec3, b: Vec3, c: Vec3, d: Vec3,
    n?: Vec3, uv?: readonly [Vec2, Vec2, Vec2, Vec2], colour: Color = WHITE, pbr = -1,
  ): void {
    const normal = n ? unit(n) : faceNormal(a, b, c, d);
    if (!normal) return;
    const start = this.positions.length / 3;
    this.vertex(a, normal, uv?.[0], colour, pbr);
    this.vertex(b, normal, uv?.[1], colour, pbr);
    this.vertex(c, normal, uv?.[2], colour, pbr);
    this.vertex(d, normal, uv?.[3], colour, pbr);
    this.indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
  }

  /** Adds a triangle (a,b,c counter-clockwise seen from outside). */
  tri(
    a: Vec3, b: Vec3, c: Vec3,
    n?: Vec3, uv?: readonly [Vec2, Vec2, Vec2], colour: Color = WHITE, pbr = -1,
  ): void {
    const normal = n ? unit(n) : faceNormal(a, b, c);
    if (!normal) return;
    const start = this.positions.length / 3;
    this.vertex(a, normal, uv?.[0], colour, pbr);
    this.vertex(b, normal, uv?.[1], colour, pbr);
    this.vertex(c, normal, uv?.[2], colour, pbr);
    this.indices.push(start, start + 1, start + 2);
  }

  triangles(): number {
    return this.indices.length / 3;
  }

  finish(kind: LandmarkMeshKind = 'textured', photo?: string): LandmarkMeshData {
    const mesh: LandmarkMeshData = {
      positions: Float32Array.from(this.positions),
      normals: Float32Array.from(this.normals),
      colors: Float32Array.from(this.colors),
      indices: Uint32Array.from(this.indices),
      kind,
    };
    if (kind === 'textured') {
      mesh.uvs = Float32Array.from(this.uvs);
      mesh.pbr = Float32Array.from(this.pbr);
      if (photo !== undefined) mesh.photo = photo;
    }
    return mesh;
  }

  private vertex(p: Vec3, n: Vec3, uv: Vec2 | undefined, colour: Color, pbr: number): void {
    this.positions.push(p[0], p[1], p[2]);
    this.normals.push(n[0], n[1], n[2]);
    this.colors.push(colour[0], colour[1], colour[2]);
    const planar = uv ?? autoUv(p, n);
    this.uvs.push(planar[0], planar[1]);
    this.pbr.push(pbr);
  }
}

/** Which faces of a kit box to emit; all by default (a closed box). */
export interface BoxFaces {
  front?: boolean;
  back?: boolean;
  left?: boolean;
  right?: boolean;
  top?: boolean;
  bottom?: boolean;
}

/**
 * Axis-aligned box in a frame, all faces by default. Callers omit faces that can never be seen (for example the
 * back of a moulding band sitting on a wall, or a bottom on a roof) and say so at the call site.
 */
export function emitBox(
  b: KitBuilder, f: Frame, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number,
  colour: Color, pbr = -1, faces: BoxFaces = {},
): void {
  const w = (lx: number, ly: number, lz: number) => f.toWorld(lx, ly, lz);
  if (faces.front !== false) b.quad(w(x0, y0, z1), w(x1, y0, z1), w(x1, y1, z1), w(x0, y1, z1), undefined, undefined, colour, pbr);
  if (faces.back !== false) b.quad(w(x1, y0, z0), w(x0, y0, z0), w(x0, y1, z0), w(x1, y1, z0), undefined, undefined, colour, pbr);
  if (faces.right !== false) b.quad(w(x1, y0, z1), w(x1, y0, z0), w(x1, y1, z0), w(x1, y1, z1), undefined, undefined, colour, pbr);
  if (faces.left !== false) b.quad(w(x0, y0, z0), w(x0, y0, z1), w(x0, y1, z1), w(x0, y1, z0), undefined, undefined, colour, pbr);
  if (faces.top !== false) b.quad(w(x0, y1, z1), w(x1, y1, z1), w(x1, y1, z0), w(x0, y1, z0), undefined, undefined, colour, pbr);
  if (faces.bottom !== false) b.quad(w(x0, y0, z0), w(x1, y0, z0), w(x1, y0, z1), w(x0, y0, z1), undefined, undefined, colour, pbr);
}

function unit(v: Vec3): Vec3 {
  const len = Math.sqrt(dot(v, v));
  return len > 0 ? [v[0] / len, v[1] / len, v[2] / len] : [0, 0, 1];
}

/** Metre UVs in the face plane: horizontal faces use world x/z, vertical faces their horizontal tangent and y. */
function autoUv(p: Vec3, n: Vec3): Vec2 {
  if (Math.abs(n[1]) > 0.7) return [p[0], p[2]];
  const h = Math.hypot(n[0], n[2]) || 1;
  const tx = n[2] / h, tz = -n[0] / h;
  return [p[0] * tx + p[2] * tz, p[1]];
}

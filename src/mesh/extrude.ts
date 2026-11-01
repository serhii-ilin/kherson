/**
 * Extrude one OSM footprint into a building mesh: walls, a simple roof, UVs in metres.
 * Pure aside from the earcut helper (`three/src/extras/Earcut.js`, not the renderer). Heights come from the vector tile (`height` / `building:levels`
 * already resolved by the bake, including its documented heuristic). Window grids are not
 * geometry: each wall vertex carries storey count, floor height and bay width for the facade shader.
 *
 * Roof rules (deterministic, Article 2.1 when OSM has no `roof:shape`):
 *   dome / onion / church wall  → dome (pyramid if the footprint cannot hold it)
 *   pyramidal                   → point roof
 *   skillion                    → single slope
 *   hipped                      → hip
 *   gabled, or an untagged house → gable
 *   anything else, and any courtyard (a hole) → flat roof with a low parapet
 * Tagged `height` is the top (ridge, or the parapet top on a flat roof). Pitched eaves sit
 * below that by a rise of about 0.28 × the short side, clamped.
 */
import { Earcut } from 'three/src/extras/Earcut.js';
import { MAT, materialColor } from '../world/materials.ts';
import { ROOF } from '../world/vector-format.ts';

export interface ExtrudeBuilding {
  id: number;
  /** Outer ring first, holes after. Open rings, world metres. */
  rings: ReadonlyArray<ReadonlyArray<readonly [number, number]>>;
  /** Top of the building above `groundY` (metres). */
  heightM: number;
  /** OSM min_height above `groundY`. */
  minHeightM: number;
  /** 0 when unknown: derived from the wall height and the style's floor height. */
  levels: number;
  wall: number;
  roof: number;
  roofShape: number;
  /** Lowest ground under the footprint, metres. */
  groundY: number;
}

export interface CityMesh {
  positions: Float32Array;
  normals: Float32Array;
  /** Metres: along the wall and up from the floor, or across the roof. */
  uvs: Float32Array;
  colors: Float32Array;
  /** part (0 wall, 1 roof, 2 parapet, 3 soffit), levels, floor height (m), bay (m; 0 = no windows). */
  facade: Float32Array;
  /** Material id, plus 0.5 when the ground floor is a shop front. */
  style: Float32Array;
  indices: Uint32Array;
}

export type RoofKind = 'flat' | 'gable' | 'hip' | 'pyramid' | 'skillion' | 'dome';

interface Pt { x: number; z: number }
interface Facade {
  levels: number;
  floorH: number;
  bay: number;
  shops: boolean;
}
interface Spec { floor: number; bay: number; windows: boolean; shops: boolean; tall: boolean }

const HOUSE = new Set<number>([
  MAT.WALL_HOUSE, MAT.WALL_HOUSE_YELLOW, MAT.WALL_HOUSE_PINK, MAT.WALL_HOUSE_MINT, MAT.WALL_HOUSE_BLUE,
]);

const SPECS = new Map<number, Spec>([
  [MAT.WALL_HOUSE, { floor: 3.0, bay: 3.2, windows: true, shops: false, tall: false }],
  [MAT.WALL_APART, { floor: 2.8, bay: 3.0, windows: true, shops: false, tall: false }],
  [MAT.WALL_INDUSTRIAL, { floor: 4.2, bay: 4.0, windows: true, shops: false, tall: false }],
  [MAT.WALL_CHURCH, { floor: 8.0, bay: 3.4, windows: true, shops: false, tall: true }],
  [MAT.WALL_PUBLIC, { floor: 3.6, bay: 3.6, windows: true, shops: true, tall: false }],
  [MAT.WALL_KHRUSH, { floor: 3.0, bay: 4.0, windows: true, shops: false, tall: false }],
  [MAT.WALL_PANEL, { floor: 2.8, bay: 3.0, windows: true, shops: false, tall: false }],
  [MAT.WALL_STALIN, { floor: 3.4, bay: 3.4, windows: true, shops: true, tall: false }],
  [MAT.WALL_MODERN, { floor: 3.6, bay: 3.6, windows: true, shops: true, tall: false }],
  [MAT.WALL_GARAGE, { floor: 3.0, bay: 0, windows: false, shops: false, tall: false }],
  [MAT.WALL_BRICK, { floor: 2.8, bay: 3.0, windows: true, shops: false, tall: false }],
]);
const HISTORIC: Spec = { floor: 3.6, bay: 3.2, windows: true, shops: true, tall: false };
for (let m = MAT.WALL_HISTORIC; m <= MAT.WALL_HISTORIC_CREAM; m++) SPECS.set(m, HISTORIC);
for (const m of HOUSE) if (m !== MAT.WALL_HOUSE) SPECS.set(m, SPECS.get(MAT.WALL_HOUSE)!);

const PART_WALL = 0;
const PART_ROOF = 1;
const PART_PARAPET = 2;
const PART_SOFFIT = 3;
const SKIRT = 0.4;
const PARAPET = 0.45;

function hash(a: number, b = 0): number {
  let h = Math.imul(a | 0, 0x9e3779b1) ^ Math.imul((b | 0) + 0x7f4a7c15, 0x85ebca6b);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return h >>> 0;
}

function specOf(wall: number): Spec {
  return SPECS.get(wall) ?? SPECS.get(MAT.WALL_APART)!;
}

export function roofKindOf(wall: number, shape: number, hasHole: boolean): RoofKind {
  if (hasHole) return 'flat';
  if (shape === ROOF.DOME || shape === ROOF.ONION || wall === MAT.WALL_CHURCH) return 'dome';
  if (shape === ROOF.PYRAMIDAL) return 'pyramid';
  if (shape === ROOF.SKILLION) return 'skillion';
  if (shape === ROOF.HIPPED) return 'hip';
  if (shape === ROOF.GABLED || HOUSE.has(wall)) return 'gable';
  return 'flat';
}

/** Storeys and bay used by the facade shader. Explicit `levels` win; 0 falls back to the style. */
export function facadeMetrics(wall: number, bodyH: number, levels: number): Facade {
  const spec = specOf(wall);
  const h = Math.max(bodyH, 0.5);
  let lv = levels > 0 ? levels : Math.max(1, Math.round(h / spec.floor));
  if (spec.tall) lv = Math.max(1, Math.min(lv, 2));
  if (!spec.windows) return { levels: lv, floorH: h / lv, bay: 0, shops: false };
  return { levels: lv, floorH: h / lv, bay: spec.bay, shops: spec.shops };
}

function vary(rgb: readonly [number, number, number], id: number): [number, number, number] {
  const s = 0.93 + (hash(id, 9) % 8) * 0.012;
  return [rgb[0] * s, rgb[1] * s, rgb[2] * s];
}

function dedupe(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (q !== undefined && Math.hypot(p.x - q.x, p.z - q.z) < 0.05) continue;
    out.push(p);
  }
  if (out.length > 1) {
    const a = out[0]!;
    const b = out[out.length - 1]!;
    if (Math.hypot(a.x - b.x, a.z - b.z) < 0.05) out.pop();
  }
  return out;
}

function toRing(ring: ReadonlyArray<readonly [number, number]>): Pt[] {
  return dedupe(ring.map(([x, z]) => ({ x, z })));
}

function signedArea(ring: readonly Pt[]): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const j = (i + 1) % ring.length;
    a += ring[i]!.x * ring[j]!.z - ring[j]!.x * ring[i]!.z;
  }
  return a / 2;
}

function inside(rings: readonly Pt[][], x: number, z: number): boolean {
  let solid = false;
  for (const ring of rings) {
    let hit = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const yi = ring[i]!.z;
      const yj = ring[j]!.z;
      if ((yi > z) !== (yj > z)) {
        const xi = ring[i]!.x;
        const xj = ring[j]!.x;
        if (x < xi + ((z - yi) * (xj - xi)) / (yj - yi)) hit = !hit;
      }
    }
    if (hit) solid = !solid;
  }
  return solid;
}

function ensureWinding(ring: Pt[], ccw: boolean): Pt[] {
  const pos = signedArea(ring) > 0;
  if (pos !== ccw) ring.reverse();
  return ring;
}

class Builder {
  private readonly pos: number[] = [];
  private readonly nor: number[] = [];
  private readonly uv: number[] = [];
  private readonly col: number[] = [];
  private readonly fac: number[] = [];
  private readonly sty: number[] = [];
  private readonly idx: number[] = [];
  private n = 0;

  vert(
    x: number, y: number, z: number, nx: number, ny: number, nz: number,
    u: number, v: number, color: readonly [number, number, number],
    facade: readonly [number, number, number, number], style: number,
  ): number {
    this.pos.push(x, y, z);
    this.nor.push(nx, ny, nz);
    this.uv.push(u, v);
    this.col.push(color[0], color[1], color[2]);
    this.fac.push(facade[0], facade[1], facade[2], facade[3]);
    this.sty.push(style);
    return this.n++;
  }

  tri(a: number, b: number, c: number): void {
    this.idx.push(a, b, c);
  }

  finish(originX: number, originZ: number): CityMesh {
    if (originX !== 0 || originZ !== 0) {
      for (let i = 0; i < this.pos.length; i += 3) {
        this.pos[i] = this.pos[i]! - originX;
        this.pos[i + 2] = this.pos[i + 2]! - originZ;
      }
    }
    return {
      positions: Float32Array.from(this.pos),
      normals: Float32Array.from(this.nor),
      uvs: Float32Array.from(this.uv),
      colors: Float32Array.from(this.col),
      facade: Float32Array.from(this.fac),
      style: Float32Array.from(this.sty),
      indices: Uint32Array.from(this.idx),
    };
  }
}

function unit(x: number, y: number, z: number): [number, number, number] {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}

/** Triangle with an explicit normal. `ccw` is the vertex order as seen along the normal. */
function addFace(
  b: Builder,
  pts: ReadonlyArray<readonly [number, number, number]>,
  uvs: ReadonlyArray<readonly [number, number]>,
  n: readonly [number, number, number],
  color: readonly [number, number, number],
  facade: readonly [number, number, number, number],
  style: number,
): void {
  const [nx, ny, nz] = unit(n[0], n[1], n[2]);
  const ids = pts.map((p, i) => b.vert(p[0], p[1], p[2], nx, ny, nz, uvs[i]![0], uvs[i]![1], color, facade, style));
  if (ids.length === 3) b.tri(ids[0]!, ids[1]!, ids[2]!);
  else if (ids.length === 4) {
    b.tri(ids[0]!, ids[1]!, ids[2]!);
    b.tri(ids[0]!, ids[2]!, ids[3]!);
  }
}

function triNormal(
  a: readonly [number, number, number], b: readonly [number, number, number], c: readonly [number, number, number],
): [number, number, number] {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  return unit(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
}

interface Edge { ax: number; az: number; bx: number; bz: number; len: number; nx: number; nz: number }

function edgesOf(rings: Pt[][]): Edge[] {
  const out: Edge[] = [];
  for (const ring of rings) {
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      const a = ring[i]!;
      const c = ring[(i + 1) % n]!;
      const dx = c.x - a.x;
      const dz = c.z - a.z;
      const len = Math.hypot(dx, dz);
      if (len < 0.08) continue;
      let ux = dx / len;
      let uz = dz / len;
      let sx = a.x;
      let sz = a.z;
      // Left of the directed edge is (uz, -ux). If that side is solid, flip so +right is outward.
      if (inside(rings, a.x + dx / 2 + uz * 0.08, a.z + dz / 2 - ux * 0.08)) {
        ux = -ux;
        uz = -uz;
        sx = c.x;
        sz = c.z;
      }
      out.push({ ax: sx, az: sz, bx: sx + ux * len, bz: sz + uz * len, len, nx: uz, nz: -ux });
    }
  }
  return out;
}

function addWall(
  b: Builder, e: Edge, y0: number, yA: number, yB: number, floorBase: number, u0: number,
  color: [number, number, number], facade: Facade, style: number, part: number,
): void {
  const f: [number, number, number, number] = [part, facade.levels, facade.floorH, facade.bay];
  const vA0 = y0 - floorBase;
  const vB0 = y0 - floorBase;
  const vA1 = yA - floorBase;
  const vB1 = yB - floorBase;
  addFace(
    b,
    [[e.bx, y0, e.bz], [e.ax, y0, e.az], [e.ax, yA, e.az], [e.bx, yB, e.bz]],
    [[u0 + e.len, vB0], [u0, vA0], [u0, vA1], [u0 + e.len, vB1]],
    [e.nx, 0, e.nz], color, f, style,
  );
}

function pointOnSeg(p: Pt, a: Pt, b: Pt, eps: number): boolean {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const l2 = dx * dx + dz * dz;
  if (l2 < 1e-8) return Math.hypot(p.x - a.x, p.z - a.z) < eps;
  let t = ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2;
  if (t < -0.02 || t > 1.02) return false;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t)) < eps;
}

function projectSeg(p: Pt, a: Pt, b: Pt): Pt {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const l2 = dx * dx + dz * dz;
  let t = l2 > 0 ? ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return { x: a.x + dx * t, z: a.z + dz * t };
}

interface Frame { ca: number; sa: number; aMin: number; aMax: number; bMin: number; bMax: number; bMid: number }

function frameOf(ring: readonly Pt[]): Frame {
  let best = 0;
  let bx = 1;
  let bz = 0;
  for (let i = 0; i < ring.length; i++) {
    const j = (i + 1) % ring.length;
    const dx = ring[j]!.x - ring[i]!.x;
    const dz = ring[j]!.z - ring[i]!.z;
    const l2 = dx * dx + dz * dz;
    if (l2 > best) { best = l2; bx = dx; bz = dz; }
  }
  const len = Math.hypot(bx, bz) || 1;
  const ca = bx / len;
  const sa = bz / len;
  let aMin = Infinity, aMax = -Infinity, bMin = Infinity, bMax = -Infinity;
  for (const p of ring) {
    const a = p.x * ca + p.z * sa;
    const b = -p.x * sa + p.z * ca;
    if (a < aMin) aMin = a;
    if (a > aMax) aMax = a;
    if (b < bMin) bMin = b;
    if (b > bMax) bMax = b;
  }
  return { ca, sa, aMin, aMax, bMin, bMax, bMid: (bMin + bMax) / 2 };
}

function fromAB(a: number, b: number, f: Frame): Pt {
  return { x: a * f.ca - b * f.sa, z: a * f.sa + b * f.ca };
}

/** Intersections of the ridge centre-line with the outer ring, sorted along the ridge. */
function ridgeHits(ring: readonly Pt[], f: Frame): Pt[] {
  const dirX = f.ca;
  const dirZ = f.sa;
  const ox = -f.bMid * f.sa;
  const oz = f.bMid * f.ca;
  const hits: { t: number; p: Pt }[] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    const ex = b.x - a.x;
    const ez = b.z - a.z;
    const denom = dirX * ez - dirZ * ex; // D × E
    if (Math.abs(denom) < 1e-8) continue;
    const t = ((a.x - ox) * ez - (a.z - oz) * ex) / denom;
    const s = ((a.x - ox) * dirZ - (a.z - oz) * dirX) / denom;
    if (s < -0.001 || s > 1.001) continue;
    hits.push({ t, p: { x: ox + dirX * t, z: oz + dirZ * t } });
  }
  hits.sort((p, q) => p.t - q.t);
  const out: Pt[] = [];
  for (const h of hits) {
    const prev = out[out.length - 1];
    if (prev !== undefined && Math.hypot(prev.x - h.p.x, prev.z - h.p.z) < 0.2) continue;
    out.push(h.p);
  }
  return out;
}

function addRoofTri(
  b: Builder,
  a: readonly [number, number, number], c: readonly [number, number, number], d: readonly [number, number, number],
  uva: readonly [number, number], uvc: readonly [number, number], uvd: readonly [number, number],
  color: [number, number, number], style: number,
): void {
  let n = triNormal(a, c, d);
  let p0 = a, p1 = c, p2 = d, t0 = uva, t1 = uvc, t2 = uvd;
  if (n[1] < 0) {
    n = [-n[0], -n[1], -n[2]];
    p1 = d; p2 = c; t1 = uvd; t2 = uvc;
  }
  const facade: [number, number, number, number] = [PART_ROOF, 0, 0, 0];
  addFace(b, [p0, p1, p2], [t0, t1, t2], n, color, facade, style);
}

function addCap(
  b: Builder, rings: Pt[][], y: number, color: [number, number, number], style: number, up: boolean, part: number,
): void {
  const flat: number[] = [];
  const holes: number[] = [];
  rings.forEach((ring, ri) => {
    if (ri > 0) holes.push(flat.length / 2);
    for (const p of ring) flat.push(p.x, p.z);
  });
  const tri = Earcut.triangulate(flat, holes.length > 0 ? holes : undefined);
  // Earcut's CCW order in (x, z) has a downward geometric normal, so an upward cap is the reverse.
  const ny = up ? 1 : -1;
  const facade: [number, number, number, number] = [part, 0, 0, 0];
  for (let t = 0; t < tri.length; t += 3) {
    const ids = [tri[t]!, tri[t + 1]!, tri[t + 2]!];
    const pts = ids.map((i) => [flat[i * 2]!, y, flat[i * 2 + 1]!] as [number, number, number]);
    const uvs = ids.map((i) => [flat[i * 2]!, flat[i * 2 + 1]!] as [number, number]);
    if (up) addFace(b, [pts[0]!, pts[2]!, pts[1]!], [uvs[0]!, uvs[2]!, uvs[1]!], [0, ny, 0], color, facade, style);
    else addFace(b, pts, uvs, [0, ny, 0], color, facade, style);
  }
}

function addPitched(
  b: Builder, ring: Pt[], kind: RoofKind, eave: number, ridgeY: number, f: Frame,
  color: [number, number, number], style: number,
): void {
  const hits = ridgeHits(ring, f);
  if (hits.length < 2 && kind !== 'pyramid') {
    addPyramid(b, ring, eave, ridgeY, color, style);
    return;
  }
  let r0 = hits[0]!;
  let r1 = hits[hits.length - 1]!;
  if (kind === 'pyramid') {
    addPyramid(b, ring, eave, ridgeY, color, style);
    return;
  }
  if (kind === 'hip') {
    const span = Math.hypot(r1.x - r0.x, r1.z - r0.z);
    const halfB = (f.bMax - f.bMin) / 2;
    const inset = Math.min(halfB, span / 2 - 0.4);
    if (!(inset > 0.3)) {
      addPyramid(b, ring, eave, ridgeY, color, style);
      return;
    }
    const dx = (r1.x - r0.x) / span;
    const dz = (r1.z - r0.z) / span;
    r0 = { x: r0.x + dx * inset, z: r0.z + dz * inset };
    r1 = { x: r1.x - dx * inset, z: r1.z - dz * inset };
  }
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const c = ring[(i + 1) % ring.length]!;
    const onEnd = kind === 'gable' && (pointOnSeg(r0, a, c, 0.35) || pointOnSeg(r1, a, c, 0.35));
    if (onEnd) continue;
    const p0 = projectSeg(a, r0, r1);
    const p1 = projectSeg(c, r0, r1);
    const close = Math.hypot(p0.x - p1.x, p0.z - p1.z) < 0.2;
    const ya: [number, number, number] = [a.x, eave, a.z];
    const yc: [number, number, number] = [c.x, eave, c.z];
    if (close) {
      const p = p0;
      addRoofTri(b, ya, yc, [p.x, ridgeY, p.z], [0, 0], [Math.hypot(c.x - a.x, c.z - a.z), 0], [Math.hypot(c.x - a.x, c.z - a.z) / 2, Math.hypot(p.x - a.x, p.z - a.z)], color, style);
    } else {
      const len = Math.hypot(c.x - a.x, c.z - a.z);
      const rise = Math.hypot((p0.x + p1.x) / 2 - (a.x + c.x) / 2, (p0.z + p1.z) / 2 - (a.z + c.z) / 2);
      addRoofTri(b, ya, yc, [p1.x, ridgeY, p1.z], [0, 0], [len, 0], [len, rise], color, style);
      addRoofTri(b, ya, [p1.x, ridgeY, p1.z], [p0.x, ridgeY, p0.z], [0, 0], [len, rise], [0, rise], color, style);
    }
  }
}

function addPyramid(
  b: Builder, ring: Pt[], eave: number, peakY: number,
  color: [number, number, number], style: number,
): void {
  let cx = 0, cz = 0;
  for (const p of ring) { cx += p.x; cz += p.z; }
  cx /= ring.length;
  cz /= ring.length;
  let u = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const c = ring[(i + 1) % ring.length]!;
    const len = Math.hypot(c.x - a.x, c.z - a.z);
    const rise = Math.hypot(cx - (a.x + c.x) / 2, cz - (a.z + c.z) / 2);
    addRoofTri(
      b,
      [a.x, eave, a.z], [c.x, eave, c.z], [cx, peakY, cz],
      [u, 0], [u + len, 0], [u + len / 2, rise],
      color, style,
    );
    u += len;
  }
}

function addDome(
  b: Builder, center: Pt, radius: number, eave: number, rise: number,
  color: [number, number, number], style: number,
): void {
  const seg = 12;
  const steps = 3;
  const base = eave + 0.08;
  const rings: { x: number; y: number; z: number }[][] = [];
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const rad = radius * Math.cos((t * Math.PI) / 2);
    const y = base + (rise - 0.08) * Math.sin((t * Math.PI) / 2);
    const ring: { x: number; y: number; z: number }[] = [];
    if (s === steps) ring.push({ x: center.x, y, z: center.z });
    else {
      for (let i = 0; i < seg; i++) {
        const a = (i / seg) * Math.PI * 2;
        ring.push({ x: center.x + Math.cos(a) * rad, y, z: center.z + Math.sin(a) * rad });
      }
    }
    rings.push(ring);
  }
  for (let s = 0; s < steps; s++) {
    const lo = rings[s]!;
    const hi = rings[s + 1]!;
    if (hi.length === 1) {
      const p = hi[0]!;
      for (let i = 0; i < lo.length; i++) {
        const a = lo[i]!;
        const c = lo[(i + 1) % lo.length]!;
        addRoofTri(b, [a.x, a.y, a.z], [c.x, c.y, c.z], [p.x, p.y, p.z], [i, s], [i + 1, s], [i + 0.5, s + 1], color, style);
      }
    } else {
      for (let i = 0; i < lo.length; i++) {
        const a = lo[i]!;
        const c = lo[(i + 1) % lo.length]!;
        const d = hi[(i + 1) % hi.length]!;
        const e = hi[i]!;
        addRoofTri(b, [a.x, a.y, a.z], [c.x, c.y, c.z], [d.x, d.y, d.z], [i, s], [i + 1, s], [i + 1, s + 1], color, style);
        addRoofTri(b, [a.x, a.y, a.z], [d.x, d.y, d.z], [e.x, e.y, e.z], [i, s], [i + 1, s + 1], [i, s + 1], color, style);
      }
    }
  }
}

function circleInside(rings: Pt[][], c: Pt, r: number): boolean {
  if (!inside(rings, c.x, c.z)) return false;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    if (!inside(rings, c.x + Math.cos(a) * r, c.z + Math.sin(a) * r)) return false;
  }
  return true;
}

/**
 * Extrude `building`. Positions are world metres minus (`originX`, `originZ`) so a chunk mesh
 * can sit at the chunk's NW corner. An unusable footprint returns an empty mesh.
 */
export function extrudeBuilding(building: ExtrudeBuilding, originX = 0, originZ = 0): CityMesh {
  const bld = new Builder();
  const rings = building.rings.map((r) => toRing(r)).filter((r) => r.length >= 3);
  if (rings.length === 0) return bld.finish(originX, originZ);
  ensureWinding(rings[0]!, true);
  for (let i = 1; i < rings.length; i++) ensureWinding(rings[i]!, false);
  const area = Math.abs(signedArea(rings[0]!));
  if (area < 1.5 || area > 40000) return bld.finish(originX, originZ);

  const heightM = Math.max(2.4, building.heightM);
  const minH = Math.max(0, building.minHeightM);
  const floorBase = building.groundY + minH;
  const top = building.groundY + Math.max(heightM, minH + 2.4);
  const kind0 = roofKindOf(building.wall, building.roofShape, rings.length > 1);
  const f = frameOf(rings[0]!);
  const across = Math.max(0.5, Math.min(f.aMax - f.aMin, f.bMax - f.bMin));
  let rise = Math.min(Math.max(across * 0.28, 1.3), 4.5);
  rise = Math.min(rise, (top - floorBase) * 0.45);
  let kind = kind0;
  if (kind !== 'flat' && (top - floorBase) - rise < 2.2) kind = 'flat';
  const eave = kind === 'flat' ? top - Math.min(PARAPET, (top - floorBase) * 0.18) : top - rise;
  const bodyH = Math.max(0.5, eave - floorBase);
  const facade = facadeMetrics(building.wall, bodyH, building.levels);
  const wallColor = vary(materialColor(building.wall), building.id);
  const roofColor = vary(materialColor(building.roof), building.id ^ 0x51);
  const wallStyle = building.wall + (facade.shops ? 0.5 : 0);
  const uShift = ((hash(building.id, 4) % 1000) / 1000) * (facade.bay > 0 ? facade.bay : 3);
  const y0 = minH > 0.3 ? floorBase : floorBase - SKIRT;

  const yAt = (x: number, z: number): number => {
    if (kind !== 'skillion') return eave;
    const b = -x * f.sa + z * f.ca;
    const t = (b - f.bMin) / Math.max(0.01, f.bMax - f.bMin);
    return eave + rise * Math.min(1, Math.max(0, t));
  };

  const edges = edgesOf(rings);
  let gable0: Pt | null = null;
  let gable1: Pt | null = null;
  if (kind === 'gable') {
    const hits = ridgeHits(rings[0]!, f);
    if (hits.length >= 2) {
      gable0 = hits[0]!;
      gable1 = hits[hits.length - 1]!;
    } else kind = 'pyramid';
  }

  for (const e of edges) {
    const yA = yAt(e.ax, e.az);
    const yB = yAt(e.bx, e.bz);
    addWall(bld, e, y0, yA, yB, floorBase, uShift, wallColor, facade, wallStyle, PART_WALL);
    if (kind === 'gable' && gable0 !== null && gable1 !== null) {
      const a = { x: e.ax, z: e.az };
      const c = { x: e.bx, z: e.bz };
      const peak = pointOnSeg(gable0, a, c, 0.35) ? gable0 : pointOnSeg(gable1, a, c, 0.35) ? gable1 : null;
      if (peak !== null) {
        const fA: [number, number, number, number] = [PART_WALL, facade.levels, facade.floorH, facade.bay];
        addFace(
          bld,
          [[e.bx, yB, e.bz], [e.ax, yA, e.az], [peak.x, top, peak.z]],
          [[uShift + e.len, yB - floorBase], [uShift, yA - floorBase], [uShift + e.len / 2, top - floorBase]],
          [e.nx, 0, e.nz], wallColor, fA, wallStyle,
        );
      }
    }
  }

  if (kind === 'flat') {
    addCap(bld, rings, eave, roofColor, building.roof, true, PART_ROOF);
    for (const e of edges) {
      if (!outerEdge(rings[0]!, e)) continue;
      addWall(bld, e, eave, top, top, floorBase, 0, wallColor, { ...facade, bay: 0 }, building.wall, PART_PARAPET);
      const inx = -e.nx * 0.22;
      const inz = -e.nz * 0.22;
      addFace(
        bld,
        [[e.bx, top, e.bz], [e.ax, top, e.az], [e.ax + inx, top, e.az + inz], [e.bx + inx, top, e.bz + inz]],
        [[e.len, 0], [0, 0], [0, 0.22], [e.len, 0.22]],
        [0, 1, 0], wallColor, [PART_PARAPET, 0, 0, 0], building.wall,
      );
    }
  } else if (kind === 'skillion') {
    const flat: number[] = [];
    for (const p of rings[0]!) flat.push(p.x, p.z);
    const tri = Earcut.triangulate(flat);
    for (let t = 0; t < tri.length; t += 3) {
      const ids = [tri[t]!, tri[t + 1]!, tri[t + 2]!];
      const pts = ids.map((i) => {
        const x = flat[i * 2]!;
        const z = flat[i * 2 + 1]!;
        return [x, yAt(x, z), z] as [number, number, number];
      });
      addRoofTri(bld, pts[0]!, pts[1]!, pts[2]!, [pts[0]![0], pts[0]![2]], [pts[1]![0], pts[1]![2]], [pts[2]![0], pts[2]![2]], roofColor, building.roof);
    }
  } else if (kind === 'dome') {
    let cx = 0, cz = 0;
    for (const p of rings[0]!) { cx += p.x; cz += p.z; }
    cx /= rings[0]!.length;
    cz /= rings[0]!.length;
    const radius = Math.min(f.aMax - f.aMin, f.bMax - f.bMin) * 0.36;
    const center = { x: cx, z: cz };
    if (radius >= 1.5 && circleInside(rings, center, radius)) {
      addCap(bld, rings, eave, roofColor, building.roof, true, PART_ROOF);
      addDome(bld, center, radius, eave, rise, roofColor, building.roof);
    } else addPyramid(bld, rings[0]!, eave, top, roofColor, building.roof);
  } else {
    addPitched(bld, rings[0]!, kind, eave, top, f, roofColor, building.roof);
  }

  if (minH > 0.3) addCap(bld, rings, floorBase, wallColor, building.wall, false, PART_SOFFIT);
  return bld.finish(originX, originZ);
}

function outerEdge(outer: readonly Pt[], e: Edge): boolean {
  const mx = (e.ax + e.bx) / 2;
  const mz = (e.az + e.bz) / 2;
  for (let i = 0; i < outer.length; i++) {
    const a = outer[i]!;
    const c = outer[(i + 1) % outer.length]!;
    if (pointOnSeg({ x: mx, z: mz }, a, c, 0.2)) return true;
  }
  return false;
}

export function emptyMesh(): CityMesh {
  return {
    positions: new Float32Array(0), normals: new Float32Array(0), uvs: new Float32Array(0),
    colors: new Float32Array(0), facade: new Float32Array(0), style: new Float32Array(0),
    indices: new Uint32Array(0),
  };
}

/** Concatenate chunk-local building meshes (already in the same origin). */
export function mergeMeshes(parts: readonly CityMesh[]): CityMesh {
  let nv = 0;
  let ni = 0;
  for (const p of parts) {
    nv += p.positions.length / 3;
    ni += p.indices.length;
  }
  if (nv === 0) return emptyMesh();
  const positions = new Float32Array(nv * 3);
  const normals = new Float32Array(nv * 3);
  const uvs = new Float32Array(nv * 2);
  const colors = new Float32Array(nv * 3);
  const facade = new Float32Array(nv * 4);
  const style = new Float32Array(nv);
  const indices = new Uint32Array(ni);
  let v = 0;
  let i = 0;
  for (const p of parts) {
    const n = p.positions.length / 3;
    positions.set(p.positions, v * 3);
    normals.set(p.normals, v * 3);
    uvs.set(p.uvs, v * 2);
    colors.set(p.colors, v * 3);
    facade.set(p.facade, v * 4);
    style.set(p.style, v);
    for (let k = 0; k < p.indices.length; k++) indices[i + k] = p.indices[k]! + v;
    v += n;
    i += p.indices.length;
  }
  return { positions, normals, uvs, colors, facade, style, indices };
}

export function triangleCount(mesh: CityMesh): number {
  return mesh.indices.length / 3;
}

/** GPU buffer bytes of one mesh (positions, normals, UVs, colours, facade, style, indices). */
export function meshByteSize(mesh: CityMesh): number {
  return mesh.positions.byteLength + mesh.normals.byteLength + mesh.uvs.byteLength
    + mesh.colors.byteLength + mesh.facade.byteLength + mesh.style.byteLength + mesh.indices.byteLength;
}

/**
 * True-angle buildings for the block tier. A flat-roofed apartment block whose walls are not aligned
 * with the 1 m grid would be a 1 m staircase as blocks, with windows carved only where a straight run
 * happens to exist. Such a block is drawn instead as walls along its real polygon edges, a flat roof and
 * a few protruding details (balconies, entrance canopies); the facade shader paints the windows along
 * each wall (aRun) and the entrances on the wall picked here. Physics keeps the 1 m column raster.
 *
 * Vertex layout matches the chunk mesh (positions chunk-local, AO-free colours, `walls`, `runs`), so the
 * block chunk material renders it. `walls.w` of a smooth wall is 16 + contact + 2 * entrance code, where
 * the entrance code is 0 (no entrances on this wall) or 1 + the bay phase of the entrances.
 */
// the triangulator alone: importing 'three' would pull the math classes into the fine worker (~+96 kB)
import { Earcut } from 'three/src/extras/Earcut.js';
import { MAT, PALETTE } from '../world/materials.ts';
import { SIDE_SHADE, packWallId, type ChunkMesh } from '../world/mesher.ts';

/** Wall styles drawn true-angle, with the facade shader's floor height and bay width (fStyle x, y). */
const STYLE: ReadonlyMap<number, { floorH: number; bay: number; entEvery: number }> = new Map([
  [MAT.WALL_APART, { floorH: 2.8, bay: 3.0, entEvery: 6 }],
  [MAT.WALL_KHRUSH, { floorH: 3.0, bay: 4.0, entEvery: 4 }],
  [MAT.WALL_PANEL, { floorH: 2.8, bay: 3.0, entEvery: 6 }],
  [MAT.WALL_STALIN, { floorH: 3.4, bay: 3.4, entEvery: 6 }],
  [MAT.WALL_BRICK, { floorH: 2.8, bay: 3.0, entEvery: 6 }],
]);

/** Walls within this angle of a grid axis stay blocks (carved windows look better there). */
const MIN_SKEW = Math.sin((4 * Math.PI) / 180);
/** Ring vertices turning less than this are dropped, so a wall split by a stray vertex keeps one bay rhythm. */
const COLLINEAR = Math.sin((5 * Math.PI) / 180);

export function smoothStyle(wall: number): boolean {
  return STYLE.has(wall);
}

/** True when any outer-ring edge longer than 3 m is skewed from the grid axes. */
export function isSkewed(ring: Float64Array): boolean {
  const n = ring.length >> 1;
  for (let i = 0; i < n; i++) {
    const k = (i + 1) % n;
    const ex = ring[k * 2]! - ring[i * 2]!, ez = ring[k * 2 + 1]! - ring[i * 2 + 1]!;
    const len = Math.hypot(ex, ez);
    if (len > 3 && Math.min(Math.abs(ex), Math.abs(ez)) / len > MIN_SKEW) return true;
  }
  return false;
}

export interface SmoothBuilding {
  id: number;
  wall: number;
  roof: number;
  tint: number;
  /** World-metre rings (outer first), as the block tier rasterises them. */
  rings: Float64Array[];
  /** Lowest ground under the footprint (walls start a metre below it). */
  baseY: number;
  /** Bottom of the facade (the shader's wall base). */
  floorBase: number;
  /** Flat roof surface. */
  top: number;
  /** Distance (m) to the nearest drivable road, to put the entrances on the side facing the drive. */
  roadDist?: (x: number, z: number) => number;
}

function hash(a: number, b = 0, c = 0): number {
  let h = Math.imul(a | 0, 0x9e3779b1) ^ Math.imul((b | 0) + 0x7f4a7c15, 0x85ebca6b) ^ Math.imul((c | 0) + 0x165667b1, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return h >>> 0;
}

function simplify(ring: Float64Array): Float64Array {
  const n = ring.length >> 1;
  if (n <= 3) return ring;
  const keep: number[] = [];
  for (let i = 0; i < n; i++) {
    const p = (i + n - 1) % n, k = (i + 1) % n;
    const ax = ring[i * 2]! - ring[p * 2]!, az = ring[i * 2 + 1]! - ring[p * 2 + 1]!;
    const bx = ring[k * 2]! - ring[i * 2]!, bz = ring[k * 2 + 1]! - ring[i * 2 + 1]!;
    const la = Math.hypot(ax, az), lb = Math.hypot(bx, bz);
    if (la < 0.05 || lb < 0.05) continue;
    const cross = Math.abs(ax * bz - az * bx) / (la * lb);
    const dot = ax * bx + az * bz;
    if (cross < COLLINEAR && dot > 0) continue;
    keep.push(i);
  }
  if (keep.length < 3) return ring;
  const out = new Float64Array(keep.length * 2);
  keep.forEach((i, j) => { out[j * 2] = ring[i * 2]!; out[j * 2 + 1] = ring[i * 2 + 1]!; });
  return out;
}

function inside(rings: readonly Float64Array[], x: number, z: number): boolean {
  let c = false;
  for (const r of rings) {
    const n = r.length >> 1;
    for (let i = 0, k = n - 1; i < n; k = i++) {
      const zi = r[i * 2 + 1]!, zk = r[k * 2 + 1]!;
      if ((zi > z) !== (zk > z) && x < r[i * 2]! + ((z - zi) * (r[k * 2]! - r[i * 2]!)) / (zk - zi)) c = !c;
    }
  }
  return c;
}

class Mesh {
  pos: number[] = [];
  nor: number[] = [];
  col: number[] = [];
  wal: number[] = [];
  run: number[] = [];
  idx: number[] = [];

  /** Quad v0..v3, counter-clockwise seen from the side the normal points to. */
  quad(v: readonly number[], n: readonly [number, number, number], c: readonly [number, number, number],
    w: readonly [number, number, number, number] = [0, 0, 0, 0], runs: readonly number[] = [0, 0, 0, 0, 0, 0, 0, 0]): void {
    const s = this.pos.length / 3;
    // wind counter-clockwise around n whatever order the caller gave
    const e1x = v[3]! - v[0]!, e1y = v[4]! - v[1]!, e1z = v[5]! - v[2]!;
    const e2x = v[6]! - v[0]!, e2y = v[7]! - v[1]!, e2z = v[8]! - v[2]!;
    const cx = e1y * e2z - e1z * e2y, cy = e1z * e2x - e1x * e2z, cz = e1x * e2y - e1y * e2x;
    const order = cx * n[0] + cy * n[1] + cz * n[2] < 0 ? [0, 3, 2, 1] : [0, 1, 2, 3];
    for (const i of order) {
      this.pos.push(v[i * 3]!, v[i * 3 + 1]!, v[i * 3 + 2]!);
      this.nor.push(n[0], n[1], n[2]);
      this.col.push(c[0], c[1], c[2]);
      this.wal.push(w[0], w[1], w[2], w[3]);
      this.run.push(runs[i * 2]!, runs[i * 2 + 1]!);
    }
    this.idx.push(s, s + 1, s + 2, s, s + 2, s + 3);
  }

  /** Box in a wall frame: origin (ox, oz), u along the wall, n outward; a along u, c along n. */
  box(ox: number, oz: number, ux: number, uz: number, a0: number, a1: number, c0: number, c1: number, y0: number, y1: number,
    c: readonly [number, number, number]): void {
    const nx = uz, nz = -ux; // (uz, -ux) is outward
    const P = (a: number, cc: number, y: number): number[] => [ox + ux * a + nx * cc, y, oz + uz * a + nz * cc];
    const face = (p: number[][], n: [number, number, number], shade: number): void =>
      this.quad(p.flat(), n, [c[0] * shade, c[1] * shade, c[2] * shade]);
    face([P(a0, c1, y0), P(a1, c1, y0), P(a1, c1, y1), P(a0, c1, y1)], [nx, 0, nz], SIDE_SHADE); // front
    face([P(a1, c0, y0), P(a0, c0, y0), P(a0, c0, y1), P(a1, c0, y1)], [-nx, 0, -nz], SIDE_SHADE); // back
    face([P(a1, c1, y0), P(a1, c0, y0), P(a1, c0, y1), P(a1, c1, y1)], [ux, 0, uz], SIDE_SHADE); // +a end
    face([P(a0, c0, y0), P(a0, c1, y0), P(a0, c1, y1), P(a0, c0, y1)], [-ux, 0, -uz], SIDE_SHADE); // -a end
    face([P(a0, c0, y1), P(a0, c1, y1), P(a1, c1, y1), P(a1, c0, y1)], [0, 1, 0], 1); // top
    face([P(a0, c1, y0), P(a0, c0, y0), P(a1, c0, y0), P(a1, c1, y0)], [0, -1, 0], 0.65); // bottom
  }
}

function pal(m: number): [number, number, number] {
  return [PALETTE[m * 3]! / 255, PALETTE[m * 3 + 1]! / 255, PALETTE[m * 3 + 2]! / 255];
}

/** Wall, roof and details of the given buildings, positions relative to (x0, z0). */
export function meshSmooth(list: readonly SmoothBuilding[], x0: number, z0: number): ChunkMesh & { runs: Float32Array } {
  const m = new Mesh();
  for (const b of list) addBuilding(m, b, x0, z0);
  return {
    positions: Float32Array.from(m.pos), normals: Float32Array.from(m.nor), colors: Float32Array.from(m.col),
    walls: Float32Array.from(m.wal), runs: Float32Array.from(m.run), indices: Uint32Array.from(m.idx),
  };
}

interface Wall { ax: number; az: number; ux: number; uz: number; len: number; ring: number; i: number }

function addBuilding(m: Mesh, b: SmoothBuilding, x0: number, z0: number): void {
  const st = STYLE.get(b.wall)!;
  const rings = b.rings.map(simplify);
  const yb = b.baseY - 1, yt = b.top;
  const totalH = yt - b.floorBase;
  const nF = Math.max(1, Math.floor(totalH / st.floorH + 0.5));
  const fh = totalH / nF;
  const wallId = packWallId(b.wall, b.tint);
  const wallCol = pal(b.wall).map((v) => v * SIDE_SHADE) as [number, number, number];

  // walls with outward u/n frames
  const walls: Wall[] = [];
  rings.forEach((r, ri) => {
    const n = r.length >> 1;
    for (let i = 0; i < n; i++) {
      const k = (i + 1) % n;
      const ax = r[i * 2]!, az = r[i * 2 + 1]!;
      const dx = r[k * 2]! - ax, dz = r[k * 2 + 1]! - az;
      const len = Math.hypot(dx, dz);
      if (len < 0.05) continue;
      let ux = dx / len, uz = dz / len;
      let sx = ax, sz = az;
      // outward is (uz, -ux); flip the edge when that points inside
      if (inside(rings, ax + dx / 2 + uz * 0.05, az + dz / 2 - ux * 0.05)) { ux = -ux; uz = -uz; sx = ax + dx; sz = az + dz; }
      walls.push({ ax: sx, az: sz, ux, uz, len, ring: ri, i });
    }
  });

  // entrances: on the long outer wall nearest a drivable road (the service drive), else the first long one
  let entWall = -1, best = Infinity;
  walls.forEach((w, wi) => {
    if (w.ring !== 0 || w.len < 2.5 * st.bay * 2) return;
    const mx = w.ax + w.ux * w.len / 2 + w.uz * 8, mz = w.az + w.uz * w.len / 2 - w.ux * 8;
    const d = (b.roadDist?.(mx, mz) ?? 50) - w.len * 0.01;
    if (d < best) { best = d; entWall = wi; }
  });
  const entPhase = hash(b.id, 5) % st.entEvery;

  walls.forEach((w, wi) => {
    const E = wi === entWall ? entPhase + 1 : 0;
    const bx = w.ax + w.ux * w.len, bz = w.az + w.uz * w.len;
    const lx = w.ax - x0, lz = w.az - z0, rx = bx - x0, rz = bz - z0;
    m.quad([rx, yb, rz, lx, yb, lz, lx, yt, lz, rx, yt, rz], [w.uz, 0, -w.ux], wallCol,
      [wallId, yt, b.floorBase, 16 + 1 + 2 * E], [w.len, w.len, 0, w.len, 0, w.len, w.len, w.len]);
    if (w.len < 2.5) return;
    // details in the shader's bay grid
    const nB = Math.max(1, Math.floor(w.len / st.bay + 0.5));
    const bayW = w.len / nB;
    for (let bi = 0; bi < nB; bi++) {
      const entrBay = E > 0 && (bi + E - 1) % st.entEvery === 0 && bi > 0 && bi < nB - 1;
      const a0 = bi * bayW, a1 = a0 + bayW, am = (a0 + a1) / 2;
      if (entrBay) {
        // concrete canopy over the door
        m.box(w.ax - x0, w.az - z0, w.ux, w.uz, am - 1.1, am + 1.1, 0, 1.3, b.floorBase + 2.35, b.floorBase + 2.5, pal(MAT.CONCRETE));
        continue;
      }
      // balcony stacks on long walls (never on the gable ends), the same bays on every floor
      const h = hash(b.id, w.i * 131 + w.ring, bi);
      if (w.len < 14 || h % 2 !== 0 || nF < 3) continue;
      const glazed = (h >>> 8) % 4 === 0;
      const front = glazed ? [0.62, 0.68, 0.72] as const : pal(MAT.METAL);
      const hw = Math.min(bayW * 0.42, 1.6);
      for (let f = 1; f < nF; f++) {
        const y = b.floorBase + f * fh;
        m.box(w.ax - x0, w.az - z0, w.ux, w.uz, am - hw, am + hw, 0, 0.95, y - 0.12, y, pal(MAT.CONCRETE));
        m.box(w.ax - x0, w.az - z0, w.ux, w.uz, am - hw, am + hw, 0.89, 0.95, y, y + 1.0, front);
        m.box(w.ax - x0, w.az - z0, w.ux, w.uz, am - hw, am - hw + 0.05, 0, 0.89, y, y + 1.0, front);
        m.box(w.ax - x0, w.az - z0, w.ux, w.uz, am + hw - 0.05, am + hw, 0, 0.89, y, y + 1.0, front);
      }
    }
  });

  // flat roof
  const flat: number[] = [], holeIdx: number[] = [];
  rings.forEach((r, ri) => {
    if (ri > 0) holeIdx.push(flat.length / 2);
    for (let i = 0; i < r.length; i++) flat.push(r[i]!);
  });
  const tri = Earcut.triangulate(flat, holeIdx);
  const roofCol = pal(b.roof);
  for (let t = 0; t < tri.length; t += 3) {
    const v: number[] = [];
    for (const k of [0, 1, 2, 2]) { const i = tri[t + k]!; v.push(flat[i * 2]! - x0, yt, flat[i * 2 + 1]! - z0); }
    m.quad(v, [0, 1, 0], roofCol);
  }
  // a low parapet so the roof edge reads
  for (const w of walls) {
    if (w.ring !== 0) continue;
    m.box(w.ax - x0, w.az - z0, w.ux, w.uz, 0, w.len, -0.25, 0.02, yt, yt + 0.35, wallCol.map((v) => v / SIDE_SHADE) as [number, number, number]);
  }
}

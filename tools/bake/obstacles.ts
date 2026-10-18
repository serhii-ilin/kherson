// Exact-position obstacle test for vegetation placement (issue #6).
//
// Trees and bushes are baked on the 2 m grid, but the client draws each at (cell + 0.5 + jitter(seed)) * 2 m
// (src/nature/placement.ts). A cell that is sidewalk in the 2 m world can still hold a position that lies on the 0.2 m
// asphalt of the vector road (its real width differs from the 2 m raster) or inside the 1 m building footprint.
// This index answers "is this exact metre position on a carriageway (vector road polyline buffered by width/2 + margin)
// or inside / within 0.5 m of a building footprint?", so the bake can nudge the seed (the jitter) or drop the plant.
//
// Pure and deterministic. All input geometry is in cell units (2 m), like the rest of the bake.
import { VOXEL } from "../../src/world/constants.ts";
import { jitterX, jitterZ } from "../../src/nature/placement.ts";
import type { Pt } from "./rasterize.ts";

export const CARRIAGEWAY_MARGIN_M = 0.6;
export const BUILDING_MARGIN_M = 0.5;
const BUCKET_M = 16;

export interface RoadObstacle {
  /** Centre line, cell units. */
  pts: readonly Pt[];
  /** Full carriageway width in metres (the vector road width). */
  widthM: number;
}

interface Seg { ax: number; az: number; bx: number; bz: number; r: number }

function segDist2(px: number, pz: number, s: Seg): number {
  const dx = s.bx - s.ax, dz = s.bz - s.az;
  const l2 = dx * dx + dz * dz;
  let t = l2 > 0 ? ((px - s.ax) * dx + (pz - s.az) * dz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = s.ax + dx * t - px, qz = s.az + dz * t - pz;
  return qx * qx + qz * qz;
}

export class Obstacles {
  private readonly buckets = new Map<number, { segs: number[]; polys: number[] }>();
  private readonly roadSegs: Seg[] = [];
  private readonly polys: { rings: number[][]; edges: Seg[] }[] = []; // rings as flat [x0,z0,x1,z1,...] metres
  private readonly bucket = (bx: number, bz: number, create: boolean) => {
    const k = bx * 65536 + bz;
    let b = this.buckets.get(k);
    if (!b && create) this.buckets.set(k, (b = { segs: [], polys: [] }));
    return b;
  };

  constructor(roads: readonly RoadObstacle[], buildings: readonly (readonly (readonly Pt[])[])[]) {
    for (const r of roads) {
      const rad = r.widthM / 2 + CARRIAGEWAY_MARGIN_M;
      for (let i = 0; i + 1 < r.pts.length; i++) {
        const a = r.pts[i]!, b = r.pts[i + 1]!;
        const s: Seg = { ax: a[0] * VOXEL, az: a[1] * VOXEL, bx: b[0] * VOXEL, bz: b[1] * VOXEL, r: rad };
        const idx = this.roadSegs.push(s) - 1;
        this.addToBuckets(Math.min(s.ax, s.bx) - rad, Math.min(s.az, s.bz) - rad, Math.max(s.ax, s.bx) + rad, Math.max(s.az, s.bz) + rad, (b_) => b_.segs.push(idx));
      }
    }
    for (const rings of buildings) {
      const flat: number[][] = [];
      const edges: Seg[] = [];
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (const ring of rings) {
        if (ring.length < 3) continue;
        const f: number[] = [];
        for (const p of ring) {
          const x = p[0] * VOXEL, z = p[1] * VOXEL;
          f.push(x, z);
          x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
        }
        flat.push(f);
        for (let i = 0; i < f.length; i += 2) {
          const j = (i + 2) % f.length;
          edges.push({ ax: f[i]!, az: f[i + 1]!, bx: f[j]!, bz: f[j + 1]!, r: BUILDING_MARGIN_M });
        }
      }
      if (flat.length === 0) continue;
      const idx = this.polys.push({ rings: flat, edges }) - 1;
      this.addToBuckets(x0 - BUILDING_MARGIN_M, z0 - BUILDING_MARGIN_M, x1 + BUILDING_MARGIN_M, z1 + BUILDING_MARGIN_M, (b_) => b_.polys.push(idx));
    }
  }

  private addToBuckets(x0: number, z0: number, x1: number, z1: number, add: (b: { segs: number[]; polys: number[] }) => void): void {
    const bx0 = Math.floor(x0 / BUCKET_M), bx1 = Math.floor(x1 / BUCKET_M), bz0 = Math.floor(z0 / BUCKET_M), bz1 = Math.floor(z1 / BUCKET_M);
    for (let bz = bz0; bz <= bz1; bz++) for (let bx = bx0; bx <= bx1; bx++) add(this.bucket(bx, bz, true)!);
  }

  /** True when the world position (metres) is on a carriageway or in / within 0.5 m of a building footprint. */
  blocked(xm: number, zm: number): boolean {
    const b = this.bucket(Math.floor(xm / BUCKET_M), Math.floor(zm / BUCKET_M), false);
    if (!b) return false;
    for (const i of b.segs) {
      const s = this.roadSegs[i]!;
      if (segDist2(xm, zm, s) < s.r * s.r) return true;
    }
    for (const pi of b.polys) {
      const poly = this.polys[pi]!;
      let inside = false;
      for (const f of poly.rings) {
        for (let i = 0, j = f.length - 2; i < f.length; j = i, i += 2) {
          const xi = f[i]!, zi = f[i + 1]!, xj = f[j]!, zj = f[j + 1]!;
          if (zi > zm !== zj > zm && xm < ((xj - xi) * (zm - zi)) / (zj - zi) + xi) inside = !inside;
        }
      }
      if (inside) return true;
      for (const e of poly.edges) if (segDist2(xm, zm, e) < e.r * e.r) return true;
    }
    return false;
  }

  /**
   * Seed to use for a plant in cell (cx, cz): `seed` itself when its exact position is free, else the first of a few
   * deterministic alternatives (each moves the jitter, at most +-0.7 m in the cell), else -1 (drop the plant).
   */
  freeSeed(cx: number, cz: number, seed: number): number {
    for (let k = 0; k < 24; k++) {
      const s = (seed + k * 67) & 255;
      if (!this.blocked((cx + 0.5 + jitterX(s)) * VOXEL, (cz + 0.5 + jitterZ(s)) * VOXEL)) return s;
    }
    return -1;
  }
}

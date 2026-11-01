/**
 * Hotel «Фрегат», OSM way 116810729. Geometry is in metres, local to the footprint
 * centroid, y up from the ground. The numbers and the palette are the ones in
 * docs/landmarks/hotel-fregat.md. This is a reading of the owner's pre-war photo,
 * not a copy of it.
 */
import { Earcut } from 'three/src/extras/Earcut.js';

export const FREGAT_WAY_ID = 116810729;
/** Baked height of the slab, metres. 15 storeys. */
export const FREGAT_HEIGHT_M = 46;
export const FREGAT_LEVELS = 15;
/** Tip of the sail above the ground. */
export const FREGAT_SAIL_TOP_M = 60;

export const FREGAT_PALETTE = {
  facade: [0.83, 0.76, 0.66],
  glass: [0.36, 0.46, 0.55],
  balcony: [0.91, 0.73, 0.22],
  sail: [0.95, 0.95, 0.93],
  roof: [0.5, 0.51, 0.53],
  tower: [0.74, 0.73, 0.7],
} as const;

type RGB = readonly [number, number, number];

export interface FregatMesh {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
  anchorX: number;
  anchorZ: number;
}

class B {
  readonly p: number[] = [];
  readonly n: number[] = [];
  readonly c: number[] = [];
  readonly i: number[] = [];

  v(x: number, y: number, z: number, nx: number, ny: number, nz: number, col: RGB): number {
    const l = Math.hypot(nx, ny, nz) || 1;
    this.p.push(x, y, z);
    this.n.push(nx / l, ny / l, nz / l);
    this.c.push(col[0], col[1], col[2]);
    return this.p.length / 3 - 1;
  }

  tri(a: number, b: number, c: number): void {
    this.i.push(a, b, c);
  }

  quad(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number, dx: number, dy: number, dz: number, col: RGB): void {
    const nx = (by - ay) * (dz - az) - (bz - az) * (dy - ay);
    const ny = (bz - az) * (dx - ax) - (bx - ax) * (dz - az);
    const nz = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
    const a = this.v(ax, ay, az, nx, ny, nz, col);
    const b = this.v(bx, by, bz, nx, ny, nz, col);
    const c = this.v(cx, cy, cz, nx, ny, nz, col);
    const d = this.v(dx, dy, dz, nx, ny, nz, col);
    this.tri(a, b, c);
    this.tri(a, c, d);
  }
}

function outward(ax: number, az: number, bx: number, bz: number, cx: number, cz: number): [number, number] {
  const mx = (ax + bx) / 2;
  const mz = (az + bz) / 2;
  let nx = -(bz - az);
  let nz = bx - ax;
  const l = Math.hypot(nx, nz) || 1;
  nx /= l;
  nz /= l;
  if ((cx - mx) * nx + (cz - mz) * nz > 0) { nx = -nx; nz = -nz; }
  return [nx, nz];
}

/** Slab, yellow balcony bands, stair tower and sail. `ring` is world metres, open. */
export function buildFregatMesh(ring: readonly (readonly [number, number])[]): FregatMesh {
  let ax = 0, az = 0;
  for (const p of ring) { ax += p[0]; az += p[1]; }
  ax /= ring.length;
  az /= ring.length;
  const local = ring.map((p) => [p[0] - ax, p[1] - az] as [number, number]);
  const b = new B();
  const floorH = FREGAT_HEIGHT_M / FREGAT_LEVELS;
  const n = local.length;

  for (let e = 0; e < n; e++) {
    const a = local[e]!;
    const c = local[(e + 1) % n]!;
    const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
    const [ox, oz] = outward(a[0], a[1], c[0], c[1], 0, 0);
    for (let f = 0; f < FREGAT_LEVELS; f++) {
      const y0 = f * floorH;
      const y1 = (f + 1) * floorH;
      const band = len > 12 && f >= 1 && f % 2 === 0;
      const yBand = y1 - 0.55;
      const yGlass = y0 + floorH * 0.38;
      b.quad(a[0], y0, a[1], c[0], y0, c[1], c[0], yGlass, c[1], a[0], yGlass, a[1], FREGAT_PALETTE.facade);
      b.quad(a[0], yGlass, a[1], c[0], yGlass, c[1], c[0], yBand, c[1], a[0], yBand, a[1], FREGAT_PALETTE.glass);
      b.quad(a[0], yBand, a[1], c[0], yBand, c[1], c[0], y1, c[1], a[0], y1, a[1], band ? FREGAT_PALETTE.balcony : FREGAT_PALETTE.facade);
      if (band) {
        const d = 0.85;
        b.quad(
          a[0], y1 - 0.08, a[1], c[0], y1 - 0.08, c[1],
          c[0] + ox * d, y1 - 0.08, c[1] + oz * d, a[0] + ox * d, y1 - 0.08, a[1] + oz * d,
          FREGAT_PALETTE.balcony,
        );
        b.quad(
          a[0] + ox * d, yBand, a[1] + oz * d, c[0] + ox * d, yBand, c[1] + oz * d,
          c[0] + ox * d, y1 - 0.08, c[1] + oz * d, a[0] + ox * d, y1 - 0.08, a[1] + oz * d,
          FREGAT_PALETTE.balcony,
        );
      }
    }
  }

  const flat: number[] = [];
  for (const p of local) flat.push(p[0], p[1]);
  const roof = Earcut.triangulate(flat);
  if (roof) {
    const y = FREGAT_HEIGHT_M;
    const ids = local.map((p) => b.v(p[0], y, p[1], 0, 1, 0, FREGAT_PALETTE.roof));
    for (let k = 0; k < roof.length; k += 3) b.tri(ids[roof[k]!]!, ids[roof[k + 1]!]!, ids[roof[k + 2]!]!);
  }

  let south = local[0]!;
  for (const p of local) if (p[1] > south[1]) south = p;
  const inward = Math.hypot(south[0], south[1]) || 1;
  const tx = south[0] - (south[0] / inward) * 6;
  const tz = south[1] - (south[1] / inward) * 6;
  const half = 4;
  const towerTop = FREGAT_HEIGHT_M + 8;
  const corners: [number, number][] = [
    [tx - half, tz - half], [tx + half, tz - half], [tx + half, tz + half], [tx - half, tz + half],
  ];
  for (let e = 0; e < 4; e++) {
    const a = corners[e]!;
    const c = corners[(e + 1) % 4]!;
    const [ox, oz] = outward(a[0], a[1], c[0], c[1], tx, tz);
    for (let f = 0; f < 18; f++) {
      const y0 = f * (towerTop / 18);
      const y1 = (f + 1) * (towerTop / 18);
      const mid = (y0 + y1) / 2;
      const col = mid > FREGAT_HEIGHT_M ? FREGAT_PALETTE.tower : (f % 2 === 0 ? FREGAT_PALETTE.facade : FREGAT_PALETTE.glass);
      b.quad(a[0], y0, a[1], c[0], y0, c[1], c[0], y1, c[1], a[0], y1, a[1], col);
      if (oz > 0.6 && f % 2 === 1 && y1 < FREGAT_HEIGHT_M) {
        const yb = y1 - 0.12;
        b.quad(a[0], yb, a[1], c[0], yb, c[1], c[0] + ox * 0.6, yb, c[1] + oz * 0.6, a[0] + ox * 0.6, yb, a[1] + oz * 0.6, FREGAT_PALETTE.balcony);
      }
    }
  }
  b.quad(corners[0]![0], towerTop, corners[0]![1], corners[1]![0], towerTop, corners[1]![1], corners[2]![0], towerTop, corners[2]![1], corners[3]![0], towerTop, corners[3]![1], FREGAT_PALETTE.roof);

  // Sail: a curved fin on the river side of the tower, the crown in the owner's photo.
  const sailZ = tz + half;
  const segs = 8;
  for (let s = 0; s < segs; s++) {
    const t0 = s / segs;
    const t1 = (s + 1) / segs;
    const z0 = sailZ + Math.sin(t0 * Math.PI) * 7;
    const z1 = sailZ + Math.sin(t1 * Math.PI) * 7;
    const y0 = towerTop - 1 + Math.sin(t0 * Math.PI) * 9;
    const y1 = towerTop - 1 + Math.sin(t1 * Math.PI) * 9;
    const x0 = tx - 1.2;
    const x1 = tx + 1.2;
    b.quad(x0, towerTop - 2, z0, x1, towerTop - 2, z0, x1, y1, z1, x0, y0, z1, FREGAT_PALETTE.sail);
  }

  return {
    positions: Float32Array.from(b.p),
    normals: Float32Array.from(b.n),
    colors: Float32Array.from(b.c),
    indices: Uint32Array.from(b.i),
    anchorX: ax,
    anchorZ: az,
  };
}

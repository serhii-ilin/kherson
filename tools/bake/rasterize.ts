// Pure rasterization helpers. All coordinates are in cell units (1 unit = 1 cell);
// a cell (cx, cz) has its centre at (cx + 0.5, cz + 0.5).

export type Pt = readonly [number, number];
export type SetCell = (cx: number, cz: number) => void;

/** Even-odd scanline fill at cell centres. Every ring (outer or hole) is just a closed loop. */
export function fillPolygon(rings: readonly (readonly Pt[])[], set: SetCell): number {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const r of rings) {
    for (const p of r) {
      if (p[1] < minY) minY = p[1];
      if (p[1] > maxY) maxY = p[1];
    }
  }
  if (!(maxY >= minY)) return 0;
  const row0 = Math.ceil(minY - 0.5);
  const row1 = Math.ceil(maxY - 0.5) - 1;
  if (row1 < row0) return 0;
  const nRows = row1 - row0 + 1;
  // bucket edges by the first row they cover
  const buckets: number[][] = new Array(nRows);
  const ex1: number[] = [];
  const ey1: number[] = [];
  const ex2: number[] = [];
  const ey2: number[] = [];
  for (const r of rings) {
    const n = r.length;
    for (let i = 0; i < n; i++) {
      const a = r[i]!;
      const b = r[(i + 1) % n]!;
      if (a[1] === b[1]) continue;
      const lo = Math.max(row0, Math.ceil(Math.min(a[1], b[1]) - 0.5));
      const hi = Math.min(row1, Math.ceil(Math.max(a[1], b[1]) - 0.5) - 1);
      if (hi < lo) continue;
      const id = ex1.length;
      ex1.push(a[0]);
      ey1.push(a[1]);
      ex2.push(b[0]);
      ey2.push(b[1]);
      (buckets[lo - row0] ??= []).push(id);
    }
  }
  let active: number[] = [];
  const xs: number[] = [];
  let count = 0;
  for (let row = row0; row <= row1; row++) {
    const y = row + 0.5;
    const nb = buckets[row - row0];
    if (nb) for (const id of nb) active.push(id);
    xs.length = 0;
    const next: number[] = [];
    for (const id of active) {
      const y1 = ey1[id]!;
      const y2 = ey2[id]!;
      const ylo = y1 < y2 ? y1 : y2;
      const yhi = y1 < y2 ? y2 : y1;
      if (y >= yhi) continue; // finished
      next.push(id);
      if (y < ylo) continue;
      xs.push(ex1[id]! + ((y - y1) * (ex2[id]! - ex1[id]!)) / (y2 - y1));
    }
    active = next;
    xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const c0 = Math.ceil(xs[i]! - 0.5);
      const c1 = Math.ceil(xs[i + 1]! - 0.5) - 1;
      for (let c = c0; c <= c1; c++) {
        set(c, row);
        count++;
      }
    }
  }
  return count;
}

function distSq(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz;
  let t = l2 === 0 ? 0 : ((px - ax) * dx + (pz - az) * dz) / l2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = ax + t * dx - px;
  const qz = az + t * dz - pz;
  return qx * qx + qz * qz;
}

/** Cells whose centre lies within halfWidth of any segment of the polyline. May call set repeatedly for a cell. */
export function bufferLine(pts: readonly Pt[], halfWidth: number, set: SetCell): void {
  const hw2 = halfWidth * halfWidth;
  const n = pts.length;
  for (let i = 0; i < Math.max(1, n - 1); i++) {
    const a = pts[i];
    if (!a) return;
    const b = pts[i + 1] ?? a;
    const x0 = Math.floor(Math.min(a[0], b[0]) - halfWidth - 0.5);
    const x1 = Math.ceil(Math.max(a[0], b[0]) + halfWidth - 0.5);
    const z0 = Math.floor(Math.min(a[1], b[1]) - halfWidth - 0.5);
    const z1 = Math.ceil(Math.max(a[1], b[1]) + halfWidth - 0.5);
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) {
        if (distSq(cx + 0.5, cz + 0.5, a[0], a[1], b[0], b[1]) <= hw2) set(cx, cz);
      }
    }
  }
}

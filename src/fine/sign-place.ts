/**
 * Shop sign placement (pure, runs in the fine worker). Each SHOP point of the vector tiles emits one
 * sign, from the chunk containing the point. Chunk independence as in props.ts: the result depends on
 * world data only, and signs near the bounds are resolved together so overlaps settle identically.
 */
import { POINT, ROAD_BRIDGE, type VectorTile } from '../world/vector-format.ts';
import { closest, inRings, isVehicleKind, PropWorld, segDist, type Bounds, type Hit, type WPoly } from './props.ts';

export interface SignPlacement {
  /** Centre of the plate (world m). */
  x: number;
  y: number;
  z: number;
  /** Unit outward normal of the wall (the plate's front). */
  nx: number;
  nz: number;
  /** Width available on the wall (m). */
  avail: number;
  /** Index into the tile's strings, and that tile. */
  name: string;
}

export const SIGN_STRIDE = 7;
const MAX_BUILDING_DIST = 25;
const STACK_STEP = 0.9;
const NEAR = 30;

function cosAxis(n: number): boolean {
  return Math.abs(n) >= 0.94;
}

function baseOf(p: WPoly, ground: (x: number, z: number) => number): number {
  // lowest coarse ground over the footprint, sampled on the global even grid like the block builder
  let g = Infinity;
  const r = p.rings[0]!;
  const x0 = Math.floor(p.bx0), z0 = Math.floor(p.bz0);
  for (let gz = z0 + (z0 & 1); gz <= p.bz1; gz += 2) {
    for (let gx = x0 + (x0 & 1); gx <= p.bx1; gx += 2) {
      if (!inRings(p.rings, gx + 0.5, gz + 0.5)) continue;
      const h = ground(gx + 0.5, gz + 0.5);
      if (h < g) g = h;
    }
  }
  if (g === Infinity) g = ground(r[0]!, r[1]!);
  return Math.max(0, Math.floor(g + 1e-6));
}

interface Raw extends SignPlacement {
  key: number;
}

/**
 * Signs of the shops anchored in `bounds`. `ground` is the coarse ground top (m). The returned
 * `name` is the original string.
 */
export function placeSigns(
  tiles: readonly VectorTile[], bounds: Bounds, ground: (x: number, z: number) => number,
): SignPlacement[] {
  const wide: Bounds = { x0: bounds.x0 - NEAR, z0: bounds.z0 - NEAR, x1: bounds.x1 + NEAR, z1: bounds.z1 + NEAR };
  const w = new PropWorld(tiles, wide, NEAR + 10);
  const shops = w.points.filter((p) => p.kind === POINT.SHOP && p.name >= 0
    && p.x >= wide.x0 && p.x < wide.x1 && p.z >= wide.z0 && p.z < wide.z1);
  shops.sort((a, b) => a.x - b.x || a.z - b.z || a.name - b.name);
  const hit: Hit = { d: 0, px: 0, pz: 0, tx: 1, tz: 0, s: 0 };
  const roadDist = (x: number, z: number): number => {
    let best = Infinity;
    for (const r of w.veh) {
      if ((r.flags & ROAD_BRIDGE) !== 0 || !isVehicleKind(r.kind)) continue;
      if (x < r.bx0 - 20 || x > r.bx1 + 20 || z < r.bz0 - 20 || z > r.bz1 + 20) continue;
      const d = closest(r, x, z, hit).d;
      if (d < best) best = d;
    }
    return best;
  };
  const placed: Raw[] = [];
  const out: SignPlacement[] = [];
  for (const s of shops) {
    // nearest building
    let bp: WPoly | null = null;
    let bd = Infinity;
    for (const p of w.buildings) {
      if (s.x < p.bx0 - MAX_BUILDING_DIST || s.x > p.bx1 + MAX_BUILDING_DIST
        || s.z < p.bz0 - MAX_BUILDING_DIST || s.z > p.bz1 + MAX_BUILDING_DIST) continue;
      let d = inRings(p.rings, s.x, s.z) ? 0 : Infinity;
      if (d !== 0) {
        const r = p.rings[0]!;
        const n = r.length >> 1;
        for (let i = 0, j = n - 1; i < n; j = i++) d = Math.min(d, segDist(s.x, s.z, r[j * 2]!, r[j * 2 + 1]!, r[i * 2]!, r[i * 2 + 1]!));
      }
      if (d < bd || (d === bd && bp !== null && p.id < bp.id)) { bd = d; bp = p; }
    }
    if (bp === null || bd > MAX_BUILDING_DIST) continue;
    const ring = bp.rings[0]!;
    const n = ring.length >> 1;
    let area = 0;
    for (let i = 0, j = n - 1; i < n; j = i++) area += ring[j * 2]! * ring[i * 2 + 1]! - ring[i * 2]! * ring[j * 2 + 1]!;
    const sgn = area >= 0 ? 1 : -1;
    // best edge: near the shop, long enough, preferably facing a drivable road
    let best = -1, bestScore = Infinity;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ax = ring[i * 2]!, az = ring[i * 2 + 1]!, bx = ring[j * 2]!, bz = ring[j * 2 + 1]!;
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 3) continue;
      const nx = sgn * (bz - az) / len, nz = -sgn * (bx - ax) / len;
      const d = segDist(s.x, s.z, ax, az, bx, bz);
      const rd = roadDist((ax + bx) / 2 + nx * 2, (az + bz) / 2 + nz * 2);
      const score = d + (rd < 16 ? 0 : 10);
      if (score < bestScore) { bestScore = score; best = i; }
    }
    if (best < 0) continue;
    const j = (best + 1) % n;
    const ax = ring[best * 2]!, az = ring[best * 2 + 1]!, bx = ring[j * 2]!, bz = ring[j * 2 + 1]!;
    const len = Math.hypot(bx - ax, bz - az);
    const tx = (bx - ax) / len, tz = (bz - az) / len;
    let nx = sgn * tz, nz = -sgn * tx;
    // position along the edge: projection of the shop, kept clear of the corners
    const edgeMargin = Math.min(1.5, len / 2);
    const u = Math.min(len - edgeMargin, Math.max(edgeMargin, (s.x - ax) * tx + (s.z - az) * tz));
    const avail = 2 * Math.min(u, len - u) - 0.2;
    if (avail < 1.5) continue;
    let cx = ax + tx * u, cz = az + tz * u;
    const inMask = (x: number, z: number): boolean => inRings(bp!.rings, Math.floor(x) + 0.5, Math.floor(z) + 0.5);
    if (cosAxis(nx) || cosAxis(nz)) {
      // snap to the real 1 m wall face: walk outward from inside the polygon to the first free column
      const ax2 = Math.abs(nx) >= Math.abs(nz) ? Math.sign(nx) : 0;
      const az2 = ax2 === 0 ? Math.sign(nz) : 0;
      let found = false;
      for (let k = -15; k <= 20; k++) {
        const px = cx + ax2 * k * 0.1, pz = cz + az2 * k * 0.1;
        if (inMask(px, pz) && !inMask(px + ax2 * 0.1, pz + az2 * 0.1)) {
          // last inside column ends at an integer coordinate
          if (ax2 !== 0) cx = ax2 > 0 ? Math.floor(px) + 1 : Math.floor(px);
          else cz = az2 > 0 ? Math.floor(pz) + 1 : Math.floor(pz);
          found = true;
          break;
        }
      }
      nx = ax2;
      nz = az2;
      if (!found) { cx += nx * 0.0; cz += nz * 0.0; }
    } else {
      cx += nx * 0.5;
      cz += nz * 0.5;
    }
    cx += nx * 0.08;
    cz += nz * 0.08;
    const baseY = baseOf(bp, ground);
    const hMetres = Math.max(3, Math.round(bp.heightCm / 100));
    let y = baseY + (hMetres >= 5 ? 3.3 : Math.max(1.6, hMetres - 0.9));
    // stack on signs already on this wall plane
    for (let tries = 0; tries < 3; tries++) {
      let clash = false;
      for (const q of placed) {
        if (Math.abs(q.nx * nx + q.nz * nz) < 0.9) continue;
        if (Math.abs((q.x - cx) * nx + (q.z - cz) * nz) > 0.4) continue;
        if (Math.abs((q.x - cx) * tx + (q.z - cz) * tz) > (q.avail + avail) / 4 + 0.5 && Math.abs(q.x - cx) + Math.abs(q.z - cz) > 6) continue;
        if (Math.abs(q.y - y) < 0.8) { clash = true; break; }
      }
      if (!clash) break;
      y += STACK_STEP;
    }
    const name = s.tile.strings[s.name] ?? '';
    if (name === '') continue;
    const sign: Raw = { x: cx, y, z: cz, nx, nz, avail, name, key: s.name };
    placed.push(sign);
    if (s.x >= bounds.x0 && s.x < bounds.x1 && s.z >= bounds.z0 && s.z < bounds.z1) {
      out.push({ x: cx, y, z: cz, nx, nz, avail, name });
    }
  }
  return out;
}

/** Packs signs into a flat array (stride SIGN_STRIDE) with chunk-local x/z, plus the distinct names. */
export function packSigns(signs: readonly SignPlacement[], ox: number, oz: number): { data: Float32Array; names: string[] } {
  const names: string[] = [];
  const index = new Map<string, number>();
  const data = new Float32Array(signs.length * SIGN_STRIDE);
  signs.forEach((s, i) => {
    let k = index.get(s.name);
    if (k === undefined) { k = names.length; names.push(s.name); index.set(s.name, k); }
    data.set([s.x - ox, s.y, s.z - oz, s.nx, s.nz, s.avail, k], i * SIGN_STRIDE);
  });
  return { data, names };
}

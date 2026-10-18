/**
 * Bridges as 1 m blocks (REALISM_PLAN Phase 3). Every road piece with ROAD_BRIDGE is rasterised into
 * the chunk volume: deck slab, side walkways, railings and piers over water.
 *
 * Chunk independence: every block decision depends only on the road piece (its polyline, its height
 * profile sampled from the context) and the block's world position, never on the chunk, so two
 * neighbouring volumes agree exactly on their shared border.
 *
 * Pier rule: over water, a block belongs to a pier when the coordinate of its centre along the piece
 * segment's dominant axis (x if |dx| >= |dz| else z), floored to whole metres, satisfies
 * `floor(u) mod 40 < 3`, i.e. 3 m thick bands on the GLOBAL 40 m grid. Piers span the full deck width
 * and run from the river bed (groundAt) up to the deck underside.
 */
import { MAT } from '../world/materials.ts';
import { ROAD, ROAD_BRIDGE, ROAD_SIDEWALK, type VRoad } from '../world/vector-format.ts';
import { VOL_XZ, type Volume } from './volume.ts';

export interface BridgeContext {
  /** Coarse ground top (m) at world x, z (water cells return the river bed / water ground top). */
  groundAt(x: number, z: number): number;
  isWater(x: number, z: number): boolean;
  /** Top (m) of the coarse bridge deck at x, z if a coarse FEATURE_BRIDGE_DECK cell is there, else null. */
  deckTopAt(x: number, z: number): number | null;
}

/** A road from a vector tile plus that tile's origin in world metres. */
export interface PlacedRoad {
  road: VRoad;
  /** World metres of the tile's NW corner (rx * 512, rz * 512). */
  ox: number;
  oz: number;
}

const SIDE_WALK_M = 1.5;
const PIER_SPACING = 40;
const PIER_THICK = 3;
const MIN_DECK_M = 2;

export function addBridges(vol: Volume, roads: readonly PlacedRoad[], ctx: BridgeContext): void {
  for (const pr of roads) {
    if ((pr.road.flags & ROAD_BRIDGE) === 0 || pr.road.pts.length < 4) continue;
    addBridge(vol, pr, ctx);
  }
}

function addBridge(vol: Volume, pr: PlacedRoad, ctx: BridgeContext): void {
  const { road, ox, oz } = pr;
  const n = road.pts.length >> 1;
  const px = new Float64Array(n), pz = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    px[i] = ox + road.pts[i * 2]! / 100;
    pz[i] = oz + road.pts[i * 2 + 1]! / 100;
  }
  const vehicle = road.kind >= ROAD.MOTORWAY && road.kind <= ROAD.SERVICE;
  const walks = vehicle || (road.flags & ROAD_SIDEWALK) !== 0;
  const carriage = Math.max(road.widthCm / 100, vehicle ? 3 : 1.5);
  const halfW = (carriage + (walks ? 2 * SIDE_WALK_M : 0)) / 2;
  const halfCar = carriage / 2;

  // Cheap reject on the piece bbox.
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < n; i++) {
    if (px[i]! < minX) minX = px[i]!;
    if (px[i]! > maxX) maxX = px[i]!;
    if (pz[i]! < minZ) minZ = pz[i]!;
    if (pz[i]! > maxZ) maxZ = pz[i]!;
  }
  minX -= halfW + 1; maxX += halfW + 1; minZ -= halfW + 1; maxZ += halfW + 1;
  if (maxX < vol.x0 || minX > vol.x0 + VOL_XZ || maxZ < vol.z0 || minZ > vol.z0 + VOL_XZ) return;

  // Segment data and cumulative arc length.
  const segs = n - 1;
  const cum = new Float64Array(n);
  const slen = new Float64Array(segs);
  for (let i = 0; i < segs; i++) {
    slen[i] = Math.hypot(px[i + 1]! - px[i]!, pz[i + 1]! - pz[i]!);
    cum[i + 1] = cum[i]! + slen[i]!;
  }
  const total = cum[segs]!;
  if (total < 0.5) return;

  const prof = heightProfile(px, pz, cum, total, halfW, ctx);
  const steps = prof.length - 1;
  const stepLen = total / steps;

  const bx0 = Math.max(0, Math.floor(minX - vol.x0)), bx1 = Math.min(VOL_XZ - 1, Math.floor(maxX - vol.x0));
  const bz0 = Math.max(0, Math.floor(minZ - vol.z0)), bz1 = Math.min(VOL_XZ - 1, Math.floor(maxZ - vol.z0));

  for (let bz = bz0; bz <= bz1; bz++) {
    const wz = vol.z0 + bz + 0.5;
    for (let bx = bx0; bx <= bx1; bx++) {
      const wx = vol.x0 + bx + 0.5;
      // Nearest point on the polyline; the first/last segments have square (unclamped) ends.
      let bestD = Infinity, bestS = 0, bestSeg = -1;
      for (let i = 0; i < segs; i++) {
        const dx = px[i + 1]! - px[i]!, dz = pz[i + 1]! - pz[i]!;
        const len = slen[i]!;
        if (len < 1e-6) continue;
        let t = ((wx - px[i]!) * dx + (wz - pz[i]!) * dz) / len; // metres along the segment
        if (i === 0 && t < 0) continue;
        if (i === segs - 1 && t > len) continue;
        if (t < 0) t = 0; else if (t > len) t = len;
        const qx = px[i]! + (dx / len) * t, qz = pz[i]! + (dz / len) * t;
        const d = Math.hypot(wx - qx, wz - qz);
        if (d < bestD) {
          bestD = d;
          bestS = cum[i]! + t;
          bestSeg = i;
        }
      }
      if (bestSeg < 0 || bestD > halfW) continue;

      const fi = Math.min(steps - 1, Math.floor(bestS / stepLen));
      const f = bestS / stepLen - fi;
      const H = Math.round(prof[fi]! * (1 - f) + prof[fi + 1]! * f); // deck top (m), whole blocks
      if (H < MIN_DECK_M) continue;

      const top = !vehicle ? MAT.SIDEWALK : bestD > halfCar && walks ? MAT.SIDEWALK : MAT.ASPHALT;
      vol.set(bx, H - 1, bz, top);
      vol.set(bx, H - 2, bz, MAT.BRIDGE);
      if (bestD > halfW - 1) vol.set(bx, H, bz, MAT.METAL);

      if (ctx.isWater(wx, wz)) {
        const sdx = Math.abs(px[bestSeg + 1]! - px[bestSeg]!), sdz = Math.abs(pz[bestSeg + 1]! - pz[bestSeg]!);
        const u = Math.floor(sdx >= sdz ? wx : wz);
        if (((u % PIER_SPACING) + PIER_SPACING) % PIER_SPACING < PIER_THICK) {
          const bed = Math.max(0, Math.floor(ctx.groundAt(wx, wz)));
          for (let y = bed; y < H - 2; y++) vol.set(bx, y, bz, MAT.CONCRETE);
        }
      }
    }
  }
}

/**
 * Deck top (whole metres, as numbers) at `steps + 1` evenly spaced arc positions: the coarse deck
 * where it exists, linearly ramped to the ground at land ends, then lightly smoothed.
 */
function heightProfile(
  px: Float64Array, pz: Float64Array, cum: Float64Array, total: number, halfW: number, ctx: BridgeContext,
): Float64Array {
  const steps = Math.max(1, Math.ceil(total));
  const m = steps + 1;
  const raw = new Float64Array(m).fill(NaN);
  const stepLen = total / steps;
  let seg = 0;
  const lateral = halfW * 0.6;
  for (let k = 0; k < m; k++) {
    const s = k * stepLen;
    while (seg < cum.length - 2 && cum[seg + 1]! < s) seg++;
    const len = cum[seg + 1]! - cum[seg]!;
    const t = len > 1e-9 ? Math.min(1, Math.max(0, (s - cum[seg]!) / len)) : 0;
    const x = px[seg]! + (px[seg + 1]! - px[seg]!) * t, z = pz[seg]! + (pz[seg + 1]! - pz[seg]!) * t;
    const nx = len > 1e-9 ? -(pz[seg + 1]! - pz[seg]!) / len : 0, nz = len > 1e-9 ? (px[seg + 1]! - px[seg]!) / len : 0;
    let best = -Infinity;
    for (const off of [0, lateral, -lateral]) {
      const v = ctx.deckTopAt(x + nx * off, z + nz * off);
      if (v !== null && v > best) best = v;
    }
    if (best > -Infinity) raw[k] = best;
  }
  // Land ends without a coarse deck anchor to the ground (water ends hold the nearest deck instead).
  if (Number.isNaN(raw[0]!) && !ctx.isWater(px[0]!, pz[0]!)) raw[0] = ctx.groundAt(px[0]!, pz[0]!);
  const last = px.length - 1;
  if (Number.isNaN(raw[m - 1]!) && !ctx.isWater(px[last]!, pz[last]!)) raw[m - 1] = ctx.groundAt(px[last]!, pz[last]!);

  const startAnchor = raw[0]!, endAnchor = raw[m - 1]!;
  const out = new Float64Array(m);
  let prev = -1;
  for (let k = 0; k < m; k++) {
    if (Number.isNaN(raw[k]!)) continue;
    if (prev < 0) {
      for (let j = 0; j < k; j++) out[j] = raw[k]!;
    } else {
      for (let j = prev + 1; j < k; j++) out[j] = raw[prev]! + ((raw[k]! - raw[prev]!) * (j - prev)) / (k - prev);
    }
    out[k] = raw[k]!;
    prev = k;
  }
  if (prev < 0) {
    out.fill(ctx.groundAt(px[0]!, pz[0]!)); // nothing known at all: lie on the ground
  } else {
    for (let j = prev + 1; j < m; j++) out[j] = raw[prev]!;
  }
  // Smooth (moving average, radius 2), keeping the anchored ends exact so ramps meet the ground.
  const sm = new Float64Array(m);
  for (let k = 0; k < m; k++) {
    let a = 0, c = 0;
    for (let j = Math.max(0, k - 2); j <= Math.min(m - 1, k + 2); j++) { a += out[j]!; c++; }
    sm[k] = a / c;
  }
  if (!Number.isNaN(startAnchor)) sm[0] = startAnchor;
  if (!Number.isNaN(endAnchor)) sm[m - 1] = endAnchor;
  return sm;
}

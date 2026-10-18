/**
 * Bridges as 1 m blocks (REALISM_PLAN Phase 3). Every road piece with ROAD_BRIDGE is rasterised into
 * the chunk volume: deck slab, side walkways, railings and piers over water.
 *
 * Chunk independence: every block decision depends only on the road piece (its polyline, its height
 * profile sampled from the context) and the block's world position, never on the chunk, so two
 * neighbouring volumes agree exactly on their shared border.
 *
 * Continuity across pieces (REALISM_PLAN: roads are split at 64 m): a piece end whose exact coordinate is also
 * an end of another bridge piece is interior; its deck height is a function of that point alone (the highest
 * coarse deck within 12 m, else the ground), so both pieces meet there and neither ramps to the ground. Only
 * true bridge ends ramp. The set of shared ends comes from `all`, the bridge roads of the whole tile
 * neighbourhood (not only those gathered near the chunk), so every chunk decides identically.
 * The fine ground job paints lane markings on the deck tops with the same profile (deckTopOfColumn).
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

/** Disc radius (m) searched for a coarse deck when a piece end is shared with another piece. */
const SHARED_RADIUS = 12;
const SHARED_STEP = 3;

/** Key of a world point in whole centimetres (exact-match identity of road vertices). */
function pointKey(x: number, z: number): number {
  return Math.round(x * 100) * 8e6 + Math.round(z * 100);
}

function endKeys(pr: PlacedRoad): [number, number] {
  const p = pr.road.pts;
  const n = p.length >> 1;
  return [
    pointKey(pr.ox + p[0]! / 100, pr.oz + p[1]! / 100),
    pointKey(pr.ox + p[(n - 1) * 2]! / 100, pr.oz + p[(n - 1) * 2 + 1]! / 100),
  ];
}

const endCache = new WeakMap<readonly PlacedRoad[], ReadonlySet<number>>();

/**
 * Keys of the road ends shared by two or more distinct bridge pieces ("exact coordinate match among bridge
 * roads"). Such an end is interior to a longer bridge: its deck keeps the deck height instead of ramping
 * to the ground. Pieces duplicated into several tiles are counted once. `all` must hold every bridge road
 * of the tile neighbourhood, not only those near the chunk, so every chunk reaches the same decision.
 */
export function sharedBridgeEnds(all: readonly PlacedRoad[]): ReadonlySet<number> {
  let set = endCache.get(all);
  if (set !== undefined) return set;
  const count = new Map<number, number>();
  const seen = new Set<string>();
  for (const pr of all) {
    if ((pr.road.flags & ROAD_BRIDGE) === 0 || pr.road.pts.length < 4) continue;
    const [a, b] = endKeys(pr);
    const sig = `${a}|${b}|${pr.road.pts.length}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    count.set(a, (count.get(a) ?? 0) + 1);
    if (b !== a) count.set(b, (count.get(b) ?? 0) + 1);
  }
  const out = new Set<number>();
  for (const [k, c] of count) if (c >= 2) out.add(k);
  set = out;
  endCache.set(all, set);
  return set;
}

/** One bridge road piece: geometry plus its deck-height profile. */
export interface BridgeDeck {
  px: Float64Array;
  pz: Float64Array;
  cum: Float64Array;
  slen: Float64Array;
  total: number;
  vehicle: boolean;
  walks: boolean;
  halfW: number;
  halfCar: number;
  bbox: [number, number, number, number];
  /** Height profile (m, unrounded) at `steps + 1` even arc positions; empty until {@link bridgeProfile}. */
  prof: Float64Array;
  steps: number;
  stepLen: number;
  road: VRoad;
}

/** Geometry of a bridge piece (cheap); null when it is not a usable bridge. */
export function bridgeGeometry(pr: PlacedRoad): BridgeDeck | null {
  const { road, ox, oz } = pr;
  if ((road.flags & ROAD_BRIDGE) === 0 || road.pts.length < 4) return null;
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
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < n; i++) {
    if (px[i]! < minX) minX = px[i]!;
    if (px[i]! > maxX) maxX = px[i]!;
    if (pz[i]! < minZ) minZ = pz[i]!;
    if (pz[i]! > maxZ) maxZ = pz[i]!;
  }
  const segs = n - 1;
  const cum = new Float64Array(n);
  const slen = new Float64Array(segs);
  for (let i = 0; i < segs; i++) {
    slen[i] = Math.hypot(px[i + 1]! - px[i]!, pz[i + 1]! - pz[i]!);
    cum[i + 1] = cum[i]! + slen[i]!;
  }
  const total = cum[segs]!;
  if (total < 0.5) return null;
  return {
    px, pz, cum, slen, total, vehicle, walks, halfW, halfCar,
    bbox: [minX - halfW - 1, minZ - halfW - 1, maxX + halfW + 1, maxZ + halfW + 1],
    prof: new Float64Array(0), steps: 0, stepLen: 0, road,
  };
}

/** Computes the deck-height profile of `d` in place (see {@link heightProfile}). */
export function bridgeProfile(d: BridgeDeck, ctx: BridgeContext, shared: ReadonlySet<number>): BridgeDeck {
  const n = d.px.length;
  const startShared = shared.has(pointKey(d.px[0]!, d.pz[0]!));
  const endShared = shared.has(pointKey(d.px[n - 1]!, d.pz[n - 1]!));
  d.prof = heightProfile(d.px, d.pz, d.cum, d.total, d.halfW, ctx, startShared, endShared);
  d.steps = d.prof.length - 1;
  d.stepLen = d.total / d.steps;
  return d;
}

/** Nearest-point result of {@link nearestOnDeck}: distance, arc position, segment. */
export const nearestDeck = { d: 0, s: 0, seg: -1 };

/**
 * Nearest point of the piece polyline to (wx, wz); the first/last segments have square (unclamped) ends.
 * Fills {@link nearestDeck}; returns false when the point projects on no segment.
 */
export function nearestOnDeck(d: BridgeDeck, wx: number, wz: number): boolean {
  const { px, pz, cum, slen } = d;
  const segs = slen.length;
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
    const dd = Math.hypot(wx - qx, wz - qz);
    if (dd < bestD) {
      bestD = dd;
      bestS = cum[i]! + t;
      bestSeg = i;
    }
  }
  nearestDeck.d = bestD;
  nearestDeck.s = bestS;
  nearestDeck.seg = bestSeg;
  return bestSeg >= 0;
}

/** Deck top (whole metres) at arc position `s`: the profile interpolated and rounded to blocks. */
export function deckHeight(d: BridgeDeck, s: number): number {
  const fi = Math.min(d.steps - 1, Math.floor(s / d.stepLen));
  const f = s / d.stepLen - fi;
  return Math.round(d.prof[fi]! * (1 - f) + d.prof[fi + 1]! * f);
}

/**
 * Deck top (m) of the 1 m block column containing (wx, wz) and whether that column carries a deck;
 * the very rule {@link addBridges} uses (evaluated at the column centre), so other passes agree exactly.
 * Returns -1 when the column has no deck.
 */
export function deckTopOfColumn(d: BridgeDeck, wx: number, wz: number): number {
  const cx = Math.floor(wx) + 0.5, cz = Math.floor(wz) + 0.5;
  if (!nearestOnDeck(d, cx, cz) || nearestDeck.d > d.halfW) return -1;
  const H = deckHeight(d, nearestDeck.s);
  return H < MIN_DECK_M ? -1 : H;
}

/**
 * Rasterises every bridge piece of `roads` into `vol`. `all` (default `roads`) lists every bridge road of
 * the tile neighbourhood; it decides which piece ends are shared and so keep the deck height.
 */
export function addBridges(
  vol: Volume, roads: readonly PlacedRoad[], ctx: BridgeContext, all: readonly PlacedRoad[] = roads,
): void {
  const shared = sharedBridgeEnds(all);
  for (const pr of roads) {
    const d = bridgeGeometry(pr);
    if (d === null) continue;
    const [bx0, bz0, bx1, bz1] = d.bbox;
    if (bx1 < vol.x0 || bx0 > vol.x0 + VOL_XZ || bz1 < vol.z0 || bz0 > vol.z0 + VOL_XZ) continue;
    addBridge(vol, bridgeProfile(d, ctx, shared), ctx);
  }
}

function addBridge(vol: Volume, d: BridgeDeck, ctx: BridgeContext): void {
  const { px, pz, halfW, halfCar, vehicle, walks } = d;
  const [minX, minZ, maxX, maxZ] = d.bbox;
  const bx0 = Math.max(0, Math.floor(minX - vol.x0)), bx1 = Math.min(VOL_XZ - 1, Math.floor(maxX - vol.x0));
  const bz0 = Math.max(0, Math.floor(minZ - vol.z0)), bz1 = Math.min(VOL_XZ - 1, Math.floor(maxZ - vol.z0));

  for (let bz = bz0; bz <= bz1; bz++) {
    const wz = vol.z0 + bz + 0.5;
    for (let bx = bx0; bx <= bx1; bx++) {
      const wx = vol.x0 + bx + 0.5;
      if (!nearestOnDeck(d, wx, wz) || nearestDeck.d > halfW) continue;
      const bestD = nearestDeck.d, bestSeg = nearestDeck.seg;
      const H = deckHeight(d, nearestDeck.s); // deck top (m), whole blocks
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
  startShared = false, endShared = false,
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
  // Land ends without a coarse deck anchor to the ground (water ends hold the nearest deck instead). An end
  // shared with another bridge piece is interior: it takes the deck height found around that point (or the
  // ground when there is no deck), a function of the point alone, so both pieces agree and neither ramps.
  const last = px.length - 1;
  if (startShared) {
    const v = sharedAnchor(px[0]!, pz[0]!, ctx);
    if (!Number.isNaN(v)) raw[0] = v;
  } else if (Number.isNaN(raw[0]!) && !ctx.isWater(px[0]!, pz[0]!)) raw[0] = ctx.groundAt(px[0]!, pz[0]!);
  if (endShared) {
    const v = sharedAnchor(px[last]!, pz[last]!, ctx);
    if (!Number.isNaN(v)) raw[m - 1] = v;
  } else if (Number.isNaN(raw[m - 1]!) && !ctx.isWater(px[last]!, pz[last]!)) raw[m - 1] = ctx.groundAt(px[last]!, pz[last]!);

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

/** Deck height at a shared piece end: the highest coarse deck within SHARED_RADIUS, else the ground (NaN over water). */
function sharedAnchor(x: number, z: number, ctx: BridgeContext): number {
  let best = -Infinity;
  for (let dz = -SHARED_RADIUS; dz <= SHARED_RADIUS; dz += SHARED_STEP) {
    for (let dx = -SHARED_RADIUS; dx <= SHARED_RADIUS; dx += SHARED_STEP) {
      if (dx * dx + dz * dz > SHARED_RADIUS * SHARED_RADIUS) continue;
      const v = ctx.deckTopAt(x + dx, z + dz);
      if (v !== null && v > best) best = v;
    }
  }
  if (best > -Infinity) return best;
  return ctx.isWater(x, z) ? NaN : ctx.groundAt(x, z);
}

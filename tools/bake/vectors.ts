// Pure builder of vector tiles (Phase 2A): parsed OSM geometry -> Map<regionKey, VectorTile>.
// No fs. Deterministic: stable iteration (sorted by OSM id), no randomness.
//
// Ownership (src/world/vector-format.ts): buildings, road pieces, line pieces and points are stored once,
// in the region of their anchor. EXCEPTION: ground areas are large and span many regions, so each area
// is clipped (Sutherland-Hodgman, per ring) to every overlapping region rectangle expanded by 64 m and
// the clipped copy is DUPLICATED into each of those regions.
import { REGION, VOXEL } from "../../src/world/constants.ts";
import {
  LINE, NO_DIR, POINT, ROAD, ROAD_BRIDGE, ROAD_LINK, ROAD_LIT, ROAD_ONEWAY, ROAD_SIDEWALK, ROAD_UNPAVED, ROOF,
  type VectorTile, type VArea, type VBuilding, type VLine, type VPoint, type VRoad,
} from "../../src/world/vector-format.ts";
import { buildingSpec, parseNum } from "./building-style.ts";
import { HW, SIDEWALK_ROAD, groundClass, isWater } from "./classes.ts";
import type { Tags } from "./osm.ts";
import type { Pt } from "./rasterize.ts";

export interface VArea_ {
  id: number;
  tags: Tags;
  rings: Pt[][];
}
export interface VLineIn {
  id: number;
  tags: Tags;
  pts: Pt[];
  /** OSM node id per point (optional; enables crossing/signal directions). */
  nodeIds?: number[];
}
export interface VNodeIn {
  id: number;
  cx: number;
  cz: number;
  tags: Tags;
}
export interface VectorInput {
  /** Building and ground areas (as the coarse bake sees them). */
  areas: VArea_[];
  /** highway / railway / waterway ways. */
  lines: VLineIn[];
  /** `barrier=*` ways. */
  barriers: VLineIn[];
  taggedNodes: VNodeIn[];
  regionsX: number;
  regionsZ: number;
  /** City centre in world metres (for building style, like the coarse bake). */
  centre: readonly [number, number];
}

export interface VectorStats {
  buildings: number;
  roads: number;
  areas: number;
  areaCopies: number;
  lines: number;
  points: number;
}

/** Region side in cm. */
export const REGION_CM = REGION * VOXEL * 100;
/** Maximum arc length of a road/line piece, cm. */
export const PIECE_CM = 6400;
/** Clip margin around a region for areas, cm. */
export const AREA_MARGIN_CM = 6400;

const has = (v: string | undefined): boolean => v !== undefined && v !== "no";

type Cm = [number, number];

/** Cell-unit point -> absolute integer centimetres. */
const toCm = (p: Pt): Cm => [Math.round(p[0] * VOXEL * 100), Math.round(p[1] * VOXEL * 100)];

function dedupe(pts: Cm[]): Cm[] {
  const out: Cm[] = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (!q || q[0] !== p[0] || q[1] !== p[1]) out.push(p);
  }
  return out;
}

function ringCm(r: readonly Pt[]): Cm[] {
  let pts = dedupe(r.map(toCm));
  if (pts.length > 1) {
    const a = pts[0]!, b = pts[pts.length - 1]!;
    if (a[0] === b[0] && a[1] === b[1]) pts = pts.slice(0, -1);
  }
  return pts;
}

/** Split a polyline into pieces of arc length <= PIECE_CM; pieces share split points. */
export function splitPolyline(pts: Cm[], limit = PIECE_CM): Cm[][] {
  const cum: number[] = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1]! + Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]));
  const total = cum[cum.length - 1]!;
  if (total <= limit) return [pts];
  // the -4 absorbs integer rounding of the interpolated split points
  const n = Math.ceil(total / (limit - 4));
  const pieces: Cm[][] = [];
  let seg = 0;
  let cur: Cm[] = [pts[0]!];
  for (let k = 1; k <= n; k++) {
    const target = k === n ? total : (total * k) / n;
    while (seg + 1 < pts.length - 1 && cum[seg + 1]! < target) {
      seg++;
      cur.push(pts[seg]!);
    }
    let end: Cm;
    if (k === n) end = pts[pts.length - 1]!;
    else {
      const a = pts[seg]!, b = pts[seg + 1]!;
      const sl = cum[seg + 1]! - cum[seg]!;
      const f = sl > 0 ? (target - cum[seg]!) / sl : 0;
      end = [Math.round(a[0] + (b[0] - a[0]) * f), Math.round(a[1] + (b[1] - a[1]) * f)];
    }
    cur.push(end);
    pieces.push(dedupe(cur));
    cur = [end];
  }
  return pieces.filter((p) => p.length >= 2);
}

/** Point at half the arc length of a polyline. */
export function midpoint(pts: readonly Cm[]): Cm {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]);
  let acc = total / 2;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!, b = pts[i]!;
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (acc <= l && l > 0) {
      const f = acc / l;
      return [Math.round(a[0] + (b[0] - a[0]) * f), Math.round(a[1] + (b[1] - a[1]) * f)];
    }
    acc -= l;
  }
  return pts[pts.length - 1]!;
}

type Poly = readonly (readonly [number, number])[];

/** Sutherland-Hodgman clip of one ring against an axis-aligned rectangle. */
export function clipRing(ring: Poly, x0: number, z0: number, x1: number, z1: number): [number, number][] {
  let out: [number, number][] = ring.map((p) => [p[0], p[1]]);
  const edges: { inside: (p: [number, number]) => boolean; cut: (a: [number, number], b: [number, number]) => [number, number] }[] = [
    { inside: (p) => p[0] >= x0, cut: (a, b) => [x0, a[1] + ((b[1] - a[1]) * (x0 - a[0])) / (b[0] - a[0])] },
    { inside: (p) => p[0] <= x1, cut: (a, b) => [x1, a[1] + ((b[1] - a[1]) * (x1 - a[0])) / (b[0] - a[0])] },
    { inside: (p) => p[1] >= z0, cut: (a, b) => [a[0] + ((b[0] - a[0]) * (z0 - a[1])) / (b[1] - a[1]), z0] },
    { inside: (p) => p[1] <= z1, cut: (a, b) => [a[0] + ((b[0] - a[0]) * (z1 - a[1])) / (b[1] - a[1]), z1] },
  ];
  for (const e of edges) {
    const inp = out;
    out = [];
    if (inp.length === 0) break;
    let prev = inp[inp.length - 1]!;
    for (const cur of inp) {
      const ci = e.inside(cur), pi = e.inside(prev);
      if (ci) {
        if (!pi) out.push(e.cut(prev, cur));
        out.push(cur);
      } else if (pi) out.push(e.cut(prev, cur));
      prev = cur;
    }
  }
  return out;
}

class Strings {
  list: string[] = [];
  private map = new Map<string, number>();
  idx(s: string | undefined): number {
    if (!s) return -1;
    let i = this.map.get(s);
    if (i === undefined) {
      i = this.list.length;
      this.list.push(s);
      this.map.set(s, i);
    }
    return i;
  }
}

class TileAcc {
  strings = new Strings();
  buildings: VBuilding[] = [];
  roads: VRoad[] = [];
  areas: VArea[] = [];
  lines: VLine[] = [];
  points: VPoint[] = [];
  readonly rx: number;
  readonly rz: number;
  constructor(rx: number, rz: number) {
    this.rx = rx;
    this.rz = rz;
  }
  tile(): VectorTile {
    return {
      rx: this.rx, rz: this.rz, strings: this.strings.list,
      buildings: this.buildings, roads: this.roads, areas: this.areas, lines: this.lines, points: this.points,
    };
  }
}

const ROAD_KIND: Record<string, number> = {
  motorway: ROAD.MOTORWAY, trunk: ROAD.TRUNK, primary: ROAD.PRIMARY, secondary: ROAD.SECONDARY, tertiary: ROAD.TERTIARY,
  residential: ROAD.RESIDENTIAL, unclassified: ROAD.UNCLASSIFIED, living_street: ROAD.LIVING_STREET, service: ROAD.SERVICE,
  pedestrian: ROAD.PEDESTRIAN, footway: ROAD.FOOTWAY, path: ROAD.PATH, cycleway: ROAD.CYCLEWAY, steps: ROAD.STEPS, track: ROAD.TRACK,
};
/** Non-carriageway default widths in metres. */
const MINOR_WIDTH_M: Record<string, number> = { footway: 2, path: 2, cycleway: 2, steps: 2, pedestrian: 4, track: 3, service: 4.5 };
const UNPAVED = new Set(["unpaved", "ground", "dirt", "gravel", "fine_gravel", "compacted", "grass", "sand", "earth", "mud"]);
const ROOF_SHAPE: Record<string, number> = {
  flat: ROOF.FLAT, gabled: ROOF.GABLED, hipped: ROOF.HIPPED, "half-hipped": ROOF.HIPPED, pyramidal: ROOF.PYRAMIDAL,
  dome: ROOF.DOME, onion: ROOF.ONION, skillion: ROOF.SKILLION,
};
const SHOP_AMENITY = new Set(["cafe", "restaurant", "pharmacy", "bank", "fast_food", "bar", "pub", "post_office", "clinic", "dentist"]);

const flat = (pts: readonly Cm[], ox: number, oz: number): Int32Array => {
  const a = new Int32Array(pts.length * 2);
  for (let i = 0; i < pts.length; i++) {
    a[i * 2] = pts[i]![0] - ox;
    a[i * 2 + 1] = pts[i]![1] - oz;
  }
  return a;
};

/** Road width in cm from tags (see task: width tag, lanes, class defaults). */
export function roadWidthCm(t: Tags, hw: string): number {
  const w = parseNum(t.width);
  if (w !== null && w <= 60) return Math.round(w * 100);
  const minor = MINOR_WIDTH_M[hw];
  if (minor !== undefined) return Math.round(minor * 100);
  const lanes = parseNum(t.lanes);
  if (lanes !== null) return Math.round(Math.max(Math.round(lanes) * 3.25, 5.5) * 100);
  return Math.round(2 * HW[hw]! * 100);
}

/** Angle of a direction as 0..254 (256ths of a turn; 255 is NO_DIR and is folded onto 0). */
function dirOf(dx: number, dz: number): number {
  const turns = Math.atan2(dz, dx) / (2 * Math.PI);
  const q = Math.round((turns - Math.floor(turns)) * 256) % 256;
  return q === NO_DIR ? 0 : q;
}

export function buildVectorTiles(input: VectorInput): { tiles: Map<number, VectorTile>; stats: VectorStats } {
  const { regionsX, regionsZ } = input;
  const accs = new Map<number, TileAcc>();
  const stats: VectorStats = { buildings: 0, roads: 0, areas: 0, areaCopies: 0, lines: 0, points: 0 };
  const acc = (rx: number, rz: number): TileAcc | null => {
    if (rx < 0 || rz < 0 || rx >= regionsX || rz >= regionsZ) return null;
    const k = rz * 65536 + rx;
    let a = accs.get(k);
    if (!a) accs.set(k, (a = new TileAcc(rx, rz)));
    return a;
  };
  const owner = (x: number, z: number): TileAcc | null => acc(Math.floor(x / REGION_CM), Math.floor(z / REGION_CM));
  const byId = <T extends { id: number }>(l: readonly T[]): T[] => l.map((v, i) => [v, i] as const).sort((a, b) => a[0].id - b[0].id || a[1] - b[1]).map((e) => e[0]);

  // ---- buildings
  for (const a of byId(input.areas)) {
    const t = a.tags;
    if (!has(t.building)) continue;
    const r0pts = a.rings[0]!;
    if (r0pts.length === 0) continue;
    let bx = 0, bz = 0;
    for (const p of r0pts) { bx += p[0]; bz += p[1]; }
    bx /= r0pts.length;
    bz /= r0pts.length;
    const ring0 = ringCm(r0pts);
    if (ring0.length < 3) continue;
    const dist = Math.hypot(bx * VOXEL - input.centre[0], bz * VOXEL - input.centre[1]);
    let area2 = 0;
    for (let i = 0; i < r0pts.length; i++) {
      const p = r0pts[i]!, q = r0pts[(i + 1) % r0pts.length]!;
      area2 += p[0] * q[1] - q[0] * p[1];
    }
    const spec = buildingSpec(a.id, t, dist, (Math.abs(area2) / 2) * VOXEL * VOXEL);
    const [ax, az] = toCm([bx, bz]);
    const tile = owner(ax, az);
    if (!tile) continue;
    const ox = tile.rx * REGION_CM, oz = tile.rz * REGION_CM;
    const rings = [flat(ring0, ox, oz)];
    for (let i = 1; i < a.rings.length; i++) {
      const r = ringCm(a.rings[i]!);
      if (r.length >= 3) rings.push(flat(r, ox, oz));
    }
    const heightCm = Math.round(Math.min(spec.hm, 500) * 100);
    const minM = parseNum(t.min_height) ?? (parseNum(t["building:min_level"]) !== null ? parseNum(t["building:min_level"])! * 3 : 0);
    const levels = parseNum(t["building:levels"]);
    tile.buildings.push({
      id: a.id >>> 0,
      rings,
      heightCm,
      minHeightCm: Math.min(Math.round(minM * 100), heightCm),
      levels: levels === null ? 0 : Math.max(0, Math.min(255, Math.round(levels))),
      wall: spec.wall,
      roof: spec.roof,
      roofShape: ROOF_SHAPE[t["roof:shape"] ?? ""] ?? ROOF.FLAT,
      name: tile.strings.idx(t.name),
    });
    stats.buildings++;
  }

  // ---- roads (+ node directions for crossings/signals)
  const nodeDir = new Map<number, number>();
  const sortedLines = byId(input.lines);
  const recordDirs = (pass: 0 | 1): void => {
    for (const l of sortedLines) {
      const hw = l.tags.highway;
      if (!hw || HW[hw] === undefined || !l.nodeIds) continue;
      const vehicle = MINOR_WIDTH_M[hw] === undefined || hw === "service";
      if ((pass === 0) !== vehicle) continue;
      const n = l.pts.length;
      for (let i = 0; i < n; i++) {
        const id = l.nodeIds[i]!;
        if (nodeDir.has(id)) continue;
        const a = l.pts[Math.max(0, i - 1)]!, b = l.pts[Math.min(n - 1, i + 1)]!;
        if (a[0] === b[0] && a[1] === b[1]) continue;
        nodeDir.set(id, dirOf(b[0] - a[0], b[1] - a[1]));
      }
    }
  };
  recordDirs(0);
  recordDirs(1);

  const addPieces = (pts: Cm[], emit: (tile: TileAcc, piece: Cm[], ox: number, oz: number) => void): void => {
    for (const piece of splitPolyline(pts)) {
      const [mx, mz] = midpoint(piece);
      const tile = owner(mx, mz);
      if (tile) emit(tile, piece, tile.rx * REGION_CM, tile.rz * REGION_CM);
    }
  };

  for (const l of sortedLines) {
    const t = l.tags;
    const hwRaw = t.highway;
    if (hwRaw && HW[hwRaw] !== undefined) {
      if (has(t.tunnel) || t.area === "yes") continue;
      const link = hwRaw.endsWith("_link");
      const hw = link ? hwRaw.slice(0, -5) : hwRaw;
      const kind = ROAD_KIND[hw];
      if (kind === undefined) continue;
      let pts = dedupe(l.pts.map(toCm));
      if (pts.length < 2) continue;
      let flags = 0;
      const ow = t.oneway;
      if (ow === "yes" || ow === "1" || ow === "true") flags |= ROAD_ONEWAY;
      else if (ow === "-1") {
        flags |= ROAD_ONEWAY;
        pts = pts.reverse();
      }
      if (has(t.bridge)) flags |= ROAD_BRIDGE;
      if (SIDEWALK_ROAD.has(hwRaw) && t.sidewalk !== "no" && t.sidewalk !== "none") flags |= ROAD_SIDEWALK;
      if (t.lit === "yes") flags |= ROAD_LIT;
      if (link) flags |= ROAD_LINK;
      if (t.surface !== undefined ? UNPAVED.has(t.surface) : hw === "track") flags |= ROAD_UNPAVED;
      const widthCm = roadWidthCm(t, hwRaw.endsWith("_link") ? hw : hwRaw);
      const lanesN = parseNum(t.lanes);
      const lanes = lanesN === null ? 0 : Math.max(0, Math.min(255, Math.round(lanesN)));
      const layerN = parseInt(t.layer ?? "", 10);
      const layer = Number.isFinite(layerN) ? Math.max(-128, Math.min(127, layerN)) : 0;
      addPieces(pts, (tile, piece, ox, oz) => {
        tile.roads.push({ pts: flat(piece, ox, oz), kind, flags, widthCm, lanes, layer, name: tile.strings.idx(t.name) });
        stats.roads++;
      });
    } else if (t.railway === "rail" || t.railway === "tram") {
      if (has(t.tunnel)) continue;
      const kind = t.railway === "rail" ? LINE.RAIL : LINE.TRAM;
      const pts = dedupe(l.pts.map(toCm));
      if (pts.length < 2) continue;
      addPieces(pts, (tile, piece, ox, oz) => {
        tile.lines.push({ pts: flat(piece, ox, oz), kind });
        stats.lines++;
      });
    }
  }

  // ---- barrier lines
  for (const l of byId(input.barriers)) {
    const t = l.tags;
    if (has(t.tunnel)) continue;
    const b = t.barrier;
    const kind = b === "fence" ? LINE.FENCE : b === "wall" || b === "retaining_wall" || b === "city_wall" ? LINE.WALL : b === "hedge" ? LINE.HEDGE : 0;
    if (!kind) continue;
    const pts = dedupe(l.pts.map(toCm));
    if (pts.length < 2) continue;
    addPieces(pts, (tile, piece, ox, oz) => {
      tile.lines.push({ pts: flat(piece, ox, oz), kind });
      stats.lines++;
    });
  }

  // ---- ground areas (duplicated + clipped per region)
  const ground: { mat: number; prio: number; a: VArea_; i: number }[] = [];
  input.areas.forEach((a, i) => {
    if (has(a.tags.building) || isWater(a.tags)) return;
    const g = groundClass(a.tags);
    if (g) ground.push({ ...g, a, i });
  });
  ground.sort((p, q) => p.prio - q.prio || p.i - q.i);
  for (const { mat, prio, a } of ground) {
    const rings = a.rings.map(ringCm).filter((r) => r.length >= 3);
    if (rings.length === 0 || a.rings[0] === undefined || ringCm(a.rings[0]).length < 3) continue;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const p of rings[0]!) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
    const rx0 = Math.max(0, Math.floor((x0 - AREA_MARGIN_CM) / REGION_CM)), rx1 = Math.min(regionsX - 1, Math.floor((x1 + AREA_MARGIN_CM) / REGION_CM));
    const rz0 = Math.max(0, Math.floor((z0 - AREA_MARGIN_CM) / REGION_CM)), rz1 = Math.min(regionsZ - 1, Math.floor((z1 + AREA_MARGIN_CM) / REGION_CM));
    stats.areas++;
    for (let rz = rz0; rz <= rz1; rz++) {
      for (let rx = rx0; rx <= rx1; rx++) {
        const ox = rx * REGION_CM, oz = rz * REGION_CM;
        const clipped: Int32Array[] = [];
        for (let ri = 0; ri < rings.length; ri++) {
          const c = dedupe(clipRing(rings[ri]!, ox - AREA_MARGIN_CM, oz - AREA_MARGIN_CM, ox + REGION_CM + AREA_MARGIN_CM, oz + REGION_CM + AREA_MARGIN_CM).map((p) => [Math.round(p[0]), Math.round(p[1])] as Cm));
          if (c.length > 1) {
            const f = c[0]!, l = c[c.length - 1]!;
            if (f[0] === l[0] && f[1] === l[1]) c.pop();
          }
          if (c.length < 3) {
            if (ri === 0) break; // outer ring gone: nothing of this area in this region
            continue;
          }
          clipped.push(flat(c, ox, oz));
        }
        if (clipped.length === 0) continue;
        acc(rx, rz)!.areas.push({ rings: clipped, mat, prio });
        stats.areaCopies++;
      }
    }
  }

  // ---- points
  for (const n of byId(input.taggedNodes)) {
    const t = n.tags;
    let kind = 0;
    let name = -1;
    let useDir = false;
    if (t.highway === "street_lamp") kind = POINT.STREET_LAMP;
    else if (t.highway === "crossing" || t.railway === "crossing" || t.footway === "crossing") { kind = POINT.CROSSING; useDir = true; }
    else if (t.highway === "traffic_signals") { kind = POINT.TRAFFIC_SIGNALS; useDir = true; }
    else if (t.highway === "bus_stop" || t.public_transport === "platform") kind = POINT.BUS_STOP;
    else if (t.entrance !== undefined && t.entrance !== "no") kind = POINT.ENTRANCE;
    else if (t.amenity === "bench") kind = POINT.BENCH;
    else if (t.amenity === "waste_basket") kind = POINT.WASTE_BASKET;
    else if (t.name && (t.shop !== undefined || (t.amenity !== undefined && SHOP_AMENITY.has(t.amenity)))) kind = POINT.SHOP;
    if (!kind) continue;
    const [x, z] = toCm([n.cx, n.cz]);
    const tile = owner(x, z);
    if (!tile) continue;
    if (kind === POINT.SHOP) name = tile.strings.idx(t.name);
    tile.points.push({ x: x - tile.rx * REGION_CM, z: z - tile.rz * REGION_CM, kind, dir: useDir ? (nodeDir.get(n.id) ?? NO_DIR) : NO_DIR, name });
    stats.points++;
  }

  const tiles = new Map<number, VectorTile>();
  for (const k of [...accs.keys()].sort((p, q) => p - q)) {
    const a = accs.get(k)!;
    if (a.buildings.length + a.roads.length + a.areas.length + a.lines.length + a.points.length > 0) tiles.set(k, a.tile());
  }
  return { tiles, stats };
}

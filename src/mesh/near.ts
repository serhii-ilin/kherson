/**
 * Near-LOD building detail: real window openings (reveals, recessed glass, sills and frames),
 * entrances with canopies, balcony stacks, and the cornice / plinth courses of historic buildings.
 *
 * Pure geometry. Everything is emitted into the shared `Builder` from `extrude.ts`; no renderer or
 * DOM is involved (Article 5.4). Window bays and rows use exactly the same world-space grid as
 * `facade.ts` (`u / bay`, `v / floorH`), so the mid → near swap does not make windows jump.
 */
import { MAT, materialColor } from '../world/materials.ts';
import { ROAD } from '../world/vector-format.ts';
import {
  addQuad, hash, isHistoric, outerEdge,
  PART_DOOR, PART_FRAME, PART_GLASS, PART_TRIM, PART_WALL,
  type Builder, type Edge, type ExtrudeBuilding, type Facade, type Pt, type RoofKind,
} from './extrude.ts';

/** A drivable road centreline in world metres (same frame as `ExtrudeBuilding.rings`). */
export interface NearRoad {
  pts: ReadonlyArray<readonly [number, number]>;
  kind: number;
}

export interface NearDetailInput {
  building: ExtrudeBuilding;
  rings: Pt[][];
  edges: Edge[];
  kind: RoofKind;
  y0: number;
  floorBase: number;
  eave: number;
  bodyH: number;
  top: number;
  facade: Facade;
  uShift: number;
  wallStyle: number;
  wallColor: [number, number, number];
  wallPbr: number;
  roofPbr: number;
  trimColor: [number, number, number];
  trimPbr: number;
  roads?: readonly NearRoad[];
}

type Colour = [number, number, number];

const GLASS: Colour = [0.16, 0.22, 0.28];
const SIGN: Colour = [0.18, 0.2, 0.22];
const EPS = 1e-4;

interface Frac { lo: number; hi: number; x0: number; x1: number }

type OpeningKind = 'window' | 'shop' | 'door' | 'stair';

interface Opening {
  d0: number;
  d1: number;
  v0: number;
  v1: number;
  u0: number;
  u1: number;
  row: number;
  bay: number;
  kind: OpeningKind;
  depth: number;
  arch: boolean;
  surround: boolean;
  frame: boolean;
  sill: boolean;
}

function scale(c: readonly [number, number, number], s: number): Colour {
  return [c[0] * s, c[1] * s, c[2] * s];
}

/** The shader's per-style window fractions (`facade.ts` FRAG_COLOR), including the shop override. */
function fractions(wall: number, shops: boolean, row: number): Frac {
  let lo = 0.28;
  let hi = 0.78;
  let x0 = 0.22;
  let x1 = 0.78;
  const historic = wall >= MAT.WALL_HISTORIC && wall <= MAT.WALL_HISTORIC_CREAM;
  const khrush = wall === MAT.WALL_KHRUSH;
  const panel = wall === MAT.WALL_PANEL;
  const stalin = wall === MAT.WALL_STALIN;
  const modern = wall === MAT.WALL_MODERN;
  if (historic || stalin) { lo = 0.18; hi = 0.84; x0 = 0.28; x1 = 0.72; }
  if (khrush) { lo = 0.32; hi = 0.72; x0 = 0.18; x1 = 0.82; }
  if (panel) { lo = 0.30; hi = 0.74; x0 = 0.16; x1 = 0.84; }
  if (shops && row === 0) { lo = 0.12; hi = 0.92; x0 = 0.08; x1 = 0.92; }
  if (modern) { x0 = 0.06; x1 = 0.94; lo = 0.22; hi = 0.78; }
  return { lo, hi, x0, x1 };
}

/** Frames: 70% white, 15% brown, 15% blue, hashed per bay and row (deterministic, Article 2.3). */
function frameColour(id: number, bay: number, row: number): Colour {
  const h = hash(id, Math.imul(bay, 131) + row * 17) % 100;
  if (h < 70) return [0.92, 0.92, 0.9];
  if (h < 85) return [0.36, 0.25, 0.17];
  return [0.30, 0.42, 0.55];
}

/** True for a windowless Soviet slab gable end: short outer edge on a building with a 30 m edge. */
export function isEndWall(outer: readonly Pt[], edges: readonly Edge[], wall: number, e: Edge): boolean {
  if (wall !== MAT.WALL_KHRUSH && wall !== MAT.WALL_PANEL) return false;
  let longest = 0;
  for (const x of edges) if (x.len > longest) longest = x.len;
  if (longest < 30) return false;
  if (!outerEdge(outer, e)) return false;
  return e.len <= 14.01;
}

function pointAt(e: Edge, d: number, y: number, off: number): [number, number, number] {
  const ux = (e.bx - e.ax) / (e.len || 1);
  const uz = (e.bz - e.az) / (e.len || 1);
  return [e.ax + ux * d + e.nx * off, y, e.az + uz * d + e.nz * off];
}

function unitXZ(e: Edge): [number, number] {
  return [(e.bx - e.ax) / (e.len || 1), (e.bz - e.az) / (e.len || 1)];
}

function segmentDistance(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz;
  let t = l2 > 1e-9 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

function drivable(kind: number): boolean {
  return kind >= ROAD.MOTORWAY && kind <= ROAD.SERVICE;
}

function roadDistance(e: Edge, roads: readonly NearRoad[] | undefined): number {
  if (roads === undefined) return Infinity;
  const mx = (e.ax + e.bx) / 2;
  const mz = (e.az + e.bz) / 2;
  let best = Infinity;
  for (const r of roads) {
    if (!drivable(r.kind) || r.pts.length < 2) continue;
    for (let i = 0; i + 1 < r.pts.length; i++) {
      const a = r.pts[i]!;
      const b = r.pts[i + 1]!;
      const d = segmentDistance(mx, mz, a[0], a[1], b[0], b[1]);
      if (d < best) best = d;
    }
  }
  return best;
}

function outerEdges(outer: readonly Pt[], edges: readonly Edge[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < edges.length; i++) if (outerEdge(outer, edges[i]!)) out.push(i);
  return out;
}

function longestEdge(edges: readonly Edge[], list: readonly number[]): number {
  let best = -1;
  let len = -1;
  for (const i of list) {
    const l = edges[i]!.len;
    if (l > len) { len = l; best = i; }
  }
  return best;
}

/** The long outer edge nearest a drivable road (≤ 40 m), else the longest outer edge. */
function entranceEdge(outer: readonly Pt[], edges: readonly Edge[], roads?: readonly NearRoad[]): number {
  const list = outerEdges(outer, edges);
  if (list.length === 0) return -1;
  const longest = longestEdge(edges, list);
  const maxLen = edges[longest]!.len;
  let best = -1;
  let bestD = Infinity;
  for (const i of list) {
    if (edges[i]!.len < maxLen - 0.01) continue;
    const d = roadDistance(edges[i]!, roads);
    if (d < bestD) { bestD = d; best = i; }
  }
  return bestD <= 40 ? best : longest;
}

/** The other long outer edge, opposite the entrances (for balcony stacks). */
function balconyEdge(outer: readonly Pt[], edges: readonly Edge[], entrance: number): number {
  const list = outerEdges(outer, edges);
  if (list.length === 0 || entrance < 0) return -1;
  const maxLen = Math.max(...list.map((i) => edges[i]!.len));
  const e0 = edges[entrance]!;
  const mx = (e0.ax + e0.bx) / 2;
  const mz = (e0.az + e0.bz) / 2;
  let best = -1;
  let bestD = -1;
  for (const i of list) {
    const e = edges[i]!;
    if (i === entrance || e.len < maxLen - 0.01) continue;
    const d = Math.hypot((e.ax + e.bx) / 2 - mx, (e.az + e.bz) / 2 - mz);
    if (d > bestD) { bestD = d; best = i; }
  }
  return best;
}

function bayRange(edgeLen: number, bay: number, uShift: number): [number, number] {
  return [Math.ceil((uShift + 0.3) / bay), Math.floor((uShift + edgeLen - 0.3) / bay) - 1];
}

function entranceBays(edgeLen: number, bay: number, uShift: number, khrush: boolean): number[] {
  const [k0, k1] = bayRange(edgeLen, bay, uShift);
  if (k1 < k0) return [];
  const bays: number[] = [];
  if (khrush) {
    for (let k = k0 + 1; k <= k1; k += 4) bays.push(k);
    if (bays.length === 0) bays.push(Math.floor((k0 + k1) / 2));
    return bays;
  }
  const sections = Math.max(1, Math.round(edgeLen / 15));
  const span = k1 - k0;
  for (let i = 0; i < sections; i++) {
    const k = k0 + Math.round(((i + 0.5) / sections) * span);
    if (!bays.includes(k)) bays.push(k);
  }
  return bays;
}

function balconyBays(edgeLen: number, bay: number, uShift: number): number[] {
  const [k0, k1] = bayRange(edgeLen, bay, uShift);
  const out: number[] = [];
  for (let k = k0; k <= k1; k += 2) out.push(k);
  return out;
}

function addBoxFaces(
  b: Builder,
  e: Edge,
  d0: number, d1: number,
  y0: number, y1: number,
  out0: number, out1: number,
  color: Colour, facade: readonly [number, number, number, number], style: number, pbr: number,
  faces: { front?: boolean; back?: boolean; top?: boolean; bottom?: boolean; ends?: boolean },
): void {
  const u0 = d0;
  const u1 = d1;
  const uvs = [[u0, y0], [u1, y0], [u1, y1], [u0, y1]] as const;
  const [tx, tz] = unitXZ(e);
  if (faces.front !== false) {
    addQuad(b, pointAt(e, d0, y0, out1), pointAt(e, d1, y0, out1), pointAt(e, d1, y1, out1), pointAt(e, d0, y1, out1),
      uvs, [e.nx, 0, e.nz], color, facade, style, pbr);
  }
  if (faces.back === true) {
    addQuad(b, pointAt(e, d0, y0, out0), pointAt(e, d1, y0, out0), pointAt(e, d1, y1, out0), pointAt(e, d0, y1, out0),
      uvs, [-e.nx, 0, -e.nz], color, facade, style, pbr);
  }
  if (faces.top === true) {
    addQuad(b, pointAt(e, d0, y1, out0), pointAt(e, d1, y1, out0), pointAt(e, d1, y1, out1), pointAt(e, d0, y1, out1),
      uvs, [0, 1, 0], color, facade, style, pbr);
  }
  if (faces.bottom === true) {
    addQuad(b, pointAt(e, d0, y0, out0), pointAt(e, d1, y0, out0), pointAt(e, d1, y0, out1), pointAt(e, d0, y0, out1),
      uvs, [0, -1, 0], color, facade, style, pbr);
  }
  if (faces.ends === true) {
    addQuad(b, pointAt(e, d0, y0, out0), pointAt(e, d0, y1, out0), pointAt(e, d0, y1, out1), pointAt(e, d0, y0, out1),
      uvs, [-tx, 0, -tz], color, facade, style, pbr);
    addQuad(b, pointAt(e, d1, y0, out0), pointAt(e, d1, y1, out0), pointAt(e, d1, y1, out1), pointAt(e, d1, y0, out1),
      uvs, [tx, 0, tz], color, facade, style, pbr);
  }
}

function wallQuad(
  b: Builder, e: Edge, uShift: number, floorBase: number, facade: Facade, faceBay: number,
  d0: number, d1: number, v0: number, v1: number,
  color: Colour, style: number, pbr: number,
): void {
  if (d1 - d0 < EPS || v1 - v0 < EPS) return;
  const f: [number, number, number, number] = [PART_WALL, facade.levels, facade.floorH, faceBay];
  const uvs = [
    [uShift + d0, v0], [uShift + d1, v0], [uShift + d1, v1], [uShift + d0, v1],
  ] as const;
  addQuad(
    b,
    pointAt(e, d0, floorBase + v0, 0), pointAt(e, d1, floorBase + v0, 0),
    pointAt(e, d1, floorBase + v1, 0), pointAt(e, d0, floorBase + v1, 0),
    uvs, [e.nx, 0, e.nz], color, f, style, pbr,
  );
}

/** Fill one floor band of a wall around its openings: strips below/above and piers between. */
function wallRow(
  b: Builder, e: Edge, uShift: number, floorBase: number, facade: Facade, faceBay: number,
  row: number, openings: readonly Opening[], color: Colour, style: number, pbr: number,
): void {
  const fh = facade.floorH;
  const vb = row * fh;
  const vt = (row + 1) * fh;
  if (openings.length === 0) {
    wallQuad(b, e, uShift, floorBase, facade, faceBay, 0, e.len, vb, vt, color, style, pbr);
    return;
  }
  const sorted = [...openings].sort((a, c) => a.d0 - c.d0 || a.d1 - c.d1);
  let minV = Infinity;
  let maxV = -Infinity;
  for (const o of sorted) {
    if (o.v0 < minV) minV = o.v0;
    if (o.v1 > maxV) maxV = o.v1;
  }
  if (minV > vb + EPS) wallQuad(b, e, uShift, floorBase, facade, faceBay, 0, e.len, vb, minV, color, style, pbr);
  if (maxV < vt - EPS) wallQuad(b, e, uShift, floorBase, facade, faceBay, 0, e.len, maxV, vt, color, style, pbr);
  let cursor = 0;
  for (const o of sorted) {
    if (o.d0 > cursor + EPS) wallQuad(b, e, uShift, floorBase, facade, faceBay, cursor, o.d0, minV, maxV, color, style, pbr);
    if (o.v0 > minV + EPS) wallQuad(b, e, uShift, floorBase, facade, faceBay, o.d0, o.d1, minV, o.v0, color, style, pbr);
    if (o.v1 < maxV - EPS) wallQuad(b, e, uShift, floorBase, facade, faceBay, o.d0, o.d1, o.v1, maxV, color, style, pbr);
    if (o.d1 > cursor) cursor = o.d1;
  }
  if (cursor < e.len - EPS) wallQuad(b, e, uShift, floorBase, facade, faceBay, cursor, e.len, minV, maxV, color, style, pbr);
}

function emitOpening(
  b: Builder, e: Edge, floorBase: number, facade: Facade, uShift: number, wallStyle: number,
  building: ExtrudeBuilding, o: Opening, wallColor: Colour, wallPbr: number,
  trimColor: Colour, trimPbr: number, faceBay: number,
): void {
  const fWall: [number, number, number, number] = [PART_WALL, facade.levels, facade.floorH, faceBay];
  const fTrim: [number, number, number, number] = [PART_TRIM, facade.levels, facade.floorH, 0];
  const fGlass: [number, number, number, number] = [PART_GLASS, facade.levels, facade.floorH, 0];
  const fFrame: [number, number, number, number] = [PART_FRAME, facade.levels, facade.floorH, 0];
  const fDoor: [number, number, number, number] = [PART_DOOR, facade.levels, facade.floorH, 0];
  const y0 = floorBase + o.v0;
  const y1 = floorBase + o.v1;
  const [tx, tz] = unitXZ(e);
  const d0 = o.d0;
  const d1 = o.d1;
  const depth = o.depth;
  const dark = scale(wallColor, 0.8);

  // Four reveal faces lining the opening, plus the glass (or door) at the back.
  addQuad(b, pointAt(e, d0, y0, 0), pointAt(e, d0, y1, 0), pointAt(e, d0, y1, -depth), pointAt(e, d0, y0, -depth),
    [[o.u0, o.v0], [o.u0, o.v1], [o.u0, o.v1], [o.u0, o.v0]], [tx, 0, tz], dark, fWall, wallStyle, wallPbr);
  addQuad(b, pointAt(e, d1, y0, 0), pointAt(e, d1, y1, 0), pointAt(e, d1, y1, -depth), pointAt(e, d1, y0, -depth),
    [[o.u1, o.v0], [o.u1, o.v1], [o.u1, o.v1], [o.u1, o.v0]], [-tx, 0, -tz], dark, fWall, wallStyle, wallPbr);
  addQuad(b, pointAt(e, d0, y1, 0), pointAt(e, d1, y1, 0), pointAt(e, d1, y1, -depth), pointAt(e, d0, y1, -depth),
    [[o.u0, o.v1], [o.u1, o.v1], [o.u1, o.v1], [o.u0, o.v1]], [0, -1, 0], dark, fWall, wallStyle, wallPbr);
  if (o.kind !== 'door') {
    addQuad(b, pointAt(e, d0, y0, 0), pointAt(e, d1, y0, 0), pointAt(e, d1, y0, -depth), pointAt(e, d0, y0, -depth),
      [[o.u0, o.v0], [o.u1, o.v0], [o.u1, o.v0], [o.u0, o.v0]], [0, 1, 0], dark, fWall, wallStyle, wallPbr);
  }

  const face = o.kind === 'door' ? fDoor : fGlass;
  const col = o.kind === 'door' ? materialColor(MAT.DOOR) : GLASS;
  addQuad(
    b,
    pointAt(e, d0, y0, -depth), pointAt(e, d1, y0, -depth),
    pointAt(e, d1, y1, -depth), pointAt(e, d0, y1, -depth),
    [[o.u0, o.v0], [o.u1, o.v0], [o.u1, o.v1], [o.u0, o.v1]],
    [e.nx, 0, e.nz], col, face, wallStyle, -1,
  );

  if (o.sill) {
    const out = 0.06;
    const thick = 0.05;
    const su = [[o.u0, o.v0], [o.u1, o.v0], [o.u1, o.v0], [o.u0, o.v0]] as const;
    addQuad(b, pointAt(e, d0, y0, 0), pointAt(e, d1, y0, 0), pointAt(e, d1, y0, out), pointAt(e, d0, y0, out),
      su, [0, 1, 0], trimColor, fTrim, wallStyle, trimPbr);
    addQuad(b, pointAt(e, d0, y0, out), pointAt(e, d1, y0, out), pointAt(e, d1, y0 - thick, out), pointAt(e, d0, y0 - thick, out),
      su, [e.nx, 0, e.nz], trimColor, fTrim, wallStyle, trimPbr);
  }

  if (o.frame) {
    const fc = frameColour(building.id, o.bay, o.row);
    const fd = -depth + 0.02;
    const hc = (o.v0 + o.v1) / 2;
    const dc = (d0 + d1) / 2;
    const bu = [[o.u0, hc], [o.u1, hc], [o.u1, hc], [o.u0, hc]] as const;
    addQuad(b, pointAt(e, d0, floorBase + hc + 0.025, fd), pointAt(e, d1, floorBase + hc + 0.025, fd),
      pointAt(e, d1, floorBase + hc - 0.025, fd), pointAt(e, d0, floorBase + hc - 0.025, fd),
      bu, [e.nx, 0, e.nz], fc, fFrame, wallStyle, -1);
    const vu = [[dc, o.v0], [dc, o.v1], [dc, o.v1], [dc, o.v0]] as const;
    addQuad(b, pointAt(e, dc - 0.025, y0, fd), pointAt(e, dc + 0.025, y0, fd),
      pointAt(e, dc + 0.025, y1, fd), pointAt(e, dc - 0.025, y1, fd),
      vu, [e.nx, 0, e.nz], fc, fFrame, wallStyle, -1);
  }

  if (o.surround) {
    const w = 0.12;
    const off = 0.006;
    const left = [[o.u0 - w, o.v0 - w], [o.u0, o.v0], [o.u0, o.v1], [o.u0 - w, o.v1 + w]] as const;
    const right = [[o.u1, o.v0 - w], [o.u1 + w, o.v0 - w], [o.u1 + w, o.v1 + w], [o.u1, o.v1]] as const;
    addQuad(b, pointAt(e, d0 - w, y0 - w, off), pointAt(e, d0, y0, off), pointAt(e, d0, y1, off), pointAt(e, d0 - w, y1 + w, off),
      left, [e.nx, 0, e.nz], trimColor, fTrim, wallStyle, trimPbr);
    addQuad(b, pointAt(e, d1, y0 - w, off), pointAt(e, d1 + w, y0 - w, off), pointAt(e, d1 + w, y1 + w, off), pointAt(e, d1, y1, off),
      right, [e.nx, 0, e.nz], trimColor, fTrim, wallStyle, trimPbr);
    addQuad(b, pointAt(e, d0, y0 - w, off), pointAt(e, d1, y0 - w, off), pointAt(e, d1, y0, off), pointAt(e, d0, y0, off),
      [[o.u0, o.v0 - w], [o.u1, o.v0 - w], [o.u1, o.v0], [o.u0, o.v0]], [e.nx, 0, e.nz], trimColor, fTrim, wallStyle, trimPbr);
    if (!o.arch) {
      addQuad(b, pointAt(e, d0, y1, off), pointAt(e, d1, y1, off), pointAt(e, d1, y1 + w, off), pointAt(e, d0, y1 + w, off),
        [[o.u0, o.v1], [o.u1, o.v1], [o.u1, o.v1 + w], [o.u0, o.v1 + w]], [e.nx, 0, e.nz], trimColor, fTrim, wallStyle, trimPbr);
    }
  }

  if (o.arch) {
    // A three-segment polygonal arch over the top quarter of the opening (part 4, front only).
    const h = 0.25 * (o.v1 - o.v0);
    const base = o.v1 - h;
    const w = (d1 - d0) / 3;
    const heights = [0, 0.8 * h, 0.8 * h, 0];
    const off = 0.008;
    for (let i = 0; i < 3; i++) {
      const xa = d0 + w * i;
      const xb = d0 + w * (i + 1);
      const yb = floorBase + base + heights[i]!;
      const yt = floorBase + o.v1;
      if (yt - yb < EPS) continue;
      addQuad(b, pointAt(e, xa, yb, off), pointAt(e, xb, yb, off), pointAt(e, xb, yt, off), pointAt(e, xa, yt, off),
        [[o.u0 + w * i, base], [o.u0 + w * (i + 1), base], [o.u0 + w * (i + 1), o.v1], [o.u0 + w * i, o.v1]],
        [e.nx, 0, e.nz], trimColor, fTrim, wallStyle, trimPbr);
    }
  }

  if (o.kind === 'shop') {
    const h = 0.3;
    const off = 0.01;
    const yb = floorBase + o.v1;
    addQuad(b, pointAt(e, d0, yb, off), pointAt(e, d1, yb, off), pointAt(e, d1, yb + h, off), pointAt(e, d0, yb + h, off),
      [[o.u0, o.v1], [o.u1, o.v1], [o.u1, o.v1 + h], [o.u0, o.v1 + h]],
      [e.nx, 0, e.nz], SIGN, fTrim, wallStyle, -1);
  }

  if (o.kind === 'door') {
    const h = 0.12;
    const depthC = 1.2;
    const half = Math.min(1.0, (e.len - 0.1) / 2);
    const cd = (d0 + d1) / 2;
    const ca = Math.max(0.05, cd - half);
    const cb = Math.min(e.len - 0.05, cd + half);
    const yTop = floorBase + 2.6;
    addBoxFaces(b, e, ca, cb, yTop - h, yTop, 0, depthC, trimColor, fTrim, wallStyle, trimPbr,
      { front: true, bottom: true, top: true, ends: true });
  }
}

function emitBalcony(
  b: Builder, e: Edge, uShift: number, floorBase: number, facade: Facade, building: ExtrudeBuilding,
  bayIndex: number, row: number, trimColor: Colour, trimPbr: number, wallStyle: number,
): void {
  const bay = facade.bay;
  const cd = bayIndex * bay + bay / 2 - uShift;
  const half = 0.4 * bay;
  const d0 = cd - half;
  const d1 = cd + half;
  if (d0 < 0.1 || d1 > e.len - 0.1) return;
  const yTop = floorBase + row * facade.floorH;
  const yBot = yTop - 0.15;
  const out = 1.0;
  const fTrim: [number, number, number, number] = [PART_TRIM, facade.levels, facade.floorH, 0];
  const fGlass: [number, number, number, number] = [PART_GLASS, facade.levels, facade.floorH, 0];
  const fFrame: [number, number, number, number] = [PART_FRAME, facade.levels, facade.floorH, 0];

  // Slab: 0.15 m thick, 1.0 m deep, 0.8 bay wide.
  addBoxFaces(b, e, d0, d1, yBot, yTop, 0, out, trimColor, fTrim, wallStyle, trimPbr,
    { front: true, bottom: true, top: true, ends: true });

  const h = hash(building.id, Math.imul(bayIndex, 131) + row * 17);
  const variant = h % 100;
  if (variant >= 90) return;
  const panelColour = scale(trimColor, 0.9 + ((h >>> 8) % 17) / 100);
  // Solid lower panel, 1.0 m high, with closed ends.
  addQuad(b, pointAt(e, d0, yTop, out), pointAt(e, d1, yTop, out), pointAt(e, d1, yTop + 1.0, out), pointAt(e, d0, yTop + 1.0, out),
    [[cd, row], [cd, row], [cd, row], [cd, row]], [e.nx, 0, e.nz], panelColour, fTrim, wallStyle, trimPbr);
  const [tx, tz] = unitXZ(e);
  addQuad(b, pointAt(e, d0, yTop, out), pointAt(e, d0, yTop + 1.0, out), pointAt(e, d0, yTop + 1.0, out - 0.08), pointAt(e, d0, yTop, out - 0.08),
    [[cd, row], [cd, row], [cd, row], [cd, row]], [-tx, 0, -tz], panelColour, fTrim, wallStyle, trimPbr);
  addQuad(b, pointAt(e, d1, yTop, out), pointAt(e, d1, yTop + 1.0, out), pointAt(e, d1, yTop + 1.0, out - 0.08), pointAt(e, d1, yTop, out - 0.08),
    [[cd, row], [cd, row], [cd, row], [cd, row]], [tx, 0, tz], panelColour, fTrim, wallStyle, trimPbr);

  const fc = frameColour(building.id, bayIndex, row);
  const cu = bayIndex * bay + bay / 2;
  const cv = row * facade.floorH + (0.5 * facade.floorH);
  const uv: [number, number] = [cu, cv];
  const uvs = [uv, uv, uv, uv] as const;
  if (variant < 45) {
    // Open: rail bar only.
    addQuad(b, pointAt(e, d0, yTop + 1.0, out), pointAt(e, d1, yTop + 1.0, out),
      pointAt(e, d1, yTop + 0.94, out), pointAt(e, d0, yTop + 0.94, out),
      uvs, [e.nx, 0, e.nz], fc, fFrame, wallStyle, -1);
  } else {
    // Glazed: glass above the panel, on the front and both sides, with a frame line.
    const gy0 = yTop + 1.0;
    const gy1 = yTop + 2.2;
    addQuad(b, pointAt(e, d0, gy0, out), pointAt(e, d1, gy0, out), pointAt(e, d1, gy1, out), pointAt(e, d0, gy1, out),
      uvs, [e.nx, 0, e.nz], GLASS, fGlass, wallStyle, -1);
    addQuad(b, pointAt(e, d0, gy0, 0), pointAt(e, d0, gy0, out), pointAt(e, d0, gy1, out), pointAt(e, d0, gy1, 0),
      uvs, [-tx, 0, -tz], GLASS, fGlass, wallStyle, -1);
    addQuad(b, pointAt(e, d1, gy0, 0), pointAt(e, d1, gy0, out), pointAt(e, d1, gy1, out), pointAt(e, d1, gy1, 0),
      uvs, [tx, 0, tz], GLASS, fGlass, wallStyle, -1);
    addQuad(b, pointAt(e, d0, gy1, out), pointAt(e, d1, gy1, out), pointAt(e, d1, gy1 - 0.06, out), pointAt(e, d0, gy1 - 0.06, out),
      uvs, [e.nx, 0, e.nz], fc, fFrame, wallStyle, -1);
    addQuad(b, pointAt(e, cd - 0.03, gy0, out), pointAt(e, cd + 0.03, gy0, out),
      pointAt(e, cd + 0.03, gy1, out), pointAt(e, cd - 0.03, gy1, out),
      uvs, [e.nx, 0, e.nz], fc, fFrame, wallStyle, -1);
  }
}

/** Parapet as a 0.25 m thick box on a flat roof (outer face, inner face, top), 0.45 m high. */
export function addNearParapet(
  b: Builder, edges: readonly Edge[], outer: readonly Pt[], eave: number, top: number, floorBase: number,
  wallColor: Colour, wallPbr: number, wall: number,
): void {
  const f: [number, number, number, number] = [2 /* PART_PARAPET */, 0, 0, 0];
  for (const e of edges) {
    if (!outerEdge(outer, e)) continue;
    const [tx, tz] = unitXZ(e);
    const off = 0.25;
    addQuad(b, pointAt(e, 0, eave, 0), pointAt(e, e.len, eave, 0), pointAt(e, e.len, top, 0), pointAt(e, 0, top, 0),
      [[0, eave - floorBase], [e.len, eave - floorBase], [e.len, top - floorBase], [0, top - floorBase]],
      [e.nx, 0, e.nz], wallColor, f, wall, wallPbr);
    addQuad(b, pointAt(e, 0, eave, -off), pointAt(e, e.len, eave, -off), pointAt(e, e.len, top, -off), pointAt(e, 0, top, -off),
      [[0, eave - floorBase], [e.len, eave - floorBase], [e.len, top - floorBase], [0, top - floorBase]],
      [-e.nx, 0, -e.nz], wallColor, f, wall, wallPbr);
    addQuad(b, pointAt(e, 0, top, 0), pointAt(e, e.len, top, 0), pointAt(e, e.len, top, -off), pointAt(e, 0, top, -off),
      [[0, 0], [e.len, 0], [e.len, off], [0, off]], [0, 1, 0], wallColor, f, wall, wallPbr);
    // Close the two box ends at the parapet corners.
    addQuad(b, pointAt(e, 0, eave, 0), pointAt(e, 0, top, 0), pointAt(e, 0, top, -off), pointAt(e, 0, eave, -off),
      [[0, 0], [0, 1], [off, 1], [off, 0]], [-tx, 0, -tz], wallColor, f, wall, wallPbr);
    addQuad(b, pointAt(e, e.len, eave, 0), pointAt(e, e.len, top, 0), pointAt(e, e.len, top, -off), pointAt(e, e.len, eave, -off),
      [[0, 0], [0, 1], [off, 1], [off, 0]], [tx, 0, tz], wallColor, f, wall, wallPbr);
  }
}

function addCourses(
  b: Builder, edges: readonly Edge[], outer: readonly Pt[], floorBase: number, eave: number,
  trimColor: Colour, trimPbr: number, wallStyle: number,
): void {
  const fTrim: [number, number, number, number] = [PART_TRIM, 0, 0, 0];
  for (const e of edges) {
    if (!outerEdge(outer, e)) continue;
    // Plinth: 0.6 m high, projecting 0.06 m.
    const py0 = floorBase;
    const py1 = floorBase + 0.6;
    addQuad(b, pointAt(e, 0, py0, 0.06), pointAt(e, e.len, py0, 0.06),
      pointAt(e, e.len, py1, 0.06), pointAt(e, 0, py1, 0.06),
      [[0, 0], [e.len, 0], [e.len, 0.6], [0, 0.6]], [e.nx, 0, e.nz], trimColor, fTrim, wallStyle, trimPbr);
    addQuad(b, pointAt(e, 0, py1, 0), pointAt(e, e.len, py1, 0),
      pointAt(e, e.len, py1, 0.06), pointAt(e, 0, py1, 0.06),
      [[0, 0], [e.len, 0], [e.len, 0.06], [0, 0.06]], [0, 1, 0], trimColor, fTrim, wallStyle, trimPbr);

    // Cornice: three stepped boxes at the eave (0.12 / 0.24 / 0.36 m, 0.15 m high each).
    for (let s = 0; s < 3; s++) {
      const off = 0.12 * (s + 1);
      const yb = eave - 0.15 * (3 - s);
      const yt = yb + 0.15;
      addQuad(b, pointAt(e, 0, yb, off), pointAt(e, e.len, yb, off),
        pointAt(e, e.len, yt, off), pointAt(e, 0, yt, off),
        [[0, yb - floorBase], [e.len, yb - floorBase], [e.len, yt - floorBase], [0, yt - floorBase]],
        [e.nx, 0, e.nz], trimColor, fTrim, wallStyle, trimPbr);
      addQuad(b, pointAt(e, 0, yt, off - 0.12), pointAt(e, e.len, yt, off - 0.12),
        pointAt(e, e.len, yt, off), pointAt(e, 0, yt, off),
        [[0, 0], [e.len, 0], [e.len, 0.12], [0, 0.12]], [0, 1, 0], trimColor, fTrim, wallStyle, trimPbr);
    }
  }
}

export function addNearDetail(b: Builder, input: NearDetailInput): void {
  const {
    building, rings, edges, y0, floorBase, eave, bodyH, facade, uShift,
    wallStyle, wallColor, wallPbr, trimColor, trimPbr, roads,
  } = input;
  const outer = rings[0]!;
  const wall = building.wall;
  const levels = facade.levels;
  const fh = facade.floorH;
  const bay = facade.bay;
  const shops = facade.shops;
  const historic = isHistoric(wall);
  const slabs = wall === MAT.WALL_KHRUSH || wall === MAT.WALL_PANEL;
  const entranceTypes = slabs || wall === MAT.WALL_APART || wall === MAT.WALL_STALIN || wall === MAT.WALL_BRICK;
  const canEnter = entranceTypes && levels >= 3 && bay > 0;
  const ent = canEnter ? entranceEdge(outer, edges, roads) : -1;
  const bal = slabs && ent >= 0 && levels > 1 ? balconyEdge(outer, edges, ent) : -1;

  for (let ei = 0; ei < edges.length; ei++) {
    const e = edges[ei]!;
    const blank = isEndWall(outer, edges, wall, e);
    const enabled = bay > 0 && !blank;
    const isEntrance = ei === ent;
    const isBalcony = ei === bal;
    const entBays = enabled && isEntrance ? new Set(entranceBays(e.len, bay, uShift, wall === MAT.WALL_KHRUSH)) : new Set<number>();
    const balBays = isBalcony ? balconyBays(e.len, bay, uShift) : [];

    const rows: Opening[][] = [];
    for (let r = 0; r < levels; r++) rows.push([]);
    if (enabled) {
      const frac = fractions(wall, shops, 0);
      const [k0, k1] = bayRange(e.len, bay, uShift);
      for (let row = 0; row < levels; row++) {
        const rowFrac = fractions(wall, shops, row);
        const rowY = row * fh;
        const shop = shops && row === 0;
        const v0 = rowY + (shop ? frac.lo : rowFrac.lo) * fh;
        const v1 = rowY + (shop ? frac.hi : rowFrac.hi) * fh;
        if (v1 > bodyH - 0.22) continue;
        if (!shop && v0 < 0.45) continue;
        for (let k = k0; k <= k1; k++) {
          const bayMid = k * bay + bay / 2;
          let u0 = k * bay + rowFrac.x0 * bay;
          let u1 = k * bay + rowFrac.x1 * bay;
          let kind: OpeningKind = shop ? 'shop' : 'window';
          let frame = !shop && !historic;
          let sill = !shop;
          let surround = !shop && historic;
          let arch = !shop && historic && row >= 1;
          if (isEntrance && entBays.has(k)) {
            if (row === 0) continue; // the door takes this bay
            u0 = bayMid - 0.45;
            u1 = bayMid + 0.45;
            kind = 'stair';
            frame = false;
            sill = false;
          } else if (isBalcony && row >= 1 && balBays.includes(k)) {
            continue; // the balcony front covers this window
          }
          const d0 = u0 - uShift;
          const d1 = u1 - uShift;
          if (d0 < 0.3 || d1 > e.len - 0.3 || d1 - d0 < 0.2) continue;
          rows[row]!.push({
            d0, d1, v0, v1, u0, u1, row, bay: k, kind,
            depth: shop ? 0.12 : 0.18, arch, surround, frame, sill,
          });
        }
      }
      // Doors, one per entrance section.
      for (const k of entBays) {
        const mid = k * bay + bay / 2 - uShift;
        const d0 = Math.max(0.3, mid - 0.7);
        const d1 = Math.min(e.len - 0.3, mid + 0.7);
        if (d1 - d0 < 1.0) continue;
        rows[0]!.push({
          d0, d1, v0: 0, v1: Math.min(2.3, fh - 0.05), u0: uShift + d0, u1: uShift + d1,
          row: 0, bay: k, kind: 'door', depth: 0.3, arch: false, surround: false, frame: false, sill: false,
        });
      }
    }

    // Walls: plinth/skirt below the floor line, then one band per storey.
    const faceBay = rows.some((r) => r.length > 0) ? -bay : (blank ? 0 : bay);
    if (floorBase - y0 > EPS) {
      wallQuad(b, e, uShift, floorBase, facade, blank ? 0 : faceBay, 0, e.len, y0 - floorBase, 0, wallColor, wallStyle, wallPbr);
    }
    for (let row = 0; row < levels; row++) {
      wallRow(b, e, uShift, floorBase, facade, blank ? 0 : faceBay, row, rows[row]!, wallColor, wallStyle, wallPbr);
    }

    for (const row of rows) {
      for (const o of row) {
        emitOpening(b, e, floorBase, facade, uShift, wallStyle, building, o, wallColor, wallPbr, trimColor, trimPbr, faceBay);
      }
    }

    if (isBalcony) {
      for (const k of balBays) {
        for (let row = 1; row < levels; row++) {
          emitBalcony(b, e, uShift, floorBase, facade, building, k, row, trimColor, trimPbr, wallStyle);
        }
      }
    }
  }

  if (historic) addCourses(b, edges, outer, floorBase, eave, trimColor, trimPbr, wallStyle);
}

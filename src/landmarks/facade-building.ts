/**
 * Tier-K building builder: a researched `FacadeProfile` plus the real OSM footprint becomes a kit-built mesh.
 *
 * The footprint and height come from the vector bake (`FacadeBuildingRow`); the facade comes from the descriptor.
 * Street edges get their researched bay pattern and openings; other outer edges get a regular window grid on the
 * same storeys. Flat roofs follow the footprint, pitched roofs the minimum-area rectangle around it.
 *
 * Pure and DOM-free (Constitution 5.4). Output is deterministic: every colour/geometry choice is a function of the
 * row and the bay/storey index, never of `Math.random`.
 */
import type { AtticKind, FacadeEdge, FacadeProfile } from '../mesh/facade-profile.ts';
import { PBR_LAYER } from '../world/pbr-layers.ts';
import { emitBox, frame, frameAt, KitBuilder, type Detail, type Frame } from './kit/builder.ts';
import { addOpening, doorway, openingRise, type OpeningShape } from './kit/openings.ts';
import { CORNICE_DENTIL, CORNICE_SIMPLE, PLINTH, STRING_COURSE, rustication, sweepProfile, type ProfilePoint } from './kit/mouldings.ts';
import { balustrade, pediment, pilaster } from './kit/orders.ts';
import { attic as atticStorey, flatRoofWithParapet, gableRoof, hipRoof, mansardRoof } from './kit/roofs.ts';
import { wallWithOpenings, type WallOpening } from './kit/walls.ts';
import { prismSurface } from './hero-physics.ts';
import type { LandmarkBuild, LandmarkMeshData } from './types.ts';

type Color = readonly [number, number, number];

/** One baked `public/world/facades.json` row: descriptor + real footprint/height from the vector tile. */
export interface FacadeBuildingRow {
  profile: FacadeProfile;
  /** Outer ring in world metres, open (no repeated first point). */
  ring: readonly [number, number][];
  heightM: number;
  minHeightM: number;
}

/** Per-edge opening counts, exposed for tests and the landmark report. */
export interface FacadeEdgeStats {
  edge: number;
  lengthM: number;
  photo: boolean;
  bays: number;
  /** Pattern actually used on each storey: ground pattern first, then the upper pattern. */
  patterns: string[];
  openings: number;
  windows: number;
  doors: number;
  shops: number;
  gates: number;
  blinds: number;
}

export interface FacadeBuildStats {
  storeys: number;
  edges: FacadeEdgeStats[];
}

export interface FacadeBuild extends LandmarkBuild {
  stats: FacadeBuildStats;
}

interface EdgeFrame {
  edge: number;
  frame: Frame;
  length: number;
  /** True when the local +x direction runs opposite to the OSM ring direction (used to mirror photo crops). */
  reversed: boolean;
}

interface Rect {
  cx: number;
  cz: number;
  yaw: number;
  w: number;
  d: number;
}

interface Layout {
  plinth: number;
  wallTop: number;
  heights: number[];
  bottoms: number[];
  atticH: number;
  atticKind: AtticKind;
  roofRise: number;
}

interface PlannedOpening {
  storey: number;
  code: string;
  kind: 'window' | 'door' | 'shop' | 'gate' | 'blind';
  x: number;
  y: number;
  w: number;
  h: number;
  shape: OpeningShape;
  frame: Color | null;
  sign: boolean;
  /** Non-street edges are plain walls: glass and reveals, no researched surround or glazing bars. */
  plain: boolean;
}

interface EdgeInfo {
  edge: number;
  frame: Frame;
  length: number;
  street: FacadeEdge | null;
  photo: boolean;
  bays: number;
  bayW: number;
  planned: PlannedOpening[];
}

const GLASS: Color = [0.16, 0.22, 0.28];
const GATE_DARK: Color = [0.06, 0.055, 0.05];
const SIGN_DARK: Color = [0.14, 0.12, 0.1];
const IRON: Color = [0.13, 0.13, 0.14];
const DOOR: Color = [0.3, 0.2, 0.14];
const FRAME_WHITE: Color = [0.95, 0.94, 0.9];
const FRAME_BROWN: Color = [0.42, 0.29, 0.18];
const WORLD_FRAME = frame(0, 0, 0, 0);

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function parseHex(hex: string): Color {
  const n = Number.parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function mulColor(colour: Color, factor: number): Color {
  return [clamp(colour[0] * factor, 0, 1), clamp(colour[1] * factor, 0, 1), clamp(colour[2] * factor, 0, 1)];
}

function pbrIndex(name: string | undefined): number {
  if (name === undefined) return -1;
  const value = (PBR_LAYER as unknown as Record<string, number>)[name];
  return value === undefined ? -1 : value;
}

function hashText(text: string): number {
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

function frameColour(profile: FacadeProfile, bay: number, storey: number): Color {
  const base = parseHex(profile.windows.frame);
  if (profile.windows.mixedFrames !== true) return base;
  const pick = hashText(`${profile.key}:${bay}:${storey}`) % 3;
  return pick === 0 ? FRAME_WHITE : pick === 1 ? FRAME_BROWN : base;
}

function signedArea(ring: readonly [number, number][]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    sum += a[0] * b[1] - b[0] * a[1];
  }
  return sum / 2;
}

/** Frames whose local +x runs left-to-right when seen from outside and local +z points out of the wall. */
function edgeFrames(ring: readonly [number, number][], groundY: number): EdgeFrame[] {
  const ccw = signedArea(ring) >= 0;
  const frames: EdgeFrame[] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const length = Math.hypot(dx, dz);
    if (length < 1e-6) {
      frames.push({ edge: i, frame: frame(a[0], groundY, a[1], 0), length: 0, reversed: false });
      continue;
    }
    const nx = ccw ? dz / length : -dz / length;
    const nz = ccw ? -dx / length : dx / length;
    const localXx = nz, localXz = -nx;
    const forward = localXx * dx + localXz * dz;
    const origin = forward >= 0 ? a : b;
    const yaw = Math.atan2(nx, nz);
    frames.push({ edge: i, frame: frame(origin[0], groundY, origin[1], yaw), length, reversed: forward < 0 });
  }
  return frames;
}

function hull(points: readonly [number, number][]): [number, number][] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: [number, number], a: [number, number], b: [number, number]): number =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, point) <= 1e-9) lower.pop();
    lower.push(point);
  }
  const upper: [number, number][] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const point = sorted[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, point) <= 1e-9) upper.pop();
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/** Minimum-area rectangle around the footprint (rotating calipers over the convex hull). */
function minAreaRect(ring: readonly [number, number][]): Rect {
  const points = hull(ring);
  if (points.length < 3) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of ring) {
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
    }
    return { cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, yaw: 0, w: Math.max(0.01, x1 - x0), d: Math.max(0.01, z1 - z0) };
  }
  let best: Rect | null = null;
  let bestArea = Infinity;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const length = Math.hypot(dx, dz);
    if (length < 1e-9) continue;
    const ux = dx / length, uz = dz / length;
    const vx = -uz, vz = ux;
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const point of points) {
      const u = point[0] * ux + point[1] * uz;
      const v = point[0] * vx + point[1] * vz;
      minU = Math.min(minU, u); maxU = Math.max(maxU, u);
      minV = Math.min(minV, v); maxV = Math.max(maxV, v);
    }
    const area = (maxU - minU) * (maxV - minV);
    if (area < bestArea) {
      bestArea = area;
      const cu = (minU + maxU) / 2, cv = (minV + maxV) / 2;
      best = {
        cx: cu * ux + cv * vx,
        cz: cu * uz + cv * vz,
        // local +x = (cos yaw, -sin yaw) = u, local +z = (sin yaw, cos yaw) = v.
        yaw: Math.atan2(-uz, ux),
        w: Math.max(0.01, maxU - minU),
        d: Math.max(0.01, maxV - minV),
      };
    }
  }
  return best ?? { cx: 0, cz: 0, yaw: 0, w: 1, d: 1 };
}

function baseHeights(profile: FacadeProfile): number[] {
  const source = profile.floorHeights && profile.floorHeights.length > 0 ? profile.floorHeights : [4, 3.6];
  const out: number[] = [];
  for (let i = 0; i < profile.storeys; i++) {
    const value = i < source.length ? source[i]! : source[source.length - 1]!;
    out.push(value);
  }
  return out;
}

function layoutFor(profile: FacadeProfile, heightM: number, rect: Rect): Layout {
  const atticKind = profile.attic?.kind ?? 'none';
  const atticH = atticKind === 'none' ? 0 : Math.max(0, profile.attic?.heightM ?? 0);
  const flat = profile.roof.kind === 'flat';
  const roofRise = flat ? 0 : clamp(Math.min(rect.w, rect.d) * 0.22, 1.0, 2.6);
  const flatReserve = atticKind === 'parapet' || atticKind === 'balustrade' ? 0 : 0.55;
  const reserve = flat ? flatReserve : roofRise;
  const wallTop = Math.max(0.8, heightM - atticH - reserve);
  const base = baseHeights(profile);
  const sum = base.reduce((total, value) => total + value, 0);
  const scale = sum > 0 ? wallTop / sum : 1;
  const heights = base.map((value) => value * scale);
  const bottoms: number[] = [];
  let y = 0;
  for (const value of heights) {
    bottoms.push(y);
    y += value;
  }
  return { plinth: clamp(profile.plinthM ?? 0.6, 0, wallTop * 0.4), wallTop, heights, bottoms, atticH, atticKind, roofRise };
}

function bayCount(edge: FacadeEdge, length: number): number {
  if (edge.bayM !== undefined && edge.bayM > 0) return clamp(Math.round(length / edge.bayM), 1, 64);
  return clamp(edge.pattern.length, 1, 64);
}

function complement(length: number, gaps: readonly [number, number][]): [number, number][] {
  if (gaps.length === 0) return [[0, length]];
  const sorted = [...gaps].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: [number, number][] = [];
  for (const gap of sorted) {
    const last = merged[merged.length - 1];
    if (last && gap[0] <= last[1] + 1e-9) last[1] = Math.max(last[1], gap[1]);
    else merged.push([gap[0], gap[1]]);
  }
  const out: [number, number][] = [];
  let cursor = 0;
  for (const [a, b] of merged) {
    if (a > cursor + 1e-9) out.push([cursor, Math.min(length, a)]);
    cursor = Math.max(cursor, b);
  }
  if (cursor < length - 1e-9) out.push([cursor, length]);
  return out.filter(([a, b]) => b - a > 0.05);
}

function planOpening(
  code: string, bay: number, storey: number, bayW: number, profile: FacadeProfile, layout: Layout,
): PlannedOpening | null {
  const bottom = layout.bottoms[storey]!;
  const storeyH = layout.heights[storey]!;
  const x = bay * bayW;
  const win = profile.windows;
  const winShape = storey === 0 && win.ground ? win.ground.shape : win.shape;
  const winW = storey === 0 && win.ground ? win.ground.widthM : win.widthM;
  const winH = storey === 0 && win.ground ? win.ground.heightM : win.heightM;
  const shape: OpeningShape = winShape === 'paired' ? 'rect' : winShape;

  if (code === 'd' && storey === 0) {
    const w = Math.min(bayW * 0.55, 1.5);
    const h = Math.min(Math.max(1.8, storeyH - 0.6), 2.9);
    return { storey, code, kind: 'door', x: x + (bayW - w) / 2, y: 0, w, h, shape: 'rect', frame: null, sign: false, plain: false };
  }
  if (code === 's' && storey === 0) {
    const w = Math.min(bayW * 0.85, 3.2);
    const h = Math.min(storeyH - 0.5, 3);
    return { storey, code, kind: 'shop', x: x + (bayW - w) / 2, y: 0.1, w, h, shape: 'rect', frame: null, sign: true, plain: false };
  }
  if (code === 'g' && storey === 0) {
    const w = Math.min(bayW * 0.8, 3);
    const rise = w / 2;
    const h = Math.max(0.6, Math.min(storeyH - rise - 0.2, 4.3));
    if (h + rise > storeyH - 0.1) return null;
    return { storey, code, kind: 'gate', x: x + (bayW - w) / 2, y: 0, w, h, shape: 'arched', frame: null, sign: false, plain: false };
  }

  const w = Math.min(winW, bayW * 0.72);
  if (w < 0.2) return null;
  const rise = shape === 'arched' ? w / 2 : shape === 'segmental' ? w * 0.18 : 0;
  const sill = bottom + (storey === 0 ? Math.max(layout.plinth, 0.35) : 0.65);
  const maxTop = bottom + storeyH - 0.12;
  let rectH = Math.max(0.25, winH - rise);
  if (sill + rectH + rise > maxTop) rectH = Math.max(0.2, maxTop - sill - rise);
  if (sill + rectH + rise > maxTop + 1e-6) return null;
  const colour = frameColour(profile, bay, storey);
  const blind = code === 'x';
  return {
    storey, code, kind: blind ? 'blind' : 'window',
    x: x + (bayW - w) / 2, y: sill, w, h: rectH, shape,
    frame: blind ? null : colour, sign: false, plain: false,
  };
}

function addOpeningGeometry(
  main: KitBuilder, f: Frame, opened: PlannedOpening, profile: FacadeProfile,
  wall: Color, trim: Color, wallPbr: number, trimPbr: number, detail: Detail,
): void {
  if (detail === 'far') {
    const top = opened.y + opened.h + openingRise(opened);
    main.quad(
      f.toWorld(opened.x, opened.y, -0.06), f.toWorld(opened.x + opened.w, opened.y, -0.06),
      f.toWorld(opened.x + opened.w, top, -0.06), f.toWorld(opened.x, top, -0.06),
      undefined, undefined, GATE_DARK, -1,
    );
    return;
  }
  const win = profile.windows;
  if (opened.kind === 'door') {
    doorway(main, f, {
      x: opened.x, y0: opened.y, w: opened.w, h: opened.h, depth: 0.25, steps: 2,
      colour: DOOR, frame: trim, pbr: wallPbr, trimPbr, detail,
    });
    return;
  }
  if (opened.kind === 'shop') {
    addOpening(main, f, {
      x: opened.x, y: opened.y, w: opened.w, h: opened.h, shape: 'rect', depth: 0.12,
      sill: false, surround: 'none', frame: { colour: opened.frame ?? trim, bars: 'none' },
    }, { reveal: mulColor(wall, 0.72), surround: trim, sill: trim, glass: [0.1, 0.14, 0.17], pbr: wallPbr, trimPbr }, detail);
    if (opened.sign) {
      const signH = 0.32;
      const y = opened.y + opened.h + 0.05;
      main.quad(
        f.toWorld(opened.x - 0.1, y, 0), f.toWorld(opened.x + opened.w + 0.1, y, 0),
        f.toWorld(opened.x + opened.w + 0.1, y + signH, 0), f.toWorld(opened.x - 0.1, y + signH, 0),
        undefined, undefined, SIGN_DARK, trimPbr,
      );
    }
    return;
  }
  if (opened.kind === 'gate') {
    addOpening(main, f, {
      x: opened.x, y: opened.y, w: opened.w, h: opened.h, shape: 'arched', depth: 0.55,
      sill: false, surround: 'arch_moulding',
    }, { reveal: mulColor(wall, 0.65), surround: trim, sill: trim, glass: GATE_DARK, pbr: wallPbr, trimPbr }, detail);
    return;
  }
  const blind = opened.kind === 'blind';
  const plain = opened.plain;
  addOpening(main, f, {
    x: opened.x, y: opened.y, w: opened.w, h: opened.h, shape: opened.shape,
    depth: blind ? 0.06 : 0.18, sill: true,
    surround: blind || plain ? 'none' : win.surround,
    ...(blind ? {} : { frame: { colour: opened.frame ?? trim, bars: plain ? 'none' as const : 'cross' as const } }),
  }, {
    reveal: mulColor(wall, 0.72), surround: trim, sill: trim,
    glass: blind ? mulColor(wall, 0.92) : GLASS, pbr: wallPbr, trimPbr,
  }, detail);
}

function prepareEdge(
  main: KitBuilder, photoBuilders: Map<string, KitBuilder>, edgeFrame: EdgeFrame, street: FacadeEdge | null,
  profile: FacadeProfile, layout: Layout, wall: Color, trim: Color, wallPbr: number, trimPbr: number, detail: Detail,
): EdgeInfo {
  const f = edgeFrame.frame;
  const length = edgeFrame.length;
  const photo = street?.photo;
  if (photo) {
    let builder = photoBuilders.get(photo.id);
    if (!builder) {
      builder = new KitBuilder();
      photoBuilders.set(photo.id, builder);
    }
    const u0 = edgeFrame.reversed ? photo.u1 : photo.u0;
    const u1 = edgeFrame.reversed ? photo.u0 : photo.u1;
    wallWithOpenings(builder, f, {
      x0: 0, x1: length, y0: 0, y1: layout.wallTop, colour: wall, pbr: -1,
      photo: { u0, u1, v0: photo.v0, v1: photo.v1 },
    });
    return { edge: edgeFrame.edge, frame: f, length, street, photo: true, bays: street?.pattern.length ?? 0, bayW: 0, planned: [] };
  }

  const bays = street ? bayCount(street, length) : (length >= 4 ? Math.max(1, Math.floor(length / 3.2)) : 0);
  const bayW = bays > 0 ? length / bays : length;
  const planned: PlannedOpening[] = [];
  const holes: WallOpening[] = [];
  for (let storey = 0; storey < profile.storeys; storey++) {
    const source = street
      ? (storey === 0 ? (street.groundPattern ?? street.pattern) : street.pattern)
      : 'w';
    for (let bay = 0; bay < bays; bay++) {
      let code = source[bay % source.length] ?? 'b';
      if (!street) code = 'w';
      else if (storey > 0 && (code === 'd' || code === 's' || code === 'g')) code = 'w';
      if (code === 'b') continue;
      const opened = planOpening(code, bay, storey, bayW, profile, layout);
      if (!opened) continue;
      if (!street) opened.plain = true;
      planned.push(opened);
      holes.push({ x: opened.x, y: opened.y, w: opened.w, h: opened.h, shape: opened.shape, detail });
    }
  }

  wallWithOpenings(main, f, {
    x0: 0, x1: length, y0: 0, y1: layout.wallTop,
    openings: holes, colour: wall, pbr: wallPbr, detail,
  });
  for (const opened of planned) {
    addOpeningGeometry(main, f, opened, profile, wall, trim, wallPbr, trimPbr, detail);
  }

  // Plinth: interrupted by doors, shops and gates, so the ground floor reads as openings through the base.
  const groundGaps: [number, number][] = planned
    .filter((opened) => opened.storey === 0 && (opened.kind === 'door' || opened.kind === 'shop' || opened.kind === 'gate'))
    .map((opened) => [opened.x, opened.x + opened.w]);
  for (const [a, b] of complement(length, groundGaps)) {
    if (detail === 'far') {
      emitBox(main, frameAt(f, a, 0, 0), 0, b - a, 0, layout.plinth, 0, 0.14, trim, trimPbr, { back: false });
    } else {
      sweepProfile(main, f, PLINTH, [[a, 0], [b, 0]], false, trim, trimPbr);
    }
  }

  // Banded rustication on the ground floor, only across the piers between openings.
  if (detail === 'near' && profile.rusticated && layout.heights[0]! > layout.plinth + 0.2) {
    const allGroundGaps: [number, number][] = planned
      .filter((opened) => opened.storey === 0)
      .map((opened) => [opened.x, opened.x + opened.w]);
    const rusticated = frameAt(f, 0, 0, 0.02);
    for (const [a, b] of complement(length, allGroundGaps)) {
      rustication(main, rusticated, {
        x0: a, x1: b, y0: layout.plinth, y1: layout.heights[0]!,
        courseH: 0.45, jointDepth: 0.03, colour: wall, pbr: wallPbr,
      });
    }
  }

  // String courses between storeys (a roof band is the cornice's job).
  if (profile.stringCourses) {
    for (let storey = 1; storey < profile.storeys; storey++) {
      const y = layout.bottoms[storey]!;
      if (detail === 'far') {
        emitEdgeBox(main, f, length, y, y + 0.1, 0, 0.1, trim, trimPbr);
      } else {
        sweepProfile(main, frameAt(f, 0, y, 0), STRING_COURSE, [[0, 0], [length, 0]], false, trim, trimPbr);
      }
    }
  }

  // Pilasters on the street edges every N bays.
  if (detail === 'near' && street && profile.pilasters) {
    const every = Math.max(1, Math.floor(profile.pilasters.everyBays));
    const y0 = layout.plinth;
    const y1 = Math.max(y0 + 0.2, layout.wallTop - profile.cornice.heightM);
    const wPil = clamp(bayW * 0.18, 0.25, 0.6);
    for (let bay = every; bay < bays; bay += every) {
      pilaster(main, f, {
        x: bay * bayW, y0, y1, w: wPil, depth: 0.12,
        capital: profile.pilasters.capital, colour: trim, pbr: trimPbr, detail,
      });
    }
  }

  return { edge: edgeFrame.edge, frame: f, length, street, photo: false, bays, bayW, planned };
}

function emitEdgeBox(
  main: KitBuilder, f: Frame, length: number, y0: number, y1: number, z0: number, z1: number,
  colour: Color, pbr: number,
): void {
  // A single box per wall edge: the far-LOD substitute for a swept moulding.
  main.quad(f.toWorld(0, y0, z1), f.toWorld(length, y0, z1), f.toWorld(length, y1, z1), f.toWorld(0, y1, z1), undefined, undefined, colour, pbr);
  main.quad(f.toWorld(length, y0, z0), f.toWorld(0, y0, z0), f.toWorld(0, y1, z0), f.toWorld(length, y1, z0), undefined, undefined, colour, pbr);
  main.quad(f.toWorld(length, y0, z1), f.toWorld(length, y0, z0), f.toWorld(length, y1, z0), f.toWorld(length, y1, z1), undefined, undefined, colour, pbr);
  main.quad(f.toWorld(0, y0, z0), f.toWorld(0, y0, z1), f.toWorld(0, y1, z1), f.toWorld(0, y1, z0), undefined, undefined, colour, pbr);
  main.quad(f.toWorld(0, y1, z1), f.toWorld(length, y1, z1), f.toWorld(length, y1, z0), f.toWorld(0, y1, z0), undefined, undefined, colour, pbr);
}

function corniceProfile(kind: FacadeProfile['cornice']['profile']): readonly ProfilePoint[] | null {
  if (kind === 'none') return null;
  return kind === 'simple' ? CORNICE_SIMPLE : CORNICE_DENTIL;
}

function scaleProfile(profile: readonly ProfilePoint[], height: number, projection: number): ProfilePoint[] {
  const maxY = Math.max(...profile.map((point) => point[1])) || 1;
  const maxZ = Math.max(...profile.map((point) => point[0])) || 1;
  return profile.map(([z, y]) => [projection * (z / maxZ), height * (y / maxY)] as const);
}

function addBalcony(
  main: KitBuilder, info: EdgeInfo, storey: number, bay: number, kind: 'iron' | 'stone' | 'glazed',
  layout: Layout, trim: Color, trimPbr: number, detail: Detail,
): void {
  const f = info.frame;
  const bayW = info.bayW;
  if (bayW <= 0) return;
  const width = clamp(bayW * 0.7, 0.8, 2.8);
  const x = bay * bayW + (bayW - width) / 2;
  const y = layout.bottoms[storey]!;
  const depth = 1.0;
  emitBox(main, f, x, x + width, y - 0.15, y, 0, depth, trim, trimPbr, { bottom: false, back: false });
  if (detail === 'far') return;
  if (kind === 'stone') {
    for (const bx of [x + 0.12, x + width - 0.12]) {
      emitBox(main, f, bx - 0.08, bx + 0.08, y - 0.5, y - 0.15, 0, 0.6, trim, trimPbr, { back: false });
    }
  }
  if (kind === 'glazed') {
    const glass: Color = [0.2, 0.3, 0.36];
    emitBox(main, f, x + 0.06, x + width - 0.06, y + 0.05, y + 0.95, depth - 0.06, depth - 0.02, glass, -1);
    for (const px of [x + 0.03, x + width - 0.03]) {
      emitBox(main, f, px - 0.03, px + 0.03, y, y + 0.95, depth - 0.08, depth, trim, trimPbr);
    }
    return;
  }
  balustrade(main, frameAt(f, 0, y, 0), {
    x0: x, x1: x + width, y: 0, h: 0.95,
    balusterSpacing: 0.32, colour: kind === 'iron' ? IRON : trim, pbr: kind === 'iron' ? -1 : trimPbr, detail,
  });
}

function addCornice(
  main: KitBuilder, infos: readonly EdgeInfo[], profile: FacadeProfile, layout: Layout,
  trim: Color, trimPbr: number, detail: Detail,
): void {
  const source = corniceProfile(profile.cornice.profile);
  if (!source) return;
  const points = scaleProfile(source, profile.cornice.heightM, profile.cornice.projectionM);
  const baseY = Math.max(0, layout.wallTop - profile.cornice.heightM);
  for (const info of infos) {
    if (detail === 'far') {
      emitEdgeBox(main, frameAt(info.frame, 0, baseY, 0), info.length, 0, profile.cornice.heightM, 0, profile.cornice.projectionM, trim, trimPbr);
    } else {
      const options = profile.cornice.profile === 'dentil' || profile.cornice.profile === 'bracketed'
        ? { dentils: { spacing: profile.cornice.profile === 'bracketed' ? 0.9 : 0.42, depth: 0.05, height: 0.08 } }
        : {};
      sweepProfile(main, frameAt(info.frame, 0, baseY, 0), points, [[0, 0], [info.length, 0]], false, trim, trimPbr, options);
    }
  }
}

function addAttic(
  main: KitBuilder, infos: readonly EdgeInfo[], rect: Rect, ring: readonly [number, number][],
  profile: FacadeProfile, layout: Layout, groundY: number, wall: Color, trim: Color,
  wallPbr: number, trimPbr: number, roofPbr: number, roofColour: Color, detail: Detail,
): void {
  const roofFrame = frame(rect.cx, 0, rect.cz, rect.yaw);
  const atticKind = layout.atticKind;
  const atticH = layout.atticH;

  if (atticH > 0) {
    if (atticKind === 'parapet') {
      flatRoofWithParapet(main, WORLD_FRAME, {
        ring, y: groundY + layout.wallTop, parapetH: atticH, thickness: 0.3, colour: roofColour, pbr: roofPbr,
      });
    } else if (atticKind === 'pediment') {
      atticStorey(main, roofFrame, {
        x0: -rect.w / 2, x1: rect.w / 2, z0: -rect.d / 2, z1: rect.d / 2,
        y: groundY + layout.wallTop, h: atticH, colour: wall, pbr: wallPbr,
      });
    } else if (atticKind === 'balustrade') {
      for (const info of infos) {
        const f = frameAt(info.frame, 0, layout.wallTop, 0);
        if (detail === 'far') {
          emitEdgeBox(main, f, info.length, 0, atticH, -0.14, 0.14, trim, trimPbr);
        } else {
          balustrade(main, f, {
            x0: 0, x1: info.length, y: 0, h: atticH, balusterSpacing: 0.4, colour: trim, pbr: trimPbr, detail,
          });
        }
      }
    }
  }

  if (atticKind === 'pediment' && atticH > 0) {
    const street = infos.find((info) => info.street !== null) ?? infos[0];
    if (street) {
      pediment(main, frameAt(street.frame, 0, layout.wallTop, 0), {
        x0: 0, x1: street.length, y: 0, h: atticH, depth: 0.5,
        colour: trim, tympanumColour: wall, pbr: trimPbr,
      });
    }
  }

  if (profile.roof.kind === 'flat') {
    if (atticKind === 'parapet') return;
    const deckY = layout.wallTop + (atticKind === 'pediment' ? atticH : 0);
    flatRoofWithParapet(main, WORLD_FRAME, {
      ring, y: groundY + deckY, parapetH: atticKind === 'balustrade' ? 0 : 0.55,
      thickness: 0.3, colour: roofColour, pbr: roofPbr,
    });
    return;
  }

  const baseY = groundY + layout.wallTop + atticH;
  const spec = {
    x0: -rect.w / 2, x1: rect.w / 2, z0: -rect.d / 2, z1: rect.d / 2,
    y: baseY, rise: layout.roofRise, overhang: 0.35, colour: roofColour, pbr: roofPbr,
  };
  if (profile.roof.kind === 'hip') hipRoof(main, roofFrame, spec);
  else if (profile.roof.kind === 'gable') gableRoof(main, roofFrame, spec);
  else mansardRoof(main, roofFrame, spec);
}

function addBalconies(
  main: KitBuilder, infos: readonly EdgeInfo[], profile: FacadeProfile, layout: Layout,
  trim: Color, trimPbr: number, detail: Detail,
): void {
  for (const group of profile.balconies ?? []) {
    for (const storey of group.storeys) {
      if (storey < 0 || storey >= profile.storeys) continue;
      for (const bay of group.bays) {
        for (const info of infos) {
          if (!info.street || info.photo || bay >= info.bays) continue;
          addBalcony(main, info, storey, bay, group.kind, layout, trim, trimPbr, detail);
        }
      }
    }
  }
}

/** Builds one Tier-K building from a baked row. */
export function buildFacadeBuilding(row: FacadeBuildingRow, groundY: number, lod: 'near' | 'far' = 'near'): FacadeBuild {
  const { profile, ring } = row;
  const detail: Detail = lod;
  const wall = parseHex(profile.wall.colour);
  const trim = parseHex(profile.trim.colour);
  const roofColour = parseHex(profile.roof.colour);
  const wallPbr = pbrIndex(profile.wall.pbr);
  const trimPbr = pbrIndex(profile.trim.pbr);
  const roofPbr = pbrIndex(profile.roof.pbr);
  const rect = minAreaRect(ring);
  const layout = layoutFor(profile, row.heightM, rect);
  const main = new KitBuilder();
  const photoBuilders = new Map<string, KitBuilder>();
  const streets = new Map<number, FacadeEdge>();
  for (const edge of profile.edges) streets.set(edge.edge, edge);

  const infos: EdgeInfo[] = [];
  for (const edgeFrame of edgeFrames(ring, groundY)) {
    if (edgeFrame.length < 0.05) continue;
    infos.push(prepareEdge(
      main, photoBuilders, edgeFrame, streets.get(edgeFrame.edge) ?? null,
      profile, layout, wall, trim, wallPbr, trimPbr, detail,
    ));
  }

  addCornice(main, infos, profile, layout, trim, trimPbr, detail);
  addBalconies(main, infos, profile, layout, trim, trimPbr, detail);
  addAttic(main, infos, rect, ring, profile, layout, groundY, wall, trim, wallPbr, trimPbr, roofPbr, roofColour, detail);

  const statsEdges: FacadeEdgeStats[] = infos.map((info) => {
    const ba = info.planned;
    const counts = {
      windows: 0, doors: 0, shops: 0, gates: 0, blinds: 0,
    };
    for (const opened of ba) counts[opened.kind === 'window' ? 'windows' : opened.kind === 'door' ? 'doors'
      : opened.kind === 'shop' ? 'shops' : opened.kind === 'gate' ? 'gates' : 'blinds']++;
    return {
      edge: info.edge,
      lengthM: info.length,
      photo: info.photo,
      bays: info.bays,
      patterns: info.street
        ? Array.from({ length: profile.storeys }, (_, storey) => {
          const source = storey === 0 ? (info.street!.groundPattern ?? info.street!.pattern) : info.street!.pattern;
          let out = '';
          for (let bay = 0; bay < info.bays; bay++) {
            let code = source[bay % source.length] ?? 'b';
            if (storey > 0 && (code === 'd' || code === 's' || code === 'g')) code = 'w';
            out += code;
          }
          return out;
        })
        : Array.from({ length: profile.storeys }, () => {
          let out = '';
          for (let bay = 0; bay < info.bays; bay++) out += 'w';
          return out;
        }),
      openings: ba.length,
      ...counts,
    };
  });

  const meshes: LandmarkMeshData[] = [];
  for (const id of [...photoBuilders.keys()].sort()) meshes.push(photoBuilders.get(id)!.finish('textured', id));
  meshes.push(main.finish('textured'));

  let triangles = 0;
  for (const mesh of meshes) triangles += mesh.indices.length / 3;
  return {
    meshes,
    surfaces: [prismSurface(ring, groundY + row.minHeightM, groundY + row.heightM)],
    triangleCount: triangles,
    materialCount: meshes.length,
    stats: { storeys: profile.storeys, edges: statsEdges },
  };
}

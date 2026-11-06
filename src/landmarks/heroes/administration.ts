/**
 * Hero model of the Kherson Regional State Administration, Svobody Square 1 (built 1955) as it stood in
 * 2015–2021. It replaces OSM relation 2168547 (outer way 130741413, courtyard 161949999); the current `ruins`
 * tag is ignored because the documented pre-war restoration already reverts it.
 *
 * Dimensions are estimates from the 2019-08-03 front-on photo pass and the OSM footprint, marked here as
 * estimates: four storeys at 4.5 m (ground) + 3 × 4.0 m, a 1.6 m entablature, a 3.2 m attic on the central bay
 * and a 1.0 m parapet elsewhere (≈ 21.3 m at the front). The facade is limestone, the order and trim stucco.
 *
 * The main facade is derived, not hard-coded: the outer edges whose outward normal points at the former Lenin
 * plinth. The two short step edges split it into a recessed central bay and two wings.
 */
import { Earcut } from 'three/src/extras/Earcut.js';
import type { Bbox } from '../../world/manifest.ts';
import { PBR_LAYER } from '../../world/pbr-layers.ts';
import { OSM_LANDMARK_DATA } from '../data.ts';
import { fromLatLon, toLatLon } from '../geo.ts';
import { frame, KitBuilder, type Frame } from '../kit/builder.ts';
import { ARCHITRAVE, CORNICE_DENTIL, CORNICE_SIMPLE, sweepProfile } from '../kit/mouldings.ts';
import { addOpening, doorway } from '../kit/openings.ts';
import { pilaster } from '../kit/orders.ts';
import { attic } from '../kit/roofs.ts';
import { boxPrism, wallWithOpenings } from '../kit/walls.ts';
import {
  buildResult, pointInPolygon, rgb,
  type Landmark, type LandmarkBuildContext, type LandmarkMeshData, type LandmarkSurface,
} from '../types.ts';

type Point = [number, number];
type Colour = readonly [number, number, number];

const CLADDING = rgb(0xd9d2c0);
const TRIM = rgb(0xe2dccb);
const GRANITE_COLOUR = rgb(0x8f8b82);
const GLASS_DARK = rgb(0x1a2228);
const FRAME_WHITE = rgb(0xf4f1e8);
const DOOR_BROWN = rgb(0x4a2f20);
const DOOR_DARK = rgb(0x2c1b12);
const DARK_GREY = rgb(0x363a39);
const ROOF_COLOUR = rgb(0x4a4d49);
const FLAG_BLUE = rgb(0x1c6db2);
const FLAG_YELLOW = rgb(0xf0c72e);
const METAL = rgb(0x6d716d);
const AC_WHITE = rgb(0xe9e7df);

/** Storey and roof estimates; see the file header. */
const GROUND_STOREY = 4.5;
const UPPER_STOREY = 4.0;
const WALL_TOP = 16.5;
const ENTABLATURE_H = 1.6;
const ROOF_DECK = WALL_TOP + ENTABLATURE_H;
const ATTIC_H = 3.2;
const PARAPET_H = 1.0;
const FLAGPOLE_H = 8.0;
/** The plinth/memorial centre the main facade faces (former Lenin plinth, way 431154051). */
const PLINTH_LAT = 46.640292;
const PLINTH_LON = 32.614935;
/** A point further than any reasonable cosine threshold from the facade normal is "plain other facade". */
const FRONT_FACING_DOT = 0.65;

const WINDOW_W = 1.6;
const GROUND_WINDOW_Y = 1.15;
const GROUND_WINDOW_H = 2.2;
const UPPER_WINDOW_H = 2.4;
const DOOR_Y = 0.75;
const DOOR_H = 2.5;
const UPPER_ROWS = [1, 2, 3].map((row) => ({
  row,
  y: GROUND_STOREY + 0.85 + (row - 1) * UPPER_STOREY,
  h: UPPER_WINDOW_H,
}));

export interface AdministrationEdge {
  index: number;
  ax: number;
  az: number;
  bx: number;
  bz: number;
  len: number;
  /** Outward normal for an outer edge; towards the courtyard for an inner edge. */
  nx: number;
  nz: number;
}

export type FacadeKind = 'central' | 'wing' | 'step' | 'other' | 'courtyard';

export interface AdministrationFacadeRun {
  index: number;
  kind: FacadeKind;
  edges: readonly AdministrationEdge[];
  length: number;
  nx: number;
  nz: number;
  frame: Frame;
}

export interface AdministrationLayout {
  outer: readonly Point[];
  inner: readonly Point[];
  centroid: Point;
  plinth: Point;
  outerEdges: readonly AdministrationEdge[];
  innerEdges: readonly AdministrationEdge[];
  mainFacadeEdges: readonly AdministrationEdge[];
  centralRun: AdministrationFacadeRun;
  wingRuns: readonly AdministrationFacadeRun[];
  runs: readonly AdministrationFacadeRun[];
  pilasterCount: number;
}

interface OpeningSpec {
  x: number;
  y: number;
  w: number;
  h: number;
  row: number;
  bay: number;
  door: boolean;
}

interface CentralSpec {
  pilasters: readonly number[];
  openings: readonly OpeningSpec[];
  doors: readonly OpeningSpec[];
  stepX0: number;
  stepX1: number;
}

function project(bbox: Bbox, points: readonly (readonly [number, number])[]): Point[] {
  return points.map(([lat, lon]) => {
    const p = fromLatLon(bbox, lat, lon);
    return [p.x, p.z] as Point;
  });
}

function centroid(poly: readonly Point[]): Point {
  let x = 0, z = 0;
  for (const p of poly) { x += p[0]; z += p[1]; }
  return [x / Math.max(1, poly.length), z / Math.max(1, poly.length)];
}

function signedArea(poly: readonly Point[]): number {
  let area = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    area += poly[j]![0] * poly[i]![1] - poly[i]![0] * poly[j]![1];
  }
  return area / 2;
}

/** Edges with normals away from the ring interior; `invert` points them into the (courtyard) hole instead. */
function ringEdges(poly: readonly Point[], invert = false): AdministrationEdge[] {
  const out: AdministrationEdge[] = [];
  const winding = signedArea(poly) >= 0 ? 1 : -1;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!, b = poly[(i + 1) % poly.length]!;
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) continue;
    let nx = (dz / len) * winding, nz = (-dx / len) * winding;
    if (invert) { nx = -nx; nz = -nz; }
    out.push({ index: out.length, ax: a[0], az: a[1], bx: b[0], bz: b[1], len, nx, nz });
  }
  return out;
}

/** One straight facade plane, merging collinear contiguous OSM edges (the central bay is two edges). */
function makeRun(edges: readonly AdministrationEdge[], kind: FacadeKind, index: number): AdministrationFacadeRun {
  let total = 0, mx = 0, mz = 0, nx = 0, nz = 0;
  for (const e of edges) {
    total += e.len;
    mx += e.len * (e.ax + e.bx) * 0.5;
    mz += e.len * (e.az + e.bz) * 0.5;
    nx += e.len * e.nx;
    nz += e.len * e.nz;
  }
  mx /= total; mz /= total;
  const normalLength = Math.hypot(nx, nz) || 1;
  nx /= normalLength; nz /= normalLength;
  const yaw = Math.atan2(nx, nz);
  // Local +x is the facade tangent; shift the origin so the merged plane spans exactly ±length/2.
  const tx = Math.cos(yaw), tz = -Math.sin(yaw);
  let min = Infinity, max = -Infinity;
  for (const e of edges) {
    for (const [x, z] of [[e.ax, e.az], [e.bx, e.bz]] as const) {
      const projection = (x - mx) * tx + (z - mz) * tz;
      min = Math.min(min, projection);
      max = Math.max(max, projection);
    }
  }
  const along = (min + max) * 0.5;
  return {
    index, kind, edges, length: max - min, nx, nz,
    frame: frame(mx + tx * along, 0, mz + tz * along, yaw),
  };
}

export function resolveAdministrationLayout(bbox: Bbox): AdministrationLayout {
  const outer = project(bbox, OSM_LANDMARK_DATA.administrationOuter);
  const inner = project(bbox, OSM_LANDMARK_DATA.administrationInner);
  const plinthPoint = fromLatLon(bbox, PLINTH_LAT, PLINTH_LON);
  const plinth: Point = [plinthPoint.x, plinthPoint.z];
  const outerEdges = ringEdges(outer);
  const innerEdges = ringEdges(inner, true);

  const facesFront = outerEdges.map((edge) => {
    const mx = (edge.ax + edge.bx) * 0.5, mz = (edge.az + edge.bz) * 0.5;
    const dx = plinth[0] - mx, dz = plinth[1] - mz;
    const length = Math.hypot(dx, dz) || 1;
    return (edge.nx * dx + edge.nz * dz) / length > FRONT_FACING_DOT;
  });

  const groups: AdministrationEdge[][] = [];
  for (let i = 0; i < outerEdges.length; i++) {
    if (!facesFront[i]) continue;
    const previous = groups[groups.length - 1];
    if (previous && previous[previous.length - 1]!.index === i - 1) previous.push(outerEdges[i]!);
    else groups.push([outerEdges[i]!]);
  }
  // The longest front-facing run is the recessed central bay; the others are the two wings.
  const centralGroup = groups.reduce((best, group) => {
    const length = group.reduce((sum, edge) => sum + edge.len, 0);
    const bestLength = best.reduce((sum, edge) => sum + edge.len, 0);
    return length > bestLength ? group : best;
  }, groups[0]!);
  const runs: AdministrationFacadeRun[] = [];
  let runIndex = 0;
  for (const group of groups) {
    runs.push(makeRun(group, group === centralGroup ? 'central' : 'wing', runIndex++));
  }
  for (let i = 0; i < outerEdges.length; i++) {
    if (facesFront[i]) continue;
    const wrappedPrevious = facesFront[(i - 1 + outerEdges.length) % outerEdges.length];
    const wrappedNext = facesFront[(i + 1) % outerEdges.length];
    runs.push(makeRun([outerEdges[i]!], wrappedPrevious && wrappedNext ? 'step' : 'other', runIndex++));
  }
  for (const edge of innerEdges) runs.push(makeRun([edge], 'courtyard', runIndex++));

  return {
    outer, inner, centroid: centroid(outer), plinth,
    outerEdges, innerEdges,
    mainFacadeEdges: outerEdges.filter((_, i) => facesFront[i]),
    centralRun: runs.find((run) => run.kind === 'central')!,
    wingRuns: runs.filter((run) => run.kind === 'wing'),
    runs,
    pilasterCount: 10,
  };
}

function plainColumns(length: number): number[] {
  if (length < 3.5) return [];
  const count = Math.max(1, Math.round((length - 1.6) / 3.6));
  const step = length / count;
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(-length * 0.5 + step * (i + 0.5));
  return out;
}

function plainOpenings(length: number): OpeningSpec[] {
  const out: OpeningSpec[] = [];
  plainColumns(length).forEach((x, bay) => {
    out.push({ x, y: GROUND_WINDOW_Y, w: WINDOW_W, h: GROUND_WINDOW_H, row: 0, bay, door: false });
    for (const row of UPPER_ROWS) out.push({ x, y: row.y, w: WINDOW_W, h: row.h, row: row.row, bay, door: false });
  });
  return out;
}

function centralOpenings(length: number): CentralSpec {
  const margin = 0.6;
  const spacing = (length - margin * 2) / 9;
  const pilasters = Array.from({ length: 10 }, (_, i) => -length * 0.5 + margin + spacing * i);
  const doorBays = [3, 4, 5];
  const openings: OpeningSpec[] = [];
  const doors: OpeningSpec[] = [];
  for (let bay = 0; bay < 9; bay++) {
    const x = (pilasters[bay]! + pilasters[bay + 1]!) * 0.5;
    if (doorBays.includes(bay)) {
      const door: OpeningSpec = { x, y: DOOR_Y, w: Math.min(2.8, spacing * 0.62), h: DOOR_H, row: 0, bay, door: true };
      openings.push(door);
      doors.push(door);
    } else {
      openings.push({ x, y: GROUND_WINDOW_Y, w: WINDOW_W, h: GROUND_WINDOW_H, row: 0, bay, door: false });
    }
    for (const row of UPPER_ROWS) {
      openings.push({ x, y: row.y, w: WINDOW_W, h: row.h, row: row.row, bay, door: false });
    }
  }
  return { pilasters, openings, doors, stepX0: pilasters[3]!, stepX1: pilasters[6]! };
}

function addGrille(b: KitBuilder, f: Frame, o: OpeningSpec): void {
  const y0 = o.y + 0.06, y1 = o.y + o.h - 0.06;
  for (const fraction of [0.25, 0.5, 0.75]) {
    const x = o.x - o.w * 0.5 + o.w * fraction;
    b.quad(f.toWorld(x - 0.022, y0, -0.09), f.toWorld(x + 0.022, y0, -0.09),
      f.toWorld(x + 0.022, y1, -0.09), f.toWorld(x - 0.022, y1, -0.09),
      undefined, undefined, DARK_GREY, -1);
    b.quad(f.toWorld(x + 0.022, y0, -0.11), f.toWorld(x - 0.022, y0, -0.11),
      f.toWorld(x - 0.022, y1, -0.11), f.toWorld(x + 0.022, y1, -0.11),
      undefined, undefined, DARK_GREY, -1);
  }
}

function addEntrySteps(b: KitBuilder, f: Frame, x0: number, x1: number, near: boolean): void {
  if (!near) {
    boxPrism(b, f, {
      x0, x1, y0: 0, y1: 0.75, z0: 0, z1: 1.75,
      colour: GRANITE_COLOUR, pbr: PBR_LAYER.GRANITE, bottom: false,
    });
    return;
  }
  for (let i = 0; i < 5; i++) {
    const top = 0.15 * (i + 1);
    const outer = 1.75 - i * 0.35;
    boxPrism(b, f, {
      x0, x1, y0: 0, y1: top, z0: 0, z1: outer,
      colour: GRANITE_COLOUR, pbr: PBR_LAYER.GRANITE, bottom: false,
    });
  }
}

function addEntablature(b: KitBuilder, run: AdministrationFacadeRun, base: number, ornate: boolean, near: boolean): void {
  const f = frame(run.frame.x, base + WALL_TOP, run.frame.z, run.frame.yaw);
  const x0 = -run.length * 0.5, x1 = run.length * 0.5;
  if (!near) {
    boxPrism(b, f, {
      x0, x1, y0: 0, y1: ENTABLATURE_H, z0: 0, z1: 0.3,
      colour: TRIM, pbr: PBR_LAYER.STUCCO_SMOOTH, back: false, bottom: false,
    });
    return;
  }
  sweepProfile(b, f, ARCHITRAVE, [[x0, 0], [x1, 0]], false, TRIM, PBR_LAYER.STUCCO_SMOOTH);
  const friezeTop = ornate ? 1.3 : 1.38;
  boxPrism(b, f, {
    x0, x1, y0: 0.2, y1: friezeTop, z0: 0, z1: 0.08,
    colour: TRIM, pbr: PBR_LAYER.STUCCO_SMOOTH, back: false, bottom: false, top: false,
  });
  const cornice = frame(run.frame.x, base + WALL_TOP + friezeTop, run.frame.z, run.frame.yaw);
  sweepProfile(
    b, cornice, ornate ? CORNICE_DENTIL : CORNICE_SIMPLE, [[x0, 0], [x1, 0]], false,
    TRIM, PBR_LAYER.STUCCO_SMOOTH, ornate ? { dentils: { spacing: 0.55, depth: 0.1 } } : {},
  );
}

function addAirConditioner(b: KitBuilder, f: Frame, o: OpeningSpec): void {
  b.quad(f.toWorld(o.x - 0.4, o.y - 0.55, 0.3), f.toWorld(o.x + 0.4, o.y - 0.55, 0.3),
    f.toWorld(o.x + 0.4, o.y - 0.05, 0.3), f.toWorld(o.x - 0.4, o.y - 0.05, 0.3),
    [0, 0, 1], undefined, AC_WHITE, PBR_LAYER.STUCCO_SMOOTH);
  b.quad(f.toWorld(o.x - 0.4, o.y - 0.55, 0), f.toWorld(o.x - 0.4, o.y - 0.55, 0.3),
    f.toWorld(o.x - 0.4, o.y - 0.05, 0.3), f.toWorld(o.x - 0.4, o.y - 0.05, 0),
    [-1, 0, 0], undefined, AC_WHITE, PBR_LAYER.STUCCO_SMOOTH);
  b.quad(f.toWorld(o.x + 0.4, o.y - 0.55, 0.3), f.toWorld(o.x + 0.4, o.y - 0.55, 0),
    f.toWorld(o.x + 0.4, o.y - 0.05, 0), f.toWorld(o.x + 0.4, o.y - 0.05, 0.3),
    [1, 0, 0], undefined, AC_WHITE, PBR_LAYER.STUCCO_SMOOTH);
  b.quad(f.toWorld(o.x - 0.4, o.y - 0.05, 0.3), f.toWorld(o.x + 0.4, o.y - 0.05, 0.3),
    f.toWorld(o.x + 0.4, o.y - 0.05, 0), f.toWorld(o.x - 0.4, o.y - 0.05, 0),
    [0, 1, 0], undefined, AC_WHITE, PBR_LAYER.STUCCO_SMOOTH);
  b.quad(f.toWorld(o.x - 0.4, o.y - 0.55, 0), f.toWorld(o.x + 0.4, o.y - 0.55, 0),
    f.toWorld(o.x + 0.4, o.y - 0.55, 0.3), f.toWorld(o.x - 0.4, o.y - 0.55, 0.3),
    [0, -1, 0], undefined, AC_WHITE, PBR_LAYER.STUCCO_SMOOTH);
}

/** Stable 0..1 hash for the pre-war air-conditioner scatter; never `Math.random`. */
function hash01(a: number, b: number): number {
  let h = Math.imul(a + 1, 374761393) ^ Math.imul(b + 7, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function addFacade(
  b: KitBuilder, run: AdministrationFacadeRun, base: number, layout: AdministrationLayout, near: boolean,
): void {
  const f = frame(run.frame.x, base, run.frame.z, run.frame.yaw);
  const x0 = -run.length * 0.5, x1 = run.length * 0.5;
  const central = run.kind === 'central' ? centralOpenings(run.length) : null;
  const openings = central ? central.openings : plainOpenings(run.length);
  // Estimate: the wings carry the full 0.9 m granite plinth; the central bay's plinth is 0.75 m so the top of the
  // five 0.15 m entrance steps meets the wooden door thresholds exactly.
  const plinthTop = run.kind === 'central' ? 0.75 : 0.9;

  wallWithOpenings(b, f, {
    x0, x1, y0: 0, y1: WALL_TOP,
    openings: near ? openings.map((o) => ({ x: o.x - o.w * 0.5, y: o.y, w: o.w, h: o.h, shape: 'rect' as const })) : [],
    colour: CLADDING, pbr: PBR_LAYER.LIMESTONE_SHELL, detail: near ? 'near' : 'far',
  });

  boxPrism(b, f, {
    x0, x1, y0: 0, y1: plinthTop, z0: 0, z1: 0.12,
    colour: GRANITE_COLOUR, pbr: PBR_LAYER.GRANITE, bottom: false,
  });

  if (near) {
    for (const o of openings) {
      if (o.door) {
        doorway(b, f, {
          x: o.x - o.w * 0.5, y0: o.y, w: o.w, h: o.h, depth: 0.3, steps: 0,
          colour: DOOR_BROWN, frame: TRIM, pbr: PBR_LAYER.LIMESTONE_SHELL,
          trimPbr: PBR_LAYER.STUCCO_SMOOTH, detail: 'near',
        });
        // A shallow central mullion reads as a pair of wooden leaves.
        b.quad(f.toWorld(o.x - 0.025, o.y + 0.05, -0.29), f.toWorld(o.x + 0.025, o.y + 0.05, -0.29),
          f.toWorld(o.x + 0.025, o.y + o.h - 0.05, -0.29), f.toWorld(o.x - 0.025, o.y + o.h - 0.05, -0.29),
          undefined, undefined, DOOR_DARK, -1);
      } else {
        addOpening(b, f, {
          x: o.x - o.w * 0.5, y: o.y, w: o.w, h: o.h, shape: 'rect', depth: 0.2,
          surround: 'none', sill: true, frame: { colour: FRAME_WHITE, bars: 'cross' },
        }, {
          reveal: CLADDING, pbr: PBR_LAYER.LIMESTONE_SHELL,
          surround: TRIM, sill: TRIM, trimPbr: PBR_LAYER.STUCCO_SMOOTH,
        }, 'near');
        if (o.row === 0 && (run.kind === 'central' || run.kind === 'wing')) addGrille(b, f, o);
      }
    }
    if (run.kind === 'central') {
      const wide = central!;
      for (const x of wide.pilasters) {
        pilaster(b, f, {
          x, y0: 0.75, y1: WALL_TOP, w: 1.0, depth: 0.45, capital: 'corinthian', base: true,
          colour: TRIM, pbr: PBR_LAYER.STUCCO_SMOOTH, detail: 'near',
        });
      }
      addEntrySteps(b, f, wide.stepX0, wide.stepX1, true);
    } else if (run.kind === 'wing') {
      // A few deterministic pre-war air-conditioner boxes under the upper wing windows.
      for (const o of openings) {
        if (o.door || o.row === 0) continue;
        if (hash01(run.index * 131 + o.bay, o.row) < 0.22) addAirConditioner(b, f, o);
      }
    }
  } else {
    for (const o of openings) {
      const colour = o.door ? DOOR_DARK : GLASS_DARK;
      b.quad(f.toWorld(o.x - o.w * 0.5, o.y, 0.025), f.toWorld(o.x + o.w * 0.5, o.y, 0.025),
        f.toWorld(o.x + o.w * 0.5, o.y + o.h, 0.025), f.toWorld(o.x - o.w * 0.5, o.y + o.h, 0.025),
        [0, 0, 1], undefined, colour, -1);
    }
    if (run.kind === 'central') {
      const wide = central!;
      for (const x of wide.pilasters) {
        boxPrism(b, f, {
          x0: x - 0.5, x1: x + 0.5, y0: 0.75, y1: WALL_TOP, z0: 0, z1: 0.3,
          colour: TRIM, pbr: PBR_LAYER.STUCCO_SMOOTH, back: false,
        });
      }
      addEntrySteps(b, f, wide.stepX0, wide.stepX1, false);
    }
  }
  addEntablature(b, run, base, run.kind === 'central', near);
}

function toLocal(f: Frame, p: Point): Point {
  const c = Math.cos(f.yaw), s = Math.sin(f.yaw);
  const dx = p[0] - f.x, dz = p[1] - f.z;
  return [dx * c - dz * s, dx * s + dz * c];
}

/** Roof deck over the outer ring with the courtyard cut out (Earcut holes); no face covers the void. */
function addRoofDeck(b: KitBuilder, layout: AdministrationLayout, base: number): void {
  const f = frame(layout.centroid[0], 0, layout.centroid[1], layout.centralRun.frame.yaw);
  const outerLocal = layout.outer.map((p) => toLocal(f, p));
  const innerLocal = layout.inner.map((p) => toLocal(f, p));
  const data: number[] = [];
  for (const p of outerLocal) data.push(p[0], p[1]);
  for (const p of innerLocal) data.push(p[0], p[1]);
  const triangles = Earcut.triangulate(data, [outerLocal.length], 2);
  const y = base + ROOF_DECK;
  for (let t = 0; t + 2 < triangles.length; t += 3) {
    const a = innerOrOuter(outerLocal, innerLocal, triangles[t]!);
    const c = innerOrOuter(outerLocal, innerLocal, triangles[t + 1]!);
    const d = innerOrOuter(outerLocal, innerLocal, triangles[t + 2]!);
    if (!a || !c || !d) continue;
    // Earcut keeps the input winding; force the deck to face up.
    const crossY = (c[1] - a[1]) * (d[0] - a[0]) - (c[0] - a[0]) * (d[1] - a[1]);
    const order = crossY >= 0 ? [a, c, d] : [a, d, c];
    b.tri(
      f.toWorld(order[0]![0], y, order[0]![1]),
      f.toWorld(order[1]![0], y, order[1]![1]),
      f.toWorld(order[2]![0], y, order[2]![1]),
      [0, 1, 0], undefined, ROOF_COLOUR, PBR_LAYER.ROOF_BITUMEN,
    );
  }
}

function innerOrOuter(outer: readonly Point[], inner: readonly Point[], index: number): Point | undefined {
  return index < outer.length ? outer[index] : inner[index - outer.length];
}

function addParapets(b: KitBuilder, layout: AdministrationLayout, base: number): void {
  for (const run of layout.runs) {
    if (run.kind === 'central') continue;
    const f = frame(run.frame.x, base, run.frame.z, run.frame.yaw);
    boxPrism(b, f, {
      x0: -run.length * 0.5, x1: run.length * 0.5,
      y0: ROOF_DECK, y1: ROOF_DECK + PARAPET_H, z0: -0.35, z1: 0,
      colour: CLADDING, pbr: PBR_LAYER.LIMESTONE_SHELL, bottom: false,
    });
  }
}

function shieldOutline(w: number, h: number): Point[] {
  return [
    [0, -h * 0.5],
    [w * 0.28, -h * 0.32],
    [w * 0.5, -h * 0.08],
    [w * 0.5, h * 0.5],
    [-w * 0.5, h * 0.5],
    [-w * 0.5, -h * 0.08],
    [-w * 0.28, -h * 0.32],
  ];
}

/** Raised plaque: a larger frame shield behind a smaller inner shield. */
function addShield(b: KitBuilder, f: Frame, cx: number, cy: number, w: number, h: number): void {
  addPlaque(b, f, cx, cy, w + 0.4, h + 0.35, 0.02, 0.09, TRIM);
  addPlaque(b, f, cx, cy, w, h, 0.09, 0.17, CLADDING);
}

function addPlaque(
  b: KitBuilder, f: Frame, cx: number, cy: number, w: number, h: number,
  z0: number, z1: number, colour: Colour,
): void {
  const outline = shieldOutline(w, h);
  const centre = f.toWorld(cx, cy, z1);
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i]!, c = outline[(i + 1) % outline.length]!;
    b.tri(centre, f.toWorld(cx + a[0], cy + a[1], z1), f.toWorld(cx + c[0], cy + c[1], z1),
      [0, 0, 1], undefined, colour, PBR_LAYER.STUCCO_SMOOTH);
    b.quad(
      f.toWorld(cx + a[0], cy + a[1], z0), f.toWorld(cx + c[0], cy + c[1], z0),
      f.toWorld(cx + c[0], cy + c[1], z1), f.toWorld(cx + a[0], cy + a[1], z1),
      undefined, undefined, colour, PBR_LAYER.STUCCO_SMOOTH,
    );
  }
}

function addAttic(b: KitBuilder, layout: AdministrationLayout, base: number, near: boolean): void {
  const run = layout.centralRun;
  const f = frame(run.frame.x, base, run.frame.z, run.frame.yaw);
  const x0 = -run.length * 0.5, x1 = run.length * 0.5;
  attic(b, f, {
    x0, x1, z0: -4, z1: 0, y: ROOF_DECK, h: ATTIC_H,
    colour: CLADDING, pbr: PBR_LAYER.LIMESTONE_SHELL,
  });
  const cy = ROOF_DECK + ATTIC_H * 0.5;
  if (near) addShield(b, f, 0, cy, 3, 2.4);
  else {
    b.quad(
      f.toWorld(-1.5, cy - 1.2, 0.03), f.toWorld(1.5, cy - 1.2, 0.03),
      f.toWorld(1.5, cy + 1.2, 0.03), f.toWorld(-1.5, cy + 1.2, 0.03),
      [0, 0, 1], undefined, TRIM, PBR_LAYER.STUCCO_SMOOTH,
    );
  }
}

/** Flagpole on the attic roof behind the cartouche, with a two-quad blue-and-yellow flag. */
function addFlag(b: KitBuilder, layout: AdministrationLayout, base: number, near: boolean): void {
  const run = layout.centralRun;
  const f = frame(run.frame.x, base, run.frame.z, run.frame.yaw);
  const poleY = ROOF_DECK + ATTIC_H + 0.18;
  const poleTop = poleY + FLAGPOLE_H;
  const z = -2;
  const half = near ? 0.045 : 0.06;
  boxPrism(b, f, {
    x0: -half, x1: half, y0: poleY, y1: poleTop, z0: z - half, z1: z + half,
    colour: METAL, pbr: -1, bottom: false,
  });
  const x0 = 0.05, x1 = 1.9;
  const top = poleTop - 0.3, mid = top - 0.9, bottom = mid - 0.9;
  b.quad(
    f.toWorld(x0, bottom, z), f.toWorld(x1, bottom, z),
    f.toWorld(x1, mid, z), f.toWorld(x0, mid, z),
    [0, 0, 1], undefined, FLAG_YELLOW, -1,
  );
  b.quad(
    f.toWorld(x0, mid, z), f.toWorld(x1, mid, z),
    f.toWorld(x1, top, z), f.toWorld(x0, top, z),
    [0, 0, 1], undefined, FLAG_BLUE, -1,
  );
}

/** Solid shell around the courtyard: point-in-outer-ring minus point-in-courtyard. */
function administrationSurface(layout: AdministrationLayout, yBase: number, yTop: number): LandmarkSurface {
  return {
    heightAt: () => null,
    blockedAt(x: number, z: number, y: number, bodyH = 1.7): boolean {
      if (y >= yTop || y + bodyH <= yBase) return false;
      return pointInPolygon(layout.outer, x, z) && !pointInPolygon(layout.inner, x, z);
    },
  };
}

function groundUnder(ctx: LandmarkBuildContext, layout: AdministrationLayout): number {
  let lowest = Infinity;
  for (const p of layout.outer) {
    const y = ctx.groundAt(p[0], p[1]);
    if (y !== null && Number.isFinite(y)) lowest = Math.min(lowest, y);
  }
  if (Number.isFinite(lowest)) return lowest;
  const centre = ctx.groundAt(layout.centroid[0], layout.centroid[1]);
  return centre !== null && Number.isFinite(centre) ? centre : 0;
}

export function createAdministration(bbox: Bbox): Landmark {
  const layout = resolveAdministrationLayout(bbox);
  const [lat, lon] = toLatLon(bbox, layout.centroid[0], layout.centroid[1]);

  return {
    id: 'hero:administration',
    name: 'Херсонська обласна державна адміністрація',
    anchor: { lat, lon, x: layout.centroid[0], z: layout.centroid[1] },
    footprint: layout.outer,
    replaces: [{ type: 'relation', id: 2168547 }],
    ready: (ctx) => {
      const y = ctx.groundAt(layout.centroid[0], layout.centroid[1]);
      return y !== null && Number.isFinite(y);
    },
    build: (ctx) => {
      const near = (ctx.lod ?? 'near') === 'near';
      const base = groundUnder(ctx, layout);
      const builder = new KitBuilder();
      for (const run of layout.runs) addFacade(builder, run, base, layout, near);
      addRoofDeck(builder, layout, base);
      addParapets(builder, layout, base);
      addAttic(builder, layout, base, near);
      addFlag(builder, layout, base, near);
      const mesh: LandmarkMeshData = builder.finish('textured');
      const built = buildResult([mesh], [administrationSurface(layout, base, base + ROOF_DECK + ATTIC_H)], [], undefined);
      return {
        ...built,
        stats: {
          pilasters: layout.pilasterCount,
          doors: 3,
          mainFacadeEdges: layout.mainFacadeEdges.length,
          footprintEdges: layout.outerEdges.length,
          courtyardEdges: layout.innerEdges.length,
          topY: base + ROOF_DECK + ATTIC_H + 0.18,
          triangles: built.triangleCount,
        },
      };
    },
  };
}

/**
 * Hero model: Hotel «Фрегат» (Voxel Kherson), Ushakova Avenue 2, OSM way 116810729.
 *
 * A documented, hand-made override of the OSM extrusion (Constitution 2.1–2.3): the plan is read from the OSM
 * outline and the missing facade rhythm from the 2017 photo brief in docs/landmarks/pier.md. Every dimension that
 * is not taken from the outline is marked as an estimate from the plan and the 2017 photo.
 *
 * Frame: local +x runs south along the slab's long axis, local +z points west-north-west toward Ushakova Avenue.
 * All heights are metres above the lowest ground under the OSM ring.
 */
import { fromLatLon, toLatLon } from '../geo.ts';
import {
  KitBuilder, emitBox, flatRoofWithParapet, frame, frameAt, type Detail, type Frame,
} from '../kit/index.ts';
import { prismSurface } from '../hero-physics.ts';
import { buildResult, rgb, type Landmark, type LandmarkBuild, type LandmarkBuildContext, type LandmarkSurface } from '../types.ts';
import type { Bbox } from '../../world/manifest.ts';
import { PBR_LAYER } from '../../world/pbr-layers.ts';

type Point = [number, number];
type Color = readonly [number, number, number];

// OSM way 116810729, open ring in WGS84, in the order published in the task/brief.
const RING_LATLON: readonly (readonly [number, number])[] = [
  [46.6301147, 32.621353], [46.629809, 32.6215285], [46.629794, 32.6214731], [46.6297689, 32.6214875],
  [46.6297044, 32.6212492], [46.6294008, 32.6214235], [46.6295578, 32.6220031], [46.6295943, 32.6219821],
  [46.6296195, 32.6220751], [46.6297322, 32.6220104], [46.6297606, 32.6221155], [46.629789, 32.6220992],
  [46.6297396, 32.6219168], [46.6298152, 32.6218734], [46.6298377, 32.6219563], [46.6298866, 32.6219282],
  [46.6298486, 32.6217881], [46.6301796, 32.621598], [46.6301605, 32.6215275], [46.63018, 32.6215163],
  [46.6301547, 32.6214226], [46.6301364, 32.6214331],
];

const STOREYS = 15;
// Estimate from the brief/2017 photo: 15 Soviet storeys of 3.1 m and a 1.2 m parapet.
const STOREY_H = 3.1;
const PARAPET_H = 1.2;
const SLAB_TOP = STOREYS * STOREY_H;
const SLAB_PARAPET_TOP = SLAB_TOP + PARAPET_H;
// Estimate from the plan: the broad south podium is two storeys, about 8 m, with a 4 m glazed lobby.
const PODIUM_TOP = 8;
const LOBBY_TOP = 4;
// Estimate from the photo: the stair/lift tower rises about 1.5 storeys above the slab roof.
const STAIR_RISE = 1.5 * STOREY_H;
const STAIR_TOP = SLAB_TOP + STAIR_RISE;
// Estimate from the photo: each sail/flame spike is about 5.6 m tall, 1.2 m wide at its base.
const SPIKE_HEIGHT = 5.6;
const SPIKE_BASE_W = 1.2;
const SPIKE_TOP = STAIR_TOP + SPIKE_HEIGHT;
// Estimate from the photo: a 12 m thin antenna mast on the north end tower.
const ANTENNA_HEIGHT = 12;
const END_TOWER_TOP = SLAB_PARAPET_TOP;
const ANTENNA_TOP = END_TOWER_TOP + ANTENNA_HEIGHT;
const BALCONY_ROWS = 12; // storeys 2–13, as specified in the brief.
const BAY_TARGET = 3.6;

const CONCRETE: Color = rgb(0xe8e6e0);
const PALE_CONCRETE: Color = rgb(0xd9d7d1);
const WHITE: Color = rgb(0xf3f2ec);
const YELLOW: Color = rgb(0xe8d26a);
const GLASS: Color = rgb(0x2f4a55);
const TEAL_GLASS: Color = rgb(0x3d8a8f);
const DARK_FRAME: Color = rgb(0x283437);
const RAIL: Color = rgb(0xa9aeb0);
const RED: Color = rgb(0xb41e24);
const GOLD: Color = rgb(0xd8ae3a);
const BLUE: Color = rgb(0x1e5aa8);
const MEDALLION: Color = rgb(0xe8c84a);
const ROOF: Color = rgb(0x6f6e68);
const MAST: Color = rgb(0x8c8e8d);

export interface FrehatRect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

export interface FrehatSlab extends FrehatRect {
  length: number;
  width: number;
  topY: number;
  parapetTopY: number;
}

export interface FrehatLayout {
  /** Ring in world x/z, as used for the footprint and vegetation exclusion. */
  ring: readonly Point[];
  /** Ring in the slab-aligned local frame. */
  localRing: readonly Point[];
  anchor: Point;
  basis: { x: number; z: number; ux: number; uz: number; vx: number; vz: number; yaw: number };
  slab: FrehatSlab;
  podiumRing: readonly Point[];
  podiumTopY: number;
  endTower: FrehatRect & { topY: number };
  stairTower: FrehatRect & { topY: number };
  bays: number;
  balconyRows: number;
  balconyCount: number;
}

export interface FrehatStats {
  storeys: number;
  bays: number;
  balconyRows: number;
  balconyCountPerFace: number;
  balconyCount: number;
  spikeCount: number;
  slabTopY: number;
  slabParapetTopY: number;
  stairTowerTopY: number;
  spikeTopY: number;
  antennaTopY: number;
}

function centroid(points: readonly (readonly [number, number])[]): Point {
  let x = 0, z = 0;
  for (const p of points) { x += p[0]; z += p[1]; }
  return [x / points.length, z / points.length];
}

function signedArea(points: readonly (readonly [number, number])[]): number {
  let area = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    area += points[j]![0] * points[i]![1] - points[i]![0] * points[j]![1];
  }
  return area / 2;
}

/** The kit's side quads assume a clockwise ring (outward normal is the left normal of an x/z edge). */
function clockwise<T extends readonly [number, number]>(ring: readonly T[]): readonly T[] {
  return signedArea(ring) > 0 ? [...ring].reverse() : ring;
}

/** The plan and photo give no exact slab depth; take it from the four OSM vertices that bound the north arm. */
export function resolveFrehatLayout(bbox: Bbox): FrehatLayout {
  const ring: Point[] = RING_LATLON.map(([lat, lon]) => {
    const p = fromLatLon(bbox, lat, lon);
    return [p.x, p.z];
  });
  const anchor = centroid(ring);
  const a = ring[0]!, b = ring[1]!;
  let ux = b[0] - a[0], uz = b[1] - a[1];
  const length = Math.hypot(ux, uz);
  ux /= length; uz /= length;
  // Local +x is the slab's long axis (SSE), local +z is its west-north-west normal, toward the avenue.
  const vx = -uz, vz = ux;
  const yaw = Math.atan2(-uz, ux);
  const toLocal = (p: Point): Point => {
    const dx = p[0] - anchor[0], dz = p[1] - anchor[1];
    return [dx * ux + dz * uz, dx * vx + dz * vz];
  };
  const localRing = ring.map(toLocal);
  const slab: FrehatSlab = {
    x0: Math.min(localRing[0]![0], localRing[17]![0]),
    x1: Math.max(localRing[1]![0], localRing[16]![0]),
    z0: Math.min(localRing[16]![1], localRing[17]![1]),
    z1: Math.max(localRing[0]![1], localRing[1]![1]),
    length: 0,
    width: 0,
    topY: SLAB_TOP,
    parapetTopY: SLAB_PARAPET_TOP,
  };
  slab.length = slab.x1 - slab.x0;
  slab.width = slab.z1 - slab.z0;

  // Vertices 1–16 close the broad south podium; the north arm (0–1 and 16–17) is the slab.
  const podiumRing = clockwise(localRing.slice(1, 17));
  // The notched north end (18–21) is the narrow full-height end tower.
  const endTower = {
    x0: Math.min(localRing[18]![0], localRing[19]![0], localRing[20]![0], localRing[21]![0]),
    x1: Math.max(localRing[18]![0], localRing[19]![0], localRing[20]![0], localRing[21]![0]),
    z0: Math.min(localRing[18]![1], localRing[19]![1], localRing[20]![1], localRing[21]![1]),
    z1: Math.max(localRing[18]![1], localRing[19]![1], localRing[20]![1], localRing[21]![1]),
    topY: END_TOWER_TOP,
  };
  // Estimate from the plan/photo: the stair/lift tower is about 6 × 7 m at the slab/podium junction (13–16).
  const stairTower = {
    x0: localRing[16]![0],
    x1: Math.max(localRing[13]![0], localRing[14]![0]),
    z0: localRing[16]![1] - 7,
    z1: localRing[16]![1],
    topY: STAIR_TOP,
  };
  const bays = Math.max(1, Math.round(slab.length / BAY_TARGET));
  return {
    ring, localRing, anchor,
    basis: { x: anchor[0], z: anchor[1], ux, uz, vx, vz, yaw },
    slab, podiumRing, podiumTopY: PODIUM_TOP, endTower, stairTower,
    bays, balconyRows: BALCONY_ROWS, balconyCount: bays * BALCONY_ROWS * 2,
  };
}

export function frehatStats(bbox: Bbox): FrehatStats {
  const layout = resolveFrehatLayout(bbox);
  return {
    storeys: STOREYS,
    bays: layout.bays,
    balconyRows: layout.balconyRows,
    balconyCountPerFace: layout.bays * layout.balconyRows,
    balconyCount: layout.balconyCount,
    spikeCount: 3,
    slabTopY: SLAB_TOP,
    slabParapetTopY: SLAB_PARAPET_TOP,
    stairTowerTopY: STAIR_TOP,
    spikeTopY: SPIKE_TOP,
    antennaTopY: ANTENNA_TOP,
  };
}

/** World x/z polygon for a local ring at the given frame y. */
function worldPolygon(f: Frame, ring: readonly Point[], y = 0): Point[] {
  return ring.map(([x, z]) => {
    const p = f.toWorld(x, y, z);
    return [p[0], p[2]];
  });
}

function lowestGround(ctx: LandmarkBuildContext, ring: readonly Point[]): number {
  let lowest = Infinity;
  for (const [x, z] of ring) {
    const y = ctx.groundAt(x, z);
    if (y !== null && Number.isFinite(y)) lowest = Math.min(lowest, y);
  }
  return Number.isFinite(lowest) ? lowest : 0;
}

/** Exterior walls of a clockwise local ring; the top deck is added separately. */
function extrudeRing(
  b: KitBuilder, f: Frame, ring: readonly Point[], y0: number, y1: number, colour: Color, pbr: number,
): void {
  const r = clockwise(ring);
  for (let i = 0; i < r.length; i++) {
    const a = r[i]!, c = r[(i + 1) % r.length]!;
    if (Math.hypot(c[0] - a[0], c[1] - a[1]) < 1e-6) continue;
    b.quad(
      f.toWorld(a[0], y0, a[1]), f.toWorld(c[0], y0, c[1]),
      f.toWorld(c[0], y1, c[1]), f.toWorld(a[0], y1, a[1]),
      undefined, undefined, colour, pbr,
    );
  }
}

/** A flat (zero-thickness) rectangle on a facade, used for white frames and mullions. */
function faceQuad(
  b: KitBuilder, f: Frame, x0: number, x1: number, y0: number, y1: number, z: number,
  colour: Color, pbr = -1,
): void {
  b.quad(
    f.toWorld(x0, y0, z), f.toWorld(x1, y0, z), f.toWorld(x1, y1, z), f.toWorld(x0, y1, z),
    undefined, undefined, colour, pbr,
  );
}

/** Vertical disc facing local +z (a porthole pane or a medallion). */
function discOnFace(
  b: KitBuilder, f: Frame, cx: number, cy: number, z: number, radius: number,
  colour: Color, segments = 10,
): void {
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2, a1 = ((i + 1) / segments) * Math.PI * 2;
    b.tri(
      f.toWorld(cx, cy, z),
      f.toWorld(cx + Math.cos(a0) * radius, cy + Math.sin(a0) * radius, z),
      f.toWorld(cx + Math.cos(a1) * radius, cy + Math.sin(a1) * radius, z),
      undefined, undefined, colour, -1,
    );
  }
}

/** White annulus around a porthole (or a medallion's rim). */
function ringOnFace(
  b: KitBuilder, f: Frame, cx: number, cy: number, z: number, radius: number, width: number,
  colour: Color, segments = 10,
): void {
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2, a1 = ((i + 1) / segments) * Math.PI * 2;
    b.quad(
      f.toWorld(cx + Math.cos(a0) * radius, cy + Math.sin(a0) * radius, z),
      f.toWorld(cx + Math.cos(a0) * (radius + width), cy + Math.sin(a0) * (radius + width), z),
      f.toWorld(cx + Math.cos(a1) * (radius + width), cy + Math.sin(a1) * (radius + width), z),
      f.toWorld(cx + Math.cos(a1) * radius, cy + Math.sin(a1) * radius, z),
      undefined, undefined, colour, -1,
    );
  }
}

/** One balcony: a projecting slab, two metal rails and three posts, with glazing behind it at near detail. */
function balcony(
  b: KitBuilder, f: Frame, bayX: number, bayW: number, floorY: number, detail: Detail,
): void {
  const x0 = bayX - bayW / 2 + 0.06, x1 = bayX + bayW / 2 - 0.06;
  // Slab: 1.2 m projection and 0.18 m thickness, both from the brief.
  emitBox(b, f, x0, x1, floorY, floorY + 0.18, 0, 1.2, PALE_CONCRETE, PBR_LAYER.PANEL_CONCRETE, { back: false });
  if (detail === 'far') return;
  const railY0 = floorY + 0.18, railZ0 = 1.09, railZ1 = 1.17;
  for (const y of [railY0 + 0.4, railY0 + 0.78]) {
    emitBox(b, f, x0 + 0.08, x1 - 0.08, y, y + 0.055, railZ0, railZ1, RAIL);
  }
  for (const px of [x0 + 0.1, (x0 + x1) / 2, x1 - 0.1]) {
    emitBox(b, f, px - 0.03, px + 0.03, railY0, floorY + 1.03, railZ0 + 0.015, railZ1 - 0.015, RAIL);
  }

  // Glazed balcony doors and windows: two panes with white flat frames (the photo's rhythm).
  const doorY = floorY + 0.2, doorH = 2.5;
  faceQuad(b, f, x0 + 0.18, (x0 + x1) / 2 - 0.04, doorY, doorY + doorH, 0.03, GLASS);
  faceQuad(b, f, (x0 + x1) / 2 + 0.04, x1 - 0.18, doorY, doorY + doorH, 0.03, GLASS);
  for (const px of [x0 + 0.16, (x0 + x1) / 2, x1 - 0.16]) {
    faceQuad(b, f, px - 0.035, px + 0.035, doorY, doorY + doorH, 0.05, WHITE);
  }
  for (const y of [doorY, doorY + doorH - 0.07, doorY + 1.55]) {
    faceQuad(b, f, x0 + 0.16, x1 - 0.16, y, y + 0.06, 0.05, WHITE);
  }
}

/** Yellow band with two rows of portholes, used on the slab's top two storeys. */
function slabYellowBand(b: KitBuilder, f: Frame, length: number, bays: number, detail: Detail): void {
  const y0 = SLAB_TOP - 2 * STOREY_H, y1 = SLAB_TOP;
  emitBox(b, f, 0.06, length - 0.06, y0, y1, 0, 0.08, YELLOW, PBR_LAYER.STUCCO_SMOOTH, { back: false });
  if (detail === 'far') return;
  const bayW = length / bays;
  for (let row = 0; row < 2; row++) {
    const cy = y0 + STOREY_H * (row + 0.5);
    for (let i = 0; i < bays; i++) {
      const cx = bayW * (i + 0.5);
      ringOnFace(b, f, cx, cy, 0.09, 0.7, 0.12, WHITE);
      discOnFace(b, f, cx, cy, 0.1, 0.7, GLASS);
    }
  }
}

/** Add the two long balcony faces of the slab plus their yellow top bands. */
function slabFacades(b: KitBuilder, f: Frame, layout: FrehatLayout, detail: Detail): void {
  const { slab } = layout;
  const length = slab.length;
  // +z (avenue) and -z (river) faces. The face frame's local length always runs from 0 to length.
  for (const avenue of [true, false]) {
    const face = avenue
      ? frameAt(f, slab.x0, 0, slab.z1, 0)
      : frameAt(f, slab.x1, 0, slab.z0, Math.PI);
    if (detail === 'far') {
      for (let storey = 2; storey <= 13; storey++) {
        const floorY = (storey - 1) * STOREY_H;
        emitBox(b, face, 0.06, length - 0.06, floorY, floorY + 0.18, 0, 1.2,
          PALE_CONCRETE, PBR_LAYER.PANEL_CONCRETE, { back: false });
      }
    } else {
      const bayW = length / layout.bays;
      for (let storey = 2; storey <= 13; storey++) {
        const floorY = (storey - 1) * STOREY_H;
        for (let bay = 0; bay < layout.bays; bay++) {
          balcony(b, face, bayW * (bay + 0.5), bayW, floorY, detail);
        }
      }
    }
    slabYellowBand(b, face, length, layout.bays, detail);
  }
}

/** Glazed lobby, yellow band, portholes and the first-floor canopy on the podium's avenue face. */
function podiumFacades(b: KitBuilder, f: Frame, layout: FrehatLayout, detail: Detail): void {
  // The longest +z edge is the broad avenue frontage of the podium (vertices 4–5 in the OSM ring).
  const p = layout.podiumRing;
  let best = -Infinity, x0 = p[0]![0], x1 = p[0]![0], z = p[0]![1];
  for (let i = 0; i < p.length; i++) {
    const a = p[i]!, c = p[(i + 1) % p.length]!;
    if (Math.abs(a[1] - c[1]) > 0.05) continue;
    const span = Math.abs(c[0] - a[0]);
    if (span > best) {
      best = span;
      x0 = Math.min(a[0], c[0]); x1 = Math.max(a[0], c[0]); z = a[1];
    }
  }
  if (!(x1 > x0)) return;
  const width = x1 - x0;
  const face = frameAt(f, x0, 0, z, 0);

  // Upper yellow band with round portholes (the photo's podium band).
  emitBox(b, face, 0.04, width - 0.04, 5.4, 7.3, 0, 0.07, YELLOW, PBR_LAYER.STUCCO_SMOOTH, { back: false });
  // Projecting first-floor canopy over the entrance, 1.2 m out (kept inside the test's 1.5 m allowance).
  emitBox(b, face, 3, width - 3, LOBBY_TOP, LOBBY_TOP + 0.32, 0, 1.2, PALE_CONCRETE, PBR_LAYER.PANEL_CONCRETE);
  if (detail === 'far') return;

  for (let i = 0; i < 9; i++) {
    const cx = 2.2 + (width - 4.4) * ((i + 0.5) / 9);
    ringOnFace(b, face, cx, 6.35, 0.08, 0.7, 0.12, WHITE);
    discOnFace(b, face, cx, 6.35, 0.09, 0.7, GLASS);
  }

  // Teal glazing in a dark frame grid, with doors at the centre bay.
  const panels = 9, glassY0 = 0.25, glassY1 = LOBBY_TOP - 0.15;
  const step = (width - 2) / panels;
  for (let i = 0; i < panels; i++) {
    const gx0 = 1 + step * i + 0.08, gx1 = 1 + step * (i + 1) - 0.08;
    faceQuad(b, face, gx0, gx1, glassY0, glassY1, 0.03, TEAL_GLASS);
  }
  for (let i = 0; i <= panels; i++) {
    const mx = 1 + step * i;
    faceQuad(b, face, mx - 0.07, mx + 0.07, glassY0 - 0.15, glassY1 + 0.15, 0.06, DARK_FRAME);
  }
  for (const y of [glassY0 - 0.15, glassY0 + (glassY1 - glassY0) * 0.62, glassY1]) {
    faceQuad(b, face, 1, width - 1, y, y + 0.1, 0.06, DARK_FRAME);
  }

  // The entrance pair under the canopy: a slightly darker leaf either side of the centre mullion.
  const doorCx = width / 2;
  faceQuad(b, face, doorCx - 1.05, doorCx - 0.06, 0.02, 2.7, 0.07, GLASS);
  faceQuad(b, face, doorCx + 0.06, doorCx + 1.05, 0.02, 2.7, 0.07, GLASS);
  faceQuad(b, face, doorCx - 0.06, doorCx + 0.06, 0.02, 2.7, 0.09, DARK_FRAME);
  faceQuad(b, face, doorCx - 1.05, doorCx + 1.05, 2.7, 2.82, 0.09, DARK_FRAME);
}

/** White end tower with its blue medallion stripe and 12 m antenna mast. */
function endTower(b: KitBuilder, f: Frame, layout: FrehatLayout, detail: Detail): void {
  const t = layout.endTower;
  emitBox(b, f, t.x0, t.x1, 0, t.topY, t.z0, t.z1, WHITE, PBR_LAYER.STUCCO_SMOOTH, { bottom: false });
  // The north face (local -x), which is seen looking south down the avenue.
  const face = frameAt(f, t.x0, 0, t.z0, -Math.PI / 2);
  const width = t.z1 - t.z0;
  emitBox(b, face, width * 0.5 - 0.75, width * 0.5 + 0.75, 8, t.topY - 2, 0, 0.08, BLUE, -1, { back: false });
  if (detail === 'near') {
    // One yellow medallion per two storeys, as on the 2017 photo.
    for (let i = 0; i < 7; i++) {
      const cy = 10 + i * (STOREY_H * 2);
      if (cy > t.topY - 2.5) break;
      ringOnFace(b, face, width * 0.5, cy, 0.1, 0.62, 0.09, WHITE);
      discOnFace(b, face, width * 0.5, cy, 0.11, 0.62, MEDALLION, 12);
    }
  }
  // Thin antenna mast, estimated at 12 m from the photo.
  const cx = (t.x0 + t.x1) / 2, cz = (t.z0 + t.z1) / 2;
  emitBox(b, f, cx - 0.11, cx + 0.11, t.topY, t.topY + ANTENNA_HEIGHT, cz - 0.11, cz + 0.11, MAST, -1, { bottom: false });
}

/** One curved, outward-leaning gold sail/flame spike. */
function sailSpike(b: KitBuilder, f: Frame, cx: number, z: number, lean: number): void {
  const thickness = 0.16;
  const sections = [0, 0.35, 0.65, 0.85, 1];
  const points = sections.map((t) => {
    const hw = Math.max(0.02, SPIKE_BASE_W / 2 * Math.pow(1 - t, 0.8));
    const x = cx + lean * t * t;
    const y = STAIR_TOP + SPIKE_HEIGHT * t;
    return { x, y, hw };
  });
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]!, c = points[i + 1]!;
    const zf = z + thickness / 2, zb = z - thickness / 2;
    // Front (+z), back (-z), left (-x) and right (+x) strips between two tapering sections.
    b.quad(
      f.toWorld(a.x - a.hw, a.y, zf), f.toWorld(a.x + a.hw, a.y, zf),
      f.toWorld(c.x + c.hw, c.y, zf), f.toWorld(c.x - c.hw, c.y, zf),
      undefined, undefined, GOLD, -1,
    );
    b.quad(
      f.toWorld(a.x + a.hw, a.y, zb), f.toWorld(a.x - a.hw, a.y, zb),
      f.toWorld(c.x - c.hw, c.y, zb), f.toWorld(c.x + c.hw, c.y, zb),
      undefined, undefined, GOLD, -1,
    );
    b.quad(
      f.toWorld(a.x - a.hw, a.y, zf), f.toWorld(c.x - c.hw, c.y, zf),
      f.toWorld(c.x - c.hw, c.y, zb), f.toWorld(a.x - a.hw, a.y, zb),
      undefined, undefined, GOLD, -1,
    );
    b.quad(
      f.toWorld(a.x + a.hw, a.y, zf), f.toWorld(a.x + a.hw, a.y, zb),
      f.toWorld(c.x + c.hw, c.y, zb), f.toWorld(c.x + c.hw, c.y, zf),
      undefined, undefined, GOLD, -1,
    );
  }
}

/** Three gold spikes in a row above the stair tower's red sign band. */
function spikes(b: KitBuilder, f: Frame, layout: FrehatLayout, detail: Detail): void {
  const t = layout.stairTower;
  const width = t.x1 - t.x0;
  const z = (t.z0 + t.z1) / 2;
  for (let i = 0; i < 3; i++) {
    const cx = t.x0 + width * ((i + 0.5) / 3);
    const lean = (i - 1) * 0.55;
    if (detail === 'near') {
      sailSpike(b, f, cx, z, lean);
    } else {
      // Simple far-LOD pyramid: four faces from a 1.2 m × 0.6 m base to the tip.
      const y0 = STAIR_TOP, y1 = SPIKE_TOP;
      const w = SPIKE_BASE_W / 2, d = 0.3;
      const bl = f.toWorld(cx - w, y0, z - d), br = f.toWorld(cx + w, y0, z - d);
      const fr = f.toWorld(cx + w, y0, z + d), fl = f.toWorld(cx - w, y0, z + d);
      const apex = f.toWorld(cx + lean, y1, z);
      b.tri(fl, fr, apex, undefined, undefined, GOLD, -1);
      b.tri(fr, br, apex, undefined, undefined, GOLD, -1);
      b.tri(br, bl, apex, undefined, undefined, GOLD, -1);
      b.tri(bl, fl, apex, undefined, undefined, GOLD, -1);
    }
  }
}

/** White stair/lift tower with vertical fins, red sign band and the sail crown. */
function stairTower(b: KitBuilder, f: Frame, layout: FrehatLayout, detail: Detail): void {
  const t = layout.stairTower;
  emitBox(b, f, t.x0, t.x1, 0, t.topY - 2.4, t.z0, t.z1, WHITE, PBR_LAYER.STUCCO_SMOOTH, { bottom: false });
  // Red sign band at the tower head (the photo's red letter band).
  emitBox(b, f, t.x0 - 0.06, t.x1 + 0.06, t.topY - 2.4, t.topY, t.z0 - 0.06, t.z1 + 0.06,
    RED, -1, { bottom: false });
  emitBox(b, f, t.x0 + 0.15, t.x1 - 0.15, t.topY - 0.08, t.topY, t.z0 + 0.15, t.z1 - 0.15,
    PALE_CONCRETE, PBR_LAYER.PANEL_CONCRETE, { bottom: false });
  if (detail === 'near') {
    // Three or four full-height vertical fins on the river-facing (outer) face.
    const face = frameAt(f, t.x1, 0, t.z0, Math.PI);
    const width = t.x1 - t.x0;
    for (let i = 0; i < 4; i++) {
      const fx = width * ((i + 0.5) / 4);
      emitBox(b, face, fx - 0.16, fx + 0.16, 0, t.topY - 2.4, 0, 0.35, WHITE, PBR_LAYER.STUCCO_SMOOTH, { back: false });
    }
  }
  spikes(b, f, layout, detail);
}

/** Technical penthouse on the slab roof with the red hotel sign band facing the avenue. */
function slabRoofDetails(b: KitBuilder, f: Frame, layout: FrehatLayout): void {
  const { slab } = layout;
  const x0 = slab.x0 + 14, x1 = slab.x0 + 26;
  const z0 = slab.z0 + 9, z1 = slab.z0 + 17;
  emitBox(b, f, x0, x1, SLAB_TOP, SLAB_TOP + 2.4, z0, z1, CONCRETE, PBR_LAYER.PANEL_CONCRETE, { bottom: false });
  emitBox(b, f, x0 + 0.4, x1 - 0.4, SLAB_TOP + 0.7, SLAB_TOP + 2.1, z1, z1 + 0.08, RED, -1, { back: false });
  // Low plant boxes break the long flat deck.
  emitBox(b, f, slab.x0 + 30, slab.x0 + 34, SLAB_TOP, SLAB_TOP + 0.9, slab.z0 + 2, slab.z0 + 5, ROOF, PBR_LAYER.CONCRETE, { bottom: false });
}

export function buildFrehat(layout: FrehatLayout, ctx: LandmarkBuildContext): LandmarkBuild {
  const detail: Detail = ctx.lod === 'far' ? 'far' : 'near';
  const base = lowestGround(ctx, layout.ring);
  const f = frame(layout.anchor[0], base, layout.anchor[1], layout.basis.yaw);
  const b = new KitBuilder();

  // Podium: the broad south part of the OSM ring, extruded exactly to two storeys.
  extrudeRing(b, f, layout.podiumRing, 0, layout.podiumTopY, CONCRETE, PBR_LAYER.PANEL_CONCRETE);
  flatRoofWithParapet(b, f, {
    ring: layout.podiumRing, y: layout.podiumTopY, parapetH: 0.6, thickness: 0.28,
    colour: CONCRETE, pbr: PBR_LAYER.PANEL_CONCRETE,
  });
  podiumFacades(b, f, layout, detail);

  // Main 15-storey slab (the north arm), with a flat roof and a 1.2 m parapet.
  const { slab } = layout;
  emitBox(b, f, slab.x0, slab.x1, 0, slab.topY, slab.z0, slab.z1,
    CONCRETE, PBR_LAYER.PANEL_CONCRETE, { top: false, bottom: false });
  flatRoofWithParapet(b, f, {
    ring: [[slab.x0, slab.z0], [slab.x1, slab.z0], [slab.x1, slab.z1], [slab.x0, slab.z1]],
    y: slab.topY, parapetH: PARAPET_H, thickness: 0.3,
    colour: CONCRETE, pbr: PBR_LAYER.PANEL_CONCRETE,
  });
  slabFacades(b, f, layout, detail);
  slabRoofDetails(b, f, layout);

  // North end tower and the stair/lift tower with the gold sail crown.
  endTower(b, f, layout, detail);
  stairTower(b, f, layout, detail);

  const surfaces: LandmarkSurface[] = [
    prismSurface(worldPolygon(f, layout.podiumRing), base, base + layout.podiumTopY),
    prismSurface(worldPolygon(f, [
      [slab.x0, slab.z0], [slab.x1, slab.z0], [slab.x1, slab.z1], [slab.x0, slab.z1],
    ]), base, base + slab.topY),
    prismSurface(worldPolygon(f, [
      [layout.endTower.x0, layout.endTower.z0], [layout.endTower.x1, layout.endTower.z0],
      [layout.endTower.x1, layout.endTower.z1], [layout.endTower.x0, layout.endTower.z1],
    ]), base, base + layout.endTower.topY),
    prismSurface(worldPolygon(f, [
      [layout.stairTower.x0, layout.stairTower.z0], [layout.stairTower.x1, layout.stairTower.z0],
      [layout.stairTower.x1, layout.stairTower.z1], [layout.stairTower.x0, layout.stairTower.z1],
    ]), base, base + layout.stairTower.topY),
  ];

  return buildResult([b.finish('textured')], surfaces);
}

/** Parametric hero model of Hotel «Фрегат», replacing OSM way 116810729. */
export function createFrehat(bbox: Bbox): Landmark {
  const layout = resolveFrehatLayout(bbox);
  const [lat, lon] = toLatLon(bbox, layout.anchor[0], layout.anchor[1]);
  return {
    id: 'hero:frehat',
    name: 'Готель «Фрегат»',
    anchor: { lat, lon, x: layout.anchor[0], z: layout.anchor[1] },
    footprint: layout.ring,
    vegetationExclusions: [layout.ring],
    replaces: [{ type: 'way', id: 116810729 }],
    // Ground under the ring is the model's datum; the centroid probe is the cheap readiness test.
    ready: (ctx) => ctx.groundAt(layout.anchor[0], layout.anchor[1]) !== null,
    build: (ctx) => buildFrehat(layout, ctx),
  };
}

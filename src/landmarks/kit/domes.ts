/**
 * Domes, drums, bell towers, clocks and fortress gates.
 *
 * Curved pieces are lathes (rings of segments around a vertical axis). Dome bases are omitted because they sit on a
 * drum or a roof; a drum is a closed shell (side plus top and bottom caps) unless the caller omits a cap to join it
 * to a dome. Drum windows are shallow surface panels rather than real recesses, so the drum shell stays closed.
 */
import type { Color } from '../shapes.ts';
import { detailSegments, emitBox, frameAt, type Detail, type Frame, type KitBuilder, type Vec3 } from './builder.ts';
import { addOpening, type Opening } from './openings.ts';
import { wallWithOpenings } from './walls.ts';

const GLASS: Color = [0.16, 0.22, 0.28];
const STONE: Color = [0.9, 0.88, 0.83];

/**
 * Lathe from bottom to top rings ([radius, y] frame-local, y absolute). Side faces are outward; caps are fans that
 * reuse the same rim rings, so a fully capped lathe has no open edges. A zero-radius top becomes an apex.
 */
function lathe(
  b: KitBuilder, f: Frame, cx: number, cz: number, rings: readonly (readonly [number, number])[],
  segments: number, colour: Color, pbr: number, bottomCap: boolean, topCap: boolean,
): void {
  if (rings.length < 2 || segments < 3) return;
  const pts = rings.map(([r, y]) => {
    const ring: Vec3[] = [];
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      ring.push(f.toWorld(cx + Math.cos(a) * r, y, cz + Math.sin(a) * r));
    }
    return ring;
  });
  for (let s = 0; s + 1 < rings.length; s++) {
    const a = pts[s]!, c = pts[s + 1]!;
    const lowerR = rings[s]![0], upperR = rings[s + 1]![0];
    if (upperR <= 1e-6) {
      const apex = f.toWorld(cx, rings[s + 1]![1], cz);
      for (let i = 0; i < segments; i++) {
        const j = (i + 1) % segments;
        b.tri(a[i]!, apex, a[j]!, undefined, undefined, colour, pbr);
      }
      continue;
    }
    if (lowerR <= 1e-6) continue;
    for (let i = 0; i < segments; i++) {
      const j = (i + 1) % segments;
      b.quad(a[i]!, c[i]!, c[j]!, a[j]!, undefined, undefined, colour, pbr);
    }
  }
  if (bottomCap && rings[0]![0] > 1e-6) {
    const centre = f.toWorld(cx, rings[0]![1], cz);
    for (let i = 0; i < segments; i++) {
      b.tri(centre, pts[0]![i]!, pts[0]![(i + 1) % segments]!, undefined, undefined, colour, pbr);
    }
  }
  const last = rings[rings.length - 1]!;
  if (topCap && last[0] > 1e-6) {
    const centre = f.toWorld(cx, last[1], cz);
    for (let i = 0; i < segments; i++) {
      b.tri(centre, pts[pts.length - 1]![(i + 1) % segments]!, pts[pts.length - 1]![i]!, undefined, undefined, colour, pbr);
    }
  }
}

export interface DrumSpec {
  cx: number;
  cz: number;
  y0: number;
  h: number;
  r: number;
  /** Windows around the drum; default 0. */
  windows?: number;
  windowShape?: 'rect' | 'arched';
  colour: Color;
  pbr?: number;
  detail?: Detail;
  bottom?: boolean;
  top?: boolean;
}

/** A cylindrical drum. Closed by default (both caps); pass `top: false` to join a dome of the same radius/segments. */
export function drum(b: KitBuilder, f: Frame, spec: DrumSpec): void {
  if (!(spec.h > 0) || spec.r <= 0) return;
  const pbr = spec.pbr ?? -1;
  const detail = spec.detail ?? 'near';
  const segments = Math.max(6, detailSegments(24, detail));
  lathe(b, f, spec.cx, spec.cz, [[spec.r, spec.y0], [spec.r, spec.y0 + spec.h]], segments,
    spec.colour, pbr, spec.bottom !== false, spec.top !== false);
  const count = Math.max(0, Math.round(spec.windows ?? 0));
  if (count === 0) return;
  const ww = Math.min(0.9, ((Math.PI * 2 * spec.r) / count) * 0.48);
  const wh = spec.h * 0.55;
  const winSegments = Math.max(2, detailSegments(6, detail));
  for (let i = 0; i < count; i++) {
    const a = ((i + 0.5) / count) * Math.PI * 2;
    const g = frameAt(f, spec.cx + Math.cos(a) * (spec.r + 0.015), spec.y0 + spec.h * 0.12,
      spec.cz + Math.sin(a) * (spec.r + 0.015), Math.PI / 2 - a);
    const glass = GLASS;
    const z = 0.02;
    b.quad(g.toWorld(-ww / 2, 0, z), g.toWorld(ww / 2, 0, z), g.toWorld(ww / 2, wh, z), g.toWorld(-ww / 2, wh, z),
      undefined, undefined, glass, -1);
    if (spec.windowShape === 'arched') {
      const r = ww / 2;
      for (let k = 0; k < winSegments; k++) {
        const xa = -r + (ww * k) / winSegments, xb = -r + (ww * (k + 1)) / winSegments;
        const ta = Math.sqrt(Math.max(0, r * r - xa * xa)), tb = Math.sqrt(Math.max(0, r * r - xb * xb));
        b.quad(g.toWorld(xa, wh, z), g.toWorld(xb, wh, z), g.toWorld(xb, wh + tb, z), g.toWorld(xa, wh + ta, z),
          undefined, undefined, glass, -1);
        // Stone arch band above the glass.
        b.quad(g.toWorld(xa, wh + ta, z + 0.02), g.toWorld(xb, wh + tb, z + 0.02),
          g.toWorld(xb, wh + tb + 0.07, z + 0.02), g.toWorld(xa, wh + ta + 0.07, z + 0.02),
          undefined, undefined, STONE, pbr);
      }
    } else {
      b.quad(g.toWorld(-ww / 2, wh, z + 0.02), g.toWorld(ww / 2, wh, z + 0.02),
        g.toWorld(ww / 2, wh + 0.09, z + 0.02), g.toWorld(-ww / 2, wh + 0.09, z + 0.02),
        undefined, undefined, STONE, pbr);
    }
    emitBox(b, g, -ww / 2 - 0.06, ww / 2 + 0.06, -0.07, 0.02, 0, 0.06, STONE, pbr);
  }
}

export type DomeProfile = 'hemi' | 'helmet' | 'onion' | 'spire';

export interface DomeSpec {
  cx: number;
  cz: number;
  y0: number;
  r: number;
  profile: DomeProfile;
  /** Segments around; default 32 at near detail. */
  segments?: number;
  /** Rings from base to apex; default 8 at near detail. */
  rings?: number;
  colour: Color;
  pbr?: number;
  detail?: Detail;
}

/** Height/radius control points of a dome profile, bottom to apex. */
function domeRings(profile: DomeProfile, r: number, rings: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < rings; i++) {
    const t = i / (rings - 1);
    if (profile === 'hemi') {
      out.push([r * Math.cos((t * Math.PI) / 2), r * Math.sin((t * Math.PI) / 2)]);
    } else if (profile === 'helmet') {
      out.push([r * Math.pow(1 - t, 0.75) * (1 + 0.12 * Math.sin(Math.PI * t)), 1.55 * r * t]);
    } else if (profile === 'onion') {
      out.push([r * Math.pow(1 - t, 0.85) * (1 + 0.22 * Math.sin(Math.PI * Math.min(1, t * 1.8))), 1.5 * r * t]);
    } else {
      out.push([r * (1 - t), 3 * r * t]);
    }
  }
  return out;
}

/** A lathe dome. The base face is omitted (it sits on the drum/roof), and the apex closes the shell. */
export function dome(b: KitBuilder, f: Frame, spec: DomeSpec): void {
  if (spec.r <= 0) return;
  const detail = spec.detail ?? 'near';
  const segments = Math.max(6, detailSegments(spec.segments ?? 32, detail));
  const rings = Math.max(3, detailSegments(spec.rings ?? 8, detail));
  const profile = domeRings(spec.profile, spec.r, rings).map(([r, y]) => [r, spec.y0 + y] as [number, number]);
  lathe(b, f, spec.cx, spec.cz, profile, segments, spec.colour, spec.pbr ?? -1, false, false);
}

export interface LanternSpec {
  cx: number;
  cz: number;
  y0: number;
  r: number;
  h: number;
  colour: Color;
  pbr?: number;
  detail?: Detail;
}

/** A small glazed turret: a closed cylindrical stage with a hemi cap and finial. */
export function lantern(b: KitBuilder, f: Frame, spec: LanternSpec): void {
  if (!(spec.h > 0) || spec.r <= 0) return;
  const detail = spec.detail ?? 'near';
  const sides = Math.max(6, detailSegments(12, detail));
  const pbr = spec.pbr ?? -1;
  lathe(b, f, spec.cx, spec.cz, [[spec.r, spec.y0], [spec.r * 0.92, spec.y0 + spec.h]], sides, spec.colour, pbr, true, true);
  const capRings = 5;
  const cap: [number, number][] = [];
  for (let i = 0; i < capRings; i++) {
    const t = i / (capRings - 1);
    cap.push([spec.r * 0.92 * Math.cos((t * Math.PI) / 2), spec.y0 + spec.h + spec.r * 0.9 * Math.sin((t * Math.PI) / 2)]);
  }
  lathe(b, f, spec.cx, spec.cz, cap, sides, spec.colour, pbr, false, false);
  lathe(b, f, spec.cx, spec.cz, [[spec.r * 0.1, spec.y0 + spec.h + spec.r * 0.9], [0.01, spec.y0 + spec.h + spec.r * 1.25]],
    Math.max(3, sides), spec.colour, pbr, false, false);
}

export interface CrossSpec {
  x: number;
  y: number;
  z?: number;
  h: number;
  /** Bar thickness; default 0.09 × h. */
  barW?: number;
  colour: Color;
  pbr?: number;
}

/** A rotated rectangular bar in the frame's x/y plane, closed on all six faces. */
function slantedBar(
  b: KitBuilder, f: Frame, cx: number, cy: number, w: number, h: number, angle: number,
  z0: number, z1: number, colour: Color, pbr: number,
): void {
  const c = Math.cos(angle), s = Math.sin(angle);
  const corners = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]] as const;
  const wpt = (i: number, z: number) => f.toWorld(
    cx + corners[i]![0] * c - corners[i]![1] * s, cy + corners[i]![0] * s + corners[i]![1] * c, z);
  b.quad(wpt(0, z1), wpt(1, z1), wpt(2, z1), wpt(3, z1), undefined, undefined, colour, pbr);
  b.quad(wpt(1, z0), wpt(0, z0), wpt(3, z0), wpt(2, z0), undefined, undefined, colour, pbr);
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    b.quad(wpt(i, z0), wpt(j, z0), wpt(j, z1), wpt(i, z1), undefined, undefined, colour, pbr);
  }
}

/** An Orthodox 8-point cross: vertical shaft, two crossbars and a slanted foot bar, all boxes. */
export function cross(b: KitBuilder, f: Frame, spec: CrossSpec): void {
  const { x, y, h, colour } = spec;
  if (!(h > 0)) return;
  const pbr = spec.pbr ?? -1;
  const z = spec.z ?? 0;
  const t = spec.barW ?? h * 0.09;
  const depth = t * 0.8;
  emitBox(b, f, x - t / 2, x + t / 2, y, y + h, z - depth / 2, z + depth / 2, colour, pbr);
  emitBox(b, f, x - h * 0.18, x + h * 0.18, y + h * 0.79, y + h * 0.79 + t, z - depth / 2, z + depth / 2, colour, pbr);
  emitBox(b, f, x - h * 0.32, x + h * 0.32, y + h * 0.61, y + h * 0.61 + t, z - depth / 2, z + depth / 2, colour, pbr);
  slantedBar(b, f, x, y + h * 0.24, h * 0.42, t, 0.32, z - depth / 2, z + depth / 2, colour, pbr);
}

export interface BelfryStageSpec {
  cx: number;
  cz: number;
  y0: number;
  w: number;
  h: number;
  /** Arched openings per side; default 1. */
  archesPerSide?: number;
  wallThickness?: number;
  colour: Color;
  pbr?: number;
  detail?: Detail;
}

/**
 * One open belfry stage: four walls with arched passages. Walls are 0.4 m thick; the arch lining and a dark recess
 * (standing in for the passage) come from `addOpening`, so no glass is visible at a distance.
 */
export function belfryStage(b: KitBuilder, f: Frame, spec: BelfryStageSpec): void {
  const { cx, cz, y0, w, h, colour } = spec;
  if (!(w > 0) || !(h > 0)) return;
  const detail = spec.detail ?? 'near';
  const pbr = spec.pbr ?? -1;
  const thickness = Math.max(0.1, spec.wallThickness ?? 0.4);
  const perSide = Math.max(1, Math.round(spec.archesPerSide ?? 1));
  const aw = Math.min((w / (perSide + 1)) * 0.62, h * 0.5);
  const rectH = h * 0.55;
  const sillY = h * 0.12;
  const sides = [
    frameAt(f, cx, y0, cz + w / 2, 0),
    frameAt(f, cx, y0, cz - w / 2, Math.PI),
    frameAt(f, cx + w / 2, y0, cz, Math.PI / 2),
    frameAt(f, cx - w / 2, y0, cz, -Math.PI / 2),
  ];
  for (const side of sides) {
    const openings: Opening[] = [];
    for (let i = 0; i < perSide; i++) {
      const x = -w / 2 + (w * (i + 1)) / (perSide + 1) - aw / 2;
      openings.push({ x, y: sillY, w: aw, h: rectH, shape: 'arched', depth: thickness, sill: false, surround: 'band' });
    }
    wallWithOpenings(b, side, {
      x0: -w / 2, x1: w / 2, y0: 0, y1: h, thickness, colour, pbr, detail,
      openings: openings.map((o) => ({ x: o.x, y: o.y, w: o.w, h: o.h, shape: o.shape })),
    });
    for (const o of openings) {
      addOpening(b, side, { ...o, surround: 'band' }, { reveal: colour, surround: colour, glass: [0.05, 0.05, 0.06], pbr }, detail);
    }
  }
}

export interface ClockFaceSpec {
  /** Centre in frame x/y. */
  x: number;
  y: number;
  r: number;
  colour: Color;
  handColour?: Color;
  pbr?: number;
  detail?: Detail;
}

/** A clock face on the wall plane: disc, 12 hour marks and two hands (fixed at 10:10), all thin geometry. */
export function clockFace(b: KitBuilder, f: Frame, spec: ClockFaceSpec): void {
  if (spec.r <= 0) return;
  const pbr = spec.pbr ?? -1;
  const hand = spec.handColour ?? [0.1, 0.1, 0.1];
  const segments = Math.max(8, detailSegments(24, spec.detail ?? 'near'));
  const { x, y, r } = spec;
  const centre = f.toWorld(x, y, 0);
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2, a1 = ((i + 1) / segments) * Math.PI * 2;
    b.tri(centre, f.toWorld(x + Math.cos(a0) * r, y + Math.sin(a0) * r, 0),
      f.toWorld(x + Math.cos(a1) * r, y + Math.sin(a1) * r, 0), [0, 0, 1], undefined, spec.colour, pbr);
  }
  const quad = (p0: [number, number], p1: [number, number], p2: [number, number], p3: [number, number], z: number, colour: Color): void => {
    b.quad(f.toWorld(p0[0], p0[1], z), f.toWorld(p1[0], p1[1], z), f.toWorld(p2[0], p2[1], z),
      f.toWorld(p3[0], p3[1], z), [0, 0, 1], undefined, colour, -1);
  };
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    const ux = Math.cos(a), uy = Math.sin(a), tx = -uy, ty = ux;
    const r0 = r * 0.72, r1 = r * 0.9, hw = r * 0.035;
    quad(
      [x + ux * r0 + tx * hw, y + uy * r0 + ty * hw],
      [x + ux * r0 - tx * hw, y + uy * r0 - ty * hw],
      [x + ux * r1 - tx * hw, y + uy * r1 - ty * hw],
      [x + ux * r1 + tx * hw, y + uy * r1 + ty * hw], 0.005, hand,
    );
  }
  const handQuad = (angle: number, len: number, hw: number): void => {
    const ux = Math.cos(angle), uy = Math.sin(angle), tx = -uy, ty = ux;
    quad(
      [x + ux * r * 0.05 + tx * hw, y + uy * r * 0.05 + ty * hw],
      [x + ux * r * 0.05 - tx * hw, y + uy * r * 0.05 - ty * hw],
      [x + ux * len - tx * hw, y + uy * len - ty * hw],
      [x + ux * len + tx * hw, y + uy * len + ty * hw], 0.007, hand,
    );
  };
  handQuad(((10 + 10 / 60) / 12) * Math.PI * 2, r * 0.52, r * 0.025);
  handQuad((10 / 60) * Math.PI * 2, r * 0.78, r * 0.018);
}

export interface ArchGateSpec {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** Total height of the arched passage above y0 (crown height). */
  archH: number;
  /** Passage width; default 55 % of x0..x1. */
  archW?: number;
  depth: number;
  colour: Color;
  pbr?: number;
  detail?: Detail;
}

/**
 * A fortress gate wall with one arched passage through its full depth: pierced wall, lined passage and dark recess,
 * plus side buttresses and a coping slab. The passage itself is open geometry (collision is the hero's job).
 */
export function archGate(b: KitBuilder, f: Frame, spec: ArchGateSpec): void {
  const { x0, x1, y0, y1, colour } = spec;
  if (!(x1 > x0) || !(y1 > y0)) return;
  const pbr = spec.pbr ?? -1;
  const detail = spec.detail ?? 'near';
  const depth = Math.max(0.2, spec.depth);
  const archW = Math.max(0.5, Math.min(x1 - x0 - 0.5, spec.archW ?? (x1 - x0) * 0.55));
  const archH = Math.max(archW / 2 + 0.1, Math.min(y1 - y0, spec.archH));
  const rectH = archH - archW / 2;
  const o: Opening = {
    x: (x0 + x1) / 2 - archW / 2, y: 0, w: archW, h: rectH, shape: 'arched', depth, sill: false, surround: 'none',
  };
  wallWithOpenings(b, f, {
    x0, x1, y0, y1, thickness: depth, colour, pbr, detail,
    openings: [{ x: o.x, y: y0 + o.y, w: o.w, h: o.h, shape: o.shape, detail }],
  });
  addOpening(b, f, { ...o, y: y0 }, { reveal: colour, surround: colour, glass: [0.04, 0.045, 0.05], pbr }, detail);
  const pier = Math.min(1.1, (x1 - x0) * 0.12);
  emitBox(b, f, x0, x0 + pier, y0, y1, 0, 0.3, colour, pbr);
  emitBox(b, f, x1 - pier, x1, y0, y1, 0, 0.3, colour, pbr);
  emitBox(b, f, x0 - 0.1, x1 + 0.1, y1, y1 + 0.25, -0.1, 0.4, colour, pbr);
}

/**
 * Openings: recessed windows and doors with reveals, sills, surrounds and glazing bars.
 *
 * `addOpening` draws the lining and glass of a hole that `wallWithOpenings` has already cut; calling it on a solid
 * wall gives a blind (applied) window, which is the same thing at a distance. All coordinates are frame-local:
 * x runs along the facade, y up, z outward; the wall plane is z = 0 and glass sits at z = -depth.
 */
import type { Color } from '../shapes.ts';
import { emitBox, type Detail, type Frame, type KitBuilder } from './builder.ts';

export type OpeningShape = 'rect' | 'arched' | 'segmental';

export interface Opening {
  /** Left edge in frame x. */
  x: number;
  /** Sill height (bottom of the rectangular part). */
  y: number;
  w: number;
  /** Height of the rectangular part; the arch rises above it. */
  h: number;
  shape: OpeningShape;
  /** Recess depth in metres; glass is at z = -depth. */
  depth: number;
  /** Projecting stone sill; default true when the opening is above ground. */
  sill?: boolean;
  surround?: 'none' | 'band' | 'keystone' | 'pediment' | 'arch_moulding';
  frame?: { colour: Color; bars: 'cross' | 'none' };
  /** Overrides the detail-derived arch segment count. */
  segments?: number;
}

/** Colours for one opening. `pbr` applies to stone, `trimPbr` to surrounds (default: the same). */
export interface OpeningColours {
  reveal?: Color;
  surround?: Color;
  sill?: Color;
  glass?: Color;
  frame?: Color;
  pbr?: number;
  trimPbr?: number;
}

const REVEAL: Color = [0.78, 0.75, 0.7];
const TRIM: Color = [0.93, 0.91, 0.86];
const GLASS: Color = [0.16, 0.22, 0.28];
const FRAME: Color = [0.95, 0.94, 0.9];
const STONE: Color = [0.72, 0.7, 0.65];
const LEAF: Color = [0.3, 0.2, 0.14];

/** Rise of the curved top above the rectangular top: a semicircle for `arched`, a 0.18·w segment for `segmental`. */
export function openingRise(o: { w: number; shape: OpeningShape }): number {
  if (o.shape === 'arched') return o.w / 2;
  if (o.shape === 'segmental') return o.w * 0.18;
  return 0;
}

/** Height of the opening outline at frame x (the rectangular top for `rect`, the curve above it otherwise). */
export function openingTop(o: { x: number; y: number; w: number; h: number; shape: OpeningShape }, x: number): number {
  const rectTop = o.y + o.h;
  if (o.shape === 'rect') return rectTop;
  const r = o.w / 2;
  const dx = Math.max(-r, Math.min(r, x - (o.x + r)));
  if (o.shape === 'arched') return rectTop + Math.sqrt(Math.max(0, r * r - dx * dx));
  const rise = openingRise(o);
  const radius = (r * r + rise * rise) / (2 * rise);
  return rectTop + rise - radius + Math.sqrt(Math.max(0, radius * radius - dx * dx));
}

/** Small solid with the back face omitted: bands and mouldings sit on the wall, so their back is never seen. */
function plate(
  b: KitBuilder, f: Frame, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number,
  colour: Color, pbr: number,
): void {
  emitBox(b, f, x0, x1, y0, y1, z0, z1, colour, pbr, { back: false });
}

/** Recessed lining: two jambs, the bottom reveal and (for arched shapes) the curved intrados. */
function reveals(
  b: KitBuilder, f: Frame, o: Opening, springing: number, colour: Color, pbr: number, segments: number,
): void {
  const { x, y, w, depth } = o;
  const d = -Math.max(0, depth);
  // Left jamb faces +x, right jamb faces -x: both into the opening.
  b.quad(f.toWorld(x, y, 0), f.toWorld(x, y, d), f.toWorld(x, springing, d), f.toWorld(x, springing, 0),
    undefined, undefined, colour, pbr);
  b.quad(f.toWorld(x + w, y, d), f.toWorld(x + w, y, 0), f.toWorld(x + w, springing, 0), f.toWorld(x + w, springing, d),
    undefined, undefined, colour, pbr);
  // The bottom of the reveal, facing up into the opening.
  b.quad(f.toWorld(x, y, d), f.toWorld(x, y, 0), f.toWorld(x + w, y, 0), f.toWorld(x + w, y, d),
    undefined, undefined, colour, pbr);
  if (o.shape === 'rect') return;
  for (let i = 0; i < segments; i++) {
    const xa = x + (w * i) / segments, xb = x + (w * (i + 1)) / segments;
    const ta = openingTop(o, xa), tb = openingTop(o, xb);
    b.quad(f.toWorld(xa, ta, 0), f.toWorld(xa, ta, d), f.toWorld(xb, tb, d), f.toWorld(xb, tb, 0),
      undefined, undefined, colour, pbr);
  }
}

/** Recessed glass at z = -depth, filling the rectangular part and the curved head. */
function glazing(
  b: KitBuilder, f: Frame, o: Opening, springing: number, colour: Color, segments: number,
): void {
  const { x, w, y, depth } = o;
  const z = -Math.max(0, depth);
  b.quad(f.toWorld(x, y, z), f.toWorld(x + w, y, z), f.toWorld(x + w, springing, z), f.toWorld(x, springing, z),
    undefined, undefined, colour, -1);
  if (o.shape === 'rect') return;
  for (let i = 0; i < segments; i++) {
    const xa = x + (w * i) / segments, xb = x + (w * (i + 1)) / segments;
    b.quad(f.toWorld(xa, springing, z), f.toWorld(xb, springing, z),
      f.toWorld(xb, openingTop(o, xb), z), f.toWorld(xa, openingTop(o, xa), z), undefined, undefined, colour, -1);
  }
}

/** Curved raised band following the head of an arched or segmental opening. */
function archBand(
  b: KitBuilder, f: Frame, o: Opening, springing: number, width: number, lift: number,
  colour: Color, pbr: number, segments: number,
): void {
  const { x, w } = o;
  const cx = x + w / 2;
  if (o.shape === 'arched') {
    const r = w / 2, ro = r + width;
    for (let i = 0; i < segments; i++) {
      const t0 = Math.PI * (1 - i / segments), t1 = Math.PI * (1 - (i + 1) / segments);
      const i0 = [cx + r * Math.cos(t0), springing + r * Math.sin(t0)] as const;
      const i1 = [cx + r * Math.cos(t1), springing + r * Math.sin(t1)] as const;
      const o1 = [cx + ro * Math.cos(t1), springing + ro * Math.sin(t1)] as const;
      const o0 = [cx + ro * Math.cos(t0), springing + ro * Math.sin(t0)] as const;
      b.quad(f.toWorld(i0[0], i0[1], lift), f.toWorld(i1[0], i1[1], lift),
        f.toWorld(o1[0], o1[1], lift), f.toWorld(o0[0], o0[1], lift), undefined, undefined, colour, pbr);
    }
    return;
  }
  for (let i = 0; i < segments; i++) {
    const xa = x + (w * i) / segments, xb = x + (w * (i + 1)) / segments;
    const ta = openingTop(o, xa), tb = openingTop(o, xb);
    b.quad(f.toWorld(xa, ta, lift), f.toWorld(xb, tb, lift),
      f.toWorld(xb, tb + width, lift), f.toWorld(xa, ta + width, lift), undefined, undefined, colour, pbr);
  }
}

/** A diamond-ish keystone centred on the head of the opening. */
function keystone(b: KitBuilder, f: Frame, o: Opening, top: number, colour: Color, pbr: number): void {
  const cx = o.x + o.w / 2;
  const hw = Math.min(0.12, o.w * 0.14);
  const bottom = top - 0.02;
  b.quad(f.toWorld(cx - hw, bottom, 0.07), f.toWorld(cx + hw, bottom, 0.07),
    f.toWorld(cx + hw * 1.45, top + 0.3, 0.07), f.toWorld(cx - hw * 1.45, top + 0.3, 0.07),
    undefined, undefined, colour, pbr);
  b.quad(f.toWorld(cx - hw, bottom, 0), f.toWorld(cx - hw, bottom, 0.07),
    f.toWorld(cx - hw * 1.45, top + 0.3, 0.07), f.toWorld(cx - hw * 1.45, top + 0.3, 0),
    undefined, undefined, colour, pbr);
  b.quad(f.toWorld(cx + hw, bottom, 0.07), f.toWorld(cx + hw, bottom, 0),
    f.toWorld(cx + hw * 1.45, top + 0.3, 0), f.toWorld(cx + hw * 1.45, top + 0.3, 0.07),
    undefined, undefined, colour, pbr);
  b.quad(f.toWorld(cx - hw * 1.45, top + 0.3, 0.07), f.toWorld(cx + hw * 1.45, top + 0.3, 0.07),
    f.toWorld(cx + hw * 1.45, top + 0.3, 0), f.toWorld(cx - hw * 1.45, top + 0.3, 0),
    undefined, undefined, colour, pbr);
}

/** Raised surround: jamb bands, a sill band and a head band (straight for rect, curved for arches). */
function surround(
  b: KitBuilder, f: Frame, o: Opening, springing: number, kind: NonNullable<Opening['surround']>,
  colour: Color, pbr: number, segments: number,
): void {
  if (kind === 'none') return;
  const bw = 0.12, lift = 0.04;
  const top = kind === 'pediment' ? openingTop(o, o.x + o.w / 2) : springing;
  plate(b, f, o.x - bw, o.x, o.y - bw, springing, 0, lift, colour, pbr);
  plate(b, f, o.x + o.w, o.x + o.w + bw, o.y - bw, springing, 0, lift, colour, pbr);
  plate(b, f, o.x - bw, o.x + o.w + bw, o.y - bw, o.y, 0, lift, colour, pbr);
  if (o.shape === 'rect') {
    plate(b, f, o.x - bw, o.x + o.w + bw, springing, springing + bw, 0, lift, colour, pbr);
  } else {
    archBand(b, f, o, springing, bw, lift, colour, pbr, segments);
  }
  if (kind === 'keystone') keystone(b, f, o, openingTop(o, o.x + o.w / 2), colour, pbr);
  if (kind === 'pediment') {
    const baseY = top + (o.shape === 'rect' ? bw : 0);
    const apexY = baseY + Math.min(0.7, o.w * 0.4);
    const lx = o.x - bw, rx = o.x + o.w + bw, cx = (lx + rx) / 2;
    b.tri(f.toWorld(lx, baseY, 0.06), f.toWorld(rx, baseY, 0.06), f.toWorld(cx, apexY, 0.06),
      undefined, undefined, colour, pbr);
    b.quad(f.toWorld(lx, baseY, 0), f.toWorld(lx, baseY, 0.06), f.toWorld(cx, apexY, 0.06), f.toWorld(cx, apexY, 0),
      undefined, undefined, colour, pbr);
    b.quad(f.toWorld(cx, apexY, 0), f.toWorld(cx, apexY, 0.06), f.toWorld(rx, baseY, 0.06), f.toWorld(rx, baseY, 0),
      undefined, undefined, colour, pbr);
  }
}

/**
 * Adds one window: reveals, recessed glass, sill, raised surround and optional glazing bars. Faces omitted where
 * hidden: the back of every surround band and the underside of the sill are not emitted (they sit on the wall/ground).
 */
export function addOpening(
  b: KitBuilder, f: Frame, o: Opening, colours: OpeningColours = {}, detail: Detail = 'near',
): void {
  if (o.w <= 0 || o.h <= 0) return;
  // Openings use 8 arch segments near and 4 far, the count the kit's openings were specified with.
  const segments = Math.max(2, Math.round(o.segments ?? (detail === 'far' ? 4 : 8)));
  const pbr = colours.pbr ?? -1;
  const trimPbr = colours.trimPbr ?? pbr;
  const reveal = colours.reveal ?? REVEAL;
  const trim = colours.surround ?? TRIM;
  const springing = o.y + o.h;
  reveals(b, f, o, springing, reveal, pbr, segments);
  glazing(b, f, o, springing, colours.glass ?? GLASS, segments);
  if (o.sill !== false && o.y > 0) {
    emitBox(b, f, o.x - 0.08, o.x + o.w + 0.08, o.y - 0.07, o.y + 0.03, 0, 0.07,
      colours.sill ?? trim, trimPbr);
  }
  if (o.surround && o.surround !== 'none') {
    surround(b, f, o, springing, o.surround, trim, trimPbr, segments);
  }
  if (o.frame && o.frame.bars === 'cross') {
    const bar = o.frame.colour ?? FRAME;
    const z0 = -Math.max(0, o.depth) + 0.02, z1 = z0 + 0.04;
    const cx = o.x + o.w / 2;
    emitBox(b, f, cx - 0.03, cx + 0.03, o.y, openingTop(o, cx), z0, z1, bar, -1);
    emitBox(b, f, o.x, o.x + o.w, o.y + o.h * 0.5 - 0.03, o.y + o.h * 0.5 + 0.03, z0, z1, bar, -1);
  }
}

export interface DoorwaySpec {
  x: number;
  /** Door threshold height; steps are built below it. */
  y0: number;
  w: number;
  h: number;
  depth?: number;
  /** Semicircular glazed fanlight above the leaf. */
  fanlight?: boolean;
  /** Steps in front of the door, 0 for none. */
  steps?: number;
  colour?: Color;
  frame?: Color;
  pbr?: number;
  trimPbr?: number;
  detail?: Detail;
}

/**
 * A doorway: recessed door leaf, stone jambs, an optional fanlight and stone steps in front. The wall hole is cut by
 * `wallWithOpenings`; the leaf's back face is not emitted because it lies inside the wall.
 */
export function doorway(b: KitBuilder, f: Frame, spec: DoorwaySpec): void {
  const depth = Math.max(0.05, spec.depth ?? 0.25);
  const segments = Math.max(2, (spec.detail ?? 'near') === 'far' ? 4 : 8);
  const pbr = spec.pbr ?? -1;
  const trim = spec.frame ?? TRIM;
  const trimPbr = spec.trimPbr ?? pbr;
  const { x, y0, w, h } = spec;
  const z = -depth;
  // Leaf and its shallow frame, recessed into the wall.
  emitBox(b, f, x, x + w, y0, y0 + h, z - 0.06, z, spec.colour ?? LEAF, pbr, { back: false });
  b.quad(f.toWorld(x, y0, 0), f.toWorld(x, y0, z), f.toWorld(x, y0 + h, z), f.toWorld(x, y0 + h, 0),
    undefined, undefined, trim, trimPbr);
  b.quad(f.toWorld(x + w, y0, z), f.toWorld(x + w, y0, 0), f.toWorld(x + w, y0 + h, 0), f.toWorld(x + w, y0 + h, z),
    undefined, undefined, trim, trimPbr);
  b.quad(f.toWorld(x, y0, z), f.toWorld(x, y0, 0), f.toWorld(x + w, y0, 0), f.toWorld(x + w, y0, z),
    undefined, undefined, trim, trimPbr);
  if (spec.fanlight) {
    const springing = y0 + h;
    b.quad(f.toWorld(x, y0 + h, z), f.toWorld(x + w, y0 + h, z), f.toWorld(x + w, springing, z), f.toWorld(x, springing, z),
      undefined, undefined, GLASS, -1);
    for (let i = 0; i < segments; i++) {
      const xa = x + (w * i) / segments, xb = x + (w * (i + 1)) / segments;
      const ta = springing + Math.sqrt(Math.max(0, (w / 2) ** 2 - (xa - (x + w / 2)) ** 2));
      const tb = springing + Math.sqrt(Math.max(0, (w / 2) ** 2 - (xb - (x + w / 2)) ** 2));
      b.quad(f.toWorld(xa, springing, z), f.toWorld(xb, springing, z), f.toWorld(xb, tb, z), f.toWorld(xa, ta, z),
        undefined, undefined, GLASS, -1);
      b.quad(f.toWorld(xa, ta, 0), f.toWorld(xa, ta, z), f.toWorld(xb, tb, z), f.toWorld(xb, tb, 0),
        undefined, undefined, trim, trimPbr);
    }
  }
  const steps = Math.max(0, Math.round(spec.steps ?? 0));
  for (let i = 0; i < steps; i++) {
    const top = y0 - i * 0.16;
    const out = (i + 1) * 0.34;
    emitBox(b, f, x - 0.25 - i * 0.08, x + w + 0.25 + i * 0.08, top - 0.16, top, 0, out, STONE, trimPbr);
  }
}

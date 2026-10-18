import { rgb, type LandmarkMeshBuilder } from './types.ts';
import { at, fbox, frameAt, hexa, ring, tube, tubePath, type Frame, type Vec } from './shapes.ts';

// Colours read off the 2008–2020 photos of the Ushakova embankment.
export const RAIL_BLUE = rgb(0x2f5fa8);
export const RAIL_WHITE = rgb(0xe2e5e6);
const IRON = rgb(0x1f2326);
const GLOBE = rgb(0xeadcb0);
const WOOD = rgb(0x8b5a33);
const KERB_WHITE = rgb(0xe6e4dc);
const SOIL = rgb(0x5b4636);
const LEAF = rgb(0x4f7f3a);
const LEAF_DARK = rgb(0x3c6a33);
const FLOWERS = [rgb(0xd0475a), rgb(0xe8c04a), rgb(0xf0eeea), rgb(0xc8508f)] as const;
const GRANITE = rgb(0x9a9890);
const GRANITE_ALT = rgb(0x8f8d86);
const GRANITE_DARK = rgb(0x6e706c);
const RELIEF = rgb(0x7d3a2b);
const RELIEF_DARK = rgb(0x5b2e22);
const BRONZE = rgb(0x46523f);
const BRONZE_DARK = rgb(0x333c30);
const HULL_WHITE = rgb(0xeef0f0);
const HULL_BLACK = rgb(0x2b2e33);
const TEAK = rgb(0xb89a6a);
const CANVAS_BLUE = rgb(0x2c5d9a);
const MAST = rgb(0xc9cdd0);
const CRANE_YELLOW = rgb(0xd9b437);
const CRANE_GREEN = rgb(0x3f8a5c);
const CRANE_GREY = rgb(0x7d8285);
const GLASS = rgb(0x2a3540);

/**
 * Black cast-iron lamp from the embankment photos: fluted base, slim pole with collars, a shepherd's-crook
 * top with a small scroll, and a bell cap over a frosted globe. The globe goes to `glow` (lit at night).
 * `dirX/dirZ` is where the crook reaches.
 */
export function addCrookLamp(b: LandmarkMeshBuilder, glow: LandmarkMeshBuilder, x: number, y: number, z: number, dirX: number, dirZ: number, quality: 'high' | 'low'): void {
  const f = frameAt(x, z, Math.atan2(dirZ, dirX));
  const s = quality === 'high' ? 8 : 6;
  const P = (a: number, h: number): Vec => at(f, a, 0, y + h);
  tube(b, P(0, 0), P(0, 0.14), 0.24, 0.22, IRON, s);
  tube(b, P(0, 0.14), P(0, 0.6), 0.15, 0.11, IRON, s);
  tube(b, P(0, 0.6), P(0, 4.1), 0.065, 0.055, IRON, s, false);
  for (const h of [0.62, 1.5, 2.9]) tube(b, P(0, h), P(0, h + 0.09), 0.095, 0.095, IRON, s, false);
  // crook: a half circle from the pole top over to the lantern hanger
  const r = 0.42, arc: Vec[] = [];
  const n = quality === 'high' ? 7 : 5;
  for (let i = 0; i <= n; i++) { const t = Math.PI - (i / n) * Math.PI; arc.push(P(r + Math.cos(t) * r, 4.1 + Math.sin(t) * r)); }
  tubePath(b, arc, 0.035, IRON, s);
  if (quality === 'high') {
    const scroll: Vec[] = [];
    for (let i = 0; i <= 8; i++) { const t = (i / 8) * Math.PI * 1.6 + Math.PI; const rr = 0.17 - i * 0.012; scroll.push(P(0.3 + Math.cos(t) * rr, 4.12 + Math.sin(t) * rr)); }
    tubePath(b, scroll, 0.022, IRON, 5);
  }
  const hx = 2 * r;
  tube(b, P(hx, 4.1), P(hx, 3.9), 0.025, 0.025, IRON, 5, false);
  tube(b, P(hx, 3.9), P(hx, 3.76), 0.06, 0.3, IRON, quality === 'high' ? 12 : 8); // bell cap
  tube(glow, P(hx, 3.74), P(hx, 3.4), 0.16, 0.17, GLOBE, quality === 'high' ? 10 : 8);
  tube(b, P(hx, 3.4), P(hx, 3.33), 0.07, 0.03, IRON, 6);
}

/** Railing post: a flat blue blade with a gentle S, bowing out at the knee and curling over the top rail. */
export function addRailPost(b: LandmarkMeshBuilder, f: Frame, a: number, y: number): void {
  // c > 0 is toward the land; the post leans out over the water and curls back at the top
  const seg = (h0: number, h1: number, o0: number, o1: number, d0: number, d1: number) => hexa(b,
    ring(f, a - 0.03, a + 0.03, o0 - d0, o0 + d0, y + h0), ring(f, a - 0.03, a + 0.03, o1 - d1, o1 + d1, y + h1), RAIL_BLUE);
  seg(0, 0.12, 0, 0, 0.13, 0.08);
  seg(0.12, 0.55, 0, -0.07, 0.08, 0.06);
  seg(0.55, 0.92, -0.07, 0, 0.06, 0.055);
  seg(0.92, 1.14, 0, 0.13, 0.055, 0.04);
}

/** The white tube rails of one railing run, from a0 to a1 in frame f. */
export function addRails(b: LandmarkMeshBuilder, f: Frame, a0: number, a1: number, y0: number, y1: number): void {
  for (const [h, c, t] of [[0.36, -0.035, 0.024], [0.68, -0.05, 0.024], [1.02, 0.06, 0.032]] as const) {
    tube(b, at(f, a0, c, y0 + h), at(f, a1, c, y1 + h), t, t, RAIL_WHITE, 6, false);
  }
}

/** Wooden-slat park bench with black cast-iron ends; the seat faces +c of a frame at (x, z). */
export function addParkBench(b: LandmarkMeshBuilder, f: Frame, y: number): void {
  for (const a of [-0.85, 0.85]) {
    fbox(b, f, a - 0.04, a + 0.04, -0.22, -0.16, y, y + 0.88, IRON);
    fbox(b, f, a - 0.04, a + 0.04, 0.16, 0.22, y, y + 0.44, IRON);
    fbox(b, f, a - 0.04, a + 0.04, -0.22, 0.24, y + 0.4, y + 0.44, IRON);
    fbox(b, f, a - 0.04, a + 0.04, -0.12, 0.26, y + 0.62, y + 0.66, IRON);
  }
  for (const c of [-0.14, 0.0, 0.14]) fbox(b, f, -1.0, 1.0, c - 0.055, c + 0.055, y + 0.44, y + 0.48, WOOD);
  for (const h of [0.58, 0.74]) hexa(b, ring(f, -1.0, 1.0, -0.23, -0.2, y + h), ring(f, -1.0, 1.0, -0.25, -0.22, y + h + 0.1), WOOD);
}

/** Rectangular bed with a white kerb, soil, shrubs and mixed flowers (the embankment's long planters). */
export function addFlowerBed(b: LandmarkMeshBuilder, f: Frame, len: number, wid: number, y: number, seed: number): void {
  const a = len / 2, c = wid / 2, k = 0.16;
  fbox(b, f, -a, a, -c, -c + k, y, y + 0.22, KERB_WHITE);
  fbox(b, f, -a, a, c - k, c, y, y + 0.22, KERB_WHITE);
  fbox(b, f, -a, -a + k, -c + k, c - k, y, y + 0.22, KERB_WHITE);
  fbox(b, f, a - k, a, -c + k, c - k, y, y + 0.22, KERB_WHITE);
  fbox(b, f, -a + k, a - k, -c + k, c - k, y, y + 0.14, SOIL, false);
  // low rose bushes in two staggered rows, each with a few blooms on top
  const n = Math.max(2, Math.round(len / 0.7));
  for (let i = 0; i < n; i++) {
    const p = -a + 0.4 + (i * (len - 0.8)) / Math.max(1, n - 1);
    const r = Math.abs((Math.sin((seed + i) * 12.9898) * 43758.5453) % 1);
    const h = 0.22 + r * 0.18, cc = (i % 2 ? 1 : -1) * (c - 0.45), w = 0.2 + r * 0.06;
    fbox(b, f, p - w, p + w, cc - w, cc + w, y + 0.14, y + 0.14 + h, i % 3 ? LEAF : LEAF_DARK, false);
    const fl = FLOWERS[(seed + i) % FLOWERS.length]!;
    fbox(b, f, p - 0.08, p + 0.04, cc - 0.1, cc + 0.02, y + 0.14 + h, y + 0.22 + h, fl, false);
    fbox(b, f, p + 0.02, p + 0.12, cc + 0.02, cc + 0.12, y + 0.1 + h, y + 0.18 + h, fl, false);
  }
}

/**
 * First Shipbuilders monument («Фрегат», 1972): a red-brown relief block facing the land, a tapering granite
 * pylon in stone courses rising behind it, and a bronze three-master on top. Frame: a along the pedestal's
 * long side, c > 0 toward the land; `len`/`wid` are the mapped pedestal size.
 */
export function addFrigateMonument(b: LandmarkMeshBuilder, f: Frame, len: number, wid: number, y: number): void {
  const L = len / 2, W = wid / 2;
  fbox(b, f, -L - 0.9, L + 0.9, -W - 0.9, W + 0.9, y, y + 0.16, GRANITE_DARK);
  fbox(b, f, -L - 0.45, L + 0.45, -W - 0.45, W + 0.45, y + 0.16, y + 0.32, GRANITE);
  const y0 = y + 0.32;
  // relief block across the land side
  fbox(b, f, -L, L, W - 1.3, W, y0, y0 + 2.6, RELIEF);
  fbox(b, f, -L - 0.05, L + 0.05, W - 1.35, W + 0.05, y0 + 2.6, y0 + 2.72, RELIEF_DARK);
  // figures: shipwrights hauling, carrying timber; the inscription panel at the right end
  for (let i = 0; i < 9; i++) {
    const a = -L + 0.5 + i * 0.62, h = 1.45 + ((i * 7) % 5) * 0.08;
    fbox(b, f, a - 0.17, a + 0.17, W, W + 0.09, y0 + 0.35, y0 + 0.35 + h, RELIEF_DARK, false);
    fbox(b, f, a - 0.1, a + 0.1, W, W + 0.11, y0 + 0.4 + h, y0 + 0.62 + h, RELIEF_DARK, false);
  }
  fbox(b, f, L - 1.5, L - 0.25, W, W + 0.04, y0 + 0.7, y0 + 2.0, RELIEF_DARK, false);
  // pylon: six stone courses tapering from 4.8 × 2.6 m to 3.2 × 1.9 m and leaning slightly toward +a
  const top = 8.6, courses = 6;
  const span = (t: number) => ({ a0: -2.4 + t * 1.15, a1: 2.4 - t * 0.45, c0: -W + 0.1 + t * 0.3, c1: W - 1.0 - t * 0.4 });
  for (let i = 0; i < courses; i++) {
    const t0 = i / courses, t1 = (i + 1) / courses, s0 = span(t0), s1 = span(t1);
    hexa(b, ring(f, s0.a0, s0.a1, s0.c0, s0.c1, y0 + top * t0), ring(f, s1.a0, s1.a1, s1.c0, s1.c1, y0 + top * t1), i % 2 ? GRANITE : GRANITE_ALT, i === 0);
  }
  const s = span(1), ty = y0 + top;
  fbox(b, f, s.a0 - 0.15, s.a1 + 0.15, s.c0 - 0.15, s.c1 + 0.15, ty, ty + 0.22, GRANITE_DARK);
  const cx = (s.a0 + s.a1) / 2, cc = (s.c0 + s.c1) / 2;
  addShip(b, frameAt(at(f, cx, cc, 0).x, at(f, cx, cc, 0).z, Math.atan2(f.uz, f.ux)), ty + 0.22);
}

/** Bronze three-master: hull with a raised stern castle, bowsprit, three masts of billowing sails and pennants. */
function addShip(b: LandmarkMeshBuilder, f: Frame, y: number): void {
  // hull bottom narrows to the keel; bow at +a
  hexa(b, ring(f, -2.6, 2.2, -0.45, 0.45, y), ring(f, -3.2, 3.0, -1.05, 1.05, y + 0.8), BRONZE_DARK);
  hexa(b, ring(f, -3.2, 3.0, -1.05, 1.05, y + 0.8), ring(f, -3.4, 3.5, -1.1, 1.1, y + 1.35), BRONZE);
  hexa(b, ring(f, 3.0, 3.5, -0.9, 0.9, y + 0.8), ring(f, 3.5, 4.1, -0.15, 0.15, y + 1.45), BRONZE);
  fbox(b, f, -3.4, -2.0, -1.0, 1.0, y + 1.35, y + 2.0, BRONZE);
  fbox(b, f, 2.4, 3.4, -0.9, 0.9, y + 1.35, y + 1.7, BRONZE);
  tube(b, at(f, 3.6, 0, y + 1.4), at(f, 5.6, 0, y + 2.4), 0.07, 0.04, BRONZE_DARK, 6);
  // jib: a slanted sail from the bowsprit to the foremast
  hexa(b, ring(f, 3.4, 5.2, -0.05, 0.05, y + 1.9), ring(f, 1.9, 2.2, -0.05, 0.05, y + 5.0), BRONZE);
  const masts: [number, number][] = [[1.7, 5.4], [-0.3, 6.1], [-2.3, 4.9]];
  for (const [a, h] of masts) {
    tube(b, at(f, a, 0, y + 1.3), at(f, a, 0, y + 1.3 + h), 0.08, 0.05, BRONZE_DARK, 6);
    const tiers = [[1.9, 1.3, 1.6], [3.3, 1.1, 1.35], [4.5, 0.85, 1.05]] as const;
    for (const [h0, hh, w] of tiers) {
      if (h0 + hh > h) continue;
      const sy = y + 1.3 + h0;
      // billowed sail: thin at the yard, deepest at mid-height, bowed toward +a (wind from astern)
      hexa(b, ring(f, a + 0.02, a + 0.2, -w, w, sy), ring(f, a + 0.3, a + 0.62, -w * 0.95, w * 0.95, sy + hh * 0.5), BRONZE);
      hexa(b, ring(f, a + 0.3, a + 0.62, -w * 0.95, w * 0.95, sy + hh * 0.5), ring(f, a, a + 0.12, -w * 0.88, w * 0.88, sy + hh), BRONZE);
      tube(b, at(f, a + 0.05, -w - 0.15, sy + hh), at(f, a + 0.05, w + 0.15, sy + hh), 0.035, 0.035, BRONZE_DARK, 5, false);
    }
    const ft = y + 1.3 + h;
    fbox(b, f, a - 0.95, a, -0.025, 0.025, ft - 0.42, ft - 0.12, BRONZE_DARK);
  }
}

/** Old ship's cannon on a wooden carriage, pointing along +a. */
export function addCannon(b: LandmarkMeshBuilder, f: Frame, y: number): void {
  fbox(b, f, -1.4, 1.4, -0.9, 0.9, y, y + 0.25, GRANITE);
  const cy = y + 0.25;
  fbox(b, f, -0.9, 0.5, -0.38, -0.24, cy + 0.2, cy + 0.62, IRON);
  fbox(b, f, -0.9, 0.5, 0.24, 0.38, cy + 0.2, cy + 0.62, IRON);
  for (const a of [-0.65, 0.3]) for (const c of [-0.46, 0.46]) tube(b, at(f, a, c - 0.06, cy + 0.27), at(f, a, c + 0.06, cy + 0.27), 0.27, 0.27, IRON, 10);
  tube(b, at(f, -1.0, 0, cy + 0.72), at(f, 1.5, 0, cy + 0.8), 0.2, 0.13, IRON, 10);
  tube(b, at(f, 1.4, 0, cy + 0.8), at(f, 1.55, 0, cy + 0.8), 0.16, 0.16, IRON, 10);
  tube(b, at(f, -1.15, 0, cy + 0.72), at(f, -1.0, 0, cy + 0.72), 0.1, 0.2, IRON, 10);
}

/** Moored sailing yacht (white or black hull) on the water, bow at +a; `y` is the water level. */
export function addYacht(b: LandmarkMeshBuilder, f: Frame, y: number, length: number, dark: boolean): void {
  const L = length / 2, B = length * 0.16;
  const hull = dark ? HULL_BLACK : HULL_WHITE;
  hexa(b, ring(f, -L * 0.85, L * 0.6, -B * 0.35, B * 0.35, y - 0.5), ring(f, -L, L * 0.7, -B, B, y + 0.9), hull);
  hexa(b, ring(f, L * 0.6, L * 0.62, -B * 0.3, B * 0.3, y - 0.45), ring(f, L * 0.7, L, -B * 0.25, B * 0.25, y + 0.95), hull);
  fbox(b, f, -L * 0.98, L * 0.7, -B * 0.95, B * 0.95, y + 0.9, y + 0.96, TEAK, false);
  fbox(b, f, -L * 0.3, L * 0.25, -B * 0.55, B * 0.55, y + 0.96, y + 1.45, HULL_WHITE);
  fbox(b, f, -L * 0.28, L * 0.23, -B * 0.56, B * 0.56, y + 1.15, y + 1.3, GLASS, false);
  fbox(b, f, -L * 0.85, -L * 0.45, -B * 0.7, B * 0.7, y + 1.6, y + 1.66, CANVAS_BLUE);
  for (const a of [-L * 0.85, -L * 0.45]) for (const c of [-B * 0.7, B * 0.7]) tube(b, at(f, a, c, y + 0.96), at(f, a, c, y + 1.6), 0.02, 0.02, MAST, 4, false);
  const mastA = L * 0.15, mh = length * 1.25;
  tube(b, at(f, mastA, 0, y + 0.96), at(f, mastA, 0, y + 0.96 + mh), 0.07, 0.045, MAST, 6);
  tube(b, at(f, mastA, 0, y + 2.1), at(f, -L * 0.8, 0, y + 2.2), 0.05, 0.05, MAST, 5, false);
  fbox(b, f, -L * 0.75, mastA - 0.05, -0.16, 0.16, y + 2.15, y + 2.45, CANVAS_BLUE);
  // stays to the bow and the stern
  tube(b, at(f, mastA, 0, y + 0.9 + mh), at(f, L * 0.98, 0, y + 1.0), 0.012, 0.012, MAST, 3, false);
  tube(b, at(f, mastA, 0, y + 0.9 + mh), at(f, -L * 0.98, 0, y + 1.0), 0.012, 0.012, MAST, 3, false);
  for (const c of [-B, B]) tube(b, at(f, mastA, 0, y + 0.8 + mh * 0.7), at(f, mastA - 0.2, c, y + 0.95), 0.01, 0.01, MAST, 3, false);
}

/** Level-luffing portal crane: yellow gantry over the quay rails, slewing house with cab, A-frame and a hooked jib. */
export function addPortalCrane(b: LandmarkMeshBuilder, f: Frame, y: number, slew: number, luff: number, green: boolean): void {
  for (const a of [-3.2, 3.2]) for (const c of [-3.2, 3.2]) {
    hexa(b, ring(f, a - 0.35, a + 0.35, c - 0.45, c + 0.45, y), ring(f, a * 0.75 - 0.3, a * 0.75 + 0.3, c * 0.6 - 0.3, c * 0.6 + 0.3, y + 7.6), CRANE_YELLOW);
    fbox(b, f, a - 0.6, a + 0.6, c - 0.6, c + 0.6, y, y + 0.5, CRANE_GREY);
  }
  fbox(b, f, -3.2, 3.2, -2.3, 2.3, y + 7.4, y + 8.3, CRANE_YELLOW);
  const p = at(f, 0, 0, 0);
  tube(b, { x: p.x, y: y + 8.3, z: p.z }, { x: p.x, y: y + 9.0, z: p.z }, 2.0, 2.0, CRANE_GREY, 12);
  const s = frameAt(p.x, p.z, Math.atan2(f.uz, f.ux) + slew);
  const hy = y + 9.0;
  fbox(b, s, -4.6, 1.0, -1.7, 1.7, hy, hy + 3.2, green ? CRANE_GREEN : CRANE_YELLOW);
  fbox(b, s, -4.65, 1.05, -1.75, 1.75, hy + 3.2, hy + 3.4, CRANE_GREY);
  fbox(b, s, 1.0, 2.4, 0.6, 1.8, hy + 1.2, hy + 3.4, green ? CRANE_GREEN : CRANE_YELLOW);
  fbox(b, s, 2.4, 2.45, 0.7, 1.7, hy + 2.2, hy + 3.2, GLASS, false);
  // A-frame
  for (const c of [-1.3, 1.3]) {
    tube(b, at(s, -3.8, c, hy + 3.4), at(s, -1.6, c * 0.3, hy + 13.5), 0.22, 0.18, CRANE_YELLOW, 6);
    tube(b, at(s, 0.6, c, hy + 3.4), at(s, -1.6, c * 0.3, hy + 13.5), 0.22, 0.18, CRANE_YELLOW, 6);
  }
  // boom from the house front, luffed by `luff` (radians above horizontal), then the jib reaching out and down
  const boomLen = 26;
  const tip = at(s, 0.8 + Math.cos(luff) * boomLen, 0, hy + 1.8 + Math.sin(luff) * boomLen);
  for (const c of [-0.55, 0.55]) tube(b, at(s, 0.8, c, hy + 1.8), at(s, 0.8 + Math.cos(luff) * boomLen, c * 0.4, hy + 1.8 + Math.sin(luff) * boomLen), 0.24, 0.16, CRANE_YELLOW, 6);
  const jibBack = at(s, 0.8 + Math.cos(luff) * boomLen - 5, 0, tip.y + 1.2);
  const jibTip = at(s, 0.8 + Math.cos(luff) * boomLen + 9, 0, tip.y - 2.5);
  tube(b, jibBack, jibTip, 0.3, 0.18, CRANE_YELLOW, 6);
  // lever with counterweight from the A-frame top to the jib tail, hoist rope and block
  const apex = at(s, -1.6, 0, hy + 13.5);
  tube(b, at(s, -6.5, 0, hy + 12.0), jibBack, 0.14, 0.14, CRANE_YELLOW, 5);
  fbox(b, s, -7.4, -5.6, -0.9, 0.9, hy + 10.6, hy + 12.2, CRANE_GREY);
  tube(b, apex, at(s, -6.5, 0, hy + 12.0), 0.12, 0.12, CRANE_YELLOW, 5, false);
  tube(b, jibTip, { x: jibTip.x, y: y + 12, z: jibTip.z }, 0.03, 0.03, IRON, 3, false);
  tube(b, { x: jibTip.x, y: y + 12, z: jibTip.z }, { x: jibTip.x, y: y + 11.3, z: jibTip.z }, 0.25, 0.18, IRON, 6);
}

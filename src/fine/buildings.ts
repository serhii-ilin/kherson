/**
 * Buildings as 1 m blocks (REALISM_PLAN Phase 3). Every building overlapping a block grid is
 * rasterised onto the GLOBAL 1 m grid and written into it, clipped.
 *
 * Chunk independence: every decision is a function of world coordinates and building data, never of
 * the grid, so the parts that two neighbouring chunks write for one building meet exactly:
 *  - the footprint mask is rasterised for the whole building (even-odd, column centres);
 *  - the base level is the lowest coarse ground sampled over the whole footprint;
 *  - facade bays are counted along the WORLD coordinate of the wall (x for walls facing +-z, z for
 *    +-x, or the dominant axis of the nearest polygon edge for staircased diagonals) with a phase
 *    taken from the building id hash;
 *  - rooftop boxes, balconies, shop fronts and entrances are hashes of (building id, world bay/cell).
 * Buildings are processed in id order in two global passes (all fills, then all facade details), so
 * overlapping or touching buildings resolve the same way in every chunk.
 *
 * Window layout (1 m blocks, "wall" = the building's style material, carved one block deep):
 *   outer block -> air, the block behind it -> GLASS (SHOPFRONT on shop fronts, DOOR at entrances).
 * The footprint is solid inside, so a carved opening always has a back wall.
 */
import { MAT } from '../world/materials.ts';
import { ROOF, type VBuilding } from '../world/vector-format.ts';
import { VOL_Y } from './volume.ts';

export interface PlacedBuilding {
  b: VBuilding;
  /** World metres of the vector tile's NW corner. */
  ox: number;
  oz: number;
}

export interface BuildingContext {
  /** Coarse ground top (m) at world x, z (any coordinates; callers clamp to what they know). */
  groundAt(x: number, z: number): number;
  /** Distance (m) to the nearest drivable road, for shop-front plausibility; omitted = always plausible. */
  roadDist?(x: number, z: number): number;
}

/** Anything with a world origin and a square block array of side `size`, height VOL_Y (a Volume or a window). */
export interface BlockGrid {
  readonly x0: number;
  readonly z0: number;
  readonly mats: Uint8Array;
}

/** Side (blocks) of a grid's square footprint. */
export function gridSize(g: BlockGrid): number {
  return Math.round(Math.sqrt(g.mats.length / VOL_Y));
}

// ---------------------------------------------------------------- hashing

function hash(a: number, b = 0, c = 0): number {
  let h = Math.imul(a | 0, 0x9e3779b1) ^ Math.imul((b | 0) + 0x7f4a7c15, 0x85ebca6b) ^ Math.imul((c | 0) + 0x165667b1, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return h >>> 0;
}

function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

// ---------------------------------------------------------------- styles

export interface Style {
  /** Floor height in blocks (0: one tall floor, as in churches). */
  floorH: number;
  /** Bay width in blocks (the window repeat). */
  bay: number;
  winW: number;
  winH: number;
  /** First window row above the floor level. */
  winOff: number;
  /** Plinth course material at the ground row, 0 = none. */
  plinth: number;
  cornice: boolean;
  sills: boolean;
  /** 1 balcony bay in N (0 = none). */
  balconies: number;
  shops: boolean;
  entrances: boolean;
  garage: boolean;
  pitched: boolean;
  church: boolean;
  ribbon: boolean;
}

function mk(o: Partial<Style> & Pick<Style, 'floorH' | 'bay' | 'winW' | 'winH'>): Style {
  return {
    winOff: 1, plinth: MAT.CONCRETE, cornice: false, sills: true, balconies: 0, shops: false,
    entrances: false, garage: false, pitched: false, church: false, ribbon: false, ...o,
  };
}

const HOUSE = mk({ floorH: 3, bay: 3, winW: 1, winH: 1, plinth: 0, sills: false, pitched: true });
const STYLES = new Map<number, Style>([
  [MAT.WALL_HOUSE, HOUSE],
  [MAT.WALL_HOUSE_YELLOW, HOUSE],
  [MAT.WALL_HOUSE_PINK, HOUSE],
  [MAT.WALL_HOUSE_MINT, HOUSE],
  [MAT.WALL_HOUSE_BLUE, HOUSE],
  [MAT.WALL_APART, mk({ floorH: 3, bay: 3, winW: 1, winH: 2, sills: false, balconies: 8, entrances: true })],
  [MAT.WALL_INDUSTRIAL, mk({ floorH: 5, bay: 4, winW: 2, winH: 1, winOff: 3, sills: false })],
  [MAT.WALL_CHURCH, mk({ floorH: 0, bay: 5, winW: 1, winH: 3, winOff: 3, plinth: MAT.TRIM, church: true })],
  [MAT.WALL_PUBLIC, mk({ floorH: 4, bay: 4, winW: 2, winH: 2, cornice: true, shops: true })],
  [MAT.WALL_KHRUSH, mk({ floorH: 3, bay: 3, winW: 1, winH: 2, sills: false, balconies: 8, entrances: true })],
  [MAT.WALL_PANEL, mk({ floorH: 3, bay: 3, winW: 1, winH: 2, sills: false, balconies: 8, entrances: true })],
  [MAT.WALL_STALIN, mk({ floorH: 4, bay: 4, winW: 2, winH: 3, cornice: true, shops: true, entrances: true, balconies: 7 })],
  [MAT.WALL_MODERN, mk({ floorH: 4, bay: 4, winW: 3, winH: 2, sills: false, shops: true, ribbon: true })],
  [MAT.WALL_GARAGE, mk({ floorH: 3, bay: 4, winW: 0, winH: 0, sills: false, garage: true })],
]);
const HISTORIC = mk({ floorH: 4, bay: 3, winW: 1, winH: 3, plinth: MAT.TRIM, cornice: true, shops: true });
for (let m = MAT.WALL_HISTORIC; m <= MAT.WALL_HISTORIC_CREAM; m++) STYLES.set(m, HISTORIC);

/** Facade rules for a wall material id (unknown ids behave like a plain apartment block). */
export function styleOf(wall: number): Style {
  return STYLES.get(wall) ?? STYLES.get(MAT.WALL_APART)!;
}

// ---------------------------------------------------------------- per-building preparation

/** Mask margin (columns) around the footprint bbox: covers every neighbourhood lookup. */
const MARGIN = 8;
/** Columns around a grid that still receive facade details, so protrusions into the grid are written. */
const DETAIL_PAD = 3;
/** Footprint larger than this (m) is data noise and skipped. */
const MAX_SPAN = 420;
const MIN_COLS = 4;
const DOME_LAYERS = 9;

const DX = [1, -1, 0, 0];
const DZ = [0, 0, 1, -1];

const ROW_WIN = 1;
const ROW_SILL = 2;
const ROW_SHOP = 4;
const ROW_SLAB = 8;

interface Prep {
  id: number;
  b: VBuilding;
  st: Style;
  wall: number;
  roofMat: number;
  mask: Uint8Array;
  mw: number;
  mh: number;
  mx0: number;
  mz0: number;
  edges: Float64Array;
  allAxis: boolean;
  cols: number;
  baseY: number;
  bottomY: number;
  topY: number;
  /** Top of the walls' body (the parapet/eave level; below topY when a dome sits on it). */
  bodyTop: number;
  /** Top (absolute y) of the ground floor. */
  firstTop: number;
  floorBase: number;
  floorsTop: number;
  /** 0 flat + parapet, 1 gable, 2 hip, 3 skillion. */
  roofKind: number;
  rmax: number;
  ca: number;
  sa: number;
  ridgeOnA: boolean;
  ac0: number;
  bc0: number;
  w2: number;
  l2: number;
  dome: { cx: number; cz: number; r: number; y: number } | null;
  nF: number;
  rowFlags: Uint8Array;
  phaseX: number;
  phaseZ: number;
  entOff: number;
  clipX0: number;
  clipX1: number;
  clipZ0: number;
  clipZ1: number;
}

function inMask(p: Prep, gx: number, gz: number): boolean {
  const i = gx - p.mx0;
  const j = gz - p.mz0;
  return i >= 0 && j >= 0 && i < p.mw && j < p.mh && p.mask[j * p.mw + i] === 1;
}

function rasterMask(p: Prep, rings: Float64Array[]): void {
  const xs: number[] = [];
  for (let j = 0; j < p.mh; j++) {
    const zc = p.mz0 + j + 0.5;
    xs.length = 0;
    for (const ring of rings) {
      const n = ring.length >> 1;
      for (let i = 0; i < n; i++) {
        const k = (i + 1) % n;
        const z0 = ring[i * 2 + 1]!;
        const z1 = ring[k * 2 + 1]!;
        if ((z0 <= zc && zc < z1) || (z1 <= zc && zc < z0)) {
          const x0 = ring[i * 2]!;
          xs.push(x0 + ((zc - z0) * (ring[k * 2]! - x0)) / (z1 - z0));
        }
      }
    }
    if (xs.length < 2) continue;
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const a = Math.ceil(xs[k]! - 0.5);
      const b = Math.ceil(xs[k + 1]! - 0.5) - 1;
      for (let gx = a; gx <= b; gx++) {
        const i = gx - p.mx0;
        if (i >= 0 && i < p.mw) {
          if (p.mask[j * p.mw + i] === 0) p.cols++;
          p.mask[j * p.mw + i] = 1;
        }
      }
    }
  }
}

function prepare(
  pb: PlacedBuilding, gx0: number, gz0: number, size: number, ctx: BuildingContext,
): Prep | null {
  const b = pb.b;
  const ring0 = b.rings[0];
  if (ring0 === undefined || ring0.length < 6) return null;
  const rings: Float64Array[] = [];
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let r = 0; r < b.rings.length; r++) {
    const src = b.rings[r]!;
    const out = new Float64Array(src.length);
    for (let i = 0; i < src.length; i += 2) {
      const x = pb.ox + src[i]! / 100;
      const z = pb.oz + src[i + 1]! / 100;
      out[i] = x;
      out[i + 1] = z;
      if (r === 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
      }
    }
    rings.push(out);
  }
  if (maxX - minX > MAX_SPAN || maxZ - minZ > MAX_SPAN) return null;
  // reject buildings that cannot touch the grid (details reach DETAIL_PAD columns out)
  if (maxX < gx0 - DETAIL_PAD - 2 || minX > gx0 + size + DETAIL_PAD + 2) return null;
  if (maxZ < gz0 - DETAIL_PAD - 2 || minZ > gz0 + size + DETAIL_PAD + 2) return null;

  const mx0 = Math.floor(minX) - MARGIN;
  const mz0 = Math.floor(minZ) - MARGIN;
  const mw = Math.floor(maxX) - mx0 + 1 + MARGIN;
  const mh = Math.floor(maxZ) - mz0 + 1 + MARGIN;
  const wall = b.wall >= 20 && b.wall <= 39 ? b.wall : MAT.WALL_APART;
  const st = styleOf(wall);
  const p: Prep = {
    id: b.id, b, st, wall, roofMat: b.roof >= MAT.ROOF_RED && b.roof <= MAT.ROOF_GREEN ? b.roof : MAT.ROOF_GREY,
    mask: new Uint8Array(mw * mh), mw, mh, mx0, mz0, edges: new Float64Array(0), allAxis: true, cols: 0,
    baseY: 0, bottomY: 0, topY: 0, bodyTop: 0, firstTop: 0, floorBase: 0, floorsTop: 0, roofKind: 0, rmax: 0,
    ca: 1, sa: 0, ridgeOnA: true, ac0: 0, bc0: 0, w2: 0, l2: 0, dome: null, nF: 1,
    rowFlags: new Uint8Array(0),
    phaseX: hash(b.id, 1) % 16, phaseZ: hash(b.id, 2) % 16, entOff: hash(b.id, 3) % 6,
    clipX0: Math.max(gx0 - DETAIL_PAD, Math.floor(minX)), clipX1: Math.min(gx0 + size + DETAIL_PAD, Math.floor(maxX) + 1),
    clipZ0: Math.max(gz0 - DETAIL_PAD, Math.floor(minZ)), clipZ1: Math.min(gz0 + size + DETAIL_PAD, Math.floor(maxZ) + 1),
  };
  rasterMask(p, rings);
  if (p.cols === 0) return null;

  // edges of all rings, for the nearest-edge facade axis
  let ne = 0;
  for (const r of rings) ne += r.length >> 1;
  p.edges = new Float64Array(ne * 4);
  let k = 0;
  let longest = 0, lx = 1, lz = 0;
  for (let ri = 0; ri < rings.length; ri++) {
    const r = rings[ri]!;
    const n = r.length >> 1;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ex = r[j * 2]! - r[i * 2]!;
      const ez = r[j * 2 + 1]! - r[i * 2 + 1]!;
      p.edges[k++] = r[i * 2]!;
      p.edges[k++] = r[i * 2 + 1]!;
      p.edges[k++] = ex;
      p.edges[k++] = ez;
      const len = Math.hypot(ex, ez);
      if (Math.abs(ex) > 0.02 && Math.abs(ez) > 0.02) p.allAxis = false;
      if (ri === 0 && len > longest) { longest = len; lx = ex / len; lz = ez / len; }
    }
  }

  // ---- vertical layout
  let g = Infinity;
  let any = false;
  for (let j = 0; j < p.mh; j += 2) {
    for (let i = 0; i < p.mw; i += 2) {
      // stride on the GLOBAL even grid so every chunk samples the same columns
      const gx = p.mx0 + i;
      const gz = p.mz0 + j;
      if ((gx & 1) !== 0 || (gz & 1) !== 0) continue;
      if (p.mask[j * p.mw + i] !== 1) continue;
      const h = ctx.groundAt(gx + 0.5, gz + 0.5);
      if (h < g) g = h;
      any = true;
    }
  }
  if (!any) {
    for (let j = 0; j < p.mh && !any; j++) {
      for (let i = 0; i < p.mw; i++) {
        if (p.mask[j * p.mw + i] === 1) { g = ctx.groundAt(p.mx0 + i + 0.5, p.mz0 + j + 0.5); any = true; break; }
      }
    }
  }
  p.baseY = Math.max(0, Math.floor(g + 1e-6));
  const minH = Math.max(0, Math.round(b.minHeightCm / 100));
  let H = Math.max(3, Math.round(b.heightCm / 100));
  if (H - minH < 3) H = minH + 3;
  p.bottomY = p.baseY + minH;
  p.topY = Math.min(VOL_Y - 1, p.baseY + H);
  if (p.topY - p.bottomY < 3) p.bottomY = Math.max(0, p.topY - 3);

  // ---- roof
  const shape = b.roofShape;
  const wantDome = shape === ROOF.DOME || shape === ROOF.ONION || st.church;
  let pitched = st.pitched || shape === ROOF.GABLED || shape === ROOF.HIPPED || shape === ROOF.PYRAMIDAL || shape === ROOF.SKILLION;
  if (wantDome) pitched = false;
  if (p.cols < 12) pitched = false;
  let bodyTop = p.topY;
  if (wantDome && p.cols >= 24 && p.topY - p.bottomY >= 16) {
    // centroid of the footprint columns
    let sx = 0, sz = 0, n = 0;
    for (let j = 0; j < p.mh; j++) {
      for (let i = 0; i < p.mw; i++) {
        if (p.mask[j * p.mw + i] === 1) { sx += p.mx0 + i; sz += p.mz0 + j; n++; }
      }
    }
    const cgx = Math.round(sx / n), cgz = Math.round(sz / n);
    if (inMask(p, cgx, cgz) && inMask(p, cgx + 1, cgz) && inMask(p, cgx - 1, cgz) && inMask(p, cgx, cgz + 1) && inMask(p, cgx, cgz - 1)) {
      const r = Math.max(1, Math.min(3, Math.round(Math.sqrt(p.cols) / 6)));
      bodyTop = p.topY - DOME_LAYERS;
      p.dome = { cx: cgx, cz: cgz, r, y: bodyTop };
    }
  }
  p.rmax = 0;
  const bodyTop0 = bodyTop;
  if (pitched) {
    // oriented box from the longest edge: ridge along the longer side
    let ca = lx, sa = lz;
    if (Math.abs(sa) < 1e-6 || Math.abs(ca) < 1e-6) { ca = Math.abs(ca) > 0.5 ? 1 : 0; sa = ca === 1 ? 0 : 1; }
    let aMin = Infinity, aMax = -Infinity, bMin = Infinity, bMax = -Infinity;
    for (let i = 0; i < ring0.length; i += 2) {
      const x = pb.ox + ring0[i]! / 100;
      const z = pb.oz + ring0[i + 1]! / 100;
      const a = x * ca + z * sa;
      const c = -x * sa + z * ca;
      if (a < aMin) aMin = a;
      if (a > aMax) aMax = a;
      if (c < bMin) bMin = c;
      if (c > bMax) bMax = c;
    }
    p.ca = ca;
    p.sa = sa;
    p.ridgeOnA = aMax - aMin >= bMax - bMin;
    p.ac0 = (aMin + aMax) / 2;
    p.bc0 = (bMin + bMax) / 2;
    p.w2 = (p.ridgeOnA ? bMax - bMin : aMax - aMin) / 2;
    p.l2 = (p.ridgeOnA ? aMax - aMin : bMax - bMin) / 2;
    const rm = Math.min(4, Math.round(p.w2 * 0.6), bodyTop - p.bottomY - 3);
    if (rm >= 2) {
      p.rmax = rm;
      p.roofKind = shape === ROOF.HIPPED || shape === ROOF.PYRAMIDAL ? 2 : shape === ROOF.SKILLION ? 3 : 1;
      if (p.l2 < p.w2 * 1.15 && p.roofKind === 1) p.roofKind = 2; // squarish: hip
    }
  }
  // flat roofs: the roof layer is the top row of the body (flush with the walls); cornice styles add
  // one more row of trim around the edge. Windows end below the roof layer, so glass never shows on it.
  if (p.roofKind === 0 && st.cornice && p.dome === null) bodyTop = bodyTop0 - 1;
  p.floorsTop = p.roofKind === 0 ? bodyTop - 1 : bodyTop - p.rmax;
  p.floorBase = p.bottomY;
  p.bodyTop = bodyTop;

  // ---- floors
  const wallH = Math.max(2, p.floorsTop - p.floorBase);
  let nF: number;
  if (st.floorH === 0) nF = 1;
  else {
    nF = Math.max(1, Math.round(wallH / st.floorH));
    const lv = b.levels;
    if (lv > 0 && wallH / lv >= 2.5 && wallH / lv <= st.floorH + 1.5) nF = lv;
  }
  p.nF = nF;
  p.firstTop = p.floorBase + Math.round(wallH / nF);
  p.rowFlags = new Uint8Array(wallH);
  for (let f = 0; f < nF; f++) {
    const s = Math.round((f * wallH) / nF);
    const e = Math.round(((f + 1) * wallH) / nF);
    const fh = e - s;
    const off = st.floorH === 0
      ? Math.min(st.winOff, Math.max(1, fh - 4))
      : Math.min(st.winOff, Math.max(0, fh - st.winH));
    if (st.winW > 0) {
      const wh = st.floorH === 0 ? Math.max(1, Math.min(st.winH, fh - off - 2)) : st.winH;
      for (let r = off; r < Math.min(off + wh, fh); r++) p.rowFlags[s + r]! |= ROW_WIN;
      if (st.sills && f > 0 && off > 0) p.rowFlags[s + off - 1]! |= ROW_SILL;
    }
    if (f > 0) p.rowFlags[s]! |= ROW_SLAB;
    if (f === 0 && st.shops) for (let r = 1; r < Math.min(3, fh); r++) p.rowFlags[s + r]! |= ROW_SHOP;
  }
  return p;
}

// ---------------------------------------------------------------- writing

class Writer {
  readonly mats: Uint8Array;
  readonly gx0: number;
  readonly gz0: number;
  readonly size: number;
  readonly foot: Uint8Array | undefined;

  constructor(mats: Uint8Array, gx0: number, gz0: number, size: number, foot: Uint8Array | undefined) {
    this.mats = mats;
    this.gx0 = gx0;
    this.gz0 = gz0;
    this.size = size;
    this.foot = foot;
  }

  set(gx: number, y: number, gz: number, m: number): void {
    const x = gx - this.gx0;
    const z = gz - this.gz0;
    if (x < 0 || z < 0 || x >= this.size || z >= this.size || y < 0 || y >= VOL_Y) return;
    this.mats[(y * this.size + z) * this.size + x] = m;
  }

  /** Sets only air blocks (protrusions never replace anything). */
  setAir(gx: number, y: number, gz: number, m: number): void {
    const x = gx - this.gx0;
    const z = gz - this.gz0;
    if (x < 0 || z < 0 || x >= this.size || z >= this.size || y < 0 || y >= VOL_Y) return;
    const i = (y * this.size + z) * this.size + x;
    if (this.mats[i] === 0) this.mats[i] = m;
  }

  get(gx: number, y: number, gz: number): number {
    const x = gx - this.gx0;
    const z = gz - this.gz0;
    if (x < 0 || z < 0 || x >= this.size || z >= this.size || y < 0 || y >= VOL_Y) return 0;
    return this.mats[(y * this.size + z) * this.size + x]!;
  }

  run(gx: number, gz: number, y0: number, y1: number, m: number): void {
    const x = gx - this.gx0;
    const z = gz - this.gz0;
    if (x < 0 || z < 0 || x >= this.size || z >= this.size) return;
    const a = Math.max(0, y0);
    const b = Math.min(VOL_Y, y1);
    for (let y = a; y < b; y++) this.mats[(y * this.size + z) * this.size + x] = m;
  }
}

/** Roof rise (>= 1) above the eaves of a pitched roof at column centre (x, z). */
function roofRise(p: Prep, x: number, z: number): number {
  const a = x * p.ca + z * p.sa;
  const c = -x * p.sa + z * p.ca;
  const along = (p.ridgeOnA ? a - p.ac0 : c - p.bc0);
  const across = (p.ridgeOnA ? c - p.bc0 : a - p.ac0);
  let t: number;
  const w2 = Math.max(p.w2, 0.5);
  if (p.roofKind === 3) t = (across + w2) / (2 * w2);
  else if (p.roofKind === 2) t = Math.min(w2 - Math.abs(across), p.l2 - Math.abs(along)) / w2;
  else t = (w2 - Math.abs(across)) / w2;
  if (t < 0) t = 0;
  if (t > 1) t = 1;
  return 1 + Math.floor((p.rmax - 1) * t + 0.5);
}

/** True when a gable-end column (within a metre of the end of the ridge). */
function gableEnd(p: Prep, x: number, z: number): boolean {
  if (p.roofKind !== 1) return false;
  const a = x * p.ca + z * p.sa;
  const c = -x * p.sa + z * p.ca;
  const along = p.ridgeOnA ? a - p.ac0 : c - p.bc0;
  return p.l2 - Math.abs(along) < 1;
}

function fillBuilding(p: Prep, w: Writer, ctx: BuildingContext): void {
  const bodyTop = p.bodyTop;
  const flat = p.roofKind === 0;
  for (let gz = p.clipZ0; gz < p.clipZ1; gz++) {
    for (let gx = p.clipX0; gx < p.clipX1; gx++) {
      if (!inMask(p, gx, gz)) continue;
      const x = gx - w.gx0;
      const z = gz - w.gz0;
      if (x < 0 || z < 0 || x >= w.size || z >= w.size) continue;
      if (w.foot !== undefined) w.foot[z * w.size + x] = 1;
      const g = Math.max(0, Math.floor(ctx.groundAt(gx + 0.5, gz + 0.5) + 1e-6));
      const y0 = p.bottomY > p.baseY ? p.bottomY : Math.min(g, p.baseY);
      // foundation below the base where the ground drops away (no floating walls)
      if (y0 < p.baseY && p.bottomY === p.baseY) w.run(gx, gz, y0, p.baseY, MAT.CONCRETE);
      const edge = !inMask(p, gx + 1, gz) || !inMask(p, gx - 1, gz) || !inMask(p, gx, gz + 1) || !inMask(p, gx, gz - 1);
      if (p.cols < MIN_COLS) {
        w.run(gx, gz, p.bottomY, p.topY - 1, p.wall);
        w.run(gx, gz, p.topY - 1, p.topY, p.roofMat);
        continue;
      }
      if (flat) {
        if (edge) {
          w.run(gx, gz, p.bottomY, bodyTop, p.wall);
        } else {
          w.run(gx, gz, p.bottomY, bodyTop - 1, p.wall);
          w.set(gx, bodyTop - 1, gz, p.roofMat);
        }
      } else {
        const wallTop = bodyTop - p.rmax;
        const rise = roofRise(p, gx + 0.5, gz + 0.5);
        w.run(gx, gz, p.bottomY, wallTop, p.wall);
        w.run(gx, gz, wallTop, wallTop + rise, gableEnd(p, gx + 0.5, gz + 0.5) ? p.wall : p.roofMat);
      }
    }
  }
  if (p.dome !== null) fillDome(p, w);
  if (flat && p.cols >= 150 && p.topY - p.bottomY >= 6 && p.dome === null) fillRoofBoxes(p, w);
}

/** Drum + onion dome + spire on a church (or any DOME/ONION roof). */
function fillDome(p: Prep, w: Writer): void {
  const d = p.dome!;
  const gold = p.roofMat === MAT.ROOF_GREEN || p.roofMat === MAT.ROOF_GOLD ? p.roofMat : MAT.ROOF_GOLD;
  const layers: Array<[number, number]> = [
    [d.r, p.wall], [d.r, p.wall], [d.r + 1, gold], [d.r + 1, gold], [d.r, gold], [Math.max(1, d.r - 1), gold],
    [0, MAT.ROOF_GOLD], [0, MAT.ROOF_GOLD], [0, MAT.METAL],
  ];
  for (let li = 0; li < layers.length; li++) {
    const [r, m] = layers[li]!;
    const thr = r === 0 ? 0 : r * r + 1;
    const y = d.y + li;
    for (let dz = -r - 1; dz <= r + 1; dz++) {
      for (let dx = -r - 1; dx <= r + 1; dx++) {
        if (dx * dx + dz * dz <= thr) w.set(d.cx + dx, y, d.cz + dz, m);
      }
    }
  }
}

/** Vents and AC boxes on big flat roofs: 2x2 boxes in some cells of the world 4 m grid. */
function fillRoofBoxes(p: Prep, w: Writer): void {
  const bodyTop = p.bodyTop;
  const deep = (gx: number, gz: number): boolean => {
    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = -2; dx <= 2; dx++) {
        if (Math.abs(dx) + Math.abs(dz) <= 2 && !inMask(p, gx + dx, gz + dz)) return false;
      }
    }
    return true;
  };
  for (let cz = Math.floor(p.clipZ0 / 4); cz <= Math.floor((p.clipZ1 - 1) / 4); cz++) {
    for (let cx = Math.floor(p.clipX0 / 4); cx <= Math.floor((p.clipX1 - 1) / 4); cx++) {
      const h = hash(p.id, cx, cz + 77);
      if (h % 13 !== 0) continue;
      const bx = cx * 4 + 1;
      const bz = cz * 4 + 1;
      if (!(deep(bx, bz) && deep(bx + 1, bz) && deep(bx, bz + 1) && deep(bx + 1, bz + 1))) continue;
      const height = 1 + ((h >> 8) & 1);
      const m = (h >> 9) & 1 ? MAT.METAL : MAT.CONCRETE;
      for (let dz = 0; dz < 2; dz++) for (let dx = 0; dx < 2; dx++) w.run(bx + dx, bz + dz, bodyTop, bodyTop + height, m);
    }
  }
}

// ---------------------------------------------------------------- facade details

function floorDiv(a: number, n: number): number {
  return Math.floor(a / n);
}

/** Axis of the nearest polygon edge: true when it runs along x. */
function nearestEdge(p: Prep, x: number, z: number): { alongX: boolean; oblique: boolean; nx: number; nz: number } {
  let best = Infinity;
  let bx = 1, bz = 0;
  const e = p.edges;
  for (let i = 0; i < e.length; i += 4) {
    const ex = e[i + 2]!, ez = e[i + 3]!;
    const l2 = ex * ex + ez * ez;
    if (l2 < 1e-9) continue;
    let t = ((x - e[i]!) * ex + (z - e[i + 1]!) * ez) / l2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = e[i]! + ex * t - x;
    const qz = e[i + 1]! + ez * t - z;
    const d = qx * qx + qz * qz;
    if (d < best) { best = d; bx = ex; bz = ez; }
  }
  const len = Math.hypot(bx, bz) || 1;
  const ax = Math.abs(bx) / len, az = Math.abs(bz) / len;
  // outward normal is ambiguous in sign here: callers resolve it against the open sides
  return { alongX: ax >= az, oblique: Math.min(ax, az) > 0.35, nx: -bz / len, nz: bx / len };
}

function detailBuilding(p: Prep, w: Writer, ctx: BuildingContext): void {
  const st = p.st;
  const bodyTop = p.bodyTop;
  const flat = p.roofKind === 0;
  const ground = p.bottomY === p.baseY;
  const wallH = p.rowFlags.length;
  for (let gz = p.clipZ0; gz < p.clipZ1; gz++) {
    for (let gx = p.clipX0; gx < p.clipX1; gx++) {
      if (!inMask(p, gx, gz)) continue;
      let nOut = 0;
      let o0 = -1, o1 = -1;
      for (let d = 0; d < 4; d++) {
        if (!inMask(p, gx + DX[d]!, gz + DZ[d]!)) {
          if (nOut === 0) o0 = d; else o1 = d;
          nOut++;
        }
      }
      if (nOut === 0 || p.cols < MIN_COLS) continue;

      // plinth course
      if (ground && st.plinth !== 0 && !st.garage) w.set(gx, p.baseY, gz, st.plinth);

      // cornice: an extra trim row on the roof edge sticks out one block
      if (st.cornice && flat) {
        const y = bodyTop;
        w.set(gx, y, gz, MAT.TRIM);
        for (let d = 0; d < 4; d++) {
          if (inMask(p, gx + DX[d]!, gz + DZ[d]!)) continue;
          w.setAir(gx + DX[d]!, y, gz + DZ[d]!, MAT.TRIM);
        }
        if (nOut === 2 && (DX[o0]! !== 0) !== (DX[o1]! !== 0)) {
          w.setAir(gx + DX[o0]! + DX[o1]!, y, gz + DZ[o0]! + DZ[o1]!, MAT.TRIM);
        }
      }

      if (st.winW === 0 && !st.garage) continue;
      // ---- facade opening direction
      let d = -1;
      let uAlongX = false;
      if (nOut === 1) {
        d = o0;
        if (p.allAxis) {
          uAlongX = DZ[d]! !== 0;
        } else {
          const ne = nearestEdge(p, gx + 0.5, gz + 0.5);
          uAlongX = ne.alongX;
        }
        // axis-aligned walls need a straight run so windows keep clear of corner piers
        const px = DZ[d]!, pz = DX[d]!; // lateral step
        const straight = inMask(p, gx + px, gz + pz) && inMask(p, gx - px, gz - pz)
          && !inMask(p, gx + px + DX[d]!, gz + pz + DZ[d]!) && !inMask(p, gx - px + DX[d]!, gz - pz + DZ[d]!);
        if (!straight && (p.allAxis || !nearestEdge(p, gx + 0.5, gz + 0.5).oblique)) continue;
      } else if (nOut === 2 && (DX[o0]! !== 0) !== (DX[o1]! !== 0) && !p.allAxis) {
        // staircased diagonal wall: face along the nearest edge's normal
        const ne = nearestEdge(p, gx + 0.5, gz + 0.5);
        if (!ne.oblique) continue;
        const s0 = DX[o0]! * ne.nx + DZ[o0]! * ne.nz;
        const s1 = DX[o1]! * ne.nx + DZ[o1]! * ne.nz;
        d = Math.abs(s0) >= Math.abs(s1) ? o0 : o1;
        uAlongX = ne.alongX;
      } else {
        continue;
      }
      const dx = DX[d]!, dz = DZ[d]!;
      // a solid back wall: two columns of building behind the opening
      if (!inMask(p, gx - dx, gz - dz) || !inMask(p, gx - 2 * dx, gz - 2 * dz)) continue;
      const ix = gx - dx, iz = gz - dz;

      const u = (uAlongX ? gx : gz) + (uAlongX ? p.phaseX : p.phaseZ);
      const bayI = floorDiv(u, st.bay);
      const pp = mod(u, st.bay);
      const winOff = Math.floor((st.bay - st.winW) / 2);
      const isWinCol = st.winW > 0 && pp >= winOff && pp < winOff + st.winW;
      const hb = hash(p.id, bayI, uAlongX ? 1 : 2);

      if (st.garage) {
        if (ground && pp >= 1 && pp <= 2) {
          w.set(gx, p.baseY, gz, MAT.DOOR);
          w.set(gx, p.baseY + 1, gz, MAT.DOOR);
        }
        continue;
      }

      // entrance bay: a recessed door under a canopy, one bay in six on the ground floor
      const entr = st.entrances && ground && mod(bayI + p.entOff, 6) === 0 && wallH >= 4;
      // shop front: wide glazing on street-facing ground-floor bays
      let shop = false;
      if (st.shops && ground && !entr && (hb % 100) < 55) {
        shop = ctx.roadDist === undefined || ctx.roadDist(gx + 0.5 + dx * 2, gz + 0.5 + dz * 2) < 16;
      }
      if (entr) {
        if (pp === st.bay >> 1) {
          w.set(gx, p.baseY, gz, 0);
          w.set(gx, p.baseY + 1, gz, 0);
          w.set(ix, p.baseY, iz, MAT.DOOR);
          w.set(ix, p.baseY + 1, iz, MAT.DOOR);
        }
        // canopy over three columns, fully outside the wall plane
        if (Math.abs(pp - (st.bay >> 1)) <= 1) w.setAir(gx + dx, p.baseY + 2, gz + dz, MAT.METAL);
      }

      // rows
      for (let r = 0; r < wallH; r++) {
        const y = p.floorBase + r;
        const fl = p.rowFlags[r]!;
        if (fl === 0) continue;
        const gfloor = ground && y < p.firstTop;
        if (shop && gfloor && (fl & ROW_SHOP) !== 0) {
          if (pp < st.bay - 1) {
            w.set(gx, y, gz, 0);
            w.set(ix, y, iz, MAT.SHOPFRONT);
          }
          continue;
        }
        if ((fl & ROW_WIN) !== 0 && isWinCol && !(entr && gfloor)) {
          if (!(st.ribbon && pp === st.bay - 1)) {
            w.set(gx, y, gz, 0);
            w.set(ix, y, iz, MAT.GLASS);
          }
        } else if ((fl & ROW_SILL) !== 0 && isWinCol) {
          w.set(gx, y, gz, MAT.TRIM);
        }
        if ((fl & ROW_SLAB) !== 0 && st.balconies > 0 && hb % st.balconies === 0 && nOut === 1) {
          w.setAir(gx + dx, y, gz + dz, MAT.CONCRETE);
          w.setAir(gx + dx, y + 1, gz + dz, MAT.METAL);
        }
      }
    }
  }
}

// ---------------------------------------------------------------- entry point

/**
 * Writes every building overlapping `grid` into it, clipped. `foot` (optional, size*size) is set to 1
 * on columns inside a footprint, so the physics can tell buildings from ground-supported pieces.
 */
export function addBuildings(
  grid: BlockGrid, placed: readonly PlacedBuilding[], ctx: BuildingContext, foot?: Uint8Array,
): void {
  const size = gridSize(grid);
  const gx0 = Math.round(grid.x0);
  const gz0 = Math.round(grid.z0);
  const order = placed.slice().sort((a, b) => a.b.id - b.b.id || a.ox - b.ox || a.oz - b.oz
    || a.b.rings[0]![0]! - b.b.rings[0]![0]! || a.b.rings[0]![1]! - b.b.rings[0]![1]!);
  const preps: Prep[] = [];
  for (const pb of order) {
    const p = prepare(pb, gx0, gz0, size, ctx);
    if (p !== null) preps.push(p);
  }
  const w = new Writer(grid.mats, gx0, gz0, size, foot);
  for (const p of preps) fillBuilding(p, w, ctx);
  for (const p of preps) detailBuilding(p, w, ctx);
}

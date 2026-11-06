/**
 * Procedural leaf-cluster and bark textures for the realistic trees.
 *
 * Pure data generation: RGBA8, layer-major and rows bottom-up as WebGL expects, with no DOM
 * and no `three` import. `tree-atlas.ts` owns the layer indices; the renderer turns these
 * arrays into `THREE.DataArrayTexture` layers later. Everything is deterministic.
 */
import { BARK_LAYER, BARK_LAYERS, LEAF_LAYER, LEAF_LAYERS } from './tree-atlas.ts';

/** Leaf cards are nearly neutral: the shader multiplies them by the species vertex colour. */
const LEAF_RGB: readonly [number, number, number] = [212, 212, 212];
const BLOSSOM_RGB: readonly [number, number, number] = [228, 226, 230];
const BARK_MIN = 110;
const BARK_MAX = 235;

type LeafShape = 'oval' | 'heart' | 'lanceolate' | 'triangular';

interface LeafPrim {
  /** Centre, normalised to the image. */
  x: number;
  y: number;
  /** Half length along the leaf axis and half width across it, normalised. */
  length: number;
  width: number;
  /** Axis angle from +v (up) toward +u, in radians. */
  angle: number;
  shape: LeafShape;
  /** Leaves sharing a group share a brightness; one lobed leaf is several prims of one group. */
  group: number;
  serrate?: boolean;
}

function prim(
  shape: LeafShape,
  x: number,
  y: number,
  length: number,
  width: number,
  angle: number,
  group: number,
  serrate = false,
): LeafPrim {
  return { shape, x, y, length, width, angle, group, serrate };
}

/** Integer hash in [0, 1), used for leaf brightness and the periodic bark fields. */
function hash01(n: number): number {
  let h = Math.imul(n | 0, 0x9e3779b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function clampByte(value: number, lo = 0, hi = 255): number {
  return Math.max(lo, Math.min(hi, Math.round(value)));
}

/** One lobe fan of a maple or plane leaf. */
function addLobed(out: LeafPrim[], x: number, y: number, scale: number, rotation: number, group: number): void {
  const angles = [-1.15, -0.58, 0, 0.58, 1.15];
  const lengths = [0.80, 0.94, 1.08, 0.94, 0.80];
  for (let i = 0; i < angles.length; i++) {
    const angle = rotation + angles[i]!;
    const half = 0.24 * lengths[i]! * scale;
    const width = 0.094 * scale * (i === 2 ? 1.1 : 1);
    out.push(prim(
      'oval',
      x + Math.sin(angle) * half,
      y + Math.cos(angle) * half,
      half,
      width,
      angle,
      group,
    ));
  }
}

/** Five petals around one flower centre. */
function addFlower(out: LeafPrim[], x: number, y: number, scale: number, rotation: number, group: number): void {
  const petals = 5;
  for (let i = 0; i < petals; i++) {
    const angle = rotation + (i / petals) * Math.PI * 2;
    const half = 0.077 * scale;
    out.push(prim(
      'oval',
      x + Math.sin(angle) * half,
      y + Math.cos(angle) * half,
      half,
      0.052 * scale,
      angle,
      group,
    ));
  }
}

/** A pair of leaflets on either side of a rachis at y. */
function addPinnatePair(
  out: LeafPrim[],
  y: number,
  sideAngle: number,
  half: number,
  width: number,
  group: number,
): void {
  for (const side of [-1, 1]) {
    const angle = side * sideAngle;
    out.push(prim(
      'oval',
      0.5 + Math.sin(angle) * half,
      y + Math.cos(angle) * half,
      half,
      width,
      angle,
      group + (side > 0 ? 0 : 1),
    ));
  }
}

/** One palmate leaf: leaflets fanned from a single bud. */
function addPalmateFan(
  out: LeafPrim[],
  baseX: number,
  baseY: number,
  scale: number,
  rotation: number,
  leaflets: number,
  spread: number,
  half: number,
  width: number,
  groupBase: number,
): void {
  for (let i = 0; i < leaflets; i++) {
    const angle = rotation + (-spread + (2 * spread * i) / (leaflets - 1));
    const h = half * scale * (i === (leaflets - 1) / 2 ? 1.06 : 1);
    out.push(prim(
      'oval',
      baseX + Math.sin(angle) * h,
      baseY + Math.cos(angle) * h,
      h,
      width * scale,
      angle,
      groupBase + i,
    ));
  }
}

/** A straight twig, with small serrated leaves alternating along it. */
function addSerrateTwig(
  out: LeafPrim[],
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  count: number,
  half: number,
  width: number,
  groupBase: number,
): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const angle = Math.atan2(dx, dy);
  out.push(prim('oval', (x0 + x1) / 2, (y0 + y1) / 2, Math.hypot(dx, dy) / 2, 0.006, angle, groupBase));
  for (let i = 0; i < count; i++) {
    const t = 0.08 + (0.84 * i) / (count - 1);
    const bx = x0 + dx * t;
    const by = y0 + dy * t;
    const leafAngle = angle + (i % 2 === 0 ? -1.0 : 1.0);
    out.push(prim(
      'oval',
      bx + Math.sin(leafAngle) * half,
      by + Math.cos(leafAngle) * half,
      half,
      width,
      leafAngle,
      groupBase + 1 + i,
      true,
    ));
  }
}

/** A drooping twig, with narrow leaves alternating down its length. */
function addDroopingTwig(
  out: LeafPrim[],
  xTop: number,
  yTop: number,
  xBottom: number,
  yBottom: number,
  count: number,
  half: number,
  width: number,
  groupBase: number,
): void {
  const dx = xBottom - xTop;
  const dy = yBottom - yTop;
  const down = Math.atan2(dx, dy);
  out.push(prim('oval', (xTop + xBottom) / 2, (yTop + yBottom) / 2, Math.hypot(dx, dy) / 2, 0.006, down, groupBase));
  for (let i = 0; i < count; i++) {
    const t = 0.06 + (0.88 * i) / (count - 1);
    const bx = xTop + dx * t;
    const by = yTop + dy * t;
    const leafAngle = down + (i % 2 === 0 ? -0.55 : 0.55);
    out.push(prim(
      'lanceolate',
      bx + Math.sin(leafAngle) * half,
      by + Math.cos(leafAngle) * half,
      half,
      width,
      leafAngle,
      groupBase + 1 + i,
    ));
  }
}

function buildCluster(layer: number): LeafPrim[] {
  const out: LeafPrim[] = [];
  switch (layer) {
    case LEAF_LAYER.PALMATE: {
      // Horse chestnut: three palmate leaves, each a fan of five to seven leaflets.
      addPalmateFan(out, 0.50, 0.10, 1.00, 0, 7, 0.68, 0.37, 0.170, 0);
      addPalmateFan(out, 0.45, 0.34, 1.00, -0.35, 5, 0.45, 0.28, 0.130, 8);
      addPalmateFan(out, 0.55, 0.34, 1.00, 0.35, 5, 0.45, 0.28, 0.130, 16);
      break;
    }
    case LEAF_LAYER.HEART: {
      // Linden: a dense cluster of twelve small heart leaves.
      out.push(prim('oval', 0.34, 0.20, 0.11, 0.005, 0.08, 0));
      out.push(prim('oval', 0.50, 0.18, 0.13, 0.005, 0, 1));
      out.push(prim('oval', 0.66, 0.20, 0.11, 0.005, -0.08, 2));
      const xs = [0.26, 0.42, 0.58, 0.74];
      const ys = [0.28, 0.49, 0.70];
      let group = 3;
      for (let row = 0; row < ys.length; row++) {
        for (let col = 0; col < xs.length; col++) {
          const angle = (col - 1.5) * 0.18 + (row - 1) * 0.05;
          out.push(prim('heart', xs[col]!, ys[row]!, 0.195, 0.165, angle, group++));
        }
      }
      break;
    }
    case LEAF_LAYER.BIG_HEART: {
      // Catalpa: fewer, much larger heart leaves.
      out.push(prim('heart', 0.5, 0.55, 0.42, 0.42, 0, 0));
      out.push(prim('heart', 0.36, 0.31, 0.29, 0.24, -0.30, 1));
      out.push(prim('heart', 0.64, 0.31, 0.29, 0.24, 0.30, 2));
      out.push(prim('heart', 0.5, 0.30, 0.26, 0.22, 0.05, 3));
      out.push(prim('oval', 0.5, 0.16, 0.10, 0.010, 0, 0));
      break;
    }
    case LEAF_LAYER.LOBED: {
      // Maple / plane: nine five-lobed leaves spread across the card.
      addLobed(out, 0.30, 0.10, 0.60, -0.25, 0);
      addLobed(out, 0.50, 0.12, 0.64, 0, 5);
      addLobed(out, 0.70, 0.10, 0.60, 0.25, 10);
      addLobed(out, 0.26, 0.28, 0.55, -0.35, 15);
      addLobed(out, 0.44, 0.31, 0.58, -0.12, 20);
      addLobed(out, 0.56, 0.31, 0.58, 0.12, 25);
      addLobed(out, 0.74, 0.28, 0.55, 0.35, 30);
      addLobed(out, 0.36, 0.52, 0.58, -0.18, 35);
      addLobed(out, 0.64, 0.52, 0.58, 0.18, 40);
      break;
    }
    case LEAF_LAYER.PINNATE_FINE: {
      // Robinia: many tiny leaflets in pairs along a thin rachis.
      out.push(prim('oval', 0.5, 0.50, 0.40, 0.008, 0, 0));
      for (let i = 0; i < 8; i++) {
        addPinnatePair(out, 0.10 + i * 0.095, 1.05, 0.18, 0.047, 1 + i * 2);
      }
      out.push(prim('oval', 0.5, 0.86, 0.09, 0.045, 0, 24));
      break;
    }
    case LEAF_LAYER.PINNATE_LONG: {
      // Ailanthus / walnut: fewer, longer leaflets on a long frond.
      out.push(prim('oval', 0.5, 0.50, 0.43, 0.008, 0, 0));
      for (let i = 0; i < 6; i++) {
        addPinnatePair(out, 0.15 + i * 0.115, 1.12, 0.17, 0.055, 1 + i * 2);
      }
      out.push(prim('lanceolate', 0.5, 0.88, 0.10, 0.045, 0, 20));
      break;
    }
    case LEAF_LAYER.SMALL_SERRATE: {
      // Elm / mulberry: three twigs with eighteen small serrated leaves.
      addSerrateTwig(out, 0.28, 0.14, 0.36, 0.82, 6, 0.13, 0.070, 0);
      addSerrateTwig(out, 0.50, 0.12, 0.50, 0.86, 6, 0.13, 0.070, 10);
      addSerrateTwig(out, 0.72, 0.14, 0.64, 0.82, 6, 0.13, 0.070, 20);
      break;
    }
    case LEAF_LAYER.LANCEOLATE: {
      // Willow: twenty-one narrow leaves on three drooping stems.
      addDroopingTwig(out, 0.38, 0.87, 0.22, 0.30, 7, 0.16, 0.050, 0);
      addDroopingTwig(out, 0.50, 0.89, 0.50, 0.30, 7, 0.16, 0.050, 10);
      addDroopingTwig(out, 0.62, 0.87, 0.78, 0.30, 7, 0.16, 0.050, 20);
      break;
    }
    case LEAF_LAYER.TRIANGULAR: {
      // Poplar: fifteen triangular leaves in pairs around a shoot.
      out.push(prim('oval', 0.5, 0.48, 0.38, 0.006, 0, 0));
      for (let i = 0; i < 7; i++) {
        const y = 0.18 + i * 0.10;
        for (const side of [-1, 1]) {
          const angle = side * 0.80;
          const half = 0.19;
          out.push(prim(
            'triangular',
            0.5 + Math.sin(angle) * half,
            y + Math.cos(angle) * half,
            half,
            0.145,
            angle,
            1 + i * 2 + (side > 0 ? 0 : 1),
          ));
        }
      }
      out.push(prim('triangular', 0.5, 0.84, 0.13, 0.10, 0, 20));
      break;
    }
    case LEAF_LAYER.NEEDLE_TUFT: {
      // Pine: three tufts of long thin needles.
      out.push(prim('oval', 0.5, 0.50, 0.44, 0.007, 0, 0));
      const tufts: readonly [number, number, number][] = [[0.34, 0.38, 0.3], [0.66, 0.42, 1.9], [0.5, 0.67, 3.4]];
      let group = 1;
      for (const [tx, ty, phase] of tufts) {
        for (let i = 0; i < 20; i++) {
          const angle = phase + (i / 20) * Math.PI * 2;
          const half = 0.17 + 0.012 * hash01(i + group * 31);
          out.push(prim(
            'oval',
            tx + Math.sin(angle) * half,
            ty + Math.cos(angle) * half,
            half,
            0.016,
            angle,
            group++,
          ));
        }
      }
      break;
    }
    case LEAF_LAYER.SCALE_SPRAY: {
      // Thuja: a flat vertical spray of small overlapping scales on paired branchlets.
      out.push(prim('oval', 0.5, 0.50, 0.40, 0.008, 0, 0));
      const branchlets: readonly [number, number, number][] = [
        [0.16, -0.90, 0.40], [0.16, 0.90, 0.40],
        [0.34, -0.80, 0.38], [0.34, 0.80, 0.38],
        [0.52, -0.70, 0.34], [0.52, 0.70, 0.34],
        [0.62, -0.60, 0.26], [0.62, 0.60, 0.26],
        [0.28, -1.15, 0.36], [0.28, 1.15, 0.36],
        [0.48, -1.10, 0.28], [0.48, 1.10, 0.28],
      ];
      let group = 1;
      for (const [baseY, branchAngle, branchLen] of branchlets) {
        for (let i = 0; i < 7; i++) {
          const t = 0.1 + i * 0.14;
          const bx = 0.5 + Math.sin(branchAngle) * branchLen * t;
          const by = baseY + Math.cos(branchAngle) * branchLen * t;
          out.push(prim('oval', bx, by, 0.116, 0.084, branchAngle, group));
          const side = i % 2 === 0 ? -1 : 1;
          const angle = branchAngle + side * 0.9;
          out.push(prim(
            'oval',
            bx + Math.sin(angle) * 0.045,
            by + Math.cos(angle) * 0.045,
            0.110,
            0.077,
            angle,
            group + 1,
          ));
          out.push(prim(
            'oval',
            bx - Math.sin(angle) * 0.045,
            by - Math.cos(angle) * 0.045,
            0.103,
            0.070,
            angle + Math.PI,
            group + 2,
          ));
          group += 3;
        }
      }
      break;
    }
    case LEAF_LAYER.BLOSSOM: {
      // Lilac / pink bush: small clusters of five-petal flowers.
      const flowers: readonly [number, number, number][] = [
        [0.32, 0.32, 0.2], [0.5, 0.5, 1.1], [0.68, 0.32, 2.0],
        [0.30, 0.65, 0.7], [0.50, 0.78, 1.6], [0.70, 0.65, 2.5],
        [0.40, 0.18, 0.4], [0.62, 0.18, 1.3], [0.50, 0.62, 2.9],
        [0.42, 0.44, 1.8], [0.58, 0.44, 0.9],
      ];
      for (let i = 0; i < flowers.length; i++) {
        const [x, y, rotation] = flowers[i]!;
        addFlower(out, x, y, 1, rotation, i);
      }
      break;
    }
    default:
      break;
  }
  return out;
}

/** Width profile of a heart leaf along its axis; widest just behind the middle. */
function heartProfile(a: number): number {
  const raw = Math.pow(Math.max(0, 1 - a), 0.8) * Math.pow(Math.max(0, 1 + a), 0.45);
  return raw / 1.051;
}

function insideLeaf(p: LeafPrim, a: number, b: number): boolean {
  if (a < -1 || a > 1) return false;
  let width: number;
  switch (p.shape) {
    case 'triangular':
      width = (1 - a) * 0.5;
      break;
    case 'heart':
      width = heartProfile(a);
      if (a < -0.62 && Math.abs(b) < (-a - 0.62) * 1.5) return false;
      break;
    case 'lanceolate':
      width = Math.pow(Math.max(0, 1 - a * a), 0.9);
      break;
    default:
      width = Math.sqrt(Math.max(0, 1 - a * a));
      break;
  }
  if (Math.abs(b) > width) return false;
  if (p.serrate && Math.abs(b) > width * 0.82 && Math.sin(a * 42) < 0) return false;
  return true;
}

function leafColour(layer: number, group: number, a: number, b: number): [number, number, number] {
  const blossom = layer === LEAF_LAYER.BLOSSOM;
  const base = blossom ? BLOSSOM_RGB : LEAF_RGB;
  const t = Math.max(0, Math.min(1, (a + 1) * 0.5));
  const variation = blossom ? 0.94 + 0.10 * hash01(layer * 1009 + group) : 0.88 + 0.24 * hash01(layer * 1009 + group);
  const tip = 1 + (blossom ? 0.06 : 0.07) * t;
  let vein = 1;
  if (blossom) {
    if (Math.abs(b) < 0.05) vein = 0.9;
  } else if (Math.abs(b) < 0.075) {
    vein = 0.75;
  }
  const shade = variation * tip * vein;
  const floor = blossom ? 0 : 150;
  return [
    Math.max(floor, clampByte(base[0] * shade)),
    Math.max(floor, clampByte(base[1] * shade)),
    Math.max(floor, clampByte(base[2] * shade)),
  ];
}

function paintLayer(data: Uint8Array, layer: number, size: number, prims: readonly LeafPrim[]): void {
  const offset = layer * size * size * 4;
  for (let i = 0; i < size * size; i++) {
    const o = offset + i * 4;
    data[o] = 200;
    data[o + 1] = 200;
    data[o + 2] = 200;
    data[o + 3] = 0;
  }
  const border = Math.min(3, Math.floor(size / 4));
  const minX = border;
  const maxX = size - border - 1;
  for (const p of prims) {
    const cx = p.x * size;
    const cy = p.y * size;
    const hl = Math.max(0.5, p.length * size);
    const hw = Math.max(0.5, p.width * size);
    const sin = Math.sin(p.angle);
    const cos = Math.cos(p.angle);
    const ex = Math.abs(sin) * hl + Math.abs(cos) * hw;
    const ey = Math.abs(cos) * hl + Math.abs(sin) * hw;
    const x0 = Math.max(minX, Math.floor(cx - ex));
    const x1 = Math.min(maxX, Math.ceil(cx + ex));
    const y0 = Math.max(minX, Math.floor(cy - ey));
    const y1 = Math.min(maxX, Math.ceil(cy + ey));
    for (let y = y0; y <= y1; y++) {
      const dy = y + 0.5 - cy;
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx;
        const a = (dx * sin + dy * cos) / hl;
        const b = (dx * cos - dy * sin) / hw;
        if (!insideLeaf(p, a, b)) continue;
        const [r, g, bl] = leafColour(layer, p.group, a, b);
        const o = offset + (y * size + x) * 4;
        data[o] = r;
        data[o + 1] = g;
        data[o + 2] = bl;
        data[o + 3] = 255;
      }
    }
  }
}

/** RGBA8, LEAF_LAYERS layers of size×size, layer-major (layer 0 first), rows bottom-up like WebGL. */
export function makeLeafLayers(size = 128): Uint8Array {
  const data = new Uint8Array(size * size * 4 * LEAF_LAYERS);
  for (let layer = 0; layer < LEAF_LAYERS; layer++) {
    paintLayer(data, layer, size, buildCluster(layer));
  }
  return data;
}

/** Value noise that wraps every `px` and `py` lattice cells, so the result tiles. */
function noise2(u: number, v: number, px: number, py: number, seed: number): number {
  const fx = u * px;
  const fy = v * py;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const tx = fx - ix;
  const ty = fy - iy;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const x0 = ((ix % px) + px) % px;
  const y0 = ((iy % py) + py) % py;
  const x1 = (x0 + 1) % px;
  const y1 = (y0 + 1) % py;
  const n00 = hash2(x0, y0, seed);
  const n10 = hash2(x1, y0, seed);
  const n01 = hash2(x0, y1, seed);
  const n11 = hash2(x1, y1, seed);
  const nx0 = n00 + (n10 - n00) * sx;
  const nx1 = n01 + (n11 - n01) * sx;
  return nx0 + (nx1 - nx0) * sy;
}

/** Fractal value noise, still periodic and therefore tileable. */
function fbm(u: number, v: number, px: number, py: number, octaves: number, seed: number): number {
  let value = 0;
  let weight = 0.5;
  let total = 0;
  for (let i = 0; i < octaves; i++) {
    value += noise2(u, v, px << i, py << i, seed + i * 17) * weight;
    total += weight;
    weight *= 0.5;
  }
  return value / total;
}

interface Cell {
  edge: number;
  id: number;
}

/** Periodic F1/F2 Voronoi cells; `edge` is small on a crack between plates. */
function voronoi(u: number, v: number, nx: number, ny: number, seed: number): Cell {
  const x = u * nx;
  const y = v * ny;
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  let f1 = 1e9;
  let f2 = 1e9;
  let id = 0;
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      const gx = cx + ox;
      const gy = cy + oy;
      const wx = ((gx % nx) + nx) % nx;
      const wy = ((gy % ny) + ny) % ny;
      const fx = (gx + hash2(wx, wy, seed)) / nx;
      const fy = (gy + hash2(wx, wy, seed + 11)) / ny;
      let dx = u - fx;
      let dy = v - fy;
      dx -= Math.round(dx);
      dy -= Math.round(dy);
      const d = Math.hypot(dx, dy);
      if (d < f1) {
        f2 = f1;
        f1 = d;
        id = wx * 37 + wy;
      } else if (d < f2) {
        f2 = d;
      }
    }
  }
  return { edge: f2 - f1, id };
}

function barkPixel(layer: number, u: number, v: number): [number, number, number] {
  switch (layer) {
    case BARK_LAYER.FURROWED: {
      // Deep vertical valleys that braid left and right down the trunk.
      const warp = (noise2(u, v, 3, 2, 41) - 0.5) * 0.9 + (noise2(u, v, 5, 3, 67) - 0.5) * 0.35;
      const braid = Math.sin(Math.PI * 2 * (u * 4 + warp * 0.5));
      const ridge = Math.pow(Math.abs(braid), 0.55);
      const grain = noise2(u, v, 22, 5, 91);
      const shade = (0.55 + 0.47 * ridge) * (0.94 + 0.12 * grain);
      return [
        clampByte(198 * shade, BARK_MIN, BARK_MAX),
        clampByte(178 * shade, BARK_MIN, BARK_MAX),
        clampByte(150 * shade, BARK_MIN, BARK_MAX),
      ];
    }
    case BARK_LAYER.MOTTLED: {
      // Plane: camouflage patches of cream, olive and grey-green.
      const patches = fbm(u, v, 3, 3, 3, 113);
      const fine = noise2(u, v, 18, 18, 131);
      let base: readonly [number, number, number];
      if (patches > 0.58) base = [235, 228, 200];
      else if (patches < 0.43) base = [150, 150, 110];
      else base = [188, 192, 170];
      const edge = Math.abs(patches - 0.58) < 0.012 || Math.abs(patches - 0.43) < 0.012 ? 0.82 : 1;
      const shade = (0.92 + 0.16 * fine) * edge;
      return [
        clampByte(base[0] * shade, BARK_MIN, BARK_MAX),
        clampByte(base[1] * shade, BARK_MIN, BARK_MAX),
        clampByte(base[2] * shade, BARK_MIN, BARK_MAX),
      ];
    }
    case BARK_LAYER.SMOOTH_LENTICEL: {
      // Poplar / ailanthus: smooth grey bark with short horizontal dashes.
      const grain = noise2(u, v, 4, 4, 151);
      const raw = noise2(u, v, 9, 28, 160);
      const dash = Math.max(0, (raw - 0.55) / 0.45);
      const shade = (0.94 + 0.12 * grain) * (1 - 0.30 * dash * dash);
      return [
        clampByte(216 * shade, BARK_MIN, BARK_MAX),
        clampByte(210 * shade, BARK_MIN, BARK_MAX),
        clampByte(201 * shade, BARK_MIN, BARK_MAX),
      ];
    }
    case BARK_LAYER.PLATED_PINE: {
      // Pine: polygonal plates with dark cracks between them.
      const cell = voronoi(u, v, 5, 7, 173);
      const plate = 0.92 + 0.16 * hash01(cell.id + 173);
      const grain = noise2(u, v, 16, 16, 179);
      if (cell.edge < 0.028) {
        return [
          clampByte(118 + 10 * grain, BARK_MIN, BARK_MAX),
          clampByte(102 + 8 * grain, BARK_MIN, BARK_MAX),
          clampByte(84 + 7 * grain, BARK_MIN, BARK_MAX),
        ];
      }
      const shade = plate * (0.94 + 0.12 * grain);
      return [
        clampByte(194 * shade, BARK_MIN, BARK_MAX),
        clampByte(176 * shade, BARK_MIN, BARK_MAX),
        clampByte(150 * shade, BARK_MIN, BARK_MAX),
      ];
    }
    case BARK_LAYER.FIBROUS: {
      // Thuja: long, thin reddish strips with a shallow warp.
      const warp = (noise2(u, v, 3, 2, 191) - 0.5) * 0.06;
      const strip = Math.sin(Math.PI * 2 * (u * 10 + 0.75 + warp));
      const ridge = 0.5 + 0.5 * strip;
      const fine = noise2(u, v, 8, 4, 197);
      const shade = (0.78 + 0.30 * ridge) * (0.96 + 0.07 * fine);
      return [
        clampByte(206 * shade, BARK_MIN, BARK_MAX),
        clampByte(166 * shade, BARK_MIN, BARK_MAX),
        clampByte(136 * shade, BARK_MIN, BARK_MAX),
      ];
    }
    default: {
      // Linden / maple / chestnut: shallow, mostly vertical fine fissures.
      const warp = (noise2(u, v, 3, 2, 219) - 0.5) * 0.04;
      const streak = noise2(u + warp, v, 20, 7, 218);
      const fissure = Math.max(0, (0.42 - streak) / 0.42);
      const grain = noise2(u, v, 20, 20, 220);
      const shade = (0.96 + 0.07 * grain) * (1 - 0.13 * fissure * fissure);
      return [
        clampByte(198 * shade, BARK_MIN, BARK_MAX),
        clampByte(186 * shade, BARK_MIN, BARK_MAX),
        clampByte(166 * shade, BARK_MIN, BARK_MAX),
      ];
    }
  }
}

/** RGBA8, BARK_LAYERS layers of size×size, layer-major; tileable in u and v. */
export function makeBarkLayers(size = 64): Uint8Array {
  const data = new Uint8Array(size * size * 4 * BARK_LAYERS);
  for (let layer = 0; layer < BARK_LAYERS; layer++) {
    const offset = layer * size * size * 4;
    for (let y = 0; y < size; y++) {
      const v = y / size;
      for (let x = 0; x < size; x++) {
        const [r, g, b] = barkPixel(layer, x / size, v);
        const o = offset + (y * size + x) * 4;
        data[o] = r;
        data[o + 1] = g;
        data[o + 2] = b;
        data[o + 3] = 255;
      }
    }
  }
  return data;
}

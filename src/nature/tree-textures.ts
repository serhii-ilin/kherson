/**
 * Procedural leaf-cluster and bark textures for the realistic trees.
 *
 * Pure data generation: RGBA8, layer-major and rows bottom-up as WebGL expects, with no DOM
 * and no `three` import. `tree-atlas.ts` owns the layer indices; the renderer turns these
 * arrays into `THREE.DataArrayTexture` layers later. Everything is deterministic.
 */
import { BARK_LAYER, BARK_LAYERS, LEAF_LAYER, LEAF_LAYERS } from './tree-atlas.ts';

/** Leaf cards are nearly neutral: the shader multiplies them by the species vertex colour. */
const LEAF_RGB: readonly [number, number, number] = [232, 239, 230];
const BLOSSOM_RGB: readonly [number, number, number] = [252, 250, 252];
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

function buildCluster(layer: number): LeafPrim[] {
  const out: LeafPrim[] = [];
  switch (layer) {
    case LEAF_LAYER.PALMATE: {
      // Horse chestnut: seven leaflets fanned from one bud.
      const baseX = 0.5;
      const baseY = 0.15;
      const count = 7;
      for (let i = 0; i < count; i++) {
        const angle = -0.72 + (1.44 * i) / (count - 1);
        const half = (i === 3 ? 0.39 : 0.36) + 0.012 * Math.cos(i * 1.7);
        out.push(prim(
          'oval',
          baseX + Math.sin(angle) * half,
          baseY + Math.cos(angle) * half,
          half,
          0.10,
          angle,
          i,
        ));
      }
      out.push(prim('oval', 0.5, 0.11, 0.09, 0.012, 0, 0));
      break;
    }
    case LEAF_LAYER.HEART: {
      // Linden: a few small heart leaves on short stems.
      out.push(prim('heart', 0.5, 0.53, 0.40, 0.36, 0, 0));
      out.push(prim('heart', 0.38, 0.57, 0.30, 0.21, -0.55, 1));
      out.push(prim('heart', 0.62, 0.57, 0.30, 0.21, 0.55, 2));
      out.push(prim('heart', 0.5, 0.29, 0.27, 0.24, 0.06, 3));
      out.push(prim('oval', 0.5, 0.19, 0.12, 0.009, 0, 0));
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
      // Maple / plane: three five-lobed leaves spread across the card.
      addLobed(out, 0.50, 0.26, 1.0, 0, 0);
      addLobed(out, 0.30, 0.56, 0.74, -0.42, 5);
      addLobed(out, 0.70, 0.56, 0.74, 0.42, 10);
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
      // Elm / mulberry: small serrated leaves alternating on a twig.
      const stemX0 = 0.27;
      const stemY0 = 0.16;
      const stemX1 = 0.68;
      const stemY1 = 0.84;
      out.push(prim('oval', (stemX0 + stemX1) / 2, (stemY0 + stemY1) / 2, 0.35, 0.008, -0.55, 0));
      for (let i = 0; i < 13; i++) {
        const t = 0.05 + (0.9 * i) / 12;
        const bx = stemX0 + (stemX1 - stemX0) * t;
        const by = stemY0 + (stemY1 - stemY0) * t;
        const side = i % 2 === 0 ? -1 : 1;
        const angle = side * 0.92;
        const half = 0.165;
        out.push(prim(
          'oval',
          bx + Math.sin(angle) * half,
          by + Math.cos(angle) * half,
          half,
          0.083,
          angle,
          i,
          true,
        ));
      }
      break;
    }
    case LEAF_LAYER.LANCEOLATE: {
      // Willow: narrow leaves hanging from a twig.
      out.push(prim('oval', 0.5, 0.52, 0.38, 0.007, 0, 0));
      for (let i = 0; i < 8; i++) {
        const by = 0.86 - i * 0.07;
        const side = i % 2 === 0 ? -1 : 1;
        const angle = Math.PI - side * 1.15;
        const half = 0.24;
        out.push(prim(
          'lanceolate',
          0.5 + Math.sin(angle) * half,
          by + Math.cos(angle) * half,
          half,
          0.08,
          angle,
          i,
        ));
      }
      break;
    }
    case LEAF_LAYER.TRIANGULAR: {
      // Poplar: broad triangular leaves spread around a shoot.
      out.push(prim('triangular', 0.5, 0.57, 0.34, 0.23, 0, 0));
      out.push(prim('triangular', 0.36, 0.68, 0.22, 0.15, -0.45, 1));
      out.push(prim('triangular', 0.64, 0.68, 0.22, 0.15, 0.45, 2));
      out.push(prim('triangular', 0.30, 0.76, 0.16, 0.11, -0.50, 8));
      out.push(prim('triangular', 0.70, 0.76, 0.16, 0.11, 0.50, 9));
      out.push(prim('triangular', 0.34, 0.46, 0.28, 0.17, -0.70, 3));
      out.push(prim('triangular', 0.66, 0.46, 0.28, 0.17, 0.70, 4));
      out.push(prim('triangular', 0.38, 0.25, 0.24, 0.17, -0.30, 5));
      out.push(prim('triangular', 0.62, 0.25, 0.24, 0.17, 0.30, 6));
      out.push(prim('triangular', 0.5, 0.20, 0.18, 0.13, Math.PI, 7));
      out.push(prim('oval', 0.5, 0.12, 0.09, 0.012, 0, 0));
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
        [0.64, -0.60, 0.28], [0.64, 0.60, 0.28],
        [0.28, -1.15, 0.36], [0.28, 1.15, 0.36],
        [0.48, -1.10, 0.28], [0.48, 1.10, 0.28],
      ];
      let group = 1;
      for (const [baseY, branchAngle, branchLen] of branchlets) {
        for (let i = 0; i < 7; i++) {
          const t = 0.1 + i * 0.14;
          const bx = 0.5 + Math.sin(branchAngle) * branchLen * t;
          const by = baseY + Math.cos(branchAngle) * branchLen * t;
          out.push(prim('oval', bx, by, 0.080, 0.058, branchAngle, group));
          const side = i % 2 === 0 ? -1 : 1;
          const angle = branchAngle + side * 0.9;
          out.push(prim(
            'oval',
            bx + Math.sin(angle) * 0.045,
            by + Math.cos(angle) * 0.045,
            0.075,
            0.052,
            angle,
            group + 1,
          ));
          out.push(prim(
            'oval',
            bx - Math.sin(angle) * 0.045,
            by - Math.cos(angle) * 0.045,
            0.068,
            0.048,
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
  const variation = blossom ? 0.94 + 0.12 * hash01(layer * 1009 + group) : 0.88 + 0.24 * hash01(layer * 1009 + group);
  const tip = 1 + 0.10 * t;
  let vein = 1;
  if (blossom) {
    if (Math.abs(b) < 0.05) vein = 0.9;
  } else if (Math.abs(b) < 0.075) {
    vein = 0.75;
  }
  const shade = variation * tip * vein;
  return [
    clampByte(base[0] * shade),
    clampByte(base[1] * shade),
    clampByte(base[2] * shade),
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
      const dash = noise2(u, v, 9, 28, 157);
      const shade = (0.94 + 0.12 * grain) * (dash > 0.68 ? 0.70 : 1);
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
      const strip = Math.sin(Math.PI * 2 * (u * 10 + warp));
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
      // Linden / maple / chestnut: fine shallow fissures.
      const fissure = noise2(u, v, 12, 6, 211);
      const grain = noise2(u, v, 20, 20, 223);
      const crack = Math.abs(fissure - 0.5) < 0.05 ? 0.84 : 1;
      const shade = crack * (0.95 + 0.10 * grain);
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

export const MICRO = 0.5;

export const SPECIES = {
  GENERIC: 0, CHESTNUT: 1, LINDEN: 2, ACACIA: 3, POPLAR: 4, WILLOW: 5, PINE: 6, PLANE: 7,
  BUSH: 16, BUSH_LILAC: 17, BUSH_PINK: 18,
} as const;

export const TREE_SPECIES: readonly number[] = [1, 2, 3, 4, 5, 6, 7];
export const BUSH_SPECIES: readonly number[] = [16, 17, 18];
export const VARIANTS = 3;

export interface VegModel {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  sway: Float32Array;
  indices: Uint32Array;
  height: number;
  radius: number;
}

function mulberry32(seed: number): () => number {
  return function() {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = t + Math.imul(t ^ (t >>> 7), 61 | t) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.substring(0, 2), 16) / 255,
    parseInt(h.substring(2, 4), 16) / 255,
    parseInt(h.substring(4, 6), 16) / 255,
  ];
}

interface SpeciesShape {
  trunkRadius: number;
  trunkHeight: number;
  crownRadius: number;
  crownHeight: number;
  crownBaseHeight: number;
  color: [number, number, number];
  trunkColor: [number, number, number];
  bushCap?: number;
}

function getSpeciesShape(species: number, variant: number, rng: () => number): SpeciesShape {
  const speciesId = species === SPECIES.GENERIC ? (variant === 1 ? SPECIES.LINDEN : SPECIES.CHESTNUT) : species;

  const variation = 1 + (rng() - 0.5) * 0.3;

  const shapes: Record<number, SpeciesShape> = {
    [SPECIES.CHESTNUT]: {
      trunkRadius: 0.25 * variation,
      trunkHeight: 2.5 * variation,
      crownRadius: 3.5 * variation,
      crownHeight: 6.5 * variation,
      crownBaseHeight: 2.5 * variation,
      color: hexToRgb('#3f6b2a'),
      trunkColor: hexToRgb('#6b4f36'),
    },
    [SPECIES.LINDEN]: {
      trunkRadius: 0.25 * variation,
      trunkHeight: 2.8 * variation,
      crownRadius: 3.2 * variation,
      crownHeight: 7.5 * variation,
      crownBaseHeight: 2.8 * variation,
      color: hexToRgb('#557d34'),
      trunkColor: hexToRgb('#6b4f36'),
    },
    [SPECIES.PLANE]: {
      trunkRadius: 0.3 * variation,
      trunkHeight: 2.5 * variation,
      crownRadius: 4.2 * variation,
      crownHeight: 10 * variation,
      crownBaseHeight: 2.5 * variation,
      color: hexToRgb('#5f8a3a'),
      trunkColor: hexToRgb('#9a8c78'),
    },
    [SPECIES.ACACIA]: {
      trunkRadius: 0.2 * variation,
      trunkHeight: 1.5 * variation,
      crownRadius: 4 * variation,
      crownHeight: 7 * variation,
      crownBaseHeight: 1.5 * variation,
      color: hexToRgb('#7a9a45'),
      trunkColor: hexToRgb('#6b4f36'),
    },
    [SPECIES.POPLAR]: {
      trunkRadius: 0.6 * variation,
      trunkHeight: 5 * variation,
      crownRadius: 1.2 * variation,
      crownHeight: 18 * variation,
      crownBaseHeight: 2 * variation,
      color: hexToRgb('#4c7a30'),
      trunkColor: hexToRgb('#6b4f36'),
    },
    [SPECIES.WILLOW]: {
      trunkRadius: 0.3 * variation,
      trunkHeight: 2.5 * variation,
      crownRadius: 4 * variation,
      crownHeight: 5 * variation,
      crownBaseHeight: 0.8 * variation,
      color: hexToRgb('#8aa66a'),
      trunkColor: hexToRgb('#6b4f36'),
    },
    [SPECIES.PINE]: {
      trunkRadius: 0.4 * variation,
      trunkHeight: 6 * variation,
      crownRadius: 3 * variation,
      crownHeight: 14 * variation,
      crownBaseHeight: 3 * variation,
      color: hexToRgb('#2f5534'),
      trunkColor: hexToRgb('#8b5a3c'),
    },
    [SPECIES.BUSH]: {
      trunkRadius: 0.1,
      trunkHeight: 0,
      crownRadius: 0.8 + rng() * 0.6,
      crownHeight: 0.8 + rng() * 1.0,
      crownBaseHeight: 0,
      color: hexToRgb('#4f7a33'),
      trunkColor: hexToRgb('#4f7a33'),
      bushCap: 0.6,
    },
    [SPECIES.BUSH_LILAC]: {
      trunkRadius: 0.1,
      trunkHeight: 0,
      crownRadius: 0.8 + rng() * 0.6,
      crownHeight: 0.8 + rng() * 1.0,
      crownBaseHeight: 0,
      color: hexToRgb('#b48ad6'),
      trunkColor: hexToRgb('#b48ad6'),
      bushCap: 0.6,
    },
    [SPECIES.BUSH_PINK]: {
      trunkRadius: 0.1,
      trunkHeight: 0,
      crownRadius: 0.8 + rng() * 0.6,
      crownHeight: 0.8 + rng() * 1.0,
      crownBaseHeight: 0,
      color: hexToRgb('#e48aa8'),
      trunkColor: hexToRgb('#e48aa8'),
      bushCap: 0.6,
    },
  };

  return shapes[speciesId] || shapes[SPECIES.CHESTNUT];
}

type Profile = 'round' | 'cone' | 'column' | 'dome';

function profileOf(species: number, variant: number): Profile {
  const id = species === SPECIES.GENERIC ? (variant === 1 ? SPECIES.LINDEN : SPECIES.CHESTNUT) : species;
  if (id === SPECIES.PINE) return 'cone';
  if (id === SPECIES.POPLAR) return 'column';
  if (id >= SPECIES.BUSH) return 'dome';
  return 'round';
}

/** Radius multiplier of the crown at relative height t in [0, 1]. */
function profileAt(p: Profile, t: number): number {
  switch (p) {
    case 'cone': return Math.max(0.12, 1 - t * 0.88);
    case 'column': return 0.55 + 0.45 * Math.sin(Math.PI * Math.min(1, 0.1 + t * 0.9));
    case 'dome': return Math.sqrt(Math.max(0, 1 - t * t));
    default: return Math.pow(Math.sin(Math.PI * Math.min(1, 0.08 + t * 0.9)), 0.55) * 0.95 + 0.05;
  }
}

/** Deterministic hash of integer coordinates to [0, 1). */
function h3(a: number, b: number, c: number, s: number): number {
  let h = Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca6b) ^ Math.imul(c | 0, 0xc2b2ae35) ^ Math.imul(s | 0, 0x27d4eb2f);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

const MAT_LEAF = 1;
const MAT_TRUNK = 2;
const TONES = [0.86, 1.0, 1.12];

interface Occupancy {
  grid: Uint8Array;
  nx: number;
  ny: number;
  nz: number;
  /** World x/z of the grid origin corner (cell 0), metres. */
  origin: number;
  shape: SpeciesShape;
  height: number;
  radius: number;
}

/** Fine (MICRO) occupancy grid: 1 = leaf, 2 = trunk. Shared by lod 0 and lod 2. */
function buildOccupancy(species: number, variant: number, rng: () => number, noise = 0.14, bandH = 1.0): Occupancy {
  const shape = getSpeciesShape(species, variant, rng);
  const profile = profileOf(species, variant);
  const height = Math.max(shape.trunkHeight, shape.crownBaseHeight + shape.crownHeight);
  const radius = Math.max(shape.trunkRadius, shape.crownRadius);
  const half = Math.ceil((radius * 1.25) / MICRO) + 1;
  const nx = 2 * half + 2;
  const nz = nx;
  let ny = Math.ceil(height / MICRO) + 2;
  if (ny & 1) ny++;
  const grid = new Uint8Array(nx * ny * nz);
  const at = (x: number, y: number, z: number): number => x + z * nx + y * nx * nz;
  const sd = species * 31 + variant * 977;

  if (shape.trunkHeight > 0) {
    const r = Math.max(shape.trunkRadius, MICRO * 0.5);
    for (let y = 0; y < ny; y++) {
      if ((y + 0.5) * MICRO > shape.trunkHeight) break;
      for (let z = 0; z < nz; z++) {
        for (let x = 0; x < nx; x++) {
          const dx = (x - half) * MICRO;
          const dz = (z - half) * MICRO;
          if (dx * dx + dz * dz <= r * r + 0.01) grid[at(x, y, z)] = MAT_TRUNK;
        }
      }
    }
  }

  const cs = shape.crownBaseHeight;
  for (let y = 0; y < ny; y++) {
    const yc = (y + 0.5) * MICRO;
    if (yc < cs || yc > cs + shape.crownHeight) continue;
    const yq = (Math.floor(yc / bandH) + 0.5) * bandH;
    const t = Math.min(1, Math.max(0, (yq - cs) / shape.crownHeight));
    const band = Math.floor(yc / 2.0);
    const rBase = shape.crownRadius * profileAt(profile, t);
    for (let z = 0; z < nz; z++) {
      for (let x = 0; x < nx; x++) {
        const dx = (x - half) * MICRO;
        const dz = (z - half) * MICRO;
        const ang = Math.atan2(dz, dx);
        const sector = Math.floor(((ang + Math.PI) / (2 * Math.PI)) * 6);
        const n = h3(sector, band, 1, sd) * 2 - 1;
        const rr = rBase * (1 + noise * n);
        if (dx * dx + dz * dz <= rr * rr && grid[at(x, y, z)] === 0) grid[at(x, y, z)] = MAT_LEAF;
      }
    }
  }

  // drop isolated protruding leaf voxels
  for (let pass = 0; pass < (profile === 'dome' ? 0 : 2); pass++) {
    const kill: number[] = [];
    for (let y = 1; y < ny; y++) {
      for (let z = 0; z < nz; z++) {
        for (let x = 0; x < nx; x++) {
          const i = at(x, y, z);
          if (grid[i] !== MAT_LEAF) continue;
          let n = 0;
          if (x > 0 && grid[i - 1]) n++;
          if (x < nx - 1 && grid[i + 1]) n++;
          if (z > 0 && grid[i - nx]) n++;
          if (z < nz - 1 && grid[i + nx]) n++;
          if (grid[i - nx * nz]) n++;
          if (y < ny - 1 && grid[i + nx * nz]) n++;
          if (n <= 1) kill.push(i);
        }
      }
    }
    for (const i of kill) grid[i] = 0;
  }

  return { grid, nx, ny, nz, origin: -(half + 0.5) * MICRO, shape, height, radius };
}

class MeshOut {
  positions: number[] = [];
  normals: number[] = [];
  colors: number[] = [];
  sway: number[] = [];
  indices: number[] = [];
  private readonly height: number;
  private readonly cap: number | undefined;
  constructor(height: number, cap: number | undefined) {
    this.height = height;
    this.cap = cap;
  }

  /** Axis-aligned quad: `axis` is the normal axis, `sign` its direction, `plane` the coordinate along it. */
  quad(axis: number, sign: number, plane: number, u0: number, v0: number, u1: number, v1: number, col: [number, number, number]): void {
    const ua = (axis + 1) % 3;
    const va = (axis + 2) % 3;
    const base = this.positions.length / 3;
    const corners: [number, number][] = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
    for (const [u, v] of corners) {
      const p = [0, 0, 0];
      p[axis] = plane;
      p[ua] = u;
      p[va] = v;
      this.positions.push(p[0]!, p[1]!, p[2]!);
      const n = [0, 0, 0];
      n[axis] = sign;
      this.normals.push(n[0]!, n[1]!, n[2]!);
      this.colors.push(col[0], col[1], col[2]);
      let s = Math.pow(Math.max(0, p[1]! / Math.max(0.01, this.height)), 1.5);
      if (this.cap !== undefined) s = Math.min(s, this.cap);
      this.sway.push(Math.max(0, Math.min(1, s)));
    }
    if (sign > 0) this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    else this.indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }

  toModel(height: number, radius: number): VegModel {
    return {
      positions: new Float32Array(this.positions),
      normals: new Float32Array(this.normals),
      colors: new Float32Array(this.colors),
      sway: new Float32Array(this.sway),
      indices: new Uint32Array(this.indices),
      height,
      radius,
    };
  }
}

const FACE_SHADE = [0.82, 0.6, 1.0]; // by direction class: side, bottom, top

/**
 * Greedy-meshes a voxel grid (`mats` 1/2, `tones` 0..2): coplanar faces of identical material
 * and tone merge into rectangles. Cells are `cell` metres, grid cell 0 starts at (origin, 0, origin).
 */
function meshGrid(
  out: MeshOut, mats: Uint8Array, tones: Uint8Array, nx: number, ny: number, nz: number,
  cell: number, origin: number, shape: SpeciesShape,
): void {
  const dims = [nx, ny, nz];
  const stride = [1, nx * nz, nx]; // x, y, z strides... index = x + z*nx + y*nx*nz
  const org = [origin, 0, origin];
  const get = (c: number[]): number => {
    if (c[0]! < 0 || c[1]! < 0 || c[2]! < 0 || c[0]! >= nx || c[1]! >= ny || c[2]! >= nz) return 0;
    return mats[c[0]! * stride[0]! + c[1]! * stride[1]! + c[2]! * stride[2]!]!;
  };
  const pos = [0, 0, 0];
  const nb = [0, 0, 0];
  for (let axis = 0; axis < 3; axis++) {
    const ua = (axis + 1) % 3;
    const va = (axis + 2) % 3;
    const du = dims[ua]!;
    const dv = dims[va]!;
    const mask = new Int32Array(du * dv);
    for (const sign of [1, -1]) {
      for (let s = 0; s < dims[axis]!; s++) {
        mask.fill(0);
        for (let v = 0; v < dv; v++) {
          for (let u = 0; u < du; u++) {
            pos[axis] = s; pos[ua] = u; pos[va] = v;
            const m = get(pos);
            if (m === 0) continue;
            nb[axis] = s + sign; nb[ua] = u; nb[va] = v;
            if (get(nb) !== 0) continue;
            const ti = pos[0]! * stride[0]! + pos[1]! * stride[1]! + pos[2]! * stride[2]!;
            mask[u + v * du] = m * 3 + tones[ti]! + 1; // 1 + (m-1)*3 + tone .. nonzero
          }
        }
        for (let v = 0; v < dv; v++) {
          for (let u = 0; u < du; ) {
            const k = mask[u + v * du]!;
            if (k === 0) { u++; continue; }
            let w = 1;
            while (u + w < du && mask[u + w + v * du] === k) w++;
            let h = 1;
            outer: for (; v + h < dv; h++) {
              for (let i = 0; i < w; i++) if (mask[u + i + (v + h) * du] !== k) break outer;
            }
            for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) mask[u + i + (v + j) * du] = 0;
            const mat = Math.floor((k - 1) / 3);
            const tone = (k - 1) % 3;
            const base = mat === MAT_LEAF ? shape.color : shape.trunkColor;
            const shade = axis === 1 ? (sign > 0 ? FACE_SHADE[2]! : FACE_SHADE[1]!) : FACE_SHADE[0]!;
            const f = TONES[tone]! * shade;
            const plane = org[axis]! + (s + (sign > 0 ? 1 : 0)) * cell;
            out.quad(
              axis, sign, plane,
              org[ua]! + u * cell, org[va]! + v * cell,
              org[ua]! + (u + w) * cell, org[va]! + (v + h) * cell,
              [base[0] * f, base[1] * f, base[2] * f],
            );
            u += w;
          }
        }
      }
    }
  }
}

function buildLod0(species: number, variant: number, rng: () => number): VegModel {
  const o = buildOccupancy(species, variant, rng);
  const tones = new Uint8Array(o.grid.length);
  const sd = species * 13 + variant * 101;
  const BX = 4, BY = 4;
  for (let y = 0; y < o.ny; y++) {
    for (let z = 0; z < o.nz; z++) {
      for (let x = 0; x < o.nx; x++) {
        tones[x + z * o.nx + y * o.nx * o.nz] = Math.floor(h3(Math.floor(x / BX), Math.floor(y / BY), Math.floor(z / BX), sd) * 3);
      }
    }
  }
  const out = new MeshOut(o.height, o.shape.bushCap);
  meshGrid(out, o.grid, tones, o.nx, o.ny, o.nz, MICRO, o.origin, o.shape);
  return out.toModel(o.height, o.radius);
}

/** Mid LOD: the same occupancy downsampled to a 1 m grid (majority material). */
function buildLod2(species: number, variant: number, rng: () => number): VegModel {
  const o = buildOccupancy(species, variant, rng, 0.04, profileOf(species, variant) === 'dome' ? 0.5 : 2.0);
  const cx = o.nx >> 1, cy = o.ny >> 1, cz = o.nz >> 1;
  const mats = new Uint8Array(cx * cy * cz);
  const tones = new Uint8Array(cx * cy * cz);
  const sd = species * 17 + variant * 59;
  for (let y = 0; y < cy; y++) {
    for (let z = 0; z < cz; z++) {
      for (let x = 0; x < cx; x++) {
        let leaf = 0, trunk = 0;
        for (let dy = 0; dy < 2; dy++) for (let dz = 0; dz < 2; dz++) for (let dx = 0; dx < 2; dx++) {
          const m = o.grid[(2 * x + dx) + (2 * z + dz) * o.nx + (2 * y + dy) * o.nx * o.nz]!;
          if (m === MAT_LEAF) leaf++;
          else if (m === MAT_TRUNK) trunk++;
        }
        const i = x + z * cx + y * cx * cz;
        if (trunk >= 2 && trunk >= leaf) mats[i] = MAT_TRUNK;
        else if (leaf >= 3 || (leaf >= 2 && o.shape.bushCap !== undefined)) mats[i] = MAT_LEAF;
        tones[i] = Math.floor(h3(x >> 2, y >> 2, z >> 2, sd) * 3);
      }
    }
  }
  // smooth the coarse silhouette: drop leaf cells that only hang on by <= 2 neighbours
  for (let pass = 0; pass < 4; pass++) {
  const kill: number[] = [];
  for (let y = 1; y < cy; y++) {
    for (let z = 1; z < cz - 1; z++) {
      for (let x = 1; x < cx - 1; x++) {
        const i = x + z * cx + y * cx * cz;
        if (mats[i] !== MAT_LEAF) continue;
        let n = 0;
        if (mats[i - 1]) n++;
        if (mats[i + 1]) n++;
        if (mats[i - cx]) n++;
        if (mats[i + cx]) n++;
        if (mats[i - cx * cz]) n++;
        if (y < cy - 1 && mats[i + cx * cz]) n++;
        if (n <= 2) kill.push(i);
      }
    }
  }
  if (o.shape.bushCap === undefined) for (const i of kill) mats[i] = 0;
  }
  const out = new MeshOut(o.height, o.shape.bushCap);
  meshGrid(out, mats, tones, cx, cy, cz, MICRO * 2, o.origin, o.shape);
  return out.toModel(o.height, o.radius);
}

function buildLod1(species: number, variant: number, rng: () => number): VegModel {
  const shape = getSpeciesShape(species, variant, rng);
  const height = Math.max(shape.trunkHeight, shape.crownBaseHeight + shape.crownHeight);
  const radius = Math.max(shape.trunkRadius, shape.crownRadius);
  const out = new MeshOut(height, shape.bushCap);

  function addBox(r: number, y0: number, y1: number, col: [number, number, number]): void {
    for (let axis = 0; axis < 3; axis++) {
      for (const sign of [1, -1]) {
        const shade = axis === 1 ? (sign > 0 ? FACE_SHADE[2]! : FACE_SHADE[1]!) : FACE_SHADE[0]!;
        const c: [number, number, number] = [col[0] * shade, col[1] * shade, col[2] * shade];
        const lo = [-r, y0, -r];
        const hi = [r, y1, r];
        const ua = (axis + 1) % 3;
        const va = (axis + 2) % 3;
        out.quad(axis, sign, sign > 0 ? hi[axis]! : lo[axis]!, lo[ua]!, lo[va]!, hi[ua]!, hi[va]!, c);
      }
    }
  }
  if (shape.trunkHeight > 0) addBox(shape.trunkRadius, 0, shape.trunkHeight, shape.trunkColor);
  addBox(shape.crownRadius, shape.crownBaseHeight, shape.crownBaseHeight + shape.crownHeight, shape.color);
  return out.toModel(height, radius);
}

/** lod 0 = near (0.5 m voxels), 1 = far boxes, 2 = mid (1 m voxels). */
export function buildModel(species: number, variant: number, lod: 0 | 1 | 2): VegModel {
  const rng = mulberry32(species * 7919 + variant * 104729);
  if (lod === 0) return buildLod0(species, variant, rng);
  if (lod === 2) return buildLod2(species, variant, rng);
  return buildLod1(species, variant, rng);
}

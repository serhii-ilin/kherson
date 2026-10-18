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
  /** Per vertex: 1 = leaf/blossom (may be cut out by the shader), 0 = wood. Only on the finest model (lod 3). */
  leaf?: Float32Array;
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
  leaf: number[] | null = null;
  /** Written to `leaf` for each new vertex when `leaf` is tracked. */
  curLeaf = 1;
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
      if (this.leaf !== null) this.leaf.push(this.curLeaf);
      let s = Math.pow(Math.max(0, p[1]! / Math.max(0.01, this.height)), 1.5);
      if (this.cap !== undefined) s = Math.min(s, this.cap);
      this.sway.push(Math.max(0, Math.min(1, s)));
    }
    if (sign > 0) this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    else this.indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }

  toModel(height: number, radius: number): VegModel {
    const m: VegModel = {
      positions: new Float32Array(this.positions),
      normals: new Float32Array(this.normals),
      colors: new Float32Array(this.colors),
      sway: new Float32Array(this.sway),
      indices: new Uint32Array(this.indices),
      height,
      radius,
    };
    if (this.leaf !== null) m.leaf = new Float32Array(this.leaf);
    return m;
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

// ------------------------------------------------------------------ finest LOD (0.2 m)

/** Voxel size of the finest model, metres. */
export const FINE = 0.2;
/** Triangle caps of the finest model (Constitution Article 4). */
export const FINE_MAX_TRIS_TREE = 6000;
export const FINE_MAX_TRIS_BUSH = 1500;

const MAT_BLOSSOM = 3;
const LEVELS = 16;
const FINE_STEM: [number, number, number] = [0.35, 0.27, 0.19];
const FINE_FOLIAGE: [number, number, number] = [0.29, 0.43, 0.2];

/** A leaf cluster (ellipsoid of 0.2 m voxels) on the end of a branch. */
interface Unit {
  cx: number; cy: number; cz: number;
  rx: number; ry: number;
  /** Branch from (ax, ay, az) to the cluster centre. */
  ax: number; ay: number; az: number;
  /** Radius of the branch at its start. */
  br: number;
}

interface FinePlan {
  shape: SpeciesShape;
  profile: Profile;
  isBush: boolean;
  flowering: boolean;
  units: Unit[];
  nPrimary: number;
  height: number;
  radius: number;
  leader: number;
  seed: number;
}

function planFine(species: number, variant: number, rng: () => number): FinePlan {
  const shape = getSpeciesShape(species, variant, rng);
  const id = species === SPECIES.GENERIC ? (variant === 1 ? SPECIES.LINDEN : SPECIES.CHESTNUT) : species;
  const profile = profileOf(species, variant);
  const isBush = id >= SPECIES.BUSH;
  const flowering = id === SPECIES.BUSH_LILAC || id === SPECIES.BUSH_PINK;
  const height = Math.max(shape.trunkHeight, shape.crownBaseHeight + shape.crownHeight);
  const radius = Math.max(shape.trunkRadius, shape.crownRadius);
  const r2 = mulberry32(species * 31337 + variant * 7001 + 17);
  const seed = species * 53 + variant * 389;
  const cs = shape.crownBaseHeight;
  const ch = shape.crownHeight;
  const R = shape.crownRadius;
  const crownR = (y: number): number => R * profileAt(profile, Math.min(1, Math.max(0, (y - cs) / ch)));

  // Big overlapping lumps whose union is a dense rounded mass (same envelope as the 0.5 m model).
  let rx = Math.min(1.7, Math.max(isBush ? 0.35 : 0.9, R * 0.42));
  let ryk = 0.8;
  if (profile === 'column') { rx = R * 0.95; ryk = 1.9; }
  else if (profile === 'cone') { rx = Math.max(0.9, R * 0.45); ryk = 0.75; }
  else if (id === SPECIES.WILLOW) { ryk = 1.1; }
  else if (isBush) ryk = 0.9;
  const ry = rx * ryk;
  const units: Unit[] = [];
  const mk = (cx: number, cy: number, cz: number, ur: number, vr: number): Unit => ({
    cx, cy, cz, rx: ur, ry: vr, ax: 0, ay: 0, az: 0, br: 0,
  });
  const y0 = cs + Math.min(ry * 0.7, ch * 0.3);
  const y1 = Math.max(y0, cs + ch - ry * 0.95);
  const bands = Math.max(1, Math.round((y1 - y0) / (ry * 0.95)) + 1);
  for (let b = 0; b < bands; b++) {
    const y = bands === 1 ? (y0 + y1) / 2 : y0 + ((y1 - y0) * b) / (bands - 1);
    const rb = crownR(y);
    const off = Math.max(0, rb * 1.0 - rx * 0.75);
    if (off < rx * 0.35) {
      units.push(mk(0, y, 0, Math.max(rx * 0.8, rb * 1.02), ry));
      continue;
    }
    const m = Math.max(3, Math.round((2 * Math.PI * off) / (rx * 1.15)));
    const a0 = r2() * Math.PI * 2;
    for (let k = 0; k < m; k++) {
      const a = a0 + (k / m) * Math.PI * 2 + (r2() - 0.5) * 0.25;
      const jr = off * (0.95 + r2() * 0.1);
      units.push(mk(Math.cos(a) * jr, y + (r2() - 0.5) * ry * 0.3, Math.sin(a) * jr, rx * (0.9 + r2() * 0.2), ry * (0.9 + r2() * 0.2)));
    }
    if (off > rx * 0.9) units.push(mk(0, y, 0, rx, ry));
  }
  // top cap so the crown closes at the apex
  units.push(mk(0, cs + ch - ry * 0.9, 0, Math.min(rx, Math.max(0.4, crownR(cs + ch - ry * 0.9))), ry * 0.9));

  // main branches (3-6) from the trunk to the lowest lumps
  const nb = isBush ? 3 + Math.floor(r2() * 3) : 3 + Math.floor(r2() * 4);
  const low = units.filter((u) => u.cx * u.cx + u.cz * u.cz > 0.01).sort((a, b) => a.cy - b.cy).slice(0, nb * 2);
  const used: Unit[] = [];
  for (let i = 0; i < low.length && used.length < nb; i += 2) used.push(low[i]!);
  for (const u of used) {
    u.ax = 0;
    u.ay = isBush ? 0.05 : Math.max(0.6, Math.min(shape.trunkHeight, cs - 0.2));
    u.az = 0;
    u.br = isBush ? 0.1 : 0.12;
  }
  const leader = isBush ? 0 : cs + ch * 0.8;
  return { shape, profile, isBush, flowering, units, nPrimary: used.length, height, radius, leader, seed };
}

interface FineGrid {
  mats: Uint8Array; lv: Uint8Array;
  nx: number; ny: number; nz: number; half: number; origin: number;
}

/** `step`: shade quantisation (coarser merges more faces); `notch`: carve 0.6 m edge gaps; `dropP`: share of exposed 0.2 m chips removed from the 0.4 m mass. */
function rasterFine(plan: FinePlan, step: number, notch: boolean, dropP: number): FineGrid {
  const { shape, profile, units } = plan;
  const C = FINE;
  const half = Math.ceil((plan.radius * 1.25) / C) + 1;
  const nx = 2 * half + 1, nz = nx;
  const ny = Math.ceil(plan.height / C) + 2;
  const mats = new Uint8Array(nx * ny * nz);
  const lv = new Uint8Array(nx * ny * nz);
  const idx = (x: number, y: number, z: number): number => x + z * nx + y * nx * nz;
  const cs = shape.crownBaseHeight;
  const ch = shape.crownHeight;
  const R = shape.crownRadius;
  const sd = plan.seed;

  const wood = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void => {
    const len = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
    const steps = Math.max(1, Math.ceil(len / (C * 0.5)));
    for (let s = 0; s <= steps; s++) {
      const f = s / steps;
      const x = Math.floor((x0 + (x1 - x0) * f) / C + 0.5) + half;
      const y = Math.floor((y0 + (y1 - y0) * f) / C);
      const z = Math.floor((z0 + (z1 - z0) * f) / C + 0.5) + half;
      if (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz) continue;
      const i = idx(x, y, z);
      mats[i] = MAT_TRUNK;
      lv[i] = 6;
    }
  };

  // tapered trunk (diameter <= 0.6 m at the root flare), continuing as the leader through the crown
  if (!plan.isBush) {
    const tr = Math.min(shape.trunkRadius, 0.3);
    const top = Math.max(shape.trunkHeight, plan.leader);
    const rowN = Math.ceil(top / C);
    for (let y = 0; y < rowN && y < ny; y++) {
      const yc = (y + 0.5) * C;
      let r = yc <= shape.trunkHeight ? tr * (1 - 0.4 * yc / shape.trunkHeight) : tr * 0.5 * (1 - (yc - shape.trunkHeight) / Math.max(0.5, top - shape.trunkHeight));
      r *= 1 + 0.3 * Math.max(0, 1 - yc / 0.5);
      r = Math.max(r, C * 0.5);
      for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
        const dx = (x - half) * C, dz = (z - half) * C;
        if (dx * dx + dz * dz <= r * r) {
          const i = idx(x, y, z);
          mats[i] = MAT_TRUNK;
          lv[i] = 6 + Math.floor(h3(x, 0, z, sd) * 2);
        }
      }
    }
  }
  for (const u of units) if (u.br > 0) wood(u.ax, u.ay, u.az, u.cx, u.cy, u.cz);

  // leaves: union of the lumps with a slightly irregular surface
  const bx = Math.ceil(Math.max(...units.map((u) => u.rx)) / C) + 2;
  for (const u of units) {
    const gx0 = Math.round(u.cx / C) + half, gy0 = Math.floor(u.cy / C), gz0 = Math.round(u.cz / C) + half;
    const by = Math.ceil(u.ry / C) + 2;
    for (let dz = -bx; dz <= bx; dz++) for (let dy = -by; dy <= by; dy++) for (let dx = -bx; dx <= bx; dx++) {
      const x = gx0 + dx, y = gy0 + dy, z = gz0 + dz;
      if (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz) continue;
      const i = idx(x, y, z);
      if (mats[i] === MAT_LEAF || mats[i] === MAT_BLOSSOM) continue;
      // the mass is built from 0.4 m blocks (2x2x2 voxels): the lump test uses the block centre
      const wx = ((x & ~1) + 0.5 - half) * C, wy = ((y & ~1) + 1) * C, wz = ((z & ~1) + 0.5 - half) * C;
      const ex = (wx - u.cx) / u.rx, ey = (wy - u.cy) / u.ry, ez = (wz - u.cz) / u.rx;
      const e = ex * ex + ey * ey + ez * ez;
      if (e > 1 + 0.1 * (h3(x >> 1, y >> 1, z >> 1, sd + 7) - 0.5)) continue;
      if (mats[i] === MAT_TRUNK) continue;
      const t = Math.min(1, Math.max(0, (wy - cs) / ch));
      const rb = Math.max(0.2, R * profileAt(profile, t));
      const rho = Math.min(1.1, Math.hypot(wx, wz) / rb);
      if (notch && rho > 0.62 && h3(Math.floor(x / 3), Math.floor(y / 3), Math.floor(z / 3), sd + 21) < 0.13) continue;
      const light = 0.4 * t + 0.5 * Math.min(1, rho) + 0.1 * Math.max(-1, Math.min(1, ey));
      const shade = 0.55 + 0.6 * light + (h3(x, y, z, sd + 3) - 0.5) * 0.08;
      const l = Math.max(0, Math.min(31, Math.round((shade - 0.4) / step)));
      mats[i] = plan.flowering && light > 0.42 && h3(x, y, z, sd + 11) < 0.7 ? MAT_BLOSSOM : MAT_LEAF;
      lv[i] = l;
    }
  }
  // 0.2 m detail: chip away exposed voxels of the 0.4 m mass, so the surface is lumpy with small gaps
  if (dropP > 0) {
    const kill: number[] = [];
    const nbs = [1, -1, nx, -nx, nx * nz, -nx * nz];
    for (let y = 1; y < ny - 1; y++) for (let z = 1; z < nz - 1; z++) for (let x = 1; x < nx - 1; x++) {
      const i = idx(x, y, z);
      if (mats[i] !== MAT_LEAF && mats[i] !== MAT_BLOSSOM) continue;
      let exposed = false;
      for (const d of nbs) if (mats[i + d] === 0) { exposed = true; break; }
      if (exposed && h3(x, y, z, sd + 29) < dropP) kill.push(i);
    }
    for (const i of kill) mats[i] = 0;
  }
  return { mats, lv, nx, ny, nz, half, origin: -(half + 0.5) * C };
}

/** Greedy mesh of a keyed grid: faces merge when material and shade level match. */
function meshFine(out: MeshOut, g: FineGrid, plan: FinePlan, step: number): void {
  const { mats, lv, nx, ny, nz } = g;
  const shape = plan.shape;
  const C = FINE;
  const dims = [nx, ny, nz];
  const stride = [1, nx * nz, nx];
  const org = [g.origin, 0, g.origin];
  const get = (c: number[]): number => {
    if (c[0]! < 0 || c[1]! < 0 || c[2]! < 0 || c[0]! >= nx || c[1]! >= ny || c[2]! >= nz) return 0;
    return mats[c[0]! * stride[0]! + c[1]! * stride[1]! + c[2]! * stride[2]!]!;
  };
  const leafCol = plan.flowering ? FINE_FOLIAGE : shape.color;
  const woodCol = plan.isBush ? FINE_STEM : shape.trunkColor;
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
            mask[u + v * du] = m * 32 + lv[ti]! + 1;
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
            const mat = k >> 5;
            const level = (k & 31) - 1;
            const base = mat === MAT_LEAF ? leafCol : mat === MAT_BLOSSOM ? shape.color : woodCol;
            const shade = axis === 1 ? (sign > 0 ? FACE_SHADE[2]! : FACE_SHADE[1]!) : FACE_SHADE[0]!;
            const f = (mat === MAT_TRUNK ? 0.4 + 0.08 * level : 0.4 + step * level) * shade;
            out.curLeaf = mat === MAT_TRUNK ? 0 : 1;
            const plane = org[axis]! + (s + (sign > 0 ? 1 : 0)) * C;
            out.quad(
              axis, sign, plane,
              org[ua]! + u * C, org[va]! + v * C,
              org[ua]! + (u + w) * C, org[va]! + (v + h) * C,
              [Math.min(1, base[0] * f), Math.min(1, base[1] * f), Math.min(1, base[2] * f)],
            );
            u += w;
          }
        }
      }
    }
  }
}

/**
 * Finest model: 0.2 m voxels. Tapered trunk, 3-6 main branches, and leaf clusters on the branch
 * ends with real gaps between them. Clusters are dropped (last first) until the triangle cap holds.
 */
function buildLod3(species: number, variant: number, rng: () => number): VegModel {
  const plan = planFine(species, variant, rng);
  const cap = (plan.isBush ? FINE_MAX_TRIS_BUSH : FINE_MAX_TRIS_TREE) * 0.97;
  // coarser shade bands merge more faces; the last pass also drops the edge notches
  const passes: [number, boolean, number][] = [[0.08, true, 0.3], [0.12, true, 0.22], [0.16, true, 0.15], [0.2, false, 0.1], [0.3, false, 0], [0.5, false, 0]];
  let out!: MeshOut;
  for (const [step, notch, dropP] of passes) {
    out = new MeshOut(plan.height, plan.shape.bushCap);
    out.leaf = [];
    meshFine(out, rasterFine(plan, step, notch, dropP), plan, step);
    if (out.indices.length / 3 <= cap) break;
  }
  return out.toModel(plan.height, plan.radius);
}

/** lod 0 = near (0.5 m voxels), 1 = far boxes, 2 = mid (1 m voxels), 3 = finest (0.2 m, branches and leaf clusters). */
export function buildModel(species: number, variant: number, lod: 0 | 1 | 2 | 3): VegModel {
  const rng = mulberry32(species * 7919 + variant * 104729);
  if (lod === 0) return buildLod0(species, variant, rng);
  if (lod === 2) return buildLod2(species, variant, rng);
  if (lod === 3) return buildLod3(species, variant, rng);
  return buildLod1(species, variant, rng);
}

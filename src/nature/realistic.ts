/**
 * Summer trees and bushes as low-poly wood skeletons plus alpha-tested leaf clumps.
 * Deterministic from species and variant. Triangle caps: near (lod 3) <= 3000,
 * the 70 m model (lod 0) <= 1200, mid (lod 2) <= 160, far (lod 1) <= 24.
 *
 * Every species grows its own branch skeleton (trunk, scaffold limbs, child branches),
 * then samples leaf clumps through the crown envelope and hangs them on the nearest wood
 * with a few thin twigs. Bark and leaf *colours* are on the vertices, ambient occlusion is
 * baked into them, and `tex` selects the texture-array layer per vertex (see tree-atlas.ts).
 */
import { SPECIES } from './species.ts';
import type { VegModel } from './models.ts';
import { LEAF_LAYER, speciesLayers } from './tree-atlas.ts';

type RGB = [number, number, number];

interface Profile {
  /** Metres at variant scale 1. */
  height: number;
  trunkH: number;
  crownR: number;
  trunkR: number;
  /** Crown envelope, metres above ground. */
  crownBase: number;
  crownTop: number;
  leaf: RGB;
  bark: RGB;
  /** Pine: orange bark on the upper trunk; grey-brown below. */
  barkUpper?: RGB;
  blossom?: RGB;
  blossomFrac: number;
  bush: boolean;
  /** Branch skeleton. */
  scaffolds: number;
  /** Limb angle range from vertical, degrees. */
  angleMin: number;
  angleMax: number;
  /** Tip horizontal distance as a fraction of the crown radius. */
  limbFrac: number;
  child: number;
  /** Leaf clump target for the near model. */
  near: number;
  /** Cards per clump (3-4). */
  cards: number;
  /** Card width, metres; height = width * aspect. */
  cardW: number;
  aspect: number;
  airy: boolean;
  crown: 'dome' | 'ovoid' | 'column' | 'umbrella' | 'cone' | 'flat' | 'weeping' | 'irregular' | 'few';
  special?: 'pine' | 'willow' | 'thuja' | 'mulberry' | 'acacia' | 'ailanthus' | 'poplar' | 'leader' | 'walnut';
}

const GREEN = (r: number, g: number, b: number): RGB => [r / 255, g / 255, b / 255];

const BROWN = GREEN(92, 68, 46);
const DARK_BARK = GREEN(78, 60, 46);
const GREY_BARK = GREEN(122, 114, 102);

function baseProfile(height: number, trunkH: number, crownR: number, leaf: RGB): Profile {
  return {
    height,
    trunkH,
    crownR,
    trunkR: 0.24,
    crownBase: trunkH * 0.95,
    crownTop: height,
    leaf,
    bark: BROWN,
    blossomFrac: 0,
    bush: false,
    scaffolds: 6,
    angleMin: 40,
    angleMax: 55,
    limbFrac: 0.9,
    child: 2,
    near: 280,
    cards: 4,
    cardW: 0.8,
    aspect: 1,
    airy: false,
    crown: 'dome',
  };
}

function profile(species: number): Profile {
  switch (species) {
    case SPECIES.CHESTNUT:
      return { ...baseProfile(13, 2.6, 4.2, GREEN(70, 112, 46)), trunkR: 0.26, angleMin: 40, angleMax: 50, near: 275, cardW: 0.85 };
    case SPECIES.LINDEN:
      return { ...baseProfile(14, 2.8, 3.6, GREEN(88, 130, 56)), trunkR: 0.25, angleMin: 35, angleMax: 45, crown: 'ovoid', near: 275, cardW: 0.85, special: 'leader' };
    case SPECIES.ACACIA:
      return {
        ...baseProfile(13, 2.4, 4, GREEN(130, 160, 74)),
        trunkR: 0.22, bark: DARK_BARK, angleMin: 42, angleMax: 68, child: 2,
        near: 150, cards: 3, cardW: 0.85, airy: true, crown: 'irregular', special: 'acacia',
      };
    case SPECIES.POPLAR:
      return {
        ...baseProfile(20, 1.4, 1.6, GREEN(76, 124, 52)),
        trunkR: 0.22, bark: GREY_BARK, scaffolds: 9, angleMin: 8, angleMax: 15,
        limbFrac: 0.62, child: 0, near: 270, cardW: 0.8,
        crown: 'column', special: 'poplar', crownBase: 1.5,
      };
    case SPECIES.WILLOW:
      return {
        ...baseProfile(10, 2.2, 4.5, GREEN(140, 168, 98)),
        trunkR: 0.26, bark: DARK_BARK, scaffolds: 5, angleMin: 55, angleMax: 75,
        child: 1, near: 90, cards: 4, cardW: 0.4,
        crown: 'weeping', special: 'willow', crownBase: 1.5,
      };
    case SPECIES.PINE:
      return {
        ...baseProfile(15, 9, 3.2, GREEN(52, 92, 56)),
        trunkR: 0.26, bark: GREEN(110, 90, 75), barkUpper: GREEN(190, 110, 70),
        scaffolds: 7, angleMin: 72, angleMax: 88, child: 0,
        near: 300, cards: 3, cardW: 0.8, crown: 'umbrella', special: 'pine', crownBase: 9.4,
      };
    case SPECIES.PLANE:
      return {
        ...baseProfile(18, 3.5, 6, GREEN(98, 140, 62)),
        trunkR: 0.28, bark: GREEN(200, 195, 170), scaffolds: 5, angleMin: 50, angleMax: 60,
        child: 1, near: 284, cardW: 0.9,
      };
    case SPECIES.MAPLE:
      return { ...baseProfile(12, 2.4, 4, GREEN(82, 128, 54)), trunkR: 0.23, angleMin: 42, angleMax: 48, near: 275, cardW: 0.85 };
    case SPECIES.ELM:
      return {
        ...baseProfile(11, 2.2, 4, GREEN(86, 122, 58)),
        trunkR: 0.19, bark: DARK_BARK, scaffolds: 7, angleMin: 35, angleMax: 62,
        child: 2, near: 275, cardW: 0.57, crown: 'irregular',
      };
    case SPECIES.GLEDITSIA:
      return {
        ...baseProfile(13, 2.8, 5, GREEN(120, 150, 70)),
        trunkR: 0.22, bark: DARK_BARK, scaffolds: 6, angleMin: 65, angleMax: 82,
        child: 2, near: 210, cards: 3, cardW: 0.85, airy: true, crown: 'flat',
      };
    case SPECIES.MULBERRY:
      return {
        ...baseProfile(7, 1.2, 3.5, GREEN(80, 126, 52)),
        trunkR: 0.16, bark: DARK_BARK, scaffolds: 3, angleMin: 35, angleMax: 55,
        child: 2, near: 260, cardW: 0.57, crown: 'dome',
        special: 'mulberry', crownBase: 0.6,
      };
    case SPECIES.AILANTHUS:
      return {
        ...baseProfile(13, 3.5, 3.8, GREEN(96, 138, 64)),
        trunkR: 0.25, bark: GREY_BARK, scaffolds: 4, angleMin: 25, angleMax: 42,
        child: 2, near: 90, cards: 3, cardW: 0.7, aspect: 2.2, airy: true,
        crown: 'few', special: 'ailanthus',
      };
    case SPECIES.CATALPA:
      return {
        ...baseProfile(10, 2.2, 4.5, GREEN(132, 176, 82)),
        trunkR: 0.23, scaffolds: 5, angleMin: 45, angleMax: 62,
        child: 2, near: 275, cardW: 0.9, crown: 'irregular',
      };
    case SPECIES.THUJA:
      return {
        ...baseProfile(6, 0.4, 1.3, GREEN(48, 86, 48)),
        trunkR: 0.1, bark: GREEN(120, 80, 60), scaffolds: 0,
        child: 0, near: 260, cardW: 0.57, aspect: 1.3,
        crown: 'cone', special: 'thuja', crownBase: 0.1, crownTop: 6,
      };
    case SPECIES.WALNUT:
      return {
        ...baseProfile(14, 2.5, 5.5, GREEN(78, 118, 52)),
        trunkR: 0.27, bark: GREY_BARK, scaffolds: 6, angleMin: 45, angleMax: 60,
        child: 2, near: 270, cardW: 0.85, aspect: 2.2,
        crown: 'dome', special: 'walnut',
      };
    case SPECIES.BUSH:
      return {
        ...baseProfile(1.6, 0.15, 0.9, GREEN(70, 120, 48)),
        trunkR: 0.06, scaffolds: 4, angleMin: 35, angleMax: 65, child: 1,
        near: 44, cards: 3, cardW: 0.38, bush: true, crownBase: 0.05, crownTop: 1.6,
      };
    case SPECIES.BUSH_LILAC:
      return {
        ...baseProfile(1.75, 0.2, 0.95, GREEN(74, 116, 52)),
        trunkR: 0.06, scaffolds: 4, angleMin: 35, angleMax: 65, child: 1,
        near: 44, cards: 3, cardW: 0.38, bush: true,
        blossom: GREEN(180, 138, 214), blossomFrac: 0.45,
        crownBase: 0.05, crownTop: 1.75,
      };
    case SPECIES.BUSH_PINK:
      return {
        ...baseProfile(1.55, 0.15, 0.85, GREEN(86, 130, 58)),
        trunkR: 0.05, scaffolds: 4, angleMin: 35, angleMax: 65, child: 1,
        near: 44, cards: 3, cardW: 0.36, bush: true,
        blossom: GREEN(214, 120, 150), blossomFrac: 0.5,
        crownBase: 0.05, crownTop: 1.55,
      };
    default:
      return { ...baseProfile(12, 2.4, 4, GREEN(82, 128, 54)), trunkR: 0.23 };
  }
}

/** Overall size factor of a variant. The renderer scales variant 0 to the other variants. */
export function variantScale(variant: number): number {
  return 1 + (variant - 1) * 0.08;
}

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return function (): number {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable per-card hash in [0, 1). */
function hash01(n: number): number {
  let h = Math.imul(n | 0, 0x9e3779b1) ^ 0x85ebca6b;
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Crown envelope radius at height `y`. */
function envelope(p: Profile, y: number): number {
  const span = Math.max(0.001, p.crownTop - p.crownBase);
  const t = clamp((y - p.crownBase) / span, 0, 1);
  switch (p.crown) {
    case 'column':
      return p.crownR * (0.45 + 0.55 * Math.pow(Math.sin(Math.PI * (0.12 + 0.8 * t)), 0.6));
    case 'umbrella':
      return p.crownR * (0.55 + 0.45 * Math.sin(Math.PI * clamp(0.06 + 0.55 * t, 0, 1)));
    case 'cone':
      return p.crownR * (0.55 + 0.45 * Math.sin(Math.PI * (0.22 + 0.6 * t)));
    case 'flat':
      return p.crownR * (0.58 + 0.42 * Math.sin(Math.PI * (0.06 + 0.84 * t)));
    case 'weeping':
      return p.crownR * (0.42 + 0.58 * Math.sin(Math.PI * (0.1 + 0.75 * t)));
    case 'ovoid':
      return p.crownR * (Math.pow(Math.sin(Math.PI * clamp(0.04 + 0.92 * t, 0, 1)), 0.6) * 0.95 + 0.05);
    case 'irregular':
      return p.crownR * (Math.pow(Math.sin(Math.PI * clamp(0.06 + 0.88 * t, 0, 1)), 0.55) * 0.94 + 0.06);
    case 'few':
      return p.crownR * (Math.pow(Math.sin(Math.PI * clamp(0.08 + 0.84 * t, 0, 1)), 0.7) * 0.92 + 0.08);
    default:
      return p.crownR * (Math.sqrt(Math.max(0, 1 - Math.pow((t - 0.5) / 0.54, 2))) * 0.96 + 0.04);
  }
}

interface Node {
  x: number;
  y: number;
  z: number;
  r: number;
  sway: number;
}

interface Limb {
  pts: Node[];
  child: boolean;
  stub: boolean;
}

interface Clump {
  x: number;
  y: number;
  z: number;
  /** Card width and height, metres. */
  w: number;
  h: number;
  kind: 'upright' | 'hanging' | 'flat' | 'vertical';
  cards: number;
  blossom: boolean;
  seed: number;
  /** Nearest point on the wood, where the twig starts. */
  ax: number;
  ay: number;
  az: number;
  asway: number;
}

interface Plan {
  p: Profile;
  trunk: Node[];
  limbs: Limb[];
  clumps: Clump[];
  crownY: number;
}

export interface SkeletonLimb {
  child: boolean;
  stub: boolean;
  points: Node[];
}

export interface Skeleton {
  trunk: Node[];
  limbs: SkeletonLimb[];
}

/** The deterministic wood skeleton of a near model, for tests and tooling. */
export function skeletonOf(species: number, variant: number): Skeleton {
  const plan = buildPlan(species, variant);
  const k = variantScale(variant);
  const at = (n: Node): Node => ({ x: n.x * k, y: n.y * k, z: n.z * k, r: n.r * k, sway: n.sway });
  return {
    trunk: plan.trunk.map(at),
    limbs: plan.limbs.map((l) => ({ child: l.child, stub: l.stub, points: l.pts.map(at) })),
  };
}

/** Height of the main stem (some species keep a central leader through the crown). */
function stemTop(p: Profile): number {
  if (p.special === 'pine') return p.height * 0.9;
  if (p.special === 'thuja') return p.trunkH;
  if (p.special === 'poplar') return p.height * 0.92;
  if (p.bush) return p.trunkH;
  if (p.special === 'mulberry') return 0.6;
  if (p.special === 'leader') return p.height * 0.82;
  return p.trunkH;
}

/** Interpolate the leaning trunk at height y. */
function stemAt(trunk: Node[], y: number): Node {
  for (let i = 1; i < trunk.length; i++) {
    const a = trunk[i - 1]!;
    const b = trunk[i]!;
    if (y <= b.y || i === trunk.length - 1) {
      const t = b.y === a.y ? 0 : clamp((y - a.y) / (b.y - a.y), 0, 1);
      return { x: lerp(a.x, b.x, t), y, z: lerp(a.z, b.z, t), r: lerp(a.r, b.r, t), sway: lerp(a.sway, b.sway, t) };
    }
  }
  return trunk[0]!;
}

function pointOnLimb(l: Limb, t: number): Node {
  const pts = l.pts;
  const seg = t <= 0.5 ? 0 : 1;
  const a = pts[seg]!;
  const b = pts[Math.min(seg + 1, pts.length - 1)]!;
  const local = t <= 0.5 ? t * 2 : (t - 0.5) * 2;
  return {
    x: lerp(a.x, b.x, local),
    y: lerp(a.y, b.y, local),
    z: lerp(a.z, b.z, local),
    r: lerp(a.r, b.r, local),
    sway: lerp(a.sway, b.sway, local),
  };
}

interface WoodPoint {
  x: number;
  y: number;
  z: number;
  sway: number;
}

function branchSamples(trunk: Node[], limbs: Limb[]): WoodPoint[] {
  const out: WoodPoint[] = [];
  const addSegment = (a: Node, b: Node, steps: number): void => {
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      out.push({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t), sway: lerp(a.sway, b.sway, t) });
    }
  };
  for (let i = 1; i < trunk.length; i++) addSegment(trunk[i - 1]!, trunk[i]!, 3);
  for (const l of limbs) {
    if (l.stub) continue;
    for (let i = 1; i < l.pts.length; i++) addSegment(l.pts[i - 1]!, l.pts[i]!, 3);
  }
  return out;
}

function nearestWood(x: number, y: number, z: number, samples: WoodPoint[]): WoodPoint {
  let best = samples[0]!;
  let bestD = Infinity;
  for (const s of samples) {
    const d = (s.x - x) * (s.x - x) + (s.y - y) * (s.y - y) + (s.z - z) * (s.z - z);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

function buildPlan(species: number, variant: number): Plan {
  const p = profile(species);
  const rng = mulberry32(species * 1009 + variant * 7919);
  const crownY = (p.crownBase + p.crownTop) * 0.5;
  const top = stemTop(p);
  const segments = p.bush ? 1 : p.special === 'pine' ? 3 : 2 + (rng() < 0.5 ? 1 : 0);
  const leanA = rng() * Math.PI * 2;
  const leanMag = (p.special === 'pine' ? 0.06 : 0.035) * p.height;
  const trunk: Node[] = [];
  const baseR = p.trunkR * 1.2;
  for (let s = 0; s <= segments; s++) {
    const t = s / segments;
    const bend = t * t;
    trunk.push({
      x: Math.cos(leanA) * leanMag * bend,
      y: top * t,
      z: Math.sin(leanA) * leanMag * bend,
      r: s === 0 ? baseR : p.trunkR * (1 - 0.6 * t),
      sway: 0.22 * t,
    });
  }

  const limbs: Limb[] = [];
  const clumps: Clump[] = [];

  const pushLimb = (pts: Node[], child: boolean, stub = false): void => {
    limbs.push({ pts, child, stub });
  };

  // Scaffold limbs start along the upper trunk at species angles.
  const n = p.special === 'thuja' ? 0 : p.scaffolds;
  for (let i = 0; i < n; i++) {
    const az = (i / n) * Math.PI * 2 + rng() * 0.45 + variant * 0.7;
    let yStart: number;
    if (p.special === 'pine') yStart = p.height * (0.66 + 0.23 * rng());
    else if (p.special === 'poplar') yStart = p.trunkH + (p.height * 0.9 - p.trunkH) * ((i + 0.3) / n);
    else if (p.special === 'mulberry') yStart = 0.6 + rng() * 0.08;
    else if (p.bush) yStart = p.trunkH * (0.4 + 0.4 * rng());
    else if (p.special === 'acacia') yStart = p.trunkH * (0.9 + 0.08 * rng());
    else yStart = Math.min(p.trunkH, p.crownBase) * (0.86 + 0.14 * rng());
    yStart = Math.min(yStart, Math.max(0.05, top - 0.05));
    const start = stemAt(trunk, yStart);
    const theta = (p.special === 'acacia'
      ? (i < 2 ? 14 + rng() * 16 : 44 + rng() * 26)
      : p.angleMin + rng() * (p.angleMax - p.angleMin)) * Math.PI / 180;

    let tipR: number;
    let rise: number;
    if (p.special === 'pine') {
      tipR = p.crownR * (0.74 + 0.22 * rng());
      rise = (p.height - yStart) * (0.04 + 0.2 * rng());
    } else if (p.special === 'poplar') {
      tipR = p.crownR * (0.7 + 0.25 * rng());
      rise = Math.max(0.25, p.height * 0.92 - yStart) * (0.5 + 0.4 * ((i + 1) / n));
    } else if (p.special === 'willow') {
      tipR = p.crownR * (0.72 + 0.2 * rng());
      rise = (p.crownTop - yStart) * (0.25 + 0.2 * rng());
    } else if (p.crown === 'flat') {
      tipR = p.crownR * (0.72 + 0.22 * rng());
      rise = tipR / Math.max(0.5, Math.tan(theta));
    } else {
      tipR = p.crownR * p.limbFrac * (0.84 + 0.16 * rng());
      rise = tipR / Math.max(0.35, Math.tan(theta));
    }
    const tipY = clamp(yStart + rise, yStart + 0.05, p.height - 0.1);
    tipR = Math.min(tipR, p.crownR * 0.95);
    const dx = Math.cos(az);
    const dz = Math.sin(az);
    const tip: Node = {
      x: start.x + dx * tipR,
      y: tipY,
      z: start.z + dz * tipR,
      r: Math.max(0.015, p.trunkR * (0.16 + 0.1 * rng())),
      sway: clamp(0.15 + 0.3 * (tipY / p.height), 0.15, 0.5),
    };
    const arch = p.special === 'willow' ? (p.crownTop - yStart) * 0.08 : 0;
    const mid: Node = {
      x: lerp(start.x, tip.x, 0.55),
      y: clamp(lerp(yStart, tip.y, 0.6) + arch, yStart, p.height),
      z: lerp(start.z, tip.z, 0.55),
      r: Math.max(0.02, p.trunkR * (0.32 + 0.1 * rng())),
      sway: clamp(0.15 + 0.3 * (lerp(yStart, tipY, 0.6) / p.height), 0.15, 0.5),
    };
    pushLimb([start, mid, tip], false);

    // Child branches, near model only.
    for (let c = 0; c < p.child; c++) {
      const ct = 0.5 + 0.32 * rng();
      const parent: Limb = { pts: [start, mid, tip], child: false, stub: false };
      const at = pointOnLimb(parent, ct);
      const ca = az + (rng() - 0.5) * 1.1;
      const cr = p.crownR * (0.18 + 0.2 * rng());
      const cy = Math.min(p.height - 0.15, at.y + (p.crownTop - p.crownBase) * (0.08 + 0.16 * rng()));
      const envAt = envelope(p, cy) * 0.94;
      const ctipR = Math.min(Math.hypot(at.x, at.z) + cr, envAt);
      const ctip: Node = {
        x: Math.cos(ca) * ctipR,
        y: cy,
        z: Math.sin(ca) * ctipR,
        r: Math.max(0.01, at.r * 0.32),
        sway: clamp(0.2 + 0.3 * (cy / p.height), 0.2, 0.5),
      };
      pushLimb([at, ctip], true);
    }
  }

  // Pine: short dead stubs on the bare trunk.
  if (p.special === 'pine') {
    for (let i = 0; i < 4; i++) {
      const y = p.height * (0.4 + 0.1 * i + rng() * 0.04);
      const a = rng() * Math.PI * 2;
      const s = stemAt(trunk, y);
      const len = 0.15 + 0.25 * rng();
      pushLimb([
        s,
        { x: s.x + Math.cos(a) * len, y: y - 0.12, z: s.z + Math.sin(a) * len, r: 0.02, sway: 0.15 },
      ], false, true);
    }
  }

  const wood = branchSamples(trunk, limbs);
  const push = (c: Clump, raw = false): void => {
    if (!raw) {
      const lim = Math.max(0.03, envelope(p, c.y) - c.w * 0.2);
      const r = Math.hypot(c.x, c.z);
      if (r > lim && r > 0.0001) {
        const f = lim / r;
        c.x *= f;
        c.z *= f;
      }
    }
    c.y = clamp(c.y, c.h * 0.5 + 0.02, p.height - c.h * 0.25);
    const a = nearestWood(c.x, c.kind === 'hanging' ? c.y + c.h * 0.5 : c.y, c.z, wood);
    c.ax = a.x;
    c.ay = a.y;
    c.az = a.z;
    c.asway = a.sway;
    clumps.push(c);
  };

  if (p.special === 'willow') {
    addWillowCurtains(p, wood, rng, push);
  } else {
    // A few clumps sit on the branch ends.
    for (const l of limbs) {
      if (l.stub) continue;
      if (p.special === 'pine' && !l.child) {
        for (const t of [0.55, 0.75, 0.92, 1]) {
          const at = pointOnLimb(l, t);
          push(makeClump(p, at.x, at.y, at.z, rng, 'flat'));
        }
      } else {
        const tip = l.pts[l.pts.length - 1]!;
        push(makeClump(p, tip.x, tip.y, tip.z, rng, clumpKind(p)));
      }
    }
    // Stratified rejection sampling through the crown envelope, biased to the outer shell.
    const volume = Math.max(0, p.near - clumps.length);
    for (let i = 0; i < volume; i++) {
      const y = p.crownBase + (p.crownTop - p.crownBase) * (0.04 + 0.92 * ((i + 0.15 + 0.7 * rng()) / volume));
      const env = envelope(p, y);
      if (env < 0.18) continue;
      const outerBias = p.crownR >= 5 && !p.airy ? 6 : 7;
      const rf = i % 10 < outerBias ? 0.7 + 0.3 * rng() : 0.45 + 0.25 * rng();
      const a = i * 2.399963229728653 + rng() * 0.9 + variant * 0.5;
      const r = env * rf;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (x * x + z * z > (env * 1.02) * (env * 1.02)) continue;
      push(makeClump(p, x, y, z, rng, clumpKind(p)));
    }
  }

  if (p.blossom !== undefined) {
    for (let i = 0; i < clumps.length; i++) {
      clumps[i]!.blossom = hash01(clumps[i]!.seed ^ 0x51ed) < p.blossomFrac;
    }
    if (!clumps.some((c) => c.blossom) && clumps.length > 0) clumps[clumps.length - 1]!.blossom = true;
    if (!clumps.some((c) => !c.blossom) && clumps.length > 0) clumps[0]!.blossom = false;
  }

  return { p, trunk, limbs, clumps, crownY };
}

function clumpKind(p: Profile): Clump['kind'] {
  if (p.special === 'willow') return 'hanging';
  if (p.special === 'pine') return 'flat';
  if (p.special === 'thuja') return 'vertical';
  return 'upright';
}

function makeClump(p: Profile, x: number, y: number, z: number, rng: () => number, kind: Clump['kind']): Clump {
  const w = Math.min(0.9, p.cardW * (0.95 + 0.1 * rng()));
  return {
    x, y, z, w, h: w * p.aspect, kind, cards: p.cards, blossom: false, seed: Math.floor(rng() * 1e9),
    ax: x, ay: y, az: z, asway: 0.5,
  };
}

/** Willow: 90 long hanging curtains around the whole circumference. */
function addWillowCurtains(p: Profile, wood: WoodPoint[], rng: () => number, push: (c: Clump, raw?: boolean) => void): void {
  const count = Math.max(60, p.near);
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + (rng() - 0.5) * 0.18;
    const topY = p.crownBase + (p.crownTop - p.crownBase) * (0.3 + 0.6 * rng());
    const env = envelope(p, topY);
    const rf = 0.72 + 0.28 * rng();
    const x = Math.cos(a) * env * rf;
    const z = Math.sin(a) * env * rf;
    const h = clamp(topY - 1, 1.5, 3);
    const w = 0.35 + 0.15 * rng();
    const c: Clump = {
      x, y: topY - h * 0.5, z, w, h, kind: 'hanging', cards: p.cards, blossom: false,
      seed: Math.floor(rng() * 1e9), ax: 0, ay: 0, az: 0, asway: 0.4,
    };
    // Attach at the top of the curtain, not its middle.
    const a0 = nearestWood(x, topY, z, wood);
    c.ax = a0.x; c.ay = a0.y; c.az = a0.z; c.asway = a0.sway;
    push(c, true);
  }
}

class Bld {
  readonly pos: number[] = [];
  readonly nor: number[] = [];
  readonly col: number[] = [];
  readonly sway: number[] = [];
  readonly uv: number[] = [];
  readonly leaf: number[] = [];
  readonly tex: number[] = [];
  readonly idx: number[] = [];
  private readonly barkLayer: number;
  readonly leafLayer: number;
  private readonly wood: (y: number) => RGB;

  constructor(p: Profile, species: number) {
    const layers = speciesLayers(species);
    this.barkLayer = layers.bark;
    this.leafLayer = layers.leaf;
    this.wood = (y: number): RGB => {
      const shade = 0.85 + 0.15 * clamp(y / p.height, 0, 1);
      let c = p.bark;
      if (p.barkUpper !== undefined) {
        const t = clamp((y / p.height - 0.45) / 0.32, 0, 1);
        c = [lerp(p.bark[0], p.barkUpper[0], t), lerp(p.bark[1], p.barkUpper[1], t), lerp(p.bark[2], p.barkUpper[2], t)];
      }
      return [c[0] * shade, c[1] * shade, c[2] * shade];
    };
  }

  private v(x: number, y: number, z: number, nx: number, ny: number, nz: number, r: number, g: number, b: number, sway: number, u: number, vv: number, leaf: number, tex: number): number {
    const l = Math.hypot(nx, ny, nz) || 1;
    this.pos.push(x, Math.max(0, y), z);
    this.nor.push(nx / l, ny / l, nz / l);
    this.col.push(r, g, b);
    this.sway.push(sway);
    this.uv.push(u, vv);
    this.leaf.push(leaf);
    this.tex.push(tex);
    return this.pos.length / 3 - 1;
  }

  /** One tapered cylinder section, sides emitted as quads. */
  cylinder(ax: number, ay: number, az: number, bx: number, by: number, bz: number, r0: number, r1: number, sides: number, sway0: number, sway1: number): void {
    let dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.hypot(dx, dy, dz) || 1;
    dx /= len; dy /= len; dz /= len;
    let ux = 0, uy = 1, uz = 0;
    if (Math.abs(dy) > 0.9) { ux = 1; uy = 0; }
    let rx = uy * dz - uz * dy, ry = uz * dx - ux * dz, rz = ux * dy - uy * dx;
    const rl = Math.hypot(rx, ry, rz) || 1;
    rx /= rl; ry /= rl; rz /= rl;
    const px = dy * rz - dz * ry, py = dz * rx - dx * rz, pz = dx * ry - dy * rx;
    const ring = (t: number, rad: number, sway: number): number[] => {
      const ids: number[] = [];
      const cx = ax + (bx - ax) * t, cy = ay + (by - ay) * t, cz = az + (bz - az) * t;
      const col = this.wood(cy);
      for (let i = 0; i < sides; i++) {
        const a = (i / sides) * Math.PI * 2;
        const nx = Math.cos(a) * rx + Math.sin(a) * px;
        const ny = Math.cos(a) * ry + Math.sin(a) * py;
        const nz = Math.cos(a) * rz + Math.sin(a) * pz;
        ids.push(this.v(cx + nx * rad, cy + ny * rad, cz + nz * rad, nx, ny, nz, col[0], col[1], col[2], sway, i / sides, cy / 2, 0, this.barkLayer));
      }
      return ids;
    };
    const a = ring(0, r0, sway0);
    const b = ring(1, r1, sway1);
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      this.idx.push(a[i]!, b[i]!, b[j]!);
      this.idx.push(a[i]!, b[j]!, a[j]!);
    }
  }

  /**
   * One card quad. Normals point mostly out from the crown axis, so Lambert shades the
   * crown as a leaf mass instead of one flat plane. The material is double-sided.
   */
  card(
    cx: number, cy: number, cz: number,
    rx: number, ry: number, rz: number,
    ux: number, uy: number, uz: number,
    color: RGB, sway: number, crownY: number, tex: number, mirror: boolean, horizontal = false,
  ): void {
    const fnx = ry * uz - rz * uy;
    const fny = rz * ux - rx * uz;
    const fnz = rx * uy - ry * ux;
    const fl = Math.hypot(fnx, fny, fnz) || 1;
    const n = (x: number, y: number, z: number, u: number, v: number): number => {
      const yy = Math.max(0.02, y);
      let vx = x, vy = yy - crownY, vz = z;
      if (horizontal) vy = 0;
      const rl = Math.hypot(vx, vy, vz) || 1;
      vx /= rl; vy /= rl; vz /= rl;
      return this.v(
        x, yy, z,
        fnx / fl * 0.22 + vx * 0.78,
        fny / fl * 0.22 + vy * 0.78,
        fnz / fl * 0.22 + vz * 0.78,
        color[0], color[1], color[2], sway, mirror ? 1 - u : u, v, 1, tex,
      );
    };
    const a = n(cx - rx - ux, cy - ry - uy, cz - rz - uz, 0, 0);
    const b = n(cx + rx - ux, cy + ry - uy, cz + rz - uz, 1, 0);
    const c = n(cx + rx + ux, cy + ry + uy, cz + rz + uz, 1, 1);
    const d = n(cx - rx + ux, cy - ry + uy, cz - rz + uz, 0, 1);
    this.idx.push(a, b, c, a, c, d);
  }

  finish(height: number, radius: number, scale: number): VegModel {
    const pos = Float32Array.from(this.pos);
    if (scale !== 1) for (let i = 0; i < pos.length; i++) pos[i] = pos[i]! * scale;
    return {
      positions: pos,
      normals: Float32Array.from(this.nor),
      colors: Float32Array.from(this.col),
      sway: Float32Array.from(this.sway),
      uvs: Float32Array.from(this.uv),
      leaf: Float32Array.from(this.leaf),
      tex: Float32Array.from(this.tex),
      indices: Uint32Array.from(this.idx),
      height,
      radius,
    };
  }
}

function cardColor(p: Profile, c: Clump, card: number, crownY: number): RGB {
  if (c.blossom && p.blossom !== undefined) return p.blossom;
  const jitter = 0.94 + 0.12 * hash01(c.seed + card * 17);
  const halfH = Math.max(0.001, (p.crownTop - p.crownBase) * 0.5);
  const d = clamp(Math.hypot(c.x / p.crownR, (c.y - crownY) / halfH), 0, 1);
  let ao = 0.72 + 0.28 * d;
  if (c.y < p.crownBase + (p.crownTop - p.crownBase) / 3) ao *= 0.92;
  return [
    Math.min(1, p.leaf[0] * jitter * ao),
    Math.min(1, p.leaf[1] * jitter * ao),
    Math.min(1, p.leaf[2] * jitter * ao),
  ];
}

function drawClump(b: Bld, p: Profile, c: Clump, scale: number, crownY: number): void {
  const w = c.w * scale * 0.5;
  const h = c.h * scale * 0.5;
  const sway = clamp(0.7 + 0.25 * (c.y / p.height), 0.7, 1);
  const tex = c.blossom ? LEAF_LAYER.BLOSSOM : b.leafLayer;
  const a = hash01(c.seed + 3) * Math.PI * 2;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  if (c.kind === 'hanging') {
    for (let k = 0; k < c.cards; k++) {
      const aa = a + (k / c.cards) * Math.PI;
      const kx = Math.cos(aa) * w;
      const kz = Math.sin(aa) * w;
      b.card(c.x, c.y, c.z, kx, 0, kz, 0, h, 0, cardColor(p, c, k, crownY), sway, crownY, tex, (c.seed + k) % 2 === 0, true);
    }
    return;
  }
  if (c.kind === 'flat') {
    const parts: [number, number, number, number, number, number][] = [
      [ca * w, 0, sa * w, -sa * w * 0.8, 0, ca * w * 0.8],
      [ca * w, 0, sa * w, ca * h * 0.55, h * 0.7, sa * h * 0.55],
      [-sa * w, 0, ca * w, ca * h * 0.55, h * 0.7, sa * h * 0.55],
      [ca * w * 0.75, 0, sa * w * 0.75, -sa * h * 0.5, h * 0.55, ca * h * 0.5],
    ];
    for (let k = 0; k < c.cards; k++) {
      const q = parts[k % parts.length]!;
      b.card(c.x, c.y, c.z, q[0], q[1], q[2], q[3], q[4], q[5], cardColor(p, c, k, crownY), sway, crownY, tex, (c.seed + k) % 2 === 0);
    }
    return;
  }
  const tilt: [number, number, number][] = [
    [ca * 0.62, 0.78, sa * 0.62],
    [-sa * 0.55, 0.84, ca * 0.55],
  ];
  for (let k = 0; k < c.cards; k++) {
    const color = cardColor(p, c, k, crownY);
    if (k === 0) b.card(c.x, c.y, c.z, ca * w, 0, sa * w, 0, h, 0, color, sway, crownY, tex, (c.seed + k) % 2 === 0);
    else if (k === 1) b.card(c.x, c.y, c.z, -sa * w, 0, ca * w, 0, h, 0, color, sway, crownY, tex, (c.seed + k) % 2 === 0);
    else {
      const t = tilt[(k - 2) % tilt.length]!;
      b.card(c.x, c.y, c.z, -sa * w, 0, ca * w, t[0] * h, t[1] * h, t[2] * h, color, sway, crownY, tex, (c.seed + k) % 2 === 0);
    }
  }
}

function drawTwig(b: Bld, c: Clump): void {
  const ex = c.x;
  const ey = c.kind === 'hanging' ? c.y + c.h * 0.5 : c.y;
  const ez = c.z;
  const len = Math.hypot(ex - c.ax, ey - c.ay, ez - c.az);
  if (len < 0.08) return;
  const r = 0.015 + 0.015 * hash01(c.seed + 7);
  b.cylinder(c.ax, c.ay, c.az, ex, ey, ez, r, r * 0.7, 4, clamp(c.asway, 0.15, 0.5), 0.7);
}

function drawTrunk(b: Bld, trunk: Node[], sides: number): void {
  for (let i = 1; i < trunk.length; i++) {
    const a = trunk[i - 1]!;
    const c = trunk[i]!;
    b.cylinder(a.x, a.y, a.z, c.x, c.y, c.z, a.r, c.r, sides, a.sway, c.sway);
  }
}

function drawLimbs(b: Bld, limbs: Limb[], sides: number, children: boolean): void {
  for (const l of limbs) {
    if (l.child && !children) continue;
    for (let i = 1; i < l.pts.length; i++) {
      const a = l.pts[i - 1]!;
      const c = l.pts[i]!;
      b.cylinder(a.x, a.y, a.z, c.x, c.y, c.z, a.r, c.r, sides, a.sway, c.sway);
    }
  }
}

function drawNear(b: Bld, plan: Plan): void {
  const p = plan.p;
  drawTrunk(b, plan.trunk, p.trunkR < 0.12 ? 5 : 6);
  drawLimbs(b, plan.limbs, 4, true);
  for (let i = 0; i < plan.clumps.length; i++) {
    if (i % 4 === 0) drawTwig(b, plan.clumps[i]!);
  }
  for (const c of plan.clumps) drawClump(b, p, c, 1, plan.crownY);
}

function drawLod0(b: Bld, plan: Plan): void {
  const p = plan.p;
  drawTrunk(b, plan.trunk, 5);
  drawLimbs(b, plan.limbs, 4, false);
  const keep = Math.max(1, Math.round(plan.clumps.length * 0.45));
  const order = plan.clumps.map((c, i) => ({ i, score: Math.hypot(c.x, c.z) + c.y * 0.08 })).sort((a, b) => b.score - a.score);
  const selected = new Set<number>();
  let top = 0;
  for (let i = 1; i < plan.clumps.length; i++) if (plan.clumps[i]!.y > plan.clumps[top]!.y) top = i;
  selected.add(top);
  for (const o of order) {
    if (selected.size >= keep) break;
    selected.add(o.i);
  }
  for (let i = 0; i < plan.clumps.length; i++) {
    if (selected.has(i)) drawClump(b, p, plan.clumps[i]!, 1.5, plan.crownY);
  }
}

function drawMid(b: Bld, plan: Plan): void {
  const p = plan.p;
  drawTrunk(b, plan.trunk, 4);
  const scaffolds = plan.limbs.filter((l) => !l.child && !l.stub);
  const count = Math.min(3, scaffolds.length);
  for (let i = 0; i < count; i++) {
    const l = scaffolds[Math.floor((i + 0.5) * scaffolds.length / count)]!;
    for (let j = 1; j < l.pts.length; j++) {
      const a = l.pts[j - 1]!;
      const c = l.pts[j]!;
      b.cylinder(a.x, a.y, a.z, c.x, c.y, c.z, a.r, c.r, 4, a.sway, c.sway);
    }
  }
  const cards = Math.max(8, Math.min(14, plan.clumps.length));
  const sorted = plan.clumps.map((c, i) => ({ c, a: Math.atan2(c.z, c.x), i })).sort((a, b) => a.a - b.a);
  const crownH = Math.max(1, p.crownTop - p.crownBase);
  for (let k = 0; k < cards; k++) {
    const c = sorted[Math.floor((k + 0.5) * sorted.length / cards)]!.c;
    const tex = c.blossom ? LEAF_LAYER.BLOSSOM : b.leafLayer;
    const sway = clamp(0.7 + 0.25 * (c.y / p.height), 0.7, 1);
    const a = Math.atan2(c.z, c.x);
    if (p.special === 'willow') {
      const size = Math.max(0.6, p.crownR * 0.22);
      b.card(c.x, plan.crownY, c.z, Math.cos(a) * size * 0.5, 0, Math.sin(a) * size * 0.5, 0, crownH * 0.38, 0, cardColor(p, c, k, plan.crownY), sway, plan.crownY, tex, k % 2 === 0, true);
    } else {
      const w = Math.max(c.w * 4, p.crownR * 0.75);
      const h = Math.max(c.h * 4, crownH * 0.45);
      b.card(c.x, c.y, c.z, Math.cos(a) * w * 0.5, 0, Math.sin(a) * w * 0.5, 0, h * 0.5, 0, cardColor(p, c, k, plan.crownY), sway, plan.crownY, tex, k % 2 === 0);
    }
  }
}

function drawFar(b: Bld, plan: Plan): void {
  const p = plan.p;
  if (!p.bush) b.cylinder(0, 0, 0, 0, p.trunkH, 0, p.trunkR, p.trunkR * 0.55, 4, 0, 0.12);
  const y0 = p.bush ? p.trunkH * 0.35 : p.trunkH * 0.9;
  const span = Math.max(0.4, p.height - y0 - 0.15);
  const mid = (y0 + p.height) * 0.5;
  const halfH = (p.height - y0) * 0.48;
  const shell = p.blossom !== undefined && p.blossomFrac >= 0.45 ? p.blossom : p.leaf;
  const tex = p.blossom !== undefined && p.blossomFrac >= 0.45 ? LEAF_LAYER.BLOSSOM : b.leafLayer;
  const cy = y0 + span * 0.48;
  b.card(0, mid, 0, p.crownR * 1.15, 0, 0, 0, halfH, 0, shell, 0.35, cy, tex, false);
  b.card(0, mid, 0, 0, 0, p.crownR * 1.15, 0, halfH, 0, shell, 0.35, cy, tex, true);
  b.card(0, mid + halfH * 0.15, 0, p.crownR, 0, 0, 0, 0, p.crownR, shell, 0.35, cy, tex, false);
}

/** Near, mid, or far mesh for one species variant. */
export function buildRealisticModel(species: number, variant: number, lod: 0 | 1 | 2 | 3): VegModel {
  const p = profile(species);
  const k = variantScale(variant);
  const seedVariant = lod === 1 || lod === 2 ? 0 : variant;
  const plan = buildPlan(species, seedVariant);
  const b = new Bld(p, species);
  if (lod === 3) drawNear(b, plan);
  else if (lod === 0) drawLod0(b, plan);
  else if (lod === 2) drawMid(b, plan);
  else drawFar(b, plan);
  return b.finish(p.height * k, Math.max(p.crownR, p.trunkR) * k, k);
}

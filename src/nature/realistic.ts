/**
 * Summer trees and bushes as low-poly trunks plus alpha-tested leaf cards.
 * Deterministic from species and variant. Triangle caps match Article 4:
 * near (lod 3) ≤ 6000, the 70 m model (lod 0) ≤ 1500, mid (lod 2) ≤ 400, far (lod 1) ≤ 24.
 * Bark and leaf *colours* are on the vertices; the shader multiplies a procedural
 * bark/leaf texture (authored here, no external file, so no KTX2 transcoder).
 */
import { SPECIES } from './models.ts';
import type { VegModel } from './models.ts';

interface Profile {
  height: number;
  trunkH: number;
  trunkR: number;
  crownR: number;
  crownH: number;
  /** 0 upright, 1 hanging (willow). */
  droop: number;
  /** Pine: radius shrinks toward the top. */
  cone: boolean;
  leaf: [number, number, number];
  trunk: [number, number, number];
  /** Extra cards in this colour (lilac, pink). */
  blossom?: [number, number, number];
  blossomFrac: number;
  cards: number;
  bush: boolean;
}

const GREEN = (r: number, g: number, b: number): [number, number, number] => [r / 255, g / 255, b / 255];

function profile(species: number, variant: number): Profile {
  const k = 1 + (variant - 1) * 0.08;
  const trunk = GREEN(92, 68, 46);
  const base = (p: Omit<Profile, 'trunk'>): Profile => ({ ...p, trunk });
  switch (species) {
    case SPECIES.LINDEN:
      return base({ height: 9.2 * k, trunkH: 2.6, trunkR: 0.22, crownR: 2.8 * k, crownH: 6.2, droop: 0.05, cone: false, leaf: GREEN(92, 138, 58), blossomFrac: 0, cards: 88, bush: false });
    case SPECIES.PLANE:
      return base({ height: 12 * k, trunkH: 3.2, trunkR: 0.28, crownR: 4 * k, crownH: 7.5, droop: 0.02, cone: false, leaf: GREEN(104, 150, 64), blossomFrac: 0, cards: 80, bush: false });
    case SPECIES.ACACIA:
      return base({ height: 7.2 * k, trunkH: 1.8, trunkR: 0.18, crownR: 3.6 * k, crownH: 3.2, droop: 0.15, cone: false, leaf: GREEN(138, 168, 78), blossomFrac: 0, cards: 80, bush: false });
    case SPECIES.POPLAR:
      return base({ height: 18 * k, trunkH: 4, trunkR: 0.2, crownR: 1.35 * k, crownH: 13, droop: 0, cone: false, leaf: GREEN(78, 130, 52), blossomFrac: 0, cards: 72, bush: false });
    case SPECIES.WILLOW:
      return base({ height: 7.5 * k, trunkH: 2.2, trunkR: 0.24, crownR: 3.4 * k, crownH: 4.2, droop: 0.92, cone: false, leaf: GREEN(150, 176, 110), blossomFrac: 0, cards: 88, bush: false });
    case SPECIES.PINE:
      return base({ height: 14 * k, trunkH: 3.5, trunkR: 0.22, crownR: 2.6 * k, crownH: 10, droop: 0.25, cone: true, leaf: GREEN(46, 90, 52), blossomFrac: 0, cards: 64, bush: false });
    case SPECIES.BUSH:
      return base({ height: 1.6 * k, trunkH: 0.15, trunkR: 0.06, crownR: 0.9 * k, crownH: 1.35, droop: 0.1, cone: false, leaf: GREEN(70, 120, 48), blossomFrac: 0, cards: 24, bush: true });
    case SPECIES.BUSH_LILAC:
      return base({ height: 1.75 * k, trunkH: 0.2, trunkR: 0.06, crownR: 0.95 * k, crownH: 1.45, droop: 0.05, cone: false, leaf: GREEN(74, 116, 52), blossom: GREEN(180, 138, 214), blossomFrac: 0.45, cards: 28, bush: true });
    case SPECIES.BUSH_PINK:
      return base({ height: 1.55 * k, trunkH: 0.15, trunkR: 0.05, crownR: 0.85 * k, crownH: 1.3, droop: 0.08, cone: false, leaf: GREEN(86, 130, 58), blossom: GREEN(214, 120, 150), blossomFrac: 0.5, cards: 28, bush: true });
    default:
      return base({ height: 8.5 * k, trunkH: 2.4, trunkR: 0.24, crownR: 3.2 * k, crownH: 5.6, droop: 0.04, cone: false, leaf: GREEN(70, 118, 48), blossomFrac: 0, cards: 96, bush: false });
  }
}

class Bld {
  readonly pos: number[] = [];
  readonly nor: number[] = [];
  readonly col: number[] = [];
  readonly sway: number[] = [];
  readonly uv: number[] = [];
  readonly leaf: number[] = [];
  readonly idx: number[] = [];

  private v(x: number, y: number, z: number, nx: number, ny: number, nz: number, r: number, g: number, b: number, sway: number, u: number, vv: number, leaf: number): number {
    const l = Math.hypot(nx, ny, nz) || 1;
    this.pos.push(x, y, z);
    this.nor.push(nx / l, ny / l, nz / l);
    this.col.push(r, g, b);
    this.sway.push(sway);
    this.uv.push(u, vv);
    this.leaf.push(leaf);
    return this.pos.length / 3 - 1;
  }

  tri(a: number, b: number, c: number): void {
    this.idx.push(a, b, c);
  }

  cylinder(
    ax: number, ay: number, az: number, bx: number, by: number, bz: number,
    r0: number, r1: number, sides: number,
    color: [number, number, number], sway0: number, sway1: number,
  ): void {
    let dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.hypot(dx, dy, dz) || 1;
    dx /= len; dy /= len; dz /= len;
    let ux = 0, uy = 1, uz = 0;
    if (Math.abs(dy) > 0.9) { ux = 1; uy = 0; }
    let rx = uy * dz - uz * dy, ry = uz * dx - ux * dz, rz = ux * dy - uy * dx;
    let rl = Math.hypot(rx, ry, rz) || 1;
    rx /= rl; ry /= rl; rz /= rl;
    const px = dy * rz - dz * ry, py = dz * rx - dx * rz, pz = dx * ry - dy * rx;
    const ring = (t: number, rad: number, sway: number): number[] => {
      const ids: number[] = [];
      const cx = ax + (bx - ax) * t, cy = ay + (by - ay) * t, cz = az + (bz - az) * t;
      for (let i = 0; i < sides; i++) {
        const a = (i / sides) * Math.PI * 2;
        const nx = Math.cos(a) * rx + Math.sin(a) * px;
        const ny = Math.cos(a) * ry + Math.sin(a) * py;
        const nz = Math.cos(a) * rz + Math.sin(a) * pz;
        ids.push(this.v(cx + nx * rad, cy + ny * rad, cz + nz * rad, nx, ny, nz, color[0], color[1], color[2], sway, i / sides, cy / 8, 0));
      }
      return ids;
    };
    const segs = sway1 > 0.4 ? 2 : 1;
    let prev = ring(0, r0, sway0);
    for (let s = 1; s <= segs; s++) {
      const t = s / segs;
      const next = ring(t, r0 + (r1 - r0) * t, sway0 + (sway1 - sway0) * t);
      for (let i = 0; i < sides; i++) {
        const j = (i + 1) % sides;
        this.tri(prev[i]!, next[i]!, next[j]!);
        this.tri(prev[i]!, next[j]!, prev[j]!);
      }
      prev = next;
    }
  }

  /**
   * One quad. Normals point mostly out from the crown centre, so Lambert shades the mass
   * like a ball of leaves instead of one flat plane. The material is double-sided.
   */
  card(
    cx: number, cy: number, cz: number,
    rx: number, ry: number, rz: number,
    ux: number, uy: number, uz: number,
    color: [number, number, number], sway: number, crownY: number,
  ): void {
    const fnx = ry * uz - rz * uy;
    const fny = rz * ux - rx * uz;
    const fnz = rx * uy - ry * ux;
    const fl = Math.hypot(fnx, fny, fnz) || 1;
    const n = (x: number, y: number, z: number, u: number, v: number): number => {
      const yy = Math.max(0.02, y);
      let vx = x, vy = yy - crownY, vz = z;
      const rl = Math.hypot(vx, vy, vz) || 1;
      vx /= rl; vy /= rl; vz /= rl;
      return this.v(
        x, yy, z,
        fnx / fl * 0.22 + vx * 0.78,
        fny / fl * 0.22 + vy * 0.78,
        fnz / fl * 0.22 + vz * 0.78,
        color[0], color[1], color[2], sway, u, v, 1,
      );
    };
    const a = n(cx - rx - ux, cy - ry - uy, cz - rz - uz, 0, 0);
    const b = n(cx + rx - ux, cy + ry - uy, cz + rz - uz, 1, 0);
    const c = n(cx + rx + ux, cy + ry + uy, cz + rz + uz, 1, 1);
    const d = n(cx - rx + ux, cy - ry + uy, cz - rz + uz, 0, 1);
    this.tri(a, b, c);
    this.tri(a, c, d);
  }

  finish(height: number, radius: number): VegModel {
    return {
      positions: Float32Array.from(this.pos),
      normals: Float32Array.from(this.nor),
      colors: Float32Array.from(this.col),
      sway: Float32Array.from(this.sway),
      uvs: Float32Array.from(this.uv),
      leaf: Float32Array.from(this.leaf),
      indices: Uint32Array.from(this.idx),
      height,
      radius,
    };
  }
}

function cardCount(p: Profile, lod: 0 | 1 | 2 | 3): number {
  if (lod === 1) return 2;
  if (lod === 2) return Math.max(12, Math.round(p.cards * 0.55));
  if (lod === 0) return Math.max(10, Math.round(p.cards * 0.5));
  return p.cards;
}

/**
 * Card i = 0 is the top of the crown and i = 1 is the widest. Every LOD except the
 * far billboard keeps those two, so the silhouette stays within the lod 3 / lod 0 test.
 * Later cards sit inside that shell.
 */
function crownSample(i: number, p: Profile): { cx: number; cy: number; cz: number; ang: number; t: number; scale: number } {
  const y0 = p.bush ? p.trunkH * 0.35 : p.trunkH * 0.9;
  const span = Math.max(0.4, p.height - y0 - 0.15);
  if (i === 0) return { cx: 0, cy: p.height - 0.05, cz: 0, ang: 0, t: 1, scale: 0.9 };
  // Widest sample stays inside the crown; the card itself reaches the silhouette.
  if (i === 1) return { cx: p.crownR * 0.42, cy: y0 + span * 0.45, cz: 0, ang: 0, t: 0.5, scale: 1 };
  const golden = Math.PI * (3 - Math.sqrt(5));
  const t = (i * 0.61803398875) % 1;
  const ang = i * golden;
  // Keep clusters near the axis so they overlap into a crown instead of a spiral of separate tufts.
  const shell = p.cone ? (1.05 - t) * 0.38 : Math.sin(Math.PI * t) * 0.42;
  const rad = p.crownR * shell;
  return { cx: Math.cos(ang) * rad, cy: y0 + t * span, cz: Math.sin(ang) * rad, ang, t, scale: 0.82 };
}

function keptIndices(full: number, keep: number): number[] {
  if (keep >= full) {
    const ids: number[] = [];
    for (let i = 0; i < full; i++) ids.push(i);
    return ids;
  }
  const ids = [0, 1];
  for (let i = 2; ids.length < keep && i < full; i++) ids.push(i);
  return ids;
}

function addCrown(b: Bld, p: Profile, n: number, lod: 0 | 1 | 2 | 3): void {
  const y0 = p.bush ? p.trunkH * 0.35 : p.trunkH * 0.9;
  const span = Math.max(0.4, p.height - y0 - 0.15);
  const crownY = y0 + span * 0.48;
  // Each card is a large slice of the crown, and there are dozens of them. None is the whole tree.
  const leafW = (p.bush ? p.crownR * 0.98 : p.crownR * 0.92) * (p.cone ? 0.72 : 1);
  const leafH = p.bush ? p.crownH * 0.62 : Math.min(p.crownH * 0.38, Math.max(p.crownR * 0.75, 1.2));
  const mid = (y0 + p.height) * 0.5;
  const halfH = (p.height - y0) * 0.48;
  const shellColor = p.blossom !== undefined && p.blossomFrac >= 0.45 ? p.blossom : p.leaf;
  if (lod === 2) {
    // Past 70 m a few crown-sized planes read as a tree. They are not used up close, where one plane filled the screen.
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI;
      const blossom = p.blossom !== undefined && i < Math.round(3 * p.blossomFrac);
      b.card(0, mid, 0, Math.cos(a) * p.crownR, 0, Math.sin(a) * p.crownR, 0, halfH, 0, blossom ? p.blossom! : p.leaf, 0.55, crownY);
    }
    b.card(0, crownY + span * 0.08, 0, p.crownR * 0.95, 0, 0, 0, 0, p.crownR * 0.95, shellColor, 0.45, crownY);
  }
  if (lod === 1) {
    // Distant impostor: two crossed cards and a canopy. Small on screen, still a crown from the air.
    b.card(0, mid, 0, leafW * 1.35, 0, 0, 0, halfH, 0, shellColor, 0.35, crownY);
    b.card(0, mid, 0, 0, 0, leafW * 1.35, 0, halfH, 0, shellColor, 0.35, crownY);
    b.card(0, mid + halfH * 0.15, 0, leafW * 1.15, 0, 0, 0, 0, leafW * 1.15, shellColor, 0.35, crownY);
    return;
  }
  const samples = lod === 2 ? keptIndices(p.cards, Math.min(n, 10)) : keptIndices(p.cards, n);
  for (const i of samples) {
    const s = crownSample(i, p);
    const blossom = p.blossom !== undefined && (i % 7) < Math.round(7 * p.blossomFrac);
    const base = blossom ? p.blossom! : p.leaf;
    const shade = blossom ? 1 : 0.86 + 0.22 * s.t;
    const color: [number, number, number] = [base[0] * shade, base[1] * shade, base[2] * shade];
    const droop = p.droop;
    let ux = Math.cos(s.ang) * droop;
    let uy = 1 - droop * 0.85;
    let uz = Math.sin(s.ang) * droop;
    const ul = Math.hypot(ux, uy, uz) || 1;
    ux /= ul; uy /= ul; uz /= ul;
    const rx = -Math.sin(s.ang);
    const rz = Math.cos(s.ang);
    const w = leafW * s.scale;
    const h = leafH * s.scale;
    const sway = Math.min(1, 0.7 + 0.25 * s.t);
    // Upright card, a cross, and a card leaned toward the sky so the crown has area from above.
    b.card(s.cx, s.cy, s.cz, rx * w * 0.5, 0, rz * w * 0.5, ux * h * 0.5, uy * h * 0.5, uz * h * 0.5, color, sway, crownY);
    b.card(s.cx, s.cy, s.cz, -rz * w * 0.5, 0, rx * w * 0.5, ux * h * 0.5, uy * h * 0.5, uz * h * 0.5, color, sway, crownY);
    const tilt = 0.78;
    b.card(
      s.cx, s.cy, s.cz,
      rx * w * 0.55, 0, rz * w * 0.55,
      Math.cos(s.ang) * h * tilt * 0.5, h * (1 - tilt) * 0.5, Math.sin(s.ang) * h * tilt * 0.5,
      color, sway, crownY,
    );
  }
}

/** Near, mid, or far mesh for one species variant. */
export function buildRealisticModel(species: number, variant: number, lod: 0 | 1 | 2 | 3): VegModel {
  const p = profile(species, variant);
  const b = new Bld();
  const sides = lod === 3 ? 6 : lod === 0 ? 5 : 4;
  if (lod !== 1 || !p.bush) {
    b.cylinder(0, 0, 0, 0, p.trunkH, 0, p.trunkR, p.trunkR * 0.55, sides, p.trunk, 0, 0.12);
  }
  if (lod === 3 && !p.bush) {
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + variant;
      const y = p.trunkH * 0.72;
      b.cylinder(0, y, 0, Math.cos(a) * p.crownR * 0.55, y + p.crownH * 0.35, Math.sin(a) * p.crownR * 0.55, p.trunkR * 0.28, p.trunkR * 0.1, 4, p.trunk, 0.15, 0.45);
    }
  }
  addCrown(b, p, cardCount(p, lod), lod);
  return b.finish(p.height, Math.max(p.crownR, p.trunkR));
}

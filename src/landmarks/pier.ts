import { buildProp, PROP } from '../fine/prop-models.ts';
import { fromLatLon } from './geo.ts';
import { PIER_AVENUE_END, PIER_AVENUE_PREVIOUS } from './data.ts';
import {
  buildResult, LandmarkMeshBuilder, pointInPolygon, rgb,
  type Landmark, type LandmarkBuildContext, type LandmarkSurface,
} from './types.ts';
import type { Bbox } from '../world/manifest.ts';

const PAVE = rgb(0x8a8b86);
const PAVE_ALT = rgb(0xa7a39a);
const PAVE_DARK = rgb(0x6f7772);
const JOINT = rgb(0x5f625e);
const QUAY = rgb(0x626762);
const RAIL = rgb(0x263331);
const METAL = rgb(0x303836);
const FLOWER = rgb(0xc75b48);
const FOLIAGE = rgb(0x3c713e);
const STONE = rgb(0x858984);
const WATER = rgb(0x557a86);

type Point = [number, number];
interface Basis { x: number; z: number; ux: number; uz: number; vx: number; vz: number; }
export interface PierLayout { root: Point; tip: Point; shoreline: Point; basis: Basis; deckLength: number; }

function pointAt(b: Basis, a: number, c: number, y: number): { x: number; y: number; z: number } {
  return { x: b.x + b.ux * a + b.vx * c, y, z: b.z + b.uz * a + b.vz * c };
}
function local(b: Basis, a: number, c: number): Point { return [b.x + b.ux * a + b.vx * c, b.z + b.uz * a + b.vz * c]; }
function yAt(ctx: LandmarkBuildContext, x: number, z: number, fallback: number): number {
  const y = ctx.groundAt(x, z);
  return y !== null && Number.isFinite(y) ? y : fallback;
}

function orientedBox(b: LandmarkMeshBuilder, b0: Basis, a0: number, a1: number, c0: number, c1: number, y0: number, y1: number, color: readonly [number, number, number], bottom = true): void {
  const p = (a: number, c: number, y: number) => ({ x: b0.x + b0.ux * a + b0.vx * c, y, z: b0.z + b0.uz * a + b0.vz * c });
  const q = (a: number, c: number, y: number, nx: number, ny: number, nz: number) => ({ ...p(a, c, y), nx, ny, nz });
  b.addQuad([q(a0, c1, y1, 0, 1, 0), q(a1, c1, y1, 0, 1, 0), q(a1, c0, y1, 0, 1, 0), q(a0, c0, y1, 0, 1, 0)], color);
  if (bottom) b.addQuad([q(a0, c0, y0, 0, -1, 0), q(a1, c0, y0, 0, -1, 0), q(a1, c1, y0, 0, -1, 0), q(a0, c1, y0, 0, -1, 0)], color);
  b.addQuad([q(a0, c1, y0, b0.vx, 0, b0.vz), q(a1, c1, y0, b0.vx, 0, b0.vz), q(a1, c1, y1, b0.vx, 0, b0.vz), q(a0, c1, y1, b0.vx, 0, b0.vz)], color);
  b.addQuad([q(a1, c0, y0, -b0.vx, 0, -b0.vz), q(a0, c0, y0, -b0.vx, 0, -b0.vz), q(a0, c0, y1, -b0.vx, 0, -b0.vz), q(a1, c0, y1, -b0.vx, 0, -b0.vz)], color);
  b.addQuad([q(a1, c1, y0, b0.ux, 0, b0.uz), q(a1, c0, y0, b0.ux, 0, b0.uz), q(a1, c0, y1, b0.ux, 0, b0.uz), q(a1, c1, y1, b0.ux, 0, b0.uz)], color);
  b.addQuad([q(a0, c0, y0, -b0.ux, 0, -b0.uz), q(a0, c1, y0, -b0.ux, 0, -b0.uz), q(a0, c1, y1, -b0.ux, 0, -b0.uz), q(a0, c0, y1, -b0.ux, 0, -b0.uz)], color);
}

function orientedPaving(b: LandmarkMeshBuilder, basis: Basis, a0: number, a1: number, c0: number, c1: number, ctx: LandmarkBuildContext, fallback: number, quality: 'high' | 'low', skipWater: boolean, fixedY: number | null = null): number {
  const tile = quality === 'high' ? 0.85 : 1.6;
  let area = 0;
  for (let a = a0 + tile * 0.5; a < a1; a += tile) for (let c = c0 + tile * 0.5; c < c1; c += tile) {
    const [x, z] = local(basis, a, c);
    if (skipWater && ctx.isWater?.(x, z)) continue;
    const y = fixedY ?? yAt(ctx, x, z, fallback);
    const half = tile * 0.43;
    // mortar bed: a flat top quad over the whole cell shows in the joints instead of the lawn
    const m = tile / 2, mq = (aa: number, cc: number) => ({ ...pointAt(basis, aa, cc, y + 0.02), nx: 0, ny: 1, nz: 0 });
    b.addQuad([mq(a - m, c + m), mq(a + m, c + m), mq(a + m, c - m), mq(a - m, c - m)], JOINT);
    orientedBox(b, basis, a - half, a + half, c - half, c + half, y + 0.02, y + 0.07, (Math.floor(a * 2) + Math.floor(c * 3)) % 7 === 0 ? PAVE_DARK : (Math.floor(a + c) & 1) === 0 ? PAVE : PAVE_ALT, false);
    area += tile * tile;
  }
  return area;
}

function orientedSurface(basis: Basis, a0: number, a1: number, c0: number, c1: number, ctx: LandmarkBuildContext, lift: number, notWater: boolean, fixedY: number | null = null): LandmarkSurface {
  return { heightAt: (x, z) => {
    const a = (x - basis.x) * basis.ux + (z - basis.z) * basis.uz, c = (x - basis.x) * basis.vx + (z - basis.z) * basis.vz;
    if (a < a0 || a > a1 || c < c0 || c > c1 || (notWater && ctx.isWater?.(x, z))) return null;
    return (fixedY ?? yAt(ctx, x, z, 0)) + lift;
  } };
}

function circle(cx: number, cz: number, r: number): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < 12; i++) { const a = i * Math.PI * 2 / 12; out.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]); }
  return out;
}

/** Finds the quay edge from the avenue data and projects the deck along the same axis. */
export function resolvePierLayout(ctx: LandmarkBuildContext, bbox: Bbox): PierLayout | null {
  const end = fromLatLon(bbox, PIER_AVENUE_END[0], PIER_AVENUE_END[1]);
  const prev = fromLatLon(bbox, PIER_AVENUE_PREVIOUS[0], PIER_AVENUE_PREVIOUS[1]);
  const dx = end.x - prev.x, dz = end.z - prev.z, length = Math.hypot(dx, dz) || 1;
  const basis: Basis = { x: end.x, z: end.z, ux: dx / length, uz: dz / length, vx: -dz / length, vz: dx / length };
  if (ctx.isWater === undefined) return null;
  let shore = -1;
  for (let a = 0; a <= 240; a += 1) {
    const [x, z] = local(basis, a, 0);
    if (ctx.isWater(x, z)) { shore = a; break; }
  }
  if (shore < 0) return null;
  const root = local(basis, shore, 0);
  if (ctx.groundAt(root[0], root[1]) === null) return null;
  let deckLength = 45;
  for (let a = 0; a <= 45; a += 1) {
    const [x, z] = local(basis, shore + a, 0);
    if (!ctx.isWater(x, z) || ctx.groundAt(x, z) === null) { deckLength = Math.max(0, a - 1); break; }
  }
  if (deckLength < 20) return null;
  const rootedBasis: Basis = { ...basis, x: root[0], z: root[1] };
  const tip = local(rootedBasis, deckLength, 0);
  return { root, tip, shoreline: root, basis: rootedBasis, deckLength };
}

export function createPier(bbox: Bbox): Landmark {
  const avenue = fromLatLon(bbox, PIER_AVENUE_END[0], PIER_AVENUE_END[1]);
  const previous = fromLatLon(bbox, PIER_AVENUE_PREVIOUS[0], PIER_AVENUE_PREVIOUS[1]);
  const dx = avenue.x - previous.x, dz = avenue.z - previous.z, len = Math.hypot(dx, dz) || 1;
  const ux = dx / len, uz = dz / len, vx = -uz, vz = ux;
  const propZone: Point[] = [[avenue.x - ux * 44 - vx * 19, avenue.z - uz * 44 - vz * 19], [avenue.x + ux * 18 - vx * 19, avenue.z + uz * 18 - vz * 19], [avenue.x + ux * 18 + vx * 19, avenue.z + uz * 18 + vz * 19], [avenue.x - ux * 44 + vx * 19, avenue.z - uz * 44 + vz * 19]];
  const itemClearances = [-30, -14, 2, 17].flatMap((a) => [circle(avenue.x + ux * a + vx * -13, avenue.z + uz * a + vz * -13, 2), circle(avenue.x + ux * a + vx * 13, avenue.z + uz * a + vz * 13, 2)]);
  return {
    id: 'pier-ushakova',
    name: 'Пірс',
    anchor: { lat: PIER_AVENUE_END[0], lon: PIER_AVENUE_END[1], x: avenue.x, z: avenue.z },
    footprint: propZone,
    propExclusions: [{ polygon: propZone, kinds: [PROP.LAMP, PROP.BENCH, PROP.BIN] }],
    vegetationExclusions: itemClearances,
    ready: (ctx) => resolvePierLayout(ctx, bbox) !== null,
    build: (ctx) => {
      const layout = resolvePierLayout(ctx, bbox);
      if (layout === null) return buildResult([], []);
      const { basis, root, deckLength } = layout;
      const fallback = yAt(ctx, avenue.x, avenue.z, 0);
      const deckY = yAt(ctx, root[0], root[1], fallback) + 0.8;
      const promenadeY = yAt(ctx, ...local(basis, -12, 0), fallback);
      const opaque = new LandmarkMeshBuilder(), lamp = new LandmarkMeshBuilder(), water = new LandmarkMeshBuilder();
      const surfaces: LandmarkSurface[] = [];
      const quality = ctx.quality === 'high' ? 'high' : 'low';
      let pavedArea = orientedPaving(opaque, basis, -44, -1, -17, 17, ctx, promenadeY, quality, true);
      orientedBox(opaque, basis, -44, -1, -17, -16.7, promenadeY - 0.05, promenadeY + 0.16, QUAY);
      orientedBox(opaque, basis, -44, -1, 16.7, 17, promenadeY - 0.05, promenadeY + 0.16, QUAY);
      surfaces.push(orientedSurface(basis, -44, -1, -17, 17, ctx, 0.08, true));

      const stairStart = -10, stairEnd = 0, stairWidth = 3.5, risers = quality === 'high' ? 10 : 7;
      const stairTop = promenadeY + 0.06, stairBottom = deckY;
      for (let i = 0; i < risers; i++) {
        const a0 = stairStart + (stairEnd - stairStart) * i / risers, a1 = stairStart + (stairEnd - stairStart) * (i + 1) / risers;
        const y = stairTop + (stairBottom - stairTop) * (i + 1) / risers;
        orientedBox(opaque, basis, a0, a1 + 0.06, -stairWidth, stairWidth, y - 0.16, y, PAVE);
      }
      surfaces.push({ heightAt: (x, z) => {
        const a = (x - basis.x) * basis.ux + (z - basis.z) * basis.uz, c = (x - basis.x) * basis.vx + (z - basis.z) * basis.vz;
        if (a < stairStart || a > stairEnd || Math.abs(c) > stairWidth) return null;
        return stairTop + (stairBottom - stairTop) * Math.floor((a - stairStart) / (stairEnd - stairStart) * risers) / risers;
      } });
      // Ramp follows the quay line and is intentionally continuous beside the steps.
      orientedBox(opaque, basis, stairStart, stairEnd, 4.4, 6.2, stairTop, stairBottom, PAVE_ALT);
      surfaces.push({ heightAt: (x, z) => {
        const a = (x - basis.x) * basis.ux + (z - basis.z) * basis.uz, c = (x - basis.x) * basis.vx + (z - basis.z) * basis.vz;
        return a >= stairStart && a <= stairEnd && c >= 4.4 && c <= 6.2 ? stairTop + (stairBottom - stairTop) * (a - stairStart) / (stairEnd - stairStart) : null;
      } });

      // Retaining wall at the water line and a detailed 40–45 m deck over sampled water cells.
      orientedBox(opaque, basis, -1, deckLength, -3.2, -2.6, deckY - 2.4, deckY, QUAY);
      pavedArea += orientedPaving(opaque, basis, 0, deckLength, -2.55, 2.55, ctx, deckY - 0.8, quality, false, deckY);
      surfaces.push(orientedSurface(basis, 0, deckLength, -2.55, 2.55, ctx, 0.08, false, deckY));
      for (const side of [-2.35, 2.35]) {
        for (let a = 1; a < deckLength; a += 2.4) {
          const [x, z] = local(basis, a, side);
          opaque.cylinder(x, deckY + 0.05, z, 0.055, 1.05, RAIL, 8);
        }
        orientedBox(opaque, basis, 0, deckLength, side - 0.055, side + 0.055, deckY + 0.83, deckY + 0.95, RAIL);
        orientedBox(opaque, basis, 0, deckLength, side - 0.045, side + 0.045, deckY + 0.4, deckY + 0.48, RAIL);
      }
      surfaces.push({ heightAt: () => null, blockedAt: (x, z, y, bodyH = 1.8) => {
        const a = (x - basis.x) * basis.ux + (z - basis.z) * basis.uz, c = (x - basis.x) * basis.vx + (z - basis.z) * basis.vz;
        return a >= 0 && a <= deckLength && Math.abs(Math.abs(c) - 2.35) < 0.5 && y < deckY + 1 && y + bodyH > deckY;
      } });

      // Axial fountain and low planting beds on the promenade.
      const fountain = local(basis, -22, 0), fountainY = yAt(ctx, fountain[0], fountain[1], promenadeY) + 0.08;
      opaque.cylinder(fountain[0], fountainY, fountain[1], 2.45, 0.22, STONE, 24);
      water.addDisc(fountain[0], fountainY + 0.24, fountain[1], 2.02, WATER, 24);
      for (let i = 0; i < (quality === 'high' ? 12 : 6); i++) { const a = i * Math.PI * 2 / 12; water.cylinder(fountain[0] + Math.cos(a) * 1.45, fountainY + 0.24, fountain[1] + Math.sin(a) * 1.45, 0.035, 0.6, WATER, 7); }
      surfaces.push({ heightAt: (x, z) => Math.hypot(x - fountain[0], z - fountain[1]) < 2.1 ? fountainY + 0.24 : null });

      const lampModel = buildProp(PROP.LAMP, 1), benchModel = buildProp(PROP.BENCH, 1), binModel = buildProp(PROP.BIN, 0);
      const lampPoints: Point[] = [], benchPoints: Point[] = [];
      for (const a of [-38, -27, -15, -3]) for (const c of [-13, 13]) {
        const [x, z] = local(basis, a, c); lamp.addProp(lampModel, x, yAt(ctx, x, z, promenadeY), z, Math.atan2(basis.uz, basis.ux)); lampPoints.push([x, z]);
        if (c < 0 && a !== -27) { opaque.addProp(benchModel, x + basis.vx * 2, yAt(ctx, x, z, promenadeY), z + basis.vz * 2, 0); benchPoints.push([x, z]); }
      }
      for (const a of [-34, -6]) for (const c of [-15, 15]) { const [x, z] = local(basis, a, c); opaque.addProp(binModel, x, yAt(ctx, x, z, promenadeY), z, 0); }
      for (const a of [-35, -9]) for (const c of [-8, 8]) { const [x, z] = local(basis, a, c); opaque.cylinder(x, promenadeY + 0.04, z, 1.0, 0.18, STONE, 12); opaque.cylinder(x, promenadeY + 0.22, z, 0.75, 0.18, FOLIAGE, 12); for (let i = 0; i < 5; i++) opaque.cylinder(x + Math.cos(i * 2.5) * 0.45, promenadeY + 0.4, z + Math.sin(i * 2.5) * 0.45, 0.1, 0.16, FLOWER, 6); }
      for (const a of [0, deckLength * 0.5, deckLength - 1]) { const [x, z] = local(basis, a, 0); opaque.cylinder(x, deckY + 0.08, z, 0.19, 0.34, METAL, 8); }

      return buildResult([opaque.finish('opaque'), lamp.finish('lamp'), water.finish('water')], surfaces, [{ polygon: propZone, kinds: [PROP.LAMP, PROP.BENCH, PROP.BIN] }], {
        pavedAreaM2: pavedArea, lamps: lampPoints.length, benches: benchPoints.length,
        deckRoot: [...layout.root] as [number, number], deckTip: [...layout.tip] as [number, number], shoreline: [...layout.shoreline] as [number, number],
      });
    },
  };
}

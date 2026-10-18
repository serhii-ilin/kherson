import { buildProp, PROP } from '../fine/prop-models.ts';
import { fromLatLon } from './geo.ts';
import { OSM_LANDMARK_DATA, type LatLon } from './data.ts';
import {
  buildResult, LandmarkMeshBuilder, pointInPolygon, polygonArea, rgb,
  type Landmark, type LandmarkBuildContext, type LandmarkSurface,
} from './types.ts';
import type { Bbox } from '../world/manifest.ts';

const PAVE = rgb(0x9a9b95);
const PAVE_ALT = rgb(0x777b78);
const PAVE_DARK = rgb(0x777b78);
const JOINT = rgb(0x5f625e);
const GRANITE = rgb(0x9a9b95);
const GRANITE_DARK = rgb(0x5f625e);
const METAL = rgb(0x303735);
const FLOWER = rgb(0x8a5c52);
const FOLIAGE = rgb(0x3c713e);
const WATER = rgb(0x6e9aa0);
const FLAG_BLUE = rgb(0x1c6db2);
const FLAG_YELLOW = rgb(0xf0c72e);

export type Point = [number, number];

export interface FreedomSquareBasis {
  x: number;
  z: number;
  ux: number;
  uz: number;
  vx: number;
  vz: number;
  angleDeg: number;
}

export interface FreedomPlinthLayout {
  center: Point;
  basis: FreedomSquareBasis;
  length: number;
  width: number;
  angleDeg: number;
}

export interface FreedomSquareLayout {
  basis: FreedomSquareBasis;
  polygon: Point[];
  administration: Point[];
  administrationInner: Point[];
  plinth: FreedomPlinthLayout;
  localBounds: { a0: number; a1: number; c0: number; c1: number };
}

function project(bbox: Bbox, points: readonly LatLon[]): Point[] {
  return points.map(([lat, lon]) => {
    const p = fromLatLon(bbox, lat, lon);
    return [p.x, p.z];
  });
}

function centroid(poly: readonly Point[]): Point {
  let x = 0, z = 0;
  for (const p of poly) { x += p[0]; z += p[1]; }
  return [x / poly.length, z / poly.length];
}

function local(b: FreedomSquareBasis, a: number, c: number): Point {
  return [b.x + b.ux * a + b.vx * c, b.z + b.uz * a + b.vz * c];
}

function toLocal(b: FreedomSquareBasis, p: Point): Point {
  const dx = p[0] - b.x, dz = p[1] - b.z;
  return [dx * b.ux + dz * b.uz, dx * b.vx + dz * b.vz];
}

function yAt(ctx: LandmarkBuildContext, x: number, z: number, fallback: number): number {
  const y = ctx.groundAt(x, z);
  return y !== null && Number.isFinite(y) ? y : fallback;
}

function dominantRoadAngle(roads: readonly Point[][]): number {
  let xx = 0, xz = 0;
  for (const road of roads) for (let i = 1; i < road.length; i++) {
    const dx = road[i]![0] - road[i - 1]![0], dz = road[i]![1] - road[i - 1]![1];
    const length = Math.hypot(dx, dz);
    if (length < 20) continue;
    const nx = dx / length, nz = dz / length;
    xx += length * (nx * nx - nz * nz);
    xz += length * 2 * nx * nz;
  }
  let angle = Math.atan2(xz, xx) * 0.5;
  const preferred = roads[1]![2]![0] - roads[1]![1]![0];
  const preferredZ = roads[1]![2]![1] - roads[1]![1]![1];
  if (Math.cos(angle) * preferred + Math.sin(angle) * preferredZ < 0) angle += Math.PI;
  return angle;
}

function basisAt(origin: Point, angle: number): FreedomSquareBasis {
  return {
    x: origin[0], z: origin[1], ux: Math.cos(angle), uz: Math.sin(angle),
    vx: -Math.sin(angle), vz: Math.cos(angle), angleDeg: angle * 180 / Math.PI,
  };
}

function orientedBox(
  b: LandmarkMeshBuilder, basis: FreedomSquareBasis, a0: number, a1: number, c0: number, c1: number,
  y0: number, y1: number, color: readonly [number, number, number], bottom = true,
): void {
  const p = (a: number, c: number, y: number) => {
    const point = local(basis, a, c);
    return { x: point[0], y, z: point[1] };
  };
  const q = (a: number, c: number, y: number, nx: number, ny: number, nz: number) => ({ ...p(a, c, y), nx, ny, nz });
  b.addQuad([q(a0, c1, y1, 0, 1, 0), q(a1, c1, y1, 0, 1, 0), q(a1, c0, y1, 0, 1, 0), q(a0, c0, y1, 0, 1, 0)], color);
  if (bottom) b.addQuad([q(a0, c0, y0, 0, -1, 0), q(a1, c0, y0, 0, -1, 0), q(a1, c1, y0, 0, -1, 0), q(a0, c1, y0, 0, -1, 0)], color);
  b.addQuad([q(a0, c1, y0, basis.vx, 0, basis.vz), q(a1, c1, y0, basis.vx, 0, basis.vz), q(a1, c1, y1, basis.vx, 0, basis.vz), q(a0, c1, y1, basis.vx, 0, basis.vz)], color);
  b.addQuad([q(a1, c0, y0, -basis.vx, 0, -basis.vz), q(a0, c0, y0, -basis.vx, 0, -basis.vz), q(a0, c0, y1, -basis.vx, 0, -basis.vz), q(a1, c0, y1, -basis.vx, 0, -basis.vz)], color);
  b.addQuad([q(a1, c1, y0, basis.ux, 0, basis.uz), q(a1, c0, y0, basis.ux, 0, basis.uz), q(a1, c0, y1, basis.ux, 0, basis.uz), q(a1, c1, y1, basis.ux, 0, basis.uz)], color);
  b.addQuad([q(a0, c0, y0, -basis.ux, 0, -basis.uz), q(a0, c1, y0, -basis.ux, 0, -basis.uz), q(a0, c1, y1, -basis.ux, 0, -basis.uz), q(a0, c0, y1, -basis.ux, 0, -basis.uz)], color);
}

function orientedTopQuad(
  b: LandmarkMeshBuilder, basis: FreedomSquareBasis, a0: number, a1: number, c0: number, c1: number, y: number,
  color: readonly [number, number, number],
): void {
  const p = (a: number, c: number) => {
    const point = local(basis, a, c);
    return { x: point[0], y, z: point[1], nx: 0, ny: 1, nz: 0 };
  };
  b.addQuad([p(a0, c1), p(a1, c1), p(a1, c0), p(a0, c0)], color);
}

function sampleGroundMax(
  ctx: LandmarkBuildContext, basis: FreedomSquareBasis, a0: number, a1: number, c0: number, c1: number, fallback: number,
): number {
  let highest = fallback;
  for (const [a, c] of [[a0, c0], [a0, c1], [a1, c0], [a1, c1]] as const) {
    const [x, z] = local(basis, a, c);
    highest = Math.max(highest, yAt(ctx, x, z, fallback));
  }
  return highest;
}

function derivePlinthLayout(squareBasis: FreedomSquareBasis, polygon: readonly Point[]): FreedomPlinthLayout {
  const center = centroid(polygon);
  let longest = 0, ux = squareBasis.ux, uz = squareBasis.uz;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!, c = polygon[(i + 1) % polygon.length]!;
    const dx = c[0] - a[0], dz = c[1] - a[1], length = Math.hypot(dx, dz);
    if (length > longest) { longest = length; ux = dx / length; uz = dz / length; }
  }
  if (ux * squareBasis.ux + uz * squareBasis.uz < 0) { ux = -ux; uz = -uz; }
  const basis = basisAt(center, Math.atan2(uz, ux));
  let length = 0, width = 0;
  for (const point of polygon) {
    const [a, c] = toLocal(basis, point);
    length = Math.max(length, Math.abs(a));
    width = Math.max(width, Math.abs(c));
  }
  return { center, basis, length: length * 2, width: width * 2, angleDeg: basis.angleDeg };
}

/** Derives the oriented square envelope from the mapped perimeter roads and OSM footprints. */
export function resolveFreedomSquareLayout(bbox: Bbox): FreedomSquareLayout {
  const polygon = project(bbox, OSM_LANDMARK_DATA.forecourtPaving);
  const administration = project(bbox, OSM_LANDMARK_DATA.administrationOuter);
  const administrationInner = project(bbox, OSM_LANDMARK_DATA.administrationInner);
  const roads = OSM_LANDMARK_DATA.squareRoads.map((road) => project(bbox, road));
  const anchor = fromLatLon(bbox, 46.6403, 32.61585);
  const basis = basisAt([anchor.x, anchor.z], dominantRoadAngle(roads));
  let a0 = Infinity, a1 = -Infinity, c0 = Infinity, c1 = -Infinity;
  for (const point of polygon) {
    const [a, c] = toLocal(basis, point);
    a0 = Math.min(a0, a); a1 = Math.max(a1, a); c0 = Math.min(c0, c); c1 = Math.max(c1, c);
  }
  return {
    basis, polygon, administration, administrationInner,
    plinth: derivePlinthLayout(basis, project(bbox, OSM_LANDMARK_DATA.formerPlinth)),
    localBounds: { a0, a1, c0, c1 },
  };
}

function addOrientedPaving(
  b: LandmarkMeshBuilder, layout: FreedomSquareLayout, ctx: LandmarkBuildContext, fallback: number, quality: 'high' | 'low',
): number {
  const { basis, polygon, administration, administrationInner, localBounds } = layout;
  const tile = quality === 'high' ? 2 : 3;
  const joint = 0.06;
  let area = 0;
  for (let a0 = localBounds.a0; a0 < localBounds.a1 - 1e-6; a0 += tile) for (let c0 = localBounds.c0; c0 < localBounds.c1 - 1e-6; c0 += tile) {
    const a1 = Math.min(a0 + tile, localBounds.a1), c1 = Math.min(c0 + tile, localBounds.c1);
    const ac = (a0 + a1) * 0.5, cc = (c0 + c1) * 0.5;
    const [x, z] = local(basis, ac, cc);
    if (!pointInPolygon(polygon, x, z) || pointInPolygon(administration, x, z) || pointInPolygon(administrationInner, x, z)) continue;
    const ground = sampleGroundMax(ctx, basis, a0, a1, c0, c1, fallback);
    const bed = ground + 0.02;
    // The mortar quad fills the complete cell. The inset slab is a partial edge
    // tile where the rectangle ends, so the outer edge remains a straight line.
    orientedTopQuad(b, basis, a0, a1, c0, c1, bed, JOINT);
    const shade = (Math.floor(ac / tile) + Math.floor(cc / tile)) % 9;
    const colour = shade === 0 ? PAVE_DARK : shade < 3 ? PAVE_ALT : PAVE;
    orientedBox(b, basis, a0 + joint, a1 - joint, c0 + joint, c1 - joint, bed, bed + 0.06, colour, false);
    area += (a1 - a0) * (c1 - c0);
  }
  return area;
}

function pavingSurface(layout: FreedomSquareLayout, ctx: LandmarkBuildContext): LandmarkSurface {
  return { heightAt: (x, z) => {
    if (!pointInPolygon(layout.polygon, x, z) || pointInPolygon(layout.administration, x, z) || pointInPolygon(layout.administrationInner, x, z)) return null;
    return (ctx.groundAt(x, z) ?? 0) + 0.08;
  } };
}

function addFlag(b: LandmarkMeshBuilder, basis: FreedomSquareBasis, a: number, c: number, y: number): void {
  const [x, z] = local(basis, a, c);
  b.cylinder(x, y, z, 0.045, 9, METAL, 8);
  const [x1, z1] = local(basis, a + 1.85, c);
  const [x2, z2] = local(basis, a + 0.05, c);
  b.addQuad([
    { x: x2, y: y + 7.2, z: z2, nx: 0, ny: 0, nz: 1 }, { x: x1, y: y + 7.2, z: z1, nx: 0, ny: 0, nz: 1 },
    { x: x1, y: y + 7.7, z: z1, nx: 0, ny: 0, nz: 1 }, { x: x2, y: y + 7.7, z: z2, nx: 0, ny: 0, nz: 1 },
  ], FLAG_BLUE);
  b.addQuad([
    { x: x2, y: y + 7.7, z: z2, nx: 0, ny: 0, nz: 1 }, { x: x1, y: y + 7.7, z: z1, nx: 0, ny: 0, nz: 1 },
    { x: x1, y: y + 8.2, z: z1, nx: 0, ny: 0, nz: 1 }, { x: x2, y: y + 8.2, z: z2, nx: 0, ny: 0, nz: 1 },
  ], FLAG_YELLOW);
}

function addFlowerBed(b: LandmarkMeshBuilder, basis: FreedomSquareBasis, a: number, c: number, y: number): void {
  const [x, z] = local(basis, a, c);
  b.cylinder(x, y + 0.04, z, 1.3, 0.18, GRANITE, 12);
  b.cylinder(x, y + 0.22, z, 1.02, 0.16, FOLIAGE, 12);
  for (let i = 0; i < 6; i++) b.cylinder(x + Math.cos(i * 2.4) * 0.62, y + 0.35, z + Math.sin(i * 2.4) * 0.62, 0.11, 0.18, FLOWER, 6);
}

export function createFreedomSquare(bbox: Bbox): Landmark {
  const layout = resolveFreedomSquareLayout(bbox);
  const { basis, polygon, plinth, localBounds } = layout;
  const steps = project(bbox, OSM_LANDMARK_DATA.squareSteps);
  const fountain = centroid(project(bbox, OSM_LANDMARK_DATA.fountain));
  const propExclusions = [{ polygon, kinds: [PROP.LAMP, PROP.BENCH, PROP.BIN] }];
  const anchor = centroid(polygon);
  // Measured from the previous guessed-polygon/0.95 m grid (11649 cells).
  const legacyPavedArea = 10_513.2225;
  return {
    id: 'freedom-square',
    name: 'Площа Свободи',
    anchor: { lat: 46.6403, lon: 32.61585, x: anchor[0], z: anchor[1] },
    footprint: polygon,
    propExclusions,
    vegetationExclusions: [polygon],
    build: (ctx) => {
      const baseY = yAt(ctx, anchor[0], anchor[1], 0);
      const opaque = new LandmarkMeshBuilder();
      const lamp = new LandmarkMeshBuilder();
      const water = new LandmarkMeshBuilder();
      const surfaces: LandmarkSurface[] = [pavingSurface(layout, ctx)];
      const quality = ctx.quality === 'high' ? 'high' : 'low';
      const forecourtPavedArea = addOrientedPaving(opaque, layout, ctx, baseY, quality);
      let pavedArea = forecourtPavedArea;

      // Four continuous local-frame kerbs keep the road-to-road rectangle straight.
      const edgeY = sampleGroundMax(ctx, basis, localBounds.a0, localBounds.a1, localBounds.c0, localBounds.c1, baseY) + 0.02;
      orientedBox(opaque, basis, localBounds.a0, localBounds.a1, localBounds.c0 - 0.18, localBounds.c0 + 0.18, edgeY, edgeY + 0.12, GRANITE_DARK);
      orientedBox(opaque, basis, localBounds.a0, localBounds.a1, localBounds.c1 - 0.18, localBounds.c1 + 0.18, edgeY, edgeY + 0.12, GRANITE_DARK);
      orientedBox(opaque, basis, localBounds.a0 - 0.18, localBounds.a0 + 0.18, localBounds.c0, localBounds.c1, edgeY, edgeY + 0.12, GRANITE_DARK);
      orientedBox(opaque, basis, localBounds.a1 - 0.18, localBounds.a1 + 0.18, localBounds.c0, localBounds.c1, edgeY, edgeY + 0.12, GRANITE_DARK);

      // Restrained axial bands and a short entrance axis, all in square-local coordinates.
      const bandY = edgeY + 0.125;
      orientedBox(opaque, basis, localBounds.a0, localBounds.a1, -1.3, 1.3, bandY, bandY + 0.012, PAVE_ALT, false);
      orientedBox(opaque, basis, -1.3, 1.3, localBounds.c0, localBounds.c1, bandY, bandY + 0.012, PAVE_ALT, false);
      orientedBox(opaque, basis, -31, -24, localBounds.c0, 1.3, bandY, bandY + 0.012, FLOWER, false);

      // Empty former-Lenin pad: its own OSM rectangle supplies centre and angle.
      const padY = yAt(ctx, plinth.center[0], plinth.center[1], baseY) + 0.08;
      const pb = plinth.basis;
      orientedBox(opaque, pb, -plinth.length / 2, plinth.length / 2, -plinth.width / 2, plinth.width / 2, padY, padY + 0.22, GRANITE);
      orientedBox(opaque, pb, -plinth.length / 2 + 1.1, plinth.length / 2 - 1.1, -plinth.width / 2 + 1.0, plinth.width / 2 - 1.0, padY + 0.22, padY + 0.43, GRANITE_DARK);
      orientedBox(opaque, pb, -4.8, 4.8, -3.5, 3.5, padY + 0.43, padY + 0.78, GRANITE);
      orientedBox(opaque, pb, -3.2, 3.2, -2.1, 2.1, padY + 0.78, padY + 0.95, GRANITE_DARK);
      surfaces.push({ heightAt: (x, z) => {
        const [a, c] = toLocal(pb, [x, z]);
        return Math.abs(a) <= 3.2 && Math.abs(c) <= 2.1 ? padY + 0.95 : null;
      } });

      // Mapped steps are aligned to the same local u axis as the square.
      const stepLocal = steps.map((point) => toLocal(basis, point));
      const stepA0 = Math.min(...stepLocal.map((point) => point[0])), stepA1 = Math.max(...stepLocal.map((point) => point[0]));
      const stepC = stepLocal.reduce((sum, point) => sum + point[1], 0) / stepLocal.length;
      const stepCount = quality === 'high' ? 8 : 5;
      for (let i = 0; i < stepCount; i++) {
        const a0 = stepA0 + (stepA1 - stepA0) * i / stepCount, a1 = stepA0 + (stepA1 - stepA0) * (i + 1) / stepCount;
        const [x, z] = local(basis, (a0 + a1) * 0.5, stepC);
        const y = yAt(ctx, x, z, baseY) + 0.03;
        orientedBox(opaque, basis, a0, a1 + 0.06, stepC - 1.5, stepC + 1.5, y - 0.14, y, PAVE_DARK);
      }
      surfaces.push({ heightAt: (x, z) => {
        const [a, c] = toLocal(basis, [x, z]);
        return a >= stepA0 && a <= stepA1 && Math.abs(c - stepC) <= 1.5 ? yAt(ctx, x, z, baseY) + 0.03 : null;
      } });

      // Pushkin/Fontannyi fountain is outside the forecourt but stays in the same derived frame.
      const fy = yAt(ctx, fountain[0], fountain[1], baseY) + 0.08;
      opaque.cylinder(fountain[0], fy, fountain[1], 4.25, 0.28, GRANITE, 32);
      opaque.cylinder(fountain[0], fy + 0.28, fountain[1], 3.75, 0.14, GRANITE_DARK, 32);
      water.addDisc(fountain[0], fy + 0.43, fountain[1], 3.45, WATER, 32);
      const jets = quality === 'high' ? 16 : 8;
      for (let i = 0; i < jets; i++) {
        const a = i * Math.PI * 2 / jets;
        water.cylinder(fountain[0] + Math.cos(a) * 2.35, fy + 0.43, fountain[1] + Math.sin(a) * 2.35, 0.045, 0.65, WATER, 8);
      }
      surfaces.push({ heightAt: (x, z) => Math.hypot(x - fountain[0], z - fountain[1]) < 3.5 ? fy + 0.43 : null });
      pavedArea += Math.PI * 4.25 * 4.25;

      const lampModel = buildProp(PROP.LAMP, 1), benchModel = buildProp(PROP.BENCH, 1), binModel = buildProp(PROP.BIN, 0);
      const lampLocal: Point[] = [[-78, localBounds.c0 + 4], [-43, localBounds.c0 + 4], [-8, localBounds.c0 + 4], [-76, localBounds.c1 - 4], [-40, localBounds.c1 - 4], [-5, localBounds.c1 - 4]];
      const yaw = basis.angleDeg * Math.PI / 180;
      for (const [a, c] of lampLocal) {
        const [x, z] = local(basis, a, c);
        lamp.addProp(lampModel, x, yAt(ctx, x, z, baseY), z, yaw);
      }
      const benchLocal: Point[] = [[-60, localBounds.c0 + 5], [-27, localBounds.c0 + 5], [-58, localBounds.c1 - 5], [-25, localBounds.c1 - 5]];
      for (const [a, c] of benchLocal) {
        const [x, z] = local(basis, a, c);
        opaque.addProp(benchModel, x, yAt(ctx, x, z, baseY), z, yaw);
      }
      for (const [a, c] of [[-45, localBounds.c0 + 5], [-12, localBounds.c0 + 5], [-43, localBounds.c1 - 5], [-10, localBounds.c1 - 5]] as Point[]) {
        const [x, z] = local(basis, a, c);
        opaque.addProp(binModel, x, yAt(ctx, x, z, baseY), z, yaw);
      }
      for (const [a, c] of [[-83, localBounds.c0 + 2], [-45, localBounds.c1 - 2], [-12, localBounds.c0 + 2], [-12, localBounds.c1 - 2]] as Point[]) addFlowerBed(opaque, basis, a, c, yAt(ctx, ...local(basis, a, c), baseY));
      addFlag(opaque, basis, -2, -1, yAt(ctx, ...local(basis, -2, -1), baseY));
      addFlag(opaque, basis, -2, 7, yAt(ctx, ...local(basis, -2, 7), baseY));

      return buildResult([opaque.finish('opaque'), lamp.finish('lamp'), water.finish('water')], surfaces, propExclusions, {
        pavedAreaM2: pavedArea,
        pavedAreaBeforeM2: legacyPavedArea,
        pavedAreaAfterM2: forecourtPavedArea,
        forecourtAreaM2: polygonArea(polygon),
        forecourtPavedAreaM2: forecourtPavedArea,
        orientationDeg: basis.angleDeg,
        lamps: lampLocal.length,
        benches: benchLocal.length,
      });
    },
  };
}

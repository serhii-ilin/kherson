import { buildProp, PROP } from '../fine/prop-models.ts';
import { fromLatLon } from './geo.ts';
import { OSM_LANDMARK_DATA, type LatLon } from './data.ts';
import {
  buildResult, LandmarkMeshBuilder, pointInPolygon, rgb,
  type Landmark, type LandmarkBuildContext, type LandmarkSurface,
} from './types.ts';
import type { Bbox } from '../world/manifest.ts';

const PAVE = rgb(0x989993);
const PAVE_ALT = rgb(0xa9a79f);
const PAVE_DARK = rgb(0x747873);
const JOINT = rgb(0x5f625e);
const GRANITE = rgb(0x8d918c);
const GRANITE_DARK = rgb(0x5f6562);
const METAL = rgb(0x303735);
const FLOWER = rgb(0xc75b48);
const FOLIAGE = rgb(0x3c713e);
const WATER = rgb(0x6e9aa0);
const FLAG_BLUE = rgb(0x1c6db2);
const FLAG_YELLOW = rgb(0xf0c72e);

type Point = [number, number];

function project(bbox: Bbox, points: readonly LatLon[]): Point[] {
  return points.map(([lat, lon]) => {
    const p = fromLatLon(bbox, lat, lon);
    return [p.x, p.z];
  });
}

function yAt(ctx: LandmarkBuildContext, x: number, z: number, fallback: number): number {
  const y = ctx.groundAt(x, z);
  return y !== null && Number.isFinite(y) ? y : fallback;
}

function centroid(poly: readonly Point[]): Point {
  let x = 0, z = 0;
  for (const p of poly) { x += p[0]; z += p[1]; }
  return [x / poly.length, z / poly.length];
}

function segmentDistance(x: number, z: number, a: Point, b: Point): number {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const d2 = dx * dx + dz * dz;
  const t = d2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / d2));
  const px = a[0] + dx * t, pz = a[1] + dz * t;
  return Math.hypot(x - px, z - pz);
}

function nearRoad(x: number, z: number, roads: readonly Point[][]): boolean {
  for (const road of roads) for (let i = 1; i < road.length; i++) {
    if (segmentDistance(x, z, road[i - 1]!, road[i]!) < 3.8) return true;
  }
  return false;
}

function addSegmentBox(b: LandmarkMeshBuilder, a: Point, c: Point, width: number, y: number, height: number, color: readonly [number, number, number]): void {
  const dx = c[0] - a[0], dz = c[1] - a[1], len = Math.hypot(dx, dz) || 1;
  const px = -dz / len * width * 0.5, pz = dx / len * width * 0.5;
  b.box(Math.min(a[0] + px, c[0] - px), y, Math.min(a[1] + pz, c[1] - pz), Math.max(a[0] + px, c[0] - px), y + height, Math.max(a[1] + pz, c[1] - pz), color);
}

function addPaving(
  b: LandmarkMeshBuilder, polygon: readonly Point[], admin: readonly Point[], roads: readonly Point[][],
  ctx: LandmarkBuildContext, fallback: number, quality: 'high' | 'low',
): number {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of polygon) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
  const tile = quality === 'high' ? 0.95 : 1.7;
  const half = tile * 0.44;
  let area = 0;
  for (let z = minZ + tile * 0.5; z < maxZ; z += tile) for (let x = minX + tile * 0.5; x < maxX; x += tile) {
    if (!pointInPolygon(polygon, x, z) || pointInPolygon(admin, x, z) || nearRoad(x, z, roads)) continue;
    const y = yAt(ctx, x, z, fallback);
    const shade = (Math.floor(x * 1.7) + Math.floor(z * 1.3)) % 7;
    // mortar bed under the joints, so the ground (often grass in the post-war OSM) never shows through
    b.topQuad(x - tile / 2, z - tile / 2, x + tile / 2, z + tile / 2, y + 0.015, JOINT);
    b.box(x - half, y + 0.015, z - half, x + half, y + 0.065, z + half, shade === 0 ? PAVE_DARK : shade < 3 ? PAVE_ALT : PAVE, false);
    area += tile * tile;
  }
  return area;
}

function pavingSurface(polygon: readonly Point[], admin: readonly Point[], roads: readonly Point[][], ctx: LandmarkBuildContext, lift: number): LandmarkSurface {
  return { heightAt: (x, z) => pointInPolygon(polygon, x, z) && !pointInPolygon(admin, x, z) && !nearRoad(x, z, roads) ? (ctx.groundAt(x, z) ?? 0) + lift : null };
}

function addFlag(b: LandmarkMeshBuilder, x: number, z: number, y: number): void {
  b.cylinder(x, y, z, 0.045, 9, METAL, 8);
  b.box(x + 0.05, y + 7.2, z - 0.02, x + 1.85, y + 7.7, z + 0.02, FLAG_BLUE);
  b.box(x + 0.05, y + 7.7, z - 0.02, x + 1.85, y + 8.2, z + 0.02, FLAG_YELLOW);
}

export function createFreedomSquare(bbox: Bbox): Landmark {
  const forecourt = project(bbox, OSM_LANDMARK_DATA.forecourtPaving);
  const admin = project(bbox, OSM_LANDMARK_DATA.administrationOuter);
  const roads = OSM_LANDMARK_DATA.squareRoads.map((road) => project(bbox, road));
  const plinthPoly = project(bbox, OSM_LANDMARK_DATA.formerPlinth);
  const fountainPoly = project(bbox, OSM_LANDMARK_DATA.fountain);
  const steps = project(bbox, OSM_LANDMARK_DATA.squareSteps);
  const anchor = centroid(forecourt);
  const plinth = centroid(plinthPoly);
  const fountain = centroid(fountainPoly);
  const propExclusions = [{ polygon: forecourt, kinds: [PROP.LAMP, PROP.BENCH, PROP.BIN] }];
  return {
    id: 'freedom-square',
    name: 'Площа Свободи',
    anchor: { lat: 46.6403, lon: 32.61585, x: anchor[0], z: anchor[1] },
    footprint: forecourt,
    propExclusions,
    vegetationExclusions: [forecourt],
    build: (ctx) => {
      const baseY = yAt(ctx, anchor[0], anchor[1], 0);
      const opaque = new LandmarkMeshBuilder();
      const lamp = new LandmarkMeshBuilder();
      const water = new LandmarkMeshBuilder();
      const surfaces: LandmarkSurface[] = [pavingSurface(forecourt, admin, roads, ctx, 0.08)];
      const quality = ctx.quality === 'high' ? 'high' : 'low';
      let pavedArea = addPaving(opaque, forecourt, admin, roads, ctx, baseY, quality);

      for (let i = 0; i < forecourt.length; i++) addSegmentBox(opaque, forecourt[i]!, forecourt[(i + 1) % forecourt.length]!, 0.28, yAt(ctx, forecourt[i]![0], forecourt[i]![1], baseY) + 0.04, 0.12, GRANITE_DARK);

      // Empty former Lenin pad: stepped granite and neutral blank panels, never a statue.
      const plinthY = yAt(ctx, plinth[0], plinth[1], baseY) + 0.08;
      opaque.box(plinth[0] - 7.4, plinthY, plinth[1] - 5.8, plinth[0] + 7.4, plinthY + 0.22, plinth[1] + 5.8, GRANITE);
      opaque.box(plinth[0] - 6.3, plinthY + 0.22, plinth[1] - 4.8, plinth[0] + 6.3, plinthY + 0.43, plinth[1] + 4.8, GRANITE_DARK);
      opaque.box(plinth[0] - 4.8, plinthY + 0.43, plinth[1] - 3.5, plinth[0] + 4.8, plinthY + 0.78, plinth[1] + 3.5, GRANITE);
      opaque.box(plinth[0] - 3.2, plinthY + 0.78, plinth[1] - 2.1, plinth[0] + 3.2, plinthY + 0.95, plinth[1] + 2.1, GRANITE_DARK);
      for (const dx of [-5.2, 5.2]) opaque.box(plinth[0] + dx - 0.7, plinthY + 0.5, plinth[1] + 3.9, plinth[0] + dx + 0.7, plinthY + 1.2, plinth[1] + 4.02, GRANITE);
      surfaces.push({ heightAt: (x, z) => Math.abs(x - plinth[0]) < 3.3 && Math.abs(z - plinth[1]) < 2.2 ? plinthY + 0.95 : null });

      // Only the mapped steps way is reconstructed; there is no invented square stair flight.
      const stepDX = steps[steps.length - 1]![0] - steps[0]![0], stepDZ = steps[steps.length - 1]![1] - steps[0]![1];
      const stepLen = Math.hypot(stepDX, stepDZ) || 1, ux = stepDX / stepLen, uz = stepDZ / stepLen, vx = -uz, vz = ux;
      const stepCount = quality === 'high' ? 8 : 5;
      for (let i = 0; i < stepCount; i++) {
        const a0 = stepLen * i / stepCount, a1 = stepLen * (i + 1) / stepCount;
        const cx = steps[0]![0] + ux * (a0 + a1) * 0.5, cz = steps[0]![1] + uz * (a0 + a1) * 0.5;
        const y = yAt(ctx, cx, cz, baseY) + 0.03;
        opaque.box(Math.min(cx + vx * -1.5 - ux * (a1 - a0) * 0.5, cx + vx * 1.5 + ux * (a1 - a0) * 0.5), y - 0.14, Math.min(cz + vz * -1.5 - uz * (a1 - a0) * 0.5, cz + vz * 1.5 + uz * (a1 - a0) * 0.5), Math.max(cx + vx * -1.5 - ux * (a1 - a0) * 0.5, cx + vx * 1.5 + ux * (a1 - a0) * 0.5), y, Math.max(cz + vz * -1.5 - uz * (a1 - a0) * 0.5, cz + vz * 1.5 + uz * (a1 - a0) * 0.5), PAVE_DARK);
      }
      surfaces.push({ heightAt: (x, z) => {
        const a = (x - steps[0]![0]) * ux + (z - steps[0]![1]) * uz, c = (x - steps[0]![0]) * vx + (z - steps[0]![1]) * vz;
        return a >= 0 && a <= stepLen && Math.abs(c) <= 1.5 ? yAt(ctx, x, z, baseY) + 0.03 : null;
      } });

      // Pushkin-square fountain follows the mapped fountain way and has a coping ring plus low jets.
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
      const lampPoints: Point[] = [[anchor[0] - 24, anchor[1] - 17], [anchor[0] + 24, anchor[1] - 17], [anchor[0] - 27, anchor[1] + 13], [anchor[0] + 27, anchor[1] + 13], [fountain[0] - 12, fountain[1] - 10], [fountain[0] + 12, fountain[1] + 10]];
      for (const [x, z] of lampPoints) lamp.addProp(lampModel, x, yAt(ctx, x, z, baseY), z, 0);
      const benchPoints: Point[] = [[anchor[0] - 18, anchor[1] - 12], [anchor[0] + 18, anchor[1] - 12], [fountain[0] - 12, fountain[1] + 10], [fountain[0] + 12, fountain[1] - 10]];
      for (const [x, z] of benchPoints) opaque.addProp(benchModel, x, yAt(ctx, x, z, baseY), z, 0);
      for (const [x, z] of [[anchor[0] - 21, anchor[1] - 10], [anchor[0] + 21, anchor[1] - 10], [fountain[0] - 10, fountain[1] + 9], [fountain[0] + 10, fountain[1] - 9]] as Point[]) opaque.addProp(binModel, x, yAt(ctx, x, z, baseY), z, 0);

      for (const [x, z] of [[anchor[0] - 34, anchor[1] + 15], [anchor[0] + 34, anchor[1] + 15], [fountain[0] - 13, fountain[1] - 13], [fountain[0] + 13, fountain[1] + 13]] as Point[]) {
        const y = yAt(ctx, x, z, baseY);
        opaque.cylinder(x, y + 0.04, z, 1.35, 0.18, GRANITE, 12);
        opaque.cylinder(x, y + 0.22, z, 1.05, 0.16, FOLIAGE, 12);
        for (let i = 0; i < 7; i++) opaque.cylinder(x + Math.cos(i * 2.4) * 0.65, y + 0.35, z + Math.sin(i * 2.4) * 0.65, 0.11, 0.18, FLOWER, 6);
      }
      addFlag(opaque, anchor[0] + 27, anchor[1] - 18, yAt(ctx, anchor[0] + 27, anchor[1] - 18, baseY));
      addFlag(opaque, anchor[0] + 32, anchor[1] - 18, yAt(ctx, anchor[0] + 32, anchor[1] - 18, baseY));

      return buildResult([opaque.finish('opaque'), lamp.finish('lamp'), water.finish('water')], surfaces, propExclusions, {
        pavedAreaM2: pavedArea, lamps: lampPoints.length, benches: benchPoints.length,
      });
    },
  };
}

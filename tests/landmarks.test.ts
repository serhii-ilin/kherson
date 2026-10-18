import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DEFAULT_BBOX, fromLatLon, toLatLon } from '../src/landmarks/geo';
import { createFreedomSquare, resolveFreedomSquareLayout } from '../src/landmarks/freedom-square';
import { OSM_LANDMARK_DATA } from '../src/landmarks/data';
import { pointInPolygon, polygonArea } from '../src/landmarks/types';
import { createPier, resolveEmbankmentLayout } from '../src/landmarks/pier';
import { createLandmarks } from '../src/landmarks';
import { LandmarkLayer } from '../src/landmarks/layer';
import { LandmarkPhysics } from '../src/landmarks/physics';
import { placeProps } from '../src/fine/props';
import { PROP } from '../src/fine/prop-models';
import { ROAD, ROAD_LIT, ROAD_SIDEWALK, type VectorTile } from '../src/world/vector-format';

const freedomContext = { groundAt: (x: number, z: number) => 4 + x * 0.0002 + z * 0.0001, quality: 'high' as const };

/** Fake river: water on the outer side of the mapped quay line, flat ground at 3 m elsewhere. */
function pierWorld() {
  const layout = resolveEmbankmentLayout(DEFAULT_BBOX);
  const isWater = (x: number, z: number) => {
    let best = Infinity, side = 1;
    for (const seg of layout.shore) {
      const dx = x - seg.frame.x, dz = z - seg.frame.z;
      const a = dx * seg.frame.ux + dz * seg.frame.uz, c = dx * seg.frame.vx + dz * seg.frame.vz;
      const d = Math.hypot(a - Math.max(0, Math.min(seg.length, a)), c);
      if (d < best) { best = d; side = c; }
    }
    return best < 80 && side < 0;
  };
  return { layout, heightAt: () => 3, groundAt: () => 3, isWater, quality: 'high' as const };
}

describe('landmark geometry', () => {
  it('round-trips the world projection within a centimetre', () => {
    for (const [lat, lon] of [[46.6403, 32.61585], [46.6282, 32.6219], [46.59, 32.49]]) {
      const p = fromLatLon(DEFAULT_BBOX, lat, lon);
      const [lat2, lon2] = toLatLon(DEFAULT_BBOX, p.x, p.z);
      const q = fromLatLon(DEFAULT_BBOX, lat2, lon2);
      expect(Math.hypot(q.x - p.x, q.z - p.z)).toBeLessThan(0.01);
    }
  });

  it('winds every triangle counter-clockwise around its stored normal (no culled or black faces)', () => {
    const world = pierWorld();
    const context = { groundAt: freedomContext.groundAt, isWater: world.isWater, quality: 'high' as const };
    for (const landmark of createLandmarks(DEFAULT_BBOX)) {
      for (const m of landmark.build(context).meshes) {
        const p = m.positions, n = m.normals, ix = m.indices;
        let against = 0;
        for (let t = 0; t < ix.length; t += 3) {
          const a = ix[t]! * 3, b = ix[t + 1]! * 3, c = ix[t + 2]! * 3;
          const ux = p[b]! - p[a]!, uy = p[b + 1]! - p[a + 1]!, uz = p[b + 2]! - p[a + 2]!;
          const vx = p[c]! - p[a]!, vy = p[c + 1]! - p[a + 1]!, vz = p[c + 2]! - p[a + 2]!;
          const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
          if (fx * n[a]! + fy * n[a + 1]! + fz * n[a + 2]! < -1e-9) against++;
        }
        expect(against, `${landmark.id} ${m.kind}`).toBe(0);
      }
    }
  });

  it('keeps both procedural landmarks finite, local, and within budgets', () => {
    const world = pierWorld();
    const context = { groundAt: freedomContext.groundAt, isWater: world.isWater, quality: 'high' as const };
    for (const landmark of createLandmarks(DEFAULT_BBOX)) {
      const built = landmark.build(context);
      expect(built.triangleCount).toBeLessThanOrEqual(150_000);
      expect(built.materialCount).toBeLessThanOrEqual(4);
      if (landmark.id !== 'port-cranes') expect(built.triangleCount).toBeGreaterThan(10_000);
      let count = 0;
      for (const mesh of built.meshes) {
        count += mesh.positions.length;
        for (const value of mesh.positions) expect(Number.isFinite(value)).toBe(true);
        expect(mesh.indices.length % 3).toBe(0);
      }
      expect(count).toBeGreaterThan(0);
      for (const mesh of built.meshes) for (let i = 0; i < mesh.positions.length; i += 3) {
        expect(Math.hypot(mesh.positions[i]! - landmark.anchor.x, mesh.positions[i + 2]! - landmark.anchor.z)).toBeLessThan(250);
      }
    }
  });

  it('samples Freedom Square paving over terrain and leaves the former Lenin pad statue-free', () => {
    const landmark = createFreedomSquare(DEFAULT_BBOX);
    const built = landmark.build(freedomContext);
    const pad = fromLatLon(DEFAULT_BBOX, 46.640292, 32.614935);
    let highest = -Infinity;
    for (const mesh of built.meshes) for (let i = 0; i < mesh.positions.length; i += 3) {
      const x = mesh.positions[i]!, z = mesh.positions[i + 2]!;
      if (Math.hypot(x - pad.x, z - pad.z) <= 3) highest = Math.max(highest, mesh.positions[i + 1]!);
    }
    expect(highest).toBeLessThanOrEqual(freedomContext.groundAt(pad.x, pad.z) + 2.1); // plinth + 1 m, no statue
    const paver = built.meshes[0]!;
    const ys = new Set<number>();
    for (let i = 1; i < paver.positions.length; i += 12) ys.add(Math.round(paver.positions[i]! * 100));
    expect(ys.size).toBeGreaterThan(1);
  });

  it('derives a square-local frame parallel to the dominant perimeter-road direction', () => {
    const layout = resolveFreedomSquareLayout(DEFAULT_BBOX);
    const road = OSM_LANDMARK_DATA.squareRoads[1]!;
    const roadA = fromLatLon(DEFAULT_BBOX, ...road[2]!);
    const roadB = fromLatLon(DEFAULT_BBOX, ...road[7]!);
    const roadAngle = Math.atan2(roadB.z - roadA.z, roadB.x - roadA.x) * 180 / Math.PI;
    const angleDistance = (a: number, b: number) => Math.abs(((a - b + 90) % 180 + 180) % 180 - 90);
    expect(angleDistance(layout.basis.angleDeg, roadAngle)).toBeLessThanOrEqual(2);
    for (let i = 0; i < layout.polygon.length; i++) {
      const a = layout.polygon[i]!, b = layout.polygon[(i + 1) % layout.polygon.length]!;
      const edgeAngle = Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI;
      expect(Math.min(angleDistance(edgeAngle, layout.basis.angleDeg), angleDistance(edgeAngle, layout.basis.angleDeg + 90))).toBeLessThanOrEqual(2);
    }
  });

  it('keeps paver centres inside straight boundaries and covers the whole derived forecourt', () => {
    const layout = resolveFreedomSquareLayout(DEFAULT_BBOX);
    const built = createFreedomSquare(DEFAULT_BBOX).build(freedomContext);
    const mesh = built.meshes[0]!;
    const paverArea = built.report!.forecourtPavedAreaM2!;
    expect(paverArea / polygonArea(layout.polygon)).toBeGreaterThanOrEqual(0.95);
    const tileVertexCount = 24;
    for (let i = 0; i < Math.round(paverArea / 4) * tileVertexCount; i += tileVertexCount) {
      const centre = [
        (mesh.positions[i * 3]! + mesh.positions[(i + 1) * 3]! + mesh.positions[(i + 2) * 3]! + mesh.positions[(i + 3) * 3]!) / 4,
        (mesh.positions[i * 3 + 2]! + mesh.positions[(i + 1) * 3 + 2]! + mesh.positions[(i + 2) * 3 + 2]! + mesh.positions[(i + 3) * 3 + 2]!) / 4,
      ] as [number, number];
      expect(pointInPolygon(layout.polygon, centre[0], centre[1])).toBe(true);
    }
  });

  it('centres and rotates the empty plinth pad from its OSM polygon', () => {
    const layout = resolveFreedomSquareLayout(DEFAULT_BBOX);
    const source = OSM_LANDMARK_DATA.formerPlinth.map(([lat, lon]) => fromLatLon(DEFAULT_BBOX, lat, lon));
    const centre = source.reduce((out, p) => [out[0] + p.x / source.length, out[1] + p.z / source.length], [0, 0]);
    expect(Math.hypot(layout.plinth.center[0] - centre[0], layout.plinth.center[1] - centre[1])).toBeLessThanOrEqual(1);
    let longest = 0, sourceAngle = 0;
    for (let i = 0; i < source.length; i++) {
      const a = source[i]!, b = source[(i + 1) % source.length]!;
      const length = Math.hypot(b.x - a.x, b.z - a.z);
      if (length > longest) { longest = length; sourceAngle = Math.atan2(b.z - a.z, b.x - a.x) * 180 / Math.PI; }
    }
    const difference = Math.abs(((layout.plinth.angleDeg - sourceAngle + 90) % 180 + 180) % 180 - 90);
    expect(difference).toBeLessThanOrEqual(2);
  });
});

describe('landmark exclusions and physics', () => {
  it('suppresses only replaced generic props inside an exclusion polygon', () => {
    const tile: VectorTile = { rx: 0, rz: 0, strings: [], buildings: [], areas: [], lines: [], points: [], roads: [
      { pts: Int32Array.from([0, 5000, 10000, 5000]), kind: ROAD.RESIDENTIAL, flags: ROAD_SIDEWALK | ROAD_LIT, widthCm: 650, lanes: 2, layer: 0, name: -1 },
    ] };
    const polygon = { polygon: [[0, 0], [100, 0], [100, 100], [0, 100]] as [number, number][], kinds: [PROP.LAMP, PROP.BENCH, PROP.BIN] };
    const placements = placeProps([tile], { x0: 0, z0: 0, x1: 100, z1: 100 }, { groundAt: () => 4 }, [polygon]);
    expect(placements.filter((p) => polygon.kinds.some((kind) => kind === p.kind))).toEqual([]);
  });

  it('lays the embankment on the mapped promenade with the railing on the quay line', () => {
    const world = pierWorld();
    const built = createPier(DEFAULT_BBOX).build(world);
    const total = world.layout.shore.reduce((s, seg) => s + seg.length, 0);
    expect(total).toBeGreaterThan(300);
    const holes = world.layout.holes.reduce((s, h) => s + polygonArea(h), 0);
    expect(built.report!.pavedAreaM2 / (polygonArea(world.layout.polygon) - holes)).toBeGreaterThan(0.93);
    expect(built.report!.lamps).toBeGreaterThanOrEqual(30);
    expect(built.report!.benches).toBeGreaterThanOrEqual(12);
  });

  it('makes the promenade walkable and the railing solid, without changing outside physics', () => {
    const world = pierWorld();
    const layer = new LandmarkLayer(new THREE.Scene(), [createPier(DEFAULT_BBOX)], world, 'high');
    const anchor = createPier(DEFAULT_BBOX).anchor;
    layer.update(anchor.x, anchor.z);
    const physics = new LandmarkPhysics(world, layer);
    const seg = world.layout.shore.reduce((a, b) => (b.length > a.length ? b : a));
    const p = (a: number, c: number) => [seg.frame.x + seg.frame.ux * a + seg.frame.vx * c, seg.frame.z + seg.frame.uz * a + seg.frame.vz * c] as const;
    const walk = p(seg.length / 2 + 1, 5);
    expect(physics.heightAt(walk[0], walk[1])).toBeCloseTo(3.1, 6);
    expect(physics.isWater(walk[0], walk[1])).toBe(false);
    const rail = p(seg.length / 2 + 1, 0.1);
    expect(physics.blockedAt(rail[0], rail[1], 3.1)).toBe(true);
    expect(physics.blockedAt(walk[0], walk[1], 3.1)).toBe(false);
    expect(physics.heightAt(0, 0)).toBe(3);
    const river = p(seg.length / 2, -60);
    expect(physics.isWater(river[0], river[1])).toBe(true);
  });
});

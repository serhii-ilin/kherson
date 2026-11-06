import { describe, expect, it } from 'vitest';
import { DEFAULT_BBOX, fromLatLon } from '../src/landmarks/geo.ts';
import { OSM_LANDMARK_DATA } from '../src/landmarks/data.ts';
import { createAdministration, resolveAdministrationLayout } from '../src/landmarks/heroes/administration.ts';
import { pointInPolygon, type LandmarkBuild, type LandmarkMeshData } from '../src/landmarks/types.ts';
import { PBR_LAYER, PBR_LAYER_COUNT } from '../src/world/pbr-layers.ts';

const GROUND = 4;
const context = { groundAt: () => GROUND, quality: 'high' as const };

function build(lod?: 'near' | 'far'): LandmarkBuild {
  return createAdministration(DEFAULT_BBOX).build({ ...context, lod });
}

function projectRing(): [number, number][] {
  return OSM_LANDMARK_DATA.administrationOuter.map(([lat, lon]) => {
    const p = fromLatLon(DEFAULT_BBOX, lat, lon);
    return [p.x, p.z];
  });
}

function validateTexturedMesh(mesh: LandmarkMeshData): void {
  const p = mesh.positions, n = mesh.normals, c = mesh.colors, uv = mesh.uvs!, pbr = mesh.pbr!, ix = mesh.indices;
  const vertexCount = p.length / 3;
  expect(mesh.kind).toBe('textured');
  expect(uv.length).toBe(vertexCount * 2);
  expect(pbr.length).toBe(vertexCount);
  expect(n.length).toBe(p.length);
  expect(c.length).toBe(p.length);
  expect(ix.length % 3).toBe(0);
  for (let i = 0; i < vertexCount; i++) {
    expect(Math.hypot(n[i * 3]!, n[i * 3 + 1]!, n[i * 3 + 2]!), `normal ${i}`).toBeCloseTo(1, 5);
    expect(Number.isFinite(p[i * 3]!) && Number.isFinite(p[i * 3 + 1]!) && Number.isFinite(p[i * 3 + 2]!)).toBe(true);
    expect(Number.isFinite(uv[i * 2]!) && Number.isFinite(uv[i * 2 + 1]!)).toBe(true);
    for (let k = 0; k < 3; k++) {
      expect(c[i * 3 + k]!).toBeGreaterThanOrEqual(0);
      expect(c[i * 3 + k]!).toBeLessThanOrEqual(1);
    }
    const layer = pbr[i]!;
    expect(Number.isInteger(layer)).toBe(true);
    expect(layer === -1 || (layer >= 0 && layer < PBR_LAYER_COUNT)).toBe(true);
  }
  for (const index of ix) expect(index).toBeLessThan(vertexCount);
  for (let t = 0; t < ix.length; t += 3) {
    const a = ix[t]! * 3, b = ix[t + 1]! * 3, d = ix[t + 2]! * 3;
    const ux = p[b]! - p[a]!, uy = p[b + 1]! - p[a + 1]!, uz = p[b + 2]! - p[a + 2]!;
    const vx = p[d]! - p[a]!, vy = p[d + 1]! - p[a + 1]!, vz = p[d + 2]! - p[a + 2]!;
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    expect(fx * n[a]! + fy * n[a + 1]! + fz * n[a + 2]!, `triangle ${t / 3} faces its normal`).toBeGreaterThanOrEqual(-1e-6);
  }
}

function positionsHash(built: LandmarkBuild): number {
  let hash = 2166136261;
  for (const mesh of built.meshes) for (const value of mesh.positions) {
    const bits = Math.fround(value);
    hash ^= bits | 0;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

describe('administration hero massing', () => {
  it('stays inside the hero triangle budgets at near and far detail', () => {
    const near = build('near');
    const far = build('far');
    expect(near.triangleCount).toBeLessThanOrEqual(40_000);
    expect(near.triangleCount).toBeGreaterThan(10_000);
    expect(far.triangleCount).toBeLessThanOrEqual(4_000);
    expect(far.triangleCount).toBeLessThan(near.triangleCount);
    expect(near.materialCount).toBe(1);
    expect(far.materialCount).toBe(1);
  });

  it('covers the OSM footprint and reaches the intended 19–23 m top without the flagpole', () => {
    const built = build('near');
    const ring = projectRing();
    const xs = ring.map((p) => p[0]), zs = ring.map((p) => p[1]);
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, top = -Infinity;
    for (const mesh of built.meshes) for (let i = 0; i < mesh.positions.length; i += 3) {
      const x = mesh.positions[i]!, y = mesh.positions[i + 1]!, z = mesh.positions[i + 2]!;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
      // The pole rises to about GROUND + 29 m; the building itself stays below 23 m.
      if (y <= GROUND + 23) top = Math.max(top, y);
    }
    expect(minX).toBeLessThanOrEqual(Math.min(...xs) + 1);
    expect(maxX).toBeGreaterThanOrEqual(Math.max(...xs) - 1);
    expect(minZ).toBeLessThanOrEqual(Math.min(...zs) + 1);
    expect(maxZ).toBeGreaterThanOrEqual(Math.max(...zs) - 1);
    expect(top - GROUND).toBeGreaterThanOrEqual(19);
    expect(top - GROUND).toBeLessThanOrEqual(23);
  });

  it('exposes exactly ten giant pilasters and three entrance doors', () => {
    const layout = resolveAdministrationLayout(DEFAULT_BBOX);
    const near = build('near');
    expect(layout.pilasterCount).toBe(10);
    expect(near.stats?.pilasters).toBe(10);
    expect(near.stats?.doors).toBe(3);
    expect(layout.centralRun.kind).toBe('central');
    expect(layout.centralRun.length).toBeGreaterThan(40);
  });

  it('derives the main facade from outward normals that face the former plinth', () => {
    const layout = resolveAdministrationLayout(DEFAULT_BBOX);
    const plinth = fromLatLon(DEFAULT_BBOX, 46.640292, 32.614935);
    expect(layout.mainFacadeEdges.length).toBeGreaterThanOrEqual(3);
    for (const edge of layout.mainFacadeEdges) {
      const mx = (edge.ax + edge.bx) / 2, mz = (edge.az + edge.bz) / 2;
      const dx = plinth.x - mx, dz = plinth.z - mz;
      const length = Math.hypot(dx, dz);
      expect((edge.nx * dx + edge.nz * dz) / length).toBeGreaterThan(0.65);
    }
    expect(layout.wingRuns.length).toBe(2);
    for (const wing of layout.wingRuns) expect(wing.length).toBeGreaterThan(10);
  });

  it('leaves the courtyard open in the roof and collision surfaces', () => {
    const layout = resolveAdministrationLayout(DEFAULT_BBOX);
    const built = build('near');
    const deckY = GROUND + 18.1;
    for (const mesh of built.meshes) {
      const p = mesh.positions, n = mesh.normals, ix = mesh.indices, pbr = mesh.pbr!;
      for (let t = 0; t < ix.length; t += 3) {
        const a = ix[t]! * 3, b = ix[t + 1]! * 3, c = ix[t + 2]! * 3;
        const i0 = ix[t]!, i1 = ix[t + 1]!, i2 = ix[t + 2]!;
        if (pbr[i0] !== PBR_LAYER.ROOF_BITUMEN || pbr[i1] !== PBR_LAYER.ROOF_BITUMEN || pbr[i2] !== PBR_LAYER.ROOF_BITUMEN) continue;
        const y = (p[a + 1]! + p[b + 1]! + p[c + 1]!) / 3;
        if (Math.abs(y - deckY) > 0.03) continue;
        if ((n[a + 1]! + n[b + 1]! + n[c + 1]!) / 3 < 0.9) continue;
        const x = (p[a]! + p[b]! + p[c]!) / 3;
        const z = (p[a + 2]! + p[b + 2]! + p[c + 2]!) / 3;
        expect(pointInPolygon(layout.inner, x, z)).toBe(false);
      }
    }
    const surface = built.surfaces[0]!;
    const court = layout.inner.reduce((out, p) => [out[0] + p[0] / layout.inner.length, out[1] + p[1] / layout.inner.length], [0, 0]);
    expect(surface.blockedAt!(court[0]!, court[1]!, GROUND + 1)).toBe(false);
    const edge = layout.outerEdges[0]!;
    const wallX = (edge.ax + edge.bx) * 0.5 - edge.nx;
    const wallZ = (edge.az + edge.bz) * 0.5 - edge.nz;
    expect(surface.blockedAt!(wallX, wallZ, GROUND + 1)).toBe(true);
  });

  it('replaces OSM relation 2168547 and is ready only when the centroid ground is known', () => {
    const landmark = createAdministration(DEFAULT_BBOX);
    expect(landmark.id).toBe('hero:administration');
    expect(landmark.replaces).toEqual([{ type: 'relation', id: 2168547 }]);
    expect(landmark.footprint.length).toBe(OSM_LANDMARK_DATA.administrationOuter.length);
    expect(landmark.ready!(context)).toBe(true);
    expect(landmark.ready!({ ...context, groundAt: () => null })).toBe(false);
  });

  it('builds valid textured geometry deterministically', () => {
    const first = build('near');
    const second = build('near');
    for (const mesh of first.meshes) validateTexturedMesh(mesh);
    expect(positionsHash(first)).toBe(positionsHash(second));
    expect(first.triangleCount).toBe(second.triangleCount);
  });
});

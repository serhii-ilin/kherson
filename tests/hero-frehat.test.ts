import { describe, expect, it } from 'vitest';
import { DEFAULT_BBOX } from '../src/landmarks/geo.ts';
import { createFrehat, frehatStats, resolveFrehatLayout } from '../src/landmarks/heroes/frehat.ts';
import type { LandmarkMeshData } from '../src/landmarks/types.ts';
import { PBR_LAYER_COUNT } from '../src/world/pbr-layers.ts';

const flatGround = {
  groundAt: () => 0,
  quality: 'high' as const,
};

function vertices(mesh: LandmarkMeshData): number {
  return mesh.positions.length / 3;
}

function bounds(meshes: readonly LandmarkMeshData[]) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const mesh of meshes) {
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const x = mesh.positions[i]!, y = mesh.positions[i + 1]!, z = mesh.positions[i + 2]!;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }
  }
  return { minX, maxX, minY, maxY, minZ, maxZ };
}

function checkTexturedMesh(mesh: LandmarkMeshData): void {
  const count = vertices(mesh);
  expect(mesh.kind).toBe('textured');
  expect(mesh.uvs).toBeDefined();
  expect(mesh.uvs!.length).toBe(count * 2);
  expect(mesh.pbr).toBeDefined();
  expect(mesh.pbr!.length).toBe(count);
  for (let i = 0; i < count; i++) {
    const length = Math.hypot(mesh.normals[i * 3]!, mesh.normals[i * 3 + 1]!, mesh.normals[i * 3 + 2]!);
    expect(length, `normal ${i}`).toBeCloseTo(1, 5);
    const layer = mesh.pbr![i]!;
    expect(Number.isInteger(layer)).toBe(true);
    expect(layer === -1 || (layer >= 0 && layer < PBR_LAYER_COUNT)).toBe(true);
    for (let k = 0; k < 3; k++) {
      expect(mesh.colors[i * 3 + k]!).toBeGreaterThanOrEqual(0);
      expect(mesh.colors[i * 3 + k]!).toBeLessThanOrEqual(1);
    }
  }
  for (let i = 0; i < mesh.uvs!.length; i++) expect(Number.isFinite(mesh.uvs![i]!)).toBe(true);
}

describe('Hotel Frehat hero model', () => {
  it('replaces the OSM way and is anchored on its ring centroid', () => {
    const landmark = createFrehat(DEFAULT_BBOX);
    const layout = resolveFrehatLayout(DEFAULT_BBOX);
    expect(landmark.id).toBe('hero:frehat');
    expect(landmark.replaces).toEqual([{ type: 'way', id: 116810729 }]);
    expect(landmark.footprint).toEqual(layout.ring);
    expect(landmark.vegetationExclusions).toEqual([layout.ring]);
    expect(landmark.anchor.x).toBeCloseTo(layout.anchor[0], 5);
    expect(landmark.anchor.z).toBeCloseTo(layout.anchor[1], 5);
    expect(landmark.ready?.(flatGround)).toBe(true);
    expect(landmark.ready?.({ ...flatGround, groundAt: () => null })).toBe(false);
  });

  it('stays inside the hero triangle budgets at near and far detail', () => {
    const landmark = createFrehat(DEFAULT_BBOX);
    const near = landmark.build({ ...flatGround, lod: 'near' });
    const far = landmark.build({ ...flatGround, lod: 'far' });
    expect(near.triangleCount).toBeGreaterThan(10_000);
    expect(near.triangleCount).toBeLessThanOrEqual(40_000);
    expect(far.triangleCount).toBeLessThanOrEqual(4_000);
    expect(near.materialCount).toBe(1);
    expect(far.materialCount).toBe(1);
    for (const mesh of [...near.meshes, ...far.meshes]) {
      expect(mesh.indices.length % 3).toBe(0);
      for (const index of mesh.indices) expect(index).toBeLessThan(vertices(mesh));
    }
  });

  it('covers the OSM footprint and reaches the expected height', () => {
    const landmark = createFrehat(DEFAULT_BBOX);
    const stats = frehatStats(DEFAULT_BBOX);
    const near = landmark.build({ ...flatGround, lod: 'near' });
    const box = bounds(near.meshes);
    let ringMinX = Infinity, ringMaxX = -Infinity, ringMinZ = Infinity, ringMaxZ = -Infinity;
    for (const [x, z] of landmark.footprint) {
      ringMinX = Math.min(ringMinX, x); ringMaxX = Math.max(ringMaxX, x);
      ringMinZ = Math.min(ringMinZ, z); ringMaxZ = Math.max(ringMaxZ, z);
    }
    // Balconies and the entrance canopy may project, but no more than the stated 1.5 m allowance.
    expect(box.minX).toBeLessThanOrEqual(ringMinX + 1.5);
    expect(box.maxX).toBeGreaterThanOrEqual(ringMaxX - 1.5);
    expect(box.minZ).toBeLessThanOrEqual(ringMinZ + 1.5);
    expect(box.maxZ).toBeGreaterThanOrEqual(ringMaxZ - 1.5);
    expect(box.minX).toBeGreaterThanOrEqual(ringMinX - 1.5);
    expect(box.maxX).toBeLessThanOrEqual(ringMaxX + 1.5);
    expect(box.minZ).toBeGreaterThanOrEqual(ringMinZ - 1.5);
    expect(box.maxZ).toBeLessThanOrEqual(ringMaxZ + 1.5);

    expect(box.minY).toBeCloseTo(0, 5);
    expect(box.maxY).toBeGreaterThanOrEqual(50);
    expect(box.maxY).toBeLessThanOrEqual(62);
    expect(stats.slabTopY).toBeGreaterThanOrEqual(46);
    expect(stats.slabTopY).toBeLessThanOrEqual(50);
    expect(stats.slabParapetTopY).toBeGreaterThanOrEqual(46);
    expect(stats.slabParapetTopY).toBeLessThanOrEqual(50);
  });

  it('keeps every textured attribute valid', () => {
    const near = createFrehat(DEFAULT_BBOX).build({ ...flatGround, lod: 'near' });
    for (const mesh of near.meshes) checkTexturedMesh(mesh);
  });

  it('is byte-identical between builds', () => {
    const landmark = createFrehat(DEFAULT_BBOX);
    const a = landmark.build({ ...flatGround, lod: 'near' });
    const b = landmark.build({ ...flatGround, lod: 'near' });
    expect(a.meshes.length).toBe(b.meshes.length);
    for (let i = 0; i < a.meshes.length; i++) {
      const ma = a.meshes[i]!, mb = b.meshes[i]!;
      expect(ma.kind).toBe(mb.kind);
      expect(Buffer.compare(Buffer.from(ma.positions.buffer), Buffer.from(mb.positions.buffer))).toBe(0);
      expect(Buffer.compare(Buffer.from(ma.normals.buffer), Buffer.from(mb.normals.buffer))).toBe(0);
      expect(Buffer.compare(Buffer.from(ma.colors.buffer), Buffer.from(mb.colors.buffer))).toBe(0);
      expect(Buffer.compare(Buffer.from(ma.indices.buffer), Buffer.from(mb.indices.buffer))).toBe(0);
      expect(Buffer.compare(Buffer.from(ma.uvs!.buffer), Buffer.from(mb.uvs!.buffer))).toBe(0);
      expect(Buffer.compare(Buffer.from(ma.pbr!.buffer), Buffer.from(mb.pbr!.buffer))).toBe(0);
    }
  });

  it('has the specified balcony grid on both long faces', () => {
    const layout = resolveFrehatLayout(DEFAULT_BBOX);
    const stats = frehatStats(DEFAULT_BBOX);
    expect(stats.storeys).toBe(15);
    expect(stats.bays).toBe(Math.round(layout.slab.length / 3.6));
    expect(stats.balconyRows).toBe(12); // storeys 2–13
    expect(stats.balconyCountPerFace).toBe(stats.balconyRows * stats.bays);
    expect(stats.balconyCount).toBe(stats.balconyCountPerFace * 2);
    expect(layout.balconyCount).toBe(stats.balconyCount);
  });

  it('crowns the stair tower with three spikes above the slab roof', () => {
    const stats = frehatStats(DEFAULT_BBOX);
    const layout = resolveFrehatLayout(DEFAULT_BBOX);
    expect(stats.spikeCount).toBe(3);
    expect(stats.stairTowerTopY).toBeGreaterThan(stats.slabParapetTopY);
    expect(stats.spikeTopY).toBeGreaterThan(stats.stairTowerTopY);
    expect(stats.antennaTopY).toBeGreaterThan(stats.slabParapetTopY);

    const near = createFrehat(DEFAULT_BBOX).build({ ...flatGround, lod: 'near' });
    const { ux, uz, vx, vz, x: ox, z: oz } = layout.basis;
    const tower = layout.stairTower;
    let above = 0;
    const xs: number[] = [];
    for (const mesh of near.meshes) {
      for (let i = 0; i < mesh.positions.length; i += 3) {
        const x = mesh.positions[i]!, y = mesh.positions[i + 1]!, z = mesh.positions[i + 2]!;
        if (y <= stats.stairTowerTopY + 0.1) continue;
        const dx = x - ox, dz = z - oz;
        const lx = dx * ux + dz * uz;
        const lz = dx * vx + dz * vz;
        if (lx < tower.x0 - 1.5 || lx > tower.x1 + 1.5 || lz < tower.z0 - 1.5 || lz > tower.z1 + 1.5) continue;
        above++;
        xs.push(lx);
      }
    }
    expect(above).toBeGreaterThan(0);
    xs.sort((a, b) => a - b);
    let clusters = 0;
    let previous = -Infinity;
    for (const x of xs) {
      if (x - previous > 0.35) clusters++;
      previous = x;
    }
    expect(clusters).toBe(3);
  });

  it('builds solid collision prisms for the slab, both towers and the podium', () => {
    const landmark = createFrehat(DEFAULT_BBOX);
    const built = landmark.build({ ...flatGround, lod: 'near' });
    const layout = resolveFrehatLayout(DEFAULT_BBOX);
    const stats = frehatStats(DEFAULT_BBOX);
    expect(built.surfaces.length).toBeGreaterThanOrEqual(4);

    const toWorld = (lx: number, lz: number): [number, number] => [
      layout.basis.x + lx * layout.basis.ux + lz * layout.basis.vx,
      layout.basis.z + lx * layout.basis.uz + lz * layout.basis.vz,
    ];
    const centre = (r: { x0: number; x1: number; z0: number; z1: number }) =>
      toWorld((r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2);
    const anyBlocks = (x: number, z: number, y: number) => built.surfaces.some((s) => s.blockedAt?.(x, z, y) === true);
    expect(anyBlocks(...centre(layout.slab), 20)).toBe(true);
    expect(anyBlocks(...centre(layout.stairTower), stats.stairTowerTopY - 1)).toBe(true);
    expect(anyBlocks(...centre(layout.endTower), stats.slabTopY - 1)).toBe(true);
    expect(anyBlocks(...centre(layout.slab), stats.slabTopY + 1)).toBe(false);
  });
});

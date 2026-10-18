import { describe, expect, it } from 'vitest';
import { FIELDS, REGION, VOXEL } from '../src/world/constants';
import { cellIndex, type RegionData } from '../src/world/format';
import { meshChunk } from '../src/world/mesher';
import { MAT } from '../src/world/materials';
import { ROAD_SIDEWALK } from '../src/world/vector-format';
import { WalkBody } from '../src/player/walk';
import { generateFineChunk } from '../src/fine/generate';
import { FineWorld, type CoarseWorld } from '../src/fine/world';
import { GCX, GCZ, ORIGIN, emptyTile, flatPatch, road } from './fine-util';

/** Flat 4 m coarse world. */
const coarse: CoarseWorld = { heightAt: () => 4 };

function roadWorld(): FineWorld {
  const tile = emptyTile();
  // east-west 8 m road at z = 32 (chunk local) with 2.5 m sidewalks
  tile.roads.push(road([[-10, 32.1], [75, 32.1]], 8, { flags: ROAD_SIDEWALK }));
  const m = generateFineChunk({ gcx: GCX, gcz: GCZ, patch: flatPatch(), tiles: [tile] });
  const w = new FineWorld(coarse);
  w.setChunk(GCX, GCZ, m.raster);
  return w;
}

describe('FineWorld', () => {
  it('adds the 15 cm kerb on sidewalks and nothing on the carriageway', () => {
    const w = roadWorld();
    expect(w.heightAt(ORIGIN + 20, ORIGIN + 32.1)).toBe(4);
    expect(w.heightAt(ORIGIN + 20, ORIGIN + 32.1 - 5)).toBeCloseTo(4.15, 9);
    expect(w.heightAt(ORIGIN + 20, ORIGIN + 32.1 + 5)).toBeCloseTo(4.15, 9);
    expect(w.heightAt(ORIGIN + 20, ORIGIN + 5)).toBe(4); // grass
    // outside any fine chunk it is the coarse height
    expect(w.heightAt(ORIGIN - 10, ORIGIN + 32.1 - 5)).toBe(4);
    w.setChunk(GCX, GCZ, null);
    expect(w.heightAt(ORIGIN + 20, ORIGIN + 32.1 - 5)).toBe(4);
  });

  it('keeps unknown coarse columns unknown and lets taller coarse structures win', () => {
    const w = new FineWorld({ heightAt: (x) => (x < 0 ? null : x > ORIGIN + 30 ? 20 : 4) });
    w.setChunk(GCX, GCZ, new Uint16Array(320 * 320).fill(415));
    expect(w.heightAt(-5, 0)).toBeNull();
    expect(w.heightAt(ORIGIN + 10, ORIGIN + 10)).toBeCloseTo(4.15, 9);
    expect(w.heightAt(ORIGIN + 40, ORIGIN + 10)).toBe(20); // building / deck
  });

  it('walks across a kerb staying on top of the ground, never falling through', () => {
    const w = roadWorld();
    const b = new WalkBody();
    const x = ORIGIN + 20;
    expect(b.placeOnGround(w, x, ORIGIN + 32.1 - 1)).toBe(true);
    expect(b.y).toBe(4);
    // walk north (-z): yaw 0 faces -z
    for (let i = 0; i < 6 * 60; i++) {
      b.step(w, 1 / 60, { forward: 1, right: 0, up: 0 }, 0, false, false);
      const ground = w.heightAt(b.x, b.z)!;
      expect(b.y).toBeGreaterThanOrEqual(Math.min(4.15, ground) - 1e-9);
      expect(b.y).toBeLessThanOrEqual(4.15 + 1e-9);
    }
    // 6 s at 5 m/s from the road centre: ends far on the grass beyond the sidewalk
    expect(b.z).toBeLessThan(ORIGIN + 32.1 - 8);
    expect(b.y).toBe(4);
    // and back: climbs onto the sidewalk and keeps the height while on it
    let onKerb = false;
    for (let i = 0; i < 8 * 60; i++) {
      b.step(w, 1 / 60, { forward: -1, right: 0, up: 0 }, 0, false, false);
      if (Math.abs(b.y - 4.15) < 1e-9) onKerb = true;
    }
    expect(onKerb).toBe(true);
  });
});

describe('coarse ground hiding', () => {
  function region(): RegionData {
    const cells = new Uint8Array(FIELDS * REGION * REGION);
    cells.fill(MAT.GRASS, 0, REGION * REGION);
    cells.fill(2, REGION * REGION, 2 * REGION * REGION);
    const set = (f: number, x: number, z: number, v: number): void => { cells[cellIndex(f, x, z)] = v; };
    // a house, a ground step, a road cell and a bridge-free river cell
    set(2, 10, 10, 5); set(3, 10, 10, MAT.WALL_HOUSE); set(4, 10, 10, MAT.ROOF_RED);
    for (let z = 20; z < 24; z++) for (let x = 20; x < 26; x++) set(1, x, z, 3);
    set(0, 5, 5, MAT.ASPHALT);
    return { rx: 0, rz: 0, cells, features: [] };
  }

  it('puts all ground faces before all structure faces', () => {
    const m = meshChunk(region(), 0, 0);
    expect(m.groundIndexCount).toBeGreaterThan(0);
    expect(m.groundIndexCount).toBeLessThan(m.indices.length);
    expect(m.groundIndexCount % 6).toBe(0);
    const yMax = (from: number, to: number): number => {
      let y = 0;
      for (let i = from; i < to; i++) y = Math.max(y, m.positions[m.indices[i]! * 3 + 1]!);
      return y;
    };
    // ground part: nothing above the highest terrain (3 voxels); structure part reaches the roof (2 + 5 voxels)
    expect(yMax(0, m.groundIndexCount)).toBeLessThanOrEqual(3 * VOXEL);
    expect(yMax(m.groundIndexCount, m.indices.length)).toBe(7 * VOXEL);
    // the step's soil faces are ground; the house walls and roof are structure
    const wallsAt = (from: number, to: number): number => {
      let n = 0;
      for (let i = from; i < to; i += 3) if (m.normals[m.indices[i]! * 3 + 1] === 0) n++;
      return n;
    };
    expect(wallsAt(0, m.groundIndexCount)).toBeGreaterThan(0);
    expect(wallsAt(m.groundIndexCount, m.indices.length)).toBe(8); // 4 house walls = 8 triangles
  });

  it('keeps the same quads as before the split (nothing lost or duplicated)', () => {
    const m = meshChunk(region(), 0, 0);
    const quads = m.indices.length / 6;
    expect(m.positions.length / 12).toBe(quads);
    expect(m.indices.length).toBe(quads * 6);
  });
});

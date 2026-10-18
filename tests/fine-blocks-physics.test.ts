import { describe, expect, it } from 'vitest';
import { MAT } from '../src/world/materials';
import { WalkBody, PLAYER_RADIUS } from '../src/player/walk';
import { BLOCK_PAD, BLOCK_WIN } from '../src/fine/blocks';
import { VOL_XZ } from '../src/fine/volume';
import { FineWorld, type CoarseWorld } from '../src/fine/world';
import { bld, rect, topsOf, window } from './fine-buildings-util';

// Chunk (0, 0). The real building spans x 11..29 (19 columns), z 10..30; the coarse 2 m cells that
// contain it span x 10..30 (cells 5..14), one metre wider than the real west wall.
const GROUND = 4;
const HEIGHT = 16;
const coarse: CoarseWorld = {
  heightAt: (x, z) => (x >= 10 && x < 30 && z >= 10 && z < 30 ? GROUND + HEIGHT : GROUND),
  groundHeightAt: () => GROUND,
};

function worldWithBlocks(): FineWorld {
  const w = window(0, 0, [bld(rect(11, 10, 29, 30), { heightCm: HEIGHT * 100, id: 77 })]);
  const world = new FineWorld(coarse);
  world.setBlocks(0, 0, topsOf(w, GROUND));
  return world;
}

const EAST = -Math.PI / 2; // yaw facing +x

describe('FineWorld with the block tier', () => {
  it('returns the 1 m column top inside a building and ground outside', () => {
    const w = worldWithBlocks();
    expect(w.heightAt(20.5, 20.5)).toBe(GROUND + HEIGHT);
    expect(w.heightAt(5, 20)).toBe(GROUND);
    expect(w.heightAt(10.5, 20.5)).toBe(GROUND); // coarse cell edge, but not the real building yet
    expect(w.heightAt(11.5, 20.5)).toBe(GROUND + HEIGHT);
    expect(w.heightAt(28.5, 20.5)).toBe(GROUND + HEIGHT);
    expect(w.heightAt(29.5, 20.5)).toBe(GROUND); // past the real east wall (the coarse cell reaches 30)
  });

  it('keeps the coarse building heights where the block tier is not loaded', () => {
    const w = new FineWorld(coarse);
    expect(w.heightAt(10.5, 20.5)).toBe(GROUND + HEIGHT);
    w.setBlocks(0, 0, topsOf(window(0, 0, []), GROUND));
    expect(w.heightAt(10.5, 20.5)).toBe(GROUND); // loaded and empty: structures are ignored
    w.setBlocks(0, 0, null);
    expect(w.heightAt(10.5, 20.5)).toBe(GROUND + HEIGHT);
  });

  it('stops a walker at the real 1 m wall, not at the coarse 2 m cell edge', () => {
    const run = (world: FineWorld): number => {
      const b = new WalkBody();
      expect(b.placeOnGround(world, 2, 20.5)).toBe(true);
      for (let i = 0; i < 4 * 60; i++) b.step(world, 1 / 60, { forward: 1, right: 0, up: 0 }, EAST, false, false);
      expect(b.y).toBe(GROUND);
      return b.x;
    };
    const coarseOnly = run(new FineWorld(coarse));
    const blocks = run(worldWithBlocks());
    expect(coarseOnly).toBeLessThanOrEqual(10 - PLAYER_RADIUS + 1e-3); // coarse cell edge at x = 10
    expect(blocks).toBeGreaterThan(10 - PLAYER_RADIUS + 0.5);
    expect(blocks).toBeLessThanOrEqual(11 - PLAYER_RADIUS + 1e-3); // the real wall at x = 11
  });

  it('never lets a walker fall into the building or through a deck column', () => {
    const w = worldWithBlocks();
    const b = new WalkBody();
    // dropped into the building's air space from above: lands on the top
    b.placeOnGround(w, 20.5, 20.5);
    expect(b.y).toBe(GROUND + HEIGHT);
    for (let i = 0; i < 120; i++) b.step(w, 1 / 60, { forward: 0, right: 0, up: 0 }, 0, false, false);
    expect(b.y).toBe(GROUND + HEIGHT);
    // tops array covers exactly the chunk's inner columns
    expect(topsOf(window(0, 0, []), GROUND).length).toBe(VOL_XZ * VOL_XZ);
    expect(BLOCK_WIN - 2 * BLOCK_PAD).toBe(VOL_XZ);
  });

  it('keeps balconies and canopies out of the column raster, so entrances stay walkable', () => {
    const w = window(0, 0, [bld(rect(11, 10, 29, 30), { heightCm: HEIGHT * 100, id: 77 })]);
    let canopy = 0;
    for (let y = 0; y < 192; y++) for (let z = 0; z < 64; z++) for (let x = 0; x < 64; x++) {
      if (w.get(x, y, z) === MAT.METAL && (x < 11 || x >= 29 || z < 10 || z >= 30)) canopy++;
    }
    expect(canopy).toBeGreaterThan(0); // there are rails / canopies outside the footprint
    const tops = topsOf(w, GROUND);
    for (let z = 0; z < 64; z++) for (let x = 0; x < 64; x++) {
      const inside = x >= 11 && x < 29 && z >= 10 && z < 30;
      if (!inside) expect(tops[z * 64 + x]).toBe(0);
    }
  });
});

import { describe, expect, it } from 'vitest';
import { MAT } from '../src/world/materials';
import { ROAD, ROAD_BRIDGE, type VRoad } from '../src/world/vector-format';
import { addBridges, type BridgeContext, type PlacedRoad } from '../src/fine/bridges';
import { BLOCK_PAD, BLOCK_WIN, BlockWindow, columnPhysics } from '../src/fine/blocks';
import { VOL_XZ, VOL_Y, Volume } from '../src/fine/volume';
import { FineWorld, type CoarseWorld } from '../src/fine/world';
import { WalkBody } from '../src/player/walk';

const SOUTH = Math.PI; // yaw facing +z
const EAST = -Math.PI / 2; // yaw facing +x

function road(pts: ReadonlyArray<readonly [number, number]>, widthM: number): PlacedRoad {
  const a = new Int32Array(pts.length * 2);
  pts.forEach(([x, z], i) => { a[i * 2] = Math.round(x * 100); a[i * 2 + 1] = Math.round(z * 100); });
  const r: VRoad = { pts: a, kind: ROAD.PRIMARY, flags: ROAD_BRIDGE, widthCm: widthM * 100, lanes: 2, layer: 1, name: -1 };
  return { road: r, ox: 0, oz: 0 };
}

// river for z in [20, 100): bed 0; land 4; the coarse 2 m deck (top 8) only where the road crosses it
const inRiver = (z: number): boolean => z >= 20 && z < 100;
const ctx: BridgeContext = {
  groundAt: (_x, z) => (inRiver(z) ? 0 : 4),
  isWater: (_x, z) => inRiver(z),
  deckTopAt: (x, z) => (inRiver(z) && Math.abs(x - 32) < 6 ? 8 : null),
};
const coarse: CoarseWorld = {
  heightAt: (x, z) => (inRiver(z) && Math.abs(x - 32) < 6 ? 8 : inRiver(z) ? 0 : 4),
  terrainHeightAt: (_x, z) => (inRiver(z) ? 0 : 4),
  groundHeightAt: (x, z) => (inRiver(z) && Math.abs(x - 32) < 6 ? 8 : inRiver(z) ? 0 : 4),
  isWater: (x, z) => inRiver(z) && Math.abs(x - 32) >= 6,
};

/** Chunk (0, 0) of a north-south bridge along x = 32, as the block tier would register it. */
function bridgeWorld(): { world: FineWorld; win: BlockWindow } {
  const vol = new Volume(0, 0);
  addBridges(vol, [road([[32, 0], [32, 120]], 8)], ctx);
  const win = new BlockWindow(0, 0);
  for (let y = 0; y < VOL_Y; y++) {
    for (let z = 0; z < VOL_XZ; z++) {
      for (let x = 0; x < VOL_XZ; x++) {
        const m = vol.mats[(y * VOL_XZ + z) * VOL_XZ + x]!;
        if (m !== 0) win.mats[(y * BLOCK_WIN + z + BLOCK_PAD) * BLOCK_WIN + x + BLOCK_PAD] = m;
      }
    }
  }
  const groundY = new Uint8Array(BLOCK_WIN * BLOCK_WIN);
  for (let z = 0; z < BLOCK_WIN; z++) groundY.fill(inRiver(z - BLOCK_PAD) ? 0 : 4, z * BLOCK_WIN, (z + 1) * BLOCK_WIN);
  const p = columnPhysics(win.mats, BLOCK_WIN, BLOCK_PAD, win.foot, groundY);
  const world = new FineWorld(coarse);
  world.setBlocks(0, 0, p.tops, p.decks, p.rails);
  return { world, win };
}

describe('walking on 1 m bridges', () => {
  it('records the deck as a walk surface and the railing as a separate wall', () => {
    const { win } = bridgeWorld();
    const groundY = new Uint8Array(BLOCK_WIN * BLOCK_WIN);
    for (let z = 0; z < BLOCK_WIN; z++) groundY.fill(inRiver(z - BLOCK_PAD) ? 0 : 4, z * BLOCK_WIN, (z + 1) * BLOCK_WIN);
    const p = columnPhysics(win.mats, BLOCK_WIN, BLOCK_PAD, win.foot, groundY);
    const at = (a: Uint8Array, x: number, z: number): number => a[z * VOL_XZ + x]!;
    // over the river between piers: floating deck (top = ASPHALT block y 7 + 1), no ground-supported top
    expect(at(p.decks, 32, 50)).toBe(8);
    expect(at(p.tops, 32, 50)).toBe(0);
    expect(at(p.rails, 32, 50)).toBe(0);
    // the railing column: surface still the deck top (METAL cap excluded), rail bottom = deck surface
    expect(at(p.decks, 26, 50)).toBe(8);
    expect(at(p.rails, 26, 50)).toBe(8);
    expect(at(p.rails, 37, 50)).toBe(8);
    // a pier column is ground supported
    expect(at(p.tops, 32, 41)).toBe(8);
  });

  it('keeps a walker on the 1 m deck over water and stops it at the railing', () => {
    const { world } = bridgeWorld();
    const b = new WalkBody();
    expect(b.placeOnGround(world, 32.5, 10)).toBe(true);
    for (let i = 0; i < 60 * 12; i++) {
      b.step(world, 1 / 60, { forward: 1, right: 0, up: 0 }, SOUTH, false, false);
      if (b.z > 30) {
        // on the deck: never dropped below its surface (no falling into the river)
        expect(b.y).toBeGreaterThanOrEqual(7.99);
      }
    }
    expect(b.z).toBeGreaterThan(55);
    expect(b.y).toBe(8);

    // walk sideways into the railing at x ~ 37: stops on the deck instead of stepping over it
    const c = new WalkBody();
    expect(c.placeOnGround(world, 32.5, 50.5)).toBe(true);
    expect(c.y).toBe(8);
    for (let i = 0; i < 60 * 4; i++) c.step(world, 1 / 60, { forward: 1, right: 0, up: 0 }, EAST, false, false);
    expect(c.y).toBe(8);
    expect(c.x).toBeLessThan(37);
    expect(c.x).toBeGreaterThan(35);

    // without the railing wall the walker climbs onto it (the old behaviour)
    const open: FineWorld = world;
    const noRail = { heightAt: open.heightAt.bind(open), isWater: open.isWater.bind(open) };
    const d = new WalkBody();
    expect(d.placeOnGround(noRail, 32.5, 50.5)).toBe(true);
    for (let i = 0; i < 60 * 4; i++) d.step(noRail, 1 / 60, { forward: 1, right: 0, up: 0 }, EAST, false, false);
    expect(d.x).toBeGreaterThan(37.5);
  });

  it('lets a walker pass under the deck at the river bank', () => {
    const { world } = bridgeWorld();
    // below the deck (feet at 0, river bed level is water, so check a dry spot: the pier-free land under
    // the ramp is not modelled here; use the height query directly)
    expect(world.heightAt(32.5, 50.5, 3)).toBe(0); // deck is above refY: ignored
    expect(world.heightAt(32.5, 50.5, 9)).toBe(8);
    expect(world.blockedAt(37.5, 50.5, 8)).toBe(true);
    expect(world.blockedAt(37.5, 50.5, 0)).toBe(false); // far below the railing
    expect(world.blockedAt(37.5, 50.5, 9)).toBe(false); // above it
  });
});

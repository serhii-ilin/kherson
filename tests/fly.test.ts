import { describe, expect, it } from 'vitest';
import { FLY_CLEARANCE, flyCollide, flyStep } from '../src/player/fly.ts';

// flat ground at 4 m with a 30 m tall building occupying x in [10, 20)
const world = {
  heightAt: (x: number, _z: number): number | null => (x >= 10 && x < 20 ? 30 : 4),
};

describe('fly collision', () => {
  it('cannot descend below the ground', () => {
    const pos = { x: 0, y: 6, z: 0 };
    for (let i = 0; i < 120; i++) {
      flyStep(pos, 1 / 60, { forward: 0, right: 0, up: -1 }, 0, 0, false);
      flyCollide(pos, pos.x, pos.z, world);
    }
    expect(pos.y).toBeCloseTo(4 + FLY_CLEARANCE);
  });

  it('cannot dive through the ground looking down', () => {
    const pos = { x: 0, y: 20, z: 0 };
    for (let i = 0; i < 300; i++) {
      const px = pos.x, pz = pos.z;
      flyStep(pos, 1 / 60, { forward: 1, right: 0, up: 0 }, 0, -1.4, true);
      flyCollide(pos, px, pz, world);
      expect(pos.y).toBeGreaterThanOrEqual(4 + FLY_CLEARANCE - 1e-9);
    }
  });

  it('is stopped by a building wall below its roof', () => {
    // yaw -90° faces +x (east), toward the building
    const pos = { x: 0, y: 10, z: 0 };
    for (let i = 0; i < 120; i++) {
      const px = pos.x, pz = pos.z;
      flyStep(pos, 1 / 60, { forward: 1, right: 0, up: 0 }, -Math.PI / 2, 0, false);
      flyCollide(pos, px, pz, world);
    }
    expect(pos.x).toBeLessThan(10);
    expect(pos.y).toBeCloseTo(10);
  });

  it('flies over the building when above its roof', () => {
    const pos = { x: 0, y: 40, z: 0 };
    for (let i = 0; i < 120; i++) {
      const px = pos.x, pz = pos.z;
      flyStep(pos, 1 / 60, { forward: 1, right: 0, up: 0 }, -Math.PI / 2, 0, false);
      flyCollide(pos, px, pz, world);
    }
    expect(pos.x).toBeGreaterThan(20);
  });

  it('is lifted out when placed inside a building', () => {
    const pos = { x: 15, y: 10, z: 0 };
    flyCollide(pos, 15, 0, world);
    expect(pos.y).toBeCloseTo(30 + FLY_CLEARANCE);
  });
});

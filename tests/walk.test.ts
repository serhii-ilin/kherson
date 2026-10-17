import { describe, expect, it } from 'vitest';
import { WalkBody, STEP_HEIGHT, type WalkWorld } from '../src/player/walk';

const FWD = { forward: 1, right: 0, up: 0 };
const NONE = { forward: 0, right: 0, up: 0 };

/** Flat ground at 4 m; optional box [x0,x1) x all z with a given top. */
function world(box?: { x0: number; x1: number; top: number }, water?: { x0: number; x1: number }): WalkWorld {
  return {
    heightAt: (x) => (box && x >= box.x0 && x < box.x1 ? box.top : 4),
    isWater: (x) => (water ? x >= water.x0 && x < water.x1 : false),
  };
}

// yaw = -PI/2 faces +x
const EAST = -Math.PI / 2;

function run(b: WalkBody, w: WalkWorld, seconds: number, axis = FWD, yaw = EAST, jump = false): void {
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) b.step(w, dt, axis, yaw, false, jump);
}

describe('WalkBody', () => {
  it('walks on flat ground at 5 m/s', () => {
    const w = world();
    const b = new WalkBody();
    b.placeOnGround(w, 0, 0);
    run(b, w, 1);
    expect(b.x).toBeGreaterThan(4.8);
    expect(b.x).toBeLessThan(5.2);
    expect(b.y).toBe(4);
  });

  it('cannot pass a 10 m wall', () => {
    const w = world({ x0: 10, x1: 14, top: 14 });
    const b = new WalkBody();
    b.placeOnGround(w, 0, 0);
    run(b, w, 5);
    expect(b.x).toBeLessThan(10 - 0.4 + 1e-3);
    expect(b.x).toBeGreaterThan(9);
    expect(b.y).toBe(4);
  });

  it('steps up a 2 m ledge and eases the camera', () => {
    const w = world({ x0: 10, x1: 1000, top: 4 + STEP_HEIGHT });
    const b = new WalkBody();
    b.placeOnGround(w, 0, 0);
    run(b, w, 3);
    expect(b.x).toBeGreaterThan(10);
    expect(b.y).toBeCloseTo(6, 5);
    expect(b.stepOffset).toBe(0);
  });

  it('does not climb a ledge higher than one voxel', () => {
    const w = world({ x0: 10, x1: 1000, top: 4 + STEP_HEIGHT + 0.5 });
    const b = new WalkBody();
    b.placeOnGround(w, 0, 0);
    run(b, w, 4);
    expect(b.x).toBeLessThan(10);
  });

  it('falls with gravity from the air and lands', () => {
    const w = world();
    const b = new WalkBody();
    b.x = 0; b.z = 0; b.y = 54; b.grounded = false;
    b.step(w, 0.1, NONE, 0, false, false);
    expect(b.y).toBeLessThan(54);
    expect(b.y).toBeCloseTo(54 - 25 * 0.1 * 0.1, 6); // semi-implicit Euler
    run(b, w, 4, NONE);
    expect(b.y).toBe(4);
    expect(b.grounded).toBe(true);
  });

  it('jumps about 1 m high', () => {
    const w = world();
    const b = new WalkBody();
    b.placeOnGround(w, 0, 0);
    let max = 0;
    b.step(w, 1 / 60, NONE, 0, false, true);
    for (let i = 0; i < 60; i++) {
      b.step(w, 1 / 60, NONE, 0, false, false);
      max = Math.max(max, b.y - 4);
    }
    expect(max).toBeGreaterThan(0.9);
    expect(max).toBeLessThan(1.1);
  });

  it('is blocked by water', () => {
    const w = world(undefined, { x0: 8, x1: 20 });
    const b = new WalkBody();
    b.placeOnGround(w, 0, 0);
    run(b, w, 4);
    expect(b.x).toBeLessThan(8);
  });

  it('is stopped by a tree trunk and slides past it', () => {
    const trunk = { x: 5, z: 0 };
    const w: WalkWorld = {
      heightAt: () => 4,
      trunkNear: (x, z, r) => Math.hypot(x - trunk.x, z - trunk.z) < r,
    };
    const b = new WalkBody();
    b.placeOnGround(w, 0, 0);
    run(b, w, 3);
    expect(b.x).toBeLessThan(5 - 0.4 + 0.2);
    expect(b.x).toBeGreaterThan(4);
    // walking diagonally past the trunk is not blocked on the free axis
    b.placeOnGround(w, 0, 0);
    run(b, w, 3, { forward: 1, right: 0, up: 0 }, -Math.PI / 2 + 0.6);
    expect(b.z).toBeLessThan(-1);
  });

  it('holds still while the column is not loaded', () => {
    const w: WalkWorld = { heightAt: () => null };
    const b = new WalkBody();
    b.y = 30;
    run(b, w, 1);
    expect(b.y).toBe(30);
    expect(b.x).toBe(0);
  });
});

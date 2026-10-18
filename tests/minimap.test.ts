import { describe, expect, it } from 'vitest';
import { canvasToWorld, clampWorld, nextZoom } from '../src/ui/minimap.ts';

const steps = [400, 800, 1500, 4000];

describe('minimap geometry', () => {
  it('maps the canvas centre to the player and edges by view metres', () => {
    expect(canvasToWorld(100, 100, 200, 800, 1200, 900)).toEqual({ x: 1200, z: 900 });
    expect(canvasToWorld(0, 0, 200, 800, 1200, 900)).toEqual({ x: 800, z: 500 });
    expect(canvasToWorld(200, 100, 200, 800, 1200, 900)).toEqual({ x: 1600, z: 900 });
  });

  it('clamps teleport targets to the world rectangle', () => {
    expect(clampWorld(-10, 9000, 4000, 6000)).toEqual({ x: 0, z: 6000 });
  });
});

describe('minimap zoom', () => {
  it('steps in and out and clamps at both ends', () => {
    expect(nextZoom(steps, 1500, 1)).toBe(800);
    expect(nextZoom(steps, 800, -1)).toBe(1500);
    expect(nextZoom(steps, 400, 1)).toBe(400);
    expect(nextZoom(steps, 4000, -1)).toBe(4000);
  });

  it('starts from the nearest step when current is unknown', () => {
    expect(nextZoom(steps, 1400, 1)).toBe(800);
    expect(nextZoom(steps, 1400, -1)).toBe(4000);
  });
});

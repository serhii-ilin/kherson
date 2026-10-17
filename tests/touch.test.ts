import { describe, expect, it } from 'vitest';
import { joystickAxes } from '../src/player/touch.ts';

const R = 60;
const DZ = 0.15;

describe('joystickAxes', () => {
  it('returns zeros at the center', () => {
    const a = joystickAxes(0, 0, R, DZ);
    expect(a.forward).toBe(0);
    expect(a.right).toBe(0);
    expect(a.magnitude).toBe(0);
  });

  it('full up gives forward 1', () => {
    const a = joystickAxes(0, -R, R, DZ);
    expect(a.forward).toBe(1);
    expect(a.right).toBe(0);
    expect(a.magnitude).toBe(1);
  });

  it('full right gives right 1', () => {
    const a = joystickAxes(R, 0, R, DZ);
    expect(a.right).toBe(1);
    expect(a.forward).toBe(0);
    expect(a.magnitude).toBe(1);
  });

  it('full down gives forward -1', () => {
    const a = joystickAxes(0, R, R, DZ);
    expect(a.forward).toBe(-1);
    expect(a.magnitude).toBe(1);
  });

  it('clamps displacement beyond the radius to magnitude 1', () => {
    const a = joystickAxes(400, -400, R, DZ);
    expect(a.magnitude).toBe(1);
    expect(Math.hypot(a.forward, a.right)).toBeCloseTo(1, 10);
  });

  it('is zero inside the dead zone', () => {
    const a = joystickAxes(5, 0, R, DZ);
    expect(a.forward).toBe(0);
    expect(a.right).toBe(0);
    expect(a.magnitude).toBe(0);
  });

  it('rescales so output starts at 0 at the dead-zone edge', () => {
    expect(joystickAxes(R * DZ, 0, R, DZ).magnitude).toBe(0);
    const mid = joystickAxes(R * (DZ + (1 - DZ) * 0.5), 0, R, DZ);
    expect(mid.right).toBeCloseTo(0.5, 6);
    expect(mid.magnitude).toBeCloseTo(0.5, 6);
  });

  it('keeps diagonal magnitude <= 1', () => {
    const a = joystickAxes(R, -R, R, DZ);
    expect(a.magnitude).toBeLessThanOrEqual(1);
    expect(Math.hypot(a.forward, a.right)).toBeLessThanOrEqual(1 + 1e-12);
  });
});

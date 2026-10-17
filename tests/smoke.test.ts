import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

describe('smoke', () => {
  it('adds numbers', () => {
    expect(1 + 1).toBe(2);
  });

  it('exposes THREE.Vector3', () => {
    expect(THREE.Vector3).toBeDefined();
    const v = new THREE.Vector3(1, 2, 3);
    expect(v.x).toBe(1);
  });
});

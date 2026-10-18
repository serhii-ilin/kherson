import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ChunkBatch, type BatchGeom } from '../src/world/chunk-batch.ts';

function quads(n: number): BatchGeom {
  const positions = new Float32Array(n * 12);
  for (let i = 0; i < positions.length; i++) positions[i] = (i % 7) + 1;
  const indices = new Uint32Array(n * 6);
  for (let q = 0; q < n; q++) indices.set([0, 1, 2, 0, 2, 3].map((k) => k + q * 4), q * 6);
  return {
    attrs: {
      position: [positions, 3],
      normal: [new Float32Array(n * 12), 3],
      color: [new Float32Array(n * 12), 3],
      aWall: [new Float32Array(n * 16), 4],
    },
    indices,
  };
}

describe('ChunkBatch', () => {
  it('counts only visible triangles and recycles freed slots', () => {
    const b = new ChunkBatch(new THREE.MeshBasicMaterial(), { instances: 2, vertices: 256 });
    const a = b.add(quads(10), 0, 0);
    expect(b.triangles).toBe(20);
    b.setVisible(a, false);
    expect(b.triangles).toBe(0);
    b.setVisible(a, true);
    b.remove(a);
    expect(b.triangles).toBe(0);
    const c = b.add(quads(10), 64, 0);
    expect(c.geomId).toBe(a.geomId);
    expect(b.triangles).toBe(20);
    expect(b.mesh.getVisibleAt(c.instId)).toBe(true);
  });

  it('grows past its initial instance and vertex capacity', () => {
    const b = new ChunkBatch(new THREE.MeshBasicMaterial(), { instances: 2, vertices: 256 });
    const slots = [];
    for (let i = 0; i < 20; i++) slots.push(b.add(quads(50 + i), i * 64, 0));
    expect(b.capacityVertices).toBeGreaterThan(256);
    let tris = 0;
    for (let i = 0; i < 20; i++) tris += (50 + i) * 2;
    expect(b.triangles).toBe(tris);
  });
});

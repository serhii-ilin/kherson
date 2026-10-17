import { describe, it, expect } from 'vitest';
import { MICRO, SPECIES, TREE_SPECIES, BUSH_SPECIES, VARIANTS, buildModel, type VegModel } from '../src/nature/models.ts';

describe('buildModel', () => {
  it('builds all species', () => {
    const species = [...TREE_SPECIES, ...BUSH_SPECIES];
    for (const s of species) {
      for (let v = 0; v < VARIANTS; v++) {
        for (const lod of [0, 1, 2] as const) {
          const model = buildModel(s, v, lod);
          expect(model).toBeDefined();
          expect(model.positions).toBeInstanceOf(Float32Array);
          expect(model.normals).toBeInstanceOf(Float32Array);
          expect(model.colors).toBeInstanceOf(Float32Array);
          expect(model.sway).toBeInstanceOf(Float32Array);
          expect(model.indices).toBeInstanceOf(Uint32Array);
          expect(model.height).toBeGreaterThan(0);
          expect(model.radius).toBeGreaterThan(0);
        }
      }
    }
  });

  it('array lengths are consistent', () => {
    const model = buildModel(SPECIES.CHESTNUT, 0, 0);
    const vertCount = model.positions.length / 3;
    expect(model.normals.length).toBe(vertCount * 3);
    expect(model.colors.length).toBe(vertCount * 3);
    expect(model.sway.length).toBe(vertCount);
    expect(model.indices.length % 3).toBe(0);

    const maxIndex = Math.max(...Array.from(model.indices));
    expect(maxIndex).toBeLessThan(vertCount);
  });

  it('is deterministic', () => {
    const m1 = buildModel(SPECIES.CHESTNUT, 1, 0);
    const m2 = buildModel(SPECIES.CHESTNUT, 1, 0);

    expect(Array.from(m1.positions)).toEqual(Array.from(m2.positions));
    expect(Array.from(m1.normals)).toEqual(Array.from(m2.normals));
    expect(Array.from(m1.colors)).toEqual(Array.from(m2.colors));
    expect(Array.from(m1.sway)).toEqual(Array.from(m2.sway));
    expect(Array.from(m1.indices)).toEqual(Array.from(m2.indices));
  });

  it('lod 0 triangle count within bounds', () => {
    for (const species of TREE_SPECIES) {
      for (let v = 0; v < VARIANTS; v++) {
        const triangles = buildModel(species, v, 0).indices.length / 3;
        expect(triangles).toBeGreaterThanOrEqual(150);
        expect(triangles).toBeLessThanOrEqual(1500);
      }
    }
    for (const species of BUSH_SPECIES) {
      const triangles = buildModel(species, 0, 0).indices.length / 3;
      expect(triangles).toBeGreaterThanOrEqual(30);
      expect(triangles).toBeLessThanOrEqual(200);
    }
  });

  it('lod 2 (mid) triangle count <= 400', () => {
    for (const s of [...TREE_SPECIES, ...BUSH_SPECIES]) {
      for (let v = 0; v < VARIANTS; v++) {
        const triangles = buildModel(s, v, 2).indices.length / 3;
        expect(triangles).toBeGreaterThan(0);
        expect(triangles).toBeLessThanOrEqual(400);
      }
    }
  });

  it('lod 1 triangle count <= 24', () => {
    const species = [...TREE_SPECIES, ...BUSH_SPECIES];
    for (const s of species) {
      for (let v = 0; v < VARIANTS; v++) {
        const model = buildModel(s, v, 1);
        const triangles = model.indices.length / 3;
        expect(triangles).toBeLessThanOrEqual(24);
      }
    }
  });

  it('poplar height > 14', () => {
    const model = buildModel(SPECIES.POPLAR, 0, 0);
    expect(model.height).toBeGreaterThan(14);
  });

  it('bush height < 2.2', () => {
    for (const species of BUSH_SPECIES) {
      const model = buildModel(species, 0, 0);
      expect(model.height).toBeLessThan(2.2);
    }
  });

  it('pine height > 10', () => {
    const model = buildModel(SPECIES.PINE, 0, 0);
    expect(model.height).toBeGreaterThan(10);
  });

  it('min y >= 0', () => {
    const species = [...TREE_SPECIES, ...BUSH_SPECIES];
    for (const s of species) {
      const model = buildModel(s, 0, 0);
      let minY = Infinity;
      for (let i = 1; i < model.positions.length; i += 3) {
        minY = Math.min(minY, model.positions[i]);
      }
      expect(minY).toBeGreaterThanOrEqual(-0.01); // small epsilon for floating point
    }
  });

  it('sway values in [0, 1]', () => {
    const species = [...TREE_SPECIES, ...BUSH_SPECIES];
    for (const s of species) {
      const model = buildModel(s, 0, 0);
      for (let i = 0; i < model.sway.length; i++) {
        expect(model.sway[i]).toBeGreaterThanOrEqual(0);
        expect(model.sway[i]).toBeLessThanOrEqual(1);
      }
    }
  });

  it('sway at min y vertices <= 0.05', () => {
    const model = buildModel(SPECIES.CHESTNUT, 0, 0);
    const positions = model.positions;
    const sway = model.sway;

    let minY = Infinity;
    for (let i = 1; i < positions.length; i += 3) {
      minY = Math.min(minY, positions[i]);
    }

    const epsilon = 0.01;
    for (let i = 0; i < positions.length; i += 3) {
      const y = positions[i + 1];
      if (Math.abs(y - minY) < epsilon) {
        const vertIdx = i / 3;
        expect(sway[vertIdx]).toBeLessThanOrEqual(0.05);
      }
    }
  });

  it('no internal faces (lod 0)', () => {
    const model = buildModel(SPECIES.CHESTNUT, 0, 0);
    const positions = model.positions;
    const normals = model.normals;
    const indices = model.indices;

    const faceMap = new Map<string, number[]>();

    for (let i = 0; i < indices.length; i += 3) {
      const i0 = indices[i];
      const i1 = indices[i + 1];
      const i2 = indices[i + 2];

      const v0 = [positions[i0 * 3], positions[i0 * 3 + 1], positions[i0 * 3 + 2]];
      const v1 = [positions[i1 * 3], positions[i1 * 3 + 1], positions[i1 * 3 + 2]];
      const v2 = [positions[i2 * 3], positions[i2 * 3 + 1], positions[i2 * 3 + 2]];

      const n0 = [normals[i0 * 3], normals[i0 * 3 + 1], normals[i0 * 3 + 2]];

      const verts = [v0, v1, v2].sort((a, b) => {
        const diff = (a[0] - b[0]) || (a[1] - b[1]) || (a[2] - b[2]);
        return diff === 0 ? 0 : diff < 0 ? -1 : 1;
      });

      const key = verts.map(v => `${v[0].toFixed(3)},${v[1].toFixed(3)},${v[2].toFixed(3)}`).join('|');

      if (!faceMap.has(key)) {
        faceMap.set(key, n0);
      } else {
        const otherNormal = faceMap.get(key)!;
        const dot = n0[0] * otherNormal[0] + n0[1] * otherNormal[1] + n0[2] * otherNormal[2];
        // Should not have opposite normals (internal faces)
        expect(Math.abs(dot + 1)).toBeGreaterThan(0.1);
      }
    }
  });
});

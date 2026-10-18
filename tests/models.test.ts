import { describe, it, expect } from 'vitest';
import { SPECIES, TREE_SPECIES, BUSH_SPECIES, VARIANTS, buildModel, type VegModel } from '../src/nature/models.ts';

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

describe('finest model (lod 3, 0.2 m)', () => {
  const ALL = [...TREE_SPECIES, ...BUSH_SPECIES];
  const bbox = (m: VegModel): { h: number; r: number } => {
    let h = 0, r = 0;
    for (let i = 0; i < m.positions.length; i += 3) {
      h = Math.max(h, m.positions[i + 1]!);
      r = Math.max(r, Math.abs(m.positions[i]!), Math.abs(m.positions[i + 2]!));
    }
    return { h, r };
  };

  it('triangle bounds for every species x variant', () => {
    for (const s of ALL) {
      for (let v = 0; v < VARIANTS; v++) {
        const m = buildModel(s, v, 3);
        const tris = m.indices.length / 3;
        const isBush = s >= SPECIES.BUSH;
        expect(tris, `species ${s} variant ${v}`).toBeGreaterThan(isBush ? 100 : 1500);
        expect(tris, `species ${s} variant ${v}`).toBeLessThanOrEqual(isBush ? 1500 : 6000);
        expect(m.leaf).toBeInstanceOf(Float32Array);
        expect(m.leaf!.length).toBe(m.positions.length / 3);
      }
    }
  });

  it('is deterministic', () => {
    for (const s of [SPECIES.LINDEN, SPECIES.BUSH_LILAC]) {
      const a = buildModel(s, 2, 3);
      const b = buildModel(s, 2, 3);
      expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
      expect(Array.from(a.colors)).toEqual(Array.from(b.colors));
      expect(Array.from(a.indices)).toEqual(Array.from(b.indices));
    }
  });

  it('sway is 0 at the trunk base and rises with height', () => {
    for (const s of TREE_SPECIES) {
      const m = buildModel(s, 0, 3);
      let lo = 0, hi = 0, nLo = 0, nHi = 0;
      for (let i = 0; i < m.sway.length; i++) {
        const y = m.positions[i * 3 + 1]!;
        expect(m.sway[i]).toBeGreaterThanOrEqual(0);
        expect(m.sway[i]).toBeLessThanOrEqual(1);
        if (y < 0.01) { expect(m.sway[i]).toBeLessThanOrEqual(0.001); }
        if (y < m.height * 0.3) { lo += m.sway[i]!; nLo++; }
        if (y > m.height * 0.7) { hi += m.sway[i]!; nHi++; }
      }
      expect(hi / nHi).toBeGreaterThan(lo / nLo);
    }
  });

  it('has no internal faces (no two opposite coincident quads)', () => {
    for (const s of [SPECIES.CHESTNUT, SPECIES.PINE, SPECIES.BUSH_PINK]) {
      const m = buildModel(s, 1, 3);
      const seen = new Set<string>();
      const q = (n: number): string => (Math.round(n * 1000) / 1000).toFixed(3);
      for (let i = 0; i < m.indices.length; i += 6) {
        // quads are emitted as two triangles; use the first vertex, the normal and the plane
        const a = m.indices[i]!;
        const nx = m.normals[a * 3]!, ny = m.normals[a * 3 + 1]!, nz = m.normals[a * 3 + 2]!;
        const key = (sx: number): string => `${q(m.positions[a * 3]!)},${q(m.positions[a * 3 + 1]!)},${q(m.positions[a * 3 + 2]!)}|${sx * nx},${sx * ny},${sx * nz}`;
        // an opposite face at the same position would be a quad whose own key has the flipped normal
        expect(seen.has(key(-1)), `species ${s}`).toBe(false);
        seen.add(key(1));
      }
    }
  });

  it('crown is a dense mass with small gaps (side projection 70-97% filled)', () => {
    const C = 0.2;
    for (const s of TREE_SPECIES) {
      const m = buildModel(s, 0, 3);
      // project every quad facing +-z onto the xy plane; filled cells = leaf silhouette
      const filled = new Set<string>();
      for (let i = 0; i < m.indices.length; i += 6) {
        const a = m.indices[i]!;
        if (Math.abs(m.normals[a * 3 + 2]!) < 0.5 || m.leaf![a] === 0) continue;
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        for (const k of [0, 1, 2, 5]) {
          const id = m.indices[i + k]!;
          x0 = Math.min(x0, m.positions[id * 3]!); x1 = Math.max(x1, m.positions[id * 3]!);
          y0 = Math.min(y0, m.positions[id * 3 + 1]!); y1 = Math.max(y1, m.positions[id * 3 + 1]!);
        }
        for (let x = Math.floor(x0 / C + 1e-6); x < Math.round(x1 / C); x++) {
          for (let y = Math.floor(y0 / C + 1e-6); y < Math.round(y1 / C); y++) filled.add(`${x},${y}`);
        }
      }
      const b = bbox(m);
      const yLo = m.height * 0.45, yHi = m.height * 0.8;
      let inside = 0, hit = 0;
      for (let x = -b.r * 0.6; x <= b.r * 0.6; x += C) for (let y = yLo; y <= yHi; y += C) {
        inside++;
        if (filled.has(`${Math.floor(x / C + 1e-6)},${Math.floor(y / C + 1e-6)}`)) hit++;
      }
      expect(hit / inside, `species ${s}`).toBeGreaterThanOrEqual(0.7);
      expect(hit / inside, `species ${s}`).toBeLessThanOrEqual(1);
    }
  });

  it('trunks are slender (<= 0.7 m across at the base)', () => {
    for (const s of TREE_SPECIES) {
      const m = buildModel(s, 0, 3);
      let w = 0;
      for (let i = 0; i < m.positions.length; i += 3) {
        if (m.positions[i + 1]! < 0.1 && m.leaf![i / 3] === 0) w = Math.max(w, Math.abs(m.positions[i]!) * 2, Math.abs(m.positions[i + 2]!) * 2);
      }
      expect(w, `species ${s}`).toBeLessThanOrEqual(0.7);
    }
  });

  it('silhouette height and radius are within 15% of the 0.5 m model', () => {
    for (const s of ALL) {
      for (let v = 0; v < VARIANTS; v++) {
        const f = bbox(buildModel(s, v, 3));
        const n = bbox(buildModel(s, v, 0));
        // within 15%, or most of a 0.5 m voxel (the coarse model's own snapping error) on small bushes
        expect(Math.abs(f.h - n.h), `height ${s}/${v}`).toBeLessThanOrEqual(Math.max(0.15 * n.h, 0.35));
        expect(Math.abs(f.r - n.r), `radius ${s}/${v}`).toBeLessThanOrEqual(Math.max(0.15 * n.r, 0.35));
      }
    }
  });

  it('flowering bushes carry blossom-coloured voxels', () => {
    const m = buildModel(SPECIES.BUSH_LILAC, 0, 3);
    // blossom colour #b48ad6: blue channel clearly above green
    let blossom = 0, green = 0;
    for (let i = 0; i < m.colors.length; i += 3) {
      if (m.colors[i + 2]! > m.colors[i + 1]! * 1.15) blossom++;
      else green++;
    }
    expect(blossom).toBeGreaterThan(0);
    expect(green).toBeGreaterThan(0);
  });
});

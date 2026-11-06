import { describe, it, expect } from 'vitest';
import { SPECIES, TREE_SPECIES, BUSH_SPECIES, VARIANTS, buildModel, type VegModel } from '../src/nature/models.ts';
import { LEAF_LAYER, speciesLayers } from '../src/nature/tree-atlas.ts';
import { skeletonOf, variantScale } from '../src/nature/realistic.ts';

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
    // Constitution cap is still 1,500. The floor is a trunk plus leaf cards, not a voxel shell.
    for (const species of TREE_SPECIES) {
      for (let v = 0; v < VARIANTS; v++) {
        const triangles = buildModel(species, v, 0).indices.length / 3;
        expect(triangles).toBeGreaterThanOrEqual(20);
        expect(triangles).toBeLessThanOrEqual(1500);
      }
    }
    for (const species of BUSH_SPECIES) {
      const triangles = buildModel(species, 0, 0).indices.length / 3;
      expect(triangles).toBeGreaterThanOrEqual(12);
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
        // Constitution caps stay 6,000 / 1,500. Cards replace the old 0.2 m shell, so the floor is lower.
        expect(tris, `species ${s} variant ${v}`).toBeGreaterThan(isBush ? 20 : 60);
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

  it('leaf cards carry uvs and reach the crown', () => {
    for (const s of TREE_SPECIES) {
      const m = buildModel(s, 0, 3);
      expect(m.uvs, `species ${s}`).toBeInstanceOf(Float32Array);
      expect(m.uvs!.length).toBe((m.positions.length / 3) * 2);
      let leaves = 0;
      for (let i = 0; i < m.leaf!.length; i++) if (m.leaf![i]! > 0.5) leaves++;
      expect(leaves / m.leaf!.length, `species ${s}`).toBeGreaterThan(0.4);
      const b = bbox(m);
      expect(b.r, `species ${s}`).toBeGreaterThan(m.radius * 0.7);
      expect(b.h, `species ${s}`).toBeGreaterThan(m.height * 0.75);
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

  it('flowering bushes carry blossom-coloured cards', () => {
    const m = buildModel(SPECIES.BUSH_LILAC, 0, 3);
    // blossom colour: blue channel clearly above green
    let blossom = 0, green = 0;
    for (let i = 0; i < m.colors.length; i += 3) {
      if (m.colors[i + 2]! > m.colors[i + 1]! * 1.15) blossom++;
      else green++;
    }
    expect(blossom).toBeGreaterThan(0);
    expect(green).toBeGreaterThan(0);
    const pink = buildModel(SPECIES.BUSH_PINK, 0, 3);
    let pinkVerts = 0;
    for (let i = 0; i < pink.colors.length; i += 3) {
      if (pink.colors[i]! > pink.colors[i + 1]! && pink.colors[i]! > pink.colors[i + 2]!) pinkVerts++;
    }
    expect(pinkVerts).toBeGreaterThan(0);
  });

  it('near crowns are many small cards, not one crown-sized plane', () => {
    for (const s of TREE_SPECIES) {
      const m = buildModel(s, 0, 3);
      let quads = 0;
      let maxDiag = 0;
      for (let i = 0; i < m.indices.length; i += 6) {
        const a = m.indices[i]!;
        if ((m.leaf?.[a] ?? 0) < 0.5) continue;
        quads++;
        const ids = [m.indices[i]!, m.indices[i + 1]!, m.indices[i + 2]!, m.indices[i + 5]!];
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
        for (const id of ids) {
          x0 = Math.min(x0, m.positions[id * 3]!); x1 = Math.max(x1, m.positions[id * 3]!);
          y0 = Math.min(y0, m.positions[id * 3 + 1]!); y1 = Math.max(y1, m.positions[id * 3 + 1]!);
          z0 = Math.min(z0, m.positions[id * 3 + 2]!); z1 = Math.max(z1, m.positions[id * 3 + 2]!);
        }
        maxDiag = Math.max(maxDiag, Math.hypot(x1 - x0, y1 - y0, z1 - z0));
      }
      expect(quads, `species ${s}`).toBeGreaterThan(80);
      // A crown-sized plane is about as long as the tree is tall. These cards stay shorter than that.
      expect(maxDiag, `species ${s}`).toBeLessThan(m.height * 0.85);
    }
  });

  it('leaf normals fan outward instead of one flat facing', () => {
    const m = buildModel(SPECIES.CHESTNUT, 0, 3);
    let ref: [number, number, number] | null = null;
    let differ = 0;
    let leaves = 0;
    for (let i = 0; i < m.leaf!.length; i++) {
      if (m.leaf![i]! < 0.5) continue;
      const n: [number, number, number] = [m.normals[i * 3]!, m.normals[i * 3 + 1]!, m.normals[i * 3 + 2]!];
      if (ref === null) { ref = n; continue; }
      leaves++;
      const dot = n[0] * ref[0] + n[1] * ref[1] + n[2] * ref[2];
      if (dot < 0.92) differ++;
    }
    expect(differ).toBeGreaterThan(leaves * 0.4);
  });

  it('?renderer=voxel still builds the heavier micro-voxel crown', () => {
    const cards = buildModel(SPECIES.CHESTNUT, 0, 3);
    const voxel = buildModel(SPECIES.CHESTNUT, 0, 3, true);
    expect(cards.uvs).toBeInstanceOf(Float32Array);
    expect(voxel.uvs).toBeUndefined();
    expect(voxel.indices.length).toBeGreaterThan(cards.indices.length);
    expect(voxel.indices.length / 3).toBeLessThanOrEqual(6000);
  });
});

describe('realistic tree models: skeleton, clumps and texture layers', () => {
  const ALL = [...TREE_SPECIES, ...BUSH_SPECIES];
  const isBush = (s: number): boolean => s >= SPECIES.BUSH;
  const LEAF_COLOR: Readonly<Record<number, [number, number, number]>> = {
    [SPECIES.CHESTNUT]: [70, 112, 46],
    [SPECIES.LINDEN]: [88, 130, 56],
    [SPECIES.ACACIA]: [130, 160, 74],
    [SPECIES.POPLAR]: [76, 124, 52],
    [SPECIES.WILLOW]: [140, 168, 98],
    [SPECIES.PINE]: [52, 92, 56],
    [SPECIES.PLANE]: [98, 140, 62],
    [SPECIES.MAPLE]: [82, 128, 54],
    [SPECIES.ELM]: [86, 122, 58],
    [SPECIES.GLEDITSIA]: [120, 150, 70],
    [SPECIES.MULBERRY]: [80, 126, 52],
    [SPECIES.AILANTHUS]: [96, 138, 64],
    [SPECIES.CATALPA]: [132, 176, 82],
    [SPECIES.THUJA]: [48, 86, 48],
    [SPECIES.WALNUT]: [78, 118, 52],
    [SPECIES.BUSH]: [70, 120, 48],
    [SPECIES.BUSH_LILAC]: [74, 116, 52],
    [SPECIES.BUSH_PINK]: [86, 130, 58],
  };

  it('caps triangles per LOD for every species and variant', () => {
    const limits: [0 | 2 | 3, number, number][] = [
      [3, 3000, 500],
      [0, 1200, 200],
      [2, 160, 160],
    ];
    for (const [lod, treeCap, bushCap] of limits) {
      for (const s of ALL) {
        for (let v = 0; v < VARIANTS; v++) {
          const tris = buildModel(s, v, lod).indices.length / 3;
          expect(tris, `species ${s} variant ${v} lod ${lod}`).toBeLessThanOrEqual(isBush(s) ? bushCap : treeCap);
        }
      }
    }
  });

  it('fills dense crowns toward the near budget', () => {
    for (const s of [SPECIES.CHESTNUT, SPECIES.LINDEN, SPECIES.MAPLE, SPECIES.CATALPA]) {
      const tris = buildModel(s, 0, 3).indices.length / 3;
      expect(tris, `species ${s}`).toBeGreaterThanOrEqual(2400);
    }
  });

  it('carries a texture layer for every vertex on every LOD', () => {
    for (const s of ALL) {
      const layers = speciesLayers(s);
      const flowering = s === SPECIES.BUSH_LILAC || s === SPECIES.BUSH_PINK;
      for (let v = 0; v < VARIANTS; v++) {
        for (const lod of [0, 1, 2, 3] as const) {
          const m = buildModel(s, v, lod);
          expect(m.tex, `species ${s} variant ${v} lod ${lod}`).toBeInstanceOf(Float32Array);
          const verts = m.positions.length / 3;
          expect(m.tex!.length).toBe(verts);
          expect(m.leaf, `species ${s} variant ${v} lod ${lod}`).toBeInstanceOf(Float32Array);
          for (let i = 0; i < verts; i++) {
            const t = m.tex![i]!;
            expect(Number.isInteger(t), `species ${s} lod ${lod} vertex ${i}`).toBe(true);
            if (m.leaf![i]! > 0.5) {
              const ok = t === layers.leaf || (flowering && t === LEAF_LAYER.BLOSSOM);
              expect(ok, `species ${s} lod ${lod} vertex ${i} leaf layer ${t}`).toBe(true);
            } else {
              expect(t, `species ${s} lod ${lod} vertex ${i} bark layer`).toBe(layers.bark);
            }
          }
        }
      }
    }
  });

  it('attaches every scaffold and child branch to existing wood', () => {
    const pointSeg = (px: number, py: number, pz: number, a: number[], b: number[]): number => {
      const dx = b[0]! - a[0]!, dy = b[1]! - a[1]!, dz = b[2]! - a[2]!;
      const len2 = dx * dx + dy * dy + dz * dz;
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - a[0]!) * dx + (py - a[1]!) * dy + (pz - a[2]!) * dz) / len2));
      return Math.hypot(px - (a[0]! + dx * t), py - (a[1]! + dy * t), pz - (a[2]! + dz * t));
    };
    for (const s of TREE_SPECIES) {
      const sk = skeletonOf(s, 0);
      const segs: { owner: number; a: number[]; b: number[] }[] = [];
      for (let i = 1; i < sk.trunk.length; i++) {
        const a = sk.trunk[i - 1]!, b = sk.trunk[i]!;
        segs.push({ owner: -1, a: [a.x, a.y, a.z], b: [b.x, b.y, b.z] });
      }
      sk.limbs.forEach((l, li) => {
        for (let i = 1; i < l.points.length; i++) {
          const a = l.points[i - 1]!, b = l.points[i]!;
          segs.push({ owner: li, a: [a.x, a.y, a.z], b: [b.x, b.y, b.z] });
        }
      });
      sk.limbs.forEach((l, li) => {
        if (l.stub) return;
        const p0 = l.points[0]!;
        let best = Infinity;
        for (const seg of segs) {
          if (seg.owner === li) continue;
          best = Math.min(best, pointSeg(p0.x, p0.y, p0.z, seg.a, seg.b));
        }
        expect(best, `species ${s} limb ${li}`).toBeLessThanOrEqual(0.05);
      });
    }
  });

  it('keeps pine wood continuous under the umbrella', () => {
    const m = buildModel(SPECIES.PINE, 0, 3);
    let lowestLeaf = Infinity;
    for (let i = 0; i < m.positions.length; i += 3) {
      if (m.leaf![i / 3]! > 0.5) lowestLeaf = Math.min(lowestLeaf, m.positions[i + 1]!);
    }
    const sk = skeletonOf(SPECIES.PINE, 0);
    const trunkTop = Math.max(...sk.trunk.map((p) => p.y));
    expect(trunkTop).toBeGreaterThanOrEqual(m.height * 0.85);
    // The trunk is continuous from 0 to its top, so wood spans 0.5 h up to the needles.
    for (let y = m.height * 0.5; y < lowestLeaf; y += 0.25) {
      let covered = false;
      for (let i = 1; i < sk.trunk.length; i++) {
        const a = sk.trunk[i - 1]!, b = sk.trunk[i]!;
        if (Math.min(a.y, b.y) <= y && Math.max(a.y, b.y) >= y) covered = true;
      }
      expect(covered, `pine trunk gap at ${y.toFixed(2)} m`).toBe(true);
    }
  });

  it('covers the crown in side view', () => {
    const coverage = (m: VegModel): number => {
      const p = m.positions;
      let minY = Infinity, maxY = -Infinity;
      for (let i = 0; i < p.length; i += 3) {
        if (m.leaf![i / 3]! < 0.5) continue;
        minY = Math.min(minY, p[i + 1]!);
        maxY = Math.max(maxY, p[i + 1]!);
      }
      const R = m.radius;
      const cy = (minY + maxY) * 0.5;
      const halfH = Math.max(0.01, (maxY - minY) * 0.5);
      const cell = 0.25;
      const x0 = -R - cell;
      const y0 = minY - cell;
      const nx = Math.ceil((2 * R) / cell) + 3;
      const ny = Math.ceil((maxY - minY) / cell) + 3;
      const counts = new Uint16Array(nx * ny);
      const inPoly = (px: number, py: number, v: [number, number][]): boolean => {
        let inside = false;
        for (let i = 0, j = v.length - 1; i < v.length; j = i++) {
          const xi = v[i]![0], yi = v[i]![1], xj = v[j]![0], yj = v[j]![1];
          if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
        }
        return inside;
      };
      for (let i = 0; i < m.indices.length; i += 6) {
        const a = m.indices[i]!, b = m.indices[i + 1]!, c = m.indices[i + 2]!, d = m.indices[i + 5]!;
        if (m.leaf![a]! < 0.5) continue;
        const quad: [number, number][] = [
          [p[a * 3]!, p[a * 3 + 1]!],
          [p[b * 3]!, p[b * 3 + 1]!],
          [p[c * 3]!, p[c * 3 + 1]!],
          [p[d * 3]!, p[d * 3 + 1]!],
        ];
        const qx0 = Math.min(...quad.map((q) => q[0]));
        const qx1 = Math.max(...quad.map((q) => q[0]));
        const qy0 = Math.min(...quad.map((q) => q[1]));
        const qy1 = Math.max(...quad.map((q) => q[1]));
        const gx0 = Math.max(0, Math.floor((qx0 - x0) / cell));
        const gx1 = Math.min(nx - 1, Math.ceil((qx1 - x0) / cell));
        const gy0 = Math.max(0, Math.floor((qy0 - y0) / cell));
        const gy1 = Math.min(ny - 1, Math.ceil((qy1 - y0) / cell));
        for (let gy = gy0; gy <= gy1; gy++) {
          for (let gx = gx0; gx <= gx1; gx++) {
            const px = x0 + gx * cell;
            const py = y0 + gy * cell;
            if (inPoly(px, py, quad)) counts[gx + gy * nx]!++;
          }
        }
      }
      let inside = 0, covered = 0;
      for (let gy = 0; gy < ny; gy++) {
        for (let gx = 0; gx < nx; gx++) {
          const px = x0 + gx * cell;
          const py = y0 + gy * cell;
          if ((px / R) ** 2 + ((py - cy) / halfH) ** 2 > 1) continue;
          inside++;
          if (counts[gx + gy * nx]! >= 3) covered++;
        }
      }
      return inside === 0 ? 0 : covered / inside;
    };
    const required: Readonly<Record<number, [number, number]>> = {
      [SPECIES.CHESTNUT]: [0.8, 1],
      [SPECIES.LINDEN]: [0.8, 1],
      [SPECIES.MAPLE]: [0.8, 1],
      [SPECIES.CATALPA]: [0.8, 1],
      [SPECIES.WALNUT]: [0.8, 1],
      [SPECIES.THUJA]: [0.8, 1],
      [SPECIES.POPLAR]: [0.8, 1],
      [SPECIES.PLANE]: [0.6, 1],
      [SPECIES.ELM]: [0.6, 1],
      [SPECIES.MULBERRY]: [0.6, 1],
      [SPECIES.WILLOW]: [0.6, 1],
      [SPECIES.PINE]: [0.6, 1],
      [SPECIES.ACACIA]: [0.4, 0.8],
      [SPECIES.GLEDITSIA]: [0.4, 0.8],
      [SPECIES.AILANTHUS]: [0.4, 0.8],
    };
    for (const s of TREE_SPECIES) {
      const [lo, hi] = required[s]!;
      const f = coverage(buildModel(s, 0, 3));
      expect(f, `species ${s} side coverage ${f.toFixed(3)}`).toBeGreaterThanOrEqual(lo);
      expect(f, `species ${s} side coverage ${f.toFixed(3)}`).toBeLessThanOrEqual(hi);
    }
  });

  it('uses real leaf-card scale', () => {
    for (const s of TREE_SPECIES) {
      const m = buildModel(s, 0, 3);
      const p = m.positions;
      const long = s === SPECIES.WILLOW || s === SPECIES.AILANTHUS || s === SPECIES.WALNUT;
      for (let i = 0; i < m.indices.length; i += 6) {
        const ids = [m.indices[i]!, m.indices[i + 1]!, m.indices[i + 2]!, m.indices[i + 5]!];
        if (m.leaf![ids[0]!]! < 0.5) continue;
        let maxEdge = 0;
        for (let e = 0; e < 4; e++) {
          const a = ids[e]!, b = ids[(e + 1) % 4]!;
          maxEdge = Math.max(maxEdge, Math.hypot(p[a * 3]! - p[b * 3]!, p[a * 3 + 1]! - p[b * 3 + 1]!, p[a * 3 + 2]! - p[b * 3 + 2]!));
        }
        expect(maxEdge, `species ${s}`).toBeLessThanOrEqual(long ? 3.2 : 1.0);
      }
    }
  });

  it('keeps leaf colours bright', () => {
    for (const s of ALL) {
      const m = buildModel(s, 0, 3);
      const base = LEAF_COLOR[s]!;
      const baseSum = (base[0] + base[1] + base[2]) / 255;
      let minSum = Infinity;
      for (let i = 0; i < m.colors.length; i += 3) {
        if (m.leaf![i / 3]! < 0.5) continue;
        minSum = Math.min(minSum, m.colors[i]! + m.colors[i + 1]! + m.colors[i + 2]!);
      }
      expect(minSum, `species ${s}`).toBeGreaterThanOrEqual(baseSum * 0.55);
    }
  });

  it('scaffold limbs reach into the crown', () => {
    for (const s of TREE_SPECIES) {
      if (s === SPECIES.POPLAR || s === SPECIES.THUJA) continue;
      const m = buildModel(s, 0, 3);
      let reach = 0;
      for (let i = 0; i < m.positions.length; i += 3) {
        if (m.leaf![i / 3]! > 0.5) continue;
        reach = Math.max(reach, Math.hypot(m.positions[i]!, m.positions[i + 2]!));
      }
      expect(reach, `species ${s}`).toBeGreaterThanOrEqual(m.radius * 0.6);
    }
  });

  it('airy species carry less leaf area than dense species', () => {
    const density = (s: number): number => {
      const m = buildModel(s, 0, 3);
      let area = 0;
      const p = m.positions;
      for (let i = 0; i < m.indices.length; i += 3) {
        const a = m.indices[i]!, b = m.indices[i + 1]!, c = m.indices[i + 2]!;
        if (m.leaf![a]! < 0.5) continue;
        const ax = p[a * 3]!, ay = p[a * 3 + 1]!, az = p[a * 3 + 2]!;
        const bx = p[b * 3]!, by = p[b * 3 + 1]!, bz = p[b * 3 + 2]!;
        const cx = p[c * 3]!, cy = p[c * 3 + 1]!, cz = p[c * 3 + 2]!;
        const ux = bx - ax, uy = by - ay, uz = bz - az;
        const vx = cx - ax, vy = cy - ay, vz = cz - az;
        area += 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
      }
      return area / (Math.PI * m.radius * m.radius * m.height * 0.6);
    };
    const airy = (density(SPECIES.ACACIA) + density(SPECIES.GLEDITSIA) + density(SPECIES.AILANTHUS)) / 3;
    const dense = (density(SPECIES.CHESTNUT) + density(SPECIES.LINDEN) + density(SPECIES.MAPLE)) / 3;
    expect(airy).toBeLessThan(dense * 0.75);
  });

  it('matches the species silhouette shapes', () => {
    const poplar = buildModel(SPECIES.POPLAR, 0, 3);
    expect(poplar.radius / poplar.height).toBeLessThan(0.15);

    const willow = buildModel(SPECIES.WILLOW, 0, 3);
    let hanging = 0;
    for (let i = 0; i < willow.positions.length; i += 3) {
      if (willow.leaf![i / 3]! < 0.5) continue;
      const y = willow.positions[i + 1]!;
      const r = Math.hypot(willow.positions[i]!, willow.positions[i + 2]!);
      if (y < willow.height * 0.35 && r > willow.radius * 0.6) hanging++;
    }
    expect(hanging).toBeGreaterThan(0);

    const pine = buildModel(SPECIES.PINE, 0, 3);
    for (let i = 0; i < pine.positions.length; i += 3) {
      if (pine.leaf![i / 3]! < 0.5) continue;
      expect(pine.positions[i + 1]!).toBeGreaterThanOrEqual(pine.height * 0.5);
    }

    const thuja = buildModel(SPECIES.THUJA, 0, 3);
    let skirt = 0;
    for (let i = 0; i < thuja.positions.length; i += 3) {
      if (thuja.leaf![i / 3]! < 0.5) continue;
      if (thuja.positions[i + 1]! < thuja.height * 0.15) skirt++;
    }
    expect(skirt).toBeGreaterThan(0);
  });

  it('bakes ambient occlusion into leaf colours', () => {
    for (const s of TREE_SPECIES) {
      const m = buildModel(s, 0, 3);
      let minY = Infinity, maxY = -Infinity;
      for (let i = 0; i < m.positions.length; i += 3) {
        if (m.leaf![i / 3]! < 0.5) continue;
        minY = Math.min(minY, m.positions[i + 1]!);
        maxY = Math.max(maxY, m.positions[i + 1]!);
      }
      const cy = (minY + maxY) * 0.5;
      const halfH = Math.max(0.01, (maxY - minY) * 0.5);
      let inner = 0, innerN = 0, outer = 0, outerN = 0;
      for (let i = 0; i < m.indices.length; i += 6) {
        const ids = [m.indices[i]!, m.indices[i + 1]!, m.indices[i + 2]!, m.indices[i + 5]!];
        if (m.leaf![ids[0]!]! < 0.5) continue;
        let cx = 0, cyv = 0, cz = 0, lum = 0;
        for (const id of ids) {
          cx += m.positions[id * 3]!;
          cyv += m.positions[id * 3 + 1]!;
          cz += m.positions[id * 3 + 2]!;
          lum += 0.2126 * m.colors[id * 3]! + 0.7152 * m.colors[id * 3 + 1]! + 0.0722 * m.colors[id * 3 + 2]!;
        }
        cx /= 4; cyv /= 4; cz /= 4; lum /= 4;
        const d = Math.hypot(cx / m.radius, (cyv - cy) / halfH);
        if (d < 0.55) {
          inner += lum;
          innerN++;
        } else if (d > 0.85) {
          outer += lum;
          outerN++;
        }
      }
      expect(innerN, `species ${s} inner cards`).toBeGreaterThan(0);
      expect(outerN, `species ${s} outer cards`).toBeGreaterThan(0);
      expect(inner / innerN, `species ${s} AO`).toBeLessThan(outer / outerN);
    }
  });

  it('keeps lod 1 and lod 2 a pure uniform scale of variant 0', () => {
    for (const s of ALL) {
      for (let v = 0; v < VARIANTS; v++) {
        const ratio = variantScale(v) / variantScale(0);
        for (const lod of [1, 2] as const) {
          const a = buildModel(s, v, lod).positions;
          const b = buildModel(s, 0, lod).positions;
          expect(a.length, `species ${s} variant ${v} lod ${lod}`).toBe(b.length);
          for (let i = 0; i < a.length; i++) {
            expect(Math.abs(a[i]! - b[i]! * ratio), `species ${s} variant ${v} lod ${lod} index ${i}`).toBeLessThanOrEqual(1e-4);
          }
        }
      }
    }
  });

  it('is deterministic for the new species too', () => {
    for (const s of [SPECIES.MAPLE, SPECIES.GLEDITSIA, SPECIES.THUJA, SPECIES.WALNUT, SPECIES.BUSH_PINK]) {
      const a = buildModel(s, 2, 3);
      const b = buildModel(s, 2, 3);
      expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
      expect(Array.from(a.colors)).toEqual(Array.from(b.colors));
      expect(Array.from(a.tex!)).toEqual(Array.from(b.tex!));
      expect(Array.from(a.indices)).toEqual(Array.from(b.indices));
    }
  });
});

import { describe, expect, it } from 'vitest';
import { MAT, materialColor } from '../src/world/materials';
import { PBR_LAYER_COUNT } from '../src/world/pbr-layers';
import { buildingKey } from '../src/world/osm-ref';
import { OSM_TYPE, ROOF, type VBuilding, type VectorTile } from '../src/world/vector-format';
import { chunkLod, meshNearRadius } from '../src/mesh/bounds';
import { buildChunkMesh } from '../src/mesh/chunk';
import {
  extrudeBuilding, triangleCount, type CityMesh, type ExtrudeBuilding,
} from '../src/mesh/extrude';

function rect(x0: number, z0: number, x1: number, z1: number): [number, number][] {
  return [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
}

function building(partial: Partial<ExtrudeBuilding> = {}): ExtrudeBuilding {
  return {
    id: 7,
    rings: [rect(0, 0, 60, 12)],
    heightM: 15,
    minHeightM: 0,
    levels: 5,
    wall: MAT.WALL_KHRUSH,
    roof: MAT.ROOF_GREY,
    roofShape: ROOF.FLAT,
    groundY: 4,
    ...partial,
  };
}

function near(b: ExtrudeBuilding, roads = [{ pts: [[-10, -5], [70, -5]] as [number, number][], kind: 6 }]): CityMesh {
  return extrudeBuilding(b, 0, 0, { lod: 'near', roads });
}

function mid(b: ExtrudeBuilding): CityMesh {
  return extrudeBuilding(b);
}

function parts(mesh: CityMesh): number[] {
  const out = new Array<number>(mesh.indices.length / 3);
  for (let t = 0; t < out.length; t++) out[t] = mesh.facade[mesh.indices[t * 3]! * 4]!;
  return out;
}

function countPart(mesh: CityMesh, part: number): number {
  return parts(mesh).filter((p) => p === part).length;
}

function vert(mesh: CityMesh, i: number): [number, number, number] {
  return [mesh.positions[i * 3]!, mesh.positions[i * 3 + 1]!, mesh.positions[i * 3 + 2]!];
}

function facadeOf(mesh: CityMesh, i: number): [number, number, number, number] {
  return [mesh.facade[i * 4]!, mesh.facade[i * 4 + 1]!, mesh.facade[i * 4 + 2]!, mesh.facade[i * 4 + 3]!];
}

function metricsOf(mesh: CityMesh): { levels: number; floorH: number; bay: number } {
  for (let i = 0; i < mesh.facade.length / 4; i++) {
    const f = facadeOf(mesh, i);
    if (f[0] === 0 && Math.abs(f[3]) > 0.5) return { levels: f[1], floorH: f[2], bay: f[3] };
  }
  throw new Error('no wall with windows');
}

const frac = (x: number): number => x - Math.floor(x);

function shaderFractions(wall: number, shops: boolean, row: number): { lo: number; hi: number; x0: number; x1: number } {
  let lo = 0.28, hi = 0.78, x0 = 0.22, x1 = 0.78;
  const historic = wall >= MAT.WALL_HISTORIC && wall <= MAT.WALL_HISTORIC_CREAM;
  if (historic || wall === MAT.WALL_STALIN) { lo = 0.18; hi = 0.84; x0 = 0.28; x1 = 0.72; }
  if (wall === MAT.WALL_KHRUSH) { lo = 0.32; hi = 0.72; x0 = 0.18; x1 = 0.82; }
  if (wall === MAT.WALL_PANEL) { lo = 0.30; hi = 0.74; x0 = 0.16; x1 = 0.84; }
  if (shops && row === 0) { lo = 0.12; hi = 0.92; x0 = 0.08; x1 = 0.92; }
  if (wall === MAT.WALL_MODERN) { x0 = 0.06; x1 = 0.94; lo = 0.22; hi = 0.78; }
  return { lo, hi, x0, x1 };
}

describe('near-LOD triangle budgets', () => {
  it('keeps a 60 x 12 m five-storey khrushchevka under 3,000 triangles', () => {
    const b = building();
    expect(triangleCount(near(b))).toBeLessThanOrEqual(3000);
    expect(triangleCount(near(b))).toBeGreaterThan(500);
  });

  it('keeps a 20 x 12 m three-storey historic building under 1,500 triangles', () => {
    const b = building({
      id: 9, rings: [rect(0, 0, 20, 12)], heightM: 10.8, levels: 3,
      wall: MAT.WALL_HISTORIC, roof: MAT.ROOF_RED,
    });
    expect(triangleCount(near(b, []))).toBeLessThanOrEqual(1500);
    expect(triangleCount(near(b, []))).toBeGreaterThan(300);
  });

  it('keeps mid output within 10% of the old count', () => {
    // The legacy extrusion produced 26 triangles for both footprints (flat roof + parapet).
    expect(triangleCount(mid(building()))).toBeLessThanOrEqual(Math.ceil(26 * 1.1));
    expect(triangleCount(mid(building({ wall: MAT.WALL_HISTORIC, roof: MAT.ROOF_RED }))))
      .toBeLessThanOrEqual(Math.ceil(26 * 1.1));
  });
});

describe('near-LOD window grid', () => {
  for (const [name, wall, heightM, levels] of [
    ['khrush', MAT.WALL_KHRUSH, 15, 5],
    ['panel', MAT.WALL_PANEL, 14, 5],
    ['historic', MAT.WALL_HISTORIC, 10.8, 3],
  ] as const) {
    it(`puts every ${name} glass quad centre inside a shader window`, () => {
      const b = building({ wall, heightM, levels });
      const mesh = near(b);
      const m = metricsOf(mesh);
      const shops = wall === MAT.WALL_HISTORIC;
      let glass = 0;
      for (let t = 0; t < mesh.indices.length; t += 3) {
        const i0 = mesh.indices[t]!;
        const i1 = mesh.indices[t + 1]!;
        const i2 = mesh.indices[t + 2]!;
        if (facadeOf(mesh, i0)[0] !== 5) continue;
        glass++;
        const u = (mesh.uvs[i0 * 2]! + mesh.uvs[i1 * 2]! + mesh.uvs[i2 * 2]!) / 3;
        const v = (mesh.uvs[i0 * 2 + 1]! + mesh.uvs[i1 * 2 + 1]! + mesh.uvs[i2 * 2 + 1]!) / 3;
        const row = Math.floor(v / m.floorH);
        const f = shaderFractions(wall, shops, row);
        const fx = frac(u / m.bay);
        const fy = frac(v / m.floorH);
        expect(fx).toBeGreaterThanOrEqual(f.x0 - 1e-4);
        expect(fx).toBeLessThanOrEqual(f.x1 + 1e-4);
        expect(fy).toBeGreaterThanOrEqual(f.lo - 1e-4);
        expect(fy).toBeLessThanOrEqual(f.hi + 1e-4);
      }
      expect(glass).toBeGreaterThan(10);
    });
  }
});

describe('near-LOD end walls and facade flags', () => {
  it('makes khrushchevka gable ends windowless in near and bay 0 in mid', () => {
    const b = building();
    const n = near(b);
    let nearEndGlass = 0;
    let nearEndBay = 0;
    for (let i = 0; i < n.positions.length / 3; i++) {
      const p = vert(n, i);
      const f = facadeOf(n, i);
      const nx = Math.abs(n.normals[i * 3]!);
      if ((p[0] < 0.05 || p[0] > 59.95) && nx > 0.7) {
        if (f[0] === 5) nearEndGlass++;
        if (f[0] === 0 && Math.abs(f[3]) > 0.5) nearEndBay++;
      }
    }
    expect(nearEndGlass).toBe(0);
    expect(nearEndBay).toBe(0);

    const m = mid(b);
    let sawEnd = false;
    for (let i = 0; i < m.positions.length / 3; i++) {
      const p = vert(m, i);
      const f = facadeOf(m, i);
      if ((p[0] < 0.05 || p[0] > 59.95) && Math.abs(m.normals[i * 3]!) > 0.7 && f[0] === 0) {
        expect(f[3]).toBe(0);
        sawEnd = true;
      }
    }
    expect(sawEnd).toBe(true);
  });

  it('marks near wall faces with real windows with a negative bay', () => {
    const n = near(building());
    let positive = 0;
    let negative = 0;
    for (let i = 0; i < n.positions.length / 3; i++) {
      const f = facadeOf(n, i);
      if (f[0] !== 0) continue;
      if (f[3] < -0.5) negative++;
      if (f[3] > 0.5) positive++;
    }
    expect(negative).toBeGreaterThan(0);
    expect(positive).toBe(0); // windowless gable ends carry bay 0, never the shader grid
  });
});

describe('near-LOD materials', () => {
  it('carries one valid pbr layer per vertex', () => {
    const mesh = near(building());
    const nv = mesh.positions.length / 3;
    expect(mesh.pbr.length).toBe(nv);
    for (const p of mesh.pbr) {
      expect(Number.isInteger(p)).toBe(true);
      expect(p === -1 || (p >= 0 && p < PBR_LAYER_COUNT)).toBe(true);
    }
  });

  it('uses v3 building:colour and roof:colour when present', () => {
    const plain = near(building());
    const tinted = near(building({ colour: 0x203040 + 1, roofColour: 0x804020 + 1 }));
    const wall = (m: CityMesh): [number, number, number] => {
      for (let i = 0; i < m.positions.length / 3; i++) {
        if (facadeOf(m, i)[0] === 0) return [m.colors[i * 3]!, m.colors[i * 3 + 1]!, m.colors[i * 3 + 2]!];
      }
      throw new Error('no wall');
    };
    const w0 = wall(plain);
    const w1 = wall(tinted);
    expect(w1).not.toEqual(w0);
    // 0x20 / 0x30 / 0x40, scaled by the same small deterministic jitter.
    expect(w1[0] / w1[1]).toBeCloseTo(0x20 / 0x30, 3);
    expect(w1[1] / w1[2]).toBeCloseTo(0x30 / 0x40, 3);
  });

  it('is byte-identical when built twice', () => {
    const a = near(building());
    const b = near(building());
    for (const key of ['positions', 'normals', 'uvs', 'colors', 'facade', 'style', 'pbr', 'indices'] as const) {
      expect(Array.from(a[key])).toEqual(Array.from(b[key]));
    }
  });
});

describe('hidden buildings', () => {
  function vb(id: number, x0: number, z0: number, x1: number, z1: number, osmType?: number): VBuilding {
    const ring = new Int32Array([x0 * 100, z0 * 100, x1 * 100, z0 * 100, x1 * 100, z1 * 100, x0 * 100, z1 * 100]);
    return {
      id, rings: [ring], heightCm: 1200, minHeightCm: 0, levels: 4,
      wall: MAT.WALL_KHRUSH, roof: MAT.ROOF_GREY, roofShape: ROOF.FLAT, name: -1,
      ...(osmType !== undefined ? { osmType } : {}),
    };
  }
  function tile(buildings: VBuilding[]): VectorTile {
    return { rx: 0, rz: 0, strings: [], buildings, roads: [], areas: [], lines: [], points: [] };
  }

  it('emits nothing for a hidden key but keeps the others', () => {
    const a = vb(1, 4, 4, 20, 16);
    const b = vb(2, 30, 4, 46, 16);
    const tiles = [tile([a, b])];
    const all = buildChunkMesh(tiles, 0, 0, () => 6, undefined, { lod: 'near' });
    const hidden = buildChunkMesh(tiles, 0, 0, () => 6, undefined,
      { lod: 'near', hidden: new Set([buildingKey(1)]) });
    const onlyB = buildChunkMesh([tile([b])], 0, 0, () => 6, undefined, { lod: 'near' });
    expect(triangleCount(hidden)).toBe(triangleCount(onlyB));
    expect(triangleCount(hidden)).toBeLessThan(triangleCount(all));
  });

  it('treats way and relation ids as distinct keys', () => {
    const way = vb(5, 4, 4, 20, 16);
    const rel = vb(5, 30, 4, 46, 16, OSM_TYPE.RELATION);
    const tiles = [tile([way, rel])];
    const hiddenWay = buildChunkMesh(tiles, 0, 0, () => 6, undefined,
      { lod: 'near', hidden: new Set([buildingKey(5)]) });
    expect(triangleCount(hiddenWay)).toBeGreaterThan(0);
    expect(buildingKey(5)).not.toBe(buildingKey(5, OSM_TYPE.RELATION));
    expect(buildingKey(5)).toBe('w5');
    expect(buildingKey(5, OSM_TYPE.RELATION)).toBe('r5');
  });
});

describe('near-LOD bounds', () => {
  it('stays within 1.4 m outside the footprint and below the roof top', () => {
    const b = building();
    const mesh = near(b);
    const top = b.groundY + b.heightM;
    for (let i = 0; i < mesh.positions.length / 3; i++) {
      const p = vert(mesh, i);
      expect(p[0]).toBeGreaterThanOrEqual(-1.4);
      expect(p[0]).toBeLessThanOrEqual(60 + 1.4);
      expect(p[2]).toBeGreaterThanOrEqual(-1.4);
      expect(p[2]).toBeLessThanOrEqual(12 + 1.4);
      expect(p[1]).toBeLessThanOrEqual(top + 0.5);
    }
  });
});

describe('near-LOD entrances and balconies', () => {
  it('puts the entrance on the long edge nearest a road and balconies opposite', () => {
    const mesh = near(building());
    let doorVertices = 0;
    let balconyFront = 0;
    for (let t = 0; t < mesh.indices.length; t += 3) {
      const part = facadeOf(mesh, mesh.indices[t]!)[0];
      for (const i of [mesh.indices[t]!, mesh.indices[t + 1]!, mesh.indices[t + 2]!]) {
        const p = vert(mesh, i);
        if (part === 7) {
          doorVertices++;
          expect(p[2]).toBeLessThan(0.6); // south long edge (road at z = -5)
        }
        if (part === 4 && p[2] > 12.05) balconyFront++;
      }
    }
    expect(doorVertices).toBeGreaterThan(0);
    expect(balconyFront).toBeGreaterThan(0);
  });
});

describe('near LOD radius and hysteresis', () => {
  it('is 100 m on a desktop, 50 m on a phone and off on Low', () => {
    expect(meshNearRadius('high', false)).toBe(100);
    expect(meshNearRadius('high', true)).toBe(50);
    expect(meshNearRadius('low', false)).toBe(0);
    expect(meshNearRadius('low', true)).toBe(0);
  });

  it('has a 32 m hysteresis band', () => {
    expect(chunkLod(0, null, 100)).toBe('near');
    expect(chunkLod(100, null, 100)).toBe('near');
    expect(chunkLod(100.1, null, 100)).toBe('mid');
    expect(chunkLod(120, 'near', 100)).toBe('near');
    expect(chunkLod(132, 'near', 100)).toBe('near');
    expect(chunkLod(132.1, 'near', 100)).toBe('mid');
    expect(chunkLod(50, 'mid', 100)).toBe('near');
    expect(chunkLod(0, 'near', 0)).toBe('mid');
    expect(chunkLod(0, null, 0)).toBe('mid');
  });
});

describe('near colour helpers', () => {
  it('keeps the material wall colour when v3 has no colour', () => {
    const mesh = near(building({ wall: MAT.WALL_PANEL }));
    const base = materialColor(MAT.WALL_PANEL);
    let found = false;
    for (let i = 0; i < mesh.positions.length / 3; i++) {
      if (facadeOf(mesh, i)[0] !== 0) continue;
      const s = mesh.colors[i * 3]! / base[0];
      expect(mesh.colors[i * 3]! / base[0]).toBeCloseTo(s, 5);
      expect(mesh.colors[i * 3 + 1]! / base[1]).toBeCloseTo(s, 5);
      found = true;
      break;
    }
    expect(found).toBe(true);
  });
});

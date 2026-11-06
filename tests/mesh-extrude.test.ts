import { describe, expect, it } from 'vitest';
import { MAT } from '../src/world/materials';
import { PBR_LAYER_COUNT } from '../src/world/pbr-layers';
import { ROOF, type VBuilding, type VectorTile } from '../src/world/vector-format';
import { chunkInMeshRadius, meshViewRadius } from '../src/mesh/bounds';
import { buildingsInChunk, buildChunkMesh } from '../src/mesh/chunk';
import {
  extrudeBuilding, facadeMetrics, meshByteSize, roofKindOf, triangleCount, type CityMesh, type ExtrudeBuilding,
} from '../src/mesh/extrude';

function rect(x0: number, z0: number, x1: number, z1: number): [number, number][] {
  return [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
}

function building(partial: Partial<ExtrudeBuilding> = {}): ExtrudeBuilding {
  return {
    id: 7,
    rings: [rect(0, 0, 10, 6)],
    heightM: 12,
    minHeightM: 0,
    levels: 4,
    wall: MAT.WALL_KHRUSH,
    roof: MAT.ROOF_GREY,
    roofShape: ROOF.FLAT,
    groundY: 4,
    ...partial,
  };
}

function vert(mesh: CityMesh, i: number): [number, number, number] {
  return [mesh.positions[i * 3]!, mesh.positions[i * 3 + 1]!, mesh.positions[i * 3 + 2]!];
}

function normal(mesh: CityMesh, i: number): [number, number, number] {
  return [mesh.normals[i * 3]!, mesh.normals[i * 3 + 1]!, mesh.normals[i * 3 + 2]!];
}

function facadeOf(mesh: CityMesh, i: number): [number, number, number, number] {
  return [mesh.facade[i * 4]!, mesh.facade[i * 4 + 1]!, mesh.facade[i * 4 + 2]!, mesh.facade[i * 4 + 3]!];
}

function assertMesh(mesh: CityMesh): void {
  const nv = mesh.positions.length / 3;
  expect(mesh.positions.length % 3).toBe(0);
  expect(mesh.normals.length).toBe(nv * 3);
  expect(mesh.uvs.length).toBe(nv * 2);
  expect(mesh.colors.length).toBe(nv * 3);
  expect(mesh.facade.length).toBe(nv * 4);
  expect(mesh.style.length).toBe(nv);
  expect(mesh.pbr.length).toBe(nv);
  expect(mesh.indices.length % 3).toBe(0);
  for (let i = 0; i < nv; i++) {
    const n = normal(mesh, i);
    const len = Math.hypot(n[0], n[1], n[2]);
    expect(len).toBeGreaterThan(0.99);
    expect(len).toBeLessThan(1.01);
    for (const c of [mesh.positions[i * 3]!, mesh.positions[i * 3 + 1]!, mesh.positions[i * 3 + 2]!]) {
      expect(Number.isFinite(c)).toBe(true);
    }
  }
  for (let k = 0; k < mesh.indices.length; k++) {
    expect(mesh.indices[k]!).toBeGreaterThanOrEqual(0);
    expect(mesh.indices[k]!).toBeLessThan(nv);
  }
}

function maxY(mesh: CityMesh): number {
  let y = -Infinity;
  for (let i = 1; i < mesh.positions.length; i += 3) y = Math.max(y, mesh.positions[i]!);
  return y;
}

function minY(mesh: CityMesh): number {
  let y = Infinity;
  for (let i = 1; i < mesh.positions.length; i += 3) y = Math.min(y, mesh.positions[i]!);
  return y;
}

/** Vertices whose xz lies on the edge z = z0 (the south wall of an axis-aligned box). */
function southNormals(mesh: CityMesh, z0: number): number[] {
  const out: number[] = [];
  const nv = mesh.positions.length / 3;
  for (let i = 0; i < nv; i++) {
    const p = vert(mesh, i);
    const n = normal(mesh, i);
    // vertical faces only (the wall and the parapet), not the roof cap
    if (Math.abs(p[2] - z0) < 0.05 && Math.abs(n[1]) < 0.2) out.push(n[2]);
  }
  return out;
}

describe('extrudeBuilding', () => {
  it('builds a flat roof at the tagged height, with a skirt into the ground and outward walls', () => {
    const mesh = extrudeBuilding(building());
    assertMesh(mesh);
    expect(triangleCount(mesh)).toBeGreaterThan(8);
    expect(triangleCount(mesh)).toBeLessThan(80);
    expect(maxY(mesh)).toBeCloseTo(16, 5); // ground 4 + height 12, parapet top
    let roofUp = 0;
    let roofDown = 0;
    for (let t = 0; t < mesh.indices.length; t += 3) {
      if (facadeOf(mesh, mesh.indices[t]!)[0] !== 1) continue;
      const a = vert(mesh, mesh.indices[t]!);
      const b = vert(mesh, mesh.indices[t + 1]!);
      const c = vert(mesh, mesh.indices[t + 2]!);
      const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
      if (ny > 0) roofUp++;
      else if (ny < 0) roofDown++;
    }
    expect(roofUp).toBeGreaterThan(0);
    expect(roofDown).toBe(0);
    expect(minY(mesh)).toBeCloseTo(3.6, 5); // 0.4 m skirt
    const nz = southNormals(mesh, 0);
    expect(nz.some((z) => z < -0.5)).toBe(true);
    expect(nz.some((z) => z > 0.5)).toBe(false);
    const wall = [...Array(mesh.positions.length / 3).keys()].find((i) => facadeOf(mesh, i)[0] === 0 && facadeOf(mesh, i)[3] > 0);
    expect(wall).toBeDefined();
    const f = facadeOf(mesh, wall!);
    expect(f[1]).toBeCloseTo(4); // explicit levels
    expect(f[2]).toBeGreaterThan(2.4);
    expect(f[2]).toBeLessThan(3.6);
    expect(f[3]).toBeCloseTo(4); // khrushchevka bay
  });

  it('is unchanged when the ring is wound the other way', () => {
    const cw = extrudeBuilding(building({ rings: [[[10, 0], [0, 0], [0, 6], [10, 6]]] }));
    const ccw = extrudeBuilding(building());
    expect(maxY(cw)).toBeCloseTo(maxY(ccw), 5);
    const nz = southNormals(cw, 0);
    expect(nz.some((z) => z < -0.5)).toBe(true);
    expect(nz.some((z) => z > 0.5)).toBe(false);
  });

  it('tiles the wall: UVs span the edge length', () => {
    const mesh = extrudeBuilding(building());
    const us: number[] = [];
    const nv = mesh.positions.length / 3;
    for (let i = 0; i < nv; i++) {
      const p = vert(mesh, i);
      if (Math.abs(p[2]) < 0.05 && facadeOf(mesh, i)[0] === 0) us.push(mesh.uvs[i * 2]!);
    }
    expect(Math.max(...us) - Math.min(...us)).toBeCloseTo(10, 4);
  });

  it('raises a gable ridge to the tagged height and keeps the eaves lower', () => {
    const mesh = extrudeBuilding(building({ wall: MAT.WALL_HOUSE, roof: MAT.ROOF_RED, roofShape: ROOF.GABLED, levels: 2, heightM: 8 }));
    assertMesh(mesh);
    expect(maxY(mesh)).toBeCloseTo(12, 4);
    let eave = Infinity;
    const nv = mesh.positions.length / 3;
    for (let i = 0; i < nv; i++) {
      if (facadeOf(mesh, i)[0] !== 0) continue;
      const y = vert(mesh, i)[1];
      if (y > 4 && y < maxY(mesh) - 0.2) eave = Math.min(eave, y);
    }
    expect(eave).toBeLessThan(maxY(mesh) - 0.8);
    expect(triangleCount(mesh)).toBeLessThan(80);
  });

  it('builds a hip, a pyramid and a skillion without holes or NaNs', () => {
    for (const roofShape of [ROOF.HIPPED, ROOF.PYRAMIDAL, ROOF.SKILLION]) {
      const mesh = extrudeBuilding(building({ roofShape, wall: MAT.WALL_HOUSE, levels: 2, heightM: 8 }));
      assertMesh(mesh);
      expect(maxY(mesh)).toBeCloseTo(12, 3);
      expect(triangleCount(mesh)).toBeGreaterThan(6);
    }
  });

  it('puts a dome on a church and keeps it above the eaves', () => {
    const mesh = extrudeBuilding(building({
      wall: MAT.WALL_CHURCH, roof: MAT.ROOF_GOLD, roofShape: ROOF.DOME, levels: 1, heightM: 16,
      rings: [rect(0, 0, 18, 14)],
    }));
    assertMesh(mesh);
    expect(maxY(mesh)).toBeGreaterThan(4 + 16 - 0.2);
    const roofs = [...Array(mesh.style.length).keys()].filter((i) => facadeOf(mesh, i)[0] === 1);
    expect(roofs.length).toBeGreaterThan(10);
  });

  it('leaves a courtyard open and extrudes the inner wall', () => {
    const mesh = extrudeBuilding(building({
      rings: [rect(0, 0, 30, 30), [[10, 10], [10, 20], [20, 20], [20, 10]]],
      heightM: 10, levels: 3,
    }));
    assertMesh(mesh);
    const nv = mesh.positions.length / 3;
    let inner = 0;
    for (let i = 0; i < nv; i++) {
      const p = vert(mesh, i);
      if (Math.abs(p[0] - 10) < 0.05 && p[2] >= 10 && p[2] <= 20) inner++;
    }
    expect(inner).toBeGreaterThan(0);
    // no roof triangle covers the hole centre
    for (let t = 0; t < mesh.indices.length; t += 3) {
      const a = vert(mesh, mesh.indices[t]!);
      const b = vert(mesh, mesh.indices[t + 1]!);
      const c = vert(mesh, mesh.indices[t + 2]!);
      if (facadeOf(mesh, mesh.indices[t]!)[0] !== 1) continue;
      if (pointInTri(15, 15, a, b, c)) throw new Error('roof covers the courtyard');
    }
  });

  it('honours min_height and derives storeys when levels are missing', () => {
    const raised = extrudeBuilding(building({ minHeightM: 4, heightM: 14, levels: 3 }));
    expect(minY(raised)).toBeCloseTo(8, 4); // ground 4 + min_height 4, floating: no skirt
    expect(maxY(raised)).toBeCloseTo(18, 4);
    const guessed = extrudeBuilding(building({ levels: 0, heightM: 9 }));
    const i = [...Array(guessed.facade.length / 4).keys()].find((k) => facadeOf(guessed, k)[0] === 0 && facadeOf(guessed, k)[3] > 0)!;
    expect(facadeOf(guessed, i)[1]).toBeGreaterThanOrEqual(2);
    expect(facadeOf(guessed, i)[1]).toBeLessThanOrEqual(4);
  });

  it('does not cut windows into a garage', () => {
    const mesh = extrudeBuilding(building({ wall: MAT.WALL_GARAGE, levels: 1, heightM: 3 }));
    const bays = new Set<number>();
    for (let i = 0; i < mesh.style.length; i++) if (facadeOf(mesh, i)[0] === 0) bays.add(facadeOf(mesh, i)[3]);
    expect([...bays]).toEqual([0]);
  });

  it('is deterministic', () => {
    const a = extrudeBuilding(building({ roofShape: ROOF.GABLED, wall: MAT.WALL_HOUSE }));
    const b = extrudeBuilding(building({ roofShape: ROOF.GABLED, wall: MAT.WALL_HOUSE }));
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
    expect(Array.from(a.indices)).toEqual(Array.from(b.indices));
    expect(Array.from(a.uvs)).toEqual(Array.from(b.uvs));
    expect(meshByteSize(a)).toBeGreaterThan(0);
  });

  it('writes a valid pbr layer on every vertex and includes it in the byte size', () => {
    const mesh = extrudeBuilding(building({ material: 2, roofMaterial: 3 }));
    expect(mesh.pbr.length).toBe(mesh.positions.length / 3);
    for (const p of mesh.pbr) {
      expect(Number.isInteger(p)).toBe(true);
      expect(p === -1 || (p >= 0 && p < PBR_LAYER_COUNT)).toBe(true);
    }
    expect(meshByteSize(mesh)).toBe(
      mesh.positions.byteLength + mesh.normals.byteLength + mesh.uvs.byteLength
      + mesh.colors.byteLength + mesh.facade.byteLength + mesh.style.byteLength
      + mesh.pbr.byteLength + mesh.indices.byteLength,
    );
  });

  it('skips a degenerate footprint', () => {
    const mesh = extrudeBuilding(building({ rings: [[[0, 0], [0.1, 0], [0.1, 0.1]]] }));
    expect(triangleCount(mesh)).toBe(0);
  });
});

describe('facade metrics and roof choice', () => {
  it('uses explicit levels and the style bay', () => {
    const m = facadeMetrics(MAT.WALL_PANEL, 28, 9);
    expect(m.levels).toBe(9);
    expect(m.floorH).toBeCloseTo(28 / 9, 5);
    expect(m.bay).toBeCloseTo(3);
    expect(facadeMetrics(MAT.WALL_GARAGE, 3, 1).bay).toBe(0);
  });

  it('picks the roof from the tag, then the house heuristic, and keeps courtyards flat', () => {
    expect(roofKindOf(MAT.WALL_PANEL, ROOF.FLAT, false)).toBe('flat');
    expect(roofKindOf(MAT.WALL_HOUSE, ROOF.FLAT, false)).toBe('gable');
    expect(roofKindOf(MAT.WALL_HOUSE, ROOF.HIPPED, false)).toBe('hip');
    expect(roofKindOf(MAT.WALL_CHURCH, ROOF.FLAT, false)).toBe('dome');
    expect(roofKindOf(MAT.WALL_HOUSE, ROOF.GABLED, true)).toBe('flat');
  });
});

describe('chunk ownership', () => {
  const box = { x0: 0, z0: 0, x1: 200, z1: 200 };

  function vb(id: number, x0: number, z0: number, x1: number, z1: number): VBuilding {
    const ring = new Int32Array([x0 * 100, z0 * 100, x1 * 100, z0 * 100, x1 * 100, z1 * 100, x0 * 100, z1 * 100]);
    return {
      id, rings: [ring], heightCm: 1200, minHeightCm: 0, levels: 4,
      wall: MAT.WALL_KHRUSH, roof: MAT.ROOF_GREY, roofShape: ROOF.FLAT, name: -1,
    };
  }

  function tile(buildings: VBuilding[]): VectorTile {
    return { rx: 0, rz: 0, strings: [], buildings, roads: [], areas: [], lines: [], points: [] };
  }

  it('emits only the building whose centroid lies in the chunk and in the box', () => {
    // centroids at (20, 10) → chunk (0, 0); (90, 10) → chunk (1, 0); (300, 10) outside the box
    const tiles = [tile([vb(1, 10, 4, 30, 16), vb(2, 80, 4, 100, 16), vb(3, 290, 4, 310, 16)])];
    const owned = buildingsInChunk(tiles, 0, 0, () => 6, box);
    expect(owned.map((b) => b.id)).toEqual([1]);
    expect(owned[0]!.groundY).toBe(6);
    const mesh = buildChunkMesh(tiles, 1, 0, () => 6, box);
    assertMesh(mesh);
    expect(triangleCount(mesh)).toBeGreaterThan(0);
    // chunk-local: world x 80 is 80 - 64
    let saw = false;
    for (let i = 0; i < mesh.positions.length; i += 3) if (Math.abs(mesh.positions[i]! - (80 - 64)) < 0.05) saw = true;
    expect(saw).toBe(true);
    expect(triangleCount(buildChunkMesh(tiles, 4, 0, () => 6, box))).toBe(0);
  });

  it('without a box, meshes the building in whatever chunk holds its centroid', () => {
    const tiles = [tile([vb(3, 290, 4, 310, 16)])];
    const gcx = Math.floor(300 / 64);
    expect(buildingsInChunk(tiles, gcx, 0, () => 6).map((b) => b.id)).toEqual([3]);
    expect(buildingsInChunk(tiles, 0, 0, () => 6)).toEqual([]);
  });
});

describe('mesh radius', () => {
  it('is the full view on a laptop and the shorter view on a phone or Low', () => {
    expect(meshViewRadius('high', false)).toBe(640);
    expect(meshViewRadius('low', false)).toBe(384);
    expect(meshViewRadius('high', true)).toBe(384);
  });

  it('includes the chunk under the camera and not the far corner of the map', () => {
    const [gx, gz] = chunkOf(10293, 8817);
    expect(chunkInMeshRadius(10293, 8817, gx, gz, 640)).toBe(true);
    expect(chunkInMeshRadius(10293, 8817, 0, 0, 640)).toBe(false);
    const far = chunkOf(10293 + 500, 8817);
    expect(chunkInMeshRadius(10293, 8817, far[0], far[1], 384)).toBe(false);
    expect(chunkInMeshRadius(10293, 8817, far[0], far[1], 640)).toBe(true);
  });
});

function chunkOf(x: number, z: number): [number, number] {
  return [Math.floor(x / 64), Math.floor(z / 64)];
}

function pointInTri(x: number, z: number, a: [number, number, number], b: [number, number, number], c: [number, number, number]): boolean {
  const sign = (px: number, pz: number, q: [number, number, number], r: [number, number, number]) =>
    (px - r[0]) * (q[2] - r[2]) - (q[0] - r[0]) * (pz - r[2]);
  const d1 = sign(x, z, a, b);
  const d2 = sign(x, z, b, c);
  const d3 = sign(x, z, c, a);
  const neg = d1 < -1e-6 || d2 < -1e-6 || d3 < -1e-6;
  const pos = d1 > 1e-6 || d2 > 1e-6 || d3 > 1e-6;
  return !(neg && pos);
}

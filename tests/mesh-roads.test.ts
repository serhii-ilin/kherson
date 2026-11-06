import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { MAT } from '../src/world/materials';
import {
  ROAD,
  ROAD_BRIDGE,
  ROAD_SIDEWALK,
  ROAD_UNPAVED,
  SURFACE,
  type VRoad,
  type VectorTile,
} from '../src/world/vector-format';
import { CHUNK_M, distToChunk, regionKey } from '../src/world/stream-math';
import type { Manifest } from '../src/world/manifest';
import type { WorldStreamer } from '../src/world/streamer';
import {
  ROAD_MARKING_LIFT,
  ROAD_RIBBON_LIFT,
  buildRoadRibbons,
  type RoadMesh,
} from '../src/mesh/roads';
import { MeshStreamer } from '../src/mesh/streamer';
import type { CityMeshRequest, CityMeshResponse } from '../src/mesh/protocol';

// ---------------------------------------------------------------- fixtures

function road(
  pts: ReadonlyArray<readonly [number, number]>,
  widthM: number,
  opts: {
    kind?: number; flags?: number; lanes?: number; layer?: number; surface?: number; name?: number;
  } = {},
): VRoad {
  const flat = new Int32Array(pts.length * 2);
  for (let i = 0; i < pts.length; i++) {
    flat[i * 2] = Math.round(pts[i]![0] * 100);
    flat[i * 2 + 1] = Math.round(pts[i]![1] * 100);
  }
  return {
    pts: flat,
    kind: opts.kind ?? ROAD.RESIDENTIAL,
    flags: opts.flags ?? 0,
    widthCm: Math.round(widthM * 100),
    lanes: opts.lanes ?? 2,
    layer: opts.layer ?? 0,
    name: opts.name ?? -1,
    ...(opts.surface !== undefined ? { surface: opts.surface } : {}),
  };
}

function tile(roads: VRoad[], rx = 0, rz = 0): VectorTile {
  return { rx, rz, strings: [], buildings: [], roads, areas: [], lines: [], points: [] };
}

const flat = (): number => 4;

function build(roads: VRoad[], gcx = 0, gcz = 0, ground: (x: number, z: number) => number = flat): RoadMesh {
  return buildRoadRibbons([tile(roads)], gcx, gcz, ground);
}

function verticesOf(mesh: RoadMesh, mat?: number): Array<[number, number, number, number]> {
  const out: Array<[number, number, number, number]> = [];
  for (let i = 0; i < mesh.positions.length / 3; i++) {
    const m = mesh.walls[i * 4]!;
    if (mat !== undefined && m !== mat) continue;
    out.push([mesh.positions[i * 3]!, mesh.positions[i * 3 + 1]!, mesh.positions[i * 3 + 2]!, m]);
  }
  return out;
}

function matCount(mesh: RoadMesh, mat: number): number {
  return verticesOf(mesh, mat).length;
}

function inside(x: number, z: number, ax: number, az: number, bx: number, bz: number, cx: number, cz: number): boolean {
  const d1 = (x - bx) * (az - bz) - (ax - bx) * (z - bz);
  const d2 = (x - cx) * (bz - cz) - (bx - cx) * (z - cz);
  const d3 = (x - ax) * (cz - az) - (cx - ax) * (z - az);
  const neg = d1 < -1e-9 || d2 < -1e-9 || d3 < -1e-9;
  const pos = d1 > 1e-9 || d2 > 1e-9 || d3 > 1e-9;
  return !(neg && pos);
}

/** Any triangle of `mat` (or any material when omitted) contains (x, z). Edges count. */
function covers(mesh: RoadMesh, x: number, z: number, mat?: number): boolean {
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const i0 = mesh.indices[t]!;
    const i1 = mesh.indices[t + 1]!;
    const i2 = mesh.indices[t + 2]!;
    if (mat !== undefined && mesh.walls[i0 * 4] !== mat) continue;
    if (inside(
      x, z,
      mesh.positions[i0 * 3]!, mesh.positions[i0 * 3 + 2]!,
      mesh.positions[i1 * 3]!, mesh.positions[i1 * 3 + 2]!,
      mesh.positions[i2 * 3]!, mesh.positions[i2 * 3 + 2]!,
    )) return true;
  }
  return false;
}

// ---------------------------------------------------------------- width

describe('road ribbons: width', () => {
  it('is widthCm wide on a straight road', () => {
    const mesh = build([road([[-10, 32], [75, 32]], 8)]);
    const pts = verticesOf(mesh, MAT.ASPHALT);
    const zs = pts.map((p) => p[2]);
    expect(Math.min(...zs)).toBeCloseTo(28, 2);
    expect(Math.max(...zs)).toBeCloseTo(36, 2);
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(8, 2);
  });

  it('is widthCm wide on a 45 degree road', () => {
    const mesh = build([road([[-20, -20], [85, 85]], 8)]);
    const pts = verticesOf(mesh, MAT.ASPHALT);
    // projection on the normal to (1, 1): (-1, 1) / sqrt(2)
    const proj = pts.map((p) => (-p[0] + p[2]) / Math.SQRT2);
    expect(Math.max(...proj) - Math.min(...proj)).toBeCloseTo(8, 2);
  });

  it('keeps a mitred corner without a gap', () => {
    const mesh = build([road([[10, 32], [32, 32], [32, 54]], 8)]);
    // radius 3 around the inside of the bend is well inside the 8 m carriageway
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const x = 32 + Math.cos(a) * 3;
      const z = 32 + Math.sin(a) * 3;
      expect(covers(mesh, x, z, MAT.ASPHALT), `gap at ${x.toFixed(2)},${z.toFixed(2)}`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------- junctions

describe('road ribbons: junctions', () => {
  it('fills the junction centre where three carriageway ends meet', () => {
    const c = 32;
    const ends = [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3].map((a) => [
      c + Math.cos(a) * 20,
      c + Math.sin(a) * 20,
    ] as [number, number]);
    const mesh = build(ends.map(([x, z]) => road([[c, c], [x, z]], 8)));
    expect(covers(mesh, c, c, MAT.ASPHALT)).toBe(true);
    expect(matCount(mesh, MAT.ASPHALT)).toBeGreaterThan(6);
  });
});

// ---------------------------------------------------------------- clipping

describe('road ribbons: chunk clipping', () => {
  const roads = [road([[10, 32], [140, 32]], 8, { flags: ROAD_SIDEWALK })];

  it('keeps every vertex inside its chunk and never crosses the border', () => {
    for (const [gcx, x0, x1] of [[0, 0, 64], [1, 64, 128]] as const) {
      const mesh = build(roads, gcx, 0);
      for (let i = 0; i < mesh.positions.length / 3; i++) {
        const x = gcx * CHUNK_M + mesh.positions[i * 3]!;
        const z = mesh.positions[i * 3 + 2]!;
        expect(x).toBeGreaterThanOrEqual(x0 - 1e-4);
        expect(x).toBeLessThanOrEqual(x1 + 1e-4);
        expect(z).toBeGreaterThanOrEqual(-1e-4);
        expect(z).toBeLessThanOrEqual(CHUNK_M + 1e-4);
      }
    }
  });

  it('shares the border vertices between two adjacent chunks', () => {
    const a = build(roads, 0, 0);
    const b = build(roads, 1, 0);
    const edge = (mesh: RoadMesh, localX: number, gcx: number): Array<[number, number, number, number]> => {
      const out: Array<[number, number, number, number]> = [];
      for (let i = 0; i < mesh.positions.length / 3; i++) {
        // a dash clipped to a zero-width sliver has no surface: only compare real ribbon faces
        const mat = mesh.walls[i * 4]!;
        if (mat !== MAT.ASPHALT && mat !== MAT.SIDEWALK) continue;
        if (Math.abs(mesh.positions[i * 3]! - localX) > 1e-4) continue;
        out.push([
          gcx * CHUNK_M + mesh.positions[i * 3]!,
          mesh.positions[i * 3 + 1]!,
          Math.round(mesh.positions[i * 3 + 2]! * 1000),
          mat,
        ]);
      }
      return out.sort((p, q) => p[2] - q[2] || p[3] - q[3] || p[1] - q[1]);
    };
    const ea = edge(a, CHUNK_M, 0);
    const eb = edge(b, 0, 1);
    expect(ea.length).toBeGreaterThan(2);
    expect(ea).toEqual(eb);
  });
});

// ---------------------------------------------------------------- markings

describe('road ribbons: markings', () => {
  function markingRuns(mesh: RoadMesh): Array<{ x: number; len: number }> {
    const spans: Array<[number, number]> = [];
    for (let t = 0; t < mesh.indices.length; t += 3) {
      const i0 = mesh.indices[t]!;
      if (mesh.walls[i0 * 4] !== MAT.MARKING) continue;
      let min = Infinity, max = -Infinity, onCentre = true;
      for (const i of [i0, mesh.indices[t + 1]!, mesh.indices[t + 2]!]) {
        const x = mesh.positions[i * 3]!;
        const z = mesh.positions[i * 3 + 2]!;
        if (x < min) min = x;
        if (x > max) max = x;
        if (Math.abs(z - 32) > 0.2) onCentre = false;
      }
      if (onCentre) spans.push([min, max]);
    }
    spans.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const runs: Array<{ x: number; len: number }> = [];
    for (const [a, b] of spans) {
      const last = runs[runs.length - 1];
      if (last !== undefined && a <= last.x + last.len + 1e-3) {
        last.len = Math.max(last.len, b - last.x);
      } else {
        runs.push({ x: a, len: b - a });
      }
    }
    return runs;
  }

  it('dashes the centre line 3 m on / 6 m off', () => {
    const mesh = build([road([[0, 32], [64, 32]], 8)]);
    const runs = markingRuns(mesh);
    const full = runs.filter((r) => r.x > 0.2 && r.x + r.len < 63.8);
    expect(full.length).toBeGreaterThanOrEqual(5);
    for (const r of full) expect(r.len).toBeCloseTo(3, 1);
    for (let i = 1; i < full.length; i++) expect(full[i]!.x - full[i - 1]!.x).toBeCloseTo(9, 1);
  });

  it('stops markings 6 m short of a junction', () => {
    const mesh = build([
      road([[0, 32], [32, 32]], 8, { name: 0 }),
      road([[32, 32], [64, 32]], 8, { name: 0 }),
      road([[32, 32], [32, 0]], 6, { name: 1 }),
    ]);
    const marks = verticesOf(mesh, MAT.MARKING);
    expect(marks.length).toBeGreaterThan(0);
    for (const p of marks) {
      expect(Math.hypot(p[0] - 32, p[2] - 32)).toBeGreaterThanOrEqual(6 - 1e-3);
    }
  });

  it('adds solid double centre and edge lines on a wide primary road', () => {
    const plain = build([road([[0, 32], [64, 32]], 8)]);
    const primary = build([road([[0, 32], [64, 32]], 14, { kind: ROAD.PRIMARY, lanes: 4 })]);
    expect(matCount(primary, MAT.MARKING)).toBeGreaterThan(matCount(plain, MAT.MARKING) * 2);
  });
});

// ---------------------------------------------------------------- classes and height

describe('road ribbons: classes, surfaces and height', () => {
  it('skips bridges, other layers and tracks', () => {
    const mesh = build([
      road([[0, 10], [64, 10]], 6),
      road([[0, 25], [64, 25]], 6, { flags: ROAD_BRIDGE }),
      road([[0, 40], [64, 40]], 6, { layer: 1 }),
      road([[0, 55], [64, 55]], 6, { kind: ROAD.TRACK }),
    ]);
    const maxZ = Math.max(...verticesOf(mesh).map((p) => p[2]));
    expect(maxZ).toBeLessThan(15);
    expect(matCount(mesh, MAT.ASPHALT)).toBeGreaterThan(0);
  });

  it('uses DIRT for unpaved and the tagged surface otherwise', () => {
    const dirt = build([road([[0, 10], [64, 10]], 6, { flags: ROAD_UNPAVED })]);
    expect(matCount(dirt, MAT.DIRT)).toBeGreaterThan(0);
    expect(matCount(dirt, MAT.ASPHALT)).toBe(0);

    const sett = build([road([[0, 10], [64, 10]], 6, { surface: SURFACE.SETT })]);
    expect(matCount(sett, MAT.SETT)).toBeGreaterThan(0);
  });

  it('makes 2 m paving strips only for wide pedestrian and footway ways', () => {
    const mesh = build([
      road([[0, 10], [64, 10]], 3, { kind: ROAD.PEDESTRIAN }),
      road([[0, 25], [64, 25]], 3, { kind: ROAD.PATH }),
      road([[0, 40], [64, 40]], 1.2, { kind: ROAD.FOOTWAY }),
      road([[0, 55], [64, 55]], 3, { kind: ROAD.STEPS }),
    ]);
    const paving = verticesOf(mesh, MAT.PAVING);
    expect(paving.length).toBeGreaterThan(0);
    for (const p of paving) {
      expect(Math.abs(p[2] - 10)).toBeLessThanOrEqual(1.01);
    }
  });

  it('follows groundAt + 6 cm at every ribbon vertex', () => {
    const ground = (x: number, z: number): number => 3 + 0.02 * x + 0.03 * z;
    const mesh = build([road([[0, 14], [64, 50]], 8, { flags: ROAD_SIDEWALK })], 0, 0, ground);
    expect(mesh.positions.length).toBeGreaterThan(0);
    for (let i = 0; i < mesh.positions.length / 3; i++) {
      const mat = mesh.walls[i * 4]!;
      const x = mesh.positions[i * 3]!;
      const z = mesh.positions[i * 3 + 2]!;
      const want = ground(x, z) + ROAD_RIBBON_LIFT + (mat === MAT.MARKING ? ROAD_MARKING_LIFT : 0);
      expect(Math.abs(mesh.positions[i * 3 + 1]! - want)).toBeLessThanOrEqual(0.01);
    }
  });
});

// ---------------------------------------------------------------- determinism and budget

describe('road ribbons: determinism and budget', () => {
  it('is byte-identical when built twice', () => {
    const roads = [road([[0, 32], [32, 22], [64, 32]], 8, { flags: ROAD_SIDEWALK })];
    const a = build(roads);
    const b = build(roads);
    for (const key of ['positions', 'normals', 'colors', 'walls', 'indices'] as const) {
      expect(Array.from(a[key])).toEqual(Array.from(b[key]));
    }
  });

  it('keeps a dense central chunk under 3,000 ribbon triangles', () => {
    const roads: VRoad[] = [];
    for (let k = 4; k < 64; k += 5) {
      roads.push(road([[-4, k], [68, k]], 6, { flags: ROAD_SIDEWALK }));
      roads.push(road([[k, -4], [k, 68]], 6, { flags: ROAD_SIDEWALK }));
    }
    const mesh = build(roads);
    const tris = mesh.indices.length / 3;
    expect(tris).toBeGreaterThan(500);
    expect(tris).toBeLessThanOrEqual(3000);
  });
});

// ---------------------------------------------------------------- streamer

describe('mesh streamer: ribbon visibility', () => {
  class StubWorker {
    onmessage: ((e: MessageEvent<CityMeshResponse>) => void) | null = null;
    readonly requests: CityMeshRequest[] = [];

    postMessage(message: unknown): void {
      const m = message as CityMeshRequest & { type?: string };
      if (m.type === 'hidden') return;
      this.requests.push(m);
    }

    terminate(): void {}

    respond(index: number, body: Partial<CityMeshResponse>): void {
      const id = this.requests[index]!.id;
      this.onmessage?.({ data: { id, ...body } } as MessageEvent<CityMeshResponse>);
    }
  }

  const roadBody = {
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]),
    normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]),
    colors: new Float32Array([0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2]),
    walls: new Float32Array([MAT.ASPHALT, 0, 0, 0, MAT.ASPHALT, 0, 0, 0, MAT.ASPHALT, 0, 0, 0]),
    indices: new Uint32Array([0, 1, 2]),
  };

  function makeStreamer(worker: StubWorker, fineRadius: number): MeshStreamer {
    const scene = new THREE.Scene();
    const coarse = {
      regionData: () => null,
      peekRegion: () => null,
      setStructuresHidden: () => {},
      material: new THREE.MeshLambertMaterial({ vertexColors: true }),
    } as unknown as WorldStreamer;
    const manifest: Manifest = {
      version: 1, voxel: 1, chunk: 64, region: 512, regionsX: 1, regionsZ: 1,
      bbox: { south: 0, west: 0, north: 512, east: 512 }, regions: {}, spawn: [10, 10],
    };
    const streamer = new MeshStreamer(scene, coarse, manifest, {
      radius: 100, castShadow: false, workers: 1, fineRadius,
      roadMaterial: new THREE.MeshBasicMaterial({ vertexColors: true }),
      workerFactory: () => worker as unknown as Worker,
    });
    (streamer as unknown as { tiles: Map<number, unknown> }).tiles.set(regionKey(0, 0), {
      rx: 0, rz: 0, key: regionKey(0, 0), state: 'none', buffer: null,
      sentMask: 0, lastUsed: 0, failedAt: 0,
    });
    return streamer;
  }

  function answerAll(worker: StubWorker): void {
    let done = 0;
    while (done < worker.requests.length && done < 500) {
      worker.respond(done, { indices: new Uint32Array(0), roads: roadBody });
      done++;
    }
    expect(done).toBe(worker.requests.length);
  }

  type Internals = {
    chunks: Map<number, {
      gcx: number; gcz: number; roadSlot: { visible: boolean } | null;
    }>;
  };

  function expectVisibility(streamer: MeshStreamer, x: number, z: number, fineRadius: number): void {
    const chunks = (streamer as unknown as Internals).chunks;
    let visible = 0;
    let hidden = 0;
    for (const c of chunks.values()) {
      const want = fineRadius <= 0 || distToChunk(x, z, c.gcx, c.gcz) > fineRadius;
      expect(c.roadSlot !== null).toBe(true);
      expect(c.roadSlot!.visible).toBe(want);
      if (want) visible++; else hidden++;
    }
    expect(visible).toBe(streamer.ribbonDraws);
    expect(hidden).toBeGreaterThan(0);
    expect(visible).toBeGreaterThan(0);
  }

  it('shows ribbons only beyond fineRadius and re-evaluates on chunk crossings', () => {
    const worker = new StubWorker();
    const streamer = makeStreamer(worker, 40);
    streamer.update(32, 32);
    answerAll(worker);
    expect(streamer.ribbonChunks).toBeGreaterThan(0);
    expectVisibility(streamer, 32, 32, 40);

    streamer.update(96, 32);
    answerAll(worker);
    expectVisibility(streamer, 96, 32, 40);
    streamer.dispose();
  });

  it('shows ribbons everywhere when fineRadius is 0', () => {
    const worker = new StubWorker();
    const streamer = makeStreamer(worker, 0);
    streamer.update(32, 32);
    answerAll(worker);
    expect(streamer.ribbonChunks).toBeGreaterThan(0);
    expect(streamer.ribbonDraws).toBe(streamer.ribbonChunks);
    streamer.dispose();
  });
});

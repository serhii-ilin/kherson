import { describe, expect, it } from 'vitest';
import { MAT } from '../src/world/materials';
import { LINE, POINT, ROAD, ROAD_SIDEWALK } from '../src/world/vector-format';
import { generateFineChunk } from '../src/fine/generate';
import { meshFineGround } from '../src/fine/mesh';
import { NO_GROUND } from '../src/fine/raster';
import { FINE_CELL, FINE_N, GCX, GCZ, emptyTile, flatPatch, line, point, raster, road, setCoarse } from './fine-util';

interface Quad { nx: number; ny: number; nz: number; x: number; z: number; y0: number; y1: number; len: number }

/** Vertical wall quads of a mesh: plane coordinate, y range (cm) and extent along the wall. */
function walls(m: ReturnType<typeof generateFineChunk>): Quad[] {
  const out: Quad[] = [];
  for (let q = 0; q < m.positions.length / 12; q++) {
    const n = [m.normals[q * 12]!, m.normals[q * 12 + 1]!, m.normals[q * 12 + 2]!];
    if (n[1] !== 0) continue;
    let xMin = Infinity, xMax = -Infinity, zMin = Infinity, zMax = -Infinity, yMin = Infinity, yMax = -Infinity;
    for (let v = 0; v < 4; v++) {
      const x = m.positions[q * 12 + v * 3]!, y = m.positions[q * 12 + v * 3 + 1]!, z = m.positions[q * 12 + v * 3 + 2]!;
      xMin = Math.min(xMin, x); xMax = Math.max(xMax, x);
      yMin = Math.min(yMin, y); yMax = Math.max(yMax, y);
      zMin = Math.min(zMin, z); zMax = Math.max(zMax, z);
    }
    const alongX = n[2] !== 0;
    out.push({
      nx: n[0]!, ny: n[1]!, nz: n[2]!, x: xMin, z: zMin,
      y0: Math.round(yMin * 100), y1: Math.round(yMax * 100),
      len: alongX ? xMax - xMin : zMax - zMin,
    });
  }
  return out;
}

function sameBytes(a: ArrayBufferView, b: ArrayBufferView): boolean {
  return Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(Buffer.from(b.buffer, b.byteOffset, b.byteLength));
}

describe('fine ground mesh', () => {
  it('flat grass chunk is one top quad', () => {
    const m = generateFineChunk({ gcx: GCX, gcz: GCZ, patch: flatPatch(), tiles: [emptyTile()] });
    expect(m.indices.length).toBe(6);
    expect(m.positions.length).toBe(12);
    expect(m.raster[0]).toBe(400);
  });

  it('emits border faces down to the coarse neighbour heights, once, with no gap', () => {
    const p = flatPatch(MAT.GRASS, 2);
    // west ring is 1 voxel lower (face 200..400 cm), east ring higher (no face), north ring equal
    for (let i = 0; i < 34; i++) {
      setCoarse(p, -1, i - 1, MAT.GRASS, 1);
      setCoarse(p, 32, i - 1, MAT.GRASS, 3);
    }
    const tile = emptyTile();
    tile.roads.push(road([[-10, 32.1], [75, 32.1]], 8, { flags: ROAD_SIDEWALK }));
    const g = raster(p, tile);
    const m = meshFineGround(g, p);
    const w = walls(m);
    // west border x = 0, facing -x: covers every z once, spanning 200 cm to the cell top
    const west = w.filter((q) => q.nx === -1 && q.x === 0);
    const cover = new Float64Array(FINE_N);
    for (const q of west) {
      const z0 = Math.round(q.z / FINE_CELL);
      for (let k = 0; k < Math.round(q.len / FINE_CELL); k++) {
        cover[z0 + k]!++;
        const top = g.hcm[(z0 + k) * FINE_N]!;
        expect(q.y0).toBe(200);
        expect(q.y1).toBe(top);
      }
    }
    for (let k = 0; k < FINE_N; k++) expect(cover[k]).toBe(1);
    // east border (neighbour higher): no faces
    expect(w.filter((q) => q.nx === 1 && q.x === 64).length).toBe(0);
    // north border (neighbour equal): faces only where the sidewalk kerb rises above the neighbour's base
    const north = w.filter((q) => q.nz === -1 && q.z === 0);
    for (const q of north) {
      expect(q.y0).toBe(400);
      expect(q.y1).toBe(415);
    }
  });

  it('closes soil steps against water and building columns', () => {
    const p = flatPatch(MAT.GRASS, 3);
    setCoarse(p, 10, 10, MAT.WATER, 1);
    setCoarse(p, 20, 20, MAT.GRASS, 5, 3); // building on higher ground
    const m = generateFineChunk({ gcx: GCX, gcz: GCZ, patch: p, tiles: [emptyTile()] });
    const w = walls(m);
    // grass next to the water cell: a 200..600 cm... (water level 1 voxel = 200 cm, grass 600 cm)
    const west = w.filter((q) => q.nx === 1 && q.x === 20 && q.z >= 20 && q.z < 22);
    expect(west.length).toBeGreaterThan(0);
    expect(west[0]!.y0).toBe(200);
    expect(west[0]!.y1).toBe(600);
    // building column on higher ground (gh 5 = 1000 cm) above the grass (600 cm): its soil face
    const soil = w.filter((q) => q.nx === -1 && q.x === 40 && q.z >= 40 && q.z < 42);
    expect(soil.length).toBeGreaterThan(0);
    expect(soil[0]!.y0).toBe(600);
    expect(soil[0]!.y1).toBe(1000);
    // no fine top inside water or building cells
    expect(m.raster[(10 * 10 + 1) * FINE_N + 10 * 10 + 1]).toBe(NO_GROUND);
    expect(m.raster[(20 * 10 + 1) * FINE_N + 20 * 10 + 1]).toBe(NO_GROUND);
  });

  it('is deterministic: identical input gives byte-identical arrays', () => {
    const make = (): ReturnType<typeof generateFineChunk> => {
      const tile = emptyTile();
      tile.roads.push(road([[-10, 20.1], [75, 22.3]], 9, { kind: ROAD.SECONDARY, lanes: 2, flags: ROAD_SIDEWALK }));
      tile.roads.push(road([[30.1, -10], [30.1, 75]], 6, { flags: ROAD_SIDEWALK, name: 1 }));
      tile.lines.push(line([[-5, 50], [70, 52]], LINE.TRAM));
      tile.points.push(point(30.1, 21.5, POINT.CROSSING, 255));
      const p = flatPatch();
      setCoarse(p, 3, 25, MAT.WATER, 1);
      setCoarse(p, 12, 4, MAT.WALL_HOUSE, 2, 3);
      return generateFineChunk({ gcx: GCX, gcz: GCZ, patch: p, tiles: [tile] });
    };
    const a = make();
    const b = make();
    for (const k of ['positions', 'normals', 'colors', 'walls', 'indices', 'raster'] as const) {
      expect(sameBytes(a[k], b[k])).toBe(true);
    }
    expect(a.indices.length).toBeGreaterThan(100);
  });

  it('windings match normals and indices stay in range', () => {
    const tile = emptyTile();
    tile.roads.push(road([[-10, 20.1], [75, 30.3]], 9, { flags: ROAD_SIDEWALK }));
    const m = generateFineChunk({ gcx: GCX, gcz: GCZ, patch: flatPatch(), tiles: [tile] });
    const p = m.positions;
    for (let i = 0; i < m.indices.length; i += 3) {
      const a = m.indices[i]! * 3, b = m.indices[i + 1]! * 3, c = m.indices[i + 2]! * 3;
      const e1 = [p[b]! - p[a]!, p[b + 1]! - p[a + 1]!, p[b + 2]! - p[a + 2]!];
      const e2 = [p[c]! - p[a]!, p[c + 1]! - p[a + 1]!, p[c + 2]! - p[a + 2]!];
      const n = [
        e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!,
      ];
      expect(n[0]! * m.normals[a]! + n[1]! * m.normals[a + 1]! + n[2]! * m.normals[a + 2]!).toBeGreaterThan(0);
      expect(m.indices[i]!).toBeLessThan(p.length / 3);
    }
  });

  it('darkens cells next to coarse buildings and at the foot of kerbs', () => {
    const p = flatPatch();
    setCoarse(p, 16, 16, MAT.WALL_HOUSE, 2, 4);
    const tile = emptyTile();
    tile.roads.push(road([[-10, 10.1], [75, 10.1]], 6, { flags: ROAD_SIDEWALK }));
    const g = raster(p, tile);
    // building cell spans x,z 32..34 m; the cell just left of it is in contact
    expect(g.ao[Math.floor(33 / FINE_CELL) * FINE_N + Math.floor(31.9 / FINE_CELL)]).toBe(1);
    expect(g.ao[Math.floor(33 / FINE_CELL) * FINE_N + Math.floor(20 / FINE_CELL)]).toBe(3);
    // asphalt cell beside the sidewalk kerb is shaded, the one in the middle is not
    expect(g.ao[Math.floor((10.1 + 2.9) / FINE_CELL) * FINE_N + 100]).toBe(2);
    expect(g.ao[Math.floor(10.1 / FINE_CELL) * FINE_N + 100]).toBe(3);
  });

  it('keeps a dense urban chunk within the triangle budget', () => {
    const tile = emptyTile();
    // a 4x4 block grid of residential streets with sidewalks, crossings and a diagonal avenue + tram
    for (let k = 0; k < 4; k++) {
      const o = 8 + k * 16;
      tile.roads.push(road([[-10, o + 0.1], [75, o + 0.1]], 7, { flags: ROAD_SIDEWALK, name: k }));
      tile.roads.push(road([[o + 0.1, -10], [o + 0.1, 75]], 7, { flags: ROAD_SIDEWALK, name: 10 + k }));
      tile.points.push(point(o, 20, POINT.CROSSING, 255));
    }
    tile.roads.push(road([[-10, 0], [75, 70]], 14, { kind: ROAD.PRIMARY, lanes: 4, flags: ROAD_SIDEWALK, name: 99 }));
    tile.lines.push(line([[-10, 5], [75, 75]], LINE.TRAM));
    const p = flatPatch();
    for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) setCoarse(p, 2 + i * 5, 3 + j * 5, MAT.WALL_APART, 2, 4);
    const m = generateFineChunk({ gcx: GCX, gcz: GCZ, patch: p, tiles: [tile] });
    expect(m.indices.length / 3).toBeLessThan(30000);
  });
});

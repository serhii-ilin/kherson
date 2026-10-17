import { describe, expect, it } from 'vitest';
import { toLatLon } from '../src/world/geo';
import { CHUNK_M, DIR_NX, DIR_NZ, DIR_PX, distToChunk, edgeDirs, neededChunks } from '../src/world/stream-math';
import { toLatLon as bakeToLatLon } from '../tools/bake/project';
import { BBOX } from '../tools/bake/config';

describe('stream-math', () => {
  it('distToChunk is zero inside and Euclidean outside', () => {
    expect(distToChunk(10, 10, 0, 0)).toBe(0);
    expect(distToChunk(CHUNK_M + 3, 10, 0, 0)).toBe(3);
    expect(distToChunk(CHUNK_M + 3, CHUNK_M + 4, 0, 0)).toBe(5);
  });

  it('lists chunks within the radius, nearest first', () => {
    const list = neededChunks(1000, 1000, 300, 100, 100);
    expect(list.length).toBeGreaterThan(20);
    for (let i = 1; i < list.length; i++) expect(list[i]!.dist).toBeGreaterThanOrEqual(list[i - 1]!.dist);
    expect(list.every((c) => c.dist <= 300)).toBe(true);
    expect(list[0]).toMatchObject({ gcx: Math.floor(1000 / CHUNK_M), gcz: Math.floor(1000 / CHUNK_M), dist: 0 });
    // no chunk outside the circle was dropped
    let expected = 0;
    for (let z = 0; z < 100; z++) for (let x = 0; x < 100; x++) if (distToChunk(1000, 1000, x, z) <= 300) expected++;
    expect(list.length).toBe(expected);
  });

  it('clips to the world', () => {
    const list = neededChunks(10, 10, 500, 4, 4);
    expect(list.every((c) => c.gcx >= 0 && c.gcz >= 0 && c.gcx < 4 && c.gcz < 4)).toBe(true);
    expect(list.length).toBeLessThanOrEqual(16);
  });

  it('edgeDirs flags region borders', () => {
    expect(edgeDirs(0, 0)).toBe(DIR_NX | DIR_NZ);
    expect(edgeDirs(7, 3)).toBe(DIR_PX);
    expect(edgeDirs(3, 3)).toBe(0);
    expect(edgeDirs(8, 3)).toBe(DIR_NX);
  });

  it('geo toLatLon matches the bake projection', () => {
    const a = toLatLon(BBOX, 10293, 8817);
    const b = bakeToLatLon(10293, 8817);
    expect(a[0]).toBeCloseTo(b[0], 9);
    expect(a[1]).toBeCloseTo(b[1], 9);
    expect(a[0]).toBeGreaterThan(46.6);
    expect(a[0]).toBeLessThan(46.7);
  });
});

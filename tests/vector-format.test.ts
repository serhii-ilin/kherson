import { describe, expect, it } from 'vitest';
import {
  decodeVectorTile, encodeVectorTile, LINE, NO_DIR, POINT, ROAD, ROAD_BRIDGE, ROAD_LIT, ROAD_ONEWAY,
  ROAD_UNPAVED, ROOF, VECTOR_VERSION, type VectorTile,
} from '../src/world/vector-format.ts';

function makeTile(): VectorTile {
  return {
    rx: 3,
    rz: 7,
    strings: ['Аптека', 'Кафе «Херсон»', ''],
    buildings: [
      {
        id: 3000000000,
        rings: [
          new Int32Array([0, 0, 400, 0, 400, 300, 0, 300]),
          new Int32Array([100, 100, 200, 100, 200, 200, 100, 200]),
        ],
        heightCm: 12000,
        minHeightCm: 300,
        levels: 12,
        heightHeuristic: 1,
        wall: 5,
        roof: 7,
        roofShape: ROOF.HIPPED,
        name: 0,
      },
      {
        id: 42,
        rings: [new Int32Array([-50, -50, 10, -50, 10, 10])],
        heightCm: 900,
        minHeightCm: 0,
        levels: 0,
        wall: 1,
        roof: 2,
        roofShape: ROOF.FLAT,
        name: -1,
      },
    ],
    roads: [
      {
        pts: new Int32Array([0, 0, 500, 0, 900, 400]), kind: ROAD.PRIMARY,
        flags: ROAD_ONEWAY | ROAD_BRIDGE | ROAD_LIT, widthCm: 1600, lanes: 4, layer: -1, name: 1,
      },
      {
        pts: new Int32Array([100, 200, 100, 900]), kind: ROAD.RESIDENTIAL,
        flags: 0, widthCm: 800, lanes: 0, layer: 0, name: -1,
      },
      {
        pts: new Int32Array([-20, 30, 60, 30]), kind: ROAD.FOOTWAY,
        flags: ROAD_UNPAVED, widthCm: 200, lanes: 0, layer: 2, name: 2,
      },
    ],
    areas: [
      {
        rings: [
          new Int32Array([0, 0, 1000, 0, 1000, 800, 0, 800]),
          new Int32Array([400, 300, 600, 300, 600, 500, 400, 500]),
        ],
        mat: 12,
        prio: 3,
      },
    ],
    lines: [
      { pts: new Int32Array([0, 10, 0, 500]), kind: LINE.FENCE, heightCm: 220 },
      { pts: new Int32Array([700, 0, 750, 250]), kind: LINE.RAIL },
    ],
    points: [
      { x: -150, z: -150, kind: POINT.CROSSING, dir: NO_DIR, name: -1 },
      { x: 60000, z: 12000, kind: POINT.SHOP, dir: 64, name: 2 },
      { x: 300, z: 450, kind: POINT.STREET_LAMP, dir: 128, name: -1 },
    ],
  };
}

const emptyTile = (): VectorTile => ({
  rx: 0, rz: 0, strings: [], buildings: [], roads: [], areas: [], lines: [], points: [],
});

describe('vector tile format', () => {
  it('round trips a populated tile', () => {
    const tile = makeTile();
    const out = decodeVectorTile(encodeVectorTile(tile));
    expect(out).toEqual(tile);
    expect(out.strings[0]).toBe('Аптека');
    expect(out.strings[1]).toBe('Кафе «Херсон»');
    expect(out.strings[2]).toBe('');
    expect(out.buildings[0]!.rings[1]).toBeInstanceOf(Int32Array);
    expect(out.buildings[0]!.id).toBe(3000000000);
    expect(out.roads[0]!.layer).toBe(-1);
    expect(out.points[0]!.dir).toBe(NO_DIR);
    expect(out.points[0]!.x).toBe(-150);
    expect(out.points[1]!.x).toBe(60000);
  });

  it('writes the documented header', () => {
    const tile = makeTile();
    const buf = encodeVectorTile(tile);
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    expect(String.fromCharCode(...buf.subarray(0, 4))).toBe('VKV1');
    expect(dv.getUint16(4, true)).toBe(VECTOR_VERSION);
    expect(dv.getUint16(6, true)).toBe(3);
    expect(dv.getUint16(8, true)).toBe(7);
    expect(decodeVectorTile(buf.buffer.slice(0, buf.byteLength) as ArrayBuffer).rx).toBe(3);
  });

  it('round trips an empty tile', () => {
    const tile = emptyTile();
    expect(decodeVectorTile(encodeVectorTile(tile))).toEqual(tile);
  });

  it('encodes deterministically', () => {
    const a = encodeVectorTile(makeTile());
    const b = encodeVectorTile(makeTile());
    expect(a.length).toBe(b.length);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('decodes from a Uint8Array view with a byteOffset', () => {
    const tile = makeTile();
    const bytes = encodeVectorTile(tile);
    const big = new Uint8Array(bytes.length + 6);
    big.set(bytes, 3);
    const view = new Uint8Array(big.buffer, 3, bytes.length);
    expect(decodeVectorTile(view)).toEqual(tile);
  });

  it('rejects bad magic and unsupported versions', () => {
    const bytes = encodeVectorTile(makeTile());
    const bad = bytes.slice();
    bad[0] = 0x00;
    expect(() => decodeVectorTile(bad)).toThrow('bad vector tile magic');
    const wrongVersion = bytes.slice();
    new DataView(wrongVersion.buffer, wrongVersion.byteOffset, wrongVersion.byteLength).setUint16(4, VECTOR_VERSION + 1, true);
    expect(() => decodeVectorTile(wrongVersion)).toThrow('unsupported vector tile version');
  });

  it('round trips large coordinate deltas', () => {
    const tile: VectorTile = {
      ...emptyTile(),
      lines: [{ pts: new Int32Array([0, 0, 2000000, -2000000, -2000000, 2000000]), kind: LINE.RAIL }],
    };
    expect(decodeVectorTile(encodeVectorTile(tile))).toEqual(tile);
  });
});

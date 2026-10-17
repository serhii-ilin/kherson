import { describe, expect, it } from 'vitest';
import { FIELDS, REGION } from '../src/world/constants';
import { cellIndex, decodeRegion, encodeRegion, type RegionData } from '../src/world/format';

function makeRegion(): RegionData {
  const cells = new Uint8Array(FIELDS * REGION * REGION);
  // Long runs (> 255) in plane 0, noisy plane 1, sparse plane 2.
  cells.fill(2, 0, REGION * REGION);
  let s = 12345;
  for (let i = 0; i < REGION * REGION; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    cells[REGION * REGION + i] = (s >>> 24) & 7;
  }
  cells[cellIndex(2, 10, 20)] = 9;
  cells[cellIndex(3, REGION - 1, REGION - 1)] = 200;
  cells.fill(41, 4 * REGION * REGION + 300, 4 * REGION * REGION + 1000);
  return {
    rx: -3,
    rz: 7,
    cells,
    features: [
      { type: 1, param: 6, x: 5, z: 250 },
      { type: 2, param: 2, x: 255, z: 0 },
    ],
  };
}

describe('region format', () => {
  it('round trips cells and features', () => {
    const r = makeRegion();
    const out = decodeRegion(encodeRegion(r));
    expect(out.rx).toBe(-3);
    expect(out.rz).toBe(7);
    expect(out.features).toEqual(r.features);
    expect(out.cells.every((v, i) => v === r.cells[i])).toBe(true);
  });

  it('writes the expected header', () => {
    const buf = encodeRegion(makeRegion());
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    expect(String.fromCharCode(...buf.subarray(0, 4))).toBe('VKR1');
    expect(dv.getUint16(4, true)).toBe(1);
    expect(dv.getInt16(6, true)).toBe(-3);
    expect(dv.getInt16(8, true)).toBe(7);
    expect(dv.getUint16(10, true)).toBe(REGION);
    const payloadLen = dv.getUint32(12, true);
    expect(buf.length).toBe(16 + payloadLen + 4 + 2 * 8);
    expect(dv.getUint32(16 + payloadLen, true)).toBe(2);
  });

  it('splits runs longer than 255', () => {
    const cells = new Uint8Array(FIELDS * REGION * REGION);
    const buf = encodeRegion({ rx: 0, rz: 0, cells, features: [] });
    // each plane: 65536 = 257*255 + 1 -> 258 pairs
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    expect(dv.getUint32(12, true)).toBe(FIELDS * 258 * 2);
  });

  it('accepts a plain ArrayBuffer and rejects bad magic', () => {
    const buf = encodeRegion(makeRegion());
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    expect(decodeRegion(ab).rz).toBe(7);
    const bad = buf.slice();
    bad[0] = 0;
    expect(() => decodeRegion(bad)).toThrow();
  });
});

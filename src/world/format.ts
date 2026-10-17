import { FIELDS, REGION } from './constants.ts';

export interface Feature {
  type: number;
  param: number;
  x: number;
  z: number;
}

export interface RegionData {
  rx: number;
  rz: number;
  /** FIELDS * REGION * REGION bytes, plane-major. */
  cells: Uint8Array;
  features: Feature[];
}

export const FEATURE_TREE = 1;
export const FEATURE_BRIDGE_DECK = 2;

const HEADER_SIZE = 16;
const PLANE = REGION * REGION;
const VERSION = 1;
const MAGIC = [0x56, 0x4b, 0x52, 0x31]; // "VKR1"

export function cellIndex(field: number, x: number, z: number): number {
  return field * PLANE + z * REGION + x;
}

function rleEncodePlane(cells: Uint8Array, start: number, out: number[]): void {
  const end = start + PLANE;
  let i = start;
  while (i < end) {
    const v = cells[i]!;
    let n = 1;
    while (n < 255 && i + n < end && cells[i + n] === v) n++;
    out.push(n, v);
    i += n;
  }
}

export function encodeRegion(r: RegionData): Uint8Array {
  if (r.cells.length !== FIELDS * PLANE) throw new Error('bad cells length');
  const rle: number[] = [];
  for (let f = 0; f < FIELDS; f++) rleEncodePlane(r.cells, f * PLANE, rle);

  const total = HEADER_SIZE + rle.length + 4 + r.features.length * 8;
  const buf = new Uint8Array(total);
  const dv = new DataView(buf.buffer);
  buf.set(MAGIC, 0);
  dv.setUint16(4, VERSION, true);
  dv.setInt16(6, r.rx, true);
  dv.setInt16(8, r.rz, true);
  dv.setUint16(10, REGION, true);
  dv.setUint32(12, rle.length, true);
  buf.set(rle, HEADER_SIZE);

  let o = HEADER_SIZE + rle.length;
  dv.setUint32(o, r.features.length, true);
  o += 4;
  for (const f of r.features) {
    dv.setUint8(o, f.type);
    dv.setUint8(o + 1, f.param);
    dv.setUint16(o + 2, f.x, true);
    dv.setUint16(o + 4, f.z, true);
    dv.setUint16(o + 6, 0, true);
    o += 8;
  }
  return buf;
}

export function decodeRegion(input: ArrayBuffer | Uint8Array): RegionData {
  const buf = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (buf.length < HEADER_SIZE) throw new Error('region too short');
  for (let i = 0; i < 4; i++) {
    if (buf[i] !== MAGIC[i]) throw new Error('bad region magic');
  }
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (dv.getUint16(4, true) !== VERSION) throw new Error('unsupported region version');
  const rx = dv.getInt16(6, true);
  const rz = dv.getInt16(8, true);
  if (dv.getUint16(10, true) !== REGION) throw new Error('unexpected region size');
  const payloadLen = dv.getUint32(12, true);
  const payloadEnd = HEADER_SIZE + payloadLen;
  if (payloadEnd + 4 > buf.length) throw new Error('truncated region');

  const cells = new Uint8Array(FIELDS * PLANE);
  let p = HEADER_SIZE;
  for (let f = 0; f < FIELDS; f++) {
    let w = f * PLANE;
    const end = w + PLANE;
    while (w < end) {
      if (p + 2 > payloadEnd) throw new Error('corrupt RLE payload');
      const n = buf[p]!;
      const v = buf[p + 1]!;
      p += 2;
      if (n === 0 || w + n > end) throw new Error('corrupt RLE run');
      cells.fill(v, w, w + n);
      w += n;
    }
  }
  if (p !== payloadEnd) throw new Error('payload length mismatch');

  const count = dv.getUint32(payloadEnd, true);
  let o = payloadEnd + 4;
  if (o + count * 8 > buf.length) throw new Error('truncated features');
  const features: Feature[] = [];
  for (let i = 0; i < count; i++) {
    features.push({
      type: dv.getUint8(o),
      param: dv.getUint8(o + 1),
      x: dv.getUint16(o + 2, true),
      z: dv.getUint16(o + 4, true),
    });
    o += 8;
  }
  return { rx, rz, cells, features };
}

/**
 * Vector tiles (`v_<rx>_<rz>.bin`): compact OSM geometry per region for the 0.2 m fine tier.
 * Shared contract between the bake (tools/bake/vectors.ts) and the browser (src/fine/).
 *
 * Coordinates are integer centimetres relative to the region's NW corner (+x east, +z south).
 * Items are stored once, in the region of their anchor (building centroid, road-piece midpoint,
 * point position), so they may extend past the region's 512 m edge; readers merge the 3×3
 * neighbourhood and test bounding boxes.
 *
 * Binary layout (little endian):
 *   magic "VKV1", u16 version, u16 rx, u16 rz
 *   strings:   varint count, then per string: varint byteLength, UTF-8 bytes
 *   buildings: varint count, then per building:
 *              u32 id, varint heightCm, varint minHeightCm, u8 levels, u8 wall, u8 roof, u8 roofShape,
 *              varint (name + 1), varint ringCount, rings
 *   roads:     varint count, then per road: u8 kind, u8 flags, varint widthCm, u8 lanes, s8 layer,
 *              varint (name + 1), polyline
 *   areas:     varint count, then per area: u8 mat, u8 prio, varint ringCount, rings
 *   lines:     varint count, then per line: u8 kind, varint heightCm (0 = unknown), polyline
 *   points:    varint count, then per point: u8 kind, u8 dir, zigzag-varint x, zigzag-varint z, varint (name + 1)
 * A ring or polyline is: varint pointCount, then the first point as zigzag varints (x, z) and each
 * following point as zigzag-varint deltas from the previous one. Rings are not closed (no repeated
 * first point); ring 0 is the outer ring, the rest are holes.
 */

export const VECTOR_VERSION = 2;

/** `VRoad.kind`: OSM highway class. */
export const ROAD = {
  MOTORWAY: 1,
  TRUNK: 2,
  PRIMARY: 3,
  SECONDARY: 4,
  TERTIARY: 5,
  RESIDENTIAL: 6,
  UNCLASSIFIED: 7,
  LIVING_STREET: 8,
  SERVICE: 9,
  PEDESTRIAN: 10,
  FOOTWAY: 11,
  PATH: 12,
  CYCLEWAY: 13,
  STEPS: 14,
  TRACK: 15,
} as const;

/** `VRoad.flags` bits. */
export const ROAD_ONEWAY = 1;
export const ROAD_BRIDGE = 2;
/** Sidewalks on both sides (class default, unless tagged `sidewalk=no|none`). */
export const ROAD_SIDEWALK = 4;
export const ROAD_LIT = 8;
/** Unpaved surface (`surface=` ground, dirt, gravel, unpaved, …). */
export const ROAD_UNPAVED = 16;
/** A `*_link` road. */
export const ROAD_LINK = 32;

/** `VLine.kind`. */
export const LINE = {
  RAIL: 1,
  TRAM: 2,
  FENCE: 3,
  WALL: 4,
  HEDGE: 5,
} as const;

/** `VPoint.kind`. */
export const POINT = {
  STREET_LAMP: 1,
  CROSSING: 2,
  TRAFFIC_SIGNALS: 3,
  BUS_STOP: 4,
  ENTRANCE: 5,
  /** Named shop or amenity (sign text in `name`). */
  SHOP: 6,
  BENCH: 7,
  WASTE_BASKET: 8,
} as const;

/** `VPoint.dir` when the point has no direction. Otherwise dir is an angle in 256ths of a turn. */
export const NO_DIR = 255;

/** `VBuilding.roofShape`. */
export const ROOF = {
  FLAT: 0,
  GABLED: 1,
  HIPPED: 2,
  PYRAMIDAL: 3,
  DOME: 4,
  ONION: 5,
  SKILLION: 6,
} as const;

export interface VBuilding {
  /** Low 32 bits of the OSM id (unsigned), for deterministic per-building hashing. */
  id: number;
  /** Flat [x0, z0, x1, z1, …] in cm; ring 0 outer, others holes. */
  rings: Int32Array[];
  heightCm: number;
  minHeightCm: number;
  /** 0 when unknown. */
  levels: number;
  /** 1 when the bake filled height/storeys from a footprint heuristic, 0 for explicit/unknown. */
  heightHeuristic?: number;
  /** MAT wall id (style, see src/world/materials.ts). */
  wall: number;
  /** MAT roof id. */
  roof: number;
  roofShape: number;
  /** Index into `strings`, or -1. */
  name: number;
}

export interface VRoad {
  /** Flat [x0, z0, x1, z1, …] in cm. */
  pts: Int32Array;
  kind: number;
  flags: number;
  /** Carriageway width (kerb to kerb) in cm. */
  widthCm: number;
  /** 0 when unknown. */
  lanes: number;
  /** OSM `layer`, clamped to -128..127. */
  layer: number;
  name: number;
}

export interface VArea {
  rings: Int32Array[];
  /** MAT ground id. */
  mat: number;
  /** Paint order: higher paints later (on top). */
  prio: number;
}

export interface VLine {
  pts: Int32Array;
  kind: number;
  /** Barrier height in centimetres; omitted/zero means use the renderer's kind default. */
  heightCm?: number;
}

export interface VPoint {
  x: number;
  z: number;
  kind: number;
  dir: number;
  name: number;
}

export interface VectorTile {
  rx: number;
  rz: number;
  strings: string[];
  buildings: VBuilding[];
  roads: VRoad[];
  areas: VArea[];
  lines: VLine[];
  points: VPoint[];
}

const MAGIC = new Uint8Array([0x56, 0x4b, 0x56, 0x31]);
const HEADER_SIZE = 8;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function zigzag(n: number): number {
  return n < 0 ? -n * 2 - 1 : n * 2;
}

function unzigzag(v: number): number {
  return v % 2 === 0 ? v / 2 : -(v + 1) / 2;
}

class ByteWriter {
  private buf: Uint8Array;
  private dv: DataView;
  len = 0;

  constructor(capacity: number) {
    this.buf = new Uint8Array(capacity);
    this.dv = new DataView(this.buf.buffer);
  }

  private grow(n: number): void {
    if (this.len + n <= this.buf.length) return;
    let cap = Math.max(this.buf.length * 2, 16);
    while (cap < this.len + n) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.buf);
    this.buf = next;
    this.dv = new DataView(next.buffer);
  }

  u8(v: number): void {
    this.grow(1);
    this.buf[this.len] = v;
    this.len += 1;
  }

  i8(v: number): void {
    this.grow(1);
    this.dv.setInt8(this.len, v);
    this.len += 1;
  }

  u16(v: number): void {
    this.grow(2);
    this.dv.setUint16(this.len, v, true);
    this.len += 2;
  }

  u32(v: number): void {
    this.grow(4);
    this.dv.setUint32(this.len, v, true);
    this.len += 4;
  }

  varint(v: number): void {
    let n = v;
    while (n >= 0x80) {
      this.u8((n % 128) + 0x80);
      n = Math.floor(n / 128);
    }
    this.u8(n);
  }

  bytes(src: Uint8Array): void {
    this.grow(src.length);
    this.buf.set(src, this.len);
    this.len += src.length;
  }

  out(): Uint8Array {
    return this.buf.slice(0, this.len);
  }
}

class ByteReader {
  private buf: Uint8Array;
  private dv: DataView;
  pos = 0;

  constructor(buf: Uint8Array) {
    this.buf = buf;
    this.dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  get remaining(): number {
    return this.buf.length - this.pos;
  }

  private need(n: number): void {
    if (n < 0 || this.pos + n > this.buf.length) throw new Error('truncated vector tile');
  }

  u8(): number {
    this.need(1);
    const v = this.buf[this.pos]!;
    this.pos += 1;
    return v;
  }

  i8(): number {
    this.need(1);
    const v = this.dv.getInt8(this.pos);
    this.pos += 1;
    return v;
  }

  u16(): number {
    this.need(2);
    const v = this.dv.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }

  u32(): number {
    this.need(4);
    const v = this.dv.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }

  varint(): number {
    let v = 0;
    let scale = 1;
    for (let i = 0; i < 5; i++) {
      const b = this.u8();
      v += (b % 128) * scale;
      if (b < 0x80) return v;
      scale *= 128;
    }
    throw new Error('bad varint');
  }

  take(n: number): Uint8Array {
    this.need(n);
    const out = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }
}

function writePolyline(w: ByteWriter, pts: Int32Array): void {
  const count = pts.length / 2;
  w.varint(count);
  if (count === 0) return;
  let px = pts[0]!;
  let pz = pts[1]!;
  w.varint(zigzag(px));
  w.varint(zigzag(pz));
  for (let i = 2; i < pts.length; i += 2) {
    const x = pts[i]!;
    const z = pts[i + 1]!;
    w.varint(zigzag(x - px));
    w.varint(zigzag(z - pz));
    px = x;
    pz = z;
  }
}

function readPolyline(r: ByteReader): Int32Array {
  const count = r.varint();
  if (count * 2 > r.remaining) throw new Error('truncated vector tile');
  const pts = new Int32Array(count * 2);
  if (count === 0) return pts;
  let x = unzigzag(r.varint());
  let z = unzigzag(r.varint());
  pts[0] = x;
  pts[1] = z;
  for (let i = 2; i < pts.length; i += 2) {
    x += unzigzag(r.varint());
    z += unzigzag(r.varint());
    pts[i] = x;
    pts[i + 1] = z;
  }
  return pts;
}

function readRings(r: ByteReader, count: number): Int32Array[] {
  const rings: Int32Array[] = [];
  for (let i = 0; i < count; i++) rings.push(readPolyline(r));
  return rings;
}

export function encodeVectorTile(tile: VectorTile): Uint8Array {
  const w = new ByteWriter(1024);
  w.bytes(MAGIC);
  w.u16(VECTOR_VERSION);
  w.u16(tile.rx);
  w.u16(tile.rz);

  w.varint(tile.strings.length);
  for (const s of tile.strings) {
    const bytes = encoder.encode(s);
    w.varint(bytes.length);
    w.bytes(bytes);
  }

  w.varint(tile.buildings.length);
  for (const b of tile.buildings) {
    w.u32(b.id);
    w.varint(b.heightCm);
    w.varint(b.minHeightCm);
    w.u8(b.levels);
    w.u8(b.wall);
    w.u8(b.roof);
    w.u8(b.roofShape);
    w.u8(b.heightHeuristic ?? 0);
    w.varint(b.name + 1);
    w.varint(b.rings.length);
    for (const ring of b.rings) writePolyline(w, ring);
  }

  w.varint(tile.roads.length);
  for (const road of tile.roads) {
    w.u8(road.kind);
    w.u8(road.flags);
    w.varint(road.widthCm);
    w.u8(road.lanes);
    w.i8(road.layer);
    w.varint(road.name + 1);
    writePolyline(w, road.pts);
  }

  w.varint(tile.areas.length);
  for (const area of tile.areas) {
    w.u8(area.mat);
    w.u8(area.prio);
    w.varint(area.rings.length);
    for (const ring of area.rings) writePolyline(w, ring);
  }

  w.varint(tile.lines.length);
  for (const line of tile.lines) {
    w.u8(line.kind);
    w.varint(line.heightCm ?? 0);
    writePolyline(w, line.pts);
  }

  w.varint(tile.points.length);
  for (const p of tile.points) {
    w.u8(p.kind);
    w.u8(p.dir);
    w.varint(zigzag(p.x));
    w.varint(zigzag(p.z));
    w.varint(p.name + 1);
  }

  return w.out();
}

export function decodeVectorTile(input: ArrayBuffer | Uint8Array): VectorTile {
  const buf = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (buf.length < 4 || buf[0] !== MAGIC[0] || buf[1] !== MAGIC[1] || buf[2] !== MAGIC[2] || buf[3] !== MAGIC[3]) {
    throw new Error('bad vector tile magic');
  }
  if (buf.length < HEADER_SIZE) throw new Error('truncated vector tile');
  const r = new ByteReader(buf);
  r.pos = 4;
  if (r.u16() !== VECTOR_VERSION) throw new Error('unsupported vector tile version');
  const rx = r.u16();
  const rz = r.u16();

  const strings: string[] = [];
  const stringCount = r.varint();
  for (let i = 0; i < stringCount; i++) {
    const n = r.varint();
    strings.push(decoder.decode(r.take(n)));
  }

  const buildings: VBuilding[] = [];
  const buildingCount = r.varint();
  for (let i = 0; i < buildingCount; i++) {
    const id = r.u32();
    const heightCm = r.varint();
    const minHeightCm = r.varint();
    const levels = r.u8();
    const wall = r.u8();
    const roof = r.u8();
    const roofShape = r.u8();
    const heightHeuristic = r.u8();
    const name = r.varint() - 1;
    const rings = readRings(r, r.varint());
    buildings.push({ id, rings, heightCm, minHeightCm, levels, ...(heightHeuristic ? { heightHeuristic } : {}), wall, roof, roofShape, name });
  }

  const roads: VRoad[] = [];
  const roadCount = r.varint();
  for (let i = 0; i < roadCount; i++) {
    const kind = r.u8();
    const flags = r.u8();
    const widthCm = r.varint();
    const lanes = r.u8();
    const layer = r.i8();
    const name = r.varint() - 1;
    const pts = readPolyline(r);
    roads.push({ pts, kind, flags, widthCm, lanes, layer, name });
  }

  const areas: VArea[] = [];
  const areaCount = r.varint();
  for (let i = 0; i < areaCount; i++) {
    const mat = r.u8();
    const prio = r.u8();
    const rings = readRings(r, r.varint());
    areas.push({ rings, mat, prio });
  }

  const lines: VLine[] = [];
  const lineCount = r.varint();
  for (let i = 0; i < lineCount; i++) {
    const kind = r.u8();
    const heightCm = r.varint();
    const pts = readPolyline(r);
    lines.push({ pts, kind, ...(heightCm > 0 ? { heightCm } : {}) });
  }

  const points: VPoint[] = [];
  const pointCount = r.varint();
  for (let i = 0; i < pointCount; i++) {
    const kind = r.u8();
    const dir = r.u8();
    const x = unzigzag(r.varint());
    const z = unzigzag(r.varint());
    const name = r.varint() - 1;
    points.push({ x, z, kind, dir, name });
  }

  return { rx, rz, strings, buildings, roads, areas, lines, points };
}

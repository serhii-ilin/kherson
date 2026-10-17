import fs from "node:fs";
import zlib from "node:zlib";
import { toWorld } from "./project.ts";
import { VOXEL } from "../../src/world/constants.ts";

export type Tags = Record<string, string>;
export interface OsmWay {
  id: number;
  nodes: number[];
  tags: Tags;
}
export interface OsmMember {
  type: string;
  ref: number;
  role: string;
}
export interface OsmRelation {
  id: number;
  members: OsmMember[];
  tags: Tags;
}
export interface TaggedNode {
  id: number;
  cx: number;
  cz: number;
  tags: Tags;
}

/** Open-addressing hash map from node id to cell-unit coordinates, backed by typed arrays. */
export class NodeIndex {
  keys: Float64Array;
  xs: Float64Array;
  zs: Float64Array;
  mask: number;
  size = 0;
  constructor(cap = 1 << 20) {
    this.keys = new Float64Array(cap).fill(-1);
    this.xs = new Float64Array(cap);
    this.zs = new Float64Array(cap);
    this.mask = cap - 1;
  }
  private slot(id: number): number {
    const h = Math.imul((id | 0) ^ ((id / 4294967296) | 0), 0x9e3779b1);
    return (h ^ (h >>> 15)) & this.mask;
  }
  set(id: number, x: number, z: number): void {
    if ((this.size + 1) * 2 > this.keys.length) this.grow();
    let i = this.slot(id);
    while (this.keys[i] !== -1 && this.keys[i] !== id) i = (i + 1) & this.mask;
    if (this.keys[i] === -1) this.size++;
    this.keys[i] = id;
    this.xs[i] = x;
    this.zs[i] = z;
  }
  find(id: number): number {
    let i = this.slot(id);
    while (this.keys[i] !== -1) {
      if (this.keys[i] === id) return i;
      i = (i + 1) & this.mask;
    }
    return -1;
  }
  private grow(): void {
    const { keys, xs, zs } = this;
    const cap = keys.length * 2;
    this.keys = new Float64Array(cap).fill(-1);
    this.xs = new Float64Array(cap);
    this.zs = new Float64Array(cap);
    this.mask = cap - 1;
    this.size = 0;
    for (let i = 0; i < keys.length; i++) if (keys[i] !== -1) this.set(keys[i]!, xs[i]!, zs[i]!);
  }
}

export interface OsmData {
  nodes: NodeIndex;
  taggedNodes: TaggedNode[];
  ways: Map<number, OsmWay>;
  relations: OsmRelation[];
  counts: { nodes: number; ways: number; relations: number };
}

/** Stream-parse the top-level "elements" array of an Overpass JSON.gz without holding the whole text. */
export async function loadOsm(file: string): Promise<OsmData> {
  const data: OsmData = {
    nodes: new NodeIndex(),
    taggedNodes: [],
    ways: new Map(),
    relations: [],
    counts: { nodes: 0, ways: 0, relations: 0 },
  };
  const handle = (e: any): void => {
    if (e.type === "node") {
      if (typeof e.lat !== "number") return;
      const [x, z] = toWorld(e.lat, e.lon);
      const cx = x / VOXEL;
      const cz = z / VOXEL;
      data.nodes.set(e.id, cx, cz);
      data.counts.nodes++;
      if (e.tags) data.taggedNodes.push({ id: e.id, cx, cz, tags: e.tags });
    } else if (e.type === "way") {
      data.ways.set(e.id, { id: e.id, nodes: e.nodes ?? [], tags: e.tags ?? {} });
      data.counts.ways++;
    } else if (e.type === "relation") {
      data.relations.push({ id: e.id, members: e.members ?? [], tags: e.tags ?? {} });
      data.counts.relations++;
    }
  };

  const stream = fs.createReadStream(file).pipe(zlib.createGunzip());
  stream.setEncoding("utf8");
  let phase = 0; // 0: before elements '[', 1: inside array
  let depth = 0;
  let inString = false;
  let esc = false;
  let pending = "";
  let start = -1;
  for await (const chunk of stream as AsyncIterable<string>) {
    const n = chunk.length;
    let i = 0;
    if (phase === 0) {
      for (; i < n; i++) {
        const c = chunk.charCodeAt(i);
        if (inString) {
          if (esc) esc = false;
          else if (c === 92) esc = true;
          else if (c === 34) inString = false;
        } else if (c === 34) inString = true;
        else if (c === 91) {
          phase = 1;
          i++;
          break;
        }
      }
    }
    if (phase === 1) {
      for (; i < n; i++) {
        const c = chunk.charCodeAt(i);
        if (inString) {
          if (esc) esc = false;
          else if (c === 92) esc = true;
          else if (c === 34) inString = false;
          continue;
        }
        if (c === 34) inString = true;
        else if (c === 123) {
          if (depth === 0) start = i;
          depth++;
        } else if (c === 125) {
          depth--;
          if (depth === 0) {
            const s = pending + chunk.slice(start < 0 ? 0 : start, i + 1);
            pending = "";
            start = -1;
            handle(JSON.parse(s));
          }
        }
      }
      if (depth > 0) {
        pending += chunk.slice(start < 0 ? 0 : start);
        start = -1;
      }
    }
  }
  return data;
}

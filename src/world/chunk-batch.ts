import * as THREE from 'three';

/** Vertex data of one piece of a chunk: named attributes (all pieces of a batch share the set) and indices. */
export interface BatchGeom {
  /** name -> [array, itemSize]; must contain `position`. */
  attrs: Record<string, readonly [Float32Array, number]>;
  /** Indices local to this piece (0-based). */
  indices: Uint32Array;
  /** Bounding sphere radius padding in metres (e.g. water waves). */
  pad?: number;
}

/** One geometry + instance pair of the batch. Recycled through the free lists. */
export interface BatchSlot {
  geomId: number;
  instId: number;
  /** Size class key (vertex class, index class). */
  cls: number;
  vcap: number;
  icap: number;
  visible: boolean;
  /** Triangles of the geometry currently stored in the slot. */
  tris: number;
  live: boolean;
}

const CLASS_RATIO = 1.3;
const MIN_CLASS = 64;
const _m = new THREE.Matrix4();

/** Capacity of the smallest geometric size class holding `n` elements, and its ordinal. */
function sizeClass(n: number): [number, number] {
  let c = MIN_CLASS;
  let k = 0;
  while (c < n) {
    c = Math.ceil(c * CLASS_RATIO);
    k++;
  }
  return [c, k];
}

/**
 * Coarse chunk meshes merged into one THREE.BatchedMesh: a single draw call (and a single shadow-pass
 * call) for every chunk, with per-instance frustum culling in both passes. BatchedMesh only appends
 * geometry, so freed slots are kept and recycled by size class instead of deleted.
 */
export class ChunkBatch {
  readonly mesh: THREE.BatchedMesh;
  private readonly free = new Map<number, BatchSlot[]>();
  private maxInstances: number;
  private maxVerts: number;
  private usedInstances = 0;
  private usedVerts = 0;
  private maxIdx: number;
  private usedIdx = 0;
  /** Triangles of visible, live slots. */
  triangles = 0;

  constructor(material: THREE.Material, opts: { instances?: number; vertices?: number; castShadow?: boolean } = {}) {
    const instances = opts.instances ?? 512;
    const vertices = opts.vertices ?? 600_000;
    this.maxInstances = instances;
    this.maxVerts = vertices;
    this.maxIdx = Math.ceil(vertices * 1.5);
    this.mesh = new THREE.BatchedMesh(instances, vertices, this.maxIdx, material);
    this.mesh.sortObjects = false;
    this.mesh.frustumCulled = false; // per-instance culling instead
    this.mesh.castShadow = opts.castShadow ?? true;
    this.mesh.receiveShadow = true;
  }

  /** Adds a piece at world offset (x, 0, z). */
  add(g: BatchGeom, x: number, z: number): BatchSlot {
    const nv = g.attrs.position![0].length / g.attrs.position![1];
    const [vcap, vk] = sizeClass(nv);
    const [icap, ik] = sizeClass(g.indices.length);
    const cls = vk * 1000 + ik;
    const list = this.free.get(cls);
    let slot = list !== undefined ? list.pop() : undefined;
    const geo = new THREE.BufferGeometry();
    for (const name in g.attrs) geo.setAttribute(name, new THREE.BufferAttribute(g.attrs[name]![0], g.attrs[name]![1]));
    geo.setIndex(new THREE.BufferAttribute(g.indices, 1));
    geo.computeBoundingSphere();
    if (g.pad) geo.boundingSphere!.radius += g.pad;
    if (slot === undefined) {
      this.reserve(vcap, icap);
      const geomId = this.mesh.addGeometry(geo, vcap, icap);
      const instId = this.mesh.addInstance(geomId);
      slot = { geomId, instId, cls, vcap, icap, visible: true, tris: 0, live: false };
    } else {
      this.mesh.setGeometryAt(slot.geomId, geo);
    }
    geo.dispose();
    _m.makeTranslation(x, 0, z);
    this.mesh.setMatrixAt(slot.instId, _m);
    slot.live = true;
    slot.tris = g.indices.length / 3;
    slot.visible = true;
    this.mesh.setVisibleAt(slot.instId, true);
    this.triangles += slot.tris;
    return slot;
  }

  /** Makes room for another geometry of the given reserved sizes and a free instance. */
  private reserve(verts: number, idx: number): void {
    if (this.usedInstances + 1 > this.maxInstances) {
      this.maxInstances = Math.ceil(this.maxInstances * 1.5);
      this.mesh.setInstanceCount(this.maxInstances);
    }
    if (this.usedVerts + verts > this.maxVerts || this.usedIdx + idx > this.maxIdx) {
      this.maxVerts = Math.ceil(Math.max(this.maxVerts * 1.5, this.usedVerts + verts));
      this.maxIdx = Math.ceil(Math.max(this.maxIdx * 1.5, this.usedIdx + idx));
      this.mesh.setGeometrySize(this.maxVerts, this.maxIdx);
    }
    this.usedInstances++;
    this.usedVerts += verts;
    this.usedIdx += idx;
  }

  setVisible(slot: BatchSlot, visible: boolean): void {
    if (!slot.live || slot.visible === visible) return;
    slot.visible = visible;
    this.mesh.setVisibleAt(slot.instId, visible);
    this.triangles += visible ? slot.tris : -slot.tris;
  }

  /** Hides the slot and returns it to the pool. */
  remove(slot: BatchSlot): void {
    if (!slot.live) return;
    this.setVisible(slot, false);
    slot.live = false;
    let list = this.free.get(slot.cls);
    if (list === undefined) this.free.set(slot.cls, (list = []));
    list.push(slot);
  }

  get capacityVertices(): number { return this.maxVerts; }

  dispose(): void {
    this.mesh.dispose();
  }
}

import * as THREE from 'three';
import {
  CHUNK,
  F_GROUND_H,
  F_GROUND_MAT,
  F_STRUCT_H,
  REGION,
  REGION_CHUNKS,
  VOXEL,
} from './constants.ts';
import { FEATURE_BRIDGE_DECK, FEATURE_TREE, decodeRegion, type RegionData } from './format.ts';
import { jitterX, jitterZ } from '../nature/placement.ts';
import type { Manifest } from './manifest.ts';
import { MAT } from './materials.ts';
import { facadeShader } from './facade-shader.ts';
import { QuadBuilder, edgeTops, type ChunkMesh, type EdgeKey, type RegionEdges, type WaterMesh } from './mesher.ts';
import type { MeshRequest, MeshResponse } from './mesher.worker.ts';
import {
  CHUNK_M,
  DIR_NX,
  DIR_NZ,
  DIR_PX,
  DIR_PZ,
  REGION_M,
  chunkKey,
  distToChunk,
  edgeDirs,
  neededChunks,
  regionKey,
  type ChunkRef,
} from './stream-math.ts';

export interface StreamerOptions {
  /** Radius (metres) around the camera in which chunk meshes are kept. */
  viewRadius?: number;
  /** Shared material for tessellated water; a plain blue fallback is used when omitted. */
  waterMaterial?: THREE.Material;
}

const MAX_REGIONS = 24;
const MAX_JOBS = 8;
const MAX_JOBS_PER_WORKER = 2;
const MAX_FETCHES = 4;
const HYSTERESIS = 64;
const RETRY_MS = 10000;
const DEFAULT_GROUND_H = 2;
const PLANE = REGION * REGION;
const UNKNOWN = -1;

type RegionState = 'idle' | 'loading' | 'loaded' | 'empty' | 'failed';

interface Entry {
  rx: number;
  rz: number;
  key: number;
  file: string | null;
  state: RegionState;
  data: RegionData | null;
  buffer: ArrayBuffer | null;
  /** cell index -> bridge deck top in voxels */
  decks: Map<number, number> | null;
  /** Chunk keys holding trunk index entries of this region. */
  trunkChunks: number[] | null;
  /** Bit per worker that has received this region's buffer. */
  sentMask: number;
  lastUsed: number;
  failedAt: number;
}

interface Chunk {
  key: number;
  gcx: number;
  gcz: number;
  mesh: THREE.Mesh | null;
  water: THREE.Mesh | null;
  /** DIR_* bits whose neighbour edge info was used for the current mesh. */
  edgeMask: number;
  busy: boolean;
  disposed: boolean;
}

interface Job {
  id: number;
  chunk: Chunk;
  entry: Entry;
  worker: number;
  mask: number;
  edges: RegionEdges | undefined;
}

const EMPTY_EDGE = new Uint8Array(REGION).fill(DEFAULT_GROUND_H);

export class WorldStreamer {
  readonly viewRadius: number;
  readonly material = new THREE.MeshLambertMaterial({ vertexColors: true });
  readonly waterMaterial: THREE.Material;
  private readonly ownsWaterMaterial: boolean;

  private readonly scene: THREE.Scene;
  private readonly manifest: Manifest;
  private readonly baseUrl: string;
  private readonly chunksX: number;
  private readonly chunksZ: number;

  /** Called when a region's data arrives (RegionData) or is evicted (null). */
  onRegionData?: (rx: number, rz: number, data: RegionData | null) => void;

  private readonly regions = new Map<number, Entry>();
  /** chunk key -> flat [x, z, x, z, ...] of tree trunk centres (metres). */
  private readonly trunks = new Map<number, Float32Array>();
  private readonly chunks = new Map<number, Chunk>();
  private readonly emptyQuads = new Map<number, THREE.Mesh>();
  private emptyGeometry: THREE.BufferGeometry | null = null;

  private readonly workers: Worker[] = [];
  private readonly workerLoad: number[] = [];
  private readonly jobs = new Map<number, Job>();
  private nextJobId = 1;
  private inflight = 0;
  private fetchActive = 0;

  private need: ChunkRef[] = [];
  private pending = new Int32Array(1024);
  private pendingCount = 0;
  private camX = 0;
  private camZ = 0;
  private lastGcx = -1e9;
  private lastGcz = -1e9;
  private dirty = false;
  private tick = 0;
  private loadedCount = 0;
  private meshCount = 0;
  private triCount = 0;
  private lastEntry: Entry | null = null;
  private sampleWater = false;

  constructor(scene: THREE.Scene, manifest: Manifest, opts: StreamerOptions = {}) {
    this.scene = scene;
    this.manifest = manifest;
    this.viewRadius = opts.viewRadius ?? 640;
    this.material.onBeforeCompile = facadeShader;
    this.ownsWaterMaterial = opts.waterMaterial === undefined;
    this.waterMaterial = opts.waterMaterial ?? new THREE.MeshBasicMaterial({ color: 0x3b78b8 });
    this.baseUrl = `${import.meta.env.BASE_URL}world/`;
    this.chunksX = manifest.regionsX * REGION_CHUNKS;
    this.chunksZ = manifest.regionsZ * REGION_CHUNKS;
    const n = Math.min(4, Math.max(1, (navigator.hardwareConcurrency || 2) - 1));
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL('./mesher.worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent<MeshResponse>) => this.onResult(i, e.data);
      this.workers.push(w);
      this.workerLoad.push(0);
    }
  }

  get loadedRegions(): number { return this.loadedCount; }
  get chunkCount(): number { return this.meshCount; }
  get inflightJobs(): number { return this.inflight; }
  get triangles(): number { return this.triCount; }

  /** Call once per frame; does real work only when the camera crosses a chunk boundary or data arrived. */
  update(x: number, z: number): void {
    this.camX = x;
    this.camZ = z;
    const gcx = Math.floor(x / CHUNK_M);
    const gcz = Math.floor(z / CHUNK_M);
    if (gcx !== this.lastGcx || gcz !== this.lastGcz) {
      this.lastGcx = gcx;
      this.lastGcz = gcz;
      this.recompute();
      this.pump();
    } else if (this.dirty) {
      this.pump();
    }
  }

  /**
   * Radius around (x, z) within which chunk meshes are complete; the overview is cut out
   * only inside it so unloaded areas still show far terrain.
   */
  holeRadius(x: number, z: number): number {
    let r = this.viewRadius - 32;
    for (let i = 0; i < this.pendingCount; i++) {
      const p = this.pending[i]!;
      const d = distToChunk(x, z, p % 4096, Math.floor(p / 4096)) - 4;
      if (d < r) r = d;
    }
    return r > 0 ? r : 0;
  }

  /**
   * Top surface in metres at world (x, z), or null when outside the world or not loaded.
   * With `refY`, bridge decks above refY are ignored (so walkers can pass under them).
   * Water cells return groundH * VOXEL; query isWater() for the flag.
   */
  heightAt(x: number, z: number, refY?: number): number | null {
    const h = this.sample(x, z, refY);
    return h === UNKNOWN ? null : h;
  }

  isWater(x: number, z: number, refY?: number): boolean {
    return this.sample(x, z, refY) !== UNKNOWN && this.sampleWater;
  }

  /** Ground material of the cell at (x, z), or null when not loaded. */
  groundMatAt(x: number, z: number): number | null {
    if (x < 0 || z < 0) return null;
    const rx = Math.floor(x / REGION_M);
    const rz = Math.floor(z / REGION_M);
    const e = this.regions.get(regionKey(rx, rz));
    if (e === undefined) return null;
    if (e.state === 'empty') return MAT.GRASS;
    if (e.data === null) return null;
    const i = (Math.floor(z / VOXEL) - rz * REGION) * REGION + Math.floor(x / VOXEL) - rx * REGION;
    return e.data.cells[PLANE * F_GROUND_MAT + i]!;
  }

  dispose(): void {
    for (const w of this.workers) w.terminate();
    for (const c of this.chunks.values()) this.freeChunk(c);
    this.chunks.clear();
    for (const m of this.emptyQuads.values()) this.scene.remove(m);
    this.emptyQuads.clear();
    this.emptyGeometry?.dispose();
    this.material.dispose();
    if (this.ownsWaterMaterial) this.waterMaterial.dispose();
  }

  // ---------------------------------------------------------------- sampling

  /** Returns UNKNOWN (-1) when not loaded; sets sampleWater. */
  private sample(x: number, z: number, refY: number | undefined): number {
    this.sampleWater = false;
    if (x < 0 || z < 0) return UNKNOWN;
    const rx = Math.floor(x / REGION_M);
    const rz = Math.floor(z / REGION_M);
    let e = this.lastEntry;
    if (e === null || e.rx !== rx || e.rz !== rz) {
      e = this.regions.get(regionKey(rx, rz)) ?? null;
      if (e === null) return UNKNOWN;
      this.lastEntry = e;
    }
    if (e.state === 'empty') return DEFAULT_GROUND_H * VOXEL;
    const data = e.data;
    if (data === null) return UNKNOWN;
    const cx = Math.floor(x / VOXEL) - rx * REGION;
    const cz = Math.floor(z / VOXEL) - rz * REGION;
    const i = cz * REGION + cx;
    const cells = data.cells;
    const gh = cells[PLANE * F_GROUND_H + i]!;
    const sh = cells[PLANE * F_STRUCT_H + i]!;
    const base = (gh + sh) * VOXEL;
    const deck = e.decks !== null ? e.decks.get(i) : undefined;
    if (deck !== undefined) {
      const top = deck * VOXEL;
      if (refY === undefined || top <= refY) return top > base ? top : base;
    }
    if (sh === 0 && cells[PLANE * F_GROUND_MAT + i] === MAT.WATER) {
      this.sampleWater = true;
      return gh * VOXEL;
    }
    return base;
  }

  // ---------------------------------------------------------------- trunks

  /**
   * True when a tree trunk centre lies within r metres of (x, z). Only trees block, not bushes;
   * trunks are indexed per chunk when a region's data arrives.
   */
  trunkNear(x: number, z: number, r: number): boolean {
    const r2 = r * r;
    // trunks are filed under their cell's chunk; jitter moves them < 0.7 m away from it
    const m = r + 0.75;
    const gx0 = Math.floor((x - m) / CHUNK_M), gx1 = Math.floor((x + m) / CHUNK_M);
    const gz0 = Math.floor((z - m) / CHUNK_M), gz1 = Math.floor((z + m) / CHUNK_M);
    for (let gz = gz0; gz <= gz1; gz++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        const t = this.trunks.get(chunkKey(gx, gz));
        if (t === undefined) continue;
        for (let i = 0; i < t.length; i += 2) {
          const dx = t[i]! - x, dz = t[i + 1]! - z;
          if (dx * dx + dz * dz < r2) return true;
        }
      }
    }
    return false;
  }

  private indexTrunks(e: Entry): void {
    const data = e.data;
    if (data === null) return;
    const lists = new Map<number, number[]>();
    for (const f of data.features) {
      if (f.type !== FEATURE_TREE) continue;
      const x = e.rx * REGION_M + (f.x + 0.5 + jitterX(f.seed)) * VOXEL;
      const z = e.rz * REGION_M + (f.z + 0.5 + jitterZ(f.seed)) * VOXEL;
      const k = chunkKey(e.rx * REGION_CHUNKS + Math.floor(f.x / CHUNK), e.rz * REGION_CHUNKS + Math.floor(f.z / CHUNK));
      let l = lists.get(k);
      if (l === undefined) lists.set(k, (l = []));
      l.push(x, z);
    }
    if (lists.size === 0) return;
    e.trunkChunks = [];
    for (const [k, l] of lists) {
      this.trunks.set(k, Float32Array.from(l));
      e.trunkChunks.push(k);
    }
  }

  private unindexTrunks(e: Entry): void {
    if (e.trunkChunks === null) return;
    for (const k of e.trunkChunks) this.trunks.delete(k);
    e.trunkChunks = null;
  }

  // ---------------------------------------------------------------- regions

  private getEntry(rx: number, rz: number): Entry | null {
    if (rx < 0 || rz < 0 || rx >= this.manifest.regionsX || rz >= this.manifest.regionsZ) return null;
    const key = regionKey(rx, rz);
    let e = this.regions.get(key);
    if (e === undefined) {
      const file = this.manifest.regions[`${rx},${rz}`];
      const isEmpty = file === undefined || file === 'empty';
      e = {
        rx, rz, key, file: isEmpty ? null : file, state: isEmpty ? 'empty' : 'idle',
        data: null, buffer: null, decks: null, trunkChunks: null, sentMask: 0, lastUsed: this.tick, failedAt: 0,
      };
      this.regions.set(key, e);
    }
    return e;
  }

  /** Starts a fetch if allowed; returns true when the region is (now) loading. */
  private startFetch(e: Entry): boolean {
    if (e.state === 'loading') return true;
    if (e.state === 'failed' && performance.now() - e.failedAt < RETRY_MS) return false;
    if (e.state !== 'idle' && e.state !== 'failed') return false;
    if (this.fetchActive >= MAX_FETCHES) return false;
    e.state = 'loading';
    this.fetchActive++;
    fetch(this.baseUrl + e.file!)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.arrayBuffer();
      })
      .then((buf) => {
        const data = decodeRegion(buf);
        let decks: Map<number, number> | null = null;
        for (const f of data.features) {
          if (f.type !== FEATURE_BRIDGE_DECK) continue;
          decks ??= new Map();
          const i = f.z * REGION + f.x;
          const top = f.param + 1;
          if ((decks.get(i) ?? 0) < top) decks.set(i, top);
        }
        e.data = data;
        e.buffer = buf;
        e.decks = decks;
        e.sentMask = 0;
        e.state = 'loaded';
        this.loadedCount++;
        this.indexTrunks(e);
        this.onRegionData?.(e.rx, e.rz, data);
        this.evictRegions();
      })
      .catch((err) => {
        console.warn(`region ${e.rx},${e.rz} failed`, err);
        e.state = 'failed';
        e.failedAt = performance.now();
      })
      .finally(() => {
        this.fetchActive--;
        this.dirty = true;
        this.pump();
      });
    return true;
  }

  private evictRegions(): void {
    while (this.loadedCount > MAX_REGIONS) {
      let victim: Entry | null = null;
      for (const e of this.regions.values()) {
        if (e.state !== 'loaded' || e.lastUsed >= this.tick) continue;
        if (victim === null || e.lastUsed < victim.lastUsed) victim = e;
      }
      if (victim === null) return; // everything is in use
      this.regions.delete(victim.key);
      this.unindexTrunks(victim);
      this.onRegionData?.(victim.rx, victim.rz, null);
      if (this.lastEntry === victim) this.lastEntry = null;
      this.loadedCount--;
    }
  }

  // ---------------------------------------------------------------- chunk scheduling

  private recompute(): void {
    this.need = neededChunks(this.camX, this.camZ, this.viewRadius, this.chunksX, this.chunksZ);
    const keep = this.viewRadius + HYSTERESIS;
    for (const c of this.chunks.values()) {
      if (distToChunk(this.camX, this.camZ, c.gcx, c.gcz) > keep) {
        this.chunks.delete(c.key);
        this.freeChunk(c);
      }
    }
    // flat quads for all-default regions
    for (const ref of this.need) {
      const rx = Math.floor(ref.gcx / REGION_CHUNKS);
      const rz = Math.floor(ref.gcz / REGION_CHUNKS);
      const k = regionKey(rx, rz);
      if (this.emptyQuads.has(k)) continue;
      const e = this.getEntry(rx, rz);
      if (e !== null && e.state === 'empty') this.addEmptyQuad(rx, rz, k);
    }
    for (const [k, m] of this.emptyQuads) {
      const rx = k % 4096;
      const rz = Math.floor(k / 4096);
      const dx = Math.max(rx * REGION_M - this.camX, 0, this.camX - (rx + 1) * REGION_M);
      const dz = Math.max(rz * REGION_M - this.camZ, 0, this.camZ - (rz + 1) * REGION_M);
      if (Math.hypot(dx, dz) > keep) {
        this.scene.remove(m);
        this.emptyQuads.delete(k);
        this.triCount -= 2;
      }
    }
    this.dirty = true;
  }

  private addEmptyQuad(rx: number, rz: number, k: number): void {
    if (this.emptyGeometry === null) {
      const b = new QuadBuilder();
      b.top(0, REGION_M, DEFAULT_GROUND_H * VOXEL, 0, REGION_M, MAT.GRASS);
      const g = this.geometryFrom(b.build());
      this.emptyGeometry = g;
    }
    const m = new THREE.Mesh(this.emptyGeometry, this.material);
    m.receiveShadow = true;
    m.position.set(rx * REGION_M, 0, rz * REGION_M);
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    this.scene.add(m);
    this.emptyQuads.set(k, m);
    this.triCount += 2;
  }

  private addPending(ref: ChunkRef): void {
    if (this.pendingCount === this.pending.length) {
      const bigger = new Int32Array(this.pending.length * 2);
      bigger.set(this.pending);
      this.pending = bigger;
    }
    this.pending[this.pendingCount++] = chunkKey(ref.gcx, ref.gcz);
  }

  private pump(): void {
    this.dirty = false;
    this.tick++;
    this.pendingCount = 0;
    const need = this.need;
    for (let i = 0; i < need.length; i++) {
      const ref = need[i]!;
      const rx = Math.floor(ref.gcx / REGION_CHUNKS);
      const rz = Math.floor(ref.gcz / REGION_CHUNKS);
      const entry = this.getEntry(rx, rz);
      if (entry === null) continue;
      entry.lastUsed = this.tick;
      if (entry.state === 'empty') continue;
      if (entry.state !== 'loaded') {
        this.startFetch(entry);
        if (entry.state !== 'failed') this.addPending(ref);
        continue;
      }

      const key = chunkKey(ref.gcx, ref.gcz);
      let chunk = this.chunks.get(key);
      const dirs = edgeDirs(ref.gcx, ref.gcz);
      let avail = 0;
      let blocked = false;
      if (dirs !== 0) {
        for (let d = 1; d <= 8; d <<= 1) {
          if ((dirs & d) === 0) continue;
          const n = this.getEntry(rx + (d === DIR_PX ? 1 : d === DIR_NX ? -1 : 0), rz + (d === DIR_PZ ? 1 : d === DIR_NZ ? -1 : 0));
          if (n === null) continue;
          n.lastUsed = this.tick;
          if (n.state === 'loaded' || n.state === 'empty') avail |= d;
          else if (n.state !== 'failed' || performance.now() - n.failedAt >= RETRY_MS) {
            this.startFetch(n);
            if (n.state !== 'failed') blocked = true;
          }
        }
      }

      if (chunk !== undefined) {
        if (chunk.busy) {
          if (chunk.mesh === null) this.addPending(ref);
          continue;
        }
        if ((avail & ~chunk.edgeMask) === 0) continue; // up to date
      } else if (blocked) {
        this.addPending(ref);
        continue;
      }
      if (this.inflight >= MAX_JOBS) {
        if (chunk === undefined || chunk.mesh === null) this.addPending(ref);
        continue;
      }
      if (chunk === undefined) {
        chunk = { key, gcx: ref.gcx, gcz: ref.gcz, mesh: null, water: null, edgeMask: 0, busy: false, disposed: false };
        this.chunks.set(key, chunk);
      }
      if (!this.dispatch(chunk, entry, avail) && chunk.mesh === null) this.addPending(ref);
    }
  }

  private buildEdges(entry: Entry, mask: number): RegionEdges | undefined {
    if (mask === 0) return undefined;
    const edges: RegionEdges = {};
    for (let d = 1; d <= 8; d <<= 1) {
      if ((mask & d) === 0) continue;
      const key: EdgeKey = d === DIR_PX ? 'px' : d === DIR_NX ? 'nx' : d === DIR_PZ ? 'pz' : 'nz';
      const n = this.getEntry(
        entry.rx + (d === DIR_PX ? 1 : d === DIR_NX ? -1 : 0),
        entry.rz + (d === DIR_PZ ? 1 : d === DIR_NZ ? -1 : 0),
      );
      if (n === null) continue;
      edges[key] = n.data !== null ? edgeTops(n.data.cells, key) : EMPTY_EDGE;
    }
    return edges;
  }

  private dispatch(chunk: Chunk, entry: Entry, mask: number): boolean {
    // prefer a worker that already holds the region, then the least loaded one
    let best = -1;
    let bestScore = -1;
    for (let i = 0; i < this.workers.length; i++) {
      const load = this.workerLoad[i]!;
      if (load >= MAX_JOBS_PER_WORKER) continue;
      const score = ((entry.sentMask >> i) & 1) * 8 + (MAX_JOBS_PER_WORKER - load);
      if (score > bestScore) { bestScore = score; best = i; }
    }
    if (best < 0) return false;
    const job: Job = {
      id: this.nextJobId++, chunk, entry, worker: best, mask, edges: this.buildEdges(entry, mask),
    };
    chunk.busy = true;
    this.send(job, false);
    return true;
  }

  private send(job: Job, forceBuffer: boolean): void {
    const { entry, worker } = job;
    const has = ((entry.sentMask >> worker) & 1) === 1;
    const req: MeshRequest = {
      id: job.id,
      region: entry.key,
      cx: job.chunk.gcx - entry.rx * REGION_CHUNKS,
      cz: job.chunk.gcz - entry.rz * REGION_CHUNKS,
      edges: job.edges,
    };
    if (forceBuffer || !has) {
      req.buffer = entry.buffer!;
      entry.sentMask |= 1 << worker;
    }
    this.jobs.set(job.id, job);
    this.workerLoad[worker]!++;
    this.inflight++;
    this.workers[worker]!.postMessage(req);
  }

  private onResult(wi: number, msg: MeshResponse): void {
    const job = this.jobs.get(msg.id);
    if (job === undefined) return;
    this.jobs.delete(msg.id);
    this.workerLoad[wi]!--;
    this.inflight--;
    const chunk = job.chunk;

    if (msg.missing) {
      job.entry.sentMask &= ~(1 << wi);
      if (!chunk.disposed && job.entry.buffer !== null && this.workerLoad[wi]! < MAX_JOBS_PER_WORKER) {
        job.id = this.nextJobId++;
        this.send(job, true);
        return;
      }
      chunk.busy = false;
      if (chunk.mesh === null && !chunk.disposed) {
        this.chunks.delete(chunk.key);
        chunk.disposed = true;
      }
    } else if (msg.mesh !== undefined) {
      chunk.busy = false;
      if (!chunk.disposed) this.setChunkMesh(chunk, msg.mesh, job.entry, job.mask);
    }
    this.dirty = true;
    this.pump();
  }

  private geometryFrom(mesh: ChunkMesh): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
    g.setAttribute('color', new THREE.BufferAttribute(mesh.colors, 3));
    g.setAttribute('aWall', new THREE.BufferAttribute(mesh.walls, 4));
    g.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    g.computeBoundingSphere();
    return g;
  }

  private setChunkMesh(chunk: Chunk, mesh: ChunkMesh & { water: WaterMesh | null }, entry: Entry, mask: number): void {
    const geometry = this.geometryFrom(mesh);
    if (chunk.mesh !== null) {
      this.triCount -= chunk.mesh.geometry.index!.count / 3;
      chunk.mesh.geometry.dispose();
      chunk.mesh.geometry = geometry;
    } else {
      const m = new THREE.Mesh(geometry, this.material);
      m.castShadow = true;
      m.receiveShadow = true;
      m.position.set(entry.rx * REGION_M, 0, entry.rz * REGION_M);
      m.matrixAutoUpdate = false;
      m.updateMatrix();
      this.scene.add(m);
      chunk.mesh = m;
      this.meshCount++;
    }
    this.triCount += mesh.indices.length / 3;
    this.setChunkWater(chunk, mesh.water, entry);
    chunk.edgeMask = mask;
  }

  private setChunkWater(chunk: Chunk, water: WaterMesh | null, entry: Entry): void {
    if (chunk.water !== null) {
      this.scene.remove(chunk.water);
      this.triCount -= chunk.water.geometry.index!.count / 3;
      chunk.water.geometry.dispose();
      chunk.water = null;
    }
    if (water === null) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(water.positions, 3));
    g.setAttribute('shore', new THREE.BufferAttribute(water.shore, 1));
    g.setIndex(new THREE.BufferAttribute(water.indices, 1));
    g.computeBoundingSphere();
    // waves lift the surface by up to ~0.5 m; keep the culling sphere conservative
    g.boundingSphere!.radius += 1;
    const m = new THREE.Mesh(g, this.waterMaterial);
    m.position.set(entry.rx * REGION_M, 0, entry.rz * REGION_M);
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    m.renderOrder = 1;
    this.scene.add(m);
    chunk.water = m;
    this.triCount += water.indices.length / 3;
  }

  private freeChunk(c: Chunk): void {
    c.disposed = true;
    if (c.water !== null) {
      this.scene.remove(c.water);
      this.triCount -= c.water.geometry.index!.count / 3;
      c.water.geometry.dispose();
      c.water = null;
    }
    if (c.mesh === null) return;
    this.scene.remove(c.mesh);
    this.triCount -= c.mesh.geometry.index!.count / 3;
    c.mesh.geometry.dispose();
    c.mesh = null;
    this.meshCount--;
  }
}

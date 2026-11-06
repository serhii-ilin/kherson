/**
 * Streams extruded building meshes for every chunk inside the view radius (the whole city, as the
 * camera moves). Vector tiles and the coarse ground window are the same inputs the fine tier uses.
 * Meshing runs in a worker. Buildings in a chunk are one geometry, and every chunk is an instance
 * of a single BatchedMesh.
 *
 * A finished chunk hides its coarse voxel walls and roofs (the ground stays). Chunks that contain a
 * coarse bridge deck are left alone so the deck is not deleted. Chunks outside the radius stay voxels.
 */
import * as THREE from 'three';
import { FEATURE_BRIDGE_DECK } from '../world/format.ts';
import { buildBlockInput, G_GH, GPLANE } from '../fine/block-input.ts';
import type { Manifest } from '../world/manifest.ts';
import { ChunkBatch, type BatchSlot } from '../world/chunk-batch.ts';
import { CHUNK, REGION_CHUNKS } from '../world/constants.ts';
import { CHUNK_M, chunkKey, neededChunks, regionKey, type ChunkRef } from '../world/stream-math.ts';
import type { WorldStreamer } from '../world/streamer.ts';
import { versioned } from '../version.ts';
import { MESH_KEEP, chunkLod, type MeshLod } from './bounds.ts';
import { createFacadeMaterial } from './facade.ts';
import type { CityMeshHidden, CityMeshRequest, CityMeshResponse, MeshTileRef } from './protocol.ts';

const MAX_TILES = 48;
const MAX_FETCHES = 4;
const MAX_JOBS = 2;
const RETRY_MS = 10000;
const WAIT_RETRY_MS = 400;
const MAGIC = [0x56, 0x4b, 0x56, 0x31];

type TileState = 'idle' | 'loading' | 'loaded' | 'none' | 'failed';

interface Tile {
  rx: number;
  rz: number;
  key: number;
  state: TileState;
  buffer: ArrayBuffer | null;
  sentMask: number;
  lastUsed: number;
  failedAt: number;
}

interface MChunk {
  key: number;
  gcx: number;
  gcz: number;
  slot: BatchSlot | null;
  tris: number;
  bytes: number;
  hidden: boolean;
  /** The worker has returned and voxel buildings for this chunk may be hidden. */
  ready: boolean;
  disposed: boolean;
  /** Detail level of the installed slot; null while the first result is in flight. */
  lod: MeshLod | null;
  /** Detail level of the job in flight, or null. */
  pending: MeshLod | null;
  /** Rebuild the installed chunk even though its LOD has not changed (hidden set changed). */
  reload: boolean;
}

interface Job {
  id: number;
  chunk: MChunk;
  worker: number;
  tiles: Tile[];
  lod: MeshLod;
}

export interface MeshStreamerOptions {
  /** Metres. Laptop High is 640, phone / Low is 384 (the coarse view radius). */
  radius: number;
  /** When false, meshes are built but do not cast shadows (Low quality). */
  castShadow: boolean;
  /** Metres. Near LOD with real openings; 0 disables it (default). */
  nearRadius?: number;
  workers?: number;
}

/**
 * Extruded buildings for the loaded view. Coarse voxels show again where a chunk is dropped.
 */
export class MeshStreamer {
  private readonly scene: THREE.Scene;
  private readonly coarse: WorldStreamer;
  private readonly manifest: Manifest;
  private readonly baseUrl: string;
  private readonly material: THREE.MeshStandardMaterial;
  private readonly batch: ChunkBatch;
  private readonly workers: Worker[] = [];
  private readonly workerLoad: number[] = [];
  private readonly tiles = new Map<number, Tile>();
  private readonly chunks = new Map<number, MChunk>();
  private readonly jobs = new Map<number, Job>();
  private readonly needed: Tile[] = [];
  private need: ChunkRef[] = [];
  private nextJobId = 1;
  private inflight = 0;
  private fetchActive = 0;
  private loadedTiles = 0;
  private tick = 0;
  private camX = 0;
  private camZ = 0;
  private lastGcx = -1e9;
  private lastGcz = -1e9;
  private dirty = false;
  private waiting = false;
  private lastTry = 0;
  private readonly radius: number;
  private readonly nearRadius: number;
  private meshCount = 0;
  private triCount = 0;
  private byteCount = 0;
  private nearCount = 0;
  private nearTriCount = 0;
  private downloadBytes = 0;

  constructor(scene: THREE.Scene, coarse: WorldStreamer, manifest: Manifest, opts: MeshStreamerOptions) {
    this.scene = scene;
    this.coarse = coarse;
    this.manifest = manifest;
    this.radius = opts.radius;
    this.nearRadius = opts.nearRadius ?? 0;
    this.material = createFacadeMaterial();
    // A 640 m view is on the order of 150k vertices (about 40 triangles and ~6 KB per building).
    // ChunkBatch grows if a dense view exceeds this. Staying near 200k vertices keeps the
    // reservation under the ADR's 20 MB laptop budget.
    this.batch = new ChunkBatch(this.material, { instances: 800, vertices: 200_000, castShadow: opts.castShadow });
    scene.add(this.batch.mesh);
    this.baseUrl = `${import.meta.env.BASE_URL}world/`;
    const n = Math.max(1, Math.min(2, opts.workers ?? 1));
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL('./mesh.worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent<CityMeshResponse>) => this.onResult(i, e.data);
      this.workers.push(w);
      this.workerLoad.push(0);
    }
  }

  get chunkCount(): number { return this.meshCount; }
  get inflightJobs(): number { return this.inflight; }
  get triangles(): number { return this.triCount; }
  /** Installed chunks built at the near LOD. */
  get nearChunks(): number { return this.nearCount; }
  /** Triangles of the installed near-LOD chunks. */
  get nearTriangles(): number { return this.nearTriCount; }
  /** Vertex and index buffers of the installed meshes. */
  get gpuBytes(): number { return this.byteCount; }
  /** Bytes of vector tiles this streamer has fetched (the fine tier may fetch the same files). */
  get downloadedBytes(): number { return this.downloadBytes; }

  /**
   * True when every chunk that can be built (its coarse regions are loaded) has a result, and nothing
   * is in flight. Chunks outside the coarse view radius wait until those regions stream in.
   */
  get isSettled(): boolean {
    if (this.inflight > 0 || this.fetchActive > 0) return false;
    for (const ref of this.need) {
      const chunk = this.chunks.get(chunkKey(ref.gcx, ref.gcz));
      if (chunk === undefined) {
        if (this.regionsReady(ref.gcx, ref.gcz)) return false;
        continue;
      }
      if (chunk.pending !== null || chunk.reload || chunk.lod === null) return false;
      if (chunkLod(ref.dist, chunk.lod, this.nearRadius) !== chunk.lod) return false;
    }
    return this.need.length > 0;
  }

  /**
   * Replaces the hidden-building set (landmarks / facade descriptors) in every worker and rebuilds
   * the installed chunks. Rare call; the old slots stay visible until each new result arrives.
   */
  setHiddenBuildings(keys: ReadonlySet<string>): void {
    const list = [...keys];
    for (const w of this.workers) w.postMessage({ type: 'hidden', keys: list } satisfies CityMeshHidden);
    for (const chunk of this.chunks.values()) {
      if (chunk.lod !== null) chunk.reload = true;
    }
    this.dirty = true;
    this.pump();
  }

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
    } else if (this.dirty || (this.waiting && performance.now() - this.lastTry > WAIT_RETRY_MS)) {
      this.pump();
    }
  }

  dispose(): void {
    this.dropAll();
    for (const w of this.workers) w.terminate();
    this.scene.remove(this.batch.mesh);
    this.batch.dispose();
    this.material.dispose();
  }

  private recompute(): void {
    const chunksX = this.manifest.regionsX * REGION_CHUNKS;
    const chunksZ = this.manifest.regionsZ * REGION_CHUNKS;
    const keep = neededChunks(this.camX, this.camZ, this.radius + MESH_KEEP, chunksX, chunksZ);
    const keepKeys = new Set(keep.map((r) => chunkKey(r.gcx, r.gcz)));
    this.need = keep.filter((r) => r.dist <= this.radius);
    for (const c of [...this.chunks.values()]) {
      if (!keepKeys.has(c.key)) {
        this.chunks.delete(c.key);
        this.drop(c);
      }
    }
    this.dirty = true;
  }

  private dropAll(): void {
    for (const c of [...this.chunks.values()]) this.drop(c);
    this.chunks.clear();
    this.need = [];
  }

  private pump(): void {
    this.dirty = false;
    this.waiting = false;
    this.lastTry = performance.now();
    this.tick++;
    const maxJobs = this.workers.length * MAX_JOBS;
    // Near jobs go first; mid chunks and mid→near or near→mid swaps follow.
    for (const pass of ['near', 'mid'] as const) {
      for (const ref of this.need) {
        const key = chunkKey(ref.gcx, ref.gcz);
        const chunk = this.chunks.get(key);
        if (chunk !== undefined && chunk.pending !== null) continue;
        const desired = chunk === undefined
          ? chunkLod(ref.dist, null, this.nearRadius)
          : chunk.reload
            ? chunk.lod
            : chunkLod(ref.dist, chunk.lod, this.nearRadius);
        if (desired === null || desired !== pass) continue;
        if (chunk !== undefined && chunk.lod === null) continue;
        if (chunk !== undefined && !chunk.reload && desired === chunk.lod) continue;
        if (this.inflight >= maxJobs) { this.waiting = true; return; }
        const prepared = this.prepare(ref.gcx, ref.gcz);
        if (prepared === 'full') { this.waiting = true; return; }
        if (prepared === null) { this.waiting = true; continue; }
        let target = chunk;
        if (target === undefined) {
          target = {
            key, gcx: ref.gcx, gcz: ref.gcz, slot: null, tris: 0, bytes: 0,
            hidden: false, ready: false, disposed: false, lod: null, pending: desired, reload: false,
          };
          this.chunks.set(key, target);
        } else {
          target.reload = false;
          target.pending = desired;
        }
        this.send({
          id: this.nextJobId++, chunk: target, worker: prepared.worker, tiles: prepared.tiles, lod: desired,
        }, prepared.ground, false);
      }
    }
  }

  private prepare(
    gcx: number, gcz: number,
  ): { ground: Uint8Array; tiles: Tile[]; worker: number } | 'full' | null {
    const rx = Math.floor(gcx / REGION_CHUNKS);
    const rz = Math.floor(gcz / REGION_CHUNKS);
    const needed = this.needed;
    needed.length = 0;
    let blocked = false;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const t = this.getTile(rx + dx, rz + dz);
        if (t === null) continue;
        t.lastUsed = this.tick;
        if (t.state === 'idle' || t.state === 'failed') this.startFetch(t);
        if (t.state !== 'loaded' && t.state !== 'none') blocked = true;
        needed.push(t);
      }
    }
    if (blocked) return null;
    const win = buildBlockInput(
      gcx, gcz, this.manifest.regionsX, this.manifest.regionsZ,
      (x, z) => this.coarse.regionData(x, z),
    );
    if (win === null) return null;
    const ground = win.slice(G_GH * GPLANE, (G_GH + 1) * GPLANE);
    const worker = this.pickWorker(needed);
    if (worker < 0) return 'full';
    return { ground, tiles: needed.slice(), worker };
  }

  private pickWorker(tiles: Tile[]): number {
    let best = -1;
    let bestScore = -1;
    for (let i = 0; i < this.workers.length; i++) {
      const load = this.workerLoad[i]!;
      if (load >= MAX_JOBS) continue;
      let have = 0;
      for (const t of tiles) have += (t.sentMask >> i) & 1;
      const score = have * 4 + (MAX_JOBS - load);
      if (score > bestScore) { bestScore = score; best = i; }
    }
    return best;
  }

  private send(job: Job, ground: Uint8Array, forceData: boolean): void {
    const refs: MeshTileRef[] = [];
    for (const t of job.tiles) {
      if (t.state === 'none') refs.push({ key: t.key, rx: t.rx, rz: t.rz, kind: 'none' });
      else if (!forceData && ((t.sentMask >> job.worker) & 1) === 1) refs.push({ key: t.key, rx: t.rx, rz: t.rz, kind: 'cached' });
      else {
        refs.push({ key: t.key, rx: t.rx, rz: t.rz, kind: 'data', buffer: t.buffer! });
        t.sentMask |= 1 << job.worker;
      }
    }
    const req: CityMeshRequest = {
      id: job.id, gcx: job.chunk.gcx, gcz: job.chunk.gcz, ground, tiles: refs, lod: job.lod,
    };
    this.jobs.set(job.id, job);
    this.workerLoad[job.worker]!++;
    this.inflight++;
    this.workers[job.worker]!.postMessage(req);
  }

  private onResult(wi: number, msg: CityMeshResponse): void {
    const job = this.jobs.get(msg.id);
    if (job === undefined) return;
    this.jobs.delete(msg.id);
    this.workerLoad[wi]!--;
    this.inflight--;
    const chunk = job.chunk;
    if (msg.missing !== undefined) {
      for (const t of job.tiles) if (msg.missing.includes(t.key)) t.sentMask &= ~(1 << wi);
      const again = this.prepare(chunk.gcx, chunk.gcz);
      if (!chunk.disposed && again !== null && again !== 'full' && again.worker === wi) {
        job.id = this.nextJobId++;
        this.send(job, again.ground, true);
        return;
      }
      if (this.chunks.get(chunk.key) === chunk) {
        this.chunks.delete(chunk.key);
        this.drop(chunk);
      } else {
        chunk.disposed = true;
      }
    } else if (msg.indices !== undefined && msg.error === undefined) {
      if (!chunk.disposed) this.install(chunk, msg, job.lod);
    } else {
      console.warn(`city mesh ${chunk.gcx},${chunk.gcz} failed: ${msg.error ?? 'unknown'}`);
      chunk.pending = null;
      if (chunk.lod === null) chunk.lod = 'mid';
      if (chunk.slot === null && this.chunks.get(chunk.key) === chunk) this.chunks.delete(chunk.key);
    }
    this.dirty = true;
    this.pump();
  }

  private install(chunk: MChunk, msg: CityMeshResponse, lod: MeshLod): void {
    const idx = msg.indices!;
    const oldSlot = chunk.slot;
    const oldTris = chunk.tris;
    const oldBytes = chunk.bytes;
    const oldLod = chunk.lod;
    let newSlot: BatchSlot | null = null;
    let newTris = 0;
    let newBytes = 0;
    if (idx.length > 0 && msg.positions && msg.normals && msg.uvs && msg.colors
      && msg.facade && msg.style && msg.pbr) {
      newSlot = this.batch.add({
        attrs: {
          position: [msg.positions, 3],
          normal: [msg.normals, 3],
          color: [msg.colors, 3],
          aUvM: [msg.uvs, 2],
          aFacade: [msg.facade, 4],
          aStyle: [msg.style, 1],
          aPbr: [msg.pbr, 1],
        },
        indices: idx,
      }, chunk.gcx * CHUNK_M, chunk.gcz * CHUNK_M);
      newTris = idx.length / 3;
      newBytes = msg.positions.byteLength + msg.normals.byteLength + msg.uvs.byteLength
        + msg.colors.byteLength + msg.facade.byteLength + msg.style.byteLength
        + msg.pbr.byteLength + idx.byteLength;
    }
    // The new slot is already installed, so removing the old one cannot leave a gap.
    if (oldSlot !== null) {
      this.batch.remove(oldSlot);
      this.triCount -= oldTris;
      this.byteCount -= oldBytes;
      this.meshCount--;
      if (oldLod === 'near') { this.nearCount--; this.nearTriCount -= oldTris; }
    }
    if (newSlot !== null) {
      chunk.slot = newSlot;
      chunk.tris = newTris;
      chunk.bytes = newBytes;
      this.triCount += newTris;
      this.byteCount += newBytes;
      this.meshCount++;
      if (lod === 'near') { this.nearCount++; this.nearTriCount += newTris; }
    } else {
      chunk.slot = null;
      chunk.tris = 0;
      chunk.bytes = 0;
    }
    chunk.lod = lod;
    chunk.pending = null;
    chunk.reload = false;
    chunk.ready = true;
    if (!this.chunkHasBridge(chunk.gcx, chunk.gcz)) {
      this.coarse.setStructuresHidden(chunk.gcx, chunk.gcz, true);
      chunk.hidden = true;
    }
  }

  /** Coarse regions for this chunk's ground window are loaded (null = empty region, which is fine). */
  private regionsReady(gcx: number, gcz: number): boolean {
    const rx = Math.floor(gcx / REGION_CHUNKS);
    const rz = Math.floor(gcz / REGION_CHUNKS);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = rx + dx;
        const z = rz + dz;
        if (x < 0 || z < 0 || x >= this.manifest.regionsX || z >= this.manifest.regionsZ) continue;
        if (this.coarse.peekRegion(x, z) === undefined) return false;
      }
    }
    return true;
  }

  private chunkHasBridge(gcx: number, gcz: number): boolean {
    const rx = Math.floor(gcx / REGION_CHUNKS);
    const rz = Math.floor(gcz / REGION_CHUNKS);
    const data = this.coarse.regionData(rx, rz);
    if (data === undefined || data === null) return false;
    const lx0 = (gcx - rx * REGION_CHUNKS) * CHUNK;
    const lz0 = (gcz - rz * REGION_CHUNKS) * CHUNK;
    const lx1 = lx0 + CHUNK;
    const lz1 = lz0 + CHUNK;
    for (const f of data.features) {
      if (f.type === FEATURE_BRIDGE_DECK && f.x >= lx0 && f.x < lx1 && f.z >= lz0 && f.z < lz1) return true;
    }
    return false;
  }

  private drop(c: MChunk): void {
    c.disposed = true;
    if (c.hidden) {
      this.coarse.setStructuresHidden(c.gcx, c.gcz, false);
      c.hidden = false;
    }
    if (c.slot !== null) {
      this.batch.remove(c.slot);
      this.triCount -= c.tris;
      this.byteCount -= c.bytes;
      this.meshCount--;
      if (c.lod === 'near') { this.nearCount--; this.nearTriCount -= c.tris; }
      c.slot = null;
    }
    c.pending = null;
  }

  private getTile(rx: number, rz: number): Tile | null {
    if (rx < 0 || rz < 0 || rx >= this.manifest.regionsX || rz >= this.manifest.regionsZ) return null;
    const key = regionKey(rx, rz);
    let t = this.tiles.get(key);
    if (t === undefined) {
      t = { rx, rz, key, state: 'idle', buffer: null, sentMask: 0, lastUsed: this.tick, failedAt: 0 };
      this.tiles.set(key, t);
    }
    return t;
  }

  private startFetch(t: Tile): void {
    if (t.state === 'failed' && performance.now() - t.failedAt < RETRY_MS) return;
    if (t.state !== 'idle' && t.state !== 'failed') return;
    if (this.fetchActive >= MAX_FETCHES) return;
    t.state = 'loading';
    this.fetchActive++;
    fetch(versioned(`${this.baseUrl}v_${t.rx}_${t.rz}.bin`))
      .then((r) => {
        const html = (r.headers.get('content-type') ?? '').includes('text/html');
        if (r.status === 404 || html) return null;
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.arrayBuffer();
      })
      .then((buf) => {
        if (buf === null || buf.byteLength < 4 || !MAGIC.every((m, i) => new Uint8Array(buf)[i] === m)) {
          t.state = 'none';
        } else {
          t.buffer = buf;
          t.sentMask = 0;
          t.state = 'loaded';
          this.loadedTiles++;
          this.downloadBytes += buf.byteLength;
          this.evictTiles();
        }
      })
      .catch((err) => {
        console.warn(`city mesh tile ${t.rx},${t.rz} failed`, err);
        t.state = 'failed';
        t.failedAt = performance.now();
      })
      .finally(() => {
        this.fetchActive--;
        this.dirty = true;
        this.pump();
      });
  }

  private evictTiles(): void {
    while (this.loadedTiles > MAX_TILES) {
      let victim: Tile | null = null;
      for (const t of this.tiles.values()) {
        if (t.state !== 'loaded' || t.lastUsed >= this.tick) continue;
        if (victim === null || t.lastUsed < victim.lastUsed) victim = t;
      }
      if (victim === null) return;
      this.tiles.delete(victim.key);
      this.loadedTiles--;
    }
  }
}

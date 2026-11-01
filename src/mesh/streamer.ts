/**
 * Streams extruded building meshes for the city-centre neighbourhood. Vector tiles and the coarse
 * ground window are the same inputs the fine tier already uses; meshing runs in a worker. Buildings
 * in a chunk are one geometry, and every chunk is an instance of a single BatchedMesh.
 *
 * Interior chunks hide the coarse voxel walls and roofs once their mesh is in the scene (the ground
 * stays). Chunks that contain a coarse bridge deck are left alone so the deck is not deleted.
 * The outer ring of the neighbourhood keeps its voxels, so a building is never cut on the boundary.
 */
import * as THREE from 'three';
import { FEATURE_BRIDGE_DECK } from '../world/format.ts';
import { buildBlockInput, G_GH, GPLANE } from '../fine/block-input.ts';
import type { Manifest } from '../world/manifest.ts';
import { ChunkBatch, type BatchSlot } from '../world/chunk-batch.ts';
import { CHUNK, REGION_CHUNKS } from '../world/constants.ts';
import { CHUNK_M, chunkKey, distToChunk, regionKey, type ChunkRef } from '../world/stream-math.ts';
import type { WorldStreamer } from '../world/streamer.ts';
import { versioned } from '../version.ts';
import {
  MESH_NEIGHBOURHOOD, chunkHidesStructures, distToNeighbourhood,
} from './bounds.ts';
import { createFacadeMaterial } from './facade.ts';
import type { CityMeshRequest, CityMeshResponse, MeshTileRef } from './protocol.ts';

const HYSTERESIS_ON = 400;
const HYSTERESIS_OFF = 600;
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
  bytes: number;
}

interface MChunk {
  key: number;
  gcx: number;
  gcz: number;
  slot: BatchSlot | null;
  tris: number;
  bytes: number;
  hidden: boolean;
  busy: boolean;
  disposed: boolean;
}

interface Job {
  id: number;
  chunk: MChunk;
  worker: number;
  tiles: Tile[];
}

export interface MeshStreamerOptions {
  /** When false, meshes are built but do not cast shadows (Low quality). */
  castShadow: boolean;
  workers?: number;
}

/**
 * City-centre building meshes. `active` is false while the camera is far from the neighbourhood,
 * and the coarse voxels are showing again.
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
  private active = false;
  private meshCount = 0;
  private triCount = 0;
  private byteCount = 0;
  private downloadBytes = 0;

  constructor(scene: THREE.Scene, coarse: WorldStreamer, manifest: Manifest, opts: MeshStreamerOptions) {
    this.scene = scene;
    this.coarse = coarse;
    this.manifest = manifest;
    this.material = createFacadeMaterial();
    this.batch = new ChunkBatch(this.material, { instances: 900, vertices: 1_200_000, castShadow: opts.castShadow });
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
  /** Vertex and index buffers of the installed meshes. */
  get gpuBytes(): number { return this.byteCount; }
  /** Bytes of vector tiles this streamer has fetched (the fine tier may fetch the same files). */
  get downloadedBytes(): number { return this.downloadBytes; }
  /** 1 when the batched mesh has anything to draw, else 0. Without WEBGL_multi_draw the GPU splits it per chunk. */
  get batchedDraws(): number { return this.meshCount > 0 ? 1 : 0; }
  get isActive(): boolean { return this.active; }

  /**
   * True when every chunk that can be built (its coarse regions are loaded) has a result, and nothing
   * is in flight. Chunks outside the coarse view radius wait until those regions stream in.
   */
  get isSettled(): boolean {
    if (this.inflight > 0 || this.fetchActive > 0) return false;
    if (!this.active) return true;
    for (const ref of this.need) {
      if (this.chunks.has(chunkKey(ref.gcx, ref.gcz))) continue;
      if (this.regionsReady(ref.gcx, ref.gcz)) return false;
    }
    return true;
  }

  update(x: number, z: number): void {
    this.camX = x;
    this.camZ = z;
    const dist = distToNeighbourhood(x, z);
    const was = this.active;
    if (!this.active && dist < HYSTERESIS_ON) this.active = true;
    else if (this.active && dist > HYSTERESIS_OFF) this.active = false;
    if (was !== this.active) {
      if (!this.active) this.dropAll();
      this.lastGcx = -1e9;
    }
    if (!this.active) return;
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

  private neighbourhoodChunks(): ChunkRef[] {
    const b = MESH_NEIGHBOURHOOD;
    const gx0 = Math.floor(b.x0 / CHUNK_M);
    const gx1 = Math.floor((b.x1 - 1) / CHUNK_M);
    const gz0 = Math.floor(b.z0 / CHUNK_M);
    const gz1 = Math.floor((b.z1 - 1) / CHUNK_M);
    const out: ChunkRef[] = [];
    for (let gcz = gz0; gcz <= gz1; gcz++) {
      for (let gcx = gx0; gcx <= gx1; gcx++) {
        out.push({ gcx, gcz, dist: distToChunk(this.camX, this.camZ, gcx, gcz) });
      }
    }
    out.sort((a, c) => a.dist - c.dist || a.gcz - c.gcz || a.gcx - c.gcx);
    return out;
  }

  private recompute(): void {
    this.need = this.neighbourhoodChunks();
    const keep = new Set<number>();
    for (const r of this.need) keep.add(chunkKey(r.gcx, r.gcz));
    for (const c of [...this.chunks.values()]) {
      if (!keep.has(c.key)) {
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
    this.active = false;
  }

  private pump(): void {
    this.dirty = false;
    this.waiting = false;
    this.lastTry = performance.now();
    this.tick++;
    const maxJobs = this.workers.length * MAX_JOBS;
    for (const ref of this.need) {
      const key = chunkKey(ref.gcx, ref.gcz);
      if (this.chunks.has(key)) continue;
      if (this.inflight >= maxJobs) { this.waiting = true; return; }
      const prepared = this.prepare(ref.gcx, ref.gcz);
      if (prepared === 'full') { this.waiting = true; return; }
      if (prepared === null) { this.waiting = true; continue; }
      const chunk: MChunk = {
        key, gcx: ref.gcx, gcz: ref.gcz, slot: null, tris: 0, bytes: 0, hidden: false, busy: true, disposed: false,
      };
      this.chunks.set(key, chunk);
      this.send({ id: this.nextJobId++, chunk, worker: prepared.worker, tiles: prepared.tiles }, prepared.ground, false);
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
    const req: CityMeshRequest = { id: job.id, gcx: job.chunk.gcx, gcz: job.chunk.gcz, ground, tiles: refs };
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
      chunk.busy = false;
      if (this.chunks.get(chunk.key) === chunk) this.chunks.delete(chunk.key);
      chunk.disposed = true;
    } else if (msg.indices !== undefined && msg.error === undefined) {
      chunk.busy = false;
      if (!chunk.disposed) this.install(chunk, msg);
    } else {
      console.warn(`city mesh ${chunk.gcx},${chunk.gcz} failed: ${msg.error ?? 'unknown'}`);
      chunk.busy = false;
    }
    this.dirty = true;
    this.pump();
  }

  private install(chunk: MChunk, msg: CityMeshResponse): void {
    const idx = msg.indices!;
    if (idx.length > 0 && msg.positions && msg.normals && msg.uvs && msg.colors && msg.facade && msg.style) {
      chunk.slot = this.batch.add({
        attrs: {
          position: [msg.positions, 3],
          normal: [msg.normals, 3],
          color: [msg.colors, 3],
          aUvM: [msg.uvs, 2],
          aFacade: [msg.facade, 4],
          aStyle: [msg.style, 1],
        },
        indices: idx,
      }, chunk.gcx * CHUNK_M, chunk.gcz * CHUNK_M);
      chunk.tris = idx.length / 3;
      chunk.bytes = msg.positions.byteLength + msg.normals.byteLength + msg.uvs.byteLength
        + msg.colors.byteLength + msg.facade.byteLength + msg.style.byteLength + idx.byteLength;
      this.triCount += chunk.tris;
      this.byteCount += chunk.bytes;
      this.meshCount++;
    }
    if (chunkHidesStructures(chunk.gcx, chunk.gcz) && !this.chunkHasBridge(chunk.gcx, chunk.gcz)) {
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
        if (this.coarse.regionData(x, z) === undefined) return false;
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
      c.slot = null;
      this.triCount -= c.tris;
      this.byteCount -= c.bytes;
      this.meshCount--;
    }
  }

  private getTile(rx: number, rz: number): Tile | null {
    if (rx < 0 || rz < 0 || rx >= this.manifest.regionsX || rz >= this.manifest.regionsZ) return null;
    const key = regionKey(rx, rz);
    let t = this.tiles.get(key);
    if (t === undefined) {
      t = { rx, rz, key, state: 'idle', buffer: null, sentMask: 0, lastUsed: this.tick, failedAt: 0, bytes: 0 };
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
          t.bytes = buf.byteLength;
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

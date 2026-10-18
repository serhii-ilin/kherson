import * as THREE from 'three';
import { REGION_CHUNKS } from '../world/constants.ts';
import type { Manifest } from '../world/manifest.ts';
import type { WorldStreamer } from '../world/streamer.ts';
import { CHUNK_M, chunkKey, distToChunk, neededChunks, regionKey, type ChunkRef } from '../world/stream-math.ts';
import type { FineRequest, FineResponse, TileRef } from './fine.worker.ts';
import type { FineMesh } from './mesh.ts';
import { buildPatch } from './patch.ts';
import { FineWorld } from './world.ts';

export interface FineStreamerOptions {
  /** Chunks whose nearest point is within this many metres are generated (150 desktop, 70 phone). */
  radius: number;
  /** Fine workers (1 or 2). */
  workers?: number;
}

const HYSTERESIS = 64;
const MAX_TILES = 32;
const MAX_FETCHES = 4;
const MAX_JOBS_PER_WORKER = 2;
const RETRY_MS = 10000;
const WAIT_RETRY_MS = 400;
const MAGIC = [0x56, 0x4b, 0x56, 0x31]; // "VKV1"

type TileState = 'idle' | 'loading' | 'loaded' | 'none' | 'failed';

interface Tile {
  rx: number;
  rz: number;
  key: number;
  state: TileState;
  buffer: ArrayBuffer | null;
  /** Bit per worker that has received this tile's bytes. */
  sentMask: number;
  lastUsed: number;
  failedAt: number;
}

interface FChunk {
  key: number;
  gcx: number;
  gcz: number;
  mesh: THREE.Mesh | null;
  tris: number;
  busy: boolean;
  disposed: boolean;
}

interface Job {
  id: number;
  chunk: FChunk;
  worker: number;
  patch: Uint8Array;
  tiles: Tile[];
}

/**
 * Fine tier: generates 0.2 m ground for the 64 m chunks around the camera in workers, swaps it in
 * for the coarse chunk's ground (draw range, no extra draw call) and keeps the physics raster.
 */
export class FineStreamer {
  readonly world: FineWorld;
  readonly radius: number;

  private readonly scene: THREE.Scene;
  private readonly coarse: WorldStreamer;
  /**
   * The chunk material, pulled towards the camera. The coarse ground stays drawn underneath: greedy
   * meshing leaves T-junction hairline cracks, and they must show asphalt/grass, not the sky.
   */
  private readonly material: THREE.MeshLambertMaterial;
  private readonly manifest: Manifest;
  private readonly baseUrl: string;
  private readonly chunksX: number;
  private readonly chunksZ: number;
  private readonly workers: Worker[] = [];
  private readonly workerLoad: number[] = [];
  private readonly tiles = new Map<number, Tile>();
  private readonly chunks = new Map<number, FChunk>();
  private readonly jobs = new Map<number, Job>();
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
  /** Some wanted chunk is waiting for coarse data; retried a few times per second. */
  private waiting = false;
  private lastTry = 0;
  private meshCount = 0;
  private triCount = 0;

  constructor(scene: THREE.Scene, coarse: WorldStreamer, manifest: Manifest, opts: FineStreamerOptions) {
    const cm = coarse.material;
    this.material = cm.clone();
    this.material.onBeforeCompile = cm.onBeforeCompile;
    this.material.customProgramCacheKey = cm.customProgramCacheKey;
    this.material.polygonOffset = true;
    this.material.polygonOffsetFactor = -1;
    this.material.polygonOffsetUnits = -4;
    this.scene = scene;
    this.coarse = coarse;
    this.manifest = manifest;
    this.radius = opts.radius;
    this.world = new FineWorld(coarse);
    this.baseUrl = `${import.meta.env.BASE_URL}world/`;
    this.chunksX = manifest.regionsX * REGION_CHUNKS;
    this.chunksZ = manifest.regionsZ * REGION_CHUNKS;
    const n = Math.max(1, Math.min(2, opts.workers ?? 1));
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL('./fine.worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent<FineResponse>) => this.onResult(i, e.data);
      this.workers.push(w);
      this.workerLoad.push(0);
    }
  }

  get chunkCount(): number { return this.meshCount; }
  get inflightJobs(): number { return this.inflight; }
  get triangles(): number { return this.triCount; }

  /** Call once per frame; does real work only on a chunk-boundary crossing, new data, or a retry tick. */
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
    for (const w of this.workers) w.terminate();
    for (const c of [...this.chunks.values()]) this.drop(c);
    this.chunks.clear();
    this.material.dispose();
  }

  // ---------------------------------------------------------------- tiles

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

  /** Starts a fetch if allowed; true when the tile is loading (or will be). */
  private startFetch(t: Tile): void {
    if (t.state === 'failed' && performance.now() - t.failedAt < RETRY_MS) return;
    if (t.state !== 'idle' && t.state !== 'failed') return;
    if (this.fetchActive >= MAX_FETCHES) return;
    t.state = 'loading';
    this.fetchActive++;
    fetch(`${this.baseUrl}v_${t.rx}_${t.rz}.bin`)
      .then((r) => {
        const html = (r.headers.get('content-type') ?? '').includes('text/html'); // dev-server fallback
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
          this.evictTiles();
        }
      })
      .catch((err) => {
        console.warn(`vector tile ${t.rx},${t.rz} failed`, err);
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

  // ---------------------------------------------------------------- scheduling

  private recompute(): void {
    this.need = neededChunks(this.camX, this.camZ, this.radius, this.chunksX, this.chunksZ);
    const keep = this.radius + HYSTERESIS;
    for (const c of [...this.chunks.values()]) {
      if (distToChunk(this.camX, this.camZ, c.gcx, c.gcz) > keep) {
        this.chunks.delete(c.key);
        this.drop(c);
      }
    }
    this.dirty = true;
  }

  private pump(): void {
    this.dirty = false;
    this.waiting = false;
    this.lastTry = performance.now();
    this.tick++;
    const maxJobs = this.workers.length * MAX_JOBS_PER_WORKER;
    const needed: Tile[] = [];
    for (const ref of this.need) {
      const key = chunkKey(ref.gcx, ref.gcz);
      if (this.chunks.has(key)) continue;
      if (this.inflight >= maxJobs) { this.waiting = true; break; }
      const rx = Math.floor(ref.gcx / REGION_CHUNKS);
      const rz = Math.floor(ref.gcz / REGION_CHUNKS);
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
      const patch = blocked ? null : buildPatch(
        ref.gcx, ref.gcz, this.manifest.regionsX, this.manifest.regionsZ,
        (x, z) => this.coarse.regionData(x, z),
      );
      if (blocked || patch === null) { this.waiting = true; continue; }
      const worker = this.pickWorker(needed);
      if (worker < 0) { this.waiting = true; break; }
      const chunk: FChunk = { key, gcx: ref.gcx, gcz: ref.gcz, mesh: null, tris: 0, busy: true, disposed: false };
      this.chunks.set(key, chunk);
      this.send({ id: this.nextJobId++, chunk, worker, patch, tiles: needed.slice() }, false);
    }
  }

  private pickWorker(tiles: Tile[]): number {
    let best = -1;
    let bestScore = -1;
    for (let i = 0; i < this.workers.length; i++) {
      const load = this.workerLoad[i]!;
      if (load >= MAX_JOBS_PER_WORKER) continue;
      let have = 0;
      for (const t of tiles) have += (t.sentMask >> i) & 1;
      const score = have * 4 + (MAX_JOBS_PER_WORKER - load);
      if (score > bestScore) { bestScore = score; best = i; }
    }
    return best;
  }

  private send(job: Job, forceData: boolean): void {
    const refs: TileRef[] = [];
    for (const t of job.tiles) {
      if (t.state === 'none') {
        refs.push({ key: t.key, rx: t.rx, rz: t.rz, kind: 'none' });
      } else if (!forceData && ((t.sentMask >> job.worker) & 1) === 1) {
        refs.push({ key: t.key, rx: t.rx, rz: t.rz, kind: 'cached' });
      } else {
        refs.push({ key: t.key, rx: t.rx, rz: t.rz, kind: 'data', buffer: t.buffer! });
        t.sentMask |= 1 << job.worker;
      }
    }
    const req: FineRequest = { id: job.id, gcx: job.chunk.gcx, gcz: job.chunk.gcz, patch: job.patch, tiles: refs };
    this.jobs.set(job.id, job);
    this.workerLoad[job.worker]!++;
    this.inflight++;
    this.workers[job.worker]!.postMessage(req);
  }

  private onResult(wi: number, msg: FineResponse): void {
    const job = this.jobs.get(msg.id);
    if (job === undefined) return;
    this.jobs.delete(msg.id);
    this.workerLoad[wi]!--;
    this.inflight--;
    const chunk = job.chunk;
    if (msg.missing !== undefined) {
      for (const t of job.tiles) if (msg.missing.includes(t.key)) t.sentMask &= ~(1 << wi);
      if (!chunk.disposed && this.workerLoad[wi]! < MAX_JOBS_PER_WORKER && job.tiles.every((t) => t.state === 'none' || t.buffer !== null)) {
        job.id = this.nextJobId++;
        this.send(job, true);
        return;
      }
      chunk.busy = false;
      if (this.chunks.get(chunk.key) === chunk) this.chunks.delete(chunk.key);
      chunk.disposed = true;
    } else if (msg.mesh !== undefined) {
      chunk.busy = false;
      if (!chunk.disposed) this.install(chunk, msg.mesh);
    } else {
      // generation failed: keep an empty record so the chunk is not retried until it is dropped
      console.warn(`fine chunk ${chunk.gcx},${chunk.gcz} failed: ${msg.error ?? 'unknown'}`);
      chunk.busy = false;
    }
    this.dirty = true;
    this.pump();
  }

  // ---------------------------------------------------------------- meshes

  private install(chunk: FChunk, mesh: FineMesh): void {
    if (mesh.indices.length > 0) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
      g.setAttribute('color', new THREE.BufferAttribute(mesh.colors, 3));
      g.setAttribute('aWall', new THREE.BufferAttribute(mesh.walls, 4));
      g.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, this.material);
      m.castShadow = false; // flat ground: receives shadows only
      m.receiveShadow = true;
      m.position.set(chunk.gcx * CHUNK_M, 0, chunk.gcz * CHUNK_M);
      m.matrixAutoUpdate = false;
      m.updateMatrix();
      this.scene.add(m);
      chunk.mesh = m;
      chunk.tris = mesh.indices.length / 3;
      this.triCount += chunk.tris;
      this.meshCount++;
    }
    this.world.setChunk(chunk.gcx, chunk.gcz, mesh.raster);
  }

  private drop(c: FChunk): void {
    c.disposed = true;
    this.world.setChunk(c.gcx, c.gcz, null);
    if (c.mesh === null) return;
    this.scene.remove(c.mesh);
    c.mesh.geometry.dispose();
    c.mesh = null;
    this.triCount -= c.tris;
    this.meshCount--;
  }
}

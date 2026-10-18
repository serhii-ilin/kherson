import * as THREE from 'three';
import { REGION_CHUNKS } from '../world/constants.ts';
import type { Manifest } from '../world/manifest.ts';
import type { WorldStreamer } from '../world/streamer.ts';
import { CHUNK_M, chunkKey, distToChunk, neededChunks, regionKey, type ChunkRef } from '../world/stream-math.ts';
import type { FineRequest, FineResponse, TileRef } from './fine.worker.ts';
import type { FineMesh } from './mesh.ts';
import { buildBlockInput } from './block-input.ts';
import type { BlockMesh } from './generate.ts';
import { buildPatch } from './patch.ts';
import { FineWorld } from './world.ts';
import type { SignData, SignLayer } from './signs.ts';

export interface FineStreamerOptions {
  /** Chunks whose nearest point is within this many metres are generated (150 desktop, 70 phone). */
  radius: number;
  /** Radius of the 1 m block tier (buildings, bridges): 250 desktop, 100 phone; 0 or omitted = off. */
  blockRadius?: number;
  /** Fine workers (1 or 2). */
  workers?: number;
  /** Shop sign renderer; signs follow the installed block chunks. */
  signs?: SignLayer;
}

const HYSTERESIS = 64;
const MAX_TILES = 32;
const MAX_FETCHES = 4;
const MAX_JOBS_PER_WORKER = 2;
const RETRY_MS = 10000;
const WAIT_RETRY_MS = 400;
const MAGIC = [0x56, 0x4b, 0x56, 0x31]; // "VKV1"
const EMPTY_PATCH = new Uint8Array(0);
/** Block meshes are merged per 2x2 chunks (128 m) to keep draw calls (and shadow-pass calls) down. */
const TILE_CHUNKS = 2;
const TILE_FLUSHES_PER_FRAME = 2;
/** Camera height above ground beyond which the 0.2 m and 1 m tiers are switched off (with hysteresis). */
const HIGH_OFF = 250;
const HIGH_ON = 210;
/** New ground chunks and block chunks dither in over the tier underneath during this time. */
const FADE_MS = 300;
/** At most this many chunks fade at once (each is a temporary draw call); bulk arrivals pop in. */
const MAX_FADING = 10;

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
  kind: 'ground' | 'blocks';
  mesh: THREE.Mesh | null;
  tris: number;
  busy: boolean;
  disposed: boolean;
  /** Block chunks: the generated mesh until it is merged into its tile; then null. */
  data: BlockMesh | null;
  /** Block chunks: physics column tops (see FineWorld.setBlocks). */
  tops: Uint8Array | null;
  /** Block chunks: merged into a tile (structures hidden, physics registered). */
  installed: boolean;
  /** Block chunks: shop signs until installed. */
  signs: SignData | null;
  /** Dither-in state while the chunk fades over the tier underneath (null when done). */
  fade: Fade | null;
}

interface Fade {
  start: number;
  mat: THREE.MeshLambertMaterial;
  uniform: { value: number };
  /** Ground chunks fade their own mesh; block chunks a temporary mesh until they are merged into a tile. */
  mesh: THREE.Mesh | null;
}

interface Job {
  id: number;
  chunk: FChunk;
  worker: number;
  patch: Uint8Array;
  win: Uint8Array | null;
  tiles: Tile[];
}

/** A block chunk's slice of its tile's merged geometry. */
interface Part {
  chunk: FChunk;
  v: number;
  vn: number;
  i: number;
  in: number;
}

/** 2x2 block chunks merged into one mesh: one draw call (and one shadow-pass call) per tile. */
interface BlockTile {
  key: number;
  tx: number;
  tz: number;
  mesh: THREE.Mesh | null;
  parts: Part[];
  pending: FChunk[];
  tris: number;
}

/**
 * Fine tier: generates 0.2 m ground for the 64 m chunks around the camera in workers, swaps it in
 * for the coarse chunk's ground (draw range, no extra draw call) and keeps the physics raster.
 */
export class FineStreamer {
  readonly world: FineWorld;
  readonly radius: number;
  readonly blockRadius: number;
  private readonly signLayer: SignLayer | null;

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
  private readonly bchunks = new Map<number, FChunk>();
  private readonly btiles = new Map<number, BlockTile>();
  private readonly dirtyTiles = new Set<BlockTile>();
  private readonly jobs = new Map<number, Job>();
  private need: ChunkRef[] = [];
  private bneed: ChunkRef[] = [];
  private readonly needed: Tile[] = [];
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
  private blockCount = 0;
  private blockTris = 0;
  private blockInflight = 0;
  /** Camera is so high that the fine and block tiers are off (nothing generated, nothing drawn). */
  private high = false;
  private readonly fading: FChunk[] = [];

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
    this.blockRadius = opts.blockRadius ?? 0;
    this.signLayer = opts.signs ?? null;
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
  /** Installed block chunks, in-flight block jobs, block triangles (dev HUD). */
  get blockChunks(): number { return this.blockCount; }
  get blockJobs(): number { return this.blockInflight; }
  get blockTriangles(): number { return this.blockTris; }

  /** True while the camera is above the altitude cutoff and both tiers are off. */
  get isHigh(): boolean { return this.high; }

  /**
   * Call once per frame; does real work only on a chunk-boundary crossing, new data, a retry tick, or an
   * altitude threshold crossing. `y` is the camera height above the ground (omit to keep the tiers on).
   */
  update(x: number, z: number, y = 0): void {
    this.camX = x;
    this.camZ = z;
    if (!this.high && y > HIGH_OFF) this.setHigh(true);
    else if (this.high && y < HIGH_ON) this.setHigh(false);
    if (this.fading.length > 0) this.stepFades(performance.now());
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
    if (this.dirtyTiles.size > 0) this.flushTiles();
    this.signLayer?.flush();
  }

  /**
   * Switches both tiers off (hidden, nothing generated) or back on. Off restores the coarse structures
   * the block tier was hiding; on re-hides them and forces a rescan from the current position.
   */
  private setHigh(high: boolean): void {
    this.high = high;
    this.signLayer?.setVisible(!high);
    for (const c of this.chunks.values()) if (c.mesh !== null) c.mesh.visible = !high;
    for (const t of this.btiles.values()) if (t.mesh !== null) t.mesh.visible = !high;
    for (const c of this.fading) if (c.fade?.mesh) c.fade.mesh.visible = !high;
    for (const c of this.bchunks.values()) if (c.installed) this.coarse.setStructuresHidden(c.gcx, c.gcz, !high);
    if (!high) {
      this.lastGcx = -1e9; // rescan at the next update
      this.dirty = true;
    }
  }

  private stepFades(now: number): void {
    for (let i = this.fading.length - 1; i >= 0; i--) {
      const c = this.fading[i]!;
      const f = c.fade;
      if (f === null || c.disposed) {
        this.fading.splice(i, 1);
        continue;
      }
      const k = (now - f.start) / FADE_MS;
      if (k < 1) {
        f.uniform.value = k;
        continue;
      }
      this.fading.splice(i, 1);
      if (c.kind === 'ground') {
        if (c.mesh !== null) c.mesh.material = this.material;
        this.endFade(c);
      } else if (c.data !== null) {
        // fully faded in: merge into its tile (which hides the coarse structures); the temporary mesh is
        // removed by the flush in the same step
        const tile = this.blockTile(c);
        tile.pending.push(c);
        this.dirtyTiles.add(tile);
      }
    }
  }

  private endFade(c: FChunk): void {
    const f = c.fade;
    if (f === null) return;
    if (f.mesh !== null && c.kind === 'blocks') {
      this.scene.remove(f.mesh);
      f.mesh.geometry.dispose();
    }
    f.mat.dispose();
    c.fade = null;
  }

  private startFade(c: FChunk, mesh: THREE.Mesh, base: THREE.MeshLambertMaterial): void {
    const mat = base.clone();
    mat.onBeforeCompile = base.onBeforeCompile;
    mat.customProgramCacheKey = base.customProgramCacheKey;
    const uniform = { value: 0 };
    mat.userData.uFade = uniform;
    mesh.material = mat;
    c.fade = { start: performance.now(), mat, uniform, mesh };
    this.fading.push(c);
  }

  dispose(): void {
    for (const w of this.workers) w.terminate();
    for (const c of [...this.chunks.values()]) this.drop(c);
    this.chunks.clear();
    for (const c of [...this.bchunks.values()]) this.dropBlocks(c);
    this.bchunks.clear();
    for (const t of this.btiles.values()) this.flushTile(t);
    this.dirtyTiles.clear();
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
    if (this.blockRadius > 0) {
      this.bneed = neededChunks(this.camX, this.camZ, this.blockRadius, this.chunksX, this.chunksZ);
      const bkeep = this.blockRadius + HYSTERESIS;
      for (const c of [...this.bchunks.values()]) {
        if (distToChunk(this.camX, this.camZ, c.gcx, c.gcz) > bkeep) {
          this.bchunks.delete(c.key);
          this.dropBlocks(c);
        }
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
    // the 0.2 m ground first (cheap, close), then the block tier
    if (this.high) return;
    if (this.scan(this.need, this.chunks, 'ground', maxJobs)) return;
    if (this.blockRadius > 0) this.scan(this.bneed, this.bchunks, 'blocks', maxJobs);
  }

  /** Dispatches jobs for the missing chunks of `list`, nearest first; true when the job slots are full. */
  private scan(list: ChunkRef[], map: Map<number, FChunk>, kind: 'ground' | 'blocks', maxJobs: number): boolean {
    const needed = this.needed;
    for (const ref of list) {
      const key = chunkKey(ref.gcx, ref.gcz);
      if (map.has(key)) continue;
      if (this.inflight >= maxJobs) { this.waiting = true; return true; }
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
      let patch: Uint8Array | null = EMPTY_PATCH;
      let win: Uint8Array | null = null;
      if (!blocked) {
        const getRegion = (x: number, z: number): ReturnType<WorldStreamer['regionData']> => this.coarse.regionData(x, z);
        if (kind === 'ground') {
          patch = buildPatch(ref.gcx, ref.gcz, this.manifest.regionsX, this.manifest.regionsZ, getRegion);
        } else {
          win = buildBlockInput(ref.gcx, ref.gcz, this.manifest.regionsX, this.manifest.regionsZ, getRegion);
          if (win === null) patch = null;
        }
      }
      if (blocked || patch === null) { this.waiting = true; continue; }
      const worker = this.pickWorker(needed);
      if (worker < 0) { this.waiting = true; return true; }
      const chunk: FChunk = {
        key, gcx: ref.gcx, gcz: ref.gcz, kind, mesh: null, tris: 0, busy: true, disposed: false, data: null, tops: null, installed: false, signs: null, fade: null,
      };
      map.set(key, chunk);
      this.send({ id: this.nextJobId++, chunk, worker, patch, win, tiles: needed.slice() }, false);
    }
    return false;
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
    if (job.chunk.kind === 'blocks') {
      req.kind = 'blocks';
      req.win = job.win!;
    }
    this.jobs.set(job.id, job);
    this.workerLoad[job.worker]!++;
    this.inflight++;
    if (job.chunk.kind === 'blocks') this.blockInflight++;
    this.workers[job.worker]!.postMessage(req);
  }

  private onResult(wi: number, msg: FineResponse): void {
    const job = this.jobs.get(msg.id);
    if (job === undefined) return;
    this.jobs.delete(msg.id);
    this.workerLoad[wi]!--;
    this.inflight--;
    const chunk = job.chunk;
    const blocks = chunk.kind === 'blocks';
    if (blocks) this.blockInflight--;
    const map = blocks ? this.bchunks : this.chunks;
    if (msg.missing !== undefined) {
      for (const t of job.tiles) if (msg.missing.includes(t.key)) t.sentMask &= ~(1 << wi);
      if (!chunk.disposed && this.workerLoad[wi]! < MAX_JOBS_PER_WORKER && job.tiles.every((t) => t.state === 'none' || t.buffer !== null)) {
        job.id = this.nextJobId++;
        this.send(job, true);
        return;
      }
      chunk.busy = false;
      if (map.get(chunk.key) === chunk) map.delete(chunk.key);
      chunk.disposed = true;
    } else if (msg.mesh !== undefined) {
      chunk.busy = false;
      if (!chunk.disposed) this.install(chunk, msg.mesh);
    } else if (msg.blocks !== undefined) {
      chunk.busy = false;
      if (!chunk.disposed) this.queueBlocks(chunk, msg.blocks);
    } else {
      // generation failed: keep an empty record so the chunk is not retried until it is dropped
      console.warn(`${chunk.kind} chunk ${chunk.gcx},${chunk.gcz} failed: ${msg.error ?? 'unknown'}`);
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
      m.visible = !this.high;
      m.position.set(chunk.gcx * CHUNK_M, 0, chunk.gcz * CHUNK_M);
      m.matrixAutoUpdate = false;
      m.updateMatrix();
      this.scene.add(m);
      chunk.mesh = m;
      if (this.fading.length < MAX_FADING) this.startFade(chunk, m, this.material);
      chunk.tris = mesh.indices.length / 3;
      this.triCount += chunk.tris;
      this.meshCount++;
    }
    this.world.setChunk(chunk.gcx, chunk.gcz, mesh.raster);
  }

  private drop(c: FChunk): void {
    c.disposed = true;
    this.endFade(c);
    this.world.setChunk(c.gcx, c.gcz, null);
    if (c.mesh === null) return;
    this.scene.remove(c.mesh);
    c.mesh.geometry.dispose();
    c.mesh = null;
    this.triCount -= c.tris;
    this.meshCount--;
  }

  // ---------------------------------------------------------------- block tier

  private queueBlocks(chunk: FChunk, data: BlockMesh): void {
    chunk.data = data;
    chunk.tops = data.tops;
    chunk.signs = data.signs === undefined ? null : { ...data.signs, ox: chunk.gcx * CHUNK_M, oz: chunk.gcz * CHUNK_M };
    // the chunk's blocks dither in over the still-drawn coarse structures; the merge into the tile (and the
    // hiding of the coarse structures) follows once the fade is done
    if (this.fading.length >= MAX_FADING) {
      // bulk arrival (teleport, first load): no fade, to keep the temporary draw calls down
      const tile = this.blockTile(chunk);
      tile.pending.push(chunk);
      this.dirtyTiles.add(tile);
      return;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
    g.setAttribute('color', new THREE.BufferAttribute(data.colors, 3));
    g.setAttribute('aWall', new THREE.BufferAttribute(data.walls, 4));
    g.setIndex(new THREE.BufferAttribute(data.indices, 1));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, this.coarse.material);
    m.matrixAutoUpdate = false;
    m.position.set(chunk.gcx * CHUNK_M, 0, chunk.gcz * CHUNK_M);
    m.updateMatrix();
    m.visible = !this.high;
    this.scene.add(m);
    this.startFade(chunk, m, this.coarse.material);
  }

  private blockTile(chunk: FChunk): BlockTile {
    const tx = Math.floor(chunk.gcx / TILE_CHUNKS);
    const tz = Math.floor(chunk.gcz / TILE_CHUNKS);
    const key = chunkKey(tx, tz);
    let t = this.btiles.get(key);
    if (t === undefined) {
      t = { key, tx, tz, mesh: null, parts: [], pending: [], tris: 0 };
      this.btiles.set(key, t);
    }
    return t;
  }

  private flushTiles(): void {
    let n = 0;
    for (const t of this.dirtyTiles) {
      this.dirtyTiles.delete(t);
      this.flushTile(t);
      if (++n >= TILE_FLUSHES_PER_FRAME) break;
    }
  }

  /**
   * Rebuilds a tile's merged geometry from its kept parts and newly arrived chunks. New chunks get
   * their coarse structures hidden and their physics columns registered only now, when the blocks are
   * in the scene; removed chunks were unhidden when dropped.
   */
  private flushTile(tile: BlockTile): void {
    const keep = tile.parts.filter((p) => !p.chunk.disposed);
    const add = tile.pending.filter((c) => !c.disposed && c.data !== null);
    tile.pending.length = 0;
    let tv = 0;
    let ti = 0;
    for (const p of keep) { tv += p.vn; ti += p.in; }
    for (const c of add) { tv += c.data!.positions.length / 3; ti += c.data!.indices.length; }
    const old = tile.mesh;
    if (tv === 0) {
      if (old !== null) {
        this.scene.remove(old);
        old.geometry.dispose();
        tile.mesh = null;
      }
      this.blockTris -= tile.tris;
      tile.tris = 0;
      tile.parts = [];
    } else {
      const positions = new Float32Array(tv * 3);
      const normals = new Float32Array(tv * 3);
      const colors = new Float32Array(tv * 3);
      const walls = new Float32Array(tv * 4);
      const indices = new Uint32Array(ti);
      const parts: Part[] = [];
      let vo = 0;
      let io = 0;
      if (old !== null) {
        const g = old.geometry;
        const op = g.getAttribute('position').array as Float32Array;
        const on = g.getAttribute('normal').array as Float32Array;
        const oc = g.getAttribute('color').array as Float32Array;
        const ow = g.getAttribute('aWall').array as Float32Array;
        const oi = g.index!.array as Uint32Array;
        for (const p of keep) {
          positions.set(op.subarray(p.v * 3, (p.v + p.vn) * 3), vo * 3);
          normals.set(on.subarray(p.v * 3, (p.v + p.vn) * 3), vo * 3);
          colors.set(oc.subarray(p.v * 3, (p.v + p.vn) * 3), vo * 3);
          walls.set(ow.subarray(p.v * 4, (p.v + p.vn) * 4), vo * 4);
          const shift = vo - p.v;
          for (let k = 0; k < p.in; k++) indices[io + k] = oi[p.i + k]! + shift;
          parts.push({ chunk: p.chunk, v: vo, vn: p.vn, i: io, in: p.in });
          vo += p.vn;
          io += p.in;
        }
      }
      for (const c of add) {
        const d = c.data!;
        const vn = d.positions.length / 3;
        const ox = (c.gcx - tile.tx * TILE_CHUNKS) * CHUNK_M;
        const oz = (c.gcz - tile.tz * TILE_CHUNKS) * CHUNK_M;
        for (let k = 0; k < vn; k++) {
          positions[(vo + k) * 3] = d.positions[k * 3]! + ox;
          positions[(vo + k) * 3 + 1] = d.positions[k * 3 + 1]!;
          positions[(vo + k) * 3 + 2] = d.positions[k * 3 + 2]! + oz;
        }
        normals.set(d.normals, vo * 3);
        colors.set(d.colors, vo * 3);
        walls.set(d.walls, vo * 4);
        for (let k = 0; k < d.indices.length; k++) indices[io + k] = d.indices[k]! + vo;
        parts.push({ chunk: c, v: vo, vn, i: io, in: d.indices.length });
        vo += vn;
        io += d.indices.length;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
      g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      g.setAttribute('aWall', new THREE.BufferAttribute(walls, 4));
      g.setIndex(new THREE.BufferAttribute(indices, 1));
      g.computeBoundingSphere();
      if (old !== null) {
        old.geometry.dispose();
        old.geometry = g;
      } else {
        // the coarse chunk material (same program as the coarse chunks, no polygon offset)
        const m = new THREE.Mesh(g, this.coarse.material);
        m.visible = !this.high;
        m.castShadow = true;
        m.receiveShadow = true;
        m.position.set(tile.tx * TILE_CHUNKS * CHUNK_M, 0, tile.tz * TILE_CHUNKS * CHUNK_M);
        m.matrixAutoUpdate = false;
        m.updateMatrix();
        this.scene.add(m);
        tile.mesh = m;
      }
      this.blockTris += indices.length / 3 - tile.tris;
      tile.tris = indices.length / 3;
      tile.parts = parts;
    }
    for (const c of add) {
      c.data = null;
      c.installed = true;
      this.signLayer?.add(c.key, c.signs);
      c.signs = null;
      this.blockCount++;
      this.endFade(c);
    }
    for (const c of add) {
      this.coarse.setStructuresHidden(c.gcx, c.gcz, !this.high);
      this.world.setBlocks(c.gcx, c.gcz, c.tops);
    }
    if (tile.mesh === null && tile.parts.length === 0 && tile.pending.length === 0) this.btiles.delete(tile.key);
  }

  private dropBlocks(c: FChunk): void {
    c.disposed = true;
    if (c.installed) {
      // unhide the coarse structures first, so there is never a frame without the building
      this.coarse.setStructuresHidden(c.gcx, c.gcz, false);
      this.world.setBlocks(c.gcx, c.gcz, null);
      this.signLayer?.remove(c.key);
      this.blockCount--;
      c.installed = false;
    }
    c.data = null;
    this.endFade(c);
    const tile = this.btiles.get(chunkKey(Math.floor(c.gcx / TILE_CHUNKS), Math.floor(c.gcz / TILE_CHUNKS)));
    if (tile !== undefined) this.dirtyTiles.add(tile);
  }
}

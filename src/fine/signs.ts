/**
 * Shop signs: one InstancedMesh of quads (one draw call) textured from a canvas atlas of Ukrainian
 * names in a SYSTEM font stack (Constitution 1.3: no web fonts). Placement happens in the worker
 * (sign-place.ts); this file is the main-thread renderer plus the pure atlas slot LRU.
 */
import * as THREE from 'three';
import { SIGN_STRIDE } from './sign-place.ts';

export interface SignData {
  /** Stride SIGN_STRIDE: x, y, z (chunk-local), nx, nz, available width, name index. */
  data: Float32Array;
  names: string[];
  /** World position of the chunk's local origin. */
  ox?: number;
  oz?: number;
}

export const ATLAS_SIZE = 2048;
export const CELL_W = 512;
export const CELL_H = 64;
export const ATLAS_SLOTS = (ATLAS_SIZE / CELL_W) * (ATLAS_SIZE / CELL_H);
const MAX_INSTANCES = 1024;
const SIGN_H = 0.7;
const MIN_USED = 192;
const FONT = '"Segoe UI", "Helvetica Neue", Roboto, Arial, system-ui, sans-serif';

/** Slot allocator with least-recently-used eviction. Slots touched in the current stamp are never evicted. */
export class SlotLru {
  private readonly map = new Map<string, { slot: number; stamp: number }>();
  private free: number[] = [];

  constructor(readonly capacity: number) {
    for (let i = capacity - 1; i >= 0; i--) this.free.push(i);
  }

  get size(): number { return this.map.size; }

  has(key: string): boolean { return this.map.has(key); }

  /** Slot for `key` (touching it), whether it is new, or null when every slot is in use at `stamp`. */
  acquire(key: string, stamp: number): { slot: number; fresh: boolean } | null {
    const e = this.map.get(key);
    if (e !== undefined) {
      e.stamp = stamp;
      this.map.delete(key);
      this.map.set(key, e);
      return { slot: e.slot, fresh: false };
    }
    let slot = this.free.pop();
    if (slot === undefined) {
      const oldest = this.map.entries().next();
      if (oldest.done === true || oldest.value[1].stamp >= stamp) return null;
      slot = oldest.value[1].slot;
      this.map.delete(oldest.value[0]);
    }
    this.map.set(key, { slot, stamp });
    return { slot, fresh: true };
  }
}

const PALETTE = [0xb3242b, 0xd9702a, 0x2358a6, 0x1f7a4a, 0x5a3d8c, 0x2e2e33, 0x0f7c8a, 0x8a5a1c];

/** Plate colour of a shop name: keyword classes first, else a hash of the name. */
export function plateColor(name: string): number {
  const n = name.toLowerCase();
  if (/аптек|apte|pharm|фарм/.test(n)) return 0x1f8a4c;
  if (/банк|bank|приват|ощад|моно/.test(n)) return 0x1e5aa8;
  if (/пошт|post/.test(n)) return 0xc8102e;
  if (/кафе|кав|coffee|піц|ресторан|бар\b|їдальн/.test(n)) return 0x6b3f26;
  if (/маркет|продукт|сільпо|атб|магазин|супер/.test(n)) return 0xe8761c;
  let h = 2166136261;
  for (let i = 0; i < n.length; i++) h = Math.imul(h ^ n.charCodeAt(i), 16777619);
  return PALETTE[(h >>> 0) % PALETTE.length]!;
}

class Atlas {
  readonly canvas: HTMLCanvasElement;
  readonly texture: THREE.CanvasTexture;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly lru = new SlotLru(ATLAS_SLOTS);
  /** Used pixel width per name. */
  private readonly used = new Map<string, number>();
  stamp = 0;
  dirty = false;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = ATLAS_SIZE;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.texture.generateMipmaps = true;
    this.texture.minFilter = THREE.LinearMipmapLinearFilter;
  }

  /** Writes the UV rect for `name` into out[o..o+3] and returns its used pixel width, or 0 when the atlas is full. */
  acquire(name: string, out: Float32Array, o: number): number {
    const r = this.lru.acquire(name, this.stamp);
    if (r === null) return 0;
    if (r.fresh) this.draw(name, r.slot);
    const used = this.used.get(name)!;
    const cols = ATLAS_SIZE / CELL_W;
    const cx = (r.slot % cols) * CELL_W, cy = Math.floor(r.slot / cols) * CELL_H;
    out[o] = (cx + 1) / ATLAS_SIZE;
    out[o + 1] = 1 - (cy + CELL_H - 1) / ATLAS_SIZE;
    out[o + 2] = (used - 2) / ATLAS_SIZE;
    out[o + 3] = (CELL_H - 2) / ATLAS_SIZE;
    return used;
  }

  private draw(name: string, slot: number): void {
    const ctx = this.ctx;
    const cols = ATLAS_SIZE / CELL_W;
    const cx = (slot % cols) * CELL_W, cy = Math.floor(slot / cols) * CELL_H;
    ctx.clearRect(cx, cy, CELL_W, CELL_H);
    ctx.font = `600 38px ${FONT}`;
    const tw = ctx.measureText(name).width;
    const pad = 22;
    const used = Math.min(CELL_W, Math.max(MIN_USED, Math.ceil(tw + pad * 2)));
    this.used.set(name, used);
    const col = plateColor(name);
    ctx.fillStyle = `#${col.toString(16).padStart(6, '0')}`;
    ctx.fillRect(cx, cy, used, CELL_H);
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 3;
    ctx.strokeRect(cx + 4, cy + 4, used - 8, CELL_H - 8);
    ctx.save();
    ctx.beginPath();
    ctx.rect(cx, cy, used, CELL_H);
    ctx.clip();
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    const room = used - pad * 2;
    const sx = tw > room ? room / tw : 1;
    ctx.translate(cx + used / 2, cy + CELL_H / 2 + 2);
    ctx.scale(sx, 1);
    ctx.fillText(name, 0, 0);
    ctx.restore();
    this.dirty = true;
  }
}

/** All signs of the installed block chunks, as one draw call. */
export class SignLayer {
  readonly mesh: THREE.InstancedMesh;
  private readonly atlas = new Atlas();
  private readonly chunks = new Map<number, SignData>();
  private readonly uv = new Float32Array(MAX_INSTANCES * 4);
  private readonly uvAttr: THREE.InstancedBufferAttribute;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly pos = new THREE.Vector3();
  private readonly scl = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly rect = new Float32Array(4);
  private needs = false;

  constructor(scene: THREE.Scene) {
    const geo = new THREE.PlaneGeometry(1, 1);
    this.uvAttr = new THREE.InstancedBufferAttribute(this.uv, 4);
    this.uvAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aUv', this.uvAttr);
    const mat = new THREE.MeshBasicMaterial({ map: this.atlas.texture, color: 0xd8d8d8, fog: true });
    mat.onBeforeCompile = (s) => {
      s.vertexShader = s.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec4 aUv;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\nvMapUv = aUv.xy + uv * aUv.zw;\n#endif');
    };
    mat.customProgramCacheKey = () => 'vk-signs';
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX_INSTANCES);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    scene.add(this.mesh);
  }

  get count(): number { return this.mesh.count; }

  setVisible(v: boolean): void { this.mesh.visible = v; }

  add(key: number, signs: SignData | null): void {
    if (signs === null || signs.data.length === 0) return;
    this.chunks.set(key, signs);
    this.needs = true;
  }

  remove(key: number): void {
    if (this.chunks.delete(key)) this.needs = true;
  }

  /** Rebuilds the instances when chunks came or went (at most once per call; cheap, no per-frame work otherwise). */
  flush(): void {
    if (!this.needs) return;
    this.needs = false;
    this.atlas.stamp++;
    let n = 0;
    for (const c of this.chunks.values()) {
      const cnt = c.data.length / SIGN_STRIDE;
      for (let i = 0; i < cnt && n < MAX_INSTANCES; i++) {
        const o = i * SIGN_STRIDE;
        const d = c.data;
        const name = c.names[d[o + 6]!]!;
        const used = this.atlas.acquire(name, this.rect, 0);
        if (used === 0) continue;
        let w = Math.min(6, SIGN_H * used / CELL_H);
        w = Math.min(w, d[o + 5]!);
        const h = w * CELL_H / used;
        this.uv.set(this.rect, n * 4);
        this.pos.set(d[o]! + (c.ox ?? 0), d[o + 1]!, d[o + 2]! + (c.oz ?? 0));
        this.q.setFromAxisAngle(this.up, Math.atan2(d[o + 3]!, d[o + 4]!));
        this.scl.set(w, h, 1);
        this.m.compose(this.pos, this.q, this.scl);
        this.mesh.setMatrixAt(n, this.m);
        n++;
      }
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.uvAttr.needsUpdate = true;
    if (this.atlas.dirty) {
      this.atlas.texture.needsUpdate = true;
      this.atlas.dirty = false;
    }
  }
}

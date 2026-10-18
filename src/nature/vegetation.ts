import * as THREE from 'three';
import { F_GROUND_H, F_STRUCT_H, REGION, VOXEL } from '../world/constants.ts';
import { FEATURE_BUSH, FEATURE_TREE, type Feature } from '../world/format.ts';
import { jitterX, jitterZ } from './placement.ts';
import { BUSH_SPECIES, SPECIES, TREE_SPECIES, VARIANTS, buildModel } from './models.ts';

export interface VegetationOptions {
  /** Mid models (lod 2) are used up to this distance, metres. */
  nearRadius: number;
  /** Far boxes (lod 1) are used up to this distance, metres. */
  farRadius: number;
  /** Full-detail models (lod 0) up to this distance; default 70 m (40 m when nearRadius < 200). */
  lod0Radius?: number;
}

export interface VegetationStats {
  instances: number;
  near: number;
  triangles: number;
}

const REGION_M = REGION * VOXEL;
const RECOMPUTE_M = 64;
const SPECIES_LIST: readonly number[] = [...TREE_SPECIES, ...BUSH_SPECIES];
const N_MODELS = SPECIES_LIST.length * VARIANTS;
const FIRST_BUSH_MODEL = TREE_SPECIES.length * VARIANTS;
/** Group slots per model: 0 = lod0, 1 = lod2 (mid), 2 = lod1 (far). */
const LOD_OF_SLOT = [0, 2, 1] as const;
const SPECIES_INDEX = new Map<number, number>(SPECIES_LIST.map((s, i) => [s, i]));

/** Per-region instance data (structure of arrays). */
interface RegionVeg {
  rx: number;
  rz: number;
  count: number;
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  scale: Float32Array;
  rot: Uint8Array;
  tint: Float32Array;
  model: Uint8Array;
  /** Current group slot per instance (-1 = hidden). */
  slot: Int8Array;
  trees: number;
}

interface Group {
  mesh: THREE.InstancedMesh | null;
  capacity: number;
  tris: number;
}

function modelOf(f: Feature): number {
  let sp = f.species;
  if (sp === SPECIES.GENERIC) sp = f.seed & 8 ? SPECIES.LINDEN : SPECIES.CHESTNUT;
  let si = SPECIES_INDEX.get(sp);
  if (si === undefined) si = f.type === FEATURE_BUSH ? TREE_SPECIES.length : 0;
  return si * VARIANTS + (((f.seed >> 6) & 3) % VARIANTS);
}

/** Instanced, wind-swayed trees and bushes streamed with the world regions. */
export class Vegetation {
  readonly stats: VegetationStats = { instances: 0, near: 0, triangles: 0 };
  readonly material: THREE.MeshLambertMaterial;
  /** Depth material with the same sway, so shadows move with the foliage. */
  readonly depthMaterial: THREE.MeshDepthMaterial;

  private readonly scene: THREE.Scene;
  private readonly lod0Sq: number;
  private readonly nearSq: number;
  private readonly farSq: number;
  private readonly farRadius: number;
  private readonly regions = new Map<number, RegionVeg>();
  private readonly geoms: (THREE.BufferGeometry | null)[] = new Array(N_MODELS * 3).fill(null);
  private readonly groups: Group[] = [];
  private readonly counts = new Int32Array(N_MODELS * 3);
  private readonly cursor = new Int32Array(N_MODELS * 3);
  private readonly uTime = { value: 0 };
  private camX = 0;
  private camZ = 0;
  private lastCx = -1e9;
  private lastCz = -1e9;
  private dirty = true;

  constructor(scene: THREE.Scene, opts: VegetationOptions) {
    this.scene = scene;
    const r0 = opts.lod0Radius ?? (opts.nearRadius < 200 ? 40 : 70);
    this.lod0Sq = r0 * r0;
    this.nearSq = opts.nearRadius * opts.nearRadius;
    this.farRadius = opts.farRadius;
    this.farSq = opts.farRadius * opts.farRadius;
    for (let i = 0; i < N_MODELS * 3; i++) this.groups.push({ mesh: null, capacity: 0, tris: 0 });

    this.material = new THREE.MeshLambertMaterial({ vertexColors: true });
    const uTime = this.uTime;
    this.depthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    const patch = (shader: THREE.WebGLProgramParametersWithUniforms): void => {
      shader.uniforms.uTime = uTime;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float sway;\nuniform float uTime;')
        .replace(
          '#include <project_vertex>',
          `vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
  mvPosition = instanceMatrix * mvPosition;
#endif
  mvPosition = modelMatrix * mvPosition;
  {
    vec2 ip = ( modelMatrix * vec4( instanceMatrix[3].xyz, 1.0 ) ).xz;
    float phase = dot( ip, vec2( 0.07, 0.11 ) );
    mvPosition.xz += sway * 0.18 * vec2( sin( uTime * 1.7 + phase ), cos( uTime * 1.3 + phase * 1.3 ) );
    mvPosition.xz += vec2( sway * 0.04 * sin( uTime * 7.0 + phase * 3.0 ) );
  }
  mvPosition = viewMatrix * mvPosition;
  gl_Position = projectionMatrix * mvPosition;`,
        );
    };
    this.material.onBeforeCompile = patch;
    this.depthMaterial.onBeforeCompile = patch;
  }

  /** Adds (or, with null features, removes) a region's vegetation. `cells` provides ground heights. */
  setRegion(rx: number, rz: number, features: Feature[] | null, cells?: Uint8Array): void {
    const key = rz * 4096 + rx;
    if (this.regions.delete(key)) this.dirty = true;
    if (features === null || cells === undefined) return;
    let n = 0;
    for (const f of features) if (f.type === FEATURE_TREE || f.type === FEATURE_BUSH) n++;
    if (n === 0) return;
    const r: RegionVeg = {
      rx, rz, count: n,
      x: new Float32Array(n), y: new Float32Array(n), z: new Float32Array(n),
      scale: new Float32Array(n), rot: new Uint8Array(n), tint: new Float32Array(n * 3),
      model: new Uint8Array(n), slot: new Int8Array(n).fill(-1), trees: 0,
    };
    const plane = REGION * REGION;
    const col = new THREE.Color();
    let i = 0;
    for (const f of features) {
      const isBush = f.type === FEATURE_BUSH;
      if (!isBush && f.type !== FEATURE_TREE) continue;
      const ci = f.z * REGION + f.x;
      const s = f.seed;
      r.x[i] = rx * REGION_M + (f.x + 0.5 + jitterX(s)) * VOXEL;
      r.z[i] = rz * REGION_M + (f.z + 0.5 + jitterZ(s)) * VOXEL;
      r.y[i] = (cells[F_GROUND_H * plane + ci]! + cells[F_STRUCT_H * plane + ci]!) * VOXEL;
      let sc = 0.8 + (((s >> 2) & 15) / 15) * 0.45;
      if (isBush) sc *= 0.75 + 0.25 * Math.max(1, Math.min(3, f.param));
      r.scale[i] = sc;
      r.rot[i] = s & 3;
      // hue +-0.03, lightness +-10% from the seed, as a multiplier on the model colours
      const h = (((s * 73 + 5) & 255) / 255 * 2 - 1) * 0.03;
      const l = 1 + (((s * 151 + 29) & 255) / 255 * 2 - 1) * 0.1;
      col.setRGB(l * (1 + h * 3), l, l * (1 - h * 3));
      r.tint[i * 3] = col.r; r.tint[i * 3 + 1] = col.g; r.tint[i * 3 + 2] = col.b;
      const m = modelOf(f);
      r.model[i] = m;
      if (m < FIRST_BUSH_MODEL) r.trees++;
      i++;
    }
    this.regions.set(key, r);
    this.dirty = true;
  }

  update(cameraX: number, cameraZ: number, timeSeconds: number): void {
    this.uTime.value = timeSeconds;
    this.camX = cameraX;
    this.camZ = cameraZ;
    const cx = Math.floor(cameraX / RECOMPUTE_M);
    const cz = Math.floor(cameraZ / RECOMPUTE_M);
    if (cx !== this.lastCx || cz !== this.lastCz || this.dirty) {
      this.lastCx = cx;
      this.lastCz = cz;
      this.dirty = false;
      this.rebuild();
    }
  }

  /** Share of "dense" (1 = 40 trees) within 60 m of (x, z); cheap enough to call a few times per second. */
  treeDensity(x: number, z: number): number {
    let n = 0;
    const R2 = 60 * 60;
    for (const r of this.regions.values()) {
      const x0 = r.rx * REGION_M, z0 = r.rz * REGION_M;
      if (x < x0 - 60 || x > x0 + REGION_M + 60 || z < z0 - 60 || z > z0 + REGION_M + 60) continue;
      for (let i = 0; i < r.count; i++) {
        if (r.model[i]! >= FIRST_BUSH_MODEL) continue;
        const dx = r.x[i]! - x, dz = r.z[i]! - z;
        if (dx * dx + dz * dz < R2) n++;
      }
    }
    return Math.min(1, n / 40);
  }

  dispose(): void {
    for (const g of this.groups) {
      if (g.mesh !== null) {
        this.scene.remove(g.mesh);
        g.mesh.dispose();
        g.mesh = null;
      }
    }
    for (const g of this.geoms) g?.dispose();
    this.regions.clear();
    this.material.dispose();
    this.depthMaterial.dispose();
  }

  // ---------------------------------------------------------------- internals

  private geometry(model: number, slot: number): THREE.BufferGeometry {
    const gi = model * 3 + slot;
    let g = this.geoms[gi];
    if (g) return g;
    const m = buildModel(SPECIES_LIST[Math.floor(model / VARIANTS)]!, model % VARIANTS, LOD_OF_SLOT[slot]!);
    g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3));
    g.setAttribute('color', new THREE.BufferAttribute(m.colors, 3));
    g.setAttribute('sway', new THREE.BufferAttribute(m.sway, 1));
    g.setIndex(new THREE.BufferAttribute(m.indices, 1));
    this.geoms[gi] = g;
    return g;
  }

  private ensureMesh(gi: number, need: number): THREE.InstancedMesh {
    const grp = this.groups[gi]!;
    if (grp.mesh !== null && grp.capacity >= need) return grp.mesh;
    if (grp.mesh !== null) {
      this.scene.remove(grp.mesh);
      grp.mesh.dispose();
    }
    const cap = Math.max(64, Math.ceil(need * 1.5));
    const mesh = new THREE.InstancedMesh(this.geometry(Math.floor(gi / 3), gi % 3), this.material, cap);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false; // one mesh spans every loaded region
    mesh.matrixAutoUpdate = false;
    // lod0 (slot 0) and mid (slot 1) cast and receive; far boxes only receive
    mesh.castShadow = gi % 3 !== 2;
    mesh.receiveShadow = true;
    mesh.customDepthMaterial = this.depthMaterial;
    this.scene.add(mesh);
    grp.mesh = mesh;
    grp.capacity = cap;
    grp.tris = this.geometry(Math.floor(gi / 3), gi % 3).index!.count / 3;
    return mesh;
  }

  /** Re-assigns an LOD to every instance around the camera and refills the instance buffers. */
  private rebuild(): void {
    const { camX, camZ, lod0Sq, nearSq, farSq } = this;
    const counts = this.counts;
    counts.fill(0);
    const reach = this.farRadius + REGION_M * 1.5;
    let near = 0, total = 0;
    // pass 1: LOD per instance and group sizes
    for (const r of this.regions.values()) {
      const cxm = (r.rx + 0.5) * REGION_M - camX, czm = (r.rz + 0.5) * REGION_M - camZ;
      const skip = cxm * cxm + czm * czm > reach * reach;
      for (let i = 0; i < r.count; i++) {
        if (skip) { r.slot[i] = -1; continue; }
        const dx = r.x[i]! - camX, dz = r.z[i]! - camZ;
        const d2 = dx * dx + dz * dz;
        const s = d2 < lod0Sq ? 0 : d2 < nearSq ? 1 : d2 < farSq ? 2 : -1;
        r.slot[i] = s;
        if (s >= 0) counts[r.model[i]! * 3 + s]!++;
      }
    }
    // pass 2: fill
    const cursor = this.cursor;
    cursor.fill(0);
    for (let gi = 0; gi < counts.length; gi++) {
      if (counts[gi]! > 0) this.ensureMesh(gi, counts[gi]!);
    }
    for (const r of this.regions.values()) {
      for (let i = 0; i < r.count; i++) {
        const s = r.slot[i]!;
        if (s < 0) continue;
        const gi = r.model[i]! * 3 + s;
        const mesh = this.groups[gi]!.mesh!;
        const k = cursor[gi]!++;
        const m = mesh.instanceMatrix.array as Float32Array;
        const sc = r.scale[i]!;
        const rot = r.rot[i]!;
        const c = rot === 0 ? 1 : rot === 2 ? -1 : 0;
        const sn = rot === 1 ? 1 : rot === 3 ? -1 : 0;
        const o = k * 16;
        m[o] = c * sc; m[o + 1] = 0; m[o + 2] = -sn * sc; m[o + 3] = 0;
        m[o + 4] = 0; m[o + 5] = sc; m[o + 6] = 0; m[o + 7] = 0;
        m[o + 8] = sn * sc; m[o + 9] = 0; m[o + 10] = c * sc; m[o + 11] = 0;
        m[o + 12] = r.x[i]!; m[o + 13] = r.y[i]!; m[o + 14] = r.z[i]!; m[o + 15] = 1;
        const ca = mesh.instanceColor!.array as Float32Array;
        ca[k * 3] = r.tint[i * 3]!; ca[k * 3 + 1] = r.tint[i * 3 + 1]!; ca[k * 3 + 2] = r.tint[i * 3 + 2]!;
        total++;
        if (s === 0) near++;
      }
    }
    let tris = 0;
    for (let gi = 0; gi < this.groups.length; gi++) {
      const g = this.groups[gi]!;
      if (g.mesh === null) continue;
      const n = cursor[gi]!;
      g.mesh.count = n;
      g.mesh.visible = n > 0;
      g.mesh.instanceMatrix.needsUpdate = true;
      g.mesh.instanceColor!.needsUpdate = true;
      tris += n * g.tris;
    }
    this.stats.instances = total;
    this.stats.near = near;
    this.stats.triangles = tris;
  }
}

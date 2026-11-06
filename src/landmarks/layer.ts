import * as THREE from 'three';
import type { Quality } from '../quality.ts';
import type { PbrUniforms } from '../world/pbr-library.ts';
import { osmKey } from '../world/osm-ref.ts';
import { TexturedMaterialCache, type TexturedMaterialHandle, type TextureLoader } from './textured-material.ts';
import type { Landmark, LandmarkBuild, LandmarkBuildContext, LandmarkMeshKind, LandmarkSurface } from './types.ts';

export interface LandmarkGround {
  heightAt(x: number, z: number, refY?: number): number | null;
  groundHeightAt?(x: number, z: number, refY?: number): number | null;
  isWater?(x: number, z: number, refY?: number): boolean;
  blockedAt?(x: number, z: number, y: number, bodyH?: number): boolean;
  trunkNear?(x: number, z: number, r: number): boolean;
}

export interface LandmarkLayerOptions {
  pbr?: PbrUniforms;
  /** Vite base URL; defaults to `import.meta.env.BASE_URL`. */
  base?: string;
  /** Test/integration hook; the default loads with `THREE.TextureLoader`. */
  loadTexture?: (url: string) => Promise<THREE.Texture>;
}

const BUILD_RADIUS = 600;
const DROP_RADIUS = 900;
/** A landmark that replaces OSM buildings must be present before the mesh streamer stops hiding them (640 m). */
const REPLACED_BUILD_RADIUS = 700;
const REPLACED_DROP_RADIUS = 950;
const LOD_NEAR_RADIUS = 250;
/** Hysteresis: a near instance returns to far only after this extra distance. */
const LOD_FAR_RADIUS = 300;
/** Re-evaluate LOD (and photo approach) only after the camera has moved this far. */
const LOD_STEP = 16;
/** Facade photos are fetched only this close; the mesh itself may be built earlier. */
const PHOTO_RADIUS = 600;

export type LandmarkLod = 'near' | 'far';

/**
 * Pure hysteresis table, so the update loop never allocates: `near` at or inside 250 m, back to `far` only
 * beyond 300 m.
 */
export function landmarkLod(distance: number, current: LandmarkLod, near = LOD_NEAR_RADIUS): LandmarkLod {
  if (current === 'near') return distance > near + (LOD_FAR_RADIUS - LOD_NEAR_RADIUS) ? 'far' : 'near';
  return distance <= near ? 'near' : 'far';
}

interface Instance {
  readonly landmark: Landmark;
  build: LandmarkBuild | null;
  group: THREE.Group | null;
  surfaces: readonly LandmarkSurface[];
  lod: LandmarkLod;
  handles: TexturedMaterialHandle[];
}

interface GroupParts {
  group: THREE.Group;
  handles: TexturedMaterialHandle[];
}

function defaultTextureLoader(url: string): Promise<THREE.Texture> {
  return new THREE.TextureLoader().loadAsync(url);
}

/** Lazily-created landmark meshes with a fixed distance-only hot path. */
export class LandmarkLayer {
  readonly landmarks: Landmark[];
  private readonly entries: Instance[];
  private readonly scene: THREE.Scene;
  private readonly ground: LandmarkGround;
  private readonly quality: Quality;
  private readonly textured: TexturedMaterialCache;
  private readonly replaced: Set<string>;
  private night = 0;
  private lastEvalX: number | null = null;
  private lastEvalZ: number | null = null;
  private readonly opaqueMaterials: THREE.MeshLambertMaterial[] = [];
  private readonly waterMaterials: THREE.MeshLambertMaterial[] = [];
  private readonly lampMaterials: THREE.MeshLambertMaterial[] = [];

  constructor(
    scene: THREE.Scene,
    landmarks: readonly Landmark[],
    ground: LandmarkGround,
    quality: Quality,
    opts: LandmarkLayerOptions = {},
  ) {
    this.scene = scene;
    this.landmarks = [...landmarks];
    this.ground = ground;
    this.quality = quality;
    const loadTexture: TextureLoader = opts.loadTexture ?? defaultTextureLoader;
    this.textured = new TexturedMaterialCache({
      pbr: opts.pbr,
      base: opts.base ?? import.meta.env.BASE_URL,
      loadTexture,
    });
    const replaced = new Set<string>();
    for (const landmark of landmarks) {
      for (const ref of landmark.replaces ?? []) replaced.add(osmKey(ref));
    }
    this.replaced = replaced;
    this.entries = [];
    for (const landmark of landmarks) {
      this.entries.push({
        landmark,
        build: null,
        group: null,
        surfaces: [],
        lod: 'far',
        handles: [],
      });
    }
  }

  /** Append landmarks whose data arrived after construction (e.g. a fetched facade file). Idempotent by id. */
  addLandmarks(landmarks: readonly Landmark[]): void {
    const known = new Set(this.entries.map((entry) => entry.landmark.id));
    for (const landmark of landmarks) {
      if (known.has(landmark.id)) continue;
      known.add(landmark.id);
      for (const ref of landmark.replaces ?? []) this.replaced.add(osmKey(ref));
      this.landmarks.push(landmark);
      this.entries.push({
        landmark,
        build: null,
        group: null,
        surfaces: [],
        lod: 'far',
        handles: [],
      });
    }
  }

  /** Every OSM building hidden by a registered landmark (`w<id>` / `r<id>`), computed once. */
  replacedKeys(): ReadonlySet<string> {
    return this.replaced;
  }

  get builtCount(): number {
    let n = 0;
    for (const entry of this.entries) if (entry.build !== null) n++;
    return n;
  }

  get triangleCount(): number {
    let n = 0;
    for (const entry of this.entries) if (entry.build !== null) n += entry.build.triangleCount;
    return n;
  }

  get materialCount(): number {
    let n = 0;
    for (const entry of this.entries) if (entry.build !== null) n += entry.build.materialCount;
    return n;
  }

  /** Live shared textured materials, for the dev HUD. */
  get texturedMaterials(): number {
    return this.textured.texturedMaterials;
  }

  /** Loaded facade-photo textures, for the dev HUD. */
  get photoTextures(): number {
    return this.textured.photoTextures;
  }

  update(x: number, z: number): void {
    const moved = this.lastEvalX === null
      || (x - this.lastEvalX) * (x - this.lastEvalX) + (z - this.lastEvalZ!) * (z - this.lastEvalZ!) >= LOD_STEP * LOD_STEP;
    for (const entry of this.entries) {
      const dx = x - entry.landmark.anchor.x;
      const dz = z - entry.landmark.anchor.z;
      const d2 = dx * dx + dz * dz;
      const replaced = (entry.landmark.replaces?.length ?? 0) > 0;
      if (entry.build === null) {
        const radius = replaced ? REPLACED_BUILD_RADIUS : BUILD_RADIUS;
        if (d2 > radius * radius) continue;
        const h = this.ground.heightAt(entry.landmark.anchor.x, entry.landmark.anchor.z);
        if (h === null || !Number.isFinite(h)) continue;
        const distance = Math.sqrt(d2);
        const lod = landmarkLod(distance, 'far');
        const context = this.context(lod);
        if (entry.landmark.ready?.(context) === false) continue;
        this.build(entry, context, distance, lod);
        continue;
      }
      if (d2 > (replaced ? REPLACED_DROP_RADIUS : DROP_RADIUS) ** 2) {
        this.disposeEntry(entry);
        continue;
      }
      if (!moved) continue;
      const distance = Math.sqrt(d2);
      const next = landmarkLod(distance, entry.lod);
      if (next !== entry.lod) this.rebuild(entry, next, distance);
      else if (d2 <= PHOTO_RADIUS * PHOTO_RADIUS) this.requestPhotos(entry);
    }
    if (moved) {
      this.lastEvalX = x;
      this.lastEvalZ = z;
    }
  }

  setNight(night: number): void {
    this.night = Math.max(0, Math.min(1, night));
    for (const material of this.lampMaterials) material.emissiveIntensity = this.night * 1.6;
  }

  surfacesAt(x: number, z: number, out: LandmarkSurface[]): void {
    out.length = 0;
    for (const entry of this.entries) {
      if (entry.build === null) continue;
      for (const surface of entry.surfaces) {
        if (surface.heightAt(x, z) !== null || surface.blockedAt !== undefined) out.push(surface);
      }
    }
  }

  private context(lod: LandmarkLod): LandmarkBuildContext {
    return {
      groundAt: (x, z) => this.ground.groundHeightAt?.(x, z) ?? this.ground.heightAt(x, z),
      isWater: (x, z) => this.ground.isWater?.(x, z) ?? false,
      quality: this.quality,
      lod,
    };
  }

  private build(entry: Instance, context: LandmarkBuildContext, distance: number, lod: LandmarkLod): void {
    const build = entry.landmark.build(context);
    const parts = this.instantiate(build, entry.landmark.id);
    entry.build = build;
    entry.surfaces = build.surfaces;
    entry.group = parts.group;
    entry.handles = parts.handles;
    entry.lod = lod;
    this.scene.add(parts.group);
    if (distance <= PHOTO_RADIUS) this.requestPhotos(entry);
  }

  /** Build a new group first, then remove and dispose the old one, so the swap never shows a gap. */
  private rebuild(entry: Instance, lod: LandmarkLod, distance: number): void {
    const context = this.context(lod);
    if (entry.landmark.ready?.(context) === false) return;
    const build = entry.landmark.build(context);
    const parts = this.instantiate(build, entry.landmark.id);
    const oldGroup = entry.group;
    const oldHandles = entry.handles;
    entry.build = build;
    entry.surfaces = build.surfaces;
    entry.group = parts.group;
    entry.handles = parts.handles;
    entry.lod = lod;
    this.scene.add(parts.group);
    if (oldGroup !== null) this.scene.remove(oldGroup);
    this.releaseGroup(oldGroup, oldHandles);
    if (distance <= PHOTO_RADIUS) this.requestPhotos(entry);
  }

  private instantiate(build: LandmarkBuild, id: string): GroupParts {
    const group = new THREE.Group();
    group.name = `landmark:${id}`;
    const handles: TexturedMaterialHandle[] = [];
    for (const data of build.meshes) {
      if (data.indices.length === 0) continue;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(data.normals, 3));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(data.colors, 3));
      let material: THREE.Material;
      if (data.kind === 'textured') {
        const vertices = data.positions.length / 3;
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(data.uvs ?? new Float32Array(vertices * 2), 2));
        geometry.setAttribute('aPbr', new THREE.Float32BufferAttribute(data.pbr ?? new Float32Array(vertices).fill(-1), 1));
        const handle = this.textured.acquire(data.photo);
        handles.push(handle);
        material = handle.material;
      } else {
        material = this.makeMaterial(data.kind);
      }
      geometry.setIndex(new THREE.Uint32BufferAttribute(data.indices, 1));
      geometry.computeBoundingSphere();
      group.add(new THREE.Mesh(geometry, material));
    }
    return { group, handles };
  }

  private makeMaterial(kind: LandmarkMeshKind): THREE.MeshLambertMaterial {
    const material = new THREE.MeshLambertMaterial({ vertexColors: true });
    if (kind === 'water') {
      material.transparent = true;
      material.opacity = 0.72;
      material.depthWrite = false;
      this.waterMaterials.push(material);
    } else if (kind === 'lamp') {
      material.emissive.setHex(0xffd78f);
      material.emissiveIntensity = this.night * 1.6;
      this.lampMaterials.push(material);
    } else {
      if (kind === 'paving') {
        material.polygonOffset = true;
        material.polygonOffsetFactor = -2;
        material.polygonOffsetUnits = -8;
      }
      this.opaqueMaterials.push(material);
    }
    return material;
  }

  private requestPhotos(entry: Instance): void {
    for (const handle of entry.handles) handle.requestPhoto();
  }

  private disposeEntry(entry: Instance): void {
    const group = entry.group;
    const handles = entry.handles;
    entry.group = null;
    entry.build = null;
    entry.surfaces = [];
    entry.handles = [];
    if (group !== null) {
      this.scene.remove(group);
      this.releaseGroup(group, handles);
    }
  }

  private releaseGroup(group: THREE.Group | null, handles: readonly TexturedMaterialHandle[]): void {
    if (group !== null) {
      for (const child of group.children) {
        const mesh = child as THREE.Mesh;
        mesh.geometry.dispose();
        const material = mesh.material as THREE.Material;
        if ((material.userData as { vkTextured?: boolean }).vkTextured === true) continue;
        for (const list of [this.opaqueMaterials, this.waterMaterials, this.lampMaterials]) {
          const i = list.indexOf(material as THREE.MeshLambertMaterial);
          if (i >= 0) list.splice(i, 1);
        }
        material.dispose();
      }
    }
    for (const handle of handles) handle.release();
  }

  dispose(): void {
    for (const entry of this.entries) this.disposeEntry(entry);
    this.textured.dispose();
  }
}

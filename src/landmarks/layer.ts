import * as THREE from 'three';
import type { Quality } from '../quality.ts';
import type { Landmark, LandmarkBuild, LandmarkBuildContext, LandmarkMeshKind, LandmarkSurface } from './types.ts';

export interface LandmarkGround {
  heightAt(x: number, z: number, refY?: number): number | null;
  groundHeightAt?(x: number, z: number, refY?: number): number | null;
  isWater?(x: number, z: number, refY?: number): boolean;
  blockedAt?(x: number, z: number, y: number, bodyH?: number): boolean;
  trunkNear?(x: number, z: number, r: number): boolean;
}

const BUILD_RADIUS = 600;
const DROP_RADIUS = 900;

interface Instance {
  readonly landmark: Landmark;
  build: LandmarkBuild | null;
  group: THREE.Group | null;
  surfaces: readonly LandmarkSurface[];
}

/** Lazily-created landmark meshes with a fixed distance-only hot path. */
export class LandmarkLayer {
  readonly landmarks: readonly Landmark[];
  private readonly entries: Instance[];
  private readonly scene: THREE.Scene;
  private readonly ground: LandmarkGround;
  private readonly quality: Quality;
  private night = 0;
  private readonly opaqueMaterials: THREE.MeshLambertMaterial[] = [];
  private readonly waterMaterials: THREE.MeshLambertMaterial[] = [];
  private readonly lampMaterials: THREE.MeshLambertMaterial[] = [];

  constructor(scene: THREE.Scene, landmarks: readonly Landmark[], ground: LandmarkGround, quality: Quality) {
    this.scene = scene;
    this.landmarks = landmarks;
    this.ground = ground;
    this.quality = quality;
    this.entries = landmarks.map((landmark) => ({ landmark, build: null, group: null, surfaces: [] }));
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

  update(x: number, z: number): void {
    for (const entry of this.entries) {
      const dx = x - entry.landmark.anchor.x;
      const dz = z - entry.landmark.anchor.z;
      const d2 = dx * dx + dz * dz;
      if (entry.build === null) {
        if (d2 > BUILD_RADIUS * BUILD_RADIUS) continue;
        const h = this.ground.heightAt(entry.landmark.anchor.x, entry.landmark.anchor.z);
        if (h === null || !Number.isFinite(h)) continue;
        const context = this.context();
        if (entry.landmark.ready?.(context) === false) continue;
        this.build(entry, context);
      } else if (d2 > DROP_RADIUS * DROP_RADIUS) {
        this.disposeEntry(entry);
      }
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

  private context(): LandmarkBuildContext {
    return {
      groundAt: (x, z) => this.ground.groundHeightAt?.(x, z) ?? this.ground.heightAt(x, z),
      isWater: (x, z) => this.ground.isWater?.(x, z) ?? false,
      quality: this.quality,
    };
  }

  private build(entry: Instance, ctx: LandmarkBuildContext): void {
    const build = entry.landmark.build(ctx);
    entry.build = build;
    entry.surfaces = build.surfaces;
    const group = new THREE.Group();
    group.name = `landmark:${entry.landmark.id}`;
    for (const data of build.meshes) {
      if (data.indices.length === 0) continue;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(data.normals, 3));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(data.colors, 3));
      geometry.setIndex(new THREE.Uint32BufferAttribute(data.indices, 1));
      geometry.computeBoundingSphere();
      const material = this.makeMaterial(data.kind);
      group.add(new THREE.Mesh(geometry, material));
    }
    entry.group = group;
    this.scene.add(group);
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

  private disposeEntry(entry: Instance): void {
    if (entry.group !== null) {
      this.scene.remove(entry.group);
      for (const child of entry.group.children) {
        const mesh = child as THREE.Mesh;
        mesh.geometry.dispose();
        const material = mesh.material as THREE.Material;
        for (const list of [this.opaqueMaterials, this.waterMaterials, this.lampMaterials]) {
          const i = list.indexOf(material as THREE.MeshLambertMaterial);
          if (i >= 0) list.splice(i, 1);
        }
        material.dispose();
      }
    }
    entry.group = null;
    entry.build = null;
    entry.surfaces = [];
  }

  dispose(): void {
    for (const entry of this.entries) this.disposeEntry(entry);
  }
}

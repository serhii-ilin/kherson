import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { FREGAT_WAY_ID } from './fregat-model.ts';

/**
 * Photo-referenced hero for Hotel «Фрегат». The extruded mesh skips this way
 * (src/mesh/heroes.ts). The glTF is Meshopt-compressed and decoded with three's decoder.
 */
export class FregatHero {
  private readonly loader = new GLTFLoader();
  private group: THREE.Group | null = null;
  private started = false;
  private placed = false;
  triangleCount = 0;

  private anchorX = 0;
  private anchorZ = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly url: string,
    private readonly castShadow: boolean,
    private readonly heightAt: (x: number, z: number) => number | null,
  ) {
    this.loader.setMeshoptDecoder(MeshoptDecoder);
  }

  update(): void {
    if (!this.started) {
      this.started = true;
      this.loader.load(this.url, (gltf) => {
        const extras = gltf.parser.json.asset?.extras as { osmWay?: number; anchorX?: number; anchorZ?: number } | undefined;
        if (extras?.osmWay !== FREGAT_WAY_ID || extras.anchorX === undefined || extras.anchorZ === undefined) return;
        this.anchorX = extras.anchorX;
        this.anchorZ = extras.anchorZ;
        const group = gltf.scene;
        group.position.set(extras.anchorX, 0, extras.anchorZ);
        group.traverse((obj) => {
          const mesh = obj as THREE.Mesh;
          if (!mesh.isMesh) return;
          mesh.castShadow = this.castShadow;
          mesh.receiveShadow = true;
          const geo = mesh.geometry;
          this.triangleCount += (geo.index?.count ?? geo.getAttribute('position').count) / 3;
        });
        this.group = group;
        this.scene.add(group);
        this.tryPlace();
      }, undefined, (err) => console.warn('fregat', err));
    }
    if (this.group !== null && !this.placed) this.tryPlace();
  }

  private tryPlace(): void {
    const y = this.heightAt(this.anchorX, this.anchorZ);
    if (y === null || this.group === null) return;
    this.group.position.y = y;
    this.placed = true;
  }

  dispose(): void {
    if (this.group === null) return;
    this.scene.remove(this.group);
    this.group.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
      const mat = mesh.material;
      if (Array.isArray(mat)) for (const m of mat) m.dispose();
      else mat.dispose();
    });
    this.group = null;
  }
}

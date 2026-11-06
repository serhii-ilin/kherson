/**
 * Sky reflections for the PBR facade shader (docs/BUILDINGS_PLAN.md task E2). Glass and wet materials
 * rely on `scene.environment`, so this keeps a PMREM of the sky dome itself in step with the time of
 * day. The dome is a private scene that shares the sky's geometry and material, so no shader or
 * texture is duplicated; the render target is only rebuilt when the clock has moved ten minutes.
 */
import * as THREE from 'three';

const MINUTES_PER_DAY = 1440;

/** Half the circular distance between two times of day, in minutes. */
function circularMinutes(a: number, b: number): number {
  const d = Math.abs(a - b) % MINUTES_PER_DAY;
  return Math.min(d, MINUTES_PER_DAY - d);
}

/**
 * True when a sky PMREM rendered at `last` minutes is too old for `now`. Pure and allocation-free so
 * the throttling rule can be tested without a renderer; null means nothing has been rendered yet.
 */
export function shouldRegenerate(last: number | null, now: number): boolean {
  if (last === null || !Number.isFinite(last)) return true;
  return circularMinutes(last, now) >= 10;
}

/**
 * Owns the PMREM generator, the private sky scene and the current environment render target. `update`
 * returns a new texture only when it re-rendered, otherwise null, and never allocates on the null path.
 */
export class SkyEnvironment {
  private readonly pmrem: THREE.PMREMGenerator;
  private readonly scene: THREE.Scene;
  private readonly far: number;
  private target: THREE.WebGLRenderTarget | null = null;
  private lastMinutes: number | null = null;

  constructor(renderer: THREE.WebGLRenderer, sky: { mesh: THREE.Mesh }) {
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.scene = new THREE.Scene();
    // Share the live dome: its material uniforms already track the time of day.
    const mesh = new THREE.Mesh(sky.mesh.geometry, sky.mesh.material);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    const geometry = sky.mesh.geometry;
    if (geometry.boundingSphere === null) geometry.computeBoundingSphere();
    this.far = Math.max(1, (geometry.boundingSphere?.radius ?? 1000) * 2);
  }

  /** Render the sky into a PMREM when the clock moved by ten minutes or more; otherwise return null. */
  update(minutesOfDay: number): THREE.Texture | null {
    if (!shouldRegenerate(this.lastMinutes, minutesOfDay)) return null;
    this.lastMinutes = minutesOfDay;
    if (this.target !== null) {
      this.target.dispose();
      this.target = null;
    }
    this.target = this.pmrem.fromScene(this.scene, 0, 0.1, this.far);
    return this.target.texture;
  }

  dispose(): void {
    this.target?.dispose();
    this.target = null;
    this.lastMinutes = null;
    this.pmrem.dispose();
  }
}

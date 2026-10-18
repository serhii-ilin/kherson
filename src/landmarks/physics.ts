import type { WalkWorld } from '../player/walk.ts';
import type { LandmarkGround, LandmarkLayer } from './layer.ts';

/** Thin landmark overlay: outside a built landmark every result is the underlying world result. */
export class LandmarkPhysics implements WalkWorld {
  private readonly surfaces: import('./types.ts').LandmarkSurface[] = [];

  constructor(private readonly base: LandmarkGround, private readonly landmarks: LandmarkLayer) {}

  heightAt(x: number, z: number, refY?: number): number | null {
    const base = this.base.heightAt(x, z, refY);
    this.landmarks.surfacesAt(x, z, this.surfaces);
    let best = base;
    for (const surface of this.surfaces) {
      const h = surface.heightAt(x, z);
      if (h !== null && (best === null || h > best)) best = h;
    }
    return best;
  }

  isWater(x: number, z: number, refY?: number): boolean {
    this.landmarks.surfacesAt(x, z, this.surfaces);
    for (const surface of this.surfaces) if (surface.heightAt(x, z) !== null && surface.isWater !== true) return false;
    return this.base.isWater?.(x, z, refY) ?? false;
  }

  blockedAt(x: number, z: number, y: number, bodyH = 1.8): boolean {
    if (this.base.blockedAt?.(x, z, y, bodyH)) return true;
    this.landmarks.surfacesAt(x, z, this.surfaces);
    for (const surface of this.surfaces) if (surface.blockedAt?.(x, z, y, bodyH)) return true;
    return false;
  }

  trunkNear(x: number, z: number, r: number): boolean {
    return this.base.trunkNear?.(x, z, r) ?? false;
  }
}

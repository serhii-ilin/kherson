import type { MoveAxis } from './input.ts';

export const EYE_HEIGHT = 1.7;
export const PLAYER_RADIUS = 0.4;
export const GRAVITY = 25;
export const JUMP_SPEED = 7;
export const WALK_SPEED = 5;
export const SPRINT_SPEED = 10;
/** One voxel: the highest ledge climbed automatically. */
export const STEP_HEIGHT = 2;
/** Time over which the camera eases after a step up or down. */
export const STEP_SMOOTH_S = 0.15;
/** Water blocks walkers whose feet are less than this above the water surface. */
const WATER_CLEARANCE = 3;
const EPS = 1e-4;

export interface WalkWorld {
  /** Top surface in metres, or null when unknown. `refY` makes bridge decks above it be ignored. */
  heightAt(x: number, z: number, refY?: number): number | null;
  isWater?(x: number, z: number, refY?: number): boolean;
  /** True when a tree trunk centre lies within r metres of (x, z). */
  trunkNear?(x: number, z: number, r: number): boolean;
  /** True when a body with feet at `y` overlaps a solid wall-like obstacle (bridge railing) at (x, z). */
  blockedAt?(x: number, z: number, y: number): boolean;
}

/** A walker is stopped when its centre comes this close to a tree trunk centre. */
export const TRUNK_RADIUS = 0.4;

/** First-person walking body. `y` is the feet height. */
export class WalkBody {
  x = 0;
  y = 0;
  z = 0;
  vy = 0;
  grounded = false;
  /** Camera offset below/above the physical eye, decaying to 0 after steps. */
  stepOffset = 0;

  get eyeY(): number { return this.y + EYE_HEIGHT + this.stepOffset; }

  /** Highest surface under the footprint at (x, z), or null if any part is unknown. */
  private ground(world: WalkWorld, x: number, z: number, refY: number): number | null {
    const r = PLAYER_RADIUS;
    let best = -Infinity;
    for (let i = 0; i < 4; i++) {
      const h = world.heightAt(x + (i & 1 ? r : -r), z + (i & 2 ? r : -r), refY);
      if (h === null) return null;
      if (h > best) best = h;
    }
    return best;
  }

  private wet(world: WalkWorld, x: number, z: number, refY: number): boolean {
    if (!world.isWater) return false;
    const r = PLAYER_RADIUS;
    for (let i = 0; i < 4; i++) {
      if (world.isWater(x + (i & 1 ? r : -r), z + (i & 2 ? r : -r), refY)) return true;
    }
    return false;
  }

  /** Can the body stand at (x, z) at its current height (ledge <= STEP_HEIGHT, no deep water)? */
  private passable(world: WalkWorld, x: number, z: number): boolean {
    const g = this.ground(world, x, z, this.y + STEP_HEIGHT);
    if (g === null) return false;
    if (g > this.y + STEP_HEIGHT + EPS) return false;
    return !(this.y < g + WATER_CLEARANCE && this.wet(world, x, z, this.y + STEP_HEIGHT));
  }

  /** Moving into a trunk is blocked; leaving one the body already overlaps is not. */
  private hitsTrunk(world: WalkWorld, x: number, z: number): boolean {
    if (!world.trunkNear) return false;
    return world.trunkNear(x, z, TRUNK_RADIUS) && !world.trunkNear(this.x, this.z, TRUNK_RADIUS);
  }

  /** A railing in any corner of the footprint; leaving one the body already overlaps is not blocked. */
  private hitsRail(world: WalkWorld, x: number, z: number): boolean {
    if (!world.blockedAt) return false;
    const r = PLAYER_RADIUS;
    const at = (px: number, pz: number): boolean => {
      for (let i = 0; i < 4; i++) {
        if (world.blockedAt!(px + (i & 1 ? r : -r), pz + (i & 2 ? r : -r), this.y)) return true;
      }
      return false;
    };
    return at(x, z) && !at(this.x, this.z);
  }

  /** Puts the feet on the highest surface at (x, z); false when that column is not loaded. */
  placeOnGround(world: WalkWorld, x: number, z: number): boolean {
    const g = this.ground(world, x, z, Infinity);
    if (g === null) return false;
    this.x = x;
    this.z = z;
    this.y = g;
    this.vy = 0;
    this.grounded = true;
    this.stepOffset = 0;
    return true;
  }

  step(
    world: WalkWorld, dt: number, axis: MoveAxis, yaw: number, sprint: boolean, jump: boolean,
  ): void {
    // horizontal wish direction (forward = -z at yaw 0)
    const sy = Math.sin(yaw);
    const cy = Math.cos(yaw);
    let wx = -sy * axis.forward + cy * axis.right;
    let wz = -cy * axis.forward - sy * axis.right;
    const len = Math.hypot(wx, wz);
    const speed = sprint ? SPRINT_SPEED : WALK_SPEED;
    if (len > 1) { wx /= len; wz /= len; }
    const dx = wx * speed * dt;
    const dz = wz * speed * dt;

    // per-axis resolution: try x, then z (lets the player slide along walls)
    if (dx !== 0 && this.passable(world, this.x + dx, this.z) && !this.hitsTrunk(world, this.x + dx, this.z)
      && !this.hitsRail(world, this.x + dx, this.z)) this.x += dx;
    if (dz !== 0 && this.passable(world, this.x, this.z + dz) && !this.hitsTrunk(world, this.x, this.z + dz)
      && !this.hitsRail(world, this.x, this.z + dz)) this.z += dz;

    // vertical
    const ground = this.ground(world, this.x, this.z, this.y + STEP_HEIGHT);
    if (ground === null) {
      this.vy = 0; // column not loaded yet: hold position
      return;
    }
    if (this.grounded && jump) {
      this.vy = JUMP_SPEED;
      this.grounded = false;
    }
    if (this.grounded && this.vy <= 0) {
      const delta = ground - this.y;
      if (delta >= -STEP_HEIGHT - EPS) {
        // stairs-like step up or down: snap, ease the camera
        if (delta !== 0) this.stepOffset -= delta;
        this.y = ground;
        this.vy = 0;
      } else {
        this.grounded = false;
      }
    }
    if (!this.grounded) {
      this.vy -= GRAVITY * dt;
      this.y += this.vy * dt;
      if (this.y <= ground) {
        this.y = ground;
        this.vy = 0;
        this.grounded = true;
      }
    }
    if (this.stepOffset !== 0) {
      const k = (STEP_HEIGHT / STEP_SMOOTH_S) * dt; // metres of decay this frame
      if (Math.abs(this.stepOffset) <= k) this.stepOffset = 0;
      else this.stepOffset -= Math.sign(this.stepOffset) * k;
    }
  }
}

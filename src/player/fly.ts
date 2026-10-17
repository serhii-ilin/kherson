import type { MoveAxis } from './input.ts';

export const FLY_SPEED = 30;
export const FLY_SPRINT = 4;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Free-fly: moves `pos` along the look direction; Space/C go straight up/down. No collision. */
export function flyStep(pos: Vec3, dt: number, axis: MoveAxis, yaw: number, pitch: number, sprint: boolean): void {
  const speed = FLY_SPEED * (sprint ? FLY_SPRINT : 1) * dt;
  const cp = Math.cos(pitch);
  const sy = Math.sin(yaw);
  const cy = Math.cos(yaw);
  pos.x += (-sy * cp * axis.forward + cy * axis.right) * speed;
  pos.y += (Math.sin(pitch) * axis.forward + axis.up) * speed;
  pos.z += (-cy * cp * axis.forward - sy * axis.right) * speed;
}

/** Minimum camera clearance above any surface while flying. */
export const FLY_CLEARANCE = 1.5;

export interface FlyWorld {
  heightAt(x: number, z: number): number | null;
}

/**
 * Keeps a flying camera out of the ground and buildings: horizontal moves into a wall that is
 * higher than the camera are cancelled per axis (sliding along it), and the camera never goes
 * below surface + FLY_CLEARANCE. Unloaded columns (null) don't constrain.
 */
export function flyCollide(pos: Vec3, prevX: number, prevZ: number, world: FlyWorld): void {
  const nx = pos.x;
  const nz = pos.z;
  const blocked = (x: number, z: number): boolean => {
    const h = world.heightAt(x, z);
    return h !== null && h + FLY_CLEARANCE > pos.y;
  };
  // Only block sideways moves that enter a wall; if we are already inside (e.g. after a
  // teleport), let the vertical clamp lift us out instead of freezing.
  if (!blocked(prevX, prevZ)) {
    pos.x = blocked(nx, prevZ) ? prevX : nx;
    pos.z = blocked(pos.x, nz) ? prevZ : nz;
  }
  const h = world.heightAt(pos.x, pos.z);
  if (h !== null && pos.y < h + FLY_CLEARANCE) pos.y = h + FLY_CLEARANCE;
}

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

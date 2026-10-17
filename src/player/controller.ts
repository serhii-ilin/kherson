import type * as THREE from 'three';
import { flyCollide, flyStep, type Vec3 } from './fly.ts';
import type { Input } from './input.ts';
import { EYE_HEIGHT, WalkBody, type WalkWorld } from './walk.ts';

export type Mode = 'walk' | 'fly';

const MAX_PITCH = Math.PI / 2 - 0.01;

/** Owns camera yaw/pitch and the walk/fly modes; F toggles. */
export class PlayerController {
  mode: Mode = 'walk';
  yaw = 0;
  pitch = 0;
  readonly walk = new WalkBody();
  /** Fly position is the camera position. */
  readonly flyPos: Vec3 = { x: 0, y: 0, z: 0 };
  private spawnPending = false;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly input: Input,
  ) {
    camera.rotation.order = 'YXZ';
    input.onPress = (code) => {
      if (code === 'KeyF') this.toggle();
    };
  }

  /** Walk mode at (x, z) facing north; the feet snap to the ground once that column is loaded. */
  spawn(x: number, z: number): void {
    this.mode = 'walk';
    this.walk.x = x;
    this.walk.z = z;
    this.walk.y = 0;
    this.walk.vy = 0;
    this.yaw = 0;
    this.pitch = 0;
    this.spawnPending = true;
    this.camera.position.set(x, EYE_HEIGHT + 50, z);
    this.syncCamera();
  }

  /** Fly mode at an exact pose (used by `?x=&z=` URLs). */
  setFlyPose(x: number, y: number, z: number, yaw: number, pitch: number): void {
    this.mode = 'fly';
    this.spawnPending = false;
    this.flyPos.x = x;
    this.flyPos.y = y;
    this.flyPos.z = z;
    this.yaw = yaw;
    this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, pitch));
    this.camera.position.set(x, y, z);
    this.syncCamera();
  }

  get x(): number { return this.camera.position.x; }
  get y(): number { return this.camera.position.y; }
  get z(): number { return this.camera.position.z; }

  toggle(): void {
    if (this.mode === 'walk') {
      this.mode = 'fly';
      this.flyPos.x = this.camera.position.x;
      this.flyPos.y = this.camera.position.y;
      this.flyPos.z = this.camera.position.z;
    } else {
      this.mode = 'walk';
      const w = this.walk;
      w.x = this.flyPos.x;
      w.z = this.flyPos.z;
      w.y = this.flyPos.y - EYE_HEIGHT;
      w.vy = 0;
      w.grounded = false;
      w.stepOffset = 0;
    }
  }

  update(dt: number, world: WalkWorld): void {
    const look = this.input.consumeLook();
    this.yaw -= look.x;
    this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch - look.y));
    const axis = this.input.axis();

    if (this.mode === 'fly') {
      const px = this.flyPos.x;
      const pz = this.flyPos.z;
      flyStep(this.flyPos, dt, axis, this.yaw, this.pitch, this.input.sprint);
      flyCollide(this.flyPos, px, pz, world);
      this.camera.position.set(this.flyPos.x, this.flyPos.y, this.flyPos.z);
    } else {
      if (this.spawnPending) {
        if (this.walk.placeOnGround(world, this.walk.x, this.walk.z)) this.spawnPending = false;
      } else {
        // entering walk mode from the air: fall; inside a building the ground snap lifts onto the roof
        this.walk.step(world, dt, axis, this.yaw, this.input.sprint, this.input.jump);
      }
      this.camera.position.set(this.walk.x, this.walk.eyeY, this.walk.z);
    }
    this.syncCamera();
  }

  private syncCamera(): void {
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }
}

import * as THREE from 'three';
import type { BirdWorld } from './birds.ts';
import { buildFishGeometry } from './fish-models.ts';
import { waveHeight } from './water.ts';

export interface FishOptions {
  mobile?: boolean;
  rng?: () => number;
  maxEvents?: number;
}

export interface SplashInfo { x: number; y: number; z: number; size: number; t: number }

const TAU = Math.PI * 2;
const WATER_SURFACE = 2;
const MAX_EVENTS = 6;
const MOBILE_EVENTS = 3;
const CANDIDATES = 8;
const RING_LIFE = 1.5;
const DROPS_PER_SPLASH = 10;
const DROP_GRAVITY = 5;
const FISH_HOLD = 0.12;
/** Above the wave surface: the water is opaque, so a shadow drawn under it would never show. */
const SHADOW_OFFSET = 0.02;
const RING_OFFSET = 0.05;

interface FishEvent {
  active: boolean;
  kind: number; // 0 jump, 1 shadow
  x: number; z: number; y: number;
  angle: number; length: number; travel: number; duration: number; peak: number;
  age: number; started: number;
}

function makeEvent(): FishEvent {
  return { active: false, kind: 0, x: 0, z: 0, y: WATER_SURFACE, angle: 0, length: 0.35, travel: 1,
    duration: 0.8, peak: 0.6, age: 0, started: 0 };
}

/** Mesh material with a per-instance fade, used by the three transient effect pools. */
function makeFadeMaterial(color: number, opacity: number): THREE.MeshBasicMaterial {
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aFade;\nvarying float vFade;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFade = aFade;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vFade;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a *= vFade;');
  };
  return mat;
}

export class FishSystem {
  readonly splashes: SplashInfo[] = [];

  private readonly scene: THREE.Scene;
  private readonly rng: () => number;
  private readonly max: number;
  private readonly events: FishEvent[] = [];
  private readonly ringMesh: THREE.InstancedMesh;
  private readonly dropMesh: THREE.InstancedMesh;
  private readonly fishMesh: THREE.InstancedMesh;
  private readonly shadowMesh: THREE.InstancedMesh;
  private readonly ringFade: THREE.InstancedBufferAttribute;
  private readonly dropFade: THREE.InstancedBufferAttribute;
  private readonly shadowFade: THREE.InstancedBufferAttribute;
  private readonly ringActive: Uint8Array;
  private readonly ringStart: Float32Array;
  private readonly ringX: Float32Array;
  private readonly ringY: Float32Array;
  private readonly ringZ: Float32Array;
  private readonly ringSize: Float32Array;
  private readonly dropActive: Uint8Array;
  private readonly dropStart: Float32Array;
  private readonly dropX: Float32Array;
  private readonly dropY: Float32Array;
  private readonly dropZ: Float32Array;
  private readonly dropVx: Float32Array;
  private readonly dropVy: Float32Array;
  private readonly dropVz: Float32Array;
  private readonly dropSize: Float32Array;
  private readonly dropDuration: Float32Array;
  private active = 0;
  private splashWrite = 0;
  private spawnT: number;
  private daylight = 1;

  // Scratch objects used by every update.
  private readonly matrix = new THREE.Matrix4();
  private readonly zero = new THREE.Matrix4().makeScale(0, 0, 0);
  private readonly forward = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly worldUp = new THREE.Vector3(0, 1, 0);
  private readonly scale = new THREE.Vector3();

  constructor(scene: THREE.Scene, opts: FishOptions = {}) {
    this.scene = scene;
    this.rng = opts.rng ?? Math.random;
    const deviceMax = opts.mobile ? MOBILE_EVENTS : MAX_EVENTS;
    this.max = Math.min(deviceMax, Math.max(0, Math.floor(opts.maxEvents ?? deviceMax)));
    this.spawnT = this.range(2.5, 5);
    for (let i = 0; i < this.max; i++) this.events.push(makeEvent());
    // A fixed set of records lets audio inspect the array without an update-time push.
    for (let i = 0; i < this.max * 4; i++) this.splashes.push({ x: 0, y: 0, z: 0, size: 0, t: -Infinity });

    const fishMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
    const ringMaterial = makeFadeMaterial(0xe6efe9, 0.9);
    const dropMaterial = makeFadeMaterial(0xffffff, 0.9);
    const shadowMaterial = makeFadeMaterial(0x1b3644, 0.45);
    const fishGeometry = buildFishGeometry();
    this.fishMesh = new THREE.InstancedMesh(fishGeometry, fishMaterial, this.max);
    this.fishMesh.frustumCulled = false;
    this.fishMesh.castShadow = false;
    this.fishMesh.receiveShadow = false;
    this.fishMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    const rings = this.max * 2;
    this.ringActive = new Uint8Array(rings);
    this.ringStart = new Float32Array(rings);
    this.ringX = new Float32Array(rings);
    this.ringY = new Float32Array(rings);
    this.ringZ = new Float32Array(rings);
    this.ringSize = new Float32Array(rings);
    this.ringFade = new THREE.InstancedBufferAttribute(new Float32Array(rings), 1);
    const ringGeometry = new THREE.RingGeometry(0.82, 1, 24);
    this.ringMesh = new THREE.InstancedMesh(ringGeometry, ringMaterial, rings);
    ringGeometry.rotateX(-Math.PI / 2);
    ringGeometry.setAttribute('aFade', this.ringFade);
    this.prepareMesh(this.ringMesh);

    const drops = rings * DROPS_PER_SPLASH;
    this.dropActive = new Uint8Array(drops);
    this.dropStart = new Float32Array(drops);
    this.dropX = new Float32Array(drops);
    this.dropY = new Float32Array(drops);
    this.dropZ = new Float32Array(drops);
    this.dropVx = new Float32Array(drops);
    this.dropVy = new Float32Array(drops);
    this.dropVz = new Float32Array(drops);
    this.dropSize = new Float32Array(drops);
    this.dropDuration = new Float32Array(drops);
    this.dropFade = new THREE.InstancedBufferAttribute(new Float32Array(drops), 1);
    const dropGeometry = new THREE.BoxGeometry(1, 1, 1);
    dropGeometry.setAttribute('aFade', this.dropFade);
    this.dropMesh = new THREE.InstancedMesh(dropGeometry, dropMaterial, drops);
    this.prepareMesh(this.dropMesh);

    const shadows = this.max;
    this.shadowFade = new THREE.InstancedBufferAttribute(new Float32Array(shadows), 1);
    const shadowGeometry = new THREE.CircleGeometry(0.5, 16);
    shadowGeometry.rotateX(-Math.PI / 2);
    shadowGeometry.setAttribute('aFade', this.shadowFade);
    this.shadowMesh = new THREE.InstancedMesh(shadowGeometry, shadowMaterial, shadows);
    this.prepareMesh(this.shadowMesh);
    this.shadowMesh.renderOrder = 3;
    this.ringMesh.renderOrder = 3;
    this.dropMesh.renderOrder = 3;
    this.shadowMesh.renderOrder = 2;
    scene.add(this.fishMesh, this.ringMesh, this.dropMesh, this.shadowMesh);
  }

  get activeEvents(): number { return this.active; }

  setDaylight(day: number): void {
    this.daylight = Math.min(1, Math.max(0, day));
  }

  update(dt: number, timeSeconds: number, world: BirdWorld, camera: { x: number; y: number; z: number; yaw: number }): void {
    if (!(dt > 0)) return;
    this.updateEvents(dt, timeSeconds);
    this.updateRings(timeSeconds);
    this.updateDrops(timeSeconds);
    if (this.max > 0 && this.daylight > 0) {
      this.spawnT -= dt * this.daylight;
      if (this.spawnT <= 0 && this.active < this.max) {
        this.spawnT = this.range(2.5, 5);
        this.trySpawn(world, camera, timeSeconds);
      }
    }
    this.fishMesh.instanceMatrix.needsUpdate = true;
    this.ringMesh.instanceMatrix.needsUpdate = true;
    this.dropMesh.instanceMatrix.needsUpdate = true;
    this.shadowMesh.instanceMatrix.needsUpdate = true;
    this.ringFade.needsUpdate = true;
    this.dropFade.needsUpdate = true;
    this.shadowFade.needsUpdate = true;
  }

  dispose(): void {
    this.scene.remove(this.fishMesh, this.ringMesh, this.dropMesh, this.shadowMesh);
    this.fishMesh.geometry.dispose();
    this.ringMesh.geometry.dispose();
    this.dropMesh.geometry.dispose();
    this.shadowMesh.geometry.dispose();
    (this.fishMesh.material as THREE.Material).dispose();
    (this.ringMesh.material as THREE.Material).dispose();
    (this.dropMesh.material as THREE.Material).dispose();
    (this.shadowMesh.material as THREE.Material).dispose();
  }

  private prepareMesh(mesh: THREE.InstancedMesh): void {
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < mesh.count; i++) mesh.setMatrixAt(i, this.zero);
  }

  private range(lo: number, hi: number): number { return lo + (hi - lo) * this.rng(); }

  private trySpawn(world: BirdWorld, camera: { x: number; y: number; z: number; yaw: number }, now: number): void {
    let x = 0, z = 0, y = WATER_SURFACE;
    let found = false;
    for (let i = 0; i < CANDIDATES; i++) {
      const a = camera.yaw + this.range(-Math.PI / 4, Math.PI / 4);
      const d = this.range(8, 35);
      x = camera.x - Math.sin(a) * d;
      z = camera.z - Math.cos(a) * d;
      if (!world.isWater(x, z) || !world.isWater(x + 3, z) || !world.isWater(x - 3, z) ||
          !world.isWater(x, z + 3) || !world.isWater(x, z - 3)) continue;
      y = world.heightAt(x, z) ?? WATER_SURFACE; // still-water level; the waves are added where drawn
      found = true;
      break;
    }
    if (!found) return;
    let slot = -1;
    for (let i = 0; i < this.events.length; i++) {
      if (!this.events[i]!.active) { slot = i; break; }
    }
    if (slot < 0) return;
    const e = this.events[slot]!;
    e.active = true;
    e.kind = this.rng() < 0.7 ? 0 : 1;
    e.x = x; e.z = z; e.y = y; e.age = 0; e.started = now;
    e.angle = this.rng() * TAU;
    if (e.kind === 0) {
      e.length = this.range(0.4, 0.7);
      e.travel = this.range(0.5, 1.5);
      e.duration = this.range(0.6, 1.0);
      e.peak = this.range(0.4, 0.9);
      this.setFish(slot, e, 0);
      this.makeSplash(slot * 2, e.x, e.y, e.z, this.range(0.25, 0.45), now);
    } else {
      e.length = this.range(0.4, 0.8);
      e.travel = this.range(2, 4);
      e.duration = this.range(2, 3);
      e.peak = 0;
      this.setShadow(slot, e, 0, now);
    }
    this.active++;
  }

  private updateEvents(dt: number, now: number): void {
    for (let i = 0; i < this.events.length; i++) {
      const e = this.events[i]!;
      if (!e.active) continue;
      const old = e.age;
      e.age += dt;
      if (e.kind === 0) {
        if (old < e.duration && e.age >= e.duration) {
          this.makeSplash(i * 2 + 1, e.x + Math.cos(e.angle) * e.travel, e.y,
            e.z + Math.sin(e.angle) * e.travel, this.range(0.25, 0.45), e.started + e.duration);
        }
        if (e.age <= e.duration + FISH_HOLD) this.setFish(i, e, Math.min(e.age, e.duration));
        else this.fishMesh.setMatrixAt(i, this.zero);
        if (e.age > e.duration + RING_LIFE) {
          e.active = false;
          this.active--;
        }
      } else {
        if (e.age < e.duration) this.setShadow(i, e, e.age, now);
        else {
          this.shadowFade.setX(i, 0);
          this.shadowMesh.setMatrixAt(i, this.zero);
          e.active = false;
          this.active--;
        }
      }
    }
  }

  private setFish(slot: number, e: FishEvent, age: number): void {
    const u = e.duration > 0 ? age / e.duration : 1;
    const vx = Math.cos(e.angle) * e.travel / e.duration;
    const vz = Math.sin(e.angle) * e.travel / e.duration;
    const gravity = 8 * e.peak / (e.duration * e.duration);
    const vy0 = 4 * e.peak / e.duration;
    const vy = vy0 - gravity * age;
    const px = e.x + Math.cos(e.angle) * e.travel * u;
    const pz = e.z + Math.sin(e.angle) * e.travel * u;
    const py = e.y + waveHeight(e.x, e.z, e.started) + vy0 * age - 0.5 * gravity * age * age + 0.05;
    this.forward.set(vx, vy, vz).normalize();
    this.right.crossVectors(this.forward, this.worldUp).normalize();
    if (this.right.lengthSq() < 1e-8) this.right.set(0, 0, 1);
    this.up.crossVectors(this.right, this.forward).normalize();
    this.matrix.makeBasis(this.forward, this.up, this.right);
    this.scale.set(e.length, e.length, e.length);
    this.matrix.scale(this.scale);
    this.matrix.setPosition(px, py, pz);
    this.fishMesh.setMatrixAt(slot, this.matrix);
  }

  private makeSplash(ring: number, x: number, y: number, z: number, size: number, now: number): void {
    this.ringActive[ring] = 1;
    this.ringStart[ring] = now;
    this.ringX[ring] = x; this.ringY[ring] = y; this.ringZ[ring] = z; this.ringSize[ring] = size;
    const splash = this.splashes[this.splashWrite]!;
    splash.x = x; splash.y = y; splash.z = z; splash.size = size; splash.t = now;
    this.splashWrite = (this.splashWrite + 1) % this.splashes.length;
    const base = ring * DROPS_PER_SPLASH;
    for (let i = 0; i < DROPS_PER_SPLASH; i++) {
      const k = base + i;
      const a = this.rng() * TAU;
      const speed = this.range(0.4, 1.1);
      this.dropActive[k] = 1;
      this.dropStart[k] = now;
      this.dropX[k] = x; this.dropY[k] = y + waveHeight(x, z, now) + 0.03; this.dropZ[k] = z;
      this.dropVx[k] = Math.cos(a) * speed;
      this.dropVz[k] = Math.sin(a) * speed;
      this.dropVy[k] = this.range(1.2, 2.4);
      this.dropSize[k] = this.range(0.06, 0.11);
      this.dropDuration[k] = this.range(0.3, 0.48);
    }
  }

  private updateRings(now: number): void {
    for (let i = 0; i < this.ringActive.length; i++) {
      if (!this.ringActive[i]) continue;
      const age = now - this.ringStart[i]!;
      if (age >= RING_LIFE || age < 0) {
        this.ringActive[i] = 0;
        this.ringFade.setX(i, 0);
        this.ringMesh.setMatrixAt(i, this.zero);
        continue;
      }
      const k = age / RING_LIFE;
      this.ringFade.setX(i, (1 - k) * (1 - k));
      // the ring lies flat (XZ): its radius grows from the splash size to ~4x
      const r = this.ringSize[i]! * (1 + k * 3);
      this.matrix.makeScale(r, 1, r);
      const rx = this.ringX[i]!, rz = this.ringZ[i]!;
      this.matrix.setPosition(rx, this.ringY[i]! + waveHeight(rx, rz, now) + RING_OFFSET, rz);
      this.ringMesh.setMatrixAt(i, this.matrix);
    }
  }

  private updateDrops(now: number): void {
    for (let i = 0; i < this.dropActive.length; i++) {
      if (!this.dropActive[i]) continue;
      const age = now - this.dropStart[i]!;
      const dur = this.dropDuration[i]!;
      if (age >= dur || age < 0) {
        this.dropActive[i] = 0;
        this.dropFade.setX(i, 0);
        this.dropMesh.setMatrixAt(i, this.zero);
        continue;
      }
      const k = age / dur;
      this.dropFade.setX(i, 1 - k);
      this.matrix.makeScale(this.dropSize[i]!, this.dropSize[i]!, this.dropSize[i]!);
      this.matrix.setPosition(
        this.dropX[i]! + this.dropVx[i]! * age,
        this.dropY[i]! + this.dropVy[i]! * age - 0.5 * DROP_GRAVITY * age * age,
        this.dropZ[i]! + this.dropVz[i]! * age,
      );
      this.dropMesh.setMatrixAt(i, this.matrix);
    }
  }

  private setShadow(slot: number, e: FishEvent, age: number, now: number): void {
    const k = age / e.duration;
    const fade = Math.min(1, k / 0.25, (1 - k) / 0.45);
    this.shadowFade.setX(slot, Math.max(0, fade));
    this.matrix.makeRotationY(-e.angle);
    // a flat dark body under the surface (XZ plane): length along the swim direction
    this.scale.set(e.length, 1, e.length * 0.28);
    this.matrix.scale(this.scale);
    const sx = e.x + Math.cos(e.angle) * e.travel * k, sz = e.z + Math.sin(e.angle) * e.travel * k;
    this.matrix.setPosition(sx, e.y + waveHeight(sx, sz, now) + SHADOW_OFFSET, sz);
    this.shadowMesh.setMatrixAt(slot, this.matrix);
  }

}

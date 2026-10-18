import * as THREE from 'three';
import { MAT } from '../world/materials.ts';
import { buildDoveGeometry, buildSwiftGeometry } from './bird-models.ts';

export interface BirdWorld {
  /** Top surface metres (ground or roof); null = not loaded. */
  heightAt(x: number, z: number): number | null;
  /** MAT id of the ground top of that cell, null if not loaded. */
  groundMatAt(x: number, z: number): number | null;
  isWater(x: number, z: number): boolean;
}
/** The player. */
export interface BirdListener { x: number; y: number; z: number; speed: number }

export interface SwiftFlockInfo { x: number; y: number; z: number; vx: number; vy: number; vz: number; count: number }
export interface DoveGroupInfo { x: number; y: number; z: number; count: number; flying: boolean }

export interface BirdOptions {
  maxSwifts?: number;
  maxDoves?: number;
  mobile?: boolean;
  /** Random source in [0,1); defaults to Math.random. */
  rng?: () => number;
}

const TAU = Math.PI * 2;
const GROUND_DEFAULT = 4;
const MAX_GROUP = 20;
const SWIFT_MIN_PER_FLOCK = 4;
const SWIFT_MAX_PER_FLOCK = 15;
const SWIFT_CEILING = 150;

/** Lit material plus a matching depth material so shadows follow the wing flap. */
function makeMaterial(rate: number, fold: boolean): { mat: THREE.MeshLambertMaterial; depth: THREE.MeshDepthMaterial } {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  const patch = (mt: THREE.Material) => (shader: THREE.WebGLProgramParametersWithUniforms): void => {
    shader.uniforms.uTime = { value: 0 };
    shader.uniforms.uFlapRate = { value: rate };
    shader.uniforms.uFold = { value: fold ? 1 : 0 };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute float wing;
attribute float wingSpan;
attribute vec2 aFlap;
uniform float uTime;
uniform float uFlapRate;
uniform float uFold;`,
      )
      .replace(
        '#include <begin_vertex>',
        `vec3 transformed = vec3(position);
if (wing != 0.0) {
  float spread = mix(1.0, smoothstep(0.0, 0.3, aFlap.y), uFold);
  float folded = mix(0.12, 1.0, spread);
  transformed.z = wing * (min(wingSpan, 0.06) + max(wingSpan - 0.06, 0.0) * folded);
  transformed.y -= 0.03 * uFold * (1.0 - spread);
  float a = -wing * aFlap.y * sin(uTime * uFlapRate + aFlap.x);
  float ca = cos(a), sa = sin(a);
  transformed.yz = vec2(ca * transformed.y - sa * transformed.z, sa * transformed.y + ca * transformed.z);
}`,
      );
    mt.userData.shader = shader;
  };
  mat.onBeforeCompile = patch(mat);
  depth.onBeforeCompile = patch(depth);
  return { mat, depth };
}

// Dove states
const D_WALK = 0, D_PECK = 1, D_IDLE = 2, D_FLYUP = 3, D_CIRCLE = 4, D_LAND = 5;

interface DoveGroup {
  active: boolean;
  count: number;
  info: DoveGroupInfo;
  /** 0 ground, 1 flying (up/circle), 2 landing */
  phase: number;
  circleCx: number; circleCz: number; circleAlt: number; circleR: number; circleT: number;
  landX: number; landZ: number;
  // per dove
  x: Float32Array; y: Float32Array; z: Float32Array;
  vx: Float32Array; vy: Float32Array; vz: Float32Array;
  heading: Float32Array; pitch: Float32Array; amp: Float32Array; phaseT: Float32Array;
  state: Uint8Array; stateT: Float32Array; delay: Float32Array; stateAge: Float32Array;
  tx: Float32Array; tz: Float32Array; ty: Float32Array; speed: Float32Array; dir: Float32Array;
}

function makeGroup(): DoveGroup {
  const f = () => new Float32Array(MAX_GROUP);
  return {
    active: false, count: 0, info: { x: 0, y: 0, z: 0, count: 0, flying: false }, phase: 0,
    circleCx: 0, circleCz: 0, circleAlt: 10, circleR: 8, circleT: 0, landX: 0, landZ: 0,
    x: f(), y: f(), z: f(), vx: f(), vy: f(), vz: f(), heading: f(), pitch: f(), amp: f(), phaseT: f(),
    state: new Uint8Array(MAX_GROUP), stateT: f(), delay: f(), stateAge: f(),
    tx: f(), tz: f(), ty: f(), speed: f(), dir: f(),
  };
}

interface Flock {
  info: SwiftFlockInfo;
  start: number;
  altitudeBand: number;
  tx: number; tz: number; ty: number;
  retargetT: number;
  diveIn: number;
  diveT: number;
}

export class BirdSystem {
  readonly swiftFlocks: SwiftFlockInfo[] = [];
  readonly doveGroups: DoveGroupInfo[] = [];

  private scene: THREE.Scene;
  private rng: () => number;
  private mobile: boolean;
  private swiftMesh: THREE.InstancedMesh;
  private doveMesh: THREE.InstancedMesh;
  private swiftFlap: THREE.InstancedBufferAttribute;
  private doveFlap: THREE.InstancedBufferAttribute;
  private mats: THREE.Material[] = [];

  // swifts
  private flocks: Flock[] = [];
  private nSwifts = 0;
  private sx: Float32Array; private sy: Float32Array; private sz: Float32Array;
  private svx: Float32Array; private svy: Float32Array; private svz: Float32Array;
  private sbank: Float32Array; private sphase: Float32Array; private sflapT: Float32Array;
  private sflapOn: Uint8Array; private samp: Float32Array; private scruise: Float32Array;
  private swiftsReady = false;
  private timeOfDay = 12;

  /** 1 by day .. 0 at night: swifts are daytime birds, so fewer of them are drawn as it gets dark. */
  setDaylight(day: number): void {
    this.swiftMesh.count = Math.round(this.nSwifts * Math.min(1, Math.max(0, day)));
  }

  /** Local in-game hour. Evening is the busiest time for screaming swift parties. */
  setTimeOfDay(hours: number): void {
    this.timeOfDay = ((hours % 24) + 24) % 24;
  }

  // doves
  private groups: DoveGroup[] = [];
  private maxDoves: number;
  private targetGroups: number;
  private spawnT = 0;

  // scratch
  private m = new THREE.Matrix4();
  private zero = new THREE.Matrix4().makeScale(0, 0, 0);
  private bf = new THREE.Vector3();
  private bu = new THREE.Vector3();
  private bz = new THREE.Vector3();
  private time = 0;

  constructor(scene: THREE.Scene, opts: BirdOptions = {}) {
    this.scene = scene;
    this.rng = opts.rng ?? Math.random;
    this.mobile = !!opts.mobile;
    const maxSwifts = opts.maxSwifts ?? (this.mobile ? 70 : 140);
    // swifts 100 + doves 70 desktop, 60 + 30 phone: the Art. 4 bird budget (~170 / ~90)
    this.maxDoves = opts.maxDoves ?? (this.mobile ? 30 : 70);
    this.targetGroups = this.mobile ? 3 : 4;
    const wantedFlocks = this.mobile ? 6 : 10;
    const nFlocks = Math.min(wantedFlocks, Math.max(1, Math.floor(maxSwifts / SWIFT_MIN_PER_FLOCK)));
    const counts: number[] = [];
    let remaining = Math.min(maxSwifts, nFlocks * 10);
    for (let f = 0; f < nFlocks; f++) {
      const minForRest = SWIFT_MIN_PER_FLOCK * (nFlocks - f - 1);
      const maxForRest = SWIFT_MAX_PER_FLOCK * (nFlocks - f - 1);
      const lower = Math.max(SWIFT_MIN_PER_FLOCK, remaining - maxForRest);
      const upper = Math.min(SWIFT_MAX_PER_FLOCK, remaining - minForRest);
      const count = f === nFlocks - 1
        ? remaining
        : lower + Math.floor(this.rng() * (upper - lower + 1));
      counts.push(count);
      remaining -= count;
    }

    // swifts
    const n = counts.reduce((sum, count) => sum + count, 0);
    this.sx = new Float32Array(n); this.sy = new Float32Array(n); this.sz = new Float32Array(n);
    this.svx = new Float32Array(n); this.svy = new Float32Array(n); this.svz = new Float32Array(n);
    this.sbank = new Float32Array(n); this.sphase = new Float32Array(n); this.sflapT = new Float32Array(n);
    this.sflapOn = new Uint8Array(n); this.samp = new Float32Array(n); this.scruise = new Float32Array(n);
    const lowFlocks = nFlocks >= 8 ? 2 : 1;
    const highFlocks = 1;
    for (let f = 0; f < nFlocks; f++) {
      const count = counts[f];
      const altitudeBand = f < lowFlocks ? 0 : f >= nFlocks - highFlocks ? 2 : 1;
      const info: SwiftFlockInfo = { x: 0, y: 30, z: 0, vx: 0, vy: 0, vz: 0, count };
      this.flocks.push({
        info, start: this.nSwifts, altitudeBand, tx: 0, tz: 0, ty: 30, retargetT: 0,
        diveIn: altitudeBand === 0 ? 4 + this.rng() * 8 : 12 + this.rng() * 20, diveT: 0,
      });
      this.swiftFlocks.push(info);
      this.nSwifts += count;
    }
    const { mat: swiftMat, depth: swiftDepth } = makeMaterial(14, false);
    const { mat: doveMat, depth: doveDepth } = makeMaterial(50, true);
    this.mats.push(swiftMat, doveMat, swiftDepth, doveDepth);
    const sg = buildSwiftGeometry();
    this.swiftFlap = new THREE.InstancedBufferAttribute(new Float32Array(n * 2), 2);
    this.swiftFlap.setUsage(THREE.DynamicDrawUsage);
    sg.setAttribute('aFlap', this.swiftFlap);
    this.swiftMesh = new THREE.InstancedMesh(sg, swiftMat, n);
    this.swiftMesh.count = this.nSwifts;
    this.swiftMesh.frustumCulled = false;
    this.swiftMesh.castShadow = true;
    this.swiftMesh.customDepthMaterial = swiftDepth;
    this.swiftMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.swiftMesh);

    // doves
    const nGroups = this.targetGroups;
    for (let i = 0; i < nGroups; i++) this.groups.push(makeGroup());
    const dn = nGroups * MAX_GROUP;
    const dg = buildDoveGeometry();
    this.doveFlap = new THREE.InstancedBufferAttribute(new Float32Array(dn * 2), 2);
    this.doveFlap.setUsage(THREE.DynamicDrawUsage);
    dg.setAttribute('aFlap', this.doveFlap);
    this.doveMesh = new THREE.InstancedMesh(dg, doveMat, dn);
    this.doveMesh.frustumCulled = false;
    this.doveMesh.castShadow = true;
    this.doveMesh.customDepthMaterial = doveDepth;
    this.doveMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < dn; i++) this.doveMesh.setMatrixAt(i, this.zero);
    scene.add(this.doveMesh);
  }

  private r(a: number, b: number): number { return a + (b - a) * this.rng(); }

  // ---------------------------------------------------------------- orientation
  /** Writes instance i: forward f (unit-ish), bank around f, position. */
  private setOrient(mesh: THREE.InstancedMesh, i: number, fx: number, fy: number, fz: number, bank: number, px: number, py: number, pz: number): void {
    let l = Math.hypot(fx, fy, fz);
    if (l < 1e-6) { fx = 1; fy = 0; fz = 0; l = 1; }
    fx /= l; fy /= l; fz /= l;
    // right = f x up0 = (-fz, 0, fx)
    let rx = -fz, rz = fx;
    let rl = Math.hypot(rx, rz);
    if (rl < 1e-5) { rx = 0; rz = 1; rl = 1; }
    rx /= rl; rz /= rl;
    // up = right x f
    const ux = -rz * fy, uy = rz * fx - rx * fz, uz = rx * fy;
    const cb = Math.cos(bank), sb = Math.sin(bank);
    const nux = ux * cb + rx * sb, nuy = uy * cb, nuz = uz * cb + rz * sb;
    const nrx = rx * cb - ux * sb, nry = -uy * sb, nrz = rz * cb - uz * sb;
    this.bf.set(fx, fy, fz);
    this.bu.set(nux, nuy, nuz);
    this.bz.set(nrx, nry, nrz);
    this.m.makeBasis(this.bf, this.bu, this.bz);
    this.m.setPosition(px, py, pz);
    mesh.setMatrixAt(i, this.m);
  }

  // ---------------------------------------------------------------- update
  update(dt: number, timeSeconds: number, world: BirdWorld, player: BirdListener): void {
    if (!(dt > 0)) return;
    dt = Math.min(dt, 0.1);
    this.time = timeSeconds;
    for (const mat of this.mats) {
      const sh = mat.userData.shader as THREE.WebGLProgramParametersWithUniforms | undefined;
      if (sh) sh.uniforms.uTime.value = timeSeconds;
    }
    this.updateSwifts(dt, world, player);
    this.updateDoves(dt, world, player);
  }

  // ---------------------------------------------------------------- swifts
  private altitudeFor(fl: Flock, roof: number, lowPass = false): number {
    if (lowPass || fl.altitudeBand === 0) return roof + this.r(10, 25);
    if (fl.altitudeBand === 2) return Math.max(roof + 30, this.r(105, 145));
    return roof + this.r(30, 80);
  }

  private spawnFlock(fl: Flock, world: BirdWorld, player: BirdListener, minD: number, maxD: number): void {
    const ang = this.rng() * TAU;
    const d = this.r(minD, maxD);
    const cx = player.x + Math.cos(ang) * d;
    const cz = player.z + Math.sin(ang) * d;
    const h = Math.max(world.heightAt(cx, cz) ?? GROUND_DEFAULT, GROUND_DEFAULT);
    const cy = this.altitudeFor(fl, h);
    const heading = this.rng() * TAU;
    const info = fl.info;
    for (let k = 0; k < info.count; k++) {
      const i = fl.start + k;
      const px = cx + this.r(-8, 8);
      const pz = cz + this.r(-8, 8);
      const localRoof = Math.max(world.heightAt(px, pz) ?? h, GROUND_DEFAULT);
      this.sx[i] = px;
      this.sz[i] = pz;
      this.sy[i] = Math.max(cy + this.r(-3, 3), localRoof + 10);
      const sp = this.r(14, 26);
      const hd = heading + this.r(-0.3, 0.3);
      this.svx[i] = Math.cos(hd) * sp; this.svz[i] = Math.sin(hd) * sp; this.svy[i] = 0;
      this.scruise[i] = this.r(17, 23);
      this.sphase[i] = this.rng() * TAU;
      this.sflapT[i] = this.r(0, 2);
      this.sflapOn[i] = this.rng() < 0.4 ? 1 : 0;
      this.samp[i] = 0.08;
      this.sbank[i] = 0;
    }
    info.x = cx; info.y = cy; info.z = cz;
    info.vx = Math.cos(heading) * 20; info.vz = Math.sin(heading) * 20; info.vy = 0;
    fl.retargetT = 0;
    fl.diveT = 0;
  }

  private pickTarget(fl: Flock, world: BirdWorld, player: BirdListener): void {
    const ang = this.rng() * TAU;
    const d = this.r(80, 360);
    fl.tx = player.x + Math.cos(ang) * d;
    fl.tz = player.z + Math.sin(ang) * d;
    const roof = Math.max(world.heightAt(fl.tx, fl.tz) ?? GROUND_DEFAULT, GROUND_DEFAULT);
    fl.ty = this.altitudeFor(fl, roof);
    fl.retargetT = this.r(3, 8);
  }

  private updateSwifts(dt: number, world: BirdWorld, player: BirdListener): void {
    if (!this.swiftsReady) {
      this.swiftsReady = true;
      for (const fl of this.flocks) this.spawnFlock(fl, world, player, 80, 250);
    }
    const sx = this.sx, sy = this.sy, sz = this.sz, svx = this.svx, svy = this.svy, svz = this.svz;
    const flap = this.swiftFlap.array as Float32Array;
    const SEP = 2.5, SEP2 = SEP * SEP;
    for (const fl of this.flocks) {
      const info = fl.info;
      const n = info.count, s0 = fl.start;
      // centroid / mean velocity from the previous step
      let cx = 0, cy = 0, cz = 0, mvx = 0, mvy = 0, mvz = 0;
      for (let k = 0; k < n; k++) {
        const i = s0 + k;
        cx += sx[i]; cy += sy[i]; cz += sz[i]; mvx += svx[i]; mvy += svy[i]; mvz += svz[i];
      }
      cx /= n; cy /= n; cz /= n; mvx /= n; mvy /= n; mvz /= n;
      if (Math.hypot(cx - player.x, cz - player.z) > 400) {
        this.spawnFlock(fl, world, player, 250, 250);
        cx = info.x; cy = info.y; cz = info.z; mvx = info.vx; mvy = info.vy; mvz = info.vz;
      }
      info.x = cx; info.y = cy; info.z = cz; info.vx = mvx; info.vy = mvy; info.vz = mvz;

      // targets
      const evening = this.timeOfDay >= 18 && this.timeOfDay <= 21.5 ? 1 : 0;
      fl.diveIn -= dt * (1 + evening * 2);
      if (fl.diveT > 0) {
        fl.diveT -= dt;
        if (Math.hypot(fl.tx - cx, fl.tz - cz) < 25 || fl.diveT <= 0) { fl.diveT = 0; fl.retargetT = 0; }
      } else if (fl.diveIn <= 0) {
        // screaming-party low pass near the player
        const ang = this.rng() * TAU;
        const d = this.r(45, evening ? 110 : 90);
        fl.tx = player.x + Math.cos(ang) * d;
        fl.tz = player.z + Math.sin(ang) * d;
        const roof = Math.max(world.heightAt(fl.tx, fl.tz) ?? GROUND_DEFAULT, GROUND_DEFAULT);
        fl.ty = this.altitudeFor(fl, roof, true);
        fl.diveT = evening ? this.r(10, 16) : this.r(8, 14);
        fl.diveIn = evening ? this.r(8, 22) : this.r(15, 40);
      }
      if (fl.diveT <= 0) {
        fl.retargetT -= dt;
        if (fl.retargetT <= 0) this.pickTarget(fl, world, player);
      }
      const diving = fl.diveT > 0;
      const dx0 = fl.tx - cx, dz0 = fl.tz - cz;
      const dl = Math.hypot(dx0, dz0) || 1;
      const tdx = dx0 / dl, tdz = dz0 / dl;

      for (let k = 0; k < n; k++) {
        const i = s0 + k;
        const x = sx[i], y = sy[i], z = sz[i];
        let vx = svx[i], vy = svy[i], vz = svz[i];
        let ax = 0, ay = 0, az = 0;
        // separation
        for (let j = s0; j < s0 + n; j++) {
          if (j === i) continue;
          const ddx = x - sx[j], ddy = y - sy[j], ddz = z - sz[j];
          const d2 = ddx * ddx + ddy * ddy + ddz * ddz;
          if (d2 < SEP2 && d2 > 1e-4) {
            const w = (SEP2 - d2) / SEP2 / Math.sqrt(d2);
            ax += ddx * w * 14; ay += ddy * w * 14; az += ddz * w * 14;
          }
        }
        // alignment + cohesion
        ax += (mvx - vx) * 0.8 + (cx - x) * 0.12;
        ay += (mvy - vy) * 0.8;
        az += (mvz - vz) * 0.8 + (cz - z) * 0.12;
        // steer towards the flock target
        const cr = this.scruise[i];
        ax += (tdx * cr - vx) * (diving ? 1.2 : 0.7);
        az += (tdz * cr - vz) * (diving ? 1.2 : 0.7);
        // altitude
        ay += Math.max(-8, Math.min(8, (fl.ty - y) * 0.25));
        const la = 0.8;
        let hmax = world.heightAt(x, z) ?? GROUND_DEFAULT;
        const h1 = world.heightAt(x + vx * 1.5 * la, z + vz * 1.5 * la) ?? GROUND_DEFAULT;
        const h2 = world.heightAt(x + vx * 3 * la, z + vz * 3 * la) ?? GROUND_DEFAULT;
        if (h1 > hmax) hmax = h1;
        if (h2 > hmax) hmax = h2;
        const floorY = hmax + 8;
        if (y < floorY) ay += Math.min(45, 10 + (floorY - y) * 4);
        if (y > 140) ay -= (y - 140) * 2;
        // speed keeping
        const sp = Math.hypot(vx, vy, vz) || 1;
        const k2 = (cr - sp) * 1.0 / sp;
        ax += vx * k2; ay += vy * k2; az += vz * k2;
        // limit turn acceleration
        const al = Math.hypot(ax, ay, az);
        const AMAX = 40;
        if (al > AMAX) { const s = AMAX / al; ax *= s; ay *= s; az *= s; }
        const ovx = vx, ovz = vz;
        vx += ax * dt; vy += ay * dt; vz += az * dt;
        if (vy > 9) vy = 9; else if (vy < -9) vy = -9;
        const nsp = Math.hypot(vx, vy, vz) || 1;
        if (nsp > 26) { const s = 26 / nsp; vx *= s; vy *= s; vz *= s; }
        else if (nsp < 14) { const s = 14 / nsp; vx *= s; vy *= s; vz *= s; }
        let ny = y + vy * dt;
        const nx = x + vx * dt, nz = z + vz * dt;
        const hc = world.heightAt(nx, nz) ?? GROUND_DEFAULT;
        if (ny < hc + 5.5) { ny = hc + 5.5; if (vy < 0) vy = 0; }
        if (ny > SWIFT_CEILING) { ny = SWIFT_CEILING; if (vy > 0) vy = 0; }
        sx[i] = nx; sy[i] = ny; sz[i] = nz;
        svx[i] = vx; svy[i] = vy; svz[i] = vz;
        // bank into turns
        const hs = Math.hypot(vx, vz) || 1;
        const yawRate = (ovx * vz - ovz * vx) / (hs * hs) / dt; // rad/s
        const tb = Math.max(-0.9, Math.min(0.9, yawRate * 0.5));
        this.sbank[i] += (tb - this.sbank[i]) * Math.min(1, dt * 5);
        // flapping: bursts vs glides
        this.sflapT[i] -= dt;
        if (this.sflapT[i] <= 0) {
          if (this.sflapOn[i]) { this.sflapOn[i] = 0; this.sflapT[i] = this.r(0.8, 3); }
          else { this.sflapOn[i] = 1; this.sflapT[i] = this.r(0.4, 0.8); }
        }
        const ta = this.sflapOn[i] ? 0.9 : 0.08;
        this.samp[i] += (ta - this.samp[i]) * Math.min(1, dt * 8);
        flap[i * 2] = this.sphase[i];
        flap[i * 2 + 1] = this.samp[i];
        this.setOrient(this.swiftMesh, i, vx, vy, vz, this.sbank[i], nx, ny, nz);
      }
    }
    this.swiftMesh.instanceMatrix.needsUpdate = true;
    this.swiftFlap.needsUpdate = true;
  }

  // ---------------------------------------------------------------- doves
  /** Ground height if (x,z) is an acceptable dove ground point, else null. */
  private acceptable(world: BirdWorld, x: number, z: number): number | null {
    const m = world.groundMatAt(x, z);
    if (m === null || (m !== MAT.PLAZA && m !== MAT.SIDEWALK && m !== MAT.PARK)) return null;
    if (world.isWater(x, z)) return null;
    const h = world.heightAt(x, z);
    if (h === null || h > 6) return null;
    return h;
  }

  private spawnGroup(g: DoveGroup, size: number, cx: number, cz: number, world: BirdWorld): void {
    g.active = true;
    g.count = size;
    g.phase = 0;
    for (let k = 0; k < size; k++) {
      let x = cx, z = cz, h = world.heightAt(cx, cz) ?? GROUND_DEFAULT;
      for (let t = 0; t < 4; t++) {
        const a = this.rng() * TAU, d = Math.sqrt(this.rng()) * 3;
        const px = cx + Math.cos(a) * d, pz = cz + Math.sin(a) * d;
        const ph = this.acceptable(world, px, pz);
        if (ph !== null) { x = px; z = pz; h = ph; break; }
      }
      g.x[k] = x; g.y[k] = h; g.z[k] = z;
      g.vx[k] = g.vy[k] = g.vz[k] = 0;
      g.heading[k] = this.rng() * TAU;
      g.pitch[k] = 0; g.amp[k] = 0; g.phaseT[k] = this.rng() * TAU;
      this.setGroundState(g, k, (this.rng() * 3) | 0);
      g.delay[k] = 0;
    }
    g.info.count = size;
    g.info.flying = false;
    g.info.x = cx; g.info.z = cz; g.info.y = world.heightAt(cx, cz) ?? GROUND_DEFAULT;
  }

  private setGroundState(g: DoveGroup, k: number, st: number): void {
    g.state[k] = st;
    g.stateT[k] = this.r(1, 4);
    g.stateAge[k] = 0;
    if (st === D_WALK) {
      g.heading[k] += this.r(-1.2, 1.2);
      g.speed[k] = this.r(0.3, 0.6);
    }
  }

  private updateDoves(dt: number, world: BirdWorld, player: BirdListener): void {
    // despawn
    for (const g of this.groups) {
      if (g.active && Math.hypot(g.info.x - player.x, g.info.z - player.z) > 250) g.active = false;
    }
    // spawn
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnT = 0.5;
      let nActive = 0, total = 0;
      let free: DoveGroup | null = null;
      for (const g of this.groups) {
        if (g.active) { nActive++; total += g.count; } else if (!free) free = g;
      }
      if (nActive < this.targetGroups && free) {
        for (let t = 0; t < 20; t++) {
          const a = this.rng() * TAU, d = this.r(20, 150);
          const px = player.x + Math.cos(a) * d, pz = player.z + Math.sin(a) * d;
          if (this.acceptable(world, px, pz) === null) continue;
          const size = Math.min(6 + Math.floor(this.rng() * 15), this.maxDoves - total, MAX_GROUP);
          if (size >= 6) this.spawnGroup(free, size, px, pz, world);
          break;
        }
      }
    }

    const flap = this.doveFlap.array as Float32Array;
    this.doveGroups.length = 0;
    for (let gi = 0; gi < this.groups.length; gi++) {
      const g = this.groups[gi];
      const base = gi * MAX_GROUP;
      if (!g.active) {
        for (let k = 0; k < MAX_GROUP; k++) this.doveMesh.setMatrixAt(base + k, this.zero);
        continue;
      }
      this.stepGroup(g, dt, world, player);
      for (let k = 0; k < MAX_GROUP; k++) {
        const i = base + k;
        if (k >= g.count) { this.doveMesh.setMatrixAt(i, this.zero); continue; }
        flap[i * 2] = g.phaseT[k];
        flap[i * 2 + 1] = g.amp[k];
        const st = g.state[k];
        if (st >= D_FLYUP) {
          const sp = Math.hypot(g.vx[k], g.vy[k], g.vz[k]);
          if (sp > 0.5) this.setOrient(this.doveMesh, i, g.vx[k], g.vy[k] * 0.6, g.vz[k], 0, g.x[k], g.y[k], g.z[k]);
          else this.setOrient(this.doveMesh, i, Math.cos(g.heading[k]), 0, Math.sin(g.heading[k]), 0, g.x[k], g.y[k], g.z[k]);
        } else {
          const p = g.pitch[k], cp = Math.cos(p);
          const bob = st === D_WALK ? 0.01 * Math.sin(this.time * TAU * 4 + g.phaseT[k]) : 0;
          this.setOrient(this.doveMesh, i, cp * Math.cos(g.heading[k]), -Math.sin(p), cp * Math.sin(g.heading[k]), 0, g.x[k], g.y[k] + 0.09 + bob, g.z[k]);
        }
      }
      this.doveGroups.push(g.info);
    }
    this.doveMesh.instanceMatrix.needsUpdate = true;
    this.doveFlap.needsUpdate = true;
  }

  private stepGroup(g: DoveGroup, dt: number, world: BirdWorld, player: BirdListener): void {
    const n = g.count;
    // alarm
    if (g.phase === 0) {
      let alarm = false;
      const fast = player.speed > 7;
      for (let k = 0; k < n && !alarm; k++) {
        const d2 = (g.x[k] - player.x) ** 2 + (g.z[k] - player.z) ** 2;
        if (d2 < 36 || (fast && d2 < 144)) alarm = true;
      }
      if (alarm) this.takeOff(g, world, player);
    }

    let cx = 0, cy = 0, cz = 0, landed = 0;
    for (let k = 0; k < n; k++) {
      const st = g.state[k];
      g.stateAge[k] += dt;
      if (st <= D_IDLE) {
        this.stepGround(g, k, dt, world);
        landed++;
      } else if (st === D_FLYUP) {
        if (g.delay[k] > 0) { g.delay[k] -= dt; g.amp[k] += (0 - g.amp[k]) * Math.min(1, dt * 10); }
        else {
          g.x[k] += g.vx[k] * dt; g.y[k] += g.vy[k] * dt; g.z[k] += g.vz[k] * dt;
          g.amp[k] += (1 - g.amp[k]) * Math.min(1, dt * 12);
          if (g.stateAge[k] > g.stateT[k] + 0.0) { g.state[k] = D_CIRCLE; g.stateAge[k] = 0; }
        }
      } else if (st === D_CIRCLE) {
        this.stepCircle(g, k, dt);
      } else {
        this.stepLand(g, k, dt, world);
      }
      cx += g.x[k]; cy += g.y[k]; cz += g.z[k];
    }
    g.info.x = cx / n; g.info.y = cy / n; g.info.z = cz / n;
    if (g.phase === 1) {
      g.circleT -= dt;
      if (g.circleT <= 0) this.startLanding(g, world, player);
    } else if (g.phase === 2 && landed === n) {
      g.phase = 0;
    }
    g.info.flying = g.phase !== 0;
  }

  private takeOff(g: DoveGroup, world: BirdWorld, player: BirdListener): void {
    const n = g.count;
    let gx = g.info.x - player.x, gz = g.info.z - player.z;
    let gl = Math.hypot(gx, gz);
    if (gl < 0.5) { const a = this.rng() * TAU; gx = Math.cos(a); gz = Math.sin(a); gl = 1; }
    gx /= gl; gz /= gl;
    const d = this.r(15, 30);
    g.circleCx = g.info.x + gx * d;
    g.circleCz = g.info.z + gz * d;
    g.circleAlt = this.r(8, 15);
    g.circleR = this.r(6, 11);
    g.circleT = this.r(4, 8);
    g.phase = 1;
    for (let k = 0; k < n; k++) {
      let ax = g.x[k] - player.x, az = g.z[k] - player.z;
      const al = Math.hypot(ax, az);
      if (al < 0.3) { ax = gx; az = gz; } else { ax /= al; az /= al; }
      const sp = this.r(6, 9);
      const lat = this.r(-1.5, 1.5);
      g.vx[k] = ax * sp - az * lat; g.vz[k] = az * sp + ax * lat; g.vy[k] = this.r(3.5, 5);
      g.delay[k] = this.r(0, 0.3);
      g.state[k] = D_FLYUP;
      g.stateAge[k] = 0;
      g.stateT[k] = 0.9;
      g.dir[k] = this.rng() < 0.5 ? 1 : -1;
      g.heading[k] = Math.atan2(g.vz[k], g.vx[k]);
      g.pitch[k] = 0;
    }
    // one rotation direction per group looks better
    const dir = this.rng() < 0.5 ? 1 : -1;
    for (let k = 0; k < n; k++) g.dir[k] = dir;
    void world;
  }

  private stepCircle(g: DoveGroup, k: number, dt: number): void {
    const rx = g.x[k] - g.circleCx, rz = g.z[k] - g.circleCz;
    const dist = Math.hypot(rx, rz) || 1;
    const nx = rx / dist, nz = rz / dist;
    const R = g.circleR;
    const err = dist - R;
    const tang = 7.5 * g.dir[k];
    let dvx = -nz * tang - nx * err * 0.8;
    let dvz = nx * tang - nz * err * 0.8;
    // keep within plausible speed
    const dh = Math.hypot(dvx, dvz);
    if (dh > 10) { dvx *= 10 / dh; dvz *= 10 / dh; }
    const dvy = Math.max(-3, Math.min(4, (g.circleAlt + Math.sin(g.phaseT[k]) * 1.5 - g.y[k]) * 1.2));
    const a = Math.min(1, dt * 3);
    g.vx[k] += (dvx - g.vx[k]) * a; g.vy[k] += (dvy - g.vy[k]) * a; g.vz[k] += (dvz - g.vz[k]) * a;
    g.x[k] += g.vx[k] * dt; g.y[k] += g.vy[k] * dt; g.z[k] += g.vz[k] * dt;
    // flap with occasional glides
    const glide = Math.sin(this.time * 1.3 + g.phaseT[k] * 3) > 0.7;
    g.amp[k] += ((glide ? 0.15 : 0.85) - g.amp[k]) * Math.min(1, dt * 6);
  }

  private startLanding(g: DoveGroup, world: BirdWorld, player: BirdListener): void {
    const cx = g.info.x, cz = g.info.z;
    let found = false;
    let lx = cx, lz = cz;
    for (let t = 0; t < 24 && !found; t++) {
      const a = this.rng() * TAU, d = this.r(20, 60);
      const px = cx + Math.cos(a) * d, pz = cz + Math.sin(a) * d;
      const wantRoof = t % 4 === 3;
      if (wantRoof) {
        const h = world.heightAt(px, pz);
        const m = world.groundMatAt(px, pz);
        if (h !== null && m !== null && h > GROUND_DEFAULT + 3 && !world.isWater(px, pz)) { lx = px; lz = pz; found = true; }
      } else if (this.acceptable(world, px, pz) !== null) { lx = px; lz = pz; found = true; }
    }
    if (!found) { lx = cx + this.r(-30, 30); lz = cz + this.r(-30, 30); }
    g.landX = lx; g.landZ = lz;
    g.phase = 2;
    for (let k = 0; k < g.count; k++) {
      let tx = lx, tz = lz, ty = world.heightAt(lx, lz) ?? GROUND_DEFAULT;
      for (let t = 0; t < 4; t++) {
        const a = this.rng() * TAU, d = Math.sqrt(this.rng()) * 3;
        const px = lx + Math.cos(a) * d, pz = lz + Math.sin(a) * d;
        const h = world.heightAt(px, pz);
        if (h !== null && Math.abs(h - ty) < 0.5 && !world.isWater(px, pz)) { tx = px; tz = pz; ty = h; break; }
      }
      g.tx[k] = tx; g.tz[k] = tz; g.ty[k] = ty;
      g.state[k] = D_LAND;
      g.stateAge[k] = 0;
    }
    void player;
  }

  private stepLand(g: DoveGroup, k: number, dt: number, world: BirdWorld): void {
    const dx = g.tx[k] - g.x[k], dz = g.tz[k] - g.z[k];
    const dist = Math.hypot(dx, dz);
    const hgt = g.y[k] - g.ty[k];
    const sp = Math.min(9, 1.5 + dist * 0.5);
    const dvx = dist > 0.05 ? dx / dist * sp : 0;
    const dvz = dist > 0.05 ? dz / dist * sp : 0;
    const t = Math.max(dist / Math.max(sp, 1), 0.4);
    let dvy = -Math.min(5, Math.max(hgt, 0) / t);
    if (hgt < 0) dvy = 2;
    const a = Math.min(1, dt * 4);
    g.vx[k] += (dvx - g.vx[k]) * a; g.vy[k] += (dvy - g.vy[k]) * a; g.vz[k] += (dvz - g.vz[k]) * a;
    g.x[k] += g.vx[k] * dt; g.y[k] += g.vy[k] * dt; g.z[k] += g.vz[k] * dt;
    g.amp[k] += ((hgt < 1.5 ? 0.9 : 0.15) - g.amp[k]) * Math.min(1, dt * 6);
    if (dist < 0.6 && hgt < 0.15 || hgt < 0.02 && dist < 1.5 || g.stateAge[k] > 14) {
      g.x[k] = g.tx[k]; g.z[k] = g.tz[k];
      g.y[k] = world.heightAt(g.tx[k], g.tz[k]) ?? g.ty[k];
      g.vx[k] = g.vy[k] = g.vz[k] = 0;
      g.amp[k] = 0;
      g.pitch[k] = 0;
      this.setGroundState(g, k, D_IDLE);
    }
  }

  private stepGround(g: DoveGroup, k: number, dt: number, world: BirdWorld): void {
    g.amp[k] += (0 - g.amp[k]) * Math.min(1, dt * 10);
    g.stateT[k] -= dt;
    const st = g.state[k];
    const age = g.stateAge[k];
    if (st === D_WALK) {
      const h = g.heading[k];
      const nx = g.x[k] + Math.cos(h) * g.speed[k] * dt;
      const nz = g.z[k] + Math.sin(h) * g.speed[k] * dt;
      const ny = world.heightAt(nx, nz);
      if (ny !== null && Math.abs(ny - g.y[k]) < 1 && !world.isWater(nx, nz)) {
        g.x[k] = nx; g.z[k] = nz; g.y[k] = ny;
      } else {
        g.heading[k] += Math.PI * (0.6 + this.rng() * 0.8);
      }
      g.pitch[k] = 0.12 * Math.sin(age * TAU * 4 + g.phaseT[k]);
    } else if (st === D_PECK) {
      g.pitch[k] = 0.7 * Math.max(0, Math.sin(age * TAU * 2.5 + g.phaseT[k])) - 0.05;
    } else {
      g.pitch[k] += (0 - g.pitch[k]) * Math.min(1, dt * 8);
    }
    if (g.stateT[k] <= 0) this.setGroundState(g, k, (this.rng() * 3) | 0);
  }

  dispose(): void {
    this.scene.remove(this.swiftMesh);
    this.scene.remove(this.doveMesh);
    this.swiftMesh.geometry.dispose();
    this.doveMesh.geometry.dispose();
    for (const m of this.mats) m.dispose();
    this.swiftMesh.dispose();
    this.doveMesh.dispose();
  }
}

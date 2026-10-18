import * as THREE from 'three';
import { VOXEL } from './constants.ts';
import { createOverviewWaterMaterial } from '../nature/water.ts';
import { MAT } from './materials.ts';
import { QuadBuilder, type ChunkMeshResult } from './mesher.ts';

/** Metres per overview block (8 cells). */
export const BLOCK_M = 8 * VOXEL;
const TILE_BLOCKS = 128;

export interface OverviewData {
  w: number;
  h: number;
  /** w*h*3 bytes: groundMat, top height (voxels), top material. */
  blocks: Uint8Array;
}

export function parseOverview(buf: ArrayBuffer): OverviewData {
  const dv = new DataView(buf);
  const w = dv.getUint16(0, true);
  const h = dv.getUint16(2, true);
  if (buf.byteLength !== 4 + w * h * 3) throw new Error('bad overview.bin size');
  return { w, h, blocks: new Uint8Array(buf, 4) };
}

/**
 * Meshes blocks [bx0,bx1) x [bz0,bz1) in world coordinates: greedy-merged tops, and side
 * walls only where the neighbouring block is lower (neighbours outside the world add none).
 * With `splitWater`, water tops go to `water` (shore = 1 everywhere) instead of the main mesh.
 */
export function buildOverviewTile(
  d: OverviewData, bx0: number, bz0: number, bx1: number, bz1: number, splitWater = false,
): ChunkMeshResult {
  const { w, h, blocks } = d;
  const b = new QuadBuilder();
  const wb = new QuadBuilder();
  const tw = bx1 - bx0;
  const th = bz1 - bz0;
  const height = (x: number, z: number): number => blocks[(z * w + x) * 3 + 1]!;
  const mat = (x: number, z: number): number => blocks[(z * w + x) * 3 + 2]!;

  // tops
  const used = new Uint8Array(tw * th);
  for (let lz = 0; lz < th; lz++) {
    for (let lx = 0; lx < tw; lx++) {
      const s = lz * tw + lx;
      if (used[s]) continue;
      const hh = height(bx0 + lx, bz0 + lz);
      const mm = mat(bx0 + lx, bz0 + lz);
      let rw = 1;
      while (lx + rw < tw && !used[s + rw] && height(bx0 + lx + rw, bz0 + lz) === hh && mat(bx0 + lx + rw, bz0 + lz) === mm) rw++;
      let rh = 1;
      outer: while (lz + rh < th) {
        for (let k = 0; k < rw; k++) {
          const x = bx0 + lx + k;
          const z = bz0 + lz + rh;
          if (used[s + rh * tw + k] || height(x, z) !== hh || mat(x, z) !== mm) break outer;
        }
        rh++;
      }
      for (let dz = 0; dz < rh; dz++) used.fill(1, s + dz * tw, s + dz * tw + rw);
      (splitWater && mm === MAT.WATER ? wb : b).top(
        (bx0 + lx) * BLOCK_M, (bx0 + lx + rw) * BLOCK_M, hh * VOXEL,
        (bz0 + lz) * BLOCK_M, (bz0 + lz + rh) * BLOCK_M, mm,
      );
    }
  }

  // walls: dir 0=+X 1=-X 2=+Z 3=-Z; runs along the other axis
  for (let dir = 0; dir < 4; dir++) {
    const alongX = dir >= 2;
    const step = dir === 0 || dir === 2 ? 1 : -1;
    const positive = step === 1;
    const aLen = alongX ? th : tw;
    const bLen = alongX ? tw : th;
    for (let a = 0; a < aLen; a++) {
      let runStart = -1;
      let runY0 = 0;
      let runY1 = 0;
      let runMat = 0;
      for (let bi = 0; bi <= bLen; bi++) {
        let y0 = 0;
        let y1 = 0;
        let mm = 0;
        if (bi < bLen) {
          const x = alongX ? bx0 + bi : bx0 + a;
          const z = alongX ? bz0 + a : bz0 + bi;
          const nx = alongX ? x : x + step;
          const nz = alongX ? z + step : z;
          if (nx >= 0 && nz >= 0 && nx < w && nz < h) {
            const hh = height(x, z);
            const nh = height(nx, nz);
            if (hh > nh) { y0 = nh; y1 = hh; mm = mat(x, z); }
          }
        }
        const continues = runStart >= 0 && y1 > y0 && y0 === runY0 && y1 === runY1 && mm === runMat;
        if (!continues) {
          if (runStart >= 0) {
            if (alongX) {
              const zz = (bz0 + a + (positive ? 1 : 0)) * BLOCK_M;
              b.wallZ(zz, runY0 * VOXEL, runY1 * VOXEL, (bx0 + runStart) * BLOCK_M, (bx0 + bi) * BLOCK_M, positive, runMat);
            } else {
              const xx = (bx0 + a + (positive ? 1 : 0)) * BLOCK_M;
              b.wallX(xx, runY0 * VOXEL, runY1 * VOXEL, (bz0 + runStart) * BLOCK_M, (bz0 + bi) * BLOCK_M, positive, runMat);
            }
            runStart = -1;
          }
          if (y1 > y0) { runStart = bi; runY0 = y0; runY1 = y1; runMat = mm; }
        }
      }
    }
  }
  let water: ChunkMeshResult['water'] = null;
  if (wb.quads > 0) {
    const m = wb.build();
    water = { positions: m.positions, shore: new Float32Array(m.positions.length / 3).fill(1), indices: m.indices };
  }
  const mesh = b.build();
  return { ...mesh, water, groundIndexCount: mesh.indices.length };
}

/** Far terrain: tiled meshes built incrementally, with a circular hole around the camera. */
export class Overview {
  readonly group = new THREE.Group();
  readonly material: THREE.MeshLambertMaterial;
  private readonly hole = { value: new THREE.Vector3(0, 0, 0) };
  private readonly waterMaterial: THREE.ShaderMaterial | null;
  private readonly queue: { x0: number; z0: number }[] = [];
  private readonly data: OverviewData;
  triangles = 0;

  constructor(
    scene: THREE.Scene, data: OverviewData, focusX: number, focusZ: number,
    waterBase?: THREE.ShaderMaterial,
  ) {
    this.data = data;
    this.waterMaterial = waterBase ? createOverviewWaterMaterial(waterBase) : null;
    this.material = new THREE.MeshLambertMaterial({
      vertexColors: true,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    const hole = this.hole;
    this.material.onBeforeCompile = (shader) => {
      shader.uniforms.uHole = hole;
      shader.vertexShader = 'varying vec2 vOvXZ;\n' + shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n vOvXZ = (modelMatrix * vec4(position, 1.0)).xz;',
      );
      shader.fragmentShader = 'varying vec2 vOvXZ;\nuniform vec3 uHole;\n' + shader.fragmentShader.replace(
        'void main() {',
        'void main() {\n vec2 ovD = vOvXZ - uHole.xy; if (dot(ovD, ovD) < uHole.z) discard;',
      );
    };
    this.group.position.y = -0.05;
    scene.add(this.group);
    for (let z0 = 0; z0 < data.h; z0 += TILE_BLOCKS) {
      for (let x0 = 0; x0 < data.w; x0 += TILE_BLOCKS) this.queue.push({ x0, z0 });
    }
    const cx = (t: { x0: number; z0: number }): number => (t.x0 + TILE_BLOCKS / 2) * BLOCK_M - focusX;
    const cz = (t: { x0: number; z0: number }): number => (t.z0 + TILE_BLOCKS / 2) * BLOCK_M - focusZ;
    // nearest tile last, so pop() builds it first
    this.queue.sort((a, b) => Math.hypot(cx(b), cz(b)) - Math.hypot(cx(a), cz(a)));
  }

  get done(): boolean { return this.queue.length === 0; }

  /** Builds tiles until the time budget (ms) is spent. */
  build(budgetMs: number): void {
    const t0 = performance.now();
    while (this.queue.length > 0 && performance.now() - t0 < budgetMs) {
      const t = this.queue.pop()!;
      const mesh = buildOverviewTile(
        this.data, t.x0, t.z0, Math.min(t.x0 + TILE_BLOCKS, this.data.w), Math.min(t.z0 + TILE_BLOCKS, this.data.h),
        this.waterMaterial !== null,
      );
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
      g.setAttribute('color', new THREE.BufferAttribute(mesh.colors, 3));
      g.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, this.material);
      m.matrixAutoUpdate = false;
      this.group.add(m);
      this.triangles += mesh.indices.length / 3;
      if (mesh.water !== null && this.waterMaterial !== null) {
        const wg = new THREE.BufferGeometry();
        wg.setAttribute('position', new THREE.BufferAttribute(mesh.water.positions, 3));
        wg.setAttribute('shore', new THREE.BufferAttribute(mesh.water.shore, 1));
        wg.setIndex(new THREE.BufferAttribute(mesh.water.indices, 1));
        wg.computeBoundingSphere();
        const wm = new THREE.Mesh(wg, this.waterMaterial);
        wm.matrixAutoUpdate = false;
        wm.renderOrder = 1;
        this.group.add(wm);
        this.triangles += mesh.water.indices.length / 3;
      }
    }
  }

  /** Cuts a hole of `radius` metres around (x, z). */
  setHole(x: number, z: number, radius: number): void {
    this.hole.value.set(x, z, radius * radius);
    this.waterMaterial?.uniforms.uHole!.value.set(x, z, radius * radius);
  }
}

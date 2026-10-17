import * as THREE from 'three';
import { CHUNK, REGION, REGION_CHUNKS, VOXEL } from './world/constants';
import { decodeRegion, encodeRegion } from './world/format';
import type { ChunkMesh } from './world/mesher';
import { buildSyntheticRegion } from './world/synthetic';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 1, 3000);
scene.add(new THREE.HemisphereLight(0xffffff, 0x556655, 1.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(300, 500, 200);
scene.add(sun);

const hud = document.getElementById('hud');
const material = new THREE.MeshLambertMaterial({ vertexColors: true });
const regionSize = REGION * VOXEL;
const center = new THREE.Vector3(regionSize / 2, 0, regionSize / 2);

function addChunk(mesh: ChunkMesh, cx: number, cz: number): void {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
  g.setAttribute('color', new THREE.BufferAttribute(mesh.colors, 3));
  g.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  g.computeBoundingSphere();
  const m = new THREE.Mesh(g, material);
  m.name = `chunk_${cx}_${cz}`;
  scene.add(m);
}

function buildWorld(): void {
  // Exercise the on-disk format: encode then decode before meshing.
  const encoded = encodeRegion(buildSyntheticRegion());
  const region = decodeRegion(encoded);
  const bytes = encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength);

  const poolSize = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
  const workers: Worker[] = [];
  const queue: { cx: number; cz: number }[] = [];
  for (let cz = 0; cz < REGION_CHUNKS; cz++) {
    for (let cx = 0; cx < REGION_CHUNKS; cx++) queue.push({ cx, cz });
  }
  const pending = new Map<number, { cx: number; cz: number }>();
  let nextId = 0;
  let done = 0;
  const t0 = performance.now();
  console.info(`region ${region.rx},${region.rz}: ${encoded.length} bytes, ${region.features.length} features`);

  const dispatch = (w: Worker): void => {
    const job = queue.shift();
    if (!job) return;
    const id = nextId++;
    pending.set(id, job);
    w.postMessage({ id, buffer: bytes.slice(0), cx: job.cx, cz: job.cz });
  };

  for (let i = 0; i < poolSize; i++) {
    const w = new Worker(new URL('./world/mesher.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<{ id: number; mesh: ChunkMesh }>) => {
      const job = pending.get(e.data.id);
      pending.delete(e.data.id);
      if (job) addChunk(e.data.mesh, job.cx, job.cz);
      done++;
      if (done === REGION_CHUNKS * REGION_CHUNKS) {
        console.info(`meshed ${done} chunks (${CHUNK}^2 cells) in ${(performance.now() - t0).toFixed(0)} ms`);
        for (const x of workers) x.terminate();
      } else {
        dispatch(w);
      }
    };
    workers.push(w);
    dispatch(w);
  }
}
buildWorld();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Start at (256, 120, 600), then orbit around the region centre.
const orbitRadius = Math.hypot(256 - center.x, 600 - center.z);
const startAngle = Math.atan2(600 - center.z, 256 - center.x);
let frames = 0;
let fpsStart = performance.now();

function animate(now: number): void {
  requestAnimationFrame(animate);
  const a = startAngle + now * 0.00005;
  camera.position.set(
    center.x + Math.cos(a) * orbitRadius,
    120,
    center.z + Math.sin(a) * orbitRadius,
  );
  camera.lookAt(center);
  renderer.render(scene, camera);

  frames++;
  if (now - fpsStart >= 500) {
    if (hud) hud.textContent = `Voxel Kherson - ${Math.round((frames * 1000) / (now - fpsStart))} fps`;
    frames = 0;
    fpsStart = now;
  }
}
requestAnimationFrame(animate);

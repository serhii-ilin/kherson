import * as THREE from 'three';
import { toLatLon } from './world/geo.ts';
import { Overview, parseOverview } from './world/lod.ts';
import type { Manifest } from './world/manifest.ts';
import { WorldStreamer } from './world/streamer.ts';
import { FineStreamer } from './fine/streamer.ts';
import { createSky } from './world/sky.ts';
import { createWaterMaterial, updateWater } from './nature/water.ts';
import { Vegetation } from './nature/vegetation.ts';
import { BirdSystem, type BirdListener } from './nature/birds.ts';
import { Ambience, createMuteButton, type AudioScene } from './nature/audio.ts';
import { MAT } from './world/materials.ts';
import { PlayerController } from './player/controller.ts';
import { Input } from './player/input.ts';
import { applyDocument, createAttribution, createLangSwitcher, createQualityButton, t } from './i18n.ts';
import { getQuality } from './quality.ts';
import { TouchControls } from './player/touch.ts';
import { Minimap } from './ui/minimap.ts';
import { PlacesMenu, type Place } from './ui/places.ts';
import { PALETTE } from './world/materials.ts';
import { REGION, VOXEL } from './world/constants.ts';

const SKY = 0x9cc8ef;
const isMobile = TouchControls.isTouchDevice() || /Mobi|Android/i.test(navigator.userAgent);

const quality = getQuality();
const shadowsOn = quality === 'high';
/** Pixel-ratio cap shared by startup and resize: Low is 1, phones 1.5, desktop 2. */
const pixelCap = quality === 'low' ? 1 : isMobile ? 1.5 : 2;
const pixelRatio = (): number => Math.min(window.devicePixelRatio, pixelCap);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(pixelRatio());
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = shadowsOn;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(SKY);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.3, 12000);
scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x6b5a3a, 1.0));
const sun = new THREE.DirectionalLight(0xfff0d0, 1.8);
const SUN_DIR = new THREE.Vector3(-300, 500, 300).normalize(); // from the south-west
const SUN_DIST = 400;
sun.position.copy(SUN_DIR).multiplyScalar(SUN_DIST);
scene.add(sun);
scene.add(sun.target);
// Gradient sky dome with a sun disc; the fog takes its horizon colour so distant terrain melts into it.
const sky = createSky({ sunDir: SUN_DIR });
scene.add(sky.mesh);
scene.fog = new THREE.Fog(sky.horizonColor, 2500, 9000);

// Sun shadows: a ~200 m orthographic box that follows the camera, snapped to shadow texels.
const SHADOW_HALF = 100;
const SHADOW_MAP = 2048;
const SHADOW_TEXEL = (SHADOW_HALF * 2) / SHADOW_MAP;
if (shadowsOn) {
  sun.castShadow = true;
  sun.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
  const sc = sun.shadow.camera;
  sc.left = -SHADOW_HALF;
  sc.right = SHADOW_HALF;
  sc.top = SHADOW_HALF;
  sc.bottom = -SHADOW_HALF;
  sc.near = SUN_DIST - 250; // tall buildings (~120 m) between the sun and the ground
  sc.far = SUN_DIST + 250;
  sc.updateProjectionMatrix();
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.15;
}
// light-space basis, preallocated
const lightFwd = SUN_DIR.clone().negate();
const lightRight = new THREE.Vector3().crossVectors(lightFwd, new THREE.Vector3(0, 1, 0)).normalize();
const lightUp = new THREE.Vector3().crossVectors(lightRight, lightFwd).normalize();
function updateShadowFrustum(cx: number, cy: number, cz: number): void {
  const r = Math.round((cx * lightRight.x + cy * lightRight.y + cz * lightRight.z) / SHADOW_TEXEL) * SHADOW_TEXEL;
  const u = Math.round((cx * lightUp.x + cy * lightUp.y + cz * lightUp.z) / SHADOW_TEXEL) * SHADOW_TEXEL;
  const f = cx * lightFwd.x + cy * lightFwd.y + cz * lightFwd.z;
  const tx = lightRight.x * r + lightUp.x * u + lightFwd.x * f;
  const ty = lightRight.y * r + lightUp.y * u + lightFwd.y * f;
  const tz = lightRight.z * r + lightUp.z * u + lightFwd.z * f;
  sun.target.position.set(tx, ty, tz);
  sun.position.set(tx + SUN_DIR.x * SUN_DIST, ty + SUN_DIR.y * SUN_DIST, tz + SUN_DIR.z * SUN_DIST);
  sun.target.updateMatrixWorld();
}
const waterMaterial = createWaterMaterial({
  skyColor: new THREE.Color(SKY),
  sunDir: SUN_DIR.clone(),
  fog: true,
});

const hud = document.getElementById('hud')!;
applyDocument();
createLangSwitcher(document.body);
createQualityButton(document.body);
createAttribution(document.body);
const base = import.meta.env.BASE_URL;

async function start(): Promise<void> {
  const manifest = (await (await fetch(`${base}world/manifest.json`)).json()) as Manifest;
  const viewRadius = isMobile ? 384 : 640;
  const streamer = new WorldStreamer(scene, manifest, { viewRadius, waterMaterial });
  const vegetation = new Vegetation(scene, { nearRadius: isMobile ? 150 : 250, farRadius: viewRadius });
  streamer.onRegionData = (rx, rz, data) => vegetation.setRegion(rx, rz, data ? data.features : null, data?.cells);
  const q = new URLSearchParams(location.search);
  // Fine tier (0.2 m ground near the camera): High quality + baked vector tiles; ?fine=0|1 overrides.
  const fineParam = q.get('fine');
  const fineOn = fineParam === '0' ? false : fineParam === '1' ? true : quality === 'high' && manifest.vectors === true;
  // Block tier (1 m buildings and bridges within 250 m, 100 m on phones): High quality; ?blocks=0|1 overrides.
  const blocksParam = q.get('blocks');
  const blocksOn = blocksParam === '0' ? false : blocksParam === '1' ? true : quality === 'high';
  const fine = fineOn
    ? new FineStreamer(scene, streamer, manifest, {
      radius: isMobile ? 70 : 150,
      blockRadius: blocksOn ? (isMobile ? 100 : 250) : 0,
      workers: (navigator.hardwareConcurrency || 2) >= 8 ? 2 : 1,
    })
    : null;
  /** Physics world: coarse heights plus fine kerbs where a fine chunk is loaded. */
  const physics = fine !== null ? fine.world : streamer;
  const input = new Input();
  input.attach(renderer.domElement);
  const player = new PlayerController(camera, input);
  // ?x=&z= (metres) jumps to a spot; add y/yaw/pitch (degrees) and mode=fly for an exact view.
  const num = (k: string): number | null => (q.has(k) && Number.isFinite(Number(q.get(k))) ? Number(q.get(k)) : null);
  const sx = num('x') ?? manifest.spawn[0];
  const sz = num('z') ?? manifest.spawn[1];
  const deg = Math.PI / 180;
  if (q.get('mode') === 'fly') {
    player.setFlyPose(sx, num('y') ?? 120, sz, (num('yaw') ?? 0) * deg, (num('pitch') ?? -20) * deg);
  } else {
    player.spawn(sx, sz);
    player.yaw = (num('yaw') ?? 0) * deg;
  }
  if (isMobile) {
    const touch = new TouchControls();
    touch.attach(document.body);
    touch.onToggleMode = () => player.toggle();
    input.touch = touch;
  }

  const worldSpan = REGION * VOXEL;
  const minimap = new Minimap(document.body, {
    worldW: manifest.regionsX * worldSpan,
    worldH: manifest.regionsZ * worldSpan,
    size: isMobile ? 120 : 180,
  });

  fetch(`${base}world/places.json`)
    .then((r) => r.json() as Promise<Place[]>)
    .then((places) => {
      new PlacesMenu(document.body, places, (p) => {
        if (p.yaw !== undefined) {
          // a street: stand on it at street level, looking along it
          player.spawn(p.x, p.z);
          player.yaw = p.yaw * deg;
        } else if (player.mode === 'fly') player.setFlyPose(p.x, Math.max(player.y, 80), p.z, player.yaw, player.pitch);
        else player.spawn(p.x, p.z);
      });
    })
    .catch((err) => console.warn('places unavailable', err));

  const birds = new BirdSystem(scene, { mobile: isMobile });
  const birdListener: BirdListener = { x: 0, y: 0, z: 0, speed: 0 };

  const ambience = new Ambience();
  createMuteButton(document.body, ambience);
  // Browsers only allow audio after a user gesture.
  const unlockAudio = (): void => ambience.unlock();
  for (const ev of ['pointerdown', 'keydown', 'touchstart']) window.addEventListener(ev, unlockAudio, { once: true });
  const audioScene: AudioScene = {
    listener: { x: 0, y: 0, z: 0, yaw: 0 },
    groundY: 4,
    treeDensity: 0,
    waterDistance: Infinity,
    swiftFlocks: birds.swiftFlocks,
    doveGroups: birds.doveGroups,
  };
  let surroundingsAt = 0;
  // Real tree density from the instanced vegetation, nearest water from a coarse ring sample.
  const sampleSurroundings = (x: number, z: number): void => {
    let water = Infinity;
    for (const r of [12, 30, 60, 100, 150]) {
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        if (streamer.groundMatAt(x + Math.cos(a) * r, z + Math.sin(a) * r) === MAT.WATER) water = Math.min(water, r);
      }
    }
    audioScene.treeDensity = vegetation.treeDensity(x, z);
    audioScene.waterDistance = streamer.isWater(x, z) ? 0 : water;
  };

  if (import.meta.env.DEV) Object.assign(window, { __vk: { player, streamer, fine, input, birds, ambience, vegetation, renderer } });

  let overview: Overview | null = null;
  fetch(`${base}world/overview.bin`)
    .then((r) => r.arrayBuffer())
    .then((buf) => {
      const data = parseOverview(buf);
      overview = new Overview(scene, data, sx, sz, waterMaterial);
      minimap.setBackground(data, PALETTE);
    })
    .catch((err) => console.warn('overview unavailable', err));

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(pixelRatio());
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  let last = performance.now();
  let frames = 0;
  let fpsStart = last;
  let fps = 0;
  let hudAt = 0;

  const frame = (now: number): void => {
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;

    player.update(dt, physics);
    if (shadowsOn) updateShadowFrustum(camera.position.x, 0, camera.position.z);
    streamer.update(camera.position.x, camera.position.z);
    fine?.update(camera.position.x, camera.position.z);
    vegetation.update(camera.position.x, camera.position.z, now / 1000);
    if (overview !== null) {
      if (!overview.done) overview.build(4);
      overview.setHole(camera.position.x, camera.position.z, streamer.holeRadius(camera.position.x, camera.position.z));
    }
    updateWater(waterMaterial, now / 1000, camera.position);
    sky.update(camera.position);
    const cp = camera.position;
    if (dt > 0) birdListener.speed = Math.hypot(cp.x - birdListener.x, cp.z - birdListener.z) / dt;
    birdListener.x = cp.x;
    birdListener.y = cp.y;
    birdListener.z = cp.z;
    birds.update(dt, now / 1000, streamer, birdListener);
    const l = audioScene.listener;
    l.x = cp.x;
    l.y = cp.y;
    l.z = cp.z;
    l.yaw = player.yaw;
    audioScene.groundY = streamer.heightAt(cp.x, cp.z) ?? audioScene.groundY;
    if (now - surroundingsAt > 500) {
      surroundingsAt = now;
      sampleSurroundings(cp.x, cp.z);
    }
    ambience.update(dt, audioScene);
    renderer.render(scene, camera);
    minimap.update(camera.position.x, camera.position.z, player.yaw);

    frames++;
    if (now - fpsStart >= 500) {
      fps = Math.round((frames * 1000) / (now - fpsStart));
      frames = 0;
      fpsStart = now;
    }
    if (now - hudAt >= 250) {
      hudAt = now;
      const { x, y, z } = camera.position;
      const [lat, lon] = toLatLon(manifest.bbox, x, z);
      hud.textContent =
        `${player.mode === 'walk' ? t('walk') : t('fly')} · ${fps} fps\n` +
        `x ${x.toFixed(0)}  y ${y.toFixed(1)}  z ${z.toFixed(0)} m · ${lat.toFixed(5)}, ${lon.toFixed(5)}\n` +
        `${t('regions')} ${streamer.loadedRegions} · ${t('chunks')} ${streamer.chunkCount} · ${t('jobs')} ${streamer.inflightJobs} · ` +
        `${(streamer.triangles / 1000).toFixed(0)} ${t('tris')}\n` +
        (import.meta.env.DEV
          ? `veg ${vegetation.stats.instances} (${vegetation.stats.near} near) · ${renderer.info.render.triangles} tris · ${renderer.info.render.calls} calls\n` +
            (fine !== null
              ? `fine ${fine.chunkCount} chunks · ${fine.inflightJobs} jobs · ${(fine.triangles / 1000).toFixed(1)}k tris\n` +
                (fine.blockRadius > 0
                  ? `blocks ${fine.blockChunks} chunks · ${fine.blockJobs} jobs · ${(fine.blockTriangles / 1000).toFixed(1)}k tris\n`
                  : 'blocks off\n')
              : 'fine off\n')
          : '') +
        (isMobile ? t('hintTouch') : t('hintDesktop'));
    }
  };
  requestAnimationFrame(frame);
}

start().catch((err) => {
  hud.textContent = `${t('failed')}: ${String(err)}`;
  console.error(err);
});

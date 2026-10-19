import * as THREE from 'three';
import { toLatLon } from './world/geo.ts';
import { Overview, parseOverview } from './world/lod.ts';
import type { Manifest } from './world/manifest.ts';
import { WorldStreamer } from './world/streamer.ts';
import { FineStreamer } from './fine/streamer.ts';
import { SignLayer } from './fine/signs.ts';
import { createSky } from './world/sky.ts';
import { createWaterMaterial, updateWater } from './nature/water.ts';
import { Vegetation } from './nature/vegetation.ts';
import { BirdSystem, type BirdListener } from './nature/birds.ts';
import { FishSystem } from './nature/fish.ts';
import { Ambience, createMuteButton, type AudioScene } from './nature/audio.ts';
import { MAT } from './world/materials.ts';
import { PlayerController } from './player/controller.ts';
import { Input } from './player/input.ts';
import { applyDocument, createAttribution, createLangSwitcher, createQualityButton, createTimeButton, t } from './i18n.ts';
import { daylightAt, readStoredTime, resolveTime, writeStoredTime } from './world/daylight.ts';
import { NIGHT_UNIFORM } from './world/facade-shader.ts';
import { getQuality } from './quality.ts';
import { TouchControls } from './player/touch.ts';
import { Minimap } from './ui/minimap.ts';
import { PlacesMenu, type Place } from './ui/places.ts';
import { PALETTE } from './world/materials.ts';
import { REGION, VOXEL } from './world/constants.ts';
import { versioned, watchForUpdates } from './version.ts';
import { createLandmarks } from './landmarks/index.ts';
import { LandmarkLayer } from './landmarks/layer.ts';
import { LandmarkPhysics } from './landmarks/physics.ts';
import { getVegetationExclusions } from './landmarks/exclusions.ts';

const SKY = 0x9cc8ef;
const SURROUNDING_RADII = [12, 30, 60, 100, 150] as const;
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
// Dev only: ?nomultidraw=1 hides WEBGL_multi_draw (as on browsers without it), to test the BatchedMesh
// fallback: three then issues one draw per visible instance (see ChunkBatch).
if (import.meta.env.DEV && new URLSearchParams(location.search).get('nomultidraw') === '1') {
  const ext = renderer.extensions as { has(n: string): boolean; get(n: string): unknown };
  const has = ext.has.bind(ext);
  const get = ext.get.bind(ext);
  ext.has = (n) => n !== 'WEBGL_multi_draw' && has(n);
  ext.get = (n) => (n === 'WEBGL_multi_draw' ? null : get(n));
}

const scene = new THREE.Scene();
scene.background = new THREE.Color(SKY);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.3, 12000);
const hemi = new THREE.HemisphereLight(0xbfd8ff, 0x6b5a3a, 1.0);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff0d0, 1.8); // the sun by day, a weak moon at night (see applyTime)
/** Direction towards the dominant light; mutated in place when the time changes. */
const SUN_DIR = new THREE.Vector3(-300, 500, 300).normalize();
const SUN_DIST = 400;
sun.position.copy(SUN_DIR).multiplyScalar(SUN_DIST);
scene.add(sun);
scene.add(sun.target);
// Gradient sky dome with a sun disc; the fog takes its horizon colour so distant terrain melts into it.
const sky = createSky({ sunDir: SUN_DIR, cloudOctaves: quality === 'high' ? 3 : 2 });
scene.add(sky.mesh);
scene.fog = new THREE.Fog(sky.horizonColor.clone(), 2500, 9000);

// Sun shadows: a ~200 m orthographic box that follows the camera, snapped to shadow texels.
const SHADOW_HALF = 100;
const SHADOW_MAP = 2048;
/**
 * Camera height above ground between which the shadows fade out (the 200 m box is a speck from up
 * there), and the heights at which the shadow pass stops / resumes (hysteresis, so it never flaps).
 * The light keeps `castShadow` (switching it would recompile every material): the fade is the
 * shadow's `intensity` uniform, and once it is 0 the map is simply not rendered any more.
 */
const SHADOW_FADE_START = 250;
const SHADOW_FADE_END = 320;
const SHADOW_PASS_OFF = 320;
const SHADOW_PASS_ON = 300;
let shadowPassOn = true;
/** Dev only (`__vk.shadowProbe`): offsets the shadow box from the camera, to test texel snapping without moving the view. */
const shadowProbe = { x: 0, z: 0 };
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
const lightFwd = new THREE.Vector3();
const lightRight = new THREE.Vector3();
const lightUp = new THREE.Vector3();
const WORLD_UP = new THREE.Vector3(0, 1, 0);
function updateLightBasis(): void {
  lightFwd.copy(SUN_DIR).negate();
  lightRight.crossVectors(lightFwd, WORLD_UP).normalize();
  lightUp.crossVectors(lightRight, lightFwd).normalize();
}
updateLightBasis();
let frustumX = 0;
let frustumZ = 0;
function updateShadowFrustum(cx: number, cy: number, cz: number): void {
  frustumX = cx;
  frustumZ = cz;
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

// ---- time of day: one function copies a palette into lights, sky, fog, water and the shader uniform.
// Called at startup and when the time button is pressed (never per frame); uniform writes only.
/** 1 by day .. 0 at night, read by the birds and the ambience. */
let dayFactor = 1;
let landmarkLayer: LandmarkLayer | null = null;
let birdSystem: BirdSystem | null = null;
let fishSystem: FishSystem | null = null;
function applyTime(hours: number): void {
  const d = daylightAt(hours);
  SUN_DIR.set(d.lightDir[0], d.lightDir[1], d.lightDir[2]);
  updateLightBasis();
  sun.color.setRGB(d.lightColor[0], d.lightColor[1], d.lightColor[2], THREE.SRGBColorSpace);
  sun.intensity = d.lightIntensity;
  hemi.color.setRGB(d.hemiSky[0], d.hemiSky[1], d.hemiSky[2], THREE.SRGBColorSpace);
  hemi.groundColor.setRGB(d.hemiGround[0], d.hemiGround[1], d.hemiGround[2], THREE.SRGBColorSpace);
  hemi.intensity = d.hemiIntensity;
  renderer.toneMappingExposure = d.exposure;
  sky.setDaylight(d);
  const fog = scene.fog as THREE.Fog;
  fog.color.setRGB(d.fog[0], d.fog[1], d.fog[2], THREE.SRGBColorSpace);
  (scene.background as THREE.Color).copy(fog.color);
  const wu = waterMaterial.uniforms;
  (wu.uSunDir!.value as THREE.Vector3).copy(SUN_DIR);
  const wl = (d.lightIntensity / 1.8) * (1 + 1.2 * d.night);
  (wu.uLight!.value as THREE.Vector3).set(d.lightColor[0] * wl, d.lightColor[1] * wl, d.lightColor[2] * wl);
  (wu.uSky!.value as THREE.Color).setRGB(d.reflect[0], d.reflect[1], d.reflect[2], THREE.SRGBColorSpace);
  NIGHT_UNIFORM.value = d.lights;
  landmarkLayer?.setNight(d.lights);
  // low sun: a larger normal offset keeps grazing-angle shadows free of acne
  sun.shadow.normalBias = 0.15 + 0.25 * (1 - Math.min(1, Math.max(0, (d.lightDir[1] - 0.17) / 0.4)));
  // re-aim the light (also when the shadow pass is off high up, or in Low) and redraw the map once
  updateShadowFrustum(frustumX, 0, frustumZ);
  if (shadowsOn) sun.shadow.needsUpdate = true;
  dayFactor = 1 - d.lights;
  birdSystem?.setDaylight(dayFactor);
  birdSystem?.setTimeOfDay(hours);
  fishSystem?.setDaylight(dayFactor);
}
const urlTime = new URLSearchParams(location.search).get('time');
let timeHours = resolveTime(urlTime, readStoredTime());
applyTime(timeHours);

const hud = document.getElementById('hud')!;
applyDocument();
createLangSwitcher(document.body);
createQualityButton(document.body);
createTimeButton(document.body, timeHours, (h) => {
  timeHours = h;
  writeStoredTime(h);
  applyTime(h);
});
createAttribution(document.body);
watchForUpdates(document.body, () => t('updateAvailable'));
const base = import.meta.env.BASE_URL;

async function start(): Promise<void> {
  const manifest = (await (await fetch(versioned(`${base}world/manifest.json`))).json()) as Manifest;
  const viewRadius = isMobile ? 384 : 640;
  const streamer = new WorldStreamer(scene, manifest, { viewRadius, waterMaterial });
  const vegetation = new Vegetation(scene, {
    nearRadius: isMobile ? 150 : 250,
    farRadius: viewRadius,
    fineRadius: isMobile ? 25 : 40,
    exclusions: getVegetationExclusions(manifest.bbox),
  });
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
      signs: blocksOn ? new SignLayer(scene) : undefined,
    })
    : null;
  const basePhysics = fine !== null ? fine.world : streamer;
  landmarkLayer = new LandmarkLayer(scene, createLandmarks(manifest.bbox), basePhysics, quality);
  landmarkLayer.setNight(dayFactor);
  /** Physics world: coarse/fine heights plus walkable landmark surfaces where a landmark is built. */
  const physics = new LandmarkPhysics(basePhysics, landmarkLayer);
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
  const teleport = (x: number, z: number): void => {
    if (player.mode === 'fly') {
      player.setFlyPose(x, Math.max(player.y, 80), z, player.yaw, player.pitch);
    } else {
      const yaw = player.yaw;
      player.spawn(x, z);
      player.yaw = yaw;
    }
  };
  minimap.onTeleport = teleport;

  fetch(versioned(`${base}world/places.json`))
    .then((r) => r.json() as Promise<Place[]>)
    .then((places) => {
      new PlacesMenu(document.body, places, (p) => {
        if (p.yaw !== undefined) {
          // a street: stand on it at street level, looking along it
          player.spawn(p.x, p.z);
          player.yaw = p.yaw * deg;
        } else teleport(p.x, p.z);
      });
    })
    .catch((err) => console.warn('places unavailable', err));

  const birds = new BirdSystem(scene, { mobile: isMobile });
  birdSystem = birds;
  birds.setDaylight(dayFactor);
  birds.setTimeOfDay(timeHours);
  const birdListener: BirdListener = { x: 0, y: 0, z: 0, speed: 0 };
  const fish = new FishSystem(scene, { mobile: isMobile });
  fishSystem = fish;
  fish.setDaylight(dayFactor);
  const fishCamera = { x: 0, y: 0, z: 0, yaw: 0 };

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
    builtUp: 0.5,
    swiftFlocks: birds.swiftFlocks,
    doveGroups: birds.doveGroups,
    splashes: fish.splashes,
    daylight: 1,
  };
  let surroundingsAt = 0;
  // Real tree density from the instanced vegetation, nearest water from a coarse ring sample.
  const sampleSurroundings = (x: number, z: number): void => {
    let water = Infinity;
    let built = 0;
    let samples = 0;
    for (const r of SURROUNDING_RADII) {
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        const sx = x + Math.cos(a) * r;
        const sz = z + Math.sin(a) * r;
        const mat = streamer.groundMatAt(sx, sz);
        if (mat === MAT.WATER) water = Math.min(water, r);
        const top = streamer.heightAt(sx, sz);
        const terrain = streamer.groundHeightAt(sx, sz);
        if (mat !== null && mat >= MAT.WALL_HOUSE && mat <= MAT.LAMP) built++;
        else if (top !== null && terrain !== null && top - terrain > 2) built++;
        samples++;
      }
    }
    audioScene.treeDensity = vegetation.treeDensity(x, z);
    audioScene.waterDistance = streamer.isWater(x, z) ? 0 : water;
    audioScene.builtUp = samples > 0 ? built / samples : 0.5;
  };

  if (import.meta.env.DEV) Object.assign(window, { __vk: { shadowProbe, player, streamer, fine, landmarks: landmarkLayer, input, birds, fish, ambience, vegetation, renderer, scene, camera, minimap } });

  let overview: Overview | null = null;
  fetch(versioned(`${base}world/overview.bin`))
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
  let rendered = 0;
  let fpsStart = last;
  let fps = 0;
  let hudAt = 0;

  const frame = (now: number): void => {
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;

    player.update(dt, physics);
    const agl = camera.position.y - (streamer.heightAt(camera.position.x, camera.position.z) ?? 0);
    if (shadowsOn) {
      // Above ~300 m the 200 m shadow box is a speck: fade the shadows out over 250..320 m and, once
      // they are invisible, stop rendering the shadow pass (no frozen patch is ever shown).
      const k = Math.min(1, Math.max(0, (SHADOW_FADE_END - agl) / (SHADOW_FADE_END - SHADOW_FADE_START)));
      sun.shadow.intensity = k * k * (3 - 2 * k);
      if (shadowPassOn && agl > SHADOW_PASS_OFF && rendered > 0) shadowPassOn = false;
      else if (!shadowPassOn && agl < SHADOW_PASS_ON) {
        shadowPassOn = true;
        sun.shadow.needsUpdate = true;
      }
      sun.shadow.autoUpdate = shadowPassOn;
      if (shadowPassOn) updateShadowFrustum(camera.position.x + shadowProbe.x, 0, camera.position.z + shadowProbe.z);
    }
    streamer.update(camera.position.x, camera.position.z);
    fine?.update(camera.position.x, camera.position.z, agl);
    landmarkLayer?.update(camera.position.x, camera.position.z);
    vegetation.update(camera.position.x, camera.position.z, now / 1000);
    if (overview !== null) {
      if (!overview.done) overview.build(4);
      overview.setHole(camera.position.x, camera.position.z, streamer.holeRadius(camera.position.x, camera.position.z));
    }
    updateWater(waterMaterial, now / 1000, camera.position);
    sky.update(camera.position, now / 1000);
    const cp = camera.position;
    if (dt > 0) birdListener.speed = Math.hypot(cp.x - birdListener.x, cp.z - birdListener.z) / dt;
    birdListener.x = cp.x;
    birdListener.y = cp.y;
    birdListener.z = cp.z;
    birds.update(dt, now / 1000, streamer, birdListener);
    fishCamera.x = cp.x;
    fishCamera.y = cp.y;
    fishCamera.z = cp.z;
    fishCamera.yaw = player.yaw;
    fish.update(dt, now / 1000, streamer, fishCamera);
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
    audioScene.daylight = dayFactor;
    audioScene.timeOfDay = timeHours;
    ambience.update(dt, audioScene);
    renderer.render(scene, camera);
    rendered++;
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

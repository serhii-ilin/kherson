import * as THREE from 'three';
import { toLatLon } from './world/geo.ts';
import { Overview, parseOverview } from './world/lod.ts';
import type { Manifest } from './world/manifest.ts';
import { WorldStreamer } from './world/streamer.ts';
import { createWaterMaterial, updateWater } from './nature/water.ts';
import { Vegetation } from './nature/vegetation.ts';
import { BirdSystem, type BirdListener } from './nature/birds.ts';
import { Ambience, createMuteButton, type AudioScene } from './nature/audio.ts';
import { MAT } from './world/materials.ts';
import { PlayerController } from './player/controller.ts';
import { Input } from './player/input.ts';
import { applyDocument, createLangSwitcher, t } from './i18n.ts';
import { TouchControls } from './player/touch.ts';
import { Minimap } from './ui/minimap.ts';
import { PlacesMenu, type Place } from './ui/places.ts';
import { PALETTE } from './world/materials.ts';
import { REGION, VOXEL } from './world/constants.ts';

const SKY = 0x9cc8ef;
const isMobile = TouchControls.isTouchDevice() || /Mobi|Android/i.test(navigator.userAgent);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1.5 : 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.Fog(SKY, 2500, 9000);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.3, 12000);
scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x6b5a3a, 0.9));
const sun = new THREE.DirectionalLight(0xfff0d0, 1.6);
sun.position.set(-300, 500, 300); // from the south-west
scene.add(sun);
const waterMaterial = createWaterMaterial({
  skyColor: new THREE.Color(SKY),
  sunDir: sun.position.clone().normalize(),
  fog: true,
});

const hud = document.getElementById('hud')!;
applyDocument();
createLangSwitcher(document.body);
const base = import.meta.env.BASE_URL;

async function start(): Promise<void> {
  const manifest = (await (await fetch(`${base}world/manifest.json`)).json()) as Manifest;
  const viewRadius = isMobile ? 384 : 640;
  const streamer = new WorldStreamer(scene, manifest, { viewRadius, waterMaterial });
  const vegetation = new Vegetation(scene, { nearRadius: isMobile ? 150 : 250, farRadius: viewRadius });
  streamer.onRegionData = (rx, rz, data) => vegetation.setRegion(rx, rz, data ? data.features : null, data?.cells);
  const input = new Input();
  input.attach(renderer.domElement);
  const player = new PlayerController(camera, input);
  // ?x=&z= (metres) jumps to a spot; add y/yaw/pitch (degrees) and mode=fly for an exact view.
  const q = new URLSearchParams(location.search);
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
        if (player.mode === 'fly') player.setFlyPose(p.x, Math.max(player.y, 80), p.z, player.yaw, player.pitch);
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

  if (import.meta.env.DEV) Object.assign(window, { __vk: { player, streamer, input, birds, ambience, vegetation, renderer } });

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
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
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

    player.update(dt, streamer);
    streamer.update(camera.position.x, camera.position.z);
    vegetation.update(camera.position.x, camera.position.z, now / 1000);
    if (overview !== null) {
      if (!overview.done) overview.build(4);
      overview.setHole(camera.position.x, camera.position.z, streamer.holeRadius(camera.position.x, camera.position.z));
    }
    updateWater(waterMaterial, now / 1000, camera.position);
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
          ? `veg ${vegetation.stats.instances} (${vegetation.stats.near} near) · ${renderer.info.render.triangles} tris · ${renderer.info.render.calls} calls\n`
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

import * as THREE from 'three';
import { toLatLon } from './world/geo.ts';
import { Overview, parseOverview } from './world/lod.ts';
import type { Manifest } from './world/manifest.ts';
import { WorldStreamer } from './world/streamer.ts';
import { PlayerController } from './player/controller.ts';
import { Input } from './player/input.ts';
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

const hud = document.getElementById('hud')!;
const base = import.meta.env.BASE_URL;

async function start(): Promise<void> {
  const manifest = (await (await fetch(`${base}world/manifest.json`)).json()) as Manifest;
  const streamer = new WorldStreamer(scene, manifest, { viewRadius: isMobile ? 384 : 640 });
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

  if (import.meta.env.DEV) Object.assign(window, { __vk: { player, streamer, input } });

  let overview: Overview | null = null;
  fetch(`${base}world/overview.bin`)
    .then((r) => r.arrayBuffer())
    .then((buf) => {
      const data = parseOverview(buf);
      overview = new Overview(scene, data, sx, sz);
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
    if (overview !== null) {
      if (!overview.done) overview.build(4);
      overview.setHole(camera.position.x, camera.position.z, streamer.holeRadius(camera.position.x, camera.position.z));
    }
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
        `${player.mode === 'walk' ? 'WALK' : 'FLY'} · ${fps} fps\n` +
        `x ${x.toFixed(0)}  y ${y.toFixed(1)}  z ${z.toFixed(0)} m · ${lat.toFixed(5)}, ${lon.toFixed(5)}\n` +
        `regions ${streamer.loadedRegions} · chunks ${streamer.chunkCount} · jobs ${streamer.inflightJobs} · ` +
        `${(streamer.triangles / 1000).toFixed(0)}k tris\n` +
        (isMobile
          ? 'Left: move · Right: look · ✈ fly/walk'
          : 'Click to look around · WASD move · Shift sprint · Space jump/up · F fly/walk');
    }
  };
  requestAnimationFrame(frame);
}

start().catch((err) => {
  hud.textContent = `Failed to start: ${String(err)}`;
  console.error(err);
});

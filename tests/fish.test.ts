import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { FishSystem } from '../src/nature/fish.ts';
import type { BirdWorld } from '../src/nature/birds.ts';
import { plopParameters } from '../src/nature/audio.ts';
import { waveHeight } from '../src/nature/water.ts';

function prng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function world(water: (x: number, z: number) => boolean): BirdWorld {
  return { heightAt: () => 2, groundMatAt: () => 0, isWater: water };
}

const camera = { x: 0, y: 5, z: 0, yaw: 0 };

function position(mesh: THREE.InstancedMesh, index: number): THREE.Vector3 {
  const a = mesh.instanceMatrix.array;
  return new THREE.Vector3(a[index * 16 + 12]!, a[index * 16 + 13]!, a[index * 16 + 14]!);
}

describe('waveHeight', () => {
  it('stays within the summed wave amplitudes', () => {
    for (let i = 0; i < 200; i++) expect(Math.abs(waveHeight(i * 3.7, i * -5.1, i * 0.3))).toBeLessThanOrEqual(0.35 + 1e-9);
  });
});

describe('FishSystem', () => {
  it('does not spawn without nearby water', () => {
    const sys = new FishSystem(new THREE.Scene(), { rng: prng(1) });
    const dry = world(() => false);
    for (let i = 0; i < 1200; i++) sys.update(0.1, i / 10, dry, camera);
    expect(sys.activeEvents).toBe(0);
    sys.dispose();
  });

  it('spawns on water, including a water half-plane', () => {
    const scene = new THREE.Scene();
    const sys = new FishSystem(scene, { rng: prng(2), maxEvents: 1 });
    const wet = world(() => true);
    for (let i = 0; i < 100 && sys.activeEvents === 0; i++) sys.update(0.1, i / 10, wet, camera);
    expect(sys.activeEvents).toBe(1);
    const first = position(scene.children[0] as THREE.InstancedMesh, 0);
    expect(wet.isWater(first.x, first.z)).toBe(true);
    sys.dispose();

    const half = world((x) => x >= 0);
    camera.x = 70;
    const halfScene = new THREE.Scene();
    const halfSys = new FishSystem(halfScene, { rng: prng(3), maxEvents: 3 });
    for (let i = 0; i < 900; i++) {
      halfSys.update(0.1, i / 10, half, camera);
      const fish = halfScene.children[0] as THREE.InstancedMesh;
      const shadow = halfScene.children[3] as THREE.InstancedMesh;
      for (let k = 0; k < fish.count; k++) {
        const p = position(fish, k);
        if (p.x !== 0 || p.y !== 0 || p.z !== 0) expect(half.isWater(p.x, p.z)).toBe(true);
        const q = position(shadow, k);
        if (q.x !== 0 || q.y !== 0 || q.z !== 0) expect(half.isWater(q.x, q.z)).toBe(true);
      }
    }
    halfSys.dispose();
    camera.x = 0;
  }, 30_000);

  it('stays quiet at night and never exceeds its pool', () => {
    const scene = new THREE.Scene();
    const sys = new FishSystem(scene, { rng: prng(4), maxEvents: 3 });
    const wet = world(() => true);
    sys.setDaylight(0);
    for (let i = 0; i < 1800; i++) sys.update(0.1, i / 10, wet, camera);
    expect(sys.activeEvents).toBe(0);
    sys.setDaylight(1);
    let max = 0;
    for (let i = 0; i < 9000; i++) {
      sys.update(0.1, 180 + i / 10, wet, camera);
      max = Math.max(max, sys.activeEvents);
      expect(sys.activeEvents).toBeLessThanOrEqual(3);
    }
    expect(max).toBeGreaterThan(0);
    sys.dispose();
  }, 30_000);

  it('launches and re-enters near the water surface, recording splashes', () => {
    const scene = new THREE.Scene();
    const sys = new FishSystem(scene, { rng: () => 0, maxEvents: 1 });
    const wet = world(() => true);
    sys.update(4, 4, wet, camera);
    const fish = scene.children[0] as THREE.InstancedMesh;
    const start = position(fish, 0);
    // the jump leaves from the wave surface at its start point and time
    const e = (sys as unknown as { events: { x: number; z: number; started: number }[] }).events[0]!;
    const surface = 2.05 + waveHeight(e.x, e.z, e.started);
    expect(start.y).toBeCloseTo(surface, 2);
    sys.update(0.3, 4.3, wet, camera);
    expect(position(fish, 0).y).toBeGreaterThan(surface + 0.3);
    sys.update(0.3, 4.6, wet, camera);
    expect(position(fish, 0).y).toBeCloseTo(surface, 2);
    expect(sys.splashes.some((s) => Number.isFinite(s.t))).toBe(true);
    sys.dispose();
  });

  it('keeps plop parameters in the intended short, quiet range', () => {
    const p = plopParameters(() => 0.5);
    expect(p.duration).toBeGreaterThanOrEqual(0.15);
    expect(p.duration).toBeLessThanOrEqual(0.3);
    expect(p.frequency).toBeGreaterThan(0);
    expect(p.gain).toBeLessThan(0.3);
    expect(p.noiseGain).toBeLessThan(0.4);
  });
});

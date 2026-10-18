import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BirdSystem, type BirdWorld, type BirdListener } from '../src/nature/birds.ts';
import { MAT } from '../src/world/materials.ts';

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

/** Flat ground y=4, plaza everywhere, a 20 m tall block (top 24) at x 100..140, z -20..20. */
function fakeWorld(): BirdWorld {
  const inBlock = (x: number, z: number) => x >= 100 && x < 140 && z >= -20 && z < 20;
  return {
    heightAt: (x, z) => (inBlock(x, z) ? 24 : 4),
    groundMatAt: () => MAT.PLAZA,
    isWater: () => false,
  };
}

function meshes(scene: THREE.Scene): THREE.InstancedMesh[] {
  return scene.children.filter((c): c is THREE.InstancedMesh => (c as THREE.InstancedMesh).isInstancedMesh);
}

describe('BirdSystem', () => {
  it('creates many compact swift parties within desktop and phone budgets', () => {
    const desktop = new BirdSystem(new THREE.Scene(), { rng: prng(11) });
    const phone = new BirdSystem(new THREE.Scene(), { rng: prng(11), mobile: true });

    expect(desktop.swiftFlocks.length).toBe(10);
    expect(phone.swiftFlocks.length).toBe(6);
    for (const flock of [...desktop.swiftFlocks, ...phone.swiftFlocks]) {
      expect(flock.count).toBeGreaterThanOrEqual(4);
      expect(flock.count).toBeLessThanOrEqual(15);
    }
    expect(desktop.swiftFlocks.reduce((sum, flock) => sum + flock.count, 0)).toBeLessThanOrEqual(140);
    expect(phone.swiftFlocks.reduce((sum, flock) => sum + flock.count, 0)).toBeLessThanOrEqual(70);
    desktop.dispose();
    phone.dispose();
  });

  it('swifts stay in altitude band and speed range', () => {
    const scene = new THREE.Scene();
    const sys = new BirdSystem(scene, { rng: prng(1) });
    const world = fakeWorld();
    const player: BirdListener = { x: 0, y: 5.7, z: 0, speed: 0 };
    const swiftMesh = meshes(scene)[0];
    const prev = new Float32Array(swiftMesh.count * 3);
    let sumSpeed = 0, nSpeed = 0;
    for (let f = 0; f < 3600; f++) {
      sys.update(1 / 60, f / 60, world, player);
      const a = swiftMesh.instanceMatrix.array;
      for (let i = 0; i < swiftMesh.count; i++) {
        const x = a[i * 16 + 12], y = a[i * 16 + 13], z = a[i * 16 + 14];
        const g = world.heightAt(x, z)!;
        expect(y).toBeGreaterThan(g + 5);
        expect(y).toBeLessThanOrEqual(150);
        if (f > 0 && f % 30 === 0) {
          sumSpeed += Math.hypot(x - prev[i * 3], y - prev[i * 3 + 1], z - prev[i * 3 + 2]) / 0.5; nSpeed++;
        }
        if (f % 30 === 0) { prev[i * 3] = x; prev[i * 3 + 1] = y; prev[i * 3 + 2] = z; }
      }
    }
    const avg = sumSpeed / nSpeed;
    expect(avg).toBeGreaterThan(12);
    expect(avg).toBeLessThan(28);
    sys.dispose();
  }, 30_000);

  it('uses low, normal, and high swift flight bands', () => {
    const scene = new THREE.Scene();
    const sys = new BirdSystem(scene, { rng: prng(21) });
    const world = fakeWorld();
    const player: BirdListener = { x: 0, y: 5.7, z: 0, speed: 0 };
    sys.update(1 / 60, 0, world, player);
    const swiftMesh = meshes(scene)[0];
    const a = swiftMesh.instanceMatrix.array;
    let low = 0, high = 0;
    for (let i = 0; i < swiftMesh.count; i++) {
      const x = a[i * 16 + 12], y = a[i * 16 + 13], z = a[i * 16 + 14];
      const clearance = y - world.heightAt(x, z)!;
      if (clearance < 30) low++;
      if (y > 100) high++;
    }
    expect(low).toBeGreaterThan(0);
    expect(high).toBeGreaterThan(0);
    sys.dispose();
  });

  it('makes more low swift passes during the evening peak', () => {
    const world = fakeWorld();
    const player: BirdListener = { x: 0, y: 5.7, z: 0, speed: 0 };
    const countLow = (sys: BirdSystem, scene: THREE.Scene): number => {
      const mesh = meshes(scene)[0];
      const a = mesh.instanceMatrix.array;
      let low = 0;
      for (let i = 0; i < mesh.count; i++) {
        const x = a[i * 16 + 12], y = a[i * 16 + 13], z = a[i * 16 + 14];
        if (y - world.heightAt(x, z)! < 30) low++;
      }
      return low;
    };
    const dayScene = new THREE.Scene();
    const day = new BirdSystem(dayScene, { rng: prng(31) });
    day.setTimeOfDay(12);
    const eveningScene = new THREE.Scene();
    const evening = new BirdSystem(eveningScene, { rng: prng(31) });
    evening.setTimeOfDay(19);
    for (let f = 0; f < 20 * 60; f++) {
      day.update(1 / 60, f / 60, world, player);
      evening.update(1 / 60, f / 60, world, player);
    }
    expect(countLow(evening, eveningScene)).toBeGreaterThan(countLow(day, dayScene));
    day.dispose();
    evening.dispose();
  }, 30_000);

  it('keeps swift spawns and low passes above building roofs', () => {
    const scene = new THREE.Scene();
    const sys = new BirdSystem(scene, { rng: prng(41) });
    const world = fakeWorld();
    const player: BirdListener = { x: 0, y: 5.7, z: 0, speed: 0 };
    const mesh = meshes(scene)[0];
    for (let f = 0; f < 600; f++) {
      sys.update(1 / 60, f / 60, world, player);
      const a = mesh.instanceMatrix.array;
      for (let i = 0; i < mesh.count; i++) {
        const x = a[i * 16 + 12], y = a[i * 16 + 13], z = a[i * 16 + 14];
        expect(y).toBeGreaterThan(world.heightAt(x, z)! + 5);
      }
    }
    sys.dispose();
  }, 30_000);

  function liveDoves(mesh: THREE.InstancedMesh): { i: number; x: number; y: number; z: number }[] {
    const a = mesh.instanceMatrix.array;
    const out = [];
    for (let i = 0; i < mesh.count; i++) {
      if (a[i * 16] === 0 && a[i * 16 + 1] === 0 && a[i * 16 + 2] === 0) continue;
      out.push({ i, x: a[i * 16 + 12], y: a[i * 16 + 13], z: a[i * 16 + 14] });
    }
    return out;
  }

  it('doves spawn on plaza at ground height, and take off when the player approaches', () => {
    const scene = new THREE.Scene();
    const sys = new BirdSystem(scene, { rng: prng(7) });
    const world = fakeWorld();
    const player: BirdListener = { x: 0, y: 5.7, z: 0, speed: 0 };
    for (let f = 0; f < 120; f++) sys.update(1 / 60, f / 60, world, player);
    const doveMesh = meshes(scene)[1];
    const doves = liveDoves(doveMesh);
    expect(doves.length).toBeGreaterThanOrEqual(6);
    expect(sys.doveGroups.length).toBeGreaterThan(0);
    for (const d of doves) {
      expect(world.groundMatAt(d.x, d.z)).toBe(MAT.PLAZA);
      expect(Math.abs(d.y - 4 - 0.09)).toBeLessThan(0.2);
    }
    const grp = sys.doveGroups[0];
    const mine = doves.filter((d) => Math.hypot(d.x - grp.x, d.z - grp.z) < 8);
    expect(mine.length).toBeGreaterThanOrEqual(6);
    // walk the player to the group
    const dx = grp.x - player.x, dz = grp.z - player.z, dl = Math.hypot(dx, dz);
    let t = 2;
    player.speed = 4;
    let triggered = -1;
    for (let f = 0; f < 60 * 120 && triggered < 0; f++) {
      const step = Math.min(4 / 60, Math.max(0, dl - Math.hypot(player.x - grp.x, player.z - grp.z)));
      player.x += (dx / dl) * 4 / 60; player.z += (dz / dl) * 4 / 60;
      void step;
      t += 1 / 60;
      sys.update(1 / 60, t, world, player);
      if (grp.flying) triggered = f;
    }
    expect(triggered).toBeGreaterThanOrEqual(0);
    for (let f = 0; f < 90; f++) { t += 1 / 60; sys.update(1 / 60, t, world, player); }
    const a = doveMesh.instanceMatrix.array;
    for (const d of mine) expect(a[d.i * 16 + 13]).toBeGreaterThan(4 + 2);
    sys.dispose();
  }, 30_000);

  it('has no NaN in instance matrices or flap data', () => {
    const scene = new THREE.Scene();
    const sys = new BirdSystem(scene, { rng: prng(3), mobile: true });
    const world = fakeWorld();
    const player: BirdListener = { x: 0, y: 5.7, z: 0, speed: 9 };
    for (let f = 0; f < 1800; f++) {
      player.x += 0.1;
      sys.update(1 / 60, f / 60, world, player);
    }
    for (const m of meshes(scene)) {
      for (const v of m.instanceMatrix.array) expect(Number.isFinite(v)).toBe(true);
      const flap = m.geometry.getAttribute('aFlap').array;
      for (const v of flap) expect(Number.isFinite(v)).toBe(true);
    }
    sys.dispose();
  }, 30_000);
});

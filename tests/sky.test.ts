import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { cloudPalette, createSky } from '../src/world/sky.ts';

function shaderMat(m: THREE.Material | THREE.Material[]): THREE.ShaderMaterial {
  const one = Array.isArray(m) ? m[0] : m;
  if (!(one instanceof THREE.ShaderMaterial)) throw new Error('expected a ShaderMaterial');
  return one;
}

function sphereGeo(g: THREE.BufferGeometry): THREE.SphereGeometry {
  if (!(g instanceof THREE.SphereGeometry)) throw new Error('expected a SphereGeometry');
  return g;
}

describe('createSky', () => {
  const sun = new THREE.Vector3(0.3, 0.8, 0.5).normalize();

  it('builds a back-side shader dome with the expected uniforms', () => {
    const sky = createSky({ sunDir: sun });
    const mat = shaderMat(sky.mesh.material);
    expect(Object.keys(mat.uniforms)).toEqual(
      expect.arrayContaining(['uZenith', 'uHorizon', 'uGround', 'uSunDir']),
    );
    expect(mat.side).toBe(THREE.BackSide);
    expect(mat.depthWrite).toBe(false);
    expect(mat.fog).toBe(false);
    expect(sky.mesh.frustumCulled).toBe(false);
    expect(sky.mesh.renderOrder).toBe(-1);
    expect(sky.mesh.material).toBe(mat);
  });

  it('exposes a horizon colour clone for fog', () => {
    const horizon = new THREE.Color(0xc9dff0);
    const sky = createSky({ sunDir: sun, horizon });
    expect(sky.horizonColor).toEqual(horizon);
    expect(sky.horizonColor).not.toBe(horizon);
    expect(shaderMat(sky.material).uniforms.uHorizon!.value).toEqual(horizon);
  });

  it('update moves the dome to the camera position', () => {
    const sky = createSky({ sunDir: sun });
    sky.update(new THREE.Vector3(5, 6, 7));
    expect(sky.mesh.position.x).toBe(5);
    expect(sky.mesh.position.y).toBe(6);
    expect(sky.mesh.position.z).toBe(7);
  });

  it('respects a custom radius', () => {
    const sky = createSky({ sunDir: sun, radius: 4321 });
    expect(sphereGeo(sky.mesh.geometry).parameters.radius).toBe(4321);
    expect(sphereGeo(sky.mesh.geometry).parameters.widthSegments).toBe(32);
    expect(sphereGeo(sky.mesh.geometry).parameters.heightSegments).toBe(16);
  });

  it('defaults the radius to 10000', () => {
    const sky = createSky({ sunDir: sun });
    expect(sphereGeo(sky.mesh.geometry).parameters.radius).toBe(10000);
  });

  it('keeps clouds bright by day, warm at dusk and faint blue-grey at night', () => {
    const noon = cloudPalette(0, 0);
    const golden = cloudPalette(0, 1);
    const night = cloudPalette(1, 0);
    expect(noon.top[0]).toBeGreaterThan(0.9);
    expect(golden.top[0]).toBeGreaterThan(golden.top[1]!);
    expect(golden.top[1]).toBeGreaterThan(golden.top[2]!);
    expect(night.top[2]).toBeGreaterThan(night.top[0]!);
    expect(night.alpha).toBeLessThan(noon.alpha);
  });

  it('advances cloud drift without moving the dome allocation', () => {
    const sky = createSky({ sunDir: sun, cloudOctaves: 2 });
    const material = shaderMat(sky.material);
    sky.update(new THREE.Vector3(1, 2, 3), 12.5);
    expect(material.uniforms.uCloudTime!.value).toBe(12.5);
    expect(material.uniforms.uCloudOctaves!.value).toBe(2);
  });
});

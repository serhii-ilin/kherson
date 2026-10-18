import * as THREE from 'three';

export interface SkyOptions {
  sunDir: THREE.Vector3;      // normalised, points FROM the scene TOWARD the sun
  zenith?: THREE.Color;       // default 0x3f7fd0
  horizon?: THREE.Color;      // default 0xc9dff0
  ground?: THREE.Color;       // colour below the horizon, default 0x9fb3c4
  radius?: number;            // default 10000
}

export interface Sky {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  /** keep the dome centred on the camera; call once per frame */
  update(cameraPosition: THREE.Vector3): void;
  /** the colour the fog should use so distant terrain melts into the horizon */
  horizonColor: THREE.Color;
}

const DEFAULT_ZENITH = 0x3f7fd0;
const DEFAULT_HORIZON = 0xc9dff0;
const DEFAULT_GROUND = 0x9fb3c4;
const DEFAULT_RADIUS = 10000;

const VERTEX = /* glsl */ `
varying vec3 vDir;

void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uSunDir;
varying vec3 vDir;

void main() {
  vec3 d = normalize(vDir);

  vec3 col = mix(uHorizon, uZenith, pow(max(d.y, 0.0), 0.5));
  float below = clamp(-d.y / 0.15, 0.0, 1.0);
  col = mix(col, uGround, below);

  float haze = 1.0 - smoothstep(0.0, 0.08, abs(d.y));
  col *= 1.0 + 0.05 * haze;

  float s = max(dot(d, normalize(uSunDir)), 0.0);
  col += smoothstep(0.9995, 0.9998, s) * vec3(1.0, 0.95, 0.85) * 2.0;
  col += (pow(s, 64.0) * 0.35 + pow(s, 8.0) * 0.12) * vec3(1.0, 0.9, 0.7);

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function createSky(opts: SkyOptions): Sky {
  const radius = opts.radius ?? DEFAULT_RADIUS;
  const zenith = opts.zenith ?? new THREE.Color(DEFAULT_ZENITH);
  const horizon = opts.horizon ?? new THREE.Color(DEFAULT_HORIZON);
  const ground = opts.ground ?? new THREE.Color(DEFAULT_GROUND);

  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: true,
    fog: false,
    uniforms: {
      uZenith: { value: zenith.clone() },
      uHorizon: { value: horizon.clone() },
      uGround: { value: ground.clone() },
      uSunDir: { value: opts.sunDir.clone().normalize() },
    },
  });

  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 16), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;

  return {
    mesh,
    material,
    update(cameraPosition: THREE.Vector3): void {
      mesh.position.copy(cameraPosition);
    },
    horizonColor: horizon.clone(),
  };
}

/**
 * Materials for the `'textured'` landmark meshes (docs/BUILDINGS_PLAN.md, task H).
 *
 * Every mesh is still a vertex-coloured `MeshStandardMaterial`. On top of that, `onBeforeCompile` adds either a
 * facade photo (albedo = photo × vertex colour) or the shared PBR layers (`pbrSample(...).detail` × vertex
 * colour, roughness from the sample, normals perturbed in world space). A photo mesh skips the PBR albedo but
 * keeps the PBR normal when its vertices name a layer, so hero windows stay geometrically lit.
 *
 * One material is shared by every mesh with the same photo id (or by all PBR-only meshes), and the cache is
 * reference-counted: the material and its photo texture leave the GPU when the last user is dropped. The photo
 * download starts only on `requestPhoto()`, which the layer calls within its own approach radius.
 */
import * as THREE from 'three';
import { PBR_PARS } from '../world/pbr-glsl.ts';
import type { PbrUniforms } from '../world/pbr-library.ts';
import { versioned } from '../version.ts';

const PBR_KEY = 'pbr';
const ROUGHNESS = 0.85;

/** Photo ids already reported: a missing facade file warns once per page, not once per approach. */
const warnedPhotos = new Set<string>();

export type TextureLoader = (url: string) => Promise<THREE.Texture>;

export interface TexturedMaterialOptions {
  pbr?: PbrUniforms;
  /** Vite base URL, always with a trailing slash after normalisation. */
  base: string;
  loadTexture: TextureLoader;
}

/** A reference-counted lease on one shared textured material. */
export interface TexturedMaterialHandle {
  readonly material: THREE.MeshStandardMaterial;
  /** Idempotent: starts the photo download once; later calls do nothing. */
  requestPhoto(): void;
  /** Drops one reference; disposes the material (+ texture) when the last one goes. */
  release(): void;
}

interface TextureUniforms {
  uPhoto: { value: THREE.Texture | null };
  uHasPhoto: { value: number };
}

interface Entry {
  readonly key: string;
  readonly photo: string | null;
  readonly material: THREE.MeshStandardMaterial;
  readonly uniforms: TextureUniforms | null;
  refs: number;
  requested: boolean;
  texture: THREE.Texture | null;
  disposed: boolean;
}

interface PatchableShader {
  vertexShader: string;
  fragmentShader: string;
  uniforms: Record<string, { value: unknown }>;
}

function prepareTexture(texture: THREE.Texture): void {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
}

function createMaterial(photo: string | null, pbr?: PbrUniforms): { material: THREE.MeshStandardMaterial; uniforms: TextureUniforms | null } {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: ROUGHNESS });
  const uniforms: TextureUniforms | null = photo === null
    ? null
    : { uPhoto: { value: null }, uHasPhoto: { value: 0 } };
  material.userData.vkTextured = true;
  if (uniforms !== null) {
    material.userData.uPhoto = uniforms.uPhoto;
    material.userData.uHasPhoto = uniforms.uHasPhoto;
  }
  // Without PBR uniforms a plain textured mesh keeps the stock vertex-colour standard shader.
  if (pbr === undefined && photo === null) return { material, uniforms };

  material.onBeforeCompile = (shader) => {
    if (pbr !== undefined) Object.assign(shader.uniforms, pbr);
    if (uniforms !== null) Object.assign(shader.uniforms, uniforms);
    patchShader(shader as unknown as PatchableShader, pbr !== undefined, photo !== null);
  };
  material.customProgramCacheKey = () => `vk-landmark-textured-${pbr === undefined ? 'plain' : 'pbr'}-${photo === null ? 'pbr' : 'photo'}`;
  return { material, uniforms };
}

/** Adds the attribute/varying plumbing, then the albedo, roughness and world-space normal changes. */
function patchShader(shader: PatchableShader, withPbr: boolean, withPhoto: boolean): void {
  shader.vertexShader = shader.vertexShader
    .replace(
      '#include <common>',
      `#include <common>
attribute float aPbr;
varying vec2 vTexUv;
varying float vPbrLayer;
varying vec3 vWorldNormal;`,
    )
    .replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
  vTexUv = uv;
  vPbrLayer = aPbr;
  vWorldNormal = normalize(mat3(modelMatrix) * objectNormal);`,
    );

  const fragmentPars = [
    '#include <common>',
    'varying vec2 vTexUv;',
    'varying float vPbrLayer;',
    'varying vec3 vWorldNormal;',
  ];
  if (withPhoto) fragmentPars.push('uniform sampler2D uPhoto;', 'uniform float uHasPhoto;');
  if (withPbr) fragmentPars.push(PBR_PARS, 'PbrSample gPbrSample;');
  fragmentPars.push('bool gIsPhoto;');

  let albedo = `#include <color_fragment>
  gIsPhoto = false;`;
  if (withPhoto) {
    albedo += `
  gIsPhoto = uHasPhoto > 0.5;
  if ( gIsPhoto ) diffuseColor.rgb *= texture2D( uPhoto, vTexUv ).rgb;`;
  }
  if (withPbr) {
    albedo += `
  gPbrSample = pbrSample( vPbrLayer, vTexUv, length( vViewPosition ) );
  if ( !gIsPhoto ) diffuseColor.rgb *= gPbrSample.detail;`;
  }

  shader.fragmentShader = shader.fragmentShader.replace('#include <common>', fragmentPars.join('\n'));
  shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', albedo);
  if (withPbr) {
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
  if ( !gIsPhoto ) roughnessFactor = gPbrSample.rough;`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
  if ( vPbrLayer >= 0.0 ) {
    vec3 worldNormal = normalize( vWorldNormal );
    vec3 tangent;
    vec3 bitangent;
    if ( abs( worldNormal.y ) < 0.5 ) pbrWallBasis( worldNormal, tangent, bitangent );
    else pbrGroundBasis( worldNormal, tangent, bitangent );
    vec3 perturbed = pbrPerturb( worldNormal, tangent, bitangent, gPbrSample.nTS );
    normal = normalize( mat3( viewMatrix ) * perturbed );
  }`,
      );
  }
}

export class TexturedMaterialCache {
  private readonly entries = new Map<string, Entry>();
  private readonly base: string;

  constructor(private readonly options: TexturedMaterialOptions) {
    this.base = options.base.endsWith('/') ? options.base : `${options.base}/`;
  }

  get texturedMaterials(): number {
    return this.entries.size;
  }

  get photoTextures(): number {
    let n = 0;
    for (const entry of this.entries.values()) if (entry.texture !== null) n++;
    return n;
  }

  acquire(photo?: string): TexturedMaterialHandle {
    const key = photo ?? PBR_KEY;
    let entry = this.entries.get(key);
    if (entry === undefined) {
      const created = createMaterial(photo ?? null, this.options.pbr);
      entry = {
        key,
        photo: photo ?? null,
        material: created.material,
        uniforms: created.uniforms,
        refs: 0,
        requested: false,
        texture: null,
        disposed: false,
      };
      this.entries.set(key, entry);
    }
    entry.refs++;
    const owned = entry;
    return {
      material: owned.material,
      requestPhoto: () => this.requestPhoto(owned),
      release: () => this.release(owned),
    };
  }

  dispose(): void {
    for (const entry of this.entries.values()) this.disposeEntry(entry);
    this.entries.clear();
  }

  /** Starts the download once per photo id; failures stay silent apart from a single warning. */
  private requestPhoto(entry: Entry): void {
    if (entry.photo === null || entry.requested || entry.disposed) return;
    entry.requested = true;
    const photo = entry.photo;
    const url = versioned(`${this.base}assets/facades/${photo}.webp`);
    this.options.loadTexture(url).then(
      (texture) => {
        prepareTexture(texture);
        if (entry.disposed || entry.refs === 0) {
          texture.dispose();
          return;
        }
        entry.texture = texture;
        if (entry.uniforms !== null) {
          entry.uniforms.uPhoto.value = texture;
          entry.uniforms.uHasPhoto.value = 1;
        }
      },
      () => {
        if (entry.disposed || warnedPhotos.has(photo)) return;
        warnedPhotos.add(photo);
        console.warn(`landmark: facade photo ${photo} failed to load; keeping vertex colours`);
      },
    );
  }

  private release(entry: Entry): void {
    entry.refs--;
    if (entry.refs > 0) return;
    this.entries.delete(entry.key);
    this.disposeEntry(entry);
  }

  private disposeEntry(entry: Entry): void {
    if (entry.disposed) return;
    entry.disposed = true;
    const texture = entry.texture;
    entry.texture = null;
    entry.material.dispose();
    texture?.dispose();
    if (entry.uniforms !== null) {
      entry.uniforms.uPhoto.value = null;
      entry.uniforms.uHasPhoto.value = 0;
    }
  }
}

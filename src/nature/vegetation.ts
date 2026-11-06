import * as THREE from 'three';
import { F_GROUND_H, F_STRUCT_H, REGION, VOXEL } from '../world/constants.ts';
import { FEATURE_BUSH, FEATURE_TREE, type Feature } from '../world/format.ts';
import { jitterX, jitterZ } from './placement.ts';
import { BUSH_SPECIES, SPECIES, TREE_SPECIES, VARIANTS, buildModel, voxelShapeSpecies, type VegModel } from './models.ts';
import { variantScale } from './realistic.ts';
import { BARK_LAYERS, LEAF_LAYERS } from './tree-atlas.ts';
import { makeBarkLayers, makeLeafLayers } from './tree-textures.ts';
import { VegModelQueue } from './veg-queue.ts';
import type { VegResponse } from './veg.worker.ts';
import type { ExclusionPolygon } from '../landmarks/exclusions.ts';

export interface VegetationOptions {
  /** Mid models (lod 2) are used up to this distance, metres. */
  nearRadius: number;
  /** Far boxes (lod 1) are used up to this distance, metres. */
  farRadius: number;
  /** 0.5 m models (lod 0) up to this distance; default 70 m (40 m when nearRadius < 200). */
  lod0Radius?: number;
  /** Finest 0.2 m models (lod 3: branches and leaf clusters) up to this distance; default 40 m (25 m on phones). */
  fineRadius?: number;
  /** Alpha-tested ~5 cm leaf holes on the voxel finest models; default false. Realistic trees use a leaf texture instead. */
  leafCutout?: boolean;
  /** Micro-voxel crowns, for `?renderer=voxel`. The default is trunk meshes plus leaf cards. */
  voxel?: boolean;
  /** Narrow treeless paving/hand-item clearances; broad landmark footprints are never accepted here. */
  exclusions?: readonly ExclusionPolygon[];
}

export interface VegetationStats {
  instances: number;
  near: number;
  /** Instances drawn with the finest 0.2 m model. */
  fine: number;
  triangles: number;
}

const REGION_M = REGION * VOXEL;
/** LOD lists are rebuilt when the camera crosses a cell of this size (Article 4 rule 3). */
const RECOMPUTE_M = 16;
const SPECIES_LIST: readonly number[] = [...TREE_SPECIES, ...BUSH_SPECIES];
const N_MODELS = SPECIES_LIST.length * VARIANTS;
const FIRST_BUSH_MODEL = TREE_SPECIES.length * VARIANTS;
/** Group slots per model: 0 = lod3 (0.2 m), 1 = lod0 (0.5 m), 2 = lod2 (mid), 3 = lod1 (far). */
const SLOTS = 4;
const LOD_OF_SLOT = [3, 0, 2, 1] as const;
const SPECIES_INDEX = new Map<number, number>(SPECIES_LIST.map((s, i) => [s, i]));

/** Per-region instance data (structure of arrays). */
interface RegionVeg {
  rx: number;
  rz: number;
  count: number;
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  scale: Float32Array;
  rot: Uint8Array;
  tint: Float32Array;
  model: Uint8Array;
  /** 1 = whitewashed street / tree-row trunk. */
  white: Uint8Array;
  /** Current group slot per instance (-1 = hidden). */
  slot: Int8Array;
  trees: number;
}

interface Group {
  mesh: THREE.InstancedMesh | null;
  /** Per-instance whitewash flag; kept here so the fill pass needs no geometry lookup. */
  white: THREE.InstancedBufferAttribute | null;
  capacity: number;
  tris: number;
}

/** Model index of the variant-0 model that the mid and far slots share. */
function baseModel(model: number): number {
  return model - (model % VARIANTS);
}

/** Group index of an instance: slots 2 (mid) and 3 (far) share their species' variant-0 model on the realistic path. */
export function groupOf(model: number, slot: number, voxel = false): number {
  return (slot >= 2 && !voxel ? baseModel(model) : model) * SLOTS + slot;
}

/** Uniform scale of a variant relative to variant 0; the shared mid/far models are scaled back by this. */
const VARIANT_SCALE = new Float32Array(VARIANTS);
for (let v = 0; v < VARIANTS; v++) VARIANT_SCALE[v] = variantScale(v) / variantScale(0);

/** Instance scale multiplier of a group; slots 0 and 1 use the model at its own size, and voxel variants are never rescaled. */
export function slotScale(model: number, slot: number, voxel = false): number {
  return slot >= 2 && !voxel ? VARIANT_SCALE[model % VARIANTS]! : 1;
}

/** 1 for street and tree-row trees (spring whitewash), 0 for everything else. */
export function whiteOf(f: Feature): 0 | 1 {
  return f.type === FEATURE_TREE && f.param === 6 ? 1 : 0;
}

/** Model index of a feature. `voxel` folds species without a voxel shape of their own onto the one they borrow. */
export function modelOf(f: Feature, voxel = false): number {
  let sp = f.species;
  if (sp === SPECIES.GENERIC) {
    // Old baked data has no species; pick one of the common Kherson trees from the seed.
    switch ((f.seed >> 3) & 3) {
      case 0: sp = SPECIES.MAPLE; break;
      case 1: sp = SPECIES.ELM; break;
      case 2: sp = SPECIES.LINDEN; break;
      default: sp = SPECIES.CHESTNUT; break;
    }
  }
  if (voxel) sp = voxelShapeSpecies(sp);
  let si = SPECIES_INDEX.get(sp);
  if (si === undefined) si = f.type === FEATURE_BUSH ? TREE_SPECIES.length : 0;
  return si * VARIANTS + (((f.seed >> 6) & 3) % VARIANTS);
}

function toGeometry(m: VegModel): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3));
  g.setAttribute('color', new THREE.BufferAttribute(m.colors, 3));
  g.setAttribute('sway', new THREE.BufferAttribute(m.sway, 1));
  if (m.leaf) g.setAttribute('leaf', new THREE.BufferAttribute(m.leaf, 1));
  if (m.uvs) g.setAttribute('aLeafUv', new THREE.BufferAttribute(m.uvs, 2));
  if (m.tex) g.setAttribute('aTex', new THREE.BufferAttribute(m.tex, 1));
  g.setIndex(new THREE.BufferAttribute(m.indices, 1));
  return g;
}

// GLSL injected into the realistic (leaf-card) materials. Exported so tests can check the patch
// without constructing a Vegetation (which needs a Worker).
const CARD_VERTEX_COMMON = `#include <common>
attribute float sway;
attribute float leaf;
attribute vec2 aLeafUv;
attribute float aTex;
attribute float aWhite;
uniform float uTime;
varying float vLeaf;
varying vec2 vLeafUv;
varying float vTex;
varying float vWhite;
varying float vLocalY;
varying vec3 vWorldPos;`;

const CARD_PROJECT = `vLeaf = leaf;
  vLeafUv = aLeafUv;
  vTex = aTex;
  vWhite = aWhite;
  vLocalY = position.y;
  `;

const CARD_FRAGMENT_COMMON = `#include <common>
precision highp sampler2DArray;
varying float vLeaf;
varying vec2 vLeafUv;
varying float vTex;
varying float vWhite;
varying float vLocalY;
varying vec3 vWorldPos;
uniform sampler2DArray uBarkArr;
uniform sampler2DArray uLeafArr;
uniform vec3 uSunDir;
uniform vec3 uSunColor;`;

const CARD_COLOR_FRAGMENT = `#include <color_fragment>
  if ( vLeaf > 0.5 ) {
    vec4 tex = texture( uLeafArr, vec3( vLeafUv, vTex ) );
    if ( tex.a < 0.4 ) discard;
    diffuseColor.rgb *= tex.rgb;
  } else {
    diffuseColor.rgb *= texture( uBarkArr, vec3( vLeafUv, vTex ) ).rgb;
    if ( vWhite > 0.5 ) {
      // Spring whitewash with a soft, slightly ragged edge at about 1.2 m.
      float edge = 1.2 + 0.06 * sin( vLeafUv.x * 25.0 );
      if ( vLocalY < edge ) {
        float grain = fract( sin( dot( vLeafUv, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
        diffuseColor.rgb = vec3( 0.91, 0.90, 0.87 ) * ( 0.92 + 0.08 * grain );
      }
    }
  }`;

const CARD_DEPTH_FRAGMENT = `#include <clipping_planes_fragment>
  if ( vLeaf > 0.5 && texture( uLeafArr, vec3( vLeafUv, vTex ) ).a < 0.4 ) discard;`;

const CARD_NORMAL_FRAGMENT = `#include <normal_fragment_begin>
  // Cards are DoubleSide; restore the authored outward normal on the back faces too.
  if ( vLeaf > 0.5 ) normal *= faceDirection;`;

const CARD_EMISSIVE_FRAGMENT = `#include <emissivemap_fragment>
  if ( vLeaf > 0.5 ) {
    // Light through the leaves: a deep glow only where the card turns away from the sun, plus a small
    // terminator lift. uSunDir is world space; normal is view space after the back-face fix.
    vec3 sunView = ( viewMatrix * vec4( uSunDir, 0.0 ) ).xyz;
    vec3 viewDir = normalize( vWorldPos - cameraPosition );
    float back = pow( max( dot( viewDir, uSunDir ), 0.0 ), 6.0 );
    float away = 1.0 - max( dot( normal, sunView ), 0.0 );
    totalEmissiveRadiance += diffuseColor.rgb * uSunColor * back * 0.22 * away;
    totalEmissiveRadiance += 0.05 * uSunColor * diffuseColor.rgb;
  }`;

/** The GLSL injected into the realistic card materials, for tests. */
export function cardShaderChunks(): readonly string[] {
  return [
    CARD_VERTEX_COMMON, CARD_PROJECT, CARD_FRAGMENT_COMMON,
    CARD_COLOR_FRAGMENT, CARD_DEPTH_FRAGMENT, CARD_NORMAL_FRAGMENT, CARD_EMISSIVE_FRAGMENT,
  ];
}

/** Instanced, wind-swayed trees and bushes streamed with the world regions. */
export class Vegetation {
  readonly stats: VegetationStats = { instances: 0, near: 0, fine: 0, triangles: 0 };
  readonly material: THREE.MeshLambertMaterial;
  /** Depth material with the same sway, so shadows move with the foliage. */
  readonly depthMaterial: THREE.MeshDepthMaterial;
  /** Material of the finest LOD: the same, plus the leaf cut-out when enabled. */
  readonly fineMaterial: THREE.MeshLambertMaterial;
  readonly fineDepthMaterial: THREE.MeshDepthMaterial;

  private readonly scene: THREE.Scene;
  private readonly fineSq: number;
  private readonly lod0Sq: number;
  private readonly nearSq: number;
  private readonly farSq: number;
  private readonly farRadius: number;
  private readonly regions = new Map<number, RegionVeg>();
  private readonly geoms: (THREE.BufferGeometry | null)[] = new Array(N_MODELS * SLOTS).fill(null);
  private readonly groups: Group[] = [];
  private readonly counts = new Int32Array(N_MODELS * SLOTS);
  private readonly cursor = new Int32Array(N_MODELS * SLOTS);
  private readonly uTime = { value: 0 };
  /** Sun direction and colour for the leaf back-light, written by setLight(). */
  private readonly uSunDir = { value: new THREE.Vector3(0, 1, 0) };
  private readonly uSunColor = { value: new THREE.Color(1, 1, 1) };
  /** Every model LOD except the far boxes is built in a Web Worker (key = model * SLOTS + slot); far boxes are built synchronously. */
  private readonly queue: VegModelQueue;
  private readonly exclusions: readonly ExclusionPolygon[];
  private readonly voxel: boolean;
  private readonly textures: THREE.Texture[] = [];
  private camX = 0;
  private camZ = 0;
  private lastCx = -1e9;
  private lastCz = -1e9;
  private dirty = true;

  constructor(scene: THREE.Scene, opts: VegetationOptions) {
    this.scene = scene;
    this.exclusions = opts.exclusions ?? [];
    this.voxel = opts.voxel === true;
    this.queue = new VegModelQueue(
      () => {
        const w = new Worker(new URL('./veg.worker.ts', import.meta.url), { type: 'module' });
        w.onmessage = (e: MessageEvent<VegResponse>) => this.queue.receive(e.data);
        return { post: (req) => w.postMessage(req), terminate: () => w.terminate() };
      },
      (key, m) => {
        if (this.geoms[key] !== null) return;
        this.geoms[key] = toGeometry(m);
        this.dirty = true; // instances switch from their stand-in model on the next update
      },
      2,
      this.voxel,
    );
    const rf = opts.fineRadius ?? 40;
    const r0 = Math.max(rf, opts.lod0Radius ?? (opts.nearRadius < 200 ? 40 : 70));
    this.fineSq = rf * rf;
    this.lod0Sq = r0 * r0;
    this.nearSq = opts.nearRadius * opts.nearRadius;
    this.farRadius = opts.farRadius;
    this.farSq = opts.farRadius * opts.farRadius;
    for (let i = 0; i < N_MODELS * SLOTS; i++) this.groups.push({ mesh: null, white: null, capacity: 0, tris: 0 });

    this.material = new THREE.MeshLambertMaterial({ vertexColors: true });
    const uTime = this.uTime;
    this.depthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    const swayProject = `vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
  mvPosition = instanceMatrix * mvPosition;
#endif
  mvPosition = modelMatrix * mvPosition;
  {
    vec2 ip = ( modelMatrix * vec4( instanceMatrix[3].xyz, 1.0 ) ).xz;
    float phase = dot( ip, vec2( 0.07, 0.11 ) );
    mvPosition.xz += sway * 0.18 * vec2( sin( uTime * 1.7 + phase ), cos( uTime * 1.3 + phase * 1.3 ) );
    mvPosition.xz += vec2( sway * 0.04 * sin( uTime * 7.0 + phase * 3.0 ) );
  }
  mvPosition = viewMatrix * mvPosition;
  gl_Position = projectionMatrix * mvPosition;`;
    const patch = (shader: THREE.WebGLProgramParametersWithUniforms): void => {
      shader.uniforms.uTime = uTime;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float sway;\nuniform float uTime;')
        .replace('#include <project_vertex>', swayProject);
    };
    this.material.onBeforeCompile = patch;
    this.depthMaterial.onBeforeCompile = patch;

    this.fineMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.fineDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    if (!this.voxel) {
      // Summer leaf cards: procedural texture arrays for bark and an alpha-tested leaf cluster.
      // No KTX2 file — a Basis transcoder would be another runtime binary (CONSTITUTION Art. 1 and Art. 8).
      const bark = makeBarkArrayTexture();
      const leaf = makeLeafArrayTexture();
      this.textures.push(bark, leaf);
      const uBarkArr = { value: bark };
      const uLeafArr = { value: leaf };
      const uSunDir = this.uSunDir;
      const uSunColor = this.uSunColor;
      for (const mat of [this.material, this.depthMaterial, this.fineMaterial, this.fineDepthMaterial]) mat.side = THREE.DoubleSide;
      // World position after the sway, so the back-light matches the card actually drawn.
      const cardProject = swayProject.replace(
        'mvPosition = viewMatrix * mvPosition;',
        'vWorldPos = mvPosition.xyz;\n  mvPosition = viewMatrix * mvPosition;',
      );
      const patchCards = (colorPass: boolean) => (shader: THREE.WebGLProgramParametersWithUniforms): void => {
        shader.uniforms.uTime = uTime;
        shader.uniforms.uBarkArr = uBarkArr;
        shader.uniforms.uLeafArr = uLeafArr;
        shader.uniforms.uSunDir = uSunDir;
        shader.uniforms.uSunColor = uSunColor;
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', CARD_VERTEX_COMMON)
          .replace('#include <project_vertex>', `${CARD_PROJECT}${cardProject}`);
        shader.fragmentShader = shader.fragmentShader.replace('#include <common>', CARD_FRAGMENT_COMMON);
        if (colorPass) {
          shader.fragmentShader = shader.fragmentShader
            .replace('#include <color_fragment>', CARD_COLOR_FRAGMENT)
            .replace('#include <normal_fragment_begin>', CARD_NORMAL_FRAGMENT)
            .replace('#include <emissivemap_fragment>', CARD_EMISSIVE_FRAGMENT);
        } else {
          shader.fragmentShader = shader.fragmentShader.replace('#include <clipping_planes_fragment>', CARD_DEPTH_FRAGMENT);
        }
      };
      this.material.onBeforeCompile = patchCards(true);
      this.fineMaterial.onBeforeCompile = patchCards(true);
      this.depthMaterial.onBeforeCompile = patchCards(false);
      this.fineDepthMaterial.onBeforeCompile = patchCards(false);
    } else if (opts.leafCutout !== true) {
      this.fineMaterial.onBeforeCompile = patch;
      this.fineDepthMaterial.onBeforeCompile = patch;
    } else {
      // finest voxel LOD: same sway, plus ~5 cm leaf holes keyed on the (un-swayed) world position
      const patchFine = (fade: boolean) => (shader: THREE.WebGLProgramParametersWithUniforms): void => {
        patch(shader);
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nattribute float leaf;\nvarying float vLeaf;\nvarying vec3 vWp;')
          .replace('mvPosition = modelMatrix * mvPosition;', 'mvPosition = modelMatrix * mvPosition;\n  vWp = mvPosition.xyz;\n  vLeaf = leaf;');
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nvarying float vLeaf;\nvarying vec3 vWp;')
          .replace(
            '#include <clipping_planes_fragment>',
            `#include <clipping_planes_fragment>
  if ( vLeaf > 0.5 ${fade ? '&& distance( vWp, cameraPosition ) < 26.0' : ''} ) {
    vec3 hc = floor( vWp * 20.0 );
    if ( fract( sin( dot( hc, vec3( 12.9898, 78.233, 37.719 ) ) ) * 43758.5453 ) < 0.15 ) discard;
  }`,
          );
      };
      this.fineMaterial.onBeforeCompile = patchFine(true);
      this.fineDepthMaterial.onBeforeCompile = patchFine(false);
    }
  }

  /** Adds (or, with null features, removes) a region's vegetation. `cells` provides ground heights. */
  setRegion(rx: number, rz: number, features: Feature[] | null, cells?: Uint8Array): void {
    const key = rz * 4096 + rx;
    if (this.regions.delete(key)) this.dirty = true;
    if (features === null || cells === undefined) return;
    let n = 0;
    for (const f of features) {
      if (f.type !== FEATURE_TREE && f.type !== FEATURE_BUSH) continue;
      const x = rx * REGION_M + (f.x + 0.5 + jitterX(f.seed)) * VOXEL;
      const z = rz * REGION_M + (f.z + 0.5 + jitterZ(f.seed)) * VOXEL;
      if (this.inExclusion(x, z)) continue;
      n++;
    }
    if (n === 0) return;
    const r: RegionVeg = {
      rx, rz, count: n,
      x: new Float32Array(n), y: new Float32Array(n), z: new Float32Array(n),
      scale: new Float32Array(n), rot: new Uint8Array(n), tint: new Float32Array(n * 3),
      model: new Uint8Array(n), white: new Uint8Array(n), slot: new Int8Array(n).fill(-1), trees: 0,
    };
    const plane = REGION * REGION;
    const col = new THREE.Color();
    let i = 0;
    for (const f of features) {
      const isBush = f.type === FEATURE_BUSH;
      if (!isBush && f.type !== FEATURE_TREE) continue;
      const s = f.seed;
      r.x[i] = rx * REGION_M + (f.x + 0.5 + jitterX(s)) * VOXEL;
      r.z[i] = rz * REGION_M + (f.z + 0.5 + jitterZ(s)) * VOXEL;
      if (this.inExclusion(r.x[i]!, r.z[i]!)) continue;
      const ci = f.z * REGION + f.x;
      r.y[i] = (cells[F_GROUND_H * plane + ci]! + cells[F_STRUCT_H * plane + ci]!) * VOXEL;
      let sc = 0.8 + (((s >> 2) & 15) / 15) * 0.45;
      if (isBush) sc *= 0.75 + 0.25 * Math.max(1, Math.min(3, f.param));
      r.scale[i] = sc;
      r.rot[i] = s & 3;
      // hue +-0.03, lightness +-10% from the seed, as a multiplier on the model colours
      const h = (((s * 73 + 5) & 255) / 255 * 2 - 1) * 0.03;
      const l = 1 + (((s * 151 + 29) & 255) / 255 * 2 - 1) * 0.1;
      col.setRGB(l * (1 + h * 3), l, l * (1 - h * 3));
      r.tint[i * 3] = col.r; r.tint[i * 3 + 1] = col.g; r.tint[i * 3 + 2] = col.b;
      const m = modelOf(f, this.voxel);
      r.model[i] = m;
      r.white[i] = whiteOf(f);
      if (m < FIRST_BUSH_MODEL) r.trees++;
      i++;
    }
    this.regions.set(key, r);
    this.dirty = true;
  }

  private inExclusion(x: number, z: number): boolean {
    for (const polygon of this.exclusions) {
      let inside = false;
      for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i]![0], zi = polygon[i]![1], xj = polygon[j]![0], zj = polygon[j]![1];
        if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
      }
      if (inside) return true;
    }
    return false;
  }

  update(cameraX: number, cameraZ: number, timeSeconds: number): void {
    this.uTime.value = timeSeconds;
    this.camX = cameraX;
    this.camZ = cameraZ;
    const cx = Math.floor(cameraX / RECOMPUTE_M);
    const cz = Math.floor(cameraZ / RECOMPUTE_M);
    if (cx !== this.lastCx || cz !== this.lastCz || this.dirty) {
      this.lastCx = cx;
      this.lastCz = cz;
      this.dirty = false;
      this.rebuild();
    }
  }

  /** Share of "dense" (1 = 40 trees) within 60 m of (x, z); cheap enough to call a few times per second. */
  treeDensity(x: number, z: number): number {
    let n = 0;
    const R2 = 60 * 60;
    for (const r of this.regions.values()) {
      const x0 = r.rx * REGION_M, z0 = r.rz * REGION_M;
      if (x < x0 - 60 || x > x0 + REGION_M + 60 || z < z0 - 60 || z > z0 + REGION_M + 60) continue;
      for (let i = 0; i < r.count; i++) {
        if (r.model[i]! >= FIRST_BUSH_MODEL) continue;
        const dx = r.x[i]! - x, dz = r.z[i]! - z;
        if (dx * dx + dz * dz < R2) n++;
      }
    }
    return Math.min(1, n / 40);
  }

  /** Sun direction (world space, towards the light) and linear colour for the leaf translucency. */
  setLight(dir: THREE.Vector3, color: THREE.Color): void {
    this.uSunDir.value.copy(dir);
    this.uSunColor.value.copy(color);
  }

  dispose(): void {
    for (const g of this.groups) {
      if (g.mesh !== null) {
        this.scene.remove(g.mesh);
        g.mesh.dispose();
        g.mesh = null;
      }
    }
    for (const g of this.geoms) g?.dispose();
    this.regions.clear();
    this.queue.dispose();
    this.material.dispose();
    this.depthMaterial.dispose();
    this.fineMaterial.dispose();
    this.fineDepthMaterial.dispose();
    for (const tex of this.textures) tex.dispose();
  }

  // ---------------------------------------------------------------- internals

  private geometry(model: number, slot: number): THREE.BufferGeometry {
    const gi = model * SLOTS + slot;
    let g = this.geoms[gi];
    if (g) return g;
    // only the far box (slot 3) is built here; the other slots arrive from the worker (see rebuild)
    g = toGeometry(buildModel(SPECIES_LIST[Math.floor(model / VARIANTS)]!, model % VARIANTS, LOD_OF_SLOT[slot]!, this.voxel));
    this.geoms[gi] = g;
    return g;
  }

  private ensureMesh(gi: number, need: number): THREE.InstancedMesh {
    const grp = this.groups[gi]!;
    if (grp.mesh !== null && grp.capacity >= need) return grp.mesh;
    if (grp.mesh !== null) {
      this.scene.remove(grp.mesh);
      grp.mesh.dispose();
    }
    const cap = Math.max(64, Math.ceil(need * 1.5));
    const fine = gi % SLOTS === 0;
    const geometry = this.geometry(Math.floor(gi / SLOTS), gi % SLOTS);
    // Capacity grew: replace the whitewash attribute. deleteAttribute alone keeps the old GL buffer alive;
    // disposing the group's own geometry frees it, and the geometry re-uploads on the next draw.
    if (grp.white !== null) {
      geometry.deleteAttribute('aWhite');
      geometry.dispose();
    }
    const mesh = new THREE.InstancedMesh(geometry, fine ? this.fineMaterial : this.material, cap);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    const white = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
    geometry.setAttribute('aWhite', white);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    white.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false; // one mesh spans every loaded region
    mesh.matrixAutoUpdate = false;
    // fine, 0.5 m and mid cast and receive; far boxes only receive
    mesh.castShadow = gi % SLOTS !== SLOTS - 1;
    mesh.receiveShadow = true;
    mesh.customDepthMaterial = fine ? this.fineDepthMaterial : this.depthMaterial;
    this.scene.add(mesh);
    grp.mesh = mesh;
    grp.white = white;
    grp.capacity = cap;
    grp.tris = geometry.index!.count / 3;
    return mesh;
  }

  /** Re-assigns an LOD to every instance around the camera and refills the instance buffers. */
  private rebuild(): void {
    const { camX, camZ, fineSq, lod0Sq, nearSq, farSq, voxel } = this;
    const counts = this.counts;
    counts.fill(0);
    const reach = this.farRadius + REGION_M * 1.5;
    let near = 0, fine = 0, total = 0;
    this.queue.reprioritize();
    // pass 1: LOD per instance and group sizes
    for (const r of this.regions.values()) {
      const cxm = (r.rx + 0.5) * REGION_M - camX, czm = (r.rz + 0.5) * REGION_M - camZ;
      const skip = cxm * cxm + czm * czm > reach * reach;
      for (let i = 0; i < r.count; i++) {
        if (skip) { r.slot[i] = -1; continue; }
        const dx = r.x[i]! - camX, dz = r.z[i]! - camZ;
        const d2 = dx * dx + dz * dz;
        let s = d2 < fineSq ? 0 : d2 < lod0Sq ? 1 : d2 < nearSq ? 2 : d2 < farSq ? 3 : -1;
        // models are built in a worker, nearest first; until the wanted LOD arrives the next coarser one that
        // exists stands in (finally the far box, built on demand), so nothing pops out of existence
        const m = r.model[i]!;
        if (s >= 0 && s < 3 && this.geoms[groupOf(m, s, voxel)] === null) {
          const gm = !voxel && s >= 2 ? baseModel(m) : m;
          this.queue.request(groupOf(m, s, voxel), SPECIES_LIST[Math.floor(gm / VARIANTS)]!, gm % VARIANTS, LOD_OF_SLOT[s]!, d2);
          do s++; while (s < 3 && this.geoms[groupOf(m, s, voxel)] === null);
        }
        r.slot[i] = s;
        if (s >= 0) counts[groupOf(m, s, voxel)]!++;
      }
    }
    // pass 2: fill
    const cursor = this.cursor;
    cursor.fill(0);
    for (let gi = 0; gi < counts.length; gi++) {
      if (counts[gi]! > 0) this.ensureMesh(gi, counts[gi]!);
    }
    for (const r of this.regions.values()) {
      for (let i = 0; i < r.count; i++) {
        const s = r.slot[i]!;
        if (s < 0) continue;
        const m = r.model[i]!;
        const gi = groupOf(m, s, voxel);
        const grp = this.groups[gi]!;
        const mesh = grp.mesh!;
        const k = cursor[gi]!++;
        const mtx = mesh.instanceMatrix.array as Float32Array;
        const sc = r.scale[i]! * slotScale(m, s, voxel);
        const rot = r.rot[i]!;
        const c = rot === 0 ? 1 : rot === 2 ? -1 : 0;
        const sn = rot === 1 ? 1 : rot === 3 ? -1 : 0;
        const o = k * 16;
        mtx[o] = c * sc; mtx[o + 1] = 0; mtx[o + 2] = -sn * sc; mtx[o + 3] = 0;
        mtx[o + 4] = 0; mtx[o + 5] = sc; mtx[o + 6] = 0; mtx[o + 7] = 0;
        mtx[o + 8] = sn * sc; mtx[o + 9] = 0; mtx[o + 10] = c * sc; mtx[o + 11] = 0;
        mtx[o + 12] = r.x[i]!; mtx[o + 13] = r.y[i]!; mtx[o + 14] = r.z[i]!; mtx[o + 15] = 1;
        const ca = mesh.instanceColor!.array as Float32Array;
        ca[k * 3] = r.tint[i * 3]!; ca[k * 3 + 1] = r.tint[i * 3 + 1]!; ca[k * 3 + 2] = r.tint[i * 3 + 2]!;
        (grp.white!.array as Float32Array)[k] = r.white[i]!;
        total++;
        if (s <= 1) near++;
        if (s === 0) fine++;
      }
    }
    let tris = 0;
    for (let gi = 0; gi < this.groups.length; gi++) {
      const g = this.groups[gi]!;
      if (g.mesh === null) continue;
      const n = cursor[gi]!;
      g.mesh.count = n;
      g.mesh.visible = n > 0;
      g.mesh.instanceMatrix.needsUpdate = true;
      g.mesh.instanceColor!.needsUpdate = true;
      g.white!.needsUpdate = true;
      tris += n * g.tris;
    }
    this.stats.instances = total;
    this.stats.near = near;
    this.stats.fine = fine;
    this.stats.triangles = tris;
  }
}

/**
 * Leaf-cluster texture array (one layer per species look). RGB is a multiplier on the vertex colour;
 * alpha is the 0.4 cut-out. Layers have a transparent border, so RepeatWrapping is safe where mid-LOD
 * cards tile the 0..2 UV range.
 */
function makeLeafArrayTexture(): THREE.DataArrayTexture {
  const size = 128;
  const tex = new THREE.DataArrayTexture(makeLeafLayers(size), size, size, LEAF_LAYERS);
  tex.colorSpace = THREE.LinearSRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

/** Bark texture array, tileable in u and v. RGB multiplies the trunk vertex colour. */
function makeBarkArrayTexture(): THREE.DataArrayTexture {
  const size = 64;
  const tex = new THREE.DataArrayTexture(makeBarkLayers(size), size, size, BARK_LAYERS);
  tex.colorSpace = THREE.LinearSRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

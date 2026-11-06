/**
 * Layers of the shared PBR material library (docs/adr/0002-realistic-buildings.md). Each layer is one slice of
 * two `sampler2DArray`s: albedo + roughness (`_ar`) and normal + AO (`_na`), from CC0 sources listed in
 * data/materials.json. Pure constants, shared by the bake, the workers and the shaders.
 *
 * Append only: a layer's index never changes, so asset files, vertex attributes and shaders stay in step.
 */
import { MAT } from './materials.ts';
import { BUILDING_MATERIAL, ROOF_MATERIAL, SURFACE } from './vector-format.ts';

export const PBR_LAYER = {
  // walls
  STUCCO_SMOOTH: 0,
  STUCCO_ROUGH: 1,
  PLASTER_PAINTED: 2,
  /** Kherson's shell limestone (ракушняк), bare or under thin lime wash. */
  LIMESTONE_SHELL: 3,
  BRICK_RED: 4,
  /** White silicate (sand-lime) brick. */
  BRICK_SILICATE: 5,
  /** Khrushchevka pebble-dash render. */
  PEBBLEDASH: 6,
  PANEL_CONCRETE: 7,
  CONCRETE: 8,
  GRANITE: 9,
  // roofs
  ROOF_TIN_SEAM: 10,
  ROOF_CLAY_TILE: 11,
  /** Corrugated asbestos-cement (шифер). */
  ROOF_ETERNIT: 12,
  ROOF_BITUMEN: 13,
  // ground
  ASPHALT: 14,
  ASPHALT_WORN: 15,
  /** Concrete pavers (behaton). */
  PAVERS_BEHATON: 16,
  SETT_GRANITE: 17,
  CONCRETE_SLABS: 18,
  GRAVEL: 19,
} as const;

export const PBR_LAYER_COUNT = 20;

/** Asset file stem of each layer, in index order: `public/assets/materials/{hi,lo}/<stem>_{ar,na}.webp`. */
export const PBR_LAYER_NAMES: readonly string[] = (() => {
  const names: string[] = [];
  for (const [k, v] of Object.entries(PBR_LAYER)) names[v] = k.toLowerCase();
  return names;
})();

/** Real-world size in metres of one texture tile, per layer (the shader divides metre UVs by it). */
export const PBR_TILE_M: readonly number[] = [
  2.0, 2.0, 2.0, 1.5, 1.0, 1.0, 1.5, 3.0, 2.0, 1.5,
  2.0, 1.5, 1.8, 3.0,
  3.0, 3.0, 1.0, 1.0, 3.0, 2.0,
];

/** Wall layer for a MAT wall-style id (20..39). Unknown ids fall back to painted plaster. */
export function wallLayer(style: number): number {
  switch (style) {
    case MAT.WALL_KHRUSH: return PBR_LAYER.PEBBLEDASH;
    case MAT.WALL_PANEL: return PBR_LAYER.PANEL_CONCRETE;
    case MAT.WALL_INDUSTRIAL:
    case MAT.WALL_GARAGE: return PBR_LAYER.CONCRETE;
    case MAT.WALL_BRICK: return PBR_LAYER.BRICK_RED;
    case MAT.WALL_STALIN:
    case MAT.WALL_PUBLIC:
    case MAT.WALL_CHURCH: return PBR_LAYER.STUCCO_SMOOTH;
    case MAT.WALL_HISTORIC:
    case MAT.WALL_HISTORIC_PINK:
    case MAT.WALL_HISTORIC_MINT:
    case MAT.WALL_HISTORIC_BLUE:
    case MAT.WALL_HISTORIC_CREAM: return PBR_LAYER.STUCCO_ROUGH;
    case MAT.WALL_MODERN: return PBR_LAYER.PLASTER_PAINTED;
    default: return PBR_LAYER.PLASTER_PAINTED;
  }
}

/** Wall layer from an explicit `BUILDING_MATERIAL` (v3), or -1 to use the style's layer. */
export function materialLayer(material: number): number {
  switch (material) {
    case BUILDING_MATERIAL.PLASTER: return PBR_LAYER.PLASTER_PAINTED;
    case BUILDING_MATERIAL.BRICK: return PBR_LAYER.BRICK_RED;
    case BUILDING_MATERIAL.SILICATE_BRICK: return PBR_LAYER.BRICK_SILICATE;
    case BUILDING_MATERIAL.CONCRETE: return PBR_LAYER.CONCRETE;
    case BUILDING_MATERIAL.PANEL: return PBR_LAYER.PANEL_CONCRETE;
    case BUILDING_MATERIAL.STONE: return PBR_LAYER.LIMESTONE_SHELL;
    default: return -1;
  }
}

/** Roof layer from an explicit `ROOF_MATERIAL` (v3), else from the MAT roof id and whether the roof is flat. */
export function roofLayer(roofMaterial: number, roofMat: number, flat: boolean): number {
  switch (roofMaterial) {
    case ROOF_MATERIAL.TIN_SEAM:
    case ROOF_MATERIAL.COPPER:
    case ROOF_MATERIAL.GOLD:
    case ROOF_MATERIAL.METAL_TILE: return PBR_LAYER.ROOF_TIN_SEAM;
    case ROOF_MATERIAL.CLAY_TILE: return PBR_LAYER.ROOF_CLAY_TILE;
    case ROOF_MATERIAL.ETERNIT: return PBR_LAYER.ROOF_ETERNIT;
    case ROOF_MATERIAL.BITUMEN: return PBR_LAYER.ROOF_BITUMEN;
    case ROOF_MATERIAL.CONCRETE: return PBR_LAYER.CONCRETE;
  }
  if (flat) return PBR_LAYER.ROOF_BITUMEN;
  if (roofMat === MAT.ROOF_RED) return PBR_LAYER.ROOF_CLAY_TILE;
  if (roofMat === MAT.ROOF_GOLD || roofMat === MAT.ROOF_GREEN) return PBR_LAYER.ROOF_TIN_SEAM;
  return PBR_LAYER.ROOF_ETERNIT;
}

/** Ground layer for a MAT ground id, or -1 when the ground keeps its procedural shading (grass, water, sand…). */
export function groundLayer(mat: number): number {
  switch (mat) {
    case MAT.ASPHALT: return PBR_LAYER.ASPHALT;
    case MAT.ASPHALT_PATCH: return PBR_LAYER.ASPHALT_WORN;
    case MAT.SIDEWALK: return PBR_LAYER.ASPHALT_WORN;
    case MAT.PAVERS:
    case MAT.PAVING: return PBR_LAYER.PAVERS_BEHATON;
    case MAT.SETT: return PBR_LAYER.SETT_GRANITE;
    case MAT.PLAZA:
    case MAT.CONCRETE_SLAB:
    case MAT.TRAM_BED: return PBR_LAYER.CONCRETE_SLABS;
    case MAT.GRANITE:
    case MAT.KERB: return PBR_LAYER.GRANITE;
    case MAT.RAIL: return PBR_LAYER.GRAVEL;
    default: return -1;
  }
}

/** Ground MAT id for a road `SURFACE` (v3); `fallback` for untagged or unknown surfaces. */
export function surfaceMat(surface: number, fallback: number): number {
  switch (surface) {
    case SURFACE.ASPHALT: return MAT.ASPHALT;
    case SURFACE.CONCRETE:
    case SURFACE.CONCRETE_PLATES: return MAT.CONCRETE_SLAB;
    case SURFACE.PAVING_STONES: return MAT.PAVERS;
    case SURFACE.SETT:
    case SURFACE.COBBLESTONE: return MAT.SETT;
    case SURFACE.COMPACTED:
    case SURFACE.GRAVEL:
    case SURFACE.DIRT: return MAT.DIRT;
    default: return fallback;
  }
}

import { describe, expect, it } from 'vitest';
import { MAT } from '../src/world/materials.ts';
import {
  groundLayer, materialLayer, PBR_LAYER, PBR_LAYER_COUNT, PBR_LAYER_NAMES, PBR_TILE_M, roofLayer, surfaceMat, wallLayer,
} from '../src/world/pbr-layers.ts';
import { BUILDING_MATERIAL, ROOF_MATERIAL, SURFACE } from '../src/world/vector-format.ts';
import { buildingKey, osmKey, parseOsmKey } from '../src/world/osm-ref.ts';

const valid = (l: number) => Number.isInteger(l) && l >= 0 && l < PBR_LAYER_COUNT;

describe('PBR layer table', () => {
  it('has dense, unique indices with a name and a tile size each', () => {
    const idx = Object.values(PBR_LAYER).sort((a, b) => a - b);
    expect(idx).toEqual(Array.from({ length: PBR_LAYER_COUNT }, (_, i) => i));
    expect(PBR_LAYER_NAMES).toHaveLength(PBR_LAYER_COUNT);
    expect(new Set(PBR_LAYER_NAMES).size).toBe(PBR_LAYER_COUNT);
    expect(PBR_LAYER_NAMES[PBR_LAYER.LIMESTONE_SHELL]).toBe('limestone_shell');
    expect(PBR_TILE_M).toHaveLength(PBR_LAYER_COUNT);
    for (const m of PBR_TILE_M) expect(m).toBeGreaterThan(0.25);
  });

  it('maps every wall style and explicit material to a wall layer', () => {
    for (let s = 20; s <= 39; s++) expect(valid(wallLayer(s))).toBe(true);
    expect(wallLayer(MAT.WALL_KHRUSH)).toBe(PBR_LAYER.PEBBLEDASH);
    expect(materialLayer(BUILDING_MATERIAL.UNKNOWN)).toBe(-1);
    expect(materialLayer(BUILDING_MATERIAL.SILICATE_BRICK)).toBe(PBR_LAYER.BRICK_SILICATE);
    expect(materialLayer(BUILDING_MATERIAL.STONE)).toBe(PBR_LAYER.LIMESTONE_SHELL);
  });

  it('picks roof layers from roof:material first, then the roof colour and shape', () => {
    expect(roofLayer(ROOF_MATERIAL.ETERNIT, MAT.ROOF_RED, false)).toBe(PBR_LAYER.ROOF_ETERNIT);
    expect(roofLayer(ROOF_MATERIAL.UNKNOWN, MAT.ROOF_GREY, true)).toBe(PBR_LAYER.ROOF_BITUMEN);
    expect(roofLayer(ROOF_MATERIAL.UNKNOWN, MAT.ROOF_RED, false)).toBe(PBR_LAYER.ROOF_CLAY_TILE);
    expect(roofLayer(ROOF_MATERIAL.UNKNOWN, MAT.ROOF_GREEN, false)).toBe(PBR_LAYER.ROOF_TIN_SEAM);
    for (let r = 0; r <= 8; r++) expect(valid(roofLayer(r, MAT.ROOF_GREY, false))).toBe(true);
  });

  it('maps road and paving materials to ground layers and leaves natural ground procedural', () => {
    for (const m of [MAT.ASPHALT, MAT.SIDEWALK, MAT.PAVING, MAT.PLAZA, MAT.KERB, MAT.SETT, MAT.PAVERS,
      MAT.CONCRETE_SLAB, MAT.ASPHALT_PATCH, MAT.GRANITE, MAT.TRAM_BED]) {
      expect(valid(groundLayer(m))).toBe(true);
    }
    for (const m of [MAT.GRASS, MAT.WATER, MAT.SAND, MAT.PARK, MAT.FOREST, MAT.MARKING]) expect(groundLayer(m)).toBe(-1);
    expect(surfaceMat(SURFACE.SETT, MAT.ASPHALT)).toBe(MAT.SETT);
    expect(surfaceMat(SURFACE.PAVING_STONES, MAT.ASPHALT)).toBe(MAT.PAVERS);
    expect(surfaceMat(SURFACE.UNKNOWN, MAT.ASPHALT)).toBe(MAT.ASPHALT);
    expect(surfaceMat(SURFACE.OTHER, MAT.SIDEWALK)).toBe(MAT.SIDEWALK);
  });
});

describe('OSM references', () => {
  it('round trips keys and matches vector-tile buildings', () => {
    expect(osmKey({ type: 'way', id: 116810729 })).toBe('w116810729');
    expect(osmKey({ type: 'relation', id: 2168547 })).toBe('r2168547');
    expect(parseOsmKey('r2168547')).toEqual({ type: 'relation', id: 2168547 });
    expect(parseOsmKey('w0')).toBeNull();
    expect(parseOsmKey('n5')).toBeNull();
    expect(parseOsmKey('w12x')).toBeNull();
    expect(buildingKey(116810729)).toBe('w116810729');
    expect(buildingKey(2168547, 1)).toBe('r2168547');
  });
});

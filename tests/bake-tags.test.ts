import { describe, expect, it } from 'vitest';
import {
  hasCycleLane, parseBuildingMaterial, parseColour, parseRoofMaterial, parseStartYear, parseSurface,
} from '../tools/bake/tags';
import {
  BUILDING_MATERIAL, ROOF_MATERIAL, SURFACE,
} from '../src/world/vector-format';

describe('parseColour', () => {
  it('parses #rgb and #rrggbb hex, with or without the hash and in any case', () => {
    expect(parseColour('#fff')).toBe(0xffffff + 1);
    expect(parseColour('F00')).toBe(0xff0000 + 1);
    expect(parseColour('#8B0000')).toBe(0x8b0000 + 1);
    expect(parseColour('a9c6e0')).toBe(0xa9c6e0 + 1);
    expect(parseColour('#00ff00')).toBe(0x00ff00 + 1);
  });

  it('parses the named CSS colours used by OSM', () => {
    expect(parseColour('white')).toBe(0xffffff + 1);
    expect(parseColour('black')).toBe(0x000000 + 1);
    expect(parseColour('grey')).toBe(0x808080 + 1);
    expect(parseColour('gray')).toBe(0x808080 + 1);
    expect(parseColour('lightgrey')).toBe(0xd3d3d3 + 1);
    expect(parseColour('lightgray')).toBe(0xd3d3d3 + 1);
    expect(parseColour('darkgrey')).toBe(0xa9a9a9 + 1);
    expect(parseColour('darkgray')).toBe(0xa9a9a9 + 1);
    expect(parseColour('silver')).toBe(0xc0c0c0 + 1);
    expect(parseColour('red')).toBe(0xff0000 + 1);
    expect(parseColour('darkred')).toBe(0x8b0000 + 1);
    expect(parseColour('maroon')).toBe(0x800000 + 1);
    expect(parseColour('brown')).toBe(0xa52a2a + 1);
    expect(parseColour('beige')).toBe(0xf5f5dc + 1);
    expect(parseColour('cream')).toBe(0xfffdd0 + 1);
    expect(parseColour('ivory')).toBe(0xfffff0 + 1);
    expect(parseColour('yellow')).toBe(0xffff00 + 1);
    expect(parseColour('lightyellow')).toBe(0xffffe0 + 1);
    expect(parseColour('gold')).toBe(0xffd700 + 1);
    expect(parseColour('orange')).toBe(0xffa500 + 1);
    expect(parseColour('pink')).toBe(0xffc0cb + 1);
    expect(parseColour('salmon')).toBe(0xfa8072 + 1);
    expect(parseColour('peach')).toBe(0xffe5b4 + 1);
    expect(parseColour('green')).toBe(0x008000 + 1);
    expect(parseColour('lightgreen')).toBe(0x90ee90 + 1);
    expect(parseColour('darkgreen')).toBe(0x006400 + 1);
    expect(parseColour('olive')).toBe(0x808000 + 1);
    expect(parseColour('teal')).toBe(0x008080 + 1);
    expect(parseColour('turquoise')).toBe(0x40e0d0 + 1);
    expect(parseColour('blue')).toBe(0x0000ff + 1);
    expect(parseColour('lightblue')).toBe(0xadd8e6 + 1);
    expect(parseColour('skyblue')).toBe(0x87ceeb + 1);
    expect(parseColour('navy')).toBe(0x000080 + 1);
    expect(parseColour('purple')).toBe(0x800080 + 1);
    expect(parseColour('violet')).toBe(0xee82ee + 1);
  });

  it('takes the first value of a semicolon list and trims whitespace', () => {
    expect(parseColour(' red ; blue ')).toBe(0xff0000 + 1);
    expect(parseColour('#fff;#000')).toBe(0xffffff + 1);
    expect(parseColour('white;')).toBe(0xffffff + 1);
  });

  it('returns 0 for unknown or malformed values', () => {
    expect(parseColour(undefined)).toBe(0);
    expect(parseColour('')).toBe(0);
    expect(parseColour('chartreuse')).toBe(0);
    expect(parseColour('#12345')).toBe(0);
    expect(parseColour('#gggggg')).toBe(0);
    expect(parseColour(';')).toBe(0);
  });
});

describe('parseBuildingMaterial', () => {
  it('maps the plaster family', () => {
    expect(parseBuildingMaterial({ 'building:material': 'plaster' })).toBe(BUILDING_MATERIAL.PLASTER);
    expect(parseBuildingMaterial({ 'building:material': 'stucco' })).toBe(BUILDING_MATERIAL.PLASTER);
    expect(parseBuildingMaterial({ 'building:material': 'render' })).toBe(BUILDING_MATERIAL.PLASTER);
  });

  it('maps brick and silicate brick', () => {
    expect(parseBuildingMaterial({ 'building:material': 'brick' })).toBe(BUILDING_MATERIAL.BRICK);
    expect(parseBuildingMaterial({ 'building:material': 'silicate_brick' })).toBe(BUILDING_MATERIAL.SILICATE_BRICK);
    expect(parseBuildingMaterial({ 'building:material': 'sand_lime_brick' })).toBe(BUILDING_MATERIAL.SILICATE_BRICK);
    expect(parseBuildingMaterial({ 'building:material': 'limestone_brick' })).toBe(BUILDING_MATERIAL.SILICATE_BRICK);
  });

  it('maps concrete and panels', () => {
    expect(parseBuildingMaterial({ 'building:material': 'concrete' })).toBe(BUILDING_MATERIAL.CONCRETE);
    expect(parseBuildingMaterial({ 'building:material': 'reinforced_concrete' })).toBe(BUILDING_MATERIAL.CONCRETE);
    expect(parseBuildingMaterial({ 'building:material': 'panel' })).toBe(BUILDING_MATERIAL.PANEL);
    expect(parseBuildingMaterial({ 'building:material': 'panels' })).toBe(BUILDING_MATERIAL.PANEL);
    expect(parseBuildingMaterial({ 'building:material': 'concrete_panel' })).toBe(BUILDING_MATERIAL.PANEL);
    expect(parseBuildingMaterial({ 'building:material': 'prefabricated' })).toBe(BUILDING_MATERIAL.PANEL);
  });

  it('maps the stone family, including shell limestone', () => {
    for (const v of ['stone', 'limestone', 'sandstone', 'shell_limestone', 'shell_rock', 'rock']) {
      expect(parseBuildingMaterial({ 'building:material': v })).toBe(BUILDING_MATERIAL.STONE);
    }
  });

  it('maps glass, wood and metal', () => {
    expect(parseBuildingMaterial({ 'building:material': 'glass' })).toBe(BUILDING_MATERIAL.GLASS);
    expect(parseBuildingMaterial({ 'building:material': 'mirror' })).toBe(BUILDING_MATERIAL.GLASS);
    expect(parseBuildingMaterial({ 'building:material': 'wood' })).toBe(BUILDING_MATERIAL.WOOD);
    expect(parseBuildingMaterial({ 'building:material': 'timber_framing' })).toBe(BUILDING_MATERIAL.WOOD);
    expect(parseBuildingMaterial({ 'building:material': 'log' })).toBe(BUILDING_MATERIAL.WOOD);
    expect(parseBuildingMaterial({ 'building:material': 'metal' })).toBe(BUILDING_MATERIAL.METAL);
    expect(parseBuildingMaterial({ 'building:material': 'steel' })).toBe(BUILDING_MATERIAL.METAL);
    expect(parseBuildingMaterial({ 'building:material': 'metal_plates' })).toBe(BUILDING_MATERIAL.METAL);
  });

  it('falls back to building:facade:material and prefers building:material', () => {
    expect(parseBuildingMaterial({ 'building:facade:material': 'brick' })).toBe(BUILDING_MATERIAL.BRICK);
    expect(parseBuildingMaterial({ 'building:material': 'wood', 'building:facade:material': 'brick' }))
      .toBe(BUILDING_MATERIAL.WOOD);
  });

  it('returns 0 for unknown or missing values', () => {
    expect(parseBuildingMaterial({})).toBe(BUILDING_MATERIAL.UNKNOWN);
    expect(parseBuildingMaterial({ 'building:material': 'unobtainium' })).toBe(BUILDING_MATERIAL.UNKNOWN);
    expect(parseBuildingMaterial({ 'building:material': '' })).toBe(BUILDING_MATERIAL.UNKNOWN);
  });
});

describe('parseRoofMaterial', () => {
  it('maps the sheet-metal family', () => {
    for (const v of ['metal', 'tin', 'metal_sheet', 'sheet_metal', 'zinc', 'steel']) {
      expect(parseRoofMaterial({ 'roof:material': v })).toBe(ROOF_MATERIAL.TIN_SEAM);
    }
  });

  it('maps clay tiles', () => {
    for (const v of ['roof_tiles', 'tiles', 'tile', 'clay', 'clay_tiles']) {
      expect(parseRoofMaterial({ 'roof:material': v })).toBe(ROOF_MATERIAL.CLAY_TILE);
    }
  });

  it('maps eternit and slate to asbestos cement', () => {
    for (const v of ['eternit', 'asbestos', 'slate', 'asbestos_cement']) {
      expect(parseRoofMaterial({ 'roof:material': v })).toBe(ROOF_MATERIAL.ETERNIT);
    }
  });

  it('maps bitumen roofs', () => {
    for (const v of ['tar_paper', 'asphalt', 'bitumen', 'roofing_felt', 'asphalt_shingle']) {
      expect(parseRoofMaterial({ 'roof:material': v })).toBe(ROOF_MATERIAL.BITUMEN);
    }
  });

  it('maps concrete, copper, gold and metal tiles', () => {
    expect(parseRoofMaterial({ 'roof:material': 'concrete' })).toBe(ROOF_MATERIAL.CONCRETE);
    expect(parseRoofMaterial({ 'roof:material': 'copper' })).toBe(ROOF_MATERIAL.COPPER);
    expect(parseRoofMaterial({ 'roof:material': 'gold' })).toBe(ROOF_MATERIAL.GOLD);
    expect(parseRoofMaterial({ 'roof:material': 'metal_tiles' })).toBe(ROOF_MATERIAL.METAL_TILE);
    expect(parseRoofMaterial({ 'roof:material': 'metal_tile' })).toBe(ROOF_MATERIAL.METAL_TILE);
  });

  it('returns 0 for unknown or missing values', () => {
    expect(parseRoofMaterial({})).toBe(ROOF_MATERIAL.UNKNOWN);
    expect(parseRoofMaterial({ 'roof:material': 'thatch' })).toBe(ROOF_MATERIAL.UNKNOWN);
    expect(parseRoofMaterial({ 'roof:material': '' })).toBe(ROOF_MATERIAL.UNKNOWN);
  });
});

describe('parseStartYear', () => {
  it('takes the first 4-digit year in 1700..2030', () => {
    expect(parseStartYear('1891')).toBe(1891);
    expect(parseStartYear('~1891')).toBe(1891);
    expect(parseStartYear('1890s')).toBe(1890);
    expect(parseStartYear('1891-05-01')).toBe(1891);
    expect(parseStartYear('before 1917')).toBe(1917);
    expect(parseStartYear('built 1901, rebuilt 1950')).toBe(1901);
    expect(parseStartYear('1700')).toBe(1700);
    expect(parseStartYear('2030')).toBe(2030);
  });

  it('maps centuries to their midpoint', () => {
    expect(parseStartYear('C19')).toBe(1850);
    expect(parseStartYear('c19')).toBe(1850);
    expect(parseStartYear('19th century')).toBe(1850);
    expect(parseStartYear('C20')).toBe(1950);
    expect(parseStartYear('20th century')).toBe(1950);
    expect(parseStartYear('built C19')).toBe(1850);
  });

  it('returns 0 for missing or out-of-range values', () => {
    expect(parseStartYear(undefined)).toBe(0);
    expect(parseStartYear('')).toBe(0);
    expect(parseStartYear('old')).toBe(0);
    expect(parseStartYear('1500')).toBe(0);
    expect(parseStartYear('2031')).toBe(0);
    expect(parseStartYear('C21')).toBe(0);
  });
});

describe('parseSurface', () => {
  it('maps asphalt, concrete and concrete plates', () => {
    expect(parseSurface('asphalt')).toBe(SURFACE.ASPHALT);
    expect(parseSurface('concrete')).toBe(SURFACE.CONCRETE);
    expect(parseSurface('concrete:plates')).toBe(SURFACE.CONCRETE_PLATES);
    expect(parseSurface('concrete:lanes')).toBe(SURFACE.CONCRETE_PLATES);
  });

  it('maps paving stones, setts and cobblestones', () => {
    expect(parseSurface('paving_stones')).toBe(SURFACE.PAVING_STONES);
    expect(parseSurface('paving_stones:30')).toBe(SURFACE.PAVING_STONES);
    expect(parseSurface('paved_stones')).toBe(SURFACE.PAVING_STONES);
    expect(parseSurface('sett')).toBe(SURFACE.SETT);
    expect(parseSurface('cobblestone')).toBe(SURFACE.COBBLESTONE);
    expect(parseSurface('unhewn_cobblestone')).toBe(SURFACE.COBBLESTONE);
    expect(parseSurface('cobblestone:flattened')).toBe(SURFACE.COBBLESTONE);
  });

  it('maps compacted, gravel and dirt', () => {
    expect(parseSurface('compacted')).toBe(SURFACE.COMPACTED);
    for (const v of ['gravel', 'fine_gravel', 'pebblestone']) expect(parseSurface(v)).toBe(SURFACE.GRAVEL);
    for (const v of ['dirt', 'ground', 'earth', 'mud', 'sand', 'grass', 'unpaved']) expect(parseSurface(v)).toBe(SURFACE.DIRT);
  });

  it('maps other paved values to OTHER and keeps the first of a list', () => {
    for (const v of ['paved', 'wood', 'metal', 'rubber', 'other']) expect(parseSurface(v)).toBe(SURFACE.OTHER);
    expect(parseSurface('asphalt;gravel')).toBe(SURFACE.ASPHALT);
  });

  it('returns UNKNOWN for missing values and OTHER for an unknown non-empty value', () => {
    expect(parseSurface(undefined)).toBe(SURFACE.UNKNOWN);
    expect(parseSurface('')).toBe(SURFACE.UNKNOWN);
    expect(parseSurface('moon_dust')).toBe(SURFACE.OTHER);
  });
});

describe('hasCycleLane', () => {
  it('accepts lane and track values on all cycleway keys', () => {
    expect(hasCycleLane({ cycleway: 'lane' })).toBe(true);
    expect(hasCycleLane({ cycleway: 'track' })).toBe(true);
    expect(hasCycleLane({ cycleway: 'opposite_lane' })).toBe(true);
    expect(hasCycleLane({ cycleway: 'opposite_track' })).toBe(true);
    expect(hasCycleLane({ 'cycleway:left': 'lane' })).toBe(true);
    expect(hasCycleLane({ 'cycleway:right': 'track' })).toBe(true);
    expect(hasCycleLane({ 'cycleway:both': 'lane' })).toBe(true);
    expect(hasCycleLane({ 'cycleway:both': 'opposite_lane;lane' })).toBe(true);
  });

  it('rejects shared lanes, no and missing values', () => {
    expect(hasCycleLane({})).toBe(false);
    expect(hasCycleLane({ cycleway: 'no' })).toBe(false);
    expect(hasCycleLane({ cycleway: 'shared_lane' })).toBe(false);
    expect(hasCycleLane({ cycleway: 'opposite' })).toBe(false);
    expect(hasCycleLane({ 'cycleway:left': 'shoulder' })).toBe(false);
    expect(hasCycleLane({ cycleway: '' })).toBe(false);
  });
});

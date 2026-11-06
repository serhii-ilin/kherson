// Pure OSM tag parsers for vector tile v3 fields (see src/world/vector-format.ts).
// No fs, no randomness: the bake stays deterministic (Constitution Article 2.3).
import { BUILDING_MATERIAL, ROOF_MATERIAL, SURFACE } from "../../src/world/vector-format.ts";
import type { Tags } from "./osm.ts";

/** CSS colours used in OSM tags. `cream` and `peach` are the values agreed in the bake spec. */
const NAMED_COLOURS: Record<string, number> = {
  white: 0xffffff,
  black: 0x000000,
  grey: 0x808080,
  gray: 0x808080,
  lightgrey: 0xd3d3d3,
  lightgray: 0xd3d3d3,
  darkgrey: 0xa9a9a9,
  darkgray: 0xa9a9a9,
  silver: 0xc0c0c0,
  red: 0xff0000,
  darkred: 0x8b0000,
  maroon: 0x800000,
  brown: 0xa52a2a,
  beige: 0xf5f5dc,
  cream: 0xfffdd0,
  ivory: 0xfffff0,
  yellow: 0xffff00,
  lightyellow: 0xffffe0,
  gold: 0xffd700,
  orange: 0xffa500,
  pink: 0xffc0cb,
  salmon: 0xfa8072,
  peach: 0xffe5b4,
  green: 0x008000,
  lightgreen: 0x90ee90,
  darkgreen: 0x006400,
  olive: 0x808000,
  teal: 0x008080,
  turquoise: 0x40e0d0,
  blue: 0x0000ff,
  lightblue: 0xadd8e6,
  skyblue: 0x87ceeb,
  navy: 0x000080,
  purple: 0x800080,
  violet: 0xee82ee,
};

const BUILDING_MATERIALS: Record<string, number> = {
  plaster: BUILDING_MATERIAL.PLASTER,
  stucco: BUILDING_MATERIAL.PLASTER,
  render: BUILDING_MATERIAL.PLASTER,
  brick: BUILDING_MATERIAL.BRICK,
  silicate_brick: BUILDING_MATERIAL.SILICATE_BRICK,
  sand_lime_brick: BUILDING_MATERIAL.SILICATE_BRICK,
  limestone_brick: BUILDING_MATERIAL.SILICATE_BRICK,
  concrete: BUILDING_MATERIAL.CONCRETE,
  reinforced_concrete: BUILDING_MATERIAL.CONCRETE,
  panel: BUILDING_MATERIAL.PANEL,
  panels: BUILDING_MATERIAL.PANEL,
  concrete_panel: BUILDING_MATERIAL.PANEL,
  prefabricated: BUILDING_MATERIAL.PANEL,
  stone: BUILDING_MATERIAL.STONE,
  limestone: BUILDING_MATERIAL.STONE,
  sandstone: BUILDING_MATERIAL.STONE,
  shell_limestone: BUILDING_MATERIAL.STONE,
  shell_rock: BUILDING_MATERIAL.STONE,
  rock: BUILDING_MATERIAL.STONE,
  glass: BUILDING_MATERIAL.GLASS,
  mirror: BUILDING_MATERIAL.GLASS,
  wood: BUILDING_MATERIAL.WOOD,
  timber_framing: BUILDING_MATERIAL.WOOD,
  log: BUILDING_MATERIAL.WOOD,
  metal: BUILDING_MATERIAL.METAL,
  steel: BUILDING_MATERIAL.METAL,
  metal_plates: BUILDING_MATERIAL.METAL,
};

const ROOF_MATERIALS: Record<string, number> = {
  metal: ROOF_MATERIAL.TIN_SEAM,
  tin: ROOF_MATERIAL.TIN_SEAM,
  metal_sheet: ROOF_MATERIAL.TIN_SEAM,
  sheet_metal: ROOF_MATERIAL.TIN_SEAM,
  zinc: ROOF_MATERIAL.TIN_SEAM,
  steel: ROOF_MATERIAL.TIN_SEAM,
  roof_tiles: ROOF_MATERIAL.CLAY_TILE,
  tiles: ROOF_MATERIAL.CLAY_TILE,
  tile: ROOF_MATERIAL.CLAY_TILE,
  clay: ROOF_MATERIAL.CLAY_TILE,
  clay_tiles: ROOF_MATERIAL.CLAY_TILE,
  eternit: ROOF_MATERIAL.ETERNIT,
  asbestos: ROOF_MATERIAL.ETERNIT,
  // In Ukrainian mapping `slate` is almost always шифер (asbestos cement), not natural slate.
  slate: ROOF_MATERIAL.ETERNIT,
  asbestos_cement: ROOF_MATERIAL.ETERNIT,
  tar_paper: ROOF_MATERIAL.BITUMEN,
  asphalt: ROOF_MATERIAL.BITUMEN,
  bitumen: ROOF_MATERIAL.BITUMEN,
  roofing_felt: ROOF_MATERIAL.BITUMEN,
  asphalt_shingle: ROOF_MATERIAL.BITUMEN,
  concrete: ROOF_MATERIAL.CONCRETE,
  copper: ROOF_MATERIAL.COPPER,
  gold: ROOF_MATERIAL.GOLD,
  metal_tiles: ROOF_MATERIAL.METAL_TILE,
  metal_tile: ROOF_MATERIAL.METAL_TILE,
};

const SURFACES: Record<string, number> = {
  asphalt: SURFACE.ASPHALT,
  concrete: SURFACE.CONCRETE,
  "concrete:plates": SURFACE.CONCRETE_PLATES,
  "concrete:lanes": SURFACE.CONCRETE_PLATES,
  paving_stones: SURFACE.PAVING_STONES,
  "paving_stones:30": SURFACE.PAVING_STONES,
  paved_stones: SURFACE.PAVING_STONES,
  sett: SURFACE.SETT,
  cobblestone: SURFACE.COBBLESTONE,
  unhewn_cobblestone: SURFACE.COBBLESTONE,
  "cobblestone:flattened": SURFACE.COBBLESTONE,
  compacted: SURFACE.COMPACTED,
  gravel: SURFACE.GRAVEL,
  fine_gravel: SURFACE.GRAVEL,
  pebblestone: SURFACE.GRAVEL,
  dirt: SURFACE.DIRT,
  ground: SURFACE.DIRT,
  earth: SURFACE.DIRT,
  mud: SURFACE.DIRT,
  sand: SURFACE.DIRT,
  grass: SURFACE.DIRT,
  unpaved: SURFACE.DIRT,
  paved: SURFACE.OTHER,
  wood: SURFACE.OTHER,
  metal: SURFACE.OTHER,
  rubber: SURFACE.OTHER,
  other: SURFACE.OTHER,
};

const CYCLE_LANE_VALUES = new Set(["lane", "track", "opposite_lane", "opposite_track"]);
const CYCLEWAY_KEYS = ["cycleway", "cycleway:left", "cycleway:right", "cycleway:both"] as const;

/** First value of a semicolon-separated OSM tag, trimmed and lower-cased. */
function firstValue(v: string | undefined): string {
  if (!v) return "";
  return (v.split(";")[0] ?? "").trim().toLowerCase();
}

/** `#rgb` / `#rrggbb` / named colour -> 0xRRGGBB + 1, or 0 when unknown (0 means "no colour"). */
export function parseColour(v?: string): number {
  const s = firstValue(v);
  if (!s) return 0;
  const named = NAMED_COLOURS[s];
  if (named !== undefined) return named + 1;
  const hex = s.startsWith("#") ? s.slice(1) : s;
  if (/^[0-9a-f]{3}$/.test(hex)) {
    const r = hex[0]!, g = hex[1]!, b = hex[2]!;
    return parseInt(`${r}${r}${g}${g}${b}${b}`, 16) + 1;
  }
  if (/^[0-9a-f]{6}$/.test(hex)) return parseInt(hex, 16) + 1;
  return 0;
}

/** `building:material`, else `building:facade:material` -> `BUILDING_MATERIAL`, or 0. */
export function parseBuildingMaterial(t: Tags): number {
  const v = firstValue(t["building:material"] ?? t["building:facade:material"]);
  return BUILDING_MATERIALS[v] ?? BUILDING_MATERIAL.UNKNOWN;
}

/** `roof:material` -> `ROOF_MATERIAL`, or 0. */
export function parseRoofMaterial(t: Tags): number {
  return ROOF_MATERIALS[firstValue(t["roof:material"])] ?? ROOF_MATERIAL.UNKNOWN;
}

/** First 4-digit year in 1700..2030, or the midpoint of C19 / C20; 0 when unknown. */
export function parseStartYear(v?: string): number {
  const s = firstValue(v);
  if (!s) return 0;
  if (/\bc19\b/.test(s) || /\b19th\s+century\b/.test(s)) return 1850;
  if (/\bc20\b/.test(s) || /\b20th\s+century\b/.test(s)) return 1950;
  for (const m of s.matchAll(/\d{4}/g)) {
    const year = parseInt(m[0], 10);
    if (year >= 1700 && year <= 2030) return year;
  }
  return 0;
}

/** OSM `surface` -> `SURFACE`; 0 when untagged, `OTHER` for any other non-empty value. */
export function parseSurface(v?: string): number {
  const s = firstValue(v);
  if (!s) return SURFACE.UNKNOWN;
  const known = SURFACES[s];
  if (known !== undefined) return known;
  // `paving_stones:NN` / `cobblestone:*` variants beyond the two named above.
  if (s.startsWith("paving_stones:")) return SURFACE.PAVING_STONES;
  if (s.startsWith("cobblestone:")) return SURFACE.COBBLESTONE;
  return SURFACE.OTHER;
}

/** True when any `cycleway*` key names a lane or track (not a shared or advisory lane). */
export function hasCycleLane(t: Tags): boolean {
  for (const key of CYCLEWAY_KEYS) {
    const v = t[key];
    if (!v) continue;
    for (const part of v.split(";")) {
      if (CYCLE_LANE_VALUES.has(part.trim().toLowerCase())) return true;
    }
  }
  return false;
}

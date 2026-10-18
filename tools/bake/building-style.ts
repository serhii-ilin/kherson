import { VOXEL } from "../../src/world/constants.ts";
import { HISTORIC_WALLS, HOUSE_WALLS, MAT, PALETTE } from "../../src/world/materials.ts";
import type { Tags } from "./osm.ts";

export function hash(a: number, b = 0): number {
  let h = Math.imul(a | 0, 0x9e3779b1) ^ Math.imul((b | 0) + 0x7f4a7c15, 0x85ebca6b);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return h >>> 0;
}

export function parseNum(v: string | undefined): number | null {
  if (!v) return null;
  const n = parseFloat(v.replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Radius around Freedom Square (m) inside which low buildings read as pre-1917 centre. */
export const HISTORIC_RADIUS = 1300;
/** Radius (m) inside which mid-rise apartment blocks may be Stalin-era. */
export const STALIN_RADIUS = 2200;

export interface BuildingSpec {
  h: number;
  /** Exact height in metres (before voxel rounding). */
  hm: number;
  /** Storeys used by the fine facade generator. */
  levels: number;
  /** True when the height/storeys were filled from the deterministic heuristic. */
  heightHeuristic: boolean;
  wall: number;
  roof: number;
  /** Style name, for bake statistics. */
  style: string;
}

const NAMED_COLOURS: Record<string, number> = {
  white: 0xf0f0f0, cream: 0xeadfc2, beige: 0xe0d2b0, yellow: 0xe6cf86, pink: 0xdba7a0, red: 0xc06050,
  green: 0xa9d2b4, mint: 0xa9d2b4, blue: 0xa9c6e0, lightblue: 0xa9c6e0, brown: 0x9a7b5a, grey: 0xb0b0b0, gray: 0xb0b0b0,
};

/** Nearest of `variants` (palette ids) to an OSM building:colour, or -1 when unparseable. */
export function nearestVariant(colour: string | undefined, variants: readonly number[]): number {
  if (!colour) return -1;
  const c = colour.trim().toLowerCase();
  let rgb = NAMED_COLOURS[c];
  if (rgb === undefined && /^#[0-9a-f]{6}$/.test(c)) rgb = parseInt(c.slice(1), 16);
  if (rgb === undefined) return -1;
  let best = -1, bd = Infinity;
  for (const m of variants) {
    const dr = ((rgb >> 16) & 255) - PALETTE[m * 3]!;
    const dg = ((rgb >> 8) & 255) - PALETTE[m * 3 + 1]!;
    const db = (rgb & 255) - PALETTE[m * 3 + 2]!;
    const d = dr * dr + dg * dg + db * db;
    if (d < bd) { bd = d; best = m; }
  }
  return best;
}

const SMALL_YES_M2 = 250;
const SMALL_DETACHED_M2 = 150;
const HOUSE_TYPES = new Set(["house", "detached", "semidetached_house", "bungalow", "terrace", "farm"]);
const FLAT_TYPES = new Set(["apartments", "residential", "dormitory"]);
const SHOP_TYPES = new Set(["commercial", "retail", "office", "supermarket", "mall", "hotel", "kiosk"]);
const HISTORIC_TYPES = new Set(["yes", "house", "commercial", "retail", "residential"]);

/**
 * Picks height, wall style and roof of one OSM building.
 *
 * Generic, deterministic fill per Constitution Article 2.1 (no per-address data): explicit tags win
 * (`building:architecture`, `building:levels`, `building:colour`); otherwise the building type, the
 * levels/height and the distance `centreDist` (m) from the Freedom Square spawn decide:
 *  - worship -> church; garage/garages -> garage; industrial/warehouse -> industrial;
 *  - flats with >= 7 levels or >= 20 m -> panel block; mid-rise flats near the centre are Stalin-era
 *    for a third of them (hash); other flats (<= 5 levels or untagged) -> khrushchevka;
 *  - <= 3 levels within HISTORIC_RADIUS of the centre (yes/house/commercial/retail/residential) ->
 *    pre-1917 historic, in one of five pastel variants chosen by hash of the OSM id;
 *  - shops/offices -> modern glass boxes; houses elsewhere get one of five pastel house colours.
 * `areaM2` (footprint) and optional footprint geometry tell small untagged buildings from
 * Khrushchevka slabs and point towers. `geometry.residential` comes from OSM landuse context.
 * Everything derives from the id hash, never Math.random.
 */
export interface BuildingGeometry {
  ring?: readonly (readonly [number, number])[];
  residential?: boolean;
}

export interface FootprintMetrics {
  areaM2: number;
  widthM: number;
  lengthM: number;
}

/** Minimum-area rectangle metrics for a simple footprint in cell-unit coordinates. */
export function footprintMetrics(
  ring: readonly (readonly [number, number])[] | undefined, areaM2 = Infinity,
): FootprintMetrics {
  if (!ring || ring.length < 3) return { areaM2, widthM: Infinity, lengthM: Infinity };
  let best = Infinity;
  let bestW = Infinity, bestL = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!, b = ring[(i + 1) % ring.length]!;
    const dx = (b[0] - a[0]) * VOXEL, dz = (b[1] - a[1]) * VOXEL;
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) continue;
    const ux = dx / len, uz = dz / len;
    const vx = -uz, vz = ux;
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const p of ring) {
      const x = p[0] * VOXEL, z = p[1] * VOXEL;
      const u = x * ux + z * uz, v = x * vx + z * vz;
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
    }
    const area = (u1 - u0) * (v1 - v0);
    if (area < best) {
      best = area;
      bestW = Math.min(u1 - u0, v1 - v0);
      bestL = Math.max(u1 - u0, v1 - v0);
    }
  }
  if (!Number.isFinite(best)) return { areaM2, widthM: Infinity, lengthM: Infinity };
  return { areaM2, widthM: bestW, lengthM: bestL };
}

/** Calibrated storey heuristic for buildings without `building:levels` or `height`. */
export function estimateStoreys(
  t: Tags, centreDist = Infinity, areaM2 = Infinity, geometry: BuildingGeometry = {},
): number {
  const b = t.building ?? "yes";
  const tagged = parseNum(t["building:levels"]);
  if (tagged !== null) return Math.max(1, Math.round(tagged));
  const height = parseNum(t.height);
  if (height !== null) return Math.max(1, Math.round((height - 1) / 2.8));
  if (b === "garage" || b === "garages" || b === "shed" || b === "roof") return 1;
  if (HOUSE_TYPES.has(b)) return areaM2 < SMALL_DETACHED_M2 ? 1 : 2;
  const m = footprintMetrics(geometry.ring, areaM2);
  const residential = geometry.residential === true || FLAT_TYPES.has(b);
  if (residential) {
    // Common 1-464/1-447 slabs: 11-13 m wide, 40-90 m long, four/five entrance sections.
    if (m.widthM <= 16 && m.lengthM >= 30 && m.lengthM <= 110 && m.areaM2 >= 250) return 5;
    // Long narrow slabs are ambiguous; require apartment/residential type/context and size.
    if (m.widthM <= 16 && m.lengthM >= 80 && m.areaM2 >= 900) return 9;
    // Square point towers in residential estates are a conservative 9-storey signal.
    if (m.widthM >= 16 && m.widthM <= 30 && m.lengthM >= 16 && m.lengthM <= 34 && m.areaM2 >= 250) return 9;
    if (m.areaM2 < SMALL_DETACHED_M2) return 2;
    if (b === "apartments") return centreDist < 5000 ? 5 : 3;
    return 3;
  }
  if (areaM2 < SMALL_DETACHED_M2) return 1;
  // Untagged slabs outside a mapped residential landuse (common around Filatova): the typical
  // 1-464/1-447 khrushchevka footprint (~11-13 m wide, 35-110 m long) is still a 5-storey block.
  if (b === "yes" && m.widthM >= 10 && m.widthM <= 14.5 && m.lengthM >= 35 && m.lengthM <= 110) return 5;
  if (b === "yes" && areaM2 < SMALL_YES_M2) return 2;
  return centreDist <= HISTORIC_RADIUS ? 2 : 3;
}

function isBrickMaterial(t: Tags): boolean {
  const material = (t["building:material"] ?? "").toLowerCase();
  return material === "brick" || material === "silicate brick" || material === "sand-lime brick" || material === "lime brick";
}

export function buildingSpec(id: number, t: Tags, centreDist = Infinity, areaM2 = Infinity, geometry: BuildingGeometry = {}): BuildingSpec {
  const b = t.building!;
  const worship = b === "church" || b === "cathedral" || b === "chapel" || t.amenity === "place_of_worship";
  const houseLike = HOUSE_TYPES.has(b);
  const levelsTag = parseNum(t["building:levels"]);
  const heightTag = parseNum(t.height);
  let hm = heightTag;
  if (hm === null && levelsTag !== null) hm = levelsTag * 3 + 1;
  const heightHeuristic = levelsTag === null && heightTag === null;
  const estimatedLevels = estimateStoreys(t, centreDist, areaM2, geometry);
  if (hm === null) {
    if (worship) hm = 18;
    else if (b === "industrial" || b === "warehouse") hm = 8;
    else if (heightHeuristic) hm = estimatedLevels * 2.8 + 1;
    else hm = 9;
  }
  const h = Math.max(1, Math.min(120, Math.round(hm / VOXEL)));
  const hh = hash(id);
  // Storeys for style decisions: explicit tags win; otherwise use the calibrated geometry heuristic.
  const lv = levelsTag ?? (heightTag !== null ? Math.max(1, Math.round((heightTag - 1) / 2.8)) : estimatedLevels);
  const arch = (t["building:architecture"] ?? "").toLowerCase();
  const central = centreDist <= HISTORIC_RADIUS;

  let wall: number = MAT.WALL_PUBLIC;
  let style = "public";
  const pick = (variants: readonly number[], name: string): void => {
    const c = nearestVariant(t["building:colour"] ?? t.colour, variants);
    wall = c >= 0 ? c : variants[hh % variants.length]!;
    style = name;
  };
  const set = (m: number, name: string): void => { wall = m; style = name; };

  if (worship) set(MAT.WALL_CHURCH, "church");
  else if (b === "garage" || b === "garages") set(MAT.WALL_GARAGE, "garage");
  else if (b === "industrial" || b === "warehouse") set(MAT.WALL_INDUSTRIAL, "industrial");
  else if (isBrickMaterial(t)) set(MAT.WALL_BRICK, "brick");
  else if (arch === "stalinist" || arch === "stalinism" || arch === "soviet_neoclassicism") set(MAT.WALL_STALIN, "stalin");
  else if (arch === "soviet_modernism" || arch === "brutalism" || arch === "panel") set(MAT.WALL_PANEL, "panel");
  else if (arch === "modern" || arch === "contemporary" || arch === "postmodern") set(MAT.WALL_MODERN, "modern");
  else if (["art_nouveau", "historicism", "eclectic", "neoclassicism", "classicism", "baroque", "neo_renaissance", "russian_revival"].includes(arch)) {
    pick(HISTORIC_WALLS, "historic");
  } else if ((FLAT_TYPES.has(b) || geometry.residential === true || (b === "yes" && heightHeuristic && (lv ?? 0) >= 5))
    && (b === "apartments" || b === "residential" || b === "dormitory" || (lv ?? 0) >= 4)) {
    const levels = lv ?? 5;
    if (HISTORIC_TYPES.has(b) && central && levels <= 3) pick(HISTORIC_WALLS, "historic");
    else if (centreDist <= STALIN_RADIUS && levels >= 3 && levels <= 7 && hh % 3 === 0) set(MAT.WALL_STALIN, "stalin");
    else if (levels >= 7 || hm >= 20) set(MAT.WALL_PANEL, "panel");
    else set(MAT.WALL_KHRUSH, "khrush");
  } else if (HISTORIC_TYPES.has(b) && central && (lv ?? 2) <= 3 && areaM2 < 900) {
    pick(HISTORIC_WALLS, "historic");
  } else if (SHOP_TYPES.has(b)) {
    set(MAT.WALL_MODERN, "modern");
  } else if (houseLike || b === "residential" || (b === "yes" && (lv !== null ? lv <= 2 : areaM2 < SMALL_YES_M2))) {
    pick(HOUSE_WALLS, "house");
  }

  let roof: number;
  if (worship) roof = hh & 1 ? MAT.ROOF_GOLD : MAT.ROOF_GREEN;
  else if (b === "house" || b === "detached" || b === "semidetached_house" || b === "bungalow") roof = MAT.ROOF_RED;
  else roof = hh & 1 ? MAT.ROOF_GREY : MAT.ROOF_DARK;
  return { h, hm, levels: lv ?? 0, heightHeuristic, wall, roof, style };
}

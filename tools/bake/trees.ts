// Pure vegetation logic for the bake: the species mix of docs/TREES.md and explicit OSM tag mapping.

import { SPECIES } from "../../src/nature/species.ts";
import { hash } from "./building-style.ts";
import type { Tags } from "./osm.ts";

export type Table = readonly (readonly [number, number])[];

/** Tree feature param for an ordinary trunk. */
export const TREE_PARAM = 5;
/**
 * Tree feature param for a whitewashed trunk. Kherson's street trees are whitewashed every spring;
 * the client paints the bark white up to about 1.2 m on `param === 6`. This is a plausible generic
 * default per CONSTITUTION Article 2.1.
 */
export const TREE_PARAM_WHITEWASH = 6;

/** Street trees on the sidewalk border of residential to primary roads: acacia and plane avenues. */
export const T_STREET: Table = [
  [SPECIES.ACACIA, 22], [SPECIES.PLANE, 12], [SPECIES.CHESTNUT, 12], [SPECIES.LINDEN, 12],
  [SPECIES.MAPLE, 12], [SPECIES.ELM, 8], [SPECIES.GLEDITSIA, 6], [SPECIES.CATALPA, 5],
  [SPECIES.POPLAR, 5], [SPECIES.AILANTHUS, 3], [SPECIES.MULBERRY, 3],
];

/** Park plantings: chestnut, maple and linden squares with older introductions. */
export const T_PARK: Table = [
  [SPECIES.CHESTNUT, 15], [SPECIES.MAPLE, 14], [SPECIES.LINDEN, 12], [SPECIES.ACACIA, 10],
  [SPECIES.PLANE, 8], [SPECIES.ELM, 8], [SPECIES.POPLAR, 8], [SPECIES.THUJA, 5],
  [SPECIES.PINE, 4], [SPECIES.CATALPA, 4], [SPECIES.GLEDITSIA, 4], [SPECIES.WILLOW, 4],
  [SPECIES.AILANTHUS, 2], [SPECIES.MULBERRY, 2],
];

/** Natural=tree_row plantings: mostly pyramidal poplars and acacia. */
export const T_ROW: Table = [
  [SPECIES.POPLAR, 35], [SPECIES.ACACIA, 25], [SPECIES.ELM, 20],
  [SPECIES.GLEDITSIA, 10], [SPECIES.MAPLE, 10],
];

/** Trees with no species tags: the city's everyday mix. */
export const T_UNTAGGED: Table = [
  [SPECIES.CHESTNUT, 18], [SPECIES.ACACIA, 18], [SPECIES.LINDEN, 14], [SPECIES.MAPLE, 14],
  [SPECIES.ELM, 12], [SPECIES.POPLAR, 8], [SPECIES.MULBERRY, 6], [SPECIES.WALNUT, 5],
  [SPECIES.PLANE, 5],
];

/** Broadleaf forest away from sand and water. */
export const T_FOREST: Table = [
  [SPECIES.ACACIA, 25], [SPECIES.POPLAR, 20], [SPECIES.ELM, 18], [SPECIES.MAPLE, 12],
  [SPECIES.LINDEN, 10], [SPECIES.WILLOW, 10], [SPECIES.WALNUT, 5],
];

/** Floodplain meadows: sparse mixed trees. */
export const T_MEADOW: Table = [
  [SPECIES.ELM, 20], [SPECIES.POPLAR, 25], [SPECIES.ACACIA, 25], [SPECIES.WILLOW, 20],
  [SPECIES.MULBERRY, 10],
];

/** Floodplain scrub: a few drought-tolerant trees. */
export const T_SCRUB: Table = [
  [SPECIES.ACACIA, 35], [SPECIES.ELM, 25], [SPECIES.MULBERRY, 15], [SPECIES.POPLAR, 15],
  [SPECIES.WILLOW, 10],
];

/** Sandy-ground forest away from the pine belt: see the pine rule in the bake. */
export const T_SAND_FOREST: Table = [
  [SPECIES.ACACIA, 45], [SPECIES.ELM, 25], [SPECIES.POPLAR, 15], [SPECIES.MULBERRY, 15],
];

/** Wetlands: willow country. */
export const T_WETLAND: Table = [[SPECIES.WILLOW, 70], [SPECIES.POPLAR, 20], [SPECIES.ELM, 10]];

/** Reeds along the water edge: nearly all willow. */
export const T_REED: Table = [[SPECIES.WILLOW, 80], [SPECIES.POPLAR, 20]];

/** Weighted pick from a table; `r` is a deterministic hash in [0, 1). */
export function pick(table: Table, r: number): number {
  let tot = 0;
  for (const e of table) tot += e[1];
  let acc = r * tot;
  for (const e of table) {
    if (acc < e[1]) return e[0];
    acc -= e[1];
  }
  return table[table.length - 1]![0];
}

/** Species of an explicit natural=tree node: OSM tags win, otherwise the untagged mix. */
export function speciesOfTags(tags: Tags, h: number): number {
  const S = SPECIES;
  const txt = `${tags.species ?? ""} ${tags.genus ?? ""} ${tags.taxon ?? ""}`.toLowerCase();
  if (txt.includes("populus")) return S.POPLAR;
  // "carpinus" (hornbeam) contains "pinus": hornbeam is a broadleaf, handled below.
  if (txt.includes("pinus") && !txt.includes("carpinus")) return S.PINE;
  if (txt.includes("salix")) return S.WILLOW;
  if (txt.includes("robinia")) return S.ACACIA;
  if (txt.includes("aesculus")) return S.CHESTNUT;
  if (txt.includes("tilia")) return S.LINDEN;
  if (txt.includes("platanus")) return S.PLANE;
  if (txt.includes("acer")) return S.MAPLE;
  if (txt.includes("ulmus")) return S.ELM;
  if (txt.includes("gleditsia")) return S.GLEDITSIA;
  if (txt.includes("morus")) return S.MULBERRY;
  if (txt.includes("ailanthus")) return S.AILANTHUS;
  if (txt.includes("catalpa")) return S.CATALPA;
  if (txt.includes("thuja") || txt.includes("platycladus") || txt.includes("juniperus")) return S.THUJA;
  if (txt.includes("juglans")) return S.WALNUT;
  if (txt.includes("castanea")) return S.CHESTNUT;
  // Ash, oak, hornbeam and beech have no model of their own; their crowns read closest to elm.
  if (/fraxinus|quercus|carpinus|fagus/.test(txt)) return S.ELM;
  // Birch's light, fine crown is closest to linden.
  if (txt.includes("betula")) return S.LINDEN;
  // Fruit trees (plum, apple, pear) share mulberry's small rounded crown.
  if (/prunus|malus|pyrus/.test(txt)) return S.MULBERRY;
  if (tags.leaf_type === "needleleaved") return S.PINE;
  return pick(T_UNTAGGED, (hash(h, 11) & 0xffff) / 65536);
}

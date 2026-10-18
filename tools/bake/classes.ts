import { MAT } from "../../src/world/materials.ts";
import type { Tags } from "./osm.ts";

// Classification tables shared by the coarse bake (tools/bake.ts) and the vector tiles (tools/bake/vectors.ts).

export function groundClass(t: Tags): { mat: number; prio: number } | null {
  if (t.place === "square" || (t.highway === "pedestrian" && t.area === "yes")) return { mat: MAT.PLAZA, prio: 5 };
  const lu = t.landuse;
  if (lu === "forest") return { mat: MAT.FOREST, prio: 1 };
  if (lu === "industrial" || lu === "railway" || lu === "quarry" || lu === "construction" || lu === "brownfield" || lu === "landfill")
    return { mat: MAT.DIRT, prio: 1 };
  if (lu === "recreation_ground" || lu === "village_green") return { mat: MAT.PARK, prio: 1 };
  const nat = t.natural;
  if (nat === "wood" || nat === "scrub") return { mat: MAT.FOREST, prio: 2 };
  if (nat === "beach" || nat === "sand") return { mat: MAT.SAND, prio: 2 };
  const le = t.leisure;
  if (le === "park" || le === "garden" || le === "common" || le === "nature_reserve") return { mat: MAT.PARK, prio: 3 };
  return null;
}

export function isWater(t: Tags): boolean {
  return (
    t.natural === "water" || t.waterway === "riverbank" || t.landuse === "reservoir" || t.landuse === "basin" ||
    (t.water !== undefined && t.natural === undefined && !t.waterway && !t.highway && !t.building)
  );
}

export const HW: Record<string, number> = {
  motorway: 8, motorway_link: 6, trunk: 8, trunk_link: 6, primary: 8, primary_link: 6, secondary: 7, secondary_link: 5,
  tertiary: 6, tertiary_link: 4, residential: 4, unclassified: 4, living_street: 4, service: 2.5,
  pedestrian: 1.2, footway: 1.2, path: 1.2, cycleway: 1.2, steps: 1.2, track: 2,
};
export const SIDEWALK_ROAD = new Set([
  "motorway", "motorway_link", "trunk", "trunk_link", "primary", "primary_link", "secondary", "secondary_link",
  "tertiary", "tertiary_link", "residential", "unclassified", "living_street",
]);


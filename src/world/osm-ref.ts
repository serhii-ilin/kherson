/**
 * Names one OSM element, so a hand-made override (a hero landmark, a facade descriptor) can target a building.
 * Vector tiles keep the low 32 bits of the id plus the element type (`VBuilding.osmType`); Kherson's ids are all
 * below 2^32, so the low bits are the id.
 */
import { OSM_TYPE } from './vector-format.ts';

export interface OsmRef {
  type: 'way' | 'relation';
  id: number;
}

/** `w<id>` or `r<id>`: the key used by facade descriptors and hidden-building sets. */
export function osmKey(ref: OsmRef): string {
  return (ref.type === 'relation' ? 'r' : 'w') + ref.id;
}

/** The key of a vector-tile building (`VBuilding.id` and `VBuilding.osmType`). */
export function buildingKey(id: number, osmType?: number): string {
  return (osmType === OSM_TYPE.RELATION ? 'r' : 'w') + (id >>> 0);
}

/** Parses `w<id>` / `r<id>`; null for anything else. */
export function parseOsmKey(key: string): OsmRef | null {
  const m = /^([wr])([1-9][0-9]*)$/.exec(key);
  if (!m) return null;
  const id = Number(m[2]);
  if (!Number.isSafeInteger(id)) return null;
  return { type: m[1] === 'r' ? 'relation' : 'way', id };
}

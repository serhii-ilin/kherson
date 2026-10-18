// Pure helpers of the places list (menu / teleport targets): de-duplication and snapping to walkable ground.

export interface Place { name: string; nameEn?: string; kind: string; x: number; z: number; yaw?: number }

/** Settlement kinds that exist once per name: the same name and kind is one place, wherever its copies lie. */
const UNIQUE_KINDS = new Set(["city", "town", "village", "hamlet", "suburb", "district", "quarter", "neighbourhood", "island"]);

/**
 * Drops duplicates from a list sorted by priority (the first copy wins, so OSM nodes, listed before area
 * centroids, win): same name and kind for settlement kinds, else same name within 50 m.
 */
export function dedupePlaces(sorted: readonly Place[], limit = 400): Place[] {
  const seen = new Map<string, Place[]>();
  const out: Place[] = [];
  for (const p of sorted) {
    const list = seen.get(p.name);
    if (list?.some((q) => (UNIQUE_KINDS.has(p.kind) && q.kind === p.kind) || Math.hypot(q.x - p.x, q.z - p.z) < 50)) continue;
    if (list) list.push(p); else seen.set(p.name, [p]);
    out.push(p);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Moves a place to the nearest walkable cell (ring search up to `maxCells`), so teleporting lands on a pier or
 * embankment, not in the river. Coordinates are metres, cells are `voxel` metres.
 */
export function nudgeToWalkable(p: Place, walk: (cx: number, cz: number) => boolean, voxel: number, maxCells = 30): Place {
  const sx = Math.floor(p.x / voxel), sz = Math.floor(p.z / voxel);
  if (walk(sx, sz)) return p;
  for (let r = 1; r <= maxCells; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        if (walk(sx + dx, sz + dz)) {
          return { ...p, x: Math.round((sx + dx + 0.5) * voxel * 10) / 10, z: Math.round((sz + dz + 0.5) * voxel * 10) / 10 };
        }
      }
    }
  }
  return p;
}

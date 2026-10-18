import type { Tags } from "./osm.ts";
import type { Pt } from "./rasterize.ts";

// Named streets for the places search. OSM splits a street into many ways; ways with the same name
// are merged, but a name reused in distant parts of the city (single-link gap > CLUSTER_GAP) gives
// separate entries. Each entry is a point ON the street near its middle, plus the street direction,
// so a teleport lands the player on the street looking along it.

/** Highway classes that count as streets (links, footways and paths do not). */
export const STREET_CLASSES = new Set([
  "trunk", "primary", "secondary", "tertiary", "unclassified", "residential", "living_street", "pedestrian", "service",
]);

/** Cells (2 m): pieces of one name farther apart than ~1.5 km are different streets. */
const CLUSTER_GAP = 750;

export interface StreetPlace {
  name: string;
  nameEn?: string;
  kind: "street";
  /** World metres. */
  x: number;
  z: number;
  /** Degrees, URL convention: 0 faces north (−z), positive turns left (toward −x). */
  yaw: number;
  /** Former names from `old_name` / `old_name:uk` (`;`-separated), searchable. */
  old?: string[];
}

interface Piece {
  tags: Tags;
  pts: Pt[];
}

function pieceGap(a: Piece, b: Piece): number {
  let best = Infinity;
  for (const p of a.pts) for (const q of b.pts) best = Math.min(best, Math.hypot(p[0] - q[0], p[1] - q[1]));
  return best;
}

/** Point on the cluster nearest the length-weighted centroid of its segments, with that segment's yaw. */
function anchor(pieces: Piece[], inside: (x: number, z: number) => boolean): { x: number; z: number; yaw: number } | null {
  let sx = 0, sz = 0, sw = 0;
  for (const pc of pieces) {
    for (let i = 1; i < pc.pts.length; i++) {
      const a = pc.pts[i - 1]!, b = pc.pts[i]!;
      const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
      if (!inside(mx, mz)) continue;
      const w = Math.hypot(b[0] - a[0], b[1] - a[1]);
      sx += mx * w; sz += mz * w; sw += w;
    }
  }
  if (sw === 0) return null;
  const cx = sx / sw, cz = sz / sw;
  let best: { x: number; z: number; yaw: number } | null = null;
  let bestD = Infinity;
  for (const pc of pieces) {
    for (let i = 1; i < pc.pts.length; i++) {
      const a = pc.pts[i - 1]!, b = pc.pts[i]!;
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const len2 = dx * dx + dz * dz;
      if (len2 === 0) continue;
      const t = Math.max(0, Math.min(1, ((cx - a[0]) * dx + (cz - a[1]) * dz) / len2));
      const px = a[0] + dx * t, pz = a[1] + dz * t;
      if (!inside(px, pz)) continue;
      const d = Math.hypot(px - cx, pz - cz);
      if (d < bestD) {
        bestD = d;
        best = { x: px, z: pz, yaw: (Math.atan2(-dx, -dz) * 180) / Math.PI };
      }
    }
  }
  return best;
}

/**
 * Street entries from highway lines (cell-unit points). `inside(x, z)` limits them to the city;
 * `voxel` converts cells to metres. Deterministic: output sorted by name, then position.
 */
export function collectStreets(
  lines: readonly { tags: Tags; pts: Pt[] }[],
  inside: (x: number, z: number) => boolean,
  voxel: number,
): StreetPlace[] {
  const byName = new Map<string, Piece[]>();
  for (const l of lines) {
    const t = l.tags;
    if (!t.name || !t.highway || !STREET_CLASSES.has(t.highway) || l.pts.length < 2) continue;
    if (t.highway === "service" && !/вулиц|провулок|проспект|бульвар|площа|узвіз|проїзд|шосе|набережна/i.test(t.name)) continue;
    const list = byName.get(t.name);
    if (list) list.push({ tags: t, pts: l.pts });
    else byName.set(t.name, [{ tags: t, pts: l.pts }]);
  }
  const out: StreetPlace[] = [];
  for (const [name, pieces] of byName) {
    // single-link clustering (union-find over pieces)
    const parent = pieces.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
    for (let i = 0; i < pieces.length; i++) {
      for (let j = i + 1; j < pieces.length; j++) {
        if (find(i) !== find(j) && pieceGap(pieces[i]!, pieces[j]!) <= CLUSTER_GAP) parent[find(i)] = find(j);
      }
    }
    const clusters = new Map<number, Piece[]>();
    for (let i = 0; i < pieces.length; i++) {
      const r = find(i);
      const c = clusters.get(r);
      if (c) c.push(pieces[i]!);
      else clusters.set(r, [pieces[i]!]);
    }
    for (const c of clusters.values()) {
      const a = anchor(c, inside);
      if (!a) continue;
      const p: StreetPlace = {
        name,
        kind: "street",
        x: Math.round(a.x * voxel * 10) / 10,
        z: Math.round(a.z * voxel * 10) / 10,
        yaw: Math.round(a.yaw),
      };
      const en = c.find((pc) => pc.tags["name:en"])?.tags["name:en"];
      if (en) p.nameEn = en;
      const old = new Set<string>();
      for (const pc of c) {
        for (const k of ["old_name", "old_name:uk"]) {
          for (const o of (pc.tags[k] ?? "").split(";")) if (o.trim() && o.trim() !== name) old.add(o.trim());
        }
      }
      if (old.size > 0) p.old = [...old].sort();
      out.push(p);
    }
  }
  out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.x - b.x || a.z - b.z));
  return out;
}

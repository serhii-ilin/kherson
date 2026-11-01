// Minimal city-mask extension for the Antonivskyi road bridge, which stands in the
// Dnipro just outside relation 2175078. The city polygon is not widened. A corridor
// is stamped around the bridge carriageways and a short run of each approach.
import { VOXEL } from "../../src/world/constants.ts";
import type { Pt } from "./rasterize.ts";

/** Radius around the bridge and approach centreline, metres. Covers a trunk deck (about 16 m) plus the gap between carriageways. */
export const CORRIDOR_RADIUS_M = 30;
/** How far past each bridge end the approach roads stay in the mask, metres. */
export const APPROACH_MAX_M = 450;
/** Safety stop if bridge=yes ways chain far beyond the river span (two carriageways of the real bridge are about 2.8 km together). */
export const BRIDGE_CHAIN_MAX_M = 6000;

export const ANTONIVSKYI_WIKIDATA = "Q4067525";

// "міст" must not match the start of "містечко" (a settlement name, not the bridge).
const NAME_RE = /(?:антонівськ|антоновск)\S*\s+(?:міст|мост)(?!\p{L})|antoniv\S*\s+(?:road\s+)?bridge(?![a-z])|antoniwka-brücke(?![a-z])|antonov\S*\s+bridge(?![a-z])/iu;

/** The railway Antonivskyi bridge is a different structure (Wikidata Q4067523). */
const RAIL_BRIDGE_WIKIDATA = "Q4067523";

const HW_RANK: Record<string, number> = {
  motorway: 0, trunk: 1, primary: 2, secondary: 3, tertiary: 4,
  motorway_link: 1, trunk_link: 2, primary_link: 3, secondary_link: 4, tertiary_link: 5,
};

export interface CorridorWay {
  id: number;
  tags: Record<string, string>;
  nodeIds: readonly number[];
  /** Cell units, same grid as the bake. */
  pts: readonly Pt[];
}

export interface CorridorRel {
  id: number;
  tags: Record<string, string>;
  members: readonly { type: string; ref: number; role: string }[];
}

export interface CorridorSelection {
  /** Bridge span ways (and bridge-relation outlines). */
  bridgeWayIds: number[];
  /** Clipped approach ways. */
  approachWayIds: number[];
  polylines: Pt[][];
  lengthM: number;
}

export function isAntonivskyiName(tags: Record<string, string>): boolean {
  if (tags.wikidata === RAIL_BRIDGE_WIKIDATA) return false;
  if (tags.wikidata === ANTONIVSKYI_WIKIDATA) return true;
  // The railway span shares the name but is not the road bridge the mask corridor is for.
  if (tags.railway && !tags.highway && tags.man_made !== "bridge") return false;
  for (const key of ["name", "name:uk", "name:en", "name:ru", "name:de"]) {
    const value = tags[key];
    if (value && NAME_RE.test(value)) return true;
  }
  return false;
}

function lengthM(pts: readonly Pt[]): number {
  let m = 0;
  for (let i = 1; i < pts.length; i++) m += Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]) * VOXEL;
  return m;
}

function highwayRank(tags: Record<string, string>): number | null {
  const hw = tags.highway;
  if (!hw) return null;
  const rank = HW_RANK[hw];
  return rank === undefined ? null : rank;
}

function refBlob(tags: Record<string, string>): string {
  return `${tags.ref ?? ""} ${tags.nat_ref ?? ""} ${tags.int_ref ?? ""}`;
}

interface Clip {
  pts: Pt[];
  lengthM: number;
  endNode: number;
  whole: boolean;
}

/** Walk `way` from `startNode`, away from `away`, for at most `maxM` metres. */
function clipFrom(way: CorridorWay, startNode: number, maxM: number, away: Pt): Clip | null {
  const idx = way.nodeIds.indexOf(startNode);
  if (idx < 0 || way.pts.length < 2 || maxM <= 0) return null;
  const dirs: number[] = [];
  if (idx > 0) dirs.push(-1);
  if (idx < way.pts.length - 1) dirs.push(1);
  if (dirs.length === 0) return null;
  let dir = dirs[0]!;
  if (dirs.length === 2) {
    const back = way.pts[idx - 1]!;
    const fwd = way.pts[idx + 1]!;
    const db = Math.hypot(back[0] - away[0], back[1] - away[1]);
    const df = Math.hypot(fwd[0] - away[0], fwd[1] - away[1]);
    dir = df >= db ? 1 : -1;
  }
  const pts: Pt[] = [[way.pts[idx]![0], way.pts[idx]![1]]];
  let travelled = 0;
  let i = idx;
  while (travelled < maxM - 1e-6) {
    const j = i + dir;
    if (j < 0 || j >= way.pts.length) return { pts, lengthM: travelled, endNode: way.nodeIds[i]!, whole: true };
    const seg = Math.hypot(way.pts[j]![0] - way.pts[i]![0], way.pts[j]![1] - way.pts[i]![1]) * VOXEL;
    if (travelled + seg > maxM) {
      const t = (maxM - travelled) / seg;
      pts.push([
        way.pts[i]![0] + (way.pts[j]![0] - way.pts[i]![0]) * t,
        way.pts[i]![1] + (way.pts[j]![1] - way.pts[i]![1]) * t,
      ]);
      return { pts, lengthM: maxM, endNode: way.nodeIds[i]!, whole: false };
    }
    pts.push([way.pts[j]![0], way.pts[j]![1]]);
    travelled += seg;
    i = j;
  }
  return { pts, lengthM: travelled, endNode: way.nodeIds[i]!, whole: true };
}

/**
 * Bridge carriageways, outline ways of the bridge relation, and a short highway
 * approach at each end. Street names that merely contain "Антонів" are not the bridge.
 */
export function selectAntonivskyiCorridor(ways: readonly CorridorWay[], rels: readonly CorridorRel[] = []): CorridorSelection {
  const byId = new Map<number, CorridorWay>();
  const byNode = new Map<number, CorridorWay[]>();
  for (const w of ways) {
    if (w.pts.length < 2 || w.nodeIds.length < 2) continue;
    byId.set(w.id, w);
    for (const id of w.nodeIds) {
      let list = byNode.get(id);
      if (!list) byNode.set(id, (list = []));
      list.push(w);
    }
  }
  const bridge = new Set<number>();
  for (const rel of rels) {
    if (!isAntonivskyiName(rel.tags)) continue;
    for (const m of rel.members) if (m.type === "way" && byId.has(m.ref)) bridge.add(m.ref);
  }
  for (const w of byId.values()) {
    if (!isAntonivskyiName(w.tags)) continue;
    if (w.tags.bridge || w.tags.man_made === "bridge" || w.tags.highway || w.tags.wikidata === ANTONIVSKYI_WIKIDATA) bridge.add(w.id);
  }
  let total = 0;
  for (const id of bridge) total += lengthM(byId.get(id)!.pts);
  const queue = [...bridge];
  while (queue.length) {
    const id = queue.pop()!;
    const w = byId.get(id);
    if (!w) continue;
    for (const node of w.nodeIds) {
      for (const other of byNode.get(node) ?? []) {
        if (bridge.has(other.id)) continue;
        const linked = (other.tags.bridge !== undefined && other.tags.bridge !== "no") || other.tags.man_made === "bridge";
        if (!linked) continue;
        const extra = lengthM(other.pts);
        if (total + extra > BRIDGE_CHAIN_MAX_M) continue;
        bridge.add(other.id);
        total += extra;
        queue.push(other.id);
      }
    }
  }

  const polylines: Pt[][] = [];
  let length = 0;
  const bridgeRefs = new Set<string>();
  let sx = 0, sz = 0, sn = 0;
  for (const id of bridge) {
    const w = byId.get(id)!;
    polylines.push(w.pts.map((p) => [p[0], p[1]]));
    length += lengthM(w.pts);
    for (const key of ["ref", "nat_ref", "int_ref"]) {
      for (const part of (w.tags[key] ?? "").split(/[; ]+/)) if (part) bridgeRefs.add(part);
    }
    for (const p of w.pts) { sx += p[0]; sz += p[1]; sn++; }
  }
  const away: Pt = sn ? [sx / sn, sz / sn] : [0, 0];

  const approach = new Set<number>();
  const seen = new Set<number>(bridge);
  const ends: number[] = [];
  for (const id of [...bridge].sort((a, b) => a - b)) {
    const w = byId.get(id)!;
    if (!w.tags.highway) continue;
    ends.push(w.nodeIds[0]!, w.nodeIds[w.nodeIds.length - 1]!);
  }
  for (const start of ends) {
    let node = start;
    let left = APPROACH_MAX_M;
    while (left > 1) {
      const candidates = (byNode.get(node) ?? []).filter((w) => !seen.has(w.id) && highwayRank(w.tags) !== null);
      if (candidates.length === 0) break;
      candidates.sort((a, b) => {
        const ar = [...bridgeRefs].some((r) => refBlob(a.tags).includes(r)) ? 0 : 1;
        const br = [...bridgeRefs].some((r) => refBlob(b.tags).includes(r)) ? 0 : 1;
        return ar - br || highwayRank(a.tags)! - highwayRank(b.tags)! || a.id - b.id;
      });
      const next = candidates[0]!;
      const clip = clipFrom(next, node, left, away);
      if (!clip || clip.pts.length < 2 || clip.lengthM < 0.5) break;
      polylines.push(clip.pts);
      length += clip.lengthM;
      approach.add(next.id);
      seen.add(next.id);
      left -= clip.lengthM;
      if (!clip.whole) break;
      node = clip.endNode;
    }
  }

  return {
    bridgeWayIds: [...bridge].sort((a, b) => a - b),
    approachWayIds: [...approach].sort((a, b) => a - b),
    polylines,
    lengthM: length,
  };
}

import { VOXEL } from "../../src/world/constants.ts";
import { roadWidthCm, type VArea_, type VLineIn } from "./vectors.ts";
import type { Tags } from "./osm.ts";
import type { Pt } from "./rasterize.ts";

const PANEL_M = 2.5;
const GATE_MARGIN_M = 2.5;

function pointInRings(rings: readonly (readonly Pt[])[], x: number, z: number): boolean {
  let inside = false;
  for (const r of rings) {
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const a = r[i]!, b = r[j]!;
      if ((a[1] > z) !== (b[1] > z) && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
  }
  return inside;
}

function segmentDistance(px: number, pz: number, a: Pt, b: Pt): number {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / l2)) : 0;
  return Math.hypot(a[0] + dx * t - px, a[1] + dz * t - pz);
}

interface Guard {
  area: VArea_;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

interface RoadGuard {
  pts: Pt[];
  half: number;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

function bounds(rings: readonly (readonly Pt[])[]): [number, number, number, number] {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const r of rings) for (const p of r) { x0 = Math.min(x0, p[0]); z0 = Math.min(z0, p[1]); x1 = Math.max(x1, p[0]); z1 = Math.max(z1, p[1]); }
  return [x0, z0, x1, z1];
}

function guard(area: VArea_): Guard {
  const [x0, z0, x1, z1] = bounds(area.rings);
  return { area, x0, z0, x1, z1 };
}

function roadAt(roads: readonly RoadGuard[], x: number, z: number): boolean {
  const gate = GATE_MARGIN_M / VOXEL;
  for (const road of roads) {
    if (x < road.x0 - road.half - gate || x > road.x1 + road.half + gate || z < road.z0 - road.half - gate || z > road.z1 + road.half + gate) continue;
    for (let i = 1; i < road.pts.length; i++) {
      if (segmentDistance(x, z, road.pts[i - 1]!, road.pts[i]!) <= road.half + gate) return true;
    }
  }
  return false;
}

function buildingAt(buildings: readonly Guard[], x: number, z: number): boolean {
  for (const b of buildings) {
    if (x < b.x0 - 0.35 || x > b.x1 + 0.35 || z < b.z0 - 0.35 || z > b.z1 + 0.35) continue;
    const area = b.area;
    if (pointInRings(area.rings, x, z)) return true;
    for (const r of area.rings) for (let i = 1; i < r.length; i++) {
      if (segmentDistance(x, z, r[i - 1]!, r[i]!) < 0.35) return true;
    }
  }
  return false;
}

function waterAt(water: readonly Guard[], x: number, z: number): boolean {
  return water.some((a) => x >= a.x0 && x <= a.x1 && z >= a.z0 && z <= a.z1 && pointInRings(a.area.rings, x, z));
}

/**
 * Deterministic generic industrial boundaries. This is deliberately generated in the bake so the
 * fine worker receives the same compact line data as an OSM barrier. We sample at panel length,
 * leaving a service/road gate gap and omitting panels that would overlap an OSM building or water.
 */
export function generateIndustrialPerimeters(areas: readonly VArea_[], lines: readonly VLineIn[]): VLineIn[] {
  const industrial = areas.filter((a) => a.tags.landuse === "industrial" && a.rings[0]?.length >= 3);
  const buildings: Guard[] = areas.filter((a) => a.tags.building !== undefined).map(guard);
  const water: Guard[] = areas.filter((a) => a.tags.natural === "water" || a.tags.waterway === "riverbank" || a.tags.landuse === "reservoir" || a.tags.landuse === "basin")
    .map(guard);
  const roads: RoadGuard[] = lines.filter((l) => l.tags.highway !== undefined && l.tags.tunnel !== "yes").map((road) => {
    const [x0, z0, x1, z1] = bounds([road.pts]);
    return { pts: road.pts, half: roadWidthCm(road.tags, road.tags.highway!.replace(/_link$/, "")) / (VOXEL * 100 * 2), x0, z0, x1, z1 };
  });
  const out: VLineIn[] = [];
  let serial = 0;
  for (const area of industrial) {
    const ring = area.rings[0]!;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!, b = ring[(i + 1) % ring.length]!;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const n = Math.max(1, Math.ceil(len / (PANEL_M / VOXEL)));
      for (let j = 0; j < n; j++) {
        const f0 = j / n, f1 = (j + 1) / n;
        const x0 = a[0] + (b[0] - a[0]) * f0, z0 = a[1] + (b[1] - a[1]) * f0;
        const x1 = a[0] + (b[0] - a[0]) * f1, z1 = a[1] + (b[1] - a[1]) * f1;
        const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
        if (roadAt(roads, mx, mz) || buildingAt(buildings, mx, mz) || waterAt(water, mx, mz)) continue;
        out.push({
          id: -((area.id + 1) * 10000 + serial++),
          tags: { barrier: "fence", height: "2.2", source: "heuristic" } satisfies Tags,
          pts: [[x0, z0], [x1, z1]],
        });
      }
    }
  }
  return out;
}

import { loadOsm, type OsmData, type OsmWay, type Tags } from "./bake/osm.ts";
import { buildingSpec, parseNum } from "./bake/building-style.ts";
import { toWorld } from "./bake/project.ts";
import { VOXEL } from "../src/world/constants.ts";

const INPUT = process.argv[2] ?? "data/osm/kherson.json.gz";
const FILATOVA = { south: 46.642, north: 46.653, west: 32.582, east: 32.606 };
type Pt = readonly [number, number];
type Area = { tags: Tags; rings: Pt[][] };

const HOUSE_TYPES = new Set(["house", "detached", "semidetached_house", "bungalow", "terrace", "farm"]);

function ring(osm: OsmData, ids: number[]): Pt[] {
  const out: Pt[] = [];
  for (const id of ids) {
    const i = osm.nodes.find(id);
    if (i >= 0) out.push([osm.nodes.xs[i]!, osm.nodes.zs[i]!]);
  }
  return out;
}

function joinRings(ways: Map<number, OsmWay>, refs: number[][]): number[][] {
  const closed: number[][] = [], open: number[][] = [];
  for (const s of refs) (s.length >= 4 && s[0] === s[s.length - 1] ? closed : open).push(s);
  const byEnd = new Map<number, number[]>();
  open.forEach((s, i) => {
    for (const n of [s[0]!, s[s.length - 1]!]) (byEnd.get(n) ?? byEnd.set(n, []).get(n)!)!.push(i);
  });
  const used = new Uint8Array(open.length);
  for (let i = 0; i < open.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const out = open[i]!.slice();
    for (;;) {
      const end = out[out.length - 1]!;
      if (end === out[0] && out.length >= 4) { closed.push(out); break; }
      const next = byEnd.get(end)?.find((j) => !used[j]);
      if (next === undefined) break;
      used[next] = 1;
      const s = open[next]!;
      if (s[0] === end) out.push(...s.slice(1));
      else out.push(...s.slice(0, -1).reverse());
    }
  }
  void ways;
  return closed;
}

function areas(osm: OsmData): { buildings: Area[]; residential: Area[] } {
  const buildings: Area[] = [], residential: Area[] = [];
  for (const w of osm.ways.values()) {
    if (w.nodes.length < 4 || w.nodes[0] !== w.nodes[w.nodes.length - 1]) continue;
    const r = ring(osm, w.nodes);
    if (r.length < 3) continue;
    if (w.tags.building !== undefined) buildings.push({ tags: w.tags, rings: [r] });
    if (w.tags.landuse === "residential") residential.push({ tags: w.tags, rings: [r] });
  }
  for (const rel of osm.relations) {
    if (rel.tags.type !== "multipolygon" || rel.tags.landuse !== "residential") continue;
    const rings = joinRings(osm.ways, rel.members.filter((m) => m.type === "way" && m.role !== "inner").map((m) => osm.ways.get(m.ref)?.nodes ?? []))
      .map((r) => ring(osm, r)).filter((r) => r.length >= 3);
    if (rings.length) residential.push({ tags: rel.tags, rings });
  }
  return { buildings, residential };
}

function inside(rings: readonly Pt[][], x: number, z: number): boolean {
  let on = false;
  for (const r of rings) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i]!, b = r[j]!;
    if ((a[1] > z) !== (b[1] > z) && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) on = !on;
  }
  return on;
}

function centroid(r: readonly Pt[]): [number, number] {
  let x = 0, z = 0;
  for (const p of r) { x += p[0]; z += p[1]; }
  return [x / r.length, z / r.length];
}

function areaM2(r: readonly Pt[]): number {
  let a = 0;
  for (let i = 0; i < r.length; i++) { const p = r[i]!, q = r[(i + 1) % r.length]!; a += p[0] * q[1] - q[0] * p[1]; }
  return Math.abs(a) * VOXEL * VOXEL / 2;
}

function oldStoreys(t: Tags): number {
  const lv = parseNum(t["building:levels"]);
  if (lv !== null) return Math.max(1, Math.round(lv));
  const h = parseNum(t.height);
  if (h !== null) return Math.max(1, Math.round((h - 1) / 3));
  if (t.building === "apartments") return 5;
  if (t.building === "residential") return 2;
  return 3;
}

function histogram(values: readonly number[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const v of values) out.set(v, (out.get(v) ?? 0) + 1);
  return new Map([...out].sort((a, b) => a[0] - b[0]));
}

function printHistogram(label: string, values: readonly number[]): void {
  const h = histogram(values);
  console.log(`${label} (${values.length})`);
  console.log([...h].map(([k, v]) => `${k}:${v} (${(v * 100 / Math.max(1, values.length)).toFixed(1)}%)`).join("  "));
}

function main(): void {
  loadOsm(INPUT).then((osm) => {
    const { buildings, residential } = areas(osm);
    const residentialBuilding = buildings.filter((a) => {
      const b = a.tags.building;
      if (b === undefined || HOUSE_TYPES.has(b) || !["apartments", "residential", "yes"].includes(b)) return false;
      const c = centroid(a.rings[0]!);
      return residential.some((r) => inside(r.rings, c[0], c[1]));
    });
    const toValues = (list: readonly Area[], fn: (a: Area) => number): number[] => list.map(fn);
    const before = toValues(residentialBuilding, (a) => oldStoreys(a.tags));
    const after = toValues(residentialBuilding, (a) => {
      const r = a.rings[0]!, c = centroid(r);
      return buildingSpec(1, a.tags, 4000, areaM2(r), { ring: r, residential: residential.some((q) => inside(q.rings, c[0], c[1])) }).levels;
    });
    console.log("Heuristic height calibration (OSM snapshot; explicit levels/height are unchanged)");
    console.log("Target programme counts: 1-3=669  4-5=680  6-7=7  9=392  14-16=27");
    printHistogram("City residential before", before);
    printHistogram("City residential after", after);

    const [x0m, z1m] = toWorld(FILATOVA.north, FILATOVA.west);
    const [x1m, z0m] = toWorld(FILATOVA.south, FILATOVA.east);
    const x0 = x0m / VOXEL, x1 = x1m / VOXEL, z1 = z1m / VOXEL, z0 = z0m / VOXEL;
    const fil = buildings.filter((a) => {
      const b = a.tags.building;
      if (b === undefined || HOUSE_TYPES.has(b) || !["apartments", "residential", "yes"].includes(b)) return false;
      const c = centroid(a.rings[0]!);
      return c[0] >= x0 && c[0] <= x1 && c[1] >= z1 && c[1] <= z0;
    });
    printHistogram("Filatova residential before", fil.map((a) => oldStoreys(a.tags)));
    printHistogram("Filatova residential after", fil.map((a) => {
      const r = a.rings[0]!, c = centroid(r);
      return buildingSpec(1, a.tags, 4000, areaM2(r), { ring: r, residential: residential.some((q) => inside(q.rings, c[0], c[1])) }).levels;
    }));
  }).catch((e) => { console.error(e); process.exitCode = 1; });
}

main();

import fs from "node:fs";
import path from "node:path";
import {
  CHUNK, F_GROUND_H, F_GROUND_MAT, F_ROOF_MAT, F_STRUCT_H, F_STRUCT_MAT, REGION, VOXEL,
} from "../src/world/constants.ts";
import { FEATURE_BRIDGE_DECK, FEATURE_TREE, encodeRegion } from "../src/world/format.ts";
import { MAT } from "../src/world/materials.ts";
import { BBOX } from "./bake/config.ts";
import { WORLD_H, WORLD_W } from "./bake/project.ts";
import { Grid, DEFAULT_CELLS } from "./bake/grid.ts";
import { loadOsm, type OsmData, type Tags } from "./bake/osm.ts";
import { bufferLine, fillPolygon, type Pt } from "./bake/rasterize.ts";

const INPUT = process.argv[2] ?? "data/osm/kherson.json.gz";
const OUT_DIR = process.argv[3] ?? "public/world";

const t0 = Date.now();
let tLast = t0;
function stage(name: string): void {
  const now = Date.now();
  console.log(`[${((now - t0) / 1000).toFixed(1)}s] ${name} (+${((now - tLast) / 1000).toFixed(1)}s)`);
  tLast = now;
}

function hash(a: number, b = 0): number {
  let h = Math.imul(a | 0, 0x9e3779b1) ^ Math.imul((b | 0) + 0x7f4a7c15, 0x85ebca6b);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return h >>> 0;
}

const has = (v: string | undefined): boolean => v !== undefined && v !== "no";

// ---------------------------------------------------------------- geometry

interface Area {
  id: number;
  tags: Tags;
  rings: Pt[][];
}

function main_(osm: OsmData): { areas: Area[]; lines: { id: number; tags: Tags; pts: Pt[] }[] } {
  const { nodes, ways, relations } = osm;
  const ptsOf = (ids: number[]): Pt[] => {
    const out: Pt[] = [];
    for (const id of ids) {
      const i = nodes.find(id);
      if (i >= 0) out.push([nodes.xs[i]!, nodes.zs[i]!]);
    }
    return out;
  };

  const areas: Area[] = [];
  const lines: { id: number; tags: Tags; pts: Pt[] }[] = [];

  const areaKeys = ["building", "landuse", "natural", "leisure", "water", "place"];
  for (const w of ways.values()) {
    const t = w.tags;
    const closed = w.nodes.length >= 4 && w.nodes[0] === w.nodes[w.nodes.length - 1];
    let isArea = false;
    if (closed) {
      if (areaKeys.some((k) => t[k] !== undefined) || t.waterway === "riverbank") isArea = true;
      else if (t.highway && t.area === "yes") isArea = true;
      if (t.natural === "tree_row" || t.natural === "cliff" || t.natural === "coastline") isArea = false;
      if (t.place && t.place !== "square") isArea = !!(t.landuse || t.natural || t.leisure || t.building);
    }
    if (isArea) areas.push({ id: w.id, tags: t, rings: [ptsOf(w.nodes)] });
    if (t.highway || t.railway || t.waterway) {
      if (!(isArea && (t.highway || t.waterway === "riverbank"))) lines.push({ id: w.id, tags: t, pts: ptsOf(w.nodes) });
    } else if (t.bridge && t.name) {
      // named bridge without highway tag: only used for places
    }
  }

  // multipolygons
  for (const rel of relations) {
    if (rel.tags.type !== "multipolygon" && rel.tags.type !== "boundary") continue;
    const t = rel.tags;
    if (!(areaKeys.some((k) => t[k] !== undefined) || t.waterway === "riverbank")) continue;
    if (rel.tags.type === "boundary" && !t.natural && !t.landuse) continue;
    const outerSegs: number[][] = [];
    const innerSegs: number[][] = [];
    for (const m of rel.members) {
      if (m.type !== "way") continue;
      const w = ways.get(m.ref);
      if (!w || w.nodes.length < 2) continue;
      (m.role === "inner" ? innerSegs : outerSegs).push(w.nodes);
    }
    const outers = joinRings(outerSegs);
    if (outers.length === 0) continue;
    const inners = joinRings(innerSegs);
    const rings: Pt[][] = [...outers, ...inners].map(ptsOf).filter((r) => r.length >= 3);
    if (rings.length) areas.push({ id: rel.id, tags: t, rings });
  }
  return { areas, lines };
}

/** Join way segments (node id lists) into closed rings by matching endpoints. */
function joinRings(segs: number[][]): number[][] {
  const rings: number[][] = [];
  const open: number[][] = [];
  for (const s of segs) {
    if (s.length >= 4 && s[0] === s[s.length - 1]) rings.push(s);
    else open.push(s);
  }
  const byEnd = new Map<number, number[]>();
  const add = (id: number, si: number): void => {
    let l = byEnd.get(id);
    if (!l) byEnd.set(id, (l = []));
    l.push(si);
  };
  open.forEach((s, i) => {
    add(s[0]!, i);
    add(s[s.length - 1]!, i);
  });
  const used = new Uint8Array(open.length);
  for (let i = 0; i < open.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const ring = open[i]!.slice();
    for (;;) {
      const end = ring[ring.length - 1]!;
      if (ring.length >= 4 && end === ring[0]) {
        rings.push(ring);
        break;
      }
      const cand = byEnd.get(end)?.find((j) => !used[j]);
      if (cand === undefined) break; // dangling, drop
      used[cand] = 1;
      const s = open[cand]!;
      if (s[0] === end) for (let k = 1; k < s.length; k++) ring.push(s[k]!);
      else for (let k = s.length - 2; k >= 0; k--) ring.push(s[k]!);
    }
  }
  return rings;
}

// ---------------------------------------------------------------- classification

function groundClass(t: Tags): { mat: number; prio: number } | null {
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

function isWater(t: Tags): boolean {
  return (
    t.natural === "water" || t.waterway === "riverbank" || t.landuse === "reservoir" || t.landuse === "basin" ||
    (t.water !== undefined && t.natural === undefined && !t.waterway && !t.highway && !t.building)
  );
}

const HW: Record<string, number> = {
  motorway: 8, motorway_link: 6, trunk: 8, trunk_link: 6, primary: 8, primary_link: 6, secondary: 7, secondary_link: 5,
  tertiary: 6, tertiary_link: 4, residential: 4, unclassified: 4, living_street: 4, service: 2.5,
  pedestrian: 1.2, footway: 1.2, path: 1.2, cycleway: 1.2, steps: 1.2, track: 2,
};
const SIDEWALK_ROAD = new Set([
  "motorway", "motorway_link", "trunk", "trunk_link", "primary", "primary_link", "secondary", "secondary_link",
  "tertiary", "tertiary_link", "residential", "unclassified", "living_street",
]);

function parseNum(v: string | undefined): number | null {
  if (!v) return null;
  const n = parseFloat(v.replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function buildingSpec(id: number, t: Tags): { h: number; wall: number; roof: number } {
  const b = t.building!;
  const worship = b === "church" || b === "cathedral" || b === "chapel" || t.amenity === "place_of_worship";
  const houseLike = b === "house" || b === "detached" || b === "semidetached_house" || b === "bungalow" || b === "terrace" || b === "farm";
  let hm = parseNum(t.height);
  if (hm === null) {
    const lv = parseNum(t["building:levels"]);
    if (lv !== null) hm = lv * 3 + 1;
  }
  if (hm === null) {
    if (worship) hm = 18;
    else if (houseLike || b === "residential") hm = 7;
    else if (b === "apartments") hm = 15;
    else if (b === "industrial" || b === "warehouse") hm = 8;
    else if (b === "garage" || b === "garages" || b === "shed" || b === "roof") hm = 3;
    else hm = 9;
  }
  const h = Math.max(1, Math.min(120, Math.round(hm / VOXEL)));
  let wall: number = MAT.WALL_PUBLIC;
  if (worship) wall = MAT.WALL_CHURCH;
  else if (houseLike) wall = MAT.WALL_HOUSE;
  else if (b === "apartments" || b === "residential") wall = MAT.WALL_APART;
  else if (b === "industrial" || b === "warehouse" || b === "garage" || b === "garages") wall = MAT.WALL_INDUSTRIAL;
  const hh = hash(id);
  let roof: number;
  if (worship) roof = hh & 1 ? MAT.ROOF_GOLD : MAT.ROOF_GREEN;
  else if (b === "house" || b === "detached" || b === "semidetached_house" || b === "bungalow") roof = MAT.ROOF_RED;
  else roof = hh & 1 ? MAT.ROOF_GREY : MAT.ROOF_DARK;
  return { h, wall, roof };
}

// ---------------------------------------------------------------- main

async function main(): Promise<void> {
  if (!fs.existsSync(INPUT)) throw new Error(`missing ${INPUT}`);
  const osm = await loadOsm(INPUT);
  stage(`loaded ${osm.counts.nodes} nodes, ${osm.counts.ways} ways, ${osm.counts.relations} relations`);
  const { areas, lines } = main_(osm);
  stage(`geometry: ${areas.length} areas, ${lines.length} lines`);

  const cellsX = Math.ceil(WORLD_W / VOXEL);
  const cellsZ = Math.ceil(WORLD_H / VOXEL);
  const grid = new Grid(cellsX, cellsZ);
  const stats = { buildings: 0, water: 0, landuse: 0, roads: 0, rails: 0, bridgeDecks: 0, trees: 0, plazas: 0 };

  // a. ground areas
  const gAreas: { mat: number; prio: number; a: Area }[] = [];
  for (const a of areas) {
    const g = groundClass(a.tags);
    if (g) gAreas.push({ ...g, a });
  }
  gAreas.sort((p, q) => p.prio - q.prio);
  for (const { mat, a } of gAreas) {
    fillPolygon(a.rings, (cx, cz) => grid.set(F_GROUND_MAT, cx, cz, mat));
    stats.landuse++;
  }
  stage(`ground areas: ${gAreas.length}`);

  // b. water
  const setWater = (cx: number, cz: number): void => {
    grid.set(F_GROUND_MAT, cx, cz, MAT.WATER);
    grid.set(F_GROUND_H, cx, cz, 1);
  };
  for (const a of areas) {
    if (!isWater(a.tags)) continue;
    fillPolygon(a.rings, setWater);
    stats.water++;
  }
  for (const l of lines) {
    const ww = l.tags.waterway;
    if (!ww || has(l.tags.tunnel) || l.tags.culvert === "yes") continue;
    let width = parseNum(l.tags.width);
    if (ww === "river") width ??= 40;
    else if (ww === "canal") width ??= 10;
    else if (ww === "stream") width ??= 3;
    else continue;
    bufferLine(l.pts, width / 2 / VOXEL, setWater);
    stats.water++;
  }
  stage(`water: ${stats.water}`);

  // c. roads & rails
  const deckSeen = new Set<number>();
  const deck = (cx: number, cz: number): void => {
    if (!grid.inside(cx, cz)) return;
    const k = cx * 100000 + cz;
    if (deckSeen.has(k)) return;
    deckSeen.add(k);
    grid.addFeature(FEATURE_BRIDGE_DECK, 3, cx, cz);
    stats.bridgeDecks++;
  };
  const paint = (mat: number, bridge: boolean) => (cx: number, cz: number): void => {
    const g = grid.get(F_GROUND_MAT, cx, cz);
    if (g === MAT.WATER) {
      if (bridge) {
        deck(cx, cz);
        return;
      }
      grid.set(F_GROUND_H, cx, cz, 2);
    }
    grid.set(F_GROUND_MAT, cx, cz, mat);
  };
  const roads: { hw: number; mat: number; bridge: boolean; sidewalk: boolean; pts: Pt[] }[] = [];
  for (const l of lines) {
    const t = l.tags;
    if (has(t.tunnel)) continue;
    const bridge = has(t.bridge);
    if (t.highway) {
      const hwM = HW[t.highway];
      if (hwM === undefined) continue;
      const mat = t.highway === "track" ? MAT.DIRT : hwM <= 1.2 ? MAT.SIDEWALK : MAT.ASPHALT;
      roads.push({ hw: hwM, mat, bridge, sidewalk: SIDEWALK_ROAD.has(t.highway), pts: l.pts });
    } else if (t.railway === "rail" || t.railway === "tram") {
      roads.push({ hw: 1.2, mat: MAT.RAIL, bridge, sidewalk: false, pts: l.pts });
    }
  }
  roads.sort((a, b) => a.hw - b.hw);
  for (const r of roads) {
    bufferLine(r.pts, r.hw / VOXEL, paint(r.mat, r.bridge));
    if (r.mat === MAT.RAIL) stats.rails++;
    else stats.roads++;
  }
  for (const r of roads) {
    if (!r.sidewalk || r.bridge) continue;
    bufferLine(r.pts, r.hw / VOXEL + 1, (cx, cz) => {
      const g = grid.get(F_GROUND_MAT, cx, cz);
      if (g === MAT.ASPHALT || g === MAT.WATER || g === MAT.RAIL || g === MAT.SIDEWALK) return;
      grid.set(F_GROUND_MAT, cx, cz, MAT.SIDEWALK);
    });
  }
  stage(`roads: ${stats.roads}, rails: ${stats.rails}, bridge decks: ${stats.bridgeDecks}`);

  // d. buildings
  for (const a of areas) {
    const t = a.tags;
    if (!has(t.building)) continue;
    const spec = buildingSpec(a.id, t);
    let n = 0;
    const put = (cx: number, cz: number): void => {
      if (!grid.inside(cx, cz) || grid.get(F_GROUND_MAT, cx, cz) === MAT.WATER) return;
      grid.set(F_STRUCT_H, cx, cz, spec.h);
      grid.set(F_STRUCT_MAT, cx, cz, spec.wall);
      grid.set(F_ROOF_MAT, cx, cz, spec.roof);
      n++;
    };
    fillPolygon(a.rings, put);
    if (n === 0) {
      let sx = 0, sz = 0;
      const r = a.rings[0]!;
      for (const p of r) { sx += p[0]; sz += p[1]; }
      put(Math.floor(sx / r.length), Math.floor(sz / r.length));
    }
    stats.buildings++;
  }
  stage(`buildings: ${stats.buildings}`);

  // e. trees
  const treeCells = new Set<number>();
  const treeKey = (cx: number, cz: number): number => cx * 100000 + cz;
  const canTree = (cx: number, cz: number): boolean => {
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (treeCells.has(treeKey(cx + dx, cz + dz))) return false;
    return true;
  };
  for (const n of osm.taggedNodes) {
    if (n.tags.natural !== "tree") continue;
    const cx = Math.floor(n.cx), cz = Math.floor(n.cz);
    if (!grid.inside(cx, cz) || grid.get(F_STRUCT_H, cx, cz) !== 0) continue;
    const g = grid.get(F_GROUND_MAT, cx, cz);
    if (g === MAT.WATER || g === MAT.ASPHALT || g === MAT.RAIL) continue;
    if (!canTree(cx, cz)) continue;
    treeCells.add(treeKey(cx, cz));
    grid.addFeature(FEATURE_TREE, 5, cx, cz);
    stats.trees++;
  }
  for (const [k, cells] of [...grid.regions]) {
    const rx = Math.floor(k / 65536), rz = k % 65536;
    const P = REGION * REGION;
    for (let lz = 0; lz < REGION; lz++) {
      for (let lx = 0; lx < REGION; lx++) {
        const i = lz * REGION + lx;
        const g = cells[F_GROUND_MAT * P + i]!;
        if ((g !== MAT.PARK && g !== MAT.FOREST) || cells[F_STRUCT_H * P + i] !== 0) continue;
        const cx = rx * REGION + lx, cz = rz * REGION + lz;
        const h = hash(cx, cz);
        const prob = g === MAT.PARK ? 0.04 : 0.12;
        if ((h & 0xffff) / 65536 >= prob) continue;
        if (!canTree(cx, cz)) continue;
        treeCells.add(treeKey(cx, cz));
        grid.addFeature(FEATURE_TREE, 4 + ((h >>> 16) % 4), cx, cz);
        stats.trees++;
      }
    }
  }
  stage(`trees: ${stats.trees}`);

  // places
  const places = collectPlaces(osm, areas, lines);
  stage(`places: ${places.length}`);

  // spawn
  const spawn = findSpawn(places, grid, areas);
  stage(`spawn: ${spawn[0].toFixed(1)}, ${spawn[1].toFixed(1)}`);

  // write
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const f of fs.readdirSync(OUT_DIR)) if (/^r_.*\.bin$/.test(f)) fs.unlinkSync(path.join(OUT_DIR, f));
  const manifestRegions: Record<string, string> = {};
  let written = 0, empty = 0, totalBytes = 0, largest = { name: "", size: 0 };
  for (let rz = 0; rz < grid.regionsZ; rz++) {
    for (let rx = 0; rx < grid.regionsX; rx++) {
      const k = Grid.key(rx, rz);
      const cells = grid.regions.get(k);
      const feats = grid.features.get(k) ?? [];
      if (!cells || (feats.length === 0 && Buffer.compare(cells, DEFAULT_CELLS) === 0)) {
        manifestRegions[`${rx},${rz}`] = "empty";
        empty++;
        continue;
      }
      const buf = encodeRegion({ rx, rz, cells, features: feats });
      const name = `r_${rx}_${rz}.bin`;
      fs.writeFileSync(path.join(OUT_DIR, name), buf);
      manifestRegions[`${rx},${rz}`] = name;
      written++;
      totalBytes += buf.length;
      if (buf.length > largest.size) largest = { name, size: buf.length };
    }
  }
  const manifest = {
    version: 1,
    voxel: VOXEL,
    chunk: CHUNK,
    region: REGION,
    regionsX: grid.regionsX,
    regionsZ: grid.regionsZ,
    bbox: BBOX,
    origin: "NW",
    regions: manifestRegions,
    spawn,
  };
  fs.writeFileSync(path.join(OUT_DIR, "manifest.json"), JSON.stringify(manifest));
  fs.writeFileSync(path.join(OUT_DIR, "places.json"), JSON.stringify(places));
  stage("written");
  console.log(
    `regions: ${grid.regionsX}x${grid.regionsZ}=${grid.regionsX * grid.regionsZ}, written ${written}, empty ${empty}, ` +
      `bytes ${totalBytes}, largest ${largest.name} ${largest.size}`,
  );
  console.log("stats", JSON.stringify(stats));
  console.log(`spawn world (m): ${spawn[0].toFixed(1)}, ${spawn[1].toFixed(1)}; total ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

// ---------------------------------------------------------------- places

interface Place { name: string; nameEn?: string; kind: string; x: number; z: number }
const KIND_ORDER = [
  "city", "town", "square", "district", "suburb", "quarter", "neighbourhood", "village", "island", "hamlet",
  "bridge", "townhall", "university", "theatre", "museum", "attraction", "place_of_worship", "park", "historic",
];

function placeKind(t: Tags, isBridge: boolean): string | null {
  if (t.place === "square") return "square";
  if (t.place) return t.place;
  if (t.leisure === "park") return "park";
  if (t.amenity === "place_of_worship" || t.amenity === "theatre" || t.amenity === "university" || t.amenity === "townhall") return t.amenity;
  if (t.tourism === "museum" || t.tourism === "attraction") return t.tourism;
  if (t.historic) return "historic";
  if (isBridge) return "bridge";
  return null;
}

function collectPlaces(osm: OsmData, areas: Area[], lines: { id: number; tags: Tags; pts: Pt[] }[]): Place[] {
  const raw: Place[] = [];
  const push = (t: Tags, kind: string | null, cx: number, cz: number): void => {
    const name = t.name;
    if (!name || !kind) return;
    const p: Place = { name, kind, x: Math.round(cx * VOXEL * 10) / 10, z: Math.round(cz * VOXEL * 10) / 10 };
    if (t["name:en"]) p.nameEn = t["name:en"];
    raw.push(p);
  };
  for (const n of osm.taggedNodes) push(n.tags, placeKind(n.tags, false), n.cx, n.cz);
  const centroid = (r: Pt[]): [number, number] => {
    let sx = 0, sz = 0;
    for (const p of r) { sx += p[0]; sz += p[1]; }
    return [sx / r.length, sz / r.length];
  };
  for (const a of areas) {
    if (!a.tags.name || has(a.tags.building) && !a.tags.amenity && !a.tags.tourism && !a.tags.historic) continue;
    const k = placeKind(a.tags, false);
    if (k) { const [cx, cz] = centroid(a.rings[0]!); push(a.tags, k, cx, cz); }
  }
  for (const l of lines) {
    if (l.tags.name && has(l.tags.bridge) && l.pts.length) {
      const p = l.pts[Math.floor(l.pts.length / 2)]!;
      push(l.tags, "bridge", p[0], p[1]);
    }
  }
  // non-line bridge ways without highway/railway tags are rare; skip.
  const rank = (k: string): number => { const i = KIND_ORDER.indexOf(k); return i < 0 ? 99 : i; };
  raw.sort((a, b) => rank(a.kind) - rank(b.kind));
  const seen = new Map<string, Place[]>();
  const out: Place[] = [];
  for (const p of raw) {
    const list = seen.get(p.name);
    if (list?.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < 50)) continue;
    if (list) list.push(p); else seen.set(p.name, [p]);
    out.push(p);
    if (out.length >= 400) break;
  }
  return out;
}

function findSpawn(places: Place[], grid: Grid, areas: Area[]): [number, number] {
  const re = /Свобод|Svobod|Freedom/i;
  const cand =
    places.find((p) => p.kind === "square" && (re.test(p.name) || re.test(p.nameEn ?? ""))) ??
    places.find((p) => re.test(p.name) || re.test(p.nameEn ?? ""));
  let x: number, z: number;
  if (cand) {
    x = cand.x; z = cand.z;
    console.log(`spawn from place "${cand.name}" (${cand.kind})`);
  } else {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const a of areas) {
      if (!has(a.tags.building)) continue;
      for (const p of a.rings[0]!) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
    }
    x = ((x0 + x1) / 2) * VOXEL; z = ((z0 + z1) / 2) * VOXEL;
    console.log("spawn from building bbox centre (no Freedom Square found)");
  }
  // move to nearest walkable (non-building, non-water) cell
  const walk = (cx: number, cz: number): boolean => {
    const g = grid.get(F_GROUND_MAT, cx, cz);
    return grid.get(F_STRUCT_H, cx, cz) === 0 && g !== MAT.WATER;
  };
  const sx = Math.floor(x / VOXEL), sz = Math.floor(z / VOXEL);
  for (let r = 0; r < 60; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        if (walk(sx + dx, sz + dz)) return [(sx + dx + 0.5) * VOXEL, (sz + dz + 0.5) * VOXEL];
      }
    }
  }
  return [x, z];
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

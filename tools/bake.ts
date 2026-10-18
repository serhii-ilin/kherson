import fs from "node:fs";
import path from "node:path";
import {
  CHUNK, F_GROUND_H, F_GROUND_MAT, F_ROOF_MAT, F_STRUCT_H, F_STRUCT_MAT, REGION, VOXEL,
} from "../src/world/constants.ts";
import { FEATURE_BRIDGE_DECK, FEATURE_BUSH, FEATURE_TREE, encodeRegion } from "../src/world/format.ts";
import { SPECIES } from "../src/nature/models.ts";
import { MAT } from "../src/world/materials.ts";
import { BBOX } from "./bake/config.ts";
import { WORLD_H, WORLD_W } from "./bake/project.ts";
import { Grid, DEFAULT_CELLS } from "./bake/grid.ts";
import { buildOverview } from "./bake/overview.ts";
import { loadOsm, type OsmData, type Tags } from "./bake/osm.ts";
import { bufferLine, fillPolygon, type Pt } from "./bake/rasterize.ts";
import { buildingSpec, hash, parseNum } from "./bake/building-style.ts";

const INPUT = process.argv[2] ?? "data/osm/kherson.json.gz";
const OUT_DIR = process.argv[3] ?? "public/world";

const t0 = Date.now();
let tLast = t0;
function stage(name: string): void {
  const now = Date.now();
  console.log(`[${((now - t0) / 1000).toFixed(1)}s] ${name} (+${((now - tLast) / 1000).toFixed(1)}s)`);
  tLast = now;
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

const TREE_LINED = new Set(["residential", "living_street", "tertiary", "secondary", "primary"]);

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
  const stats = { buildings: 0, water: 0, landuse: 0, roads: 0, rails: 0, bridgeDecks: 0, trees: 0, streetTrees: 0, bushes: 0, plazas: 0 };

  // a. ground areas
  const gAreas: { mat: number; prio: number; a: Area }[] = [];
  for (const a of areas) {
    const g = groundClass(a.tags);
    if (g) gAreas.push({ ...g, a });
  }
  gAreas.sort((p, q) => p.prio - q.prio);
  // 0 unknown/broadleaved, 1 needleleaved, 2 mixed (only meaningful where ground is FOREST)
  const leafType = new Uint8Array(cellsX * cellsZ);
  for (const { mat, a } of gAreas) {
    const lt = a.tags.leaf_type === "needleleaved" ? 1 : a.tags.leaf_type === "mixed" ? 2 : 0;
    fillPolygon(a.rings, (cx, cz) => {
      grid.set(F_GROUND_MAT, cx, cz, mat);
      if (mat === MAT.FOREST && cx >= 0 && cz >= 0 && cx < cellsX && cz < cellsZ) leafType[cz * cellsX + cx] = lt;
    });
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
  const roads: { hw: number; mat: number; bridge: boolean; sidewalk: boolean; lined: boolean; pts: Pt[] }[] = [];
  for (const l of lines) {
    const t = l.tags;
    if (has(t.tunnel)) continue;
    const bridge = has(t.bridge);
    if (t.highway) {
      const hwM = HW[t.highway];
      if (hwM === undefined) continue;
      const mat = t.highway === "track" ? MAT.DIRT : hwM <= 1.2 ? MAT.SIDEWALK : MAT.ASPHALT;
      roads.push({ hw: hwM, mat, bridge, sidewalk: SIDEWALK_ROAD.has(t.highway), lined: TREE_LINED.has(t.highway), pts: l.pts });
    } else if (t.railway === "rail" || t.railway === "tram") {
      roads.push({ hw: 1.2, mat: MAT.RAIL, bridge, sidewalk: false, lined: false, pts: l.pts });
    }
  }
  roads.sort((a, b) => a.hw - b.hw);
  for (const r of roads) {
    bufferLine(r.pts, r.hw / VOXEL, paint(r.mat, r.bridge));
    if (r.mat === MAT.RAIL) stats.rails++;
    else stats.roads++;
  }
  const streetWalk = new Set<number>(); // sidewalk cells beside tree-lined road classes
  for (const r of roads) {
    if (!r.sidewalk || r.bridge) continue;
    const lined = r.lined;
    bufferLine(r.pts, r.hw / VOXEL + 1, (cx, cz) => {
      const g = grid.get(F_GROUND_MAT, cx, cz);
      if (g === MAT.ASPHALT || g === MAT.WATER || g === MAT.RAIL || g === MAT.SIDEWALK) return;
      grid.set(F_GROUND_MAT, cx, cz, MAT.SIDEWALK);
      if (lined) streetWalk.add(cx * 100000 + cz);
    });
  }
  stage(`roads: ${stats.roads}, rails: ${stats.rails}, bridge decks: ${stats.bridgeDecks}`);

  // d. buildings
  const places = collectPlaces(osm, areas, lines);
  stage(`places: ${places.length}`);
  const centre = findCentre(places, areas);
  const styleCounts = new Map<string, number>();
  for (const a of areas) {
    const t = a.tags;
    if (!has(t.building)) continue;
    const r0 = a.rings[0]!;
    let bx = 0, bz = 0;
    for (const p of r0) { bx += p[0]; bz += p[1]; }
    const dist = Math.hypot((bx / r0.length) * VOXEL - centre[0], (bz / r0.length) * VOXEL - centre[1]);
    let area2 = 0;
    for (let i = 0; i < r0.length; i++) {
      const p = r0[i]!, q = r0[(i + 1) % r0.length]!;
      area2 += p[0] * q[1] - q[0] * p[1];
    }
    const spec = buildingSpec(a.id, t, dist, (Math.abs(area2) / 2) * VOXEL * VOXEL);
    styleCounts.set(spec.style, (styleCounts.get(spec.style) ?? 0) + 1);
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
  console.log("building styles: " + [...styleCounts].sort((p, q) => q[1] - p[1]).map(([n, c]) => `${n}=${c}`).join(" "));

  // e. vegetation
  const S = SPECIES;
  type Table = readonly (readonly [number, number])[];
  const T_UNTAGGED: Table = [[S.GENERIC, 40], [S.CHESTNUT, 20], [S.LINDEN, 15], [S.ACACIA, 15], [S.POPLAR, 10]];
  const T_STREET: Table = [[S.CHESTNUT, 30], [S.LINDEN, 25], [S.ACACIA, 25], [S.PLANE, 10], [S.POPLAR, 10]];
  const T_PARK: Table = [[S.CHESTNUT, 30], [S.LINDEN, 25], [S.ACACIA, 15], [S.PLANE, 10], [S.POPLAR, 15], [S.WILLOW, 5]];
  const T_FOREST: Table = [[S.GENERIC, 40], [S.POPLAR, 20], [S.ACACIA, 20], [S.LINDEN, 10], [S.WILLOW, 10]];
  const T_ROW: Table = [[S.POPLAR, 40], [S.GENERIC, 30], [S.ACACIA, 30]];
  const pick = (table: Table, r: number): number => {
    let tot = 0;
    for (const e of table) tot += e[1];
    let acc = r * tot;
    for (const e of table) {
      if (acc < e[1]) return e[0];
      acc -= e[1];
    }
    return table[table.length - 1]![0];
  };
  const speciesName = new Map<number, string>(Object.entries(S).map(([n, v]) => [v, n]));
  const speciesCount = new Map<number, number>();

  const treeCells = new Set<number>();
  const bushCells = new Set<number>();
  const ck = (cx: number, cz: number): number => cx * 100000 + cz;
  const canTree = (cx: number, cz: number, r = 1): boolean => {
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) if (treeCells.has(ck(cx + dx, cz + dz))) return false;
    return true;
  };
  const free = (cx: number, cz: number): boolean => {
    if (!grid.inside(cx, cz) || grid.get(F_STRUCT_H, cx, cz) !== 0) return false;
    const g = grid.get(F_GROUND_MAT, cx, cz);
    return g !== MAT.WATER && g !== MAT.ASPHALT && g !== MAT.RAIL;
  };
  const addTree = (cx: number, cz: number, species: number, h: number): void => {
    treeCells.add(ck(cx, cz));
    grid.addFeature(FEATURE_TREE, 5, cx, cz, species, h & 255);
    stats.trees++;
    speciesCount.set(species, (speciesCount.get(species) ?? 0) + 1);
  };
  const nearWater = (cx: number, cz: number): boolean => {
    for (let dz = -10; dz <= 10; dz += 2) for (let dx = -10; dx <= 10; dx += 2) if (grid.get(F_GROUND_MAT, cx + dx, cz + dz) === MAT.WATER) return true;
    return false;
  };
  const ptsOfNodes = (ids: number[]): Pt[] => {
    const out: Pt[] = [];
    for (const id of ids) {
      const i = osm.nodes.find(id);
      if (i >= 0) out.push([osm.nodes.xs[i]!, osm.nodes.zs[i]!]);
    }
    return out;
  };

  // explicit natural=tree nodes
  const speciesOfTags = (t: Tags, h: number): number => {
    const txt = `${t.species ?? ""} ${t.genus ?? ""} ${t.taxon ?? ""}`.toLowerCase();
    if (txt.includes("populus")) return S.POPLAR;
    if (txt.includes("pinus")) return S.PINE;
    if (txt.includes("salix")) return S.WILLOW;
    if (txt.includes("robinia")) return S.ACACIA;
    if (txt.includes("aesculus")) return S.CHESTNUT;
    if (txt.includes("tilia")) return S.LINDEN;
    if (txt.includes("platanus")) return S.PLANE;
    if (/acer|ulmus|fraxinus|quercus|betula|carpinus|fagus|morus|juglans|prunus|malus|pyrus/.test(txt)) return S.GENERIC;
    if (t.leaf_type === "needleleaved") return S.PINE;
    return pick(T_UNTAGGED, (hash(h, 11) & 0xffff) / 65536);
  };
  for (const n of osm.taggedNodes) {
    if (n.tags.natural !== "tree") continue;
    const cx = Math.floor(n.cx), cz = Math.floor(n.cz);
    if (!free(cx, cz) || !canTree(cx, cz)) continue;
    const h = hash(cx, cz);
    addTree(cx, cz, speciesOfTags(n.tags, h), hash(h, 3));
  }
  stage(`trees from OSM nodes: ${stats.trees}`);

  // natural=tree_row lines
  let rows = 0, hedgeWays = 0;
  for (const w of osm.ways.values()) {
    if (w.tags.natural !== "tree_row") continue;
    const pts = ptsOfNodes(w.nodes);
    if (pts.length < 2) continue;
    rows++;
    let carry = 0;
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i]!, b = pts[i + 1]!;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      let d = carry;
      while (d <= len) {
        const t = len > 0 ? d / len : 0;
        const cx = Math.floor(a[0] + (b[0] - a[0]) * t), cz = Math.floor(a[1] + (b[1] - a[1]) * t);
        const h = hash(cx, cz);
        if (free(cx, cz) && canTree(cx, cz)) {
          const sp = w.tags.leaf_type === "needleleaved" ? S.PINE : pick(T_ROW, (hash(h, 5) & 0xffff) / 65536);
          addTree(cx, cz, sp, hash(h, 7));
        }
        d += 4 + (hash(h, 9) & 1);
      }
      carry = d - len;
    }
  }
  stage(`tree rows: ${rows}, trees ${stats.trees}`);

  // street trees on the sidewalk border of residential..primary roads
  {
    const keys = [...streetWalk].sort((p, q) => p - q);
    for (const k of keys) {
      const cx = Math.floor(k / 100000), cz = k % 100000;
      const h = hash(cx, cz);
      if ((h & 0xffff) / 65536 >= 0.4) continue;
      let ok = free(cx, cz);
      for (let dz = -1; ok && dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (grid.get(F_STRUCT_H, cx + dx, cz + dz) !== 0 || grid.get(F_GROUND_MAT, cx + dx, cz + dz) === MAT.WATER) { ok = false; break; }
        }
      }
      if (!ok || !canTree(cx, cz, 3)) continue;
      const hs = hash(h, 21);
      addTree(cx, cz, pick(T_STREET, ((hs >>> 8) & 0xffff) / 65536), hs);
      stats.streetTrees++;
    }
  }
  stage(`street trees: ${stats.streetTrees}, trees ${stats.trees}`);

  // park and forest trees
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
        const prob = g === MAT.PARK ? 0.07 : 0.1;
        if ((h & 0xffff) / 65536 >= prob) continue;
        if (!canTree(cx, cz)) continue;
        const hs = hash(h, 31);
        const r = ((hs >>> 8) & 0xffff) / 65536;
        let sp: number;
        if (g === MAT.FOREST) {
          const lt = cx < cellsX && cz < cellsZ ? leafType[cz * cellsX + cx]! : 0;
          if (lt === 1) sp = S.PINE;
          else if (lt === 2) sp = r < 0.5 ? S.PINE : S.GENERIC;
          else sp = pick(T_FOREST, r);
        } else sp = pick(T_PARK, r);
        if (sp !== S.PINE && sp !== S.WILLOW && nearWater(cx, cz) && ((hs >>> 24) & 255) / 256 < 0.6) sp = S.WILLOW;
        addTree(cx, cz, sp, hs);
      }
    }
  }
  stage(`trees: ${stats.trees}`);

  // bushes
  const addBush = (cx: number, cz: number, h: number, hedge: boolean): void => {
    const hs = hash(h, 41);
    let sp: number = S.BUSH;
    if (!hedge && ((hs >>> 8) & 255) / 256 < 0.12) sp = hs & 0x10000 ? S.BUSH_LILAC : S.BUSH_PINK;
    bushCells.add(ck(cx, cz));
    grid.addFeature(FEATURE_BUSH, 1 + ((hs >>> 20) % 3), cx, cz, sp, hs & 255);
    stats.bushes++;
    speciesCount.set(sp, (speciesCount.get(sp) ?? 0) + 1);
  };
  const bushOk = (cx: number, cz: number): boolean => free(cx, cz) && !treeCells.has(ck(cx, cz)) && !bushCells.has(ck(cx, cz));
  for (const [k, cells] of [...grid.regions]) {
    const rx = Math.floor(k / 65536), rz = k % 65536;
    const P = REGION * REGION;
    for (let lz = 0; lz < REGION; lz++) {
      for (let lx = 0; lx < REGION; lx++) {
        const i = lz * REGION + lx;
        const g = cells[F_GROUND_MAT * P + i]!;
        if (g !== MAT.PARK && g !== MAT.FOREST && g !== MAT.SIDEWALK && g !== MAT.GRASS) continue;
        if (cells[F_STRUCT_H * P + i] !== 0) continue;
        const cx = rx * REGION + lx, cz = rz * REGION + lz;
        const h = hash(cx + 77, cz + 191);
        const r = (h & 0xffff) / 65536;
        if (r >= 0.1) continue;
        if (g === MAT.PARK) {
          if (r >= 0.06) continue;
        } else if (g === MAT.FOREST) {
          if (r >= 0.04) continue;
        } else if (g === MAT.SIDEWALK) {
          let park = false;
          for (let dz = -1; dz <= 1 && !park; dz++) for (let dx = -1; dx <= 1; dx++) if (grid.get(F_GROUND_MAT, cx + dx, cz + dz) === MAT.PARK) { park = true; break; }
          if (!park) continue;
        } else {
          if (r >= 0.05) continue;
          let near = false;
          for (let dz = -3; dz <= 3 && !near; dz++) for (let dx = -3; dx <= 3; dx++) if (grid.get(F_STRUCT_H, cx + dx, cz + dz) !== 0) { near = true; break; }
          if (!near) continue;
        }
        if (bushOk(cx, cz)) addBush(cx, cz, h, false);
      }
    }
  }
  for (const w of osm.ways.values()) {
    if (w.tags.barrier !== "hedge") continue;
    const pts = ptsOfNodes(w.nodes);
    if (pts.length < 1) continue;
    hedgeWays++;
    bufferLine(pts, 0.5, (cx, cz) => {
      if (bushOk(cx, cz)) addBush(cx, cz, hash(cx, cz), true);
    });
  }
  stage(`bushes: ${stats.bushes} (hedge ways ${hedgeWays})`);
  console.log(
    "species: " + [...speciesCount].sort((p, q) => p[0] - q[0]).map(([id, n]) => `${speciesName.get(id)}=${n}`).join(" "),
  );

  // spawn
  const spawn = findSpawn(centre, grid);
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
  const overview = buildOverview(grid.regions, grid.regionsX, grid.regionsZ, DEFAULT_CELLS);
  fs.writeFileSync(path.join(OUT_DIR, "overview.bin"), overview);
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

/** Centre of the city (Freedom Square, else the building bbox centre), world metres. Also the historic-radius origin. */
function findCentre(places: Place[], areas: Area[]): [number, number] {
  const re = /Свобод|Svobod|Freedom/i;
  const cand =
    places.find((p) => p.kind === "square" && (re.test(p.name) || re.test(p.nameEn ?? ""))) ??
    places.find((p) => re.test(p.name) || re.test(p.nameEn ?? ""));
  if (cand) {
    console.log(`centre from place "${cand.name}" (${cand.kind})`);
    return [cand.x, cand.z];
  }
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const a of areas) {
    if (!has(a.tags.building)) continue;
    for (const p of a.rings[0]!) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
  }
  console.log("centre from building bbox centre (no Freedom Square found)");
  return [((x0 + x1) / 2) * VOXEL, ((z0 + z1) / 2) * VOXEL];
}

function findSpawn(centre: [number, number], grid: Grid): [number, number] {
  const [x, z] = centre;
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

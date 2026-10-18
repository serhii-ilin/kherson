import fs from "node:fs";
import path from "node:path";
import {
  CHUNK, F_GROUND_H, F_GROUND_MAT, F_ROOF_MAT, F_STRUCT_H, F_STRUCT_MAT, REGION, VOXEL,
} from "../src/world/constants.ts";
import { FEATURE_BRIDGE_DECK, FEATURE_BUSH, FEATURE_TREE, encodeRegion, packStruct } from "../src/world/format.ts";
import { SPECIES } from "../src/nature/models.ts";
import { MAT } from "../src/world/materials.ts";
import { BBOX, CITY_DILATE_M, CITY_RELATION } from "./bake/config.ts";
import { buildCityMask, keepOutsideGround, ringCentroid, type CityMask } from "./bake/city-mask.ts";
import { WORLD_H, WORLD_W } from "./bake/project.ts";
import { Grid, DEFAULT_CELLS } from "./bake/grid.ts";
import { buildOverview } from "./bake/overview.ts";
import { loadOsm, type OsmData, type Tags } from "./bake/osm.ts";
import { bufferLine, fillPolygon, type Pt } from "./bake/rasterize.ts";
import { buildingSpec, hash, parseNum } from "./bake/building-style.ts";
import { dedupePlaces, nudgeToWalkable, type Place } from "./bake/places.ts";
import { buildVectorTiles, roadWidthCm } from "./bake/vectors.ts";
import { Obstacles, type RoadObstacle } from "./bake/obstacles.ts";
import { distanceTransform, DIST_UNIT } from "./bake/distance.ts";
import { encodeVectorTile } from "../src/world/vector-format.ts";
import { HW, SIDEWALK_ROAD, groundClass, isWater } from "./bake/classes.ts";
import { collectStreets } from "./bake/streets.ts";

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

interface Line {
  id: number;
  tags: Tags;
  pts: Pt[];
  /** OSM node id of each point of `pts` (same length). */
  nodeIds: number[];
}

function main_(osm: OsmData): { areas: Area[]; lines: Line[]; barriers: Line[] } {
  const { nodes, ways, relations } = osm;
  const ptsOf = (ids: number[]): Pt[] => {
    const out: Pt[] = [];
    for (const id of ids) {
      const i = nodes.find(id);
      if (i >= 0) out.push([nodes.xs[i]!, nodes.zs[i]!]);
    }
    return out;
  };

  const ptsIdsOf = (ids: number[]): { pts: Pt[]; nodeIds: number[] } => {
    const pts: Pt[] = [];
    const nodeIds: number[] = [];
    for (const id of ids) {
      const i = nodes.find(id);
      if (i >= 0) {
        pts.push([nodes.xs[i]!, nodes.zs[i]!]);
        nodeIds.push(id);
      }
    }
    return { pts, nodeIds };
  };

  const areas: Area[] = [];
  const lines: Line[] = [];
  const barriers: Line[] = []; // vector tiles only; the coarse bake ignores barrier ways

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
    if (t.barrier) barriers.push({ id: w.id, tags: t, ...ptsIdsOf(w.nodes) });
    if (t.highway || t.railway || t.waterway) {
      if (!(isArea && (t.highway || t.waterway === "riverbank"))) lines.push({ id: w.id, tags: t, ...ptsIdsOf(w.nodes) });
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
  return { areas, lines, barriers };
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

const TREE_LINED = new Set(["residential", "living_street", "tertiary", "secondary", "primary"]);

// ---------------------------------------------------------------- main

async function main(): Promise<void> {
  if (!fs.existsSync(INPUT)) throw new Error(`missing ${INPUT}`);
  const osm = await loadOsm(INPUT);
  stage(`loaded ${osm.counts.nodes} nodes, ${osm.counts.ways} ways, ${osm.counts.relations} relations`);
  const { areas, lines, barriers } = main_(osm);
  stage(`geometry: ${areas.length} areas, ${lines.length} lines`);

  const cellsX = Math.ceil(WORLD_W / VOXEL);
  const cellsZ = Math.ceil(WORLD_H / VOXEL);
  const grid = new Grid(cellsX, cellsZ);
  const cityArea = areas.find((a) => a.id === CITY_RELATION && a.tags.place === "city");
  if (!cityArea) throw new Error(`city boundary relation ${CITY_RELATION} not found in ${INPUT}; refusing to bake everything`);
  const mask = buildCityMask(cityArea.rings, cellsX, cellsZ, CITY_DILATE_M / VOXEL);
  const inCity = (cx: number, cz: number): boolean => mask.hasCell(cx, cz);
  stage("city mask");
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
  // cells of sand / beach / heath ground: sources of the "sandy ground" distance for the pine rule (#17)
  const sandSrc = new Uint8Array(cellsX * cellsZ);
  for (const { mat, a } of gAreas) {
    const lt = a.tags.leaf_type === "needleleaved" ? 1 : a.tags.leaf_type === "mixed" ? 2 : 0;
    const natural = keepOutsideGround(a.tags);
    fillPolygon(a.rings, (cx, cz) => {
      if (!natural && !inCity(cx, cz)) return;
      grid.set(F_GROUND_MAT, cx, cz, mat);
      if (cx >= 0 && cz >= 0 && cx < cellsX && cz < cellsZ) sandSrc[cz * cellsX + cx] = mat === MAT.SAND || a.tags.natural === "heath" ? 1 : 0;
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
    if (!inCity(cx, cz)) return;
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
      if (!inCity(cx, cz)) return;
      const g = grid.get(F_GROUND_MAT, cx, cz);
      if (g === MAT.ASPHALT || g === MAT.WATER || g === MAT.RAIL || g === MAT.SIDEWALK) return;
      grid.set(F_GROUND_MAT, cx, cz, MAT.SIDEWALK);
      if (lined) streetWalk.add(cx * 100000 + cz);
    });
  }
  stage(`roads: ${stats.roads}, rails: ${stats.rails}, bridge decks: ${stats.bridgeDecks}`);

  // c2. floodplain ground (#10). Plain grass OUTSIDE the city mask is repainted by distance to water (OSM water polygons and
  // buffered waterway lines): a fringe <= 6 m is mostly reed with wet patches, <= 40 m wetland / reed / meadow patches,
  // <= 120 m meadow patches, and beyond that sparse meadow patches (25% of 32 m blocks). Patches come from a hash of
  // the 8 m / 16 m / 32 m block, never Math.random. Explicit OSM wetland / scrub / meadow / forest polygons (painted
  // above) win because only GRASS cells are touched. Inside the city nothing changes (wetland polygons still paint).
  const waterDist = (() => {
    const src = new Uint8Array(cellsX * cellsZ);
    for (const [k, cells] of grid.regions) {
      const rx0 = Math.floor(k / 65536) * REGION, rz0 = (k % 65536) * REGION;
      for (let lz = 0; lz < REGION; lz++) {
        const cz = rz0 + lz;
        if (cz >= cellsZ) break;
        for (let lx = 0; lx < REGION; lx++) {
          const cx = rx0 + lx;
          if (cx < cellsX && cells[F_GROUND_MAT * REGION * REGION + lz * REGION + lx] === MAT.WATER) src[cz * cellsX + cx] = 1;
        }
      }
    }
    return distanceTransform(src, cellsX, cellsZ);
  })();
  const sandDist = distanceTransform(sandSrc, cellsX, cellsZ);
  const floodCounts = { reed: 0, wetland: 0, meadow: 0 };
  for (let cz = 0; cz < cellsZ; cz++) {
    for (let cx = 0; cx < cellsX; cx++) {
      const d3 = waterDist[cz * cellsX + cx]!;
      if (inCity(cx, cz) || grid.get(F_GROUND_MAT, cx, cz) !== MAT.GRASS) continue;
      const d = d3 / DIST_UNIT;
      let m: number = MAT.GRASS;
      if (d <= 3) {
        const r = (hash(cx >> 2, cz >> 2) & 255) / 256;
        m = r < 0.5 ? MAT.REED : r < 0.72 ? MAT.WETLAND : MAT.MEADOW;
      } else if (d <= 20) {
        const r = (hash(cx >> 2, (cz >> 2) + 7001) & 255) / 256;
        m = r < 0.2 ? MAT.WETLAND : r < 0.4 ? MAT.REED : MAT.MEADOW;
      } else if (d <= 60) {
        if ((hash(cx >> 3, (cz >> 3) + 9001) & 255) / 256 < 0.6) m = MAT.MEADOW;
      } else if ((hash(cx >> 4, (cz >> 4) + 11003) & 255) / 256 < 0.25) m = MAT.MEADOW;
      if (m === MAT.GRASS) continue;
      grid.set(F_GROUND_MAT, cx, cz, m);
      if (m === MAT.REED) floodCounts.reed++;
      else if (m === MAT.WETLAND) floodCounts.wetland++;
      else floodCounts.meadow++;
    }
  }
  stage(`floodplain ground: ${JSON.stringify(floodCounts)}`);

  // d. buildings
  const places = collectPlaces(osm, areas, lines, mask);
  stage(`places: ${places.length}`);
  const centre = findCentre(places, areas);
  const styleCounts = new Map<string, number>();
  for (const a of areas) {
    const t = a.tags;
    if (!has(t.building)) continue;
    const r0 = a.rings[0]!;
    const bc = ringCentroid(r0);
    if (!mask.hasPoint(bc[0], bc[1])) continue;
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
    // contract 1 (region format v2): per-building tint 0..3 in the high 2 bits of the wall byte
    const structByte = packStruct(spec.wall, hash(a.id, 0x7177) >>> 30);
    let n = 0;
    const put = (cx: number, cz: number): void => {
      if (!grid.inside(cx, cz) || grid.get(F_GROUND_MAT, cx, cz) === MAT.WATER) return;
      grid.set(F_STRUCT_H, cx, cz, spec.h);
      grid.set(F_STRUCT_MAT, cx, cz, structByte);
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
  // teleport safety: snap every non-street place to the nearest walkable (not water, not building) cell within 60 m
  {
    const walkable = (cx: number, cz: number): boolean => grid.get(F_STRUCT_H, cx, cz) === 0 && grid.get(F_GROUND_MAT, cx, cz) !== MAT.WATER;
    let moved = 0;
    for (let i = 0; i < places.length; i++) {
      const p = places[i]!;
      if (p.kind === "street") continue;
      const q = nudgeToWalkable(p, walkable, VOXEL, 30);
      if (q !== p) { places[i] = q; moved++; }
    }
    stage(`places nudged to walkable ground: ${moved}`);
  }
  console.log("building styles: " + [...styleCounts].sort((p, q) => q[1] - p[1]).map(([n, c]) => `${n}=${c}`).join(" "));

  // d2. vector tiles (built here, written with the rest)
  const vec = buildVectorTiles({
    areas, lines, barriers, taggedNodes: osm.taggedNodes, regionsX: grid.regionsX, regionsZ: grid.regionsZ, centre,
    inCity: (xCm, zCm) => mask.hasPoint(xCm / (VOXEL * 100), zCm / (VOXEL * 100)),
  });
  stage(`vector tiles: ${vec.tiles.size}`);

  // #6: exact-position obstacles for vegetation: vehicle carriageways (vector road width / 2 + 0.6 m) and building footprints (+ 0.5 m)
  const obstacleRoads: RoadObstacle[] = [];
  for (const l of lines) {
    const hw = l.tags.highway;
    if (!hw || HW[hw] === undefined || has(l.tags.tunnel) || l.tags.area === "yes") continue;
    const base = hw.endsWith("_link") ? hw.slice(0, -5) : hw;
    if (HW[base] === undefined || (HW[base]! <= 1.2 && base !== "service") || base === "track") continue; // footways and paths carry no carriageway
    obstacleRoads.push({ pts: l.pts, widthM: roadWidthCm(l.tags, base === hw ? hw : base) / 100 });
  }
  const obstacleBuildings: Pt[][][] = [];
  for (const a of areas) {
    if (!has(a.tags.building) || !a.rings[0] || a.rings[0].length < 3) continue;
    const bc = ringCentroid(a.rings[0]);
    if (mask.hasPoint(bc[0], bc[1])) obstacleBuildings.push(a.rings);
  }
  const obstacles = new Obstacles(obstacleRoads, obstacleBuildings);
  const plantStats = { moved: 0, dropped: 0 };

  // e. vegetation
  const S = SPECIES;
  type Table = readonly (readonly [number, number])[];
  const T_UNTAGGED: Table = [[S.GENERIC, 40], [S.CHESTNUT, 20], [S.LINDEN, 15], [S.ACACIA, 15], [S.POPLAR, 10]];
  const T_STREET: Table = [[S.CHESTNUT, 30], [S.LINDEN, 25], [S.ACACIA, 25], [S.PLANE, 10], [S.POPLAR, 10]];
  const T_PARK: Table = [[S.CHESTNUT, 30], [S.LINDEN, 25], [S.ACACIA, 15], [S.PLANE, 10], [S.POPLAR, 15], [S.WILLOW, 5]];
  const T_FOREST: Table = [[S.GENERIC, 40], [S.POPLAR, 20], [S.ACACIA, 20], [S.LINDEN, 10], [S.WILLOW, 10]];
  // floodplain (#10): wetlands and reed are willow country, meadows carry sparse mixed trees, scrub a few
  const T_WETLAND: Table = [[S.WILLOW, 70], [S.POPLAR, 20], [S.GENERIC, 10]];
  const T_REED: Table = [[S.WILLOW, 80], [S.POPLAR, 20]];
  const T_MEADOW: Table = [[S.GENERIC, 30], [S.POPLAR, 25], [S.ACACIA, 25], [S.WILLOW, 20]];
  const T_SCRUB: Table = [[S.GENERIC, 40], [S.ACACIA, 35], [S.POPLAR, 15], [S.WILLOW, 10]];
  // sandy-ground forest (#17): see the pine rule below
  const T_SAND_FOREST: Table = [[S.ACACIA, 45], [S.GENERIC, 40], [S.POPLAR, 15]];
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
  /** Places a tree; its seed (jitter) is nudged off carriageways and building footprints, or the tree is dropped (#6). */
  const addTree = (cx: number, cz: number, species: number, h: number): boolean => {
    const s0 = h & 255;
    const seed = obstacles.freeSeed(cx, cz, s0);
    if (seed < 0) {
      plantStats.dropped++;
      return false;
    }
    if (seed !== s0) plantStats.moved++;
    treeCells.add(ck(cx, cz));
    grid.addFeature(FEATURE_TREE, 5, cx, cz, species, seed);
    stats.trees++;
    speciesCount.set(species, (speciesCount.get(species) ?? 0) + 1);
    return true;
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
    if (!inCity(cx, cz) || !free(cx, cz) || !canTree(cx, cz)) continue;
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
        if (inCity(cx, cz) && free(cx, cz) && canTree(cx, cz)) {
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
      if (addTree(cx, cz, pick(T_STREET, ((hs >>> 8) & 0xffff) / 65536), hs)) stats.streetTrees++;
    }
  }
  stage(`street trees: ${stats.streetTrees}, trees ${stats.trees}`);

  // park, forest and floodplain trees
  // #17 pine rule: OSM forests carry no leaf_type, so every FOREST cell without one would be broadleaf. Kherson's forests
  // on sandy ground (the Dnipro sands, planted with pines) are mostly PINE: a forest cell within PINE_BELT_CELLS (80 cells =
  // 160 m) of SAND / beach / natural=sand / natural=heath ground becomes PINE with 70%, else acacia / generic / poplar.
  // Forest further from sand keeps the broadleaf mix. Explicit leaf_type tags always win.
  const PINE_BELT = 80 * DIST_UNIT;
  const pineStats = { sandyForestTrees: 0, pines: 0 };
  for (const [k, cells] of [...grid.regions]) {
    const rx = Math.floor(k / 65536), rz = k % 65536;
    const P = REGION * REGION;
    for (let lz = 0; lz < REGION; lz++) {
      for (let lx = 0; lx < REGION; lx++) {
        const i = lz * REGION + lx;
        const g = cells[F_GROUND_MAT * P + i]!;
        if (cells[F_STRUCT_H * P + i] !== 0) continue;
        const cx = rx * REGION + lx, cz = rz * REGION + lz;
        const inGrid = cx < cellsX && cz < cellsZ;
        const wd3 = inGrid ? waterDist[cz * cellsX + cx]! : 255;
        let prob: number;
        let table: Table;
        if (g === MAT.PARK) { prob = 0.07; table = T_PARK; }
        else if (g === MAT.FOREST) { prob = 0.1; table = T_FOREST; }
        else if (g === MAT.WETLAND) { prob = 0.012; table = T_WETLAND; }
        else if (g === MAT.REED) { prob = 0.004; table = T_REED; }
        else if (g === MAT.MEADOW) { prob = 0.002; table = T_MEADOW; }
        else if (g === MAT.SCRUB) { prob = 0.03; table = T_SCRUB; }
        else if (g === MAT.GRASS && wd3 <= 3 * DIST_UNIT) { prob = 0.02; table = T_REED; } // willows along water edges
        else continue;
        const h = hash(cx, cz);
        if ((h & 0xffff) / 65536 >= prob) continue;
        if (!canTree(cx, cz)) continue;
        const hs = hash(h, 31);
        const r = ((hs >>> 8) & 0xffff) / 65536;
        let sp: number;
        let sandy = false;
        if (g === MAT.FOREST) {
          const lt = inGrid ? leafType[cz * cellsX + cx]! : 0;
          if (lt === 1) sp = S.PINE;
          else if (lt === 2) sp = r < 0.5 ? S.PINE : S.GENERIC;
          else if (inGrid && sandDist[cz * cellsX + cx]! <= PINE_BELT) {
            sandy = true;
            sp = r < 0.7 ? S.PINE : pick(T_SAND_FOREST, ((hs >>> 4) & 0xffff) / 65536);
          } else sp = pick(T_FOREST, r);
        } else sp = pick(table, r);
        if ((g === MAT.PARK || g === MAT.FOREST) && sp !== S.PINE && sp !== S.WILLOW && nearWater(cx, cz) && ((hs >>> 24) & 255) / 256 < 0.6) sp = S.WILLOW;
        if (addTree(cx, cz, sp, hs) && sandy) {
          pineStats.sandyForestTrees++;
          if (sp === S.PINE) pineStats.pines++;
        }
      }
    }
  }
  console.log("sandy-forest trees: " + JSON.stringify(pineStats));
  stage(`trees: ${stats.trees}`);

  // bushes
  const addBush = (cx: number, cz: number, h: number, hedge: boolean): void => {
    const hs = hash(h, 41);
    let sp: number = S.BUSH;
    if (!hedge && ((hs >>> 8) & 255) / 256 < 0.12) sp = hs & 0x10000 ? S.BUSH_LILAC : S.BUSH_PINK;
    let seed = hs & 255;
    if (!hedge) {
      const ns = obstacles.freeSeed(cx, cz, seed);
      if (ns < 0) {
        plantStats.dropped++;
        return;
      }
      if (ns !== seed) plantStats.moved++;
      seed = ns;
    }
    bushCells.add(ck(cx, cz));
    grid.addFeature(FEATURE_BUSH, 1 + ((hs >>> 20) % 3), cx, cz, sp, seed);
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
        if (g !== MAT.PARK && g !== MAT.FOREST && g !== MAT.SIDEWALK && g !== MAT.GRASS && g !== MAT.WETLAND && g !== MAT.REED && g !== MAT.MEADOW && g !== MAT.SCRUB) continue;
        if (cells[F_STRUCT_H * P + i] !== 0) continue;
        const cx = rx * REGION + lx, cz = rz * REGION + lz;
        const h = hash(cx + 77, cz + 191);
        const r = (h & 0xffff) / 65536;
        if (r >= 0.1) continue;
        if (g === MAT.WETLAND) {
          if (r >= 0.01) continue;
        } else if (g === MAT.REED) {
          if (r >= 0.006) continue;
        } else if (g === MAT.MEADOW) {
          if (r >= 0.003) continue;
        } else if (g === MAT.SCRUB) {
          if (r >= 0.05) continue;
        } else if (g === MAT.PARK) {
          if (r >= 0.06) continue;
        } else if (g === MAT.FOREST) {
          if (r >= 0.04) continue;
        } else if (g === MAT.SIDEWALK) {
          let park = false;
          for (let dz = -1; dz <= 1 && !park; dz++) for (let dx = -1; dx <= 1; dx++) if (grid.get(F_GROUND_MAT, cx + dx, cz + dz) === MAT.PARK) { park = true; break; }
          if (!park) continue;
        } else {
          // plain grass: bushes beside buildings, and willow-scrub along water edges (<= 8 m)
          const wd = cx < cellsX && cz < cellsZ ? waterDist[cz * cellsX + cx]! : 255;
          if (r >= (wd > 4 * DIST_UNIT ? 0.05 : 0.04)) continue;
          let near = wd <= 4 * DIST_UNIT;
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
      if (inCity(cx, cz) && bushOk(cx, cz)) addBush(cx, cz, hash(cx, cz), true);
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
  for (const f of fs.readdirSync(OUT_DIR)) if (/^v_.*\.bin$/.test(f)) fs.unlinkSync(path.join(OUT_DIR, f));
  let vecBytes = 0, vecLargest = { name: "", size: 0 };
  for (const tile of vec.tiles.values()) {
    const buf = encodeVectorTile(tile);
    const name = `v_${tile.rx}_${tile.rz}.bin`;
    fs.writeFileSync(path.join(OUT_DIR, name), buf);
    vecBytes += buf.length;
    if (buf.length > vecLargest.size) vecLargest = { name, size: buf.length };
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
    vectors: true,
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
  console.log(
    `vectors: files ${vec.tiles.size}, bytes ${vecBytes}, largest ${vecLargest.name} ${vecLargest.size}; ` +
      Object.entries(vec.stats).map(([k, v]) => `${k}=${v}`).join(" "),
  );
  console.log("stats", JSON.stringify(stats), "plants nudged/dropped off carriageways+footprints:", JSON.stringify(plantStats));
  console.log(`spawn world (m): ${spawn[0].toFixed(1)}, ${spawn[1].toFixed(1)}; total ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

// ---------------------------------------------------------------- places

const KIND_ORDER = [
  "city", "town", "square", "district", "suburb", "quarter", "neighbourhood", "village", "island", "hamlet",
  "bridge", "ferry_terminal", "port", "townhall", "university", "theatre", "museum", "attraction", "place_of_worship", "park", "historic",
];

function placeKind(t: Tags, isBridge: boolean): string | null {
  if (t.place === "square") return "square";
  if (t.place) return t.place;
  if (t.leisure === "park") return "park";
  if (t.amenity === "ferry_terminal") return "ferry_terminal";
  if (t.industrial === "port" || t.landuse === "port" || t.harbour === "yes") return "port";
  if (t.amenity === "place_of_worship" || t.amenity === "theatre" || t.amenity === "university" || t.amenity === "townhall") return t.amenity;
  if (t.tourism === "museum" || t.tourism === "attraction") return t.tourism;
  if (t.historic) return "historic";
  if (isBridge) return "bridge";
  return null;
}

function collectPlaces(osm: OsmData, areas: Area[], lines: Line[], mask: CityMask): Place[] {
  const raw: Place[] = [];
  const push = (t: Tags, kind: string | null, cx: number, cz: number): void => {
    const name = t.name;
    if (!name || !kind) return;
    if (!mask.hasPoint(cx, cz)) return;
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
  const out = dedupePlaces(raw);
  // named streets come after the landmarks (the menu lists landmarks first when the query is empty)
  for (const st of collectStreets(lines, (x, z) => mask.hasPoint(x, z), VOXEL)) out.push(st);
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

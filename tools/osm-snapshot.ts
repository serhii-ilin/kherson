// Pure helpers for the OSM snapshot: Overpass query text, CLI flags, tag filter,
// OPL parsing, and the frozen GitHub release coordinates. No network and no files.

import { BBOX } from "./bake/config.ts";

export interface BBox { south: number; west: number; north: number; east: number }

/** Overpass attic instant requested by `npm run fetch-osm` when no date is given. */
export const DEFAULT_SNAPSHOT_DATE = "2022-02-01T00:00:00Z";

/**
 * Geofabrik's Ukraine extract for 1 January 2022 (file written 2022-01-02).
 * This is the nearest complete country extract published before the 24 February 2022 invasion.
 * It is not the 1 February attic instant; that one is what the Overpass date option asks for.
 */
export const GEOFABRIK_UKRAINE_220101_URL = "https://download.geofabrik.de/europe/ukraine-220101.osm.pbf";
export const GEOFABRIK_UKRAINE_220101_DATE = "2022-01-01T00:00:00Z";
export const GEOFABRIK_UKRAINE_220101_BYTES = 678_386_418;

/** Tag of the release that holds the frozen pre-war snapshot. Not created by the fetch tool. */
export const RELEASE_TAG = "osm-2022-01-01";
export const RELEASE_REPO = "serhii-ilin/kherson";
export const RELEASE_JSON = "kherson.json.gz";
export const RELEASE_PBF = "kherson-bbox.osm.pbf";
export const RELEASE_SHA = "SHA256SUMS";

/** Degrees added on every side when clipping the national PBF, so boundary ways and the bridge are not cut. */
export const EXTRACT_MARGIN_DEG = 0.015;

export const DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

export const USER_AGENT = "voxel-kherson/0.1 (+https://github.com/serhii-ilin/kherson)";

export function assertSnapshotDate(date: string): string {
  if (!DATE_RE.test(date)) throw new Error(`snapshot date must be YYYY-MM-DDTHH:MM:SSZ, got ${JSON.stringify(date)}`);
  return date;
}

/** Overpass QL. `date` null omits the attic setting (live database). */
export function buildQuery(bbox: string, date: string | null): string {
  const dateSetting = date ? `[date:"${assertSnapshotDate(date)}"]` : "";
  return `[out:json][timeout:300][maxsize:536870912]${dateSetting};
(
  nwr(${bbox})["building"];
  nwr(${bbox})["highway"];
  nwr(${bbox})["railway"~"tram|rail|light_rail"];
  nwr(${bbox})["natural"~"water|wood|scrub|beach|sand|wetland|tree"];
  nwr(${bbox})["waterway"~"riverbank|river|canal|stream"];
  nwr(${bbox})["landuse"];
  nwr(${bbox})["leisure"~"park|garden|pitch|stadium|playground"];
  nwr(${bbox})["place"];
  nwr(${bbox})["amenity"]["name"];
  nwr(${bbox})["tourism"]["name"];
  nwr(${bbox})["historic"]["name"];
  nwr(${bbox})["bridge"="yes"];
  nwr(${bbox})["man_made"="bridge"];
  nwr(${bbox})["natural"="tree_row"];
  nwr(${bbox})["barrier"="hedge"];
);
out body;
>;
out skel qt;
`;
}

export interface FetchArgs {
  /** Attic instant, or null for a live Overpass query. */
  date: string | null;
  /** True when `--date` was passed (so a PBF build is not silently labelled with the default). */
  dateExplicit: boolean;
  live: boolean;
  pbf: string | null;
  geofabrik: boolean;
  fromRelease: boolean;
  out: string;
}

export function parseFetchArgs(argv: string[]): FetchArgs {
  const args: FetchArgs = {
    date: DEFAULT_SNAPSHOT_DATE,
    dateExplicit: false,
    live: false,
    pbf: null,
    geofabrik: false,
    fromRelease: false,
    out: "data/osm/kherson.json.gz",
  };
  let sawLive = false;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = (): string => {
      const v = argv[++i];
      if (!v || v.startsWith("--")) throw new Error(`missing value for ${a}`);
      return v;
    };
    if (a === "--live") {
      sawLive = true;
      args.live = true;
      args.date = null;
    } else if (a === "--date") {
      args.date = assertSnapshotDate(next());
      args.dateExplicit = true;
      args.live = false;
    } else if (a === "--pbf") args.pbf = next();
    else if (a === "--geofabrik") args.geofabrik = true;
    else if (a === "--from-release") args.fromRelease = true;
    else if (a === "--out") args.out = next();
    else throw new Error(`unknown argument ${a}`);
  }
  if (sawLive && args.dateExplicit) throw new Error("--live and --date cannot be combined");
  if (args.fromRelease && (args.pbf || args.geofabrik)) throw new Error("--from-release cannot be combined with --pbf or --geofabrik");
  if (args.geofabrik && args.pbf) throw new Error("--geofabrik downloads ukraine-220101; do not also pass --pbf");
  return args;
}

/** Per-date tile cache so an attic fetch cannot reuse live tiles. */
export function tileCacheDir(date: string | null): string {
  const slug = date ? assertSnapshotDate(date).replace(/:/g, "-") : "live";
  return `data/osm/tiles/${slug}`;
}

export function releaseAssetUrl(file: string, repo = RELEASE_REPO, tag = RELEASE_TAG): string {
  return `https://github.com/${repo}/releases/download/${tag}/${file}`;
}

export function expandBBox(bbox: BBox = BBOX, margin = EXTRACT_MARGIN_DEG): BBox {
  return {
    south: bbox.south - margin,
    west: bbox.west - margin,
    north: bbox.north + margin,
    east: bbox.east + margin,
  };
}

export interface ChecksumEntry { name: string; sha256: string }

/** `sha256sum` text: hex, two spaces, file name. */
export function formatChecksums(entries: readonly ChecksumEntry[]): string {
  return entries.map((e) => `${e.sha256}  ${e.name}`).join("\n") + "\n";
}

export function parseChecksums(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const m = /^([0-9a-fA-F]{64})\s+(\S.*)$/.exec(trimmed);
    if (!m) throw new Error(`bad checksum line: ${line}`);
    out.set(m[2]!.trim(), m[1]!.toLowerCase());
  }
  return out;
}

/** Same tag set as {@link buildQuery}. Untagged members are added later by the relation/way closure. */
export function matchesOverpassFilter(tags: Record<string, string> | undefined): boolean {
  if (!tags) return false;
  const has = (k: string): boolean => tags[k] !== undefined && tags[k] !== "";
  if (has("building") || has("highway") || has("landuse") || has("place")) return true;
  const railway = tags.railway;
  if (railway === "tram" || railway === "rail" || railway === "light_rail") return true;
  const natural = tags.natural;
  if (
    natural === "water" || natural === "wood" || natural === "scrub" || natural === "beach" || natural === "sand" ||
    natural === "wetland" || natural === "tree" || natural === "tree_row"
  ) return true;
  const waterway = tags.waterway;
  if (waterway === "riverbank" || waterway === "river" || waterway === "canal" || waterway === "stream") return true;
  const leisure = tags.leisure;
  if (leisure === "park" || leisure === "garden" || leisure === "pitch" || leisure === "stadium" || leisure === "playground") return true;
  if (has("amenity") && has("name")) return true;
  if (has("tourism") && has("name")) return true;
  if (has("historic") && has("name")) return true;
  if (tags.bridge === "yes" || tags.man_made === "bridge" || tags.barrier === "hedge") return true;
  return false;
}

export interface OsmMember { type: string; ref: number; role: string }

export interface OsmEl {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  nodes?: number[];
  members?: OsmMember[];
  tags?: Record<string, string>;
}

/** Osmium OPL escapes a code point as `%hex%` (space is `%20%`). Characters it leaves raw pass through. */
function decodeOpl(s: string): string {
  if (!s.includes("%")) return s;
  return s.replace(/%([0-9a-fA-F]+)%/g, (all, hex: string) => {
    const cp = Number.parseInt(hex, 16);
    return Number.isFinite(cp) ? String.fromCodePoint(cp) : all;
  });
}

/** One osmium OPL line, or null for blanks and deleted objects. */
export function parseOplLine(line: string): OsmEl | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const parts = trimmed.split(" ");
  const head = /^([nwr])(\d+)$/.exec(parts[0] ?? "");
  if (!head) return null;
  let deleted = false;
  let lat: number | undefined;
  let lon: number | undefined;
  let nodes: number[] | undefined;
  let members: OsmMember[] | undefined;
  let tags: Record<string, string> | undefined;
  for (let i = 1; i < parts.length; i++) {
    const tok = parts[i]!;
    const kind = tok[0];
    const rest = tok.slice(1);
    if (kind === "d") deleted = rest === "D";
    else if (kind === "x") lon = Number(rest);
    else if (kind === "y") lat = Number(rest);
    else if (kind === "N" && rest) {
      nodes = [];
      for (const part of rest.split(",")) {
        const m = /^n(\d+)$/.exec(part);
        if (m) nodes.push(Number(m[1]));
      }
    }
    else if (kind === "T" && rest) {
      tags = {};
      for (const pair of rest.split(",")) {
        const eq = pair.indexOf("=");
        if (eq <= 0) continue;
        tags[decodeOpl(pair.slice(0, eq))] = decodeOpl(pair.slice(eq + 1));
      }
    } else if (kind === "M" && rest) {
      members = [];
      for (const item of rest.split(",")) {
        const at = item.indexOf("@");
        const body = at >= 0 ? item.slice(0, at) : item;
        const role = at >= 0 ? decodeOpl(item.slice(at + 1)) : "";
        const t = body[0];
        const ref = Number(body.slice(1));
        if ((t === "n" || t === "w" || t === "r") && Number.isFinite(ref)) {
          members.push({ type: t === "n" ? "node" : t === "w" ? "way" : "relation", ref, role });
        }
      }
    }
  }
  if (deleted) return null;
  const type = head[1] === "n" ? "node" : head[1] === "w" ? "way" : "relation";
  const el: OsmEl = { type, id: Number(head[2]) };
  if (type === "node") {
    if (lat === undefined || lon === undefined || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    el.lat = lat;
    el.lon = lon;
  } else if (type === "way") el.nodes = nodes ?? [];
  else el.members = members ?? [];
  if (tags && Object.keys(tags).length) el.tags = tags;
  return el;
}

export function pointInBBox(lat: number, lon: number, bbox: BBox): boolean {
  return lat >= bbox.south && lat <= bbox.north && lon >= bbox.west && lon <= bbox.east;
}

function orient(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (by - ay) * (cx - bx) - (bx - ax) * (cy - by);
}

function segCross(aLat: number, aLon: number, bLat: number, bLon: number, cLat: number, cLon: number, dLat: number, dLon: number): boolean {
  const o1 = orient(aLon, aLat, bLon, bLat, cLon, cLat);
  const o2 = orient(aLon, aLat, bLon, bLat, dLon, dLat);
  const o3 = orient(cLon, cLat, dLon, dLat, aLon, aLat);
  const o4 = orient(cLon, cLat, dLon, dLat, bLon, bLat);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

function segmentHitsBBox(lat1: number, lon1: number, lat2: number, lon2: number, bbox: BBox): boolean {
  if (pointInBBox(lat1, lon1, bbox) || pointInBBox(lat2, lon2, bbox)) return true;
  const n = bbox.north, s = bbox.south, w = bbox.west, e = bbox.east;
  return segCross(lat1, lon1, lat2, lon2, n, w, n, e)
    || segCross(lat1, lon1, lat2, lon2, s, w, s, e)
    || segCross(lat1, lon1, lat2, lon2, n, w, s, w)
    || segCross(lat1, lon1, lat2, lon2, n, e, s, e);
}

/**
 * Keep elements the Overpass query would return for `bbox`, plus `extraWayIds`
 * (the Antonivskyi bridge corridor, which may sit just outside the project bbox),
 * then close over relation members and way nodes the way `>; out skel` does.
 */
export function selectSnapshot(elements: readonly OsmEl[], bbox: BBox, extraWayIds: ReadonlySet<number> = new Set()): OsmEl[] {
  const nodes = new Map<number, OsmEl>();
  const ways = new Map<number, OsmEl>();
  const rels = new Map<number, OsmEl>();
  for (const e of elements) {
    if (e.type === "node") nodes.set(e.id, e);
    else if (e.type === "way") ways.set(e.id, e);
    else rels.set(e.id, e);
  }
  const wayHits = (w: OsmEl): boolean => {
    const ids = w.nodes ?? [];
    let prev: OsmEl | undefined;
    for (const id of ids) {
      const n = nodes.get(id);
      if (!n || n.lat === undefined || n.lon === undefined) continue;
      if (prev && prev.lat !== undefined && prev.lon !== undefined && segmentHitsBBox(prev.lat, prev.lon, n.lat, n.lon, bbox)) return true;
      if (pointInBBox(n.lat, n.lon, bbox)) return true;
      prev = n;
    }
    return false;
  };
  const keepN = new Set<number>();
  const keepW = new Set<number>();
  const keepR = new Set<number>();
  for (const w of ways.values()) {
    if (extraWayIds.has(w.id) || (matchesOverpassFilter(w.tags) && wayHits(w))) keepW.add(w.id);
  }
  for (const n of nodes.values()) {
    if (n.lat === undefined || n.lon === undefined) continue;
    if (matchesOverpassFilter(n.tags) && pointInBBox(n.lat, n.lon, bbox)) keepN.add(n.id);
  }
  for (const r of rels.values()) {
    if (!matchesOverpassFilter(r.tags)) continue;
    let hit = false;
    for (const m of r.members ?? []) {
      if (m.type === "way" && (extraWayIds.has(m.ref) || (ways.get(m.ref) ? wayHits(ways.get(m.ref)!) : false))) hit = true;
      else if (m.type === "node") {
        const n = nodes.get(m.ref);
        if (n && n.lat !== undefined && n.lon !== undefined && pointInBBox(n.lat, n.lon, bbox)) hit = true;
      }
      if (hit) break;
    }
    if (hit) keepR.add(r.id);
  }
  const queue = [...keepR];
  while (queue.length) {
    const id = queue.pop()!;
    const r = rels.get(id);
    if (!r) continue;
    for (const m of r.members ?? []) {
      if (m.type === "way") keepW.add(m.ref);
      else if (m.type === "node") keepN.add(m.ref);
      else if (m.type === "relation" && !keepR.has(m.ref)) {
        keepR.add(m.ref);
        queue.push(m.ref);
      }
    }
  }
  for (const id of keepW) {
    const w = ways.get(id);
    if (!w) continue;
    for (const nid of w.nodes ?? []) keepN.add(nid);
  }
  const out: OsmEl[] = [];
  for (const id of [...keepN].sort((a, b) => a - b)) {
    const n = nodes.get(id);
    if (n) out.push(stripEmpty(n));
  }
  for (const id of [...keepW].sort((a, b) => a - b)) {
    const w = ways.get(id);
    if (w) out.push(stripEmpty(w));
  }
  for (const id of [...keepR].sort((a, b) => a - b)) {
    const r = rels.get(id);
    if (r) out.push(stripEmpty(r));
  }
  return out;
}

function stripEmpty(el: OsmEl): OsmEl {
  const copy: OsmEl = { type: el.type, id: el.id };
  if (el.lat !== undefined) copy.lat = el.lat;
  if (el.lon !== undefined) copy.lon = el.lon;
  if (el.nodes) copy.nodes = el.nodes;
  if (el.members) copy.members = el.members;
  if (el.tags && Object.keys(el.tags).length) {
    const tags: Record<string, string> = {};
    for (const k of Object.keys(el.tags).sort()) tags[k] = el.tags[k]!;
    copy.tags = tags;
  }
  return copy;
}

export interface SnapshotMeta {
  snapshot_date: string;
  source: string;
}

/** JSON object written into kherson.json.gz. No arrays before `elements` (the bake parser keys off the first `[`). */
export function snapshotDocument(elements: readonly OsmEl[], meta: SnapshotMeta): { json: string } {
  const body = {
    version: 0.6,
    generator: "voxel-kherson/fetch-osm",
    snapshot_date: meta.snapshot_date,
    source: meta.source,
    bbox: BBOX,
    elements,
  };
  return { json: JSON.stringify(body) };
}

/** How a PBF build should be labelled. An explicit `--date` wins; the Geofabrik file is 2022-01-01. */
export function pbfSnapshotMeta(args: FetchArgs, sourcePath: string): SnapshotMeta {
  if (args.dateExplicit && args.date) return { snapshot_date: args.date, source: sourcePath };
  if (args.geofabrik || sourcePath.includes("ukraine-220101")) {
    return { snapshot_date: GEOFABRIK_UKRAINE_220101_DATE, source: GEOFABRIK_UKRAINE_220101_URL };
  }
  return { snapshot_date: "unspecified", source: sourcePath };
}

export function ghReleaseCommand(dir: string): string {
  const files = [RELEASE_JSON, RELEASE_PBF, RELEASE_SHA].map((n) => `${dir}/${n}`).join(" ");
  return [
    "gh release create",
    RELEASE_TAG,
    files,
    `--repo ${RELEASE_REPO}`,
    `--title ${JSON.stringify("OSM snapshot 2022-01-01 (pre-war Kherson)")}`,
    `--notes-file ${dir}/NOTES.md`,
  ].join(" ");
}

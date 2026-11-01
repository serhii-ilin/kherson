import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { BBOX } from "./bake/config.ts";
import { pbfToSnapshotJson } from "./pbf-snapshot.ts";
import { downloadReleaseSnapshot, downloadToFile, sha256File } from "./snapshot-fallback.ts";
import {
  GEOFABRIK_UKRAINE_220101_BYTES, GEOFABRIK_UKRAINE_220101_URL, REFERENCE_JSON, REFERENCE_PBF,
  buildQuery, parseFetchArgs, pbfSnapshotMeta, snapshotDocument, tileCacheDir, type OsmEl,
} from "./osm-snapshot.ts";

// The whole bbox in one Overpass query is too heavy for busy public servers,
// so we fetch it as a grid of tiles (cached on disk, one directory per attic date)
// and merge by element id. The default is the live database, which is the base
// snapshot. `--geofabrik` / `--pbf` refresh the 2022 reference clip and do not
// replace that base. `--from-release` downloads the frozen base if Overpass is down.
const TILES = 4;
const GEOFABRIK_PBF = "data/osm/upstream/ukraine-220101.osm.pbf";

const endpoints = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

async function fetchOverpass(url: string, query: string): Promise<string> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      "User-Agent": "voxel-kherson/0.1 (+https://github.com/serhii-ilin/kherson)",
    },
    body: `data=${encodeURIComponent(query)}`,
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const text = await res.text();
  if (!text.trimStart().startsWith("{")) throw new Error("non-JSON response");
  const remark = /"remark":\s*"([^"]*)"/.exec(text.slice(-2000));
  if (remark) throw new Error(`Overpass remark: ${remark[1]}`);
  return text;
}

async function fetchTile(b: string, label: string, date: string | null): Promise<string> {
  let wait = 15_000;
  for (let attempt = 1; attempt <= 8; attempt++) {
    for (const url of endpoints) {
      try {
        return await fetchOverpass(url, buildQuery(b, date));
      } catch (e) {
        console.error(`  tile ${label} ${new URL(url).host} attempt ${attempt}: ${(e as Error).message}`);
      }
    }
    await new Promise((r) => setTimeout(r, wait));
    wait = Math.min(wait * 2, 240_000);
  }
  throw new Error(`tile ${label} failed after retries`);
}

interface Element { type: string; id: number; tags?: unknown; [k: string]: unknown }

function writeSnapshot(out: string, elements: readonly OsmEl[], date: string | null, source: string): void {
  const json = snapshotDocument(elements, { snapshot_date: date ?? "live", source }).json;
  const gz = zlib.gzipSync(Buffer.from(json, "utf8"), { level: 9 });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, gz);
  const count = (t: string) => elements.filter((e) => e.type === t).length;
  console.log(`Wrote ${out} (${gz.length} bytes gzipped, ${json.length} bytes raw)`);
  console.log(`nodes=${count("node")} ways=${count("way")} relations=${count("relation")} snapshot_date=${date ?? "live"}`);
}

async function fetchOverpassSnapshot(out: string, date: string | null): Promise<void> {
  const cacheDir = tileCacheDir(date);
  fs.mkdirSync(cacheDir, { recursive: true });
  const dLat = (BBOX.north - BBOX.south) / TILES;
  const dLon = (BBOX.east - BBOX.west) / TILES;
  const merged = new Map<string, Element>();
  for (let ty = 0; ty < TILES; ty++) {
    for (let tx = 0; tx < TILES; tx++) {
      const label = `${tx}_${ty}`;
      const file = `${cacheDir}/${label}.json.gz`;
      let text: string;
      if (fs.existsSync(file)) {
        text = zlib.gunzipSync(fs.readFileSync(file)).toString("utf8");
      } else {
        const s = BBOX.south + ty * dLat, w = BBOX.west + tx * dLon;
        const b = `${s.toFixed(5)},${w.toFixed(5)},${(s + dLat).toFixed(5)},${(w + dLon).toFixed(5)}`;
        console.log(`fetching tile ${label} (${b}) date=${date ?? "live"}`);
        text = await fetchTile(b, label, date);
        fs.writeFileSync(file, zlib.gzipSync(Buffer.from(text, "utf8"), { level: 6 }));
      }
      const els = (JSON.parse(text) as { elements: Element[] }).elements;
      for (const el of els) {
        const key = `${el.type}/${el.id}`;
        const prev = merged.get(key);
        // Skeleton output ("out skel") lacks tags; keep the richer copy.
        if (!prev || (!prev.tags && el.tags)) merged.set(key, el);
      }
      console.log(`tile ${label}: ${els.length} elements (total ${merged.size})`);
    }
  }
  const elements = [...merged.values()] as OsmEl[];
  writeSnapshot(out, elements, date, date ? `overpass-attic:${date}` : "overpass-live");
}

function ensureGeofabrikPbf(): string {
  if (fs.existsSync(GEOFABRIK_PBF) && fs.statSync(GEOFABRIK_PBF).size === GEOFABRIK_UKRAINE_220101_BYTES) {
    console.log(`using ${GEOFABRIK_PBF}`);
    return GEOFABRIK_PBF;
  }
  console.log(`downloading ${GEOFABRIK_UKRAINE_220101_URL}`);
  downloadToFile(GEOFABRIK_UKRAINE_220101_URL, GEOFABRIK_PBF);
  const size = fs.statSync(GEOFABRIK_PBF).size;
  if (size !== GEOFABRIK_UKRAINE_220101_BYTES) {
    fs.rmSync(GEOFABRIK_PBF, { force: true });
    throw new Error(`geofabrik file size ${size} != ${GEOFABRIK_UKRAINE_220101_BYTES}`);
  }
  return GEOFABRIK_PBF;
}

async function main(): Promise<void> {
  const args = parseFetchArgs(process.argv);
  if (args.fromRelease) {
    console.log(`downloading frozen release (not an Overpass query) to ${args.out}`);
    await downloadReleaseSnapshot(args.out);
    console.log(`sha256 ${await sha256File(args.out)}`);
    return;
  }
  if (args.geofabrik || args.pbf) {
    const source = args.geofabrik ? ensureGeofabrikPbf() : args.pbf!;
    const meta = pbfSnapshotMeta(args, source);
    const json = await pbfToSnapshotJson(source, REFERENCE_PBF, meta);
    const gz = zlib.gzipSync(Buffer.from(json, "utf8"), { level: 9 });
    fs.mkdirSync("data/osm/reference", { recursive: true });
    fs.writeFileSync(REFERENCE_JSON, gz);
    console.log(`reference clip ${REFERENCE_PBF} (${fs.statSync(REFERENCE_PBF).size} bytes)`);
    console.log(`reference json ${REFERENCE_JSON} (${gz.length} bytes gzipped) date=${meta.snapshot_date}`);
    if (args.outExplicit) {
      fs.mkdirSync(path.dirname(args.out), { recursive: true });
      fs.writeFileSync(args.out, gz);
      console.log(`also wrote ${args.out}`);
    } else {
      console.log("base snapshot data/osm/kherson.json.gz was left unchanged; run npm run build-restoration");
    }
    return;
  }
  try {
    await fetchOverpassSnapshot(args.out, args.date);
  } catch (e) {
    // A historical --date must not be silently replaced by the frozen base.
    if (args.date === null) {
      console.error(`Overpass failed (${(e as Error).message}).`);
      console.error("Falling back to the frozen base snapshot on the GitHub release.");
      await downloadReleaseSnapshot(args.out);
      return;
    }
    throw e;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
